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

  const readJson = (req: IncomingMessage) => new Promise<any>((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
  });
  const reply = (res: ServerResponse, status: number, data: any) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  };
  const openai = (endpoint: string, payload: any) => fetch(`https://api.openai.com/v1/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  // Local hand-off folder: Claude drops a doc in inbox/doc.json, ARC writes captured notes to inbox/notes.json.
  const inboxDir = path.resolve(__dirname, 'inbox');

  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.method === 'GET' && req.url === '/api/inbox') {
      const file = path.join(inboxDir, 'doc.json');
      if (!fs.existsSync(file)) return reply(res, 404, { error: 'No doc in inbox' });
      return reply(res, 200, JSON.parse(fs.readFileSync(file, 'utf8')));
    }
    if (req.method === 'POST' && req.url === '/api/notes') {
      const body = await readJson(req);
      fs.mkdirSync(inboxDir, { recursive: true });
      fs.writeFileSync(path.join(inboxDir, 'notes.json'), JSON.stringify({ ...body, savedAt: new Date().toISOString() }, null, 2));
      return reply(res, 200, { ok: true });
    }
    if (req.method !== 'POST' || !req.url?.startsWith('/api/')) return next();
    if (!apiKey) return reply(res, 500, { error: 'OPENAI_API_KEY is not set. Add it to .env and restart the dev server.' });
    const body = await readJson(req);

    try {
      if (req.url === '/api/realtime-session') {
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
                voice: body.voice || defaultVoice,
              },
            },
          },
        });
        const data = await r.json();
        if (!r.ok) return reply(res, r.status, { error: data.error?.message || 'Failed to mint realtime token' });
        return reply(res, 200, { value: data.value, model: realtimeModel, voiceStyle });
      }

      if (req.url === '/api/describe-image') {
        const r = await openai('responses', {
          model: visionModel,
          input: [{
            role: 'user',
            content: [
              { type: 'input_text', text: 'You are an AI assistant generating alt text for a document. Summarize this image or chart concisely (1-2 sentences max) so a listener understands what it shows. Clarify that it is an image/object.' },
              { type: 'input_image', image_url: body.dataUrl },
            ],
          }],
        });
        const data = await r.json();
        if (!r.ok) return reply(res, r.status, { error: data.error?.message || 'Image description failed' });
        return reply(res, 200, { text: data.output_text ?? data.output?.flatMap((o: any) => o.content || []).find((c: any) => c.type === 'output_text')?.text ?? '' });
      }
    } catch (err: any) {
      return reply(res, 502, { error: err?.message || String(err) });
    }
    next();
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
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
