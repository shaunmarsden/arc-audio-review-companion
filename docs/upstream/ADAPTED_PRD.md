# Audio Review Companion: Adapted Phased PRD

## Product Goal
Audio Review Companion is a mobile-first web app adapted from the Thia architecture. It reads parsed documents aloud in chunks, allows natural voice interruption via the Gemini Live API, captures spoken comments ("notes"), and gracefully resumes reading. The tool acts as a classical audio orchestrator rather than a creative ideation partner.

## Core Architecture Modifications
- **Voice Layer (Gemini Live)**: Leverages the existing `GeminiLiveService` to manage real-time interactions over small chunks. Instead of holding long-term conversational memory or ideating, the agent is strictly tasked with reading text, handling interruptions, and logging comments.
- **App State**: The React application retains the source of truth. It tracks the `currentChunkIndex` and forces the Gemini session to stay focused on the immediate text.
- **Comment Capture**: The existing `capture_idea` tool is repurposed to save structured "Notes" tied directly to the current `chunkId` and `section`.

## Phased Delivery

### Phase 1: Core Engine with Dummy Content (COMPLETED)
**Goal**: Prove the reading and interruption loop with static dummy content.
- **Implementation**:
  - `dummyData.ts` holds a short sample document broken into chunks.
  - The System Prompt (`thia_system_instruction.md`) is updated to shift the agent's persona to an Audio Review Assistant.
  - The `App.tsx` layout is simplified to a mobile-first player UI.
  - Hitting "Play" connects to the existing `GeminiLiveService`. The active chunk text is fed into the session securely.
  - The `CapturedIdeas` structure has been enriched to save the `chunkId` and `section` alongside the captured note.

### Phase 2: Google Docs Ingestion & UI Polish
**Goal**: Swap static data for real Google Doc parsing and refine the frontend.
- Provide a setup screen to input a Google Doc link or upload a file.
- Implement chunking logic that honors headings, paragraphs, and sections into `DocChunk` formats.
- Connect existing standard player controls (scrubbing, sections, pausing).
- Display a robust list of captured notes connected securely to the live index.

### Phase 3: Robust Persistence
**Goal**: Allow sessions to survive reloads.
- Store the active document metadata, chunk structures, and playback indices in `localStorage` or `IndexedDB`.
- Automatically recover connections and playback state upon app reload.

### Phase 4: Batch Export / Google Docs Sync
**Goal**: Transform captured notes into proper Google Docs artifacts.
- Develop a batch export tool.
- Provide a JSON format to easily map captured timestamped notes (with their `chunkId`) back into proper anchored Google Comments via the Google Docs API.
