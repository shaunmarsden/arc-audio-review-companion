import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import {defineConfig, loadEnv, type Plugin} from 'vite';

// Server-side OpenAI endpoints so OPENAI_API_KEY never reaches the browser bundle.
function openaiApi(env: Record<string, string>): Plugin {
  const apiKey = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY;
  const realtimeModel = env.OPENAI_REALTIME_MODEL || 'gpt-realtime';
  const visionModel = env.OPENAI_VISION_MODEL || 'gpt-5-mini';
  const defaultVoice = env.OPENAI_VOICE || 'marin';
  const voiceStyle = env.OPENAI_VOICE_STYLE ?? 'Speak with a natural British English accent (standard Southern British / Received Pronunciation), using British pronunciation and vocabulary throughout. Keep this accent consistently for the whole session, including when reading document text aloud.';

  class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }

  // Bodies are capped so a single request can't exhaust memory.
  const readJson = (req: IncomingMessage, maxBytes: number) => new Promise<any>((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= maxBytes) body += c; // past the cap, keep draining but stop buffering
    });
    req.on('end', () => {
      if (size > maxBytes) return reject(new HttpError(413, 'Request too large'));
      try { resolve(JSON.parse(body || '{}')); } catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
  const reply = (res: ServerResponse, status: number, data: any) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(data));
  };
  const openai = (endpoint: string, payload: any) => fetch(`https://api.openai.com/v1/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  // The /api routes spend the user's OpenAI credit and read local files, so only the app itself
  // may call them. This middleware runs before Vite's own host and CORS checks, so it applies its own:
  // - Host must be localhost, which blocks DNS rebinding.
  // - A cross-site Origin is refused, which blocks other websites the user has open.
  // - POSTs must be JSON, so cross-origin requests always need a CORS preflight, which Vite rejects.
  const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
  const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
  const checkCaller = (req: IncomingMessage) => {
    if (!LOCAL_HOST.test(req.headers.host || '')) throw new HttpError(403, 'Forbidden host');
    const origin = req.headers.origin;
    if (origin && !LOCAL_ORIGIN.test(origin)) throw new HttpError(403, 'Forbidden origin');
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Forbidden');
    if (req.method === 'POST' && !(req.headers['content-type'] || '').startsWith('application/json')) {
      throw new HttpError(415, 'Content-Type must be application/json');
    }
  };

  // Local hand-off folder: an agent drops a doc in inbox/doc.json, ARC writes captured notes to inbox/notes.json.
  const inboxDir = path.resolve(__dirname, 'inbox');
  const readJsonFile = (file: string) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
  const cleanString = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/api/inbox') {
      const doc = readJsonFile(path.join(inboxDir, 'doc.json'));
      if (!doc || !Array.isArray(doc.chunks)) return reply(res, 404, { error: 'No doc in inbox' });
      return reply(res, 200, doc);
    }
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');

    // Notes are stored per doc and only ever changed one note at a time, so a stale or
    // freshly reloaded tab can never wipe notes another tab captured.
    if (req.url === '/api/notes/add' || req.url === '/api/notes/delete') {
      const body = await readJson(req, 256 * 1024);
      const key = cleanString(body.docTitle, 300)?.trim() || 'Untitled document';
      const file = path.join(inboxDir, 'notes.json');
      fs.mkdirSync(inboxDir, { recursive: true });
      const saved = readJsonFile(file);
      // A Map avoids prototype keys like "__proto__" being treated specially.
      const docs = new Map<string, { notes: any[]; updatedAt?: string }>(
        saved?.docs && typeof saved.docs === 'object' ? Object.entries(saved.docs) : []
      );
      const entry = docs.get(key) ?? { notes: [] };
      if (req.url === '/api/notes/add') {
        const n = body.note || {};
        const id = cleanString(n.id, 100);
        const text = cleanString(n.text, 10_000);
        if (!id || !text) throw new HttpError(400, 'note.id and note.text are required');
        if (!entry.notes.some(x => x.id === id)) {
          entry.notes.push({
            id, text,
            section: cleanString(n.section, 300),
            source: n.source === 'user' ? 'user' : 'arc',
            timestamp: cleanString(n.timestamp, 40) || new Date().toISOString(),
          });
        }
      } else {
        const id = cleanString(body.id, 100);
        entry.notes = entry.notes.filter(x => x.id !== id);
      }
      entry.updatedAt = new Date().toISOString();
      docs.set(key, entry);
      fs.writeFileSync(file, JSON.stringify({ docs: Object.fromEntries(docs) }, null, 2));
      return reply(res, 200, { ok: true });
    }

    if (req.url !== '/api/realtime-session' && req.url !== '/api/describe-image') throw new HttpError(404, 'Not found');
    if (!apiKey) throw new HttpError(500, 'OPENAI_API_KEY is not set. Add it to .env and restart the dev server.');

    if (req.url === '/api/realtime-session') {
      await readJson(req, 16 * 1024);
      const r = await openai('realtime/client_secrets', {
        expires_after: { anchor: 'created_at', seconds: 600 },
        session: {
          type: 'realtime',
          model: realtimeModel,
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: 24000 },
              transcription: { model: 'gpt-4o-mini-transcribe' },
              turn_detection: { type: 'server_vad', interrupt_response: true, create_response: true },
            },
            output: {
              format: { type: 'audio/pcm', rate: 24000 },
              voice: defaultVoice,
            },
          },
        },
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new HttpError(r.status, describeOpenAIError(r.status, data));
      return reply(res, 200, { value: data.value, model: realtimeModel, voiceStyle });
    }

    // /api/describe-image: only inline images, capped at 10 MB.
    const body = await readJson(req, 14 * 1024 * 1024);
    const dataUrl = cleanString(body.dataUrl, 14 * 1024 * 1024);
    if (!dataUrl || !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(dataUrl)) throw new HttpError(400, 'dataUrl must be a base64 image');
    const r = await openai('responses', {
      model: visionModel,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: 'You are an AI assistant generating alt text for a document. Summarize this image or chart concisely (1-2 sentences max) so a listener understands what it shows. Clarify that it is an image/object.' },
          { type: 'input_image', image_url: dataUrl },
        ],
      }],
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new HttpError(r.status, describeOpenAIError(r.status, data));
    return reply(res, 200, { text: data.output_text ?? data.output?.flatMap((o: any) => o.content || []).find((c: any) => c.type === 'output_text')?.text ?? '' });
  };

  // Turns OpenAI's error responses into something a first-time user can act on.
  const describeOpenAIError = (status: number, data: any) => {
    const msg = data?.error?.message || `OpenAI returned HTTP ${status}`;
    if (status === 401) return 'OpenAI rejected the API key. Check OPENAI_API_KEY in .env, then restart the dev server.';
    if (status === 429 && /quota|billing|credit/i.test(msg)) return 'Your OpenAI account has no credit left. Add credit under Settings → Billing on platform.openai.com.';
    return msg;
  };

  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/')) return next();
    try {
      checkCaller(req);
      await handle(req, res);
    } catch (err: any) {
      if (!res.headersSent) reply(res, err instanceof HttpError ? err.status : 502, { error: err?.message || String(err) });
    }
  };

  return {
    name: 'openai-api',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), openaiApi(env)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Set DISABLE_HMR=true to stop live reloading, e.g. while an agent is editing files mid-review.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
