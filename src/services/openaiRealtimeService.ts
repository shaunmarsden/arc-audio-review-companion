// OpenAI Realtime API voice layer. Mirrors the interface of the original GeminiLiveService
// so App.tsx can drive it the same way: 24kHz PCM16 audio in/out, text injection, tool calls.
// The browser never sees OPENAI_API_KEY: it fetches a short-lived client secret from
// /api/realtime-session (served by the Vite dev middleware in vite.config.ts).

export interface LiveSessionCallbacks {
  onTranscription?: (text: string, role: 'user' | 'model') => void;
  onAudioData?: (base64Audio: string) => void;
  onInterrupted?: () => void;
  onUsageUpdate?: (usage: { promptTokens: number; candidatesTokens: number; totalTokens: number }) => void;
  onToolCall?: (toolCall: any) => void;
  onError?: (error: any) => void;
  onClose?: () => void;
  onDebugLog?: (message: string) => void;
  onTurnComplete?: () => void;
}

export interface LiveSessionConfig {
  systemInstruction?: string;
  voiceName?: string;
}

export const INPUT_SAMPLE_RATE = 24000;

const TOOLS = [
  {
    type: "function",
    name: "capture_idea",
    description: "Captures an idea, comment, or feedback directly into the 'Captured Ideas' log. Call this tool immediately when the user requests to save a comment, add a note, or capture feedback (e.g., if they say 'add a comment...', 'make a note that...', or 'capture...'). Do NOT ask for redundant verbal confirmations or seek separate permission to save it. Execute immediately, then briefly state that you have saved it.",
    parameters: {
      type: "object",
      properties: {
        idea: { type: "string", description: "The idea or thought to capture." }
      },
      required: ["idea"]
    }
  },
  {
    type: "function",
    name: "change_section",
    description: "Changes the active document section to read. Use this when the user verbally asks to go to a different section, re-read a section, go back, or skip ahead.",
    parameters: {
      type: "object",
      properties: {
        sectionIndex: { type: "integer", description: "The 0-based index of the section to jump to, from the document structure in your instructions." }
      },
      required: ["sectionIndex"]
    }
  },
  {
    type: "function",
    name: "set_reading_mode",
    description: "Switches how sections are delivered for the rest of the session. 'skim' gives a 2-3 sentence gist of each section; 'full' reads each section verbatim. Call when the user asks to switch to skimming or full reading. Not needed for a one-off full read of the current section.",
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["skim", "full"], description: "The reading mode to switch to." }
      },
      required: ["mode"]
    }
  },
  {
    type: "function",
    name: "stop_playback",
    description: "Stops the playback and ends or pauses the current review session completely (turns off the microphone and stops ARC's speech). Call this tool only when the user confirms they have no more feedback/comments and all queries are handled at the end of the document, or when the user tells you to stop playback, pause indefinitely, or stop reading.",
    parameters: { type: "object", properties: {}, required: [] }
  }
];

// Tools whose result should not prompt ARC to keep talking.
const SILENT_TOOLS = new Set(["stop_playback"]);

export class OpenAIRealtimeService {
  private ws: WebSocket | null = null;
  private isReady = false;
  private responseActive = false;
  private pendingResponseCreate = false;
  private responseScheduled = false;
  private callbacks: LiveSessionCallbacks = {};

  async connect(callbacks: LiveSessionCallbacks, config: LiveSessionConfig) {
    this.callbacks = callbacks;
    this.isReady = false;

    callbacks.onDebugLog?.("Requesting realtime session token...");
    const res = await fetch('/api/realtime-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice: config.voiceName })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.value) {
      throw new Error(data.error || `Failed to create realtime session (HTTP ${res.status})`);
    }
    const model = data.model || 'gpt-realtime';
    callbacks.onDebugLog?.(`Connecting to ${model}...`);

    const ws = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
      ['realtime', `openai-insecure-api-key.${data.value}`]
    );
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Connection timeout after 15 seconds")), 15000);
      ws.onopen = () => {
        clearTimeout(timeout);
        callbacks.onDebugLog?.("Realtime socket open");
        this.send({
          type: 'session.update',
          session: {
            type: 'realtime',
            instructions: [data.voiceStyle && `## Voice\n${data.voiceStyle}`, config.systemInstruction].filter(Boolean).join('\n\n'),
            tools: TOOLS,
            tool_choice: 'auto'
          }
        });
        this.isReady = true;
        resolve();
      };
      ws.onerror = (e) => {
        clearTimeout(timeout);
        callbacks.onDebugLog?.("Realtime socket error");
        reject(new Error("Realtime WebSocket error"));
        callbacks.onError?.(e);
      };
    });

    ws.onmessage = (event) => this.handleEvent(JSON.parse(event.data));
    ws.onclose = (event) => {
      callbacks.onDebugLog?.(`Realtime session closed: ${event.reason || 'No reason provided'} (Code: ${event.code})`);
      this.isReady = false;
      callbacks.onClose?.();
    };
    return ws;
  }

  private send(event: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  // A new response can't be created while one is in flight, so defer until response.done.
  private requestResponse() {
    if (this.responseActive) {
      this.pendingResponseCreate = true;
    } else {
      this.responseActive = true;
      this.send({ type: 'response.create' });
    }
  }

  // Coalesces several tool outputs sent in the same tick into a single reply.
  private scheduleResponse() {
    if (this.responseScheduled) return;
    this.responseScheduled = true;
    setTimeout(() => {
      this.responseScheduled = false;
      this.requestResponse();
    }, 0);
  }

  private handleEvent(msg: any) {
    const cb = this.callbacks;
    switch (msg.type) {
      case 'session.updated':
        cb.onDebugLog?.("Setup complete received!");
        break;
      case 'response.created':
        this.responseActive = true;
        break;
      case 'response.output_audio.delta':
        cb.onAudioData?.(msg.delta);
        break;
      case 'response.output_audio_transcript.done':
        if (msg.transcript) cb.onTranscription?.(msg.transcript, 'model');
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript?.trim()) cb.onTranscription?.(msg.transcript.trim(), 'user');
        break;
      case 'input_audio_buffer.speech_started':
        // Server VAD cancels the in-flight response; stop local playback to match.
        cb.onInterrupted?.();
        break;
      case 'response.done': {
        this.responseActive = false;
        const response = msg.response || {};
        const calls = (response.output || [])
          .filter((item: any) => item.type === 'function_call')
          .map((item: any) => {
            let args = {};
            try { args = JSON.parse(item.arguments || '{}'); } catch { /* leave empty */ }
            return { name: item.name, args, id: item.call_id };
          });
        if (response.usage) {
          cb.onUsageUpdate?.({
            promptTokens: response.usage.input_tokens || 0,
            candidatesTokens: response.usage.output_tokens || 0,
            totalTokens: response.usage.total_tokens || 0
          });
        }
        if (calls.length > 0) {
          cb.onToolCall?.({ functionCalls: calls });
        } else if (response.status !== 'cancelled') {
          cb.onTurnComplete?.();
        }
        if (this.pendingResponseCreate) {
          this.pendingResponseCreate = false;
          this.requestResponse();
        }
        break;
      }
      case 'error':
        // Harmless race when cancelling a response that already finished.
        if (msg.error?.code === 'response_cancel_not_active') break;
        cb.onDebugLog?.(`Server Error: ${JSON.stringify(msg.error)}`);
        console.error("Realtime error:", msg.error);
        break;
    }
  }

  sendAudio(base64Data: string) {
    if (this.isReady) {
      this.send({ type: 'input_audio_buffer.append', audio: base64Data });
    }
  }

  sendText(text: string) {
    if (!this.isReady) return;
    if (this.responseActive) {
      // Mirror Gemini's behaviour: new text input interrupts whatever ARC is saying.
      this.send({ type: 'response.cancel' });
      this.callbacks.onInterrupted?.();
    }
    this.send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
    });
    this.requestResponse();
  }

  sendToolResponse(toolResponse: { functionResponses: Array<{ name: string; response: any; id: string }> }) {
    let needsReply = false;
    for (const fr of toolResponse.functionResponses) {
      this.send({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: fr.id, output: JSON.stringify(fr.response) }
      });
      if (!SILENT_TOOLS.has(fr.name)) needsReply = true;
    }
    if (needsReply) this.scheduleResponse();
  }

  disconnect() {
    this.isReady = false;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.callbacks.onClose?.();
  }
}
