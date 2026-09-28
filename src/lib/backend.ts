// Where the app gets its OpenAI access from.
// - Local build (`npm run dev`): the local server holds OPENAI_API_KEY and exposes /api/* routes.
// - Hosted build (`npm run build:web`, GitHub Pages): there is no server. The visitor pastes their own
//   OpenAI key, which is kept in this browser only and sent only to api.openai.com.
import {
  DEFAULT_REALTIME_MODEL, DEFAULT_VISION_MODEL, DEFAULT_VOICE, DEFAULT_VOICE_STYLE,
  realtimeClientSecretRequest, imageDescriptionRequest, outputText, describeOpenAIError,
} from './openaiConfig';

export const IS_HOSTED = import.meta.env.VITE_HOSTED === 'true';

const KEY_STORAGE = 'arc_openai_key';
const HOSTED_KEY_HINT = 'Check the key under Menu → Change OpenAI key.';

export function getStoredApiKey(): string | null {
  try { return window.localStorage.getItem(KEY_STORAGE); } catch { return null; }
}

export function storeApiKey(key: string) {
  try { window.localStorage.setItem(KEY_STORAGE, key); } catch { /* private mode: key lasts for this page only */ }
  memoryKey = key;
}

export function forgetApiKey() {
  try { window.localStorage.removeItem(KEY_STORAGE); } catch {}
  memoryKey = null;
}

// Falls back to memory if localStorage is unavailable (e.g. some private browsing modes).
let memoryKey: string | null = null;
const currentKey = () => getStoredApiKey() ?? memoryKey;

async function callOpenAI(endpoint: string, payload: unknown, key = currentKey(), keyHint = HOSTED_KEY_HINT) {
  if (!key) throw new Error('Add your OpenAI API key to start.');
  let res: Response;
  try {
    res = await fetch(`https://api.openai.com/v1/${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Couldn't reach OpenAI. Check your internet connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(describeOpenAIError(res.status, data, keyHint));
  return data;
}

async function callLocal(route: string, body: unknown) {
  let res: Response;
  try {
    res = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Couldn't reach the ARC server. Is `npm run dev` still running?");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  return data;
}

export interface RealtimeSession {
  clientSecret: string;
  model: string;
  voiceStyle?: string;
}

export async function createRealtimeSession(): Promise<RealtimeSession> {
  if (IS_HOSTED) {
    const data = await callOpenAI('realtime/client_secrets', realtimeClientSecretRequest(DEFAULT_REALTIME_MODEL, DEFAULT_VOICE));
    return { clientSecret: data.value, model: DEFAULT_REALTIME_MODEL, voiceStyle: DEFAULT_VOICE_STYLE };
  }
  const data = await callLocal('/api/realtime-session', {});
  if (!data.value) throw new Error('The ARC server did not return a session token.');
  return { clientSecret: data.value, model: data.model || DEFAULT_REALTIME_MODEL, voiceStyle: data.voiceStyle };
}

// Checks a key before saving it by minting a (free, short-lived) Realtime token with it.
export async function validateApiKey(key: string): Promise<void> {
  await callOpenAI('realtime/client_secrets', realtimeClientSecretRequest(DEFAULT_REALTIME_MODEL, DEFAULT_VOICE), key, 'Check you copied the whole key, or create a new one.');
}

export async function describeImage(dataUrl: string): Promise<string> {
  if (IS_HOSTED) return outputText(await callOpenAI('responses', imageDescriptionRequest(DEFAULT_VISION_MODEL, dataUrl)));
  return (await callLocal('/api/describe-image', { dataUrl })).text || '';
}
