// OpenAI Realtime API voice layer. Mirrors the interface of the original GeminiLiveService
// so App.tsx can drive it the same way: 24kHz PCM16 audio in/out, text injection, tool calls.
// The browser never sees OPENAI_API_KEY: it fetches a short-lived client secret from
// /api/realtime-session (served by the Vite dev middleware in vite.config.ts).

export interface LiveSessionCallbacks {
  onTranscription?: (text: string, role: 'user' | 'model') => void;
  onAudioData?: (base64Audio: string, itemId: string) => void;
  // How many ms of this item's audio the user has actually heard; used to truncate on interruption.
  getPlayedMs?: (itemId: string) => number;
  onInterrupted?: () => void;
  onUsageUpdate?: (usage: { promptTokens: number; candidatesTokens: number; totalTokens: number }) => void;
  onToolCall?: (toolCall: any) => void;
  onError?: (error: any) => void;
  onClose?: (info: CloseInfo) => void;
  onDebugLog?: (message: string) => void;
  onTurnComplete?: () => void;
}

export interface LiveSessionConfig {
  systemInstruction?: string;
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
        idea: { type: "string", description: "The user's comment, in their own words as closely as possible. Don't summarise or reinterpret it." }
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

export interface CloseInfo {
  code?: number;
  reason?: string;
  // true when the app closed the session itself (pause, stop, stop_playback)
  expected: boolean;
}

export class OpenAIRealtimeService {
  private ws: WebSocket | null = null;
  private isReady = false;
  private callbacks: LiveSessionCallbacks = {};

  // Response bookkeeping. The API allows one response at a time, so replies we want while one
  // is in flight are deferred until response.done. Everything funnels through flushResponse().
  private responseActive = false;
  private currentResponseId: string | null = null;
  private responseWanted = false;
  private flushScheduled = false;
  private responseCreateSeq = 0;
  private pendingCreateEventId: string | null = null;
  // Audio from responses we cancelled (by interrupting or sending new text) is dropped.
  private cancelledResponses = new Set<string>();
  // Assistant audio item currently being spoken, and how much audio (ms) has arrived for it.
  private audioItemId: string | null = null;
  private audioReceivedMs = 0;

  async connect(callbacks: LiveSessionCallbacks, config: LiveSessionConfig) {
    this.callbacks = callbacks;
    this.isReady = false;

    callbacks.onDebugLog?.("Requesting realtime session token...");
    const res = await fetch('/api/realtime-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).catch(() => { throw new Error("Couldn't reach the ARC server. Is `npm run dev` still running?"); });
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
      const timeout = setTimeout(() => {
        reject(new Error("Couldn't connect to OpenAI within 15 seconds. Check your internet connection and try again."));
        ws.close();
      }, 15000);
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
      ws.onerror = () => {
        clearTimeout(timeout);
        callbacks.onDebugLog?.("Realtime socket error");
        reject(new Error("Couldn't connect to OpenAI. Check your internet connection and try again."));
      };
    });

    ws.onmessage = (event) => {
      try { this.handleEvent(JSON.parse(event.data)); }
      catch (err) { console.error("Failed to handle realtime event:", err); }
    };
    ws.onerror = () => callbacks.onDebugLog?.("Realtime socket error");
    ws.onclose = (event) => {
      callbacks.onDebugLog?.(`Realtime session closed: ${event.reason || 'No reason provided'} (Code: ${event.code})`);
      this.isReady = false;
      this.ws = null;
      callbacks.onClose?.({ code: event.code, reason: event.reason, expected: false });
    };
    return ws;
  }

  private send(event: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  // Ask for a reply. Several requests in the same tick (e.g. two tool outputs) become one reply,
  // and a request made while a response is in flight waits for response.done.
  private wantResponse() {
    this.responseWanted = true;
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setTimeout(() => {
      this.flushScheduled = false;
      this.flushResponse();
    }, 0);
  }

  private flushResponse() {
    if (!this.responseWanted || this.responseActive || !this.isReady) return;
    this.responseWanted = false;
    this.responseActive = true;
    this.pendingCreateEventId = `arc_rc_${++this.responseCreateSeq}`;
    this.send({ type: 'response.create', event_id: this.pendingCreateEventId });
  }

  // Audio arrives faster than real time, so without this the model believes the user heard the
  // whole reply. Truncating to what was actually played keeps its context honest, which is what
  // lets it resume from the right sentence after an interruption.
  private truncateHeardAudio() {
    if (!this.audioItemId) return;
    const played = Math.floor(this.callbacks.getPlayedMs?.(this.audioItemId) ?? this.audioReceivedMs);
    if (played < this.audioReceivedMs) {
      this.send({ type: 'conversation.item.truncate', item_id: this.audioItemId, content_index: 0, audio_end_ms: Math.max(0, played) });
    }
    this.audioItemId = null;
    this.audioReceivedMs = 0;
  }

  private cancelActiveResponse() {
    if (!this.responseActive) return;
    this.truncateHeardAudio();
    if (this.currentResponseId) this.cancelledResponses.add(this.currentResponseId);
    this.send({ type: 'response.cancel' });
    this.callbacks.onInterrupted?.();
  }

  private handleEvent(msg: any) {
    const cb = this.callbacks;
    switch (msg.type) {
      case 'session.updated':
        cb.onDebugLog?.("Setup complete received!");
        break;
      case 'response.created':
        // Also fires for replies the server starts itself after the user speaks.
        this.responseActive = true;
        this.pendingCreateEventId = null;
        this.currentResponseId = msg.response?.id ?? null;
        break;
      case 'response.output_audio.delta':
        if (this.cancelledResponses.has(msg.response_id)) break;
        if (msg.item_id !== this.audioItemId) {
          this.audioItemId = msg.item_id;
          this.audioReceivedMs = 0;
        }
        // PCM16 mono at 24kHz: 48 bytes per ms; base64 is 4 chars per 3 bytes.
        this.audioReceivedMs += (msg.delta.length * 3 / 4) / 48;
        cb.onAudioData?.(msg.delta, msg.item_id);
        break;
      case 'response.output_audio_transcript.done':
        if (msg.transcript && !this.cancelledResponses.has(msg.response_id)) cb.onTranscription?.(msg.transcript, 'model');
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript?.trim()) cb.onTranscription?.(msg.transcript.trim(), 'user');
        break;
      case 'input_audio_buffer.speech_started':
        // Server VAD cancels the in-flight response; drop its remaining audio and stop local playback.
        if (this.responseActive && this.currentResponseId) this.cancelledResponses.add(this.currentResponseId);
        this.truncateHeardAudio();
        cb.onInterrupted?.();
        break;
      case 'response.done': {
        const response = msg.response || {};
        this.responseActive = false;
        this.currentResponseId = null;
        if (response.id) this.cancelledResponses.delete(response.id);

        const items = (response.output || []).filter((item: any) => item.type === 'function_call');
        // A function call cut off mid-way has partial arguments: close it out without acting on it.
        for (const item of items.filter((i: any) => i.status !== 'completed')) {
          this.send({
            type: 'conversation.item.create',
            item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify({ error: 'Cancelled before completion; ignore.' }) }
          });
        }
        const calls = items
          .filter((item: any) => item.status === 'completed')
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
        if (response.status === 'failed') {
          const detail = response.status_details?.error?.message || 'OpenAI could not generate a reply.';
          cb.onDebugLog?.(`Response failed: ${detail}`);
          cb.onError?.(new Error(detail));
        }
        if (calls.length > 0) {
          cb.onToolCall?.({ functionCalls: calls });
        } else if (response.status === 'completed') {
          cb.onTurnComplete?.();
        }
        this.flushResponse();
        break;
      }
      case 'error': {
        const err = msg.error || {};
        // Harmless race when cancelling a response that already finished.
        if (err.code === 'response_cancel_not_active') break;
        if (err.event_id && err.event_id === this.pendingCreateEventId) {
          this.pendingCreateEventId = null;
          if (err.code === 'conversation_already_has_active_response') {
            // The server started its own reply first; ours goes out after it finishes.
            this.responseActive = true;
            this.responseWanted = true;
            break;
          }
          this.responseActive = false;
        }
        cb.onDebugLog?.(`Server Error: ${JSON.stringify(err)}`);
        console.error("Realtime error:", err);
        break;
      }
    }
  }

  sendAudio(base64Data: string) {
    if (this.isReady) {
      this.send({ type: 'input_audio_buffer.append', audio: base64Data });
    }
  }

  // Sends text and asks ARC to respond. Interrupts whatever ARC is currently saying.
  sendText(text: string) {
    if (!this.isReady) return;
    this.cancelActiveResponse();
    this.send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
    });
    this.wantResponse();
  }

  // Adds background information to the conversation without prompting a reply.
  sendContext(text: string) {
    if (!this.isReady) return;
    this.send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
    });
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
    if (needsReply) this.wantResponse();
  }

  disconnect() {
    const wasOpen = !!this.ws;
    this.isReady = false;
    this.responseActive = false;
    this.responseWanted = false;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
    if (wasOpen) this.callbacks.onClose?.({ expected: true });
  }
}
