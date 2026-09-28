import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { randomBytes, randomInt, timingSafeEqual } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import qrcode from 'qrcode-terminal';
import type { IncomingMessage, ServerResponse } from 'http';
import {defineConfig, loadEnv, type Plugin} from 'vite';
import {
  DEFAULT_REALTIME_MODEL, DEFAULT_VISION_MODEL, DEFAULT_VOICE, DEFAULT_VOICE_STYLE,
  realtimeClientSecretRequest, imageDescriptionRequest, outputText, describeOpenAIError,
} from './src/lib/openaiConfig';

// Server-side OpenAI endpoints so OPENAI_API_KEY never reaches the browser bundle.
// In phone mode (`npm run dev:phone`) the server is reachable from the local network, so every
// device other than this computer must unlock the API with a passcode shown in the terminal.
function openaiApi(env: Record<string, string>, phoneMode: boolean): Plugin {
  const apiKey = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY;
  const realtimeModel = env.OPENAI_REALTIME_MODEL || DEFAULT_REALTIME_MODEL;
  const visionModel = env.OPENAI_VISION_MODEL || DEFAULT_VISION_MODEL;
  const defaultVoice = env.OPENAI_VOICE || DEFAULT_VOICE;
  const voiceStyle = env.OPENAI_VOICE_STYLE ?? DEFAULT_VOICE_STYLE;

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
  // Phone mode also accepts private network addresses (and .local names). A DNS-rebinding
  // attacker's page would carry its own domain in the Host header, so it is still refused.
  const LAN_HOST = /^(10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|[a-z0-9-]+\.local)(:\d+)?$/i;
  const checkCaller = (req: IncomingMessage) => {
    // HTTP/2 (used for HTTPS in phone mode) carries the host in :authority rather than Host.
    const host = String(req.headers.host || req.headers[':authority'] || '');
    if (!LOCAL_HOST.test(host) && !(phoneMode && LAN_HOST.test(host))) throw new HttpError(403, 'Forbidden host');
    // Requests from a web page must come from ARC's own page (same origin), not another website.
    const origin = req.headers.origin;
    if (origin) {
      let originHost = '';
      try { originHost = new URL(origin).host; } catch {}
      if (originHost.toLowerCase() !== host.toLowerCase()) throw new HttpError(403, 'Forbidden origin');
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Forbidden');
    if (req.method === 'POST' && !(req.headers['content-type'] || '').startsWith('application/json')) {
      throw new HttpError(415, 'Content-Type must be application/json');
    }
  };

  // --- Phone mode passcode ---
  const passcode = /^\d{6,12}$/.test(env.ARC_PASSCODE || '') ? env.ARC_PASSCODE : String(randomInt(0, 1_000_000)).padStart(6, '0');
  const sessions = new Set<string>();
  const failures = new Map<string, { count: number; lockedUntil: number }>();
  const isLoopback = (req: IncomingMessage) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '');
  const sessionFromCookie = (req: IncomingMessage) =>
    (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith('arc_session='))?.slice('arc_session='.length);
  const isUnlocked = (req: IncomingMessage) => isLoopback(req) || (phoneMode && sessions.has(sessionFromCookie(req) || ''));
  const passcodeMatches = (given: string) => {
    if (!/^\d{1,12}$/.test(given)) return false;
    const a = Buffer.from(given.padEnd(12, ' '));
    const b = Buffer.from(passcode.padEnd(12, ' '));
    return timingSafeEqual(a, b) && given.length === passcode.length;
  };
  const unlock = async (req: IncomingMessage, res: ServerResponse) => {
    const ip = req.socket.remoteAddress || 'unknown';
    const f = failures.get(ip) ?? { count: 0, lockedUntil: 0 };
    if (Date.now() < f.lockedUntil) throw new HttpError(429, 'Too many wrong passcodes. Try again in a few minutes.');
    const body = await readJson(req, 4 * 1024);
    const given = typeof body.passcode === 'string' ? body.passcode.replace(/\s/g, '') : '';
    if (!passcodeMatches(given)) {
      f.count += 1;
      if (f.count >= 5) { f.lockedUntil = Date.now() + 5 * 60_000; f.count = 0; }
      failures.set(ip, f);
      throw new HttpError(401, 'Wrong passcode. Check the terminal where ARC is running.');
    }
    failures.delete(ip);
    const token = randomBytes(32).toString('hex');
    sessions.add(token);
    res.setHeader('Set-Cookie', `arc_session=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`);
    reply(res, 200, { ok: true });
  };

  const printPhoneInstructions = (port: number) => {
    const ips = Object.values(os.networkInterfaces()).flat()
      .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal)
      .map(i => i.address)
      .filter(a => LAN_HOST.test(a));
    if (ips.length === 0) {
      console.log('\n  ARC phone mode: no Wi-Fi/LAN address found. Connect this computer to a network first.\n');
      return;
    }
    const url = `https://${ips[0]}:${port}`;
    console.log(`\n  ARC phone mode`);
    console.log(`  1. Connect your phone to the same Wi-Fi as this computer.`);
    console.log(`  2. Open ${url} on the phone (or scan the code below).`);
    console.log(`  3. The browser warns the certificate isn't trusted (it's self-signed): choose to continue.`);
    console.log(`  4. Enter the passcode:  ${passcode}\n`);
    qrcode.generate(url, { small: true }, (code: string) => console.log(code.split('\n').map(l => '  ' + l).join('\n')));
    if (ips.length > 1) console.log(`  Other addresses for this computer: ${ips.slice(1).join(', ')}`);
    console.log('');
  };

  // Local hand-off folder: an agent drops a doc in inbox/doc.json, ARC writes captured notes to inbox/notes.json.
  const inboxDir = path.resolve(__dirname, 'inbox');
  const readJsonFile = (file: string) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
  const cleanString = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/api/status') return reply(res, 200, { locked: !isUnlocked(req) });
    if (req.method === 'POST' && req.url === '/api/unlock') return unlock(req, res);
    if (!isUnlocked(req)) throw new HttpError(401, 'Locked: enter the passcode shown in the terminal.');

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
      const r = await openai('realtime/client_secrets', realtimeClientSecretRequest(realtimeModel, defaultVoice));
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new HttpError(r.status, describeOpenAIError(r.status, data));
      return reply(res, 200, { value: data.value, model: realtimeModel, voiceStyle });
    }

    // /api/describe-image: only inline images, capped at 10 MB.
    const body = await readJson(req, 14 * 1024 * 1024);
    const dataUrl = cleanString(body.dataUrl, 14 * 1024 * 1024);
    if (!dataUrl || !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(dataUrl)) throw new HttpError(400, 'dataUrl must be a base64 image');
    const r = await openai('responses', imageDescriptionRequest(visionModel, dataUrl));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new HttpError(r.status, describeOpenAIError(r.status, data));
    return reply(res, 200, { text: outputText(data) });
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
    configureServer(server) {
      server.middlewares.use(middleware);
      if (phoneMode) {
        server.httpServer?.once('listening', () => {
          const address = server.httpServer?.address();
          const port = typeof address === 'object' && address ? address.port : 3443;
          setTimeout(() => printPhoneInstructions(port), 200); // after Vite's own banner
        });
      }
    },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

// Hosted build (GitHub Pages): only ARC's own files and OpenAI may be used by the page, so a key
// pasted into it can't be read by injected third-party scripts or sent anywhere but OpenAI.
const HOSTED_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' https://api.openai.com wss://api.openai.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

export default defineConfig(({mode, command}) => {
  const env = loadEnv(mode, '.', '');
  // `npm run build:web` / `npm run dev:web`: the hosted, bring-your-own-key version.
  const hosted = mode === 'web';
  // `npm run dev:phone`: HTTPS (browsers only allow the microphone on HTTPS or localhost)
  // on the local network, with the passcode gate above.
  const phoneMode = mode === 'phone';
  return {
    base: hosted ? (env.ARC_BASE_PATH || '/arc-audio-review-companion/') : '/',
    define: {
      __APP_VERSION__: JSON.stringify(JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version),
      'import.meta.env.VITE_HOSTED': JSON.stringify(hosted ? 'true' : 'false'),
      // The hosted build never uses Firebase sign-in, so none of that config is bundled.
      ...(hosted ? Object.fromEntries(Object.keys(env).filter(k => k.startsWith('VITE_FIREBASE_')).map(k => [`import.meta.env.${k}`, '""'])) : {}),
    },
    plugins: [
      react(),
      tailwindcss(),
      // The hosted build has no server; the local API only exists for `npm run dev` / `dev:phone`.
      ...(hosted ? [] : [openaiApi(env, phoneMode)]),
      ...(phoneMode ? [basicSsl({ name: 'arc-local' })] : []),
      ...(hosted && command === 'build' ? [{
        name: 'arc-hosted-csp',
        transformIndexHtml: (html: string) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${HOSTED_CSP}" />`),
      }] : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      fs: {
        // Keep Vite's defaults (.env files, certificates) and also refuse to serve the agent hand-off
        // folder and git internals as static files; notes and docs are only reachable through the API.
        deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/inbox/**'],
      },
      // Set DISABLE_HMR=true to stop live reloading, e.g. while an agent is editing files mid-review.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
