// OpenAI settings shared by the local server (vite.config.ts) and the hosted build, which calls
// OpenAI directly from the browser with the visitor's own key. No browser or Node APIs in here.

export const DEFAULT_REALTIME_MODEL = 'gpt-realtime';
export const DEFAULT_VISION_MODEL = 'gpt-5-mini';
export const DEFAULT_VOICE = 'marin';
export const DEFAULT_VOICE_STYLE = 'Speak with a natural British English accent (standard Southern British / Received Pronunciation), using British pronunciation and vocabulary throughout. Keep this accent consistently for the whole session, including when reading document text aloud.';

export const IMAGE_ALT_TEXT_PROMPT = 'You are an AI assistant generating alt text for a document. Summarize this image or chart concisely (1-2 sentences max) so a listener understands what it shows. Clarify that it is an image/object.';

// Body for POST /v1/realtime/client_secrets: a short-lived token the browser uses to open the
// Realtime WebSocket, so a long-lived API key never travels over the socket.
export function realtimeClientSecretRequest(model: string, voice: string) {
  return {
    expires_after: { anchor: 'created_at', seconds: 600 },
    session: {
      type: 'realtime',
      model,
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: { model: 'gpt-4o-mini-transcribe' },
          turn_detection: { type: 'server_vad', interrupt_response: true, create_response: true },
        },
        output: {
          format: { type: 'audio/pcm', rate: 24000 },
          voice,
        },
      },
    },
  };
}

export function imageDescriptionRequest(model: string, dataUrl: string) {
  return {
    model,
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: IMAGE_ALT_TEXT_PROMPT },
        { type: 'input_image', image_url: dataUrl },
      ],
    }],
  };
}

export function outputText(data: any): string {
  return data?.output_text ?? data?.output?.flatMap((o: any) => o.content || []).find((c: any) => c.type === 'output_text')?.text ?? '';
}

// Turns OpenAI's error responses into something a first-time user can act on.
export function describeOpenAIError(status: number, data: any, keyHint = 'Check OPENAI_API_KEY in .env, then restart the dev server.') {
  const msg = data?.error?.message || `OpenAI returned HTTP ${status}`;
  if (status === 401) return `OpenAI rejected the API key. ${keyHint}`;
  if (status === 429 && /quota|billing|credit/i.test(msg)) return 'Your OpenAI account has no credit left. Add credit under Settings → Billing on platform.openai.com.';
  if (status === 403 && /region|country|territory/i.test(msg)) return "OpenAI's API isn't available in your region.";
  return msg;
}
