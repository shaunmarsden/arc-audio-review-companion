# Audio Review Companion (ARC)

ARC reads your documents aloud and lets you review them by voice. You interrupt whenever you like: to leave a comment, ask what a paragraph means, jump to another section, or have something re-read. Your spoken comments are saved against the section they refer to.

It's built for reviewing work without staring at it: sit back, put headphones on, and listen.

**What you need:** a laptop or desktop, Node.js 20+, and an OpenAI API key. ARC is tested in Chrome; Edge, Firefox and Safari should work but haven't been tested yet. ARC runs on your own computer and is used from the same computer. It doesn't work from a phone yet, because browsers only allow microphone access on `localhost` or over HTTPS.

> This is a fork of [heen2001/arc-audio-review-companion](https://github.com/heen2001/arc-audio-review-companion), which runs on Google Gemini. This version runs on the **OpenAI Realtime API** and adds file upload, skim mode and a British English voice. Credit for the original design and app goes to the upstream author.

![ARC screens](assets/arc_screens.png)

---

## Quick start

You need [Node.js](https://nodejs.org/) 20 or later and an [OpenAI API key](https://platform.openai.com/api-keys). The API key is billed separately from ChatGPT, so add some credit under **Settings → Billing** on the OpenAI platform first. It's worth setting a monthly budget limit there too.

```bash
git clone https://github.com/shaunmarsden/arc-audio-review-companion.git
cd arc-audio-review-companion
npm install
cp .env.example .env
```

Open `.env` and paste your key after `OPENAI_API_KEY=`, then start the app:

```bash
npm run dev
```

Open **http://localhost:3000**, choose a file (or open the sample), press play and allow microphone access.

Headphones help. Without them ARC can hear itself through your speakers and stop mid-sentence.

If something goes wrong (no key, a rejected key, no credit, the microphone blocked), ARC shows a message above the controls explaining what to do.

---

## Using it

**Load a document**: upload a PDF, Word (`.docx`), Markdown or text file. Headings become sections, and long sections are split into parts. Documents exported from Word or Google Docs (**File → Download → Microsoft Word**) work best.

**Talk to it** at any point:

| Say | What happens |
|---|---|
| "Add a comment that…" / "Make a note that…" | Saves a comment against the current section |
| "Read that properly" | Reads the current section word for word |
| "Switch to full reading" / "Go back to skimming" | Changes how the rest of the document is read |
| "Go back a section" / "Skip to section 4" / "Go to Funding" | Moves around the document |
| "What does that mean?" / "Read that sentence again" | Explains or re-reads, then carries on |
| "Stop" | Ends the session |

**Skim or full**: by default ARC *skims*, giving the gist of each section in two or three sentences. Switch to *full* for a word-for-word read. There's also a **Skim / Full** toggle next to the section counter; it applies from the next section.

**Interrupting**: just start talking. ARC stops, deals with what you asked, then picks up from the sentence it was on. Saying "pause", "stop", "hold on" or "hang on" stops it moving on to the next section until you say "carry on".

**Comments** appear in the notes panel (the speech-bubble button, bottom right). **Download comments** saves them as a Word file, grouped by section. (If you've connected a Google Doc, the button posts them to the doc as comments instead.) Loading a new document clears the current comments, so download them first.

**Long sessions**: OpenAI limits how long one voice session can last. If it ends, or your connection drops, ARC tells you, and pressing play carries on from the current section.

---

## Configuration

Everything goes in `.env`. Only `OPENAI_API_KEY` is required.

| Setting | Default | What it does |
|---|---|---|
| `OPENAI_API_KEY` | — | Your OpenAI key. Used only by the local server, never sent to the browser. |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime` | The voice model |
| `OPENAI_VOICE` | `marin` | Base voice (others include `cedar`, `sage`, `alloy`) |
| `OPENAI_VOICE_STYLE` | British English accent | Accent and style instruction. Set it empty to use the voice's natural accent. |
| `OPENAI_VISION_MODEL` | `gpt-5-mini` | Describes images found in Google Docs |

## Privacy, security and cost

- **What's sent where:** the document text, your voice, and any images in Google Docs go to OpenAI to run the session. Don't load anything you wouldn't send to OpenAI. Nothing else leaves your computer: fonts and the PDF reader are bundled, so there are no CDN requests. The only exception is the optional Google Docs sign-in, which talks to Google.
- **Your API key** stays on your machine, in `.env`. The browser only gets a short-lived session token.
- **The local server** listens on `localhost` only, so nobody else on your network can reach it. Its API refuses requests from other websites (it checks the Host, Origin and Content-Type headers), so a page you visit while ARC is running can't use your key or touch your notes.
- **Comments** are kept in your browser's local storage, and in `inbox/notes.json` for the agent hand-off. Both stay on your computer.
- **Cost:** OpenAI bills the Realtime API by audio minutes, and skim mode uses much less than full reading. Check [OpenAI's pricing](https://openai.com/api/pricing/) for current rates, and set a budget limit on your OpenAI account.

---

## Optional extras

### Google Docs sign-in

ARC can load Google Docs directly and post your comments back as native Google Docs comments. It needs a Firebase project with Google sign-in turned on, plus the Google Docs and Drive APIs enabled on the same Google Cloud project. Put your Firebase web config in the `VITE_FIREBASE_*` lines of `.env` and the **Google doc loader** card appears on the start screen. Without this config, the card is hidden and upload works as normal.

Be aware that sign-in asks for **full Google Drive access** (posting comments needs it), and the Google access token is kept in the browser's local storage until you sign out. It expires after about an hour.

### Hand-off from Claude Code (or any AI agent)

ARC watches a local `inbox/` folder (not committed to git), so an AI assistant with access to your documents can queue a document for you and read your comments back:

- **Load a doc**: write `inbox/doc.json` as `{"title": "...", "loadedAt": "<timestamp>", "chunks": [{"id": "c1", "section": "Intro", "text": "..."}]}`. ARC opens it the next time the page loads. Changing `loadedAt` loads it again.
- **Read comments**: comments are saved to `inbox/notes.json`, grouped by document title.

For example, ask Claude Code with a Google Drive connector to "load my latest business case into ARC", review it by voice, then ask "what notes did I leave?".

---

## How it works

- **Voice**: [`src/services/openaiRealtimeService.ts`](src/services/openaiRealtimeService.ts) streams 24kHz audio to and from the OpenAI Realtime API over WebSocket. Speech detection runs on OpenAI's side, which is what lets you interrupt ARC.
- **Tools**: the model calls `capture_idea`, `change_section`, `set_reading_mode` and `stop_playback` to control the app. The app tracks which section you're on.
- **Behaviour**: ARC's instructions are in [`src/prompts/arc_system_instruction.md`](src/prompts/arc_system_instruction.md).
- **Server**: a small Vite middleware in [`vite.config.ts`](vite.config.ts) creates the session tokens, describes images, and runs the `inbox/` hand-off. It also serves `npm run preview`.

## Development

```bash
npm run lint   # type-check
npm test       # unit tests
npm run build  # production build
```

The same checks run on every push via GitHub Actions.

## Licence

MIT. See [LICENSE](LICENSE). Original work by [heen2001](https://github.com/heen2001/arc-audio-review-companion).
