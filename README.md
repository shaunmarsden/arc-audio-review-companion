# Audio Review Companion (ARC)

> **Fork note:** this fork replaces the Gemini Live voice layer with the **OpenAI Realtime API** (`gpt-realtime`) and image alt-text with the OpenAI Responses API. The API key stays server-side: the Vite dev server mints short-lived Realtime tokens at `/api/realtime-session`. Upstream: [heen2001/arc-audio-review-companion](https://github.com/heen2001/arc-audio-review-companion).

**Audio Review Companion (ARC)** is an voice-first document review companion designed to read Google documents aloud, capture verbal comments, and seamlessly synchronize feedback back to the documents. Ideal for agents to act on these comments.  

By leveraging real-time voice and multimodal AI via **Google AI Studio**, ARC acts as an active, hands-free reviewer. It follows the structure of your documents while adapting to verbal instructions—allowing you to comment, pause, request re-reads of specific sentences, or resume flows organically.

![Screenshot of Thia screen in dark mode](https://github.com/user-attachments/assets/6be11c3f-c6cc-4366-867a-2951e56278e0)
---

## 🚀 Key Features

- **Hands-Free Document Audio Flow**: ARC loads ypur document and reads sections aloud while synchronizing with the active view on your screen.
- **Section Announcements**: ARC automatically announces the section title (e.g., *"Section 1: Executive Summary"*) whenever it transitions to a new section, keeping the reviewer aligned with the text.
- **On-the-Fly Comments & Ideas**: Capture comments and thoughts instantly. Say *"Add a comment that the budget here needs review"* or *"Note that we should expand this point"*, and ARC uses the `capture_idea` tool to save your thought to the permanent log without interrupting the session.
- **Micro-Interruption Resumption**: Ask ARC to re-read a sentence or explain a paragraph. Once the request is handled, the session automatically transitions back to document flow without requiring a manual "continue" command.
- **Indefinite Pause/Stop Detection**: Uses natural language analysis to detect phrases like *"pause"*, *"stop"*, or *"wait"* to halt playback immediately and pause the audio stream.
- **Smart End-of-Document Flow**: Once the final section is read completely, ARC announces that it has finished, asks if there are any final feedback points to capture, and gracefully closes the playback session to turn off the microphone.

---

## 🛠️ How to Use This Project

### 1. Remix in Google AI Studio
You can play with the prompts, voice controls, and configuration without any local environment:
1. Open the [AI Studio Share Link](https://ai.studio/apps/5628f004-2db5-427b-b24b-90c789c3c3ef).
2. Select **"Remix"** to duplicate the template in your own Google AI Studio account.

### 2. Running Locally for Developers
To build upon or customize ARC:

1. **Clone the repository** to your local machine.
2. Ensure you have **Node.js** installed.
3. Install the dependencies:
   ```bash
   npm install
   ```
4. Create a `.env` file in the root directory (using `.env.example` as a template) and add your [OpenAI API key](https://platform.openai.com/api-keys). Firebase is optional and only needed to load and comment on Google Docs; without it you can use the sample document or upload PDF/DOCX/TXT files:
   ```env
   OPENAI_API_KEY=your_openai_api_key_here

   # Firebase Setup (optional for local deployment)
   VITE_FIREBASE_API_KEY=your_firebase_api_key
   VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your_project_id
   VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=your_id
   VITE_FIREBASE_APP_ID=your_app_id
   ```
5. Run the local development server:
   ```bash
   npm run dev
   ```

---

## ⚖️ License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.
