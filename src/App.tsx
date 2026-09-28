import React, { useState, useRef, useEffect } from 'react';
import { OpenAIRealtimeService, INPUT_SAMPLE_RATE } from './services/openaiRealtimeService';
import { Document, Packer, Paragraph, TextRun, ImageRun } from 'docx';
import { saveAs } from 'file-saver';
import systemInstructionMarkdown from './prompts/arc_system_instruction.md?raw';
// Import custom UI components
import { LoadScreenSignedOut, LoadScreenSignedIn, PlaybackScreen, UnlockScreen } from './components/ArcScreens';
import { floatTo16BitPCM, arrayBufferToBase64 } from './lib/audioUtils';
import { fileToChunks } from './lib/fileToChunks';

// Inline resample function since it's missing from audioUtils
function resample(audioBuffer: Float32Array, targetSampleRate: number, currentSampleRate: number) {
  if (targetSampleRate === currentSampleRate) return audioBuffer;
  const ratio = currentSampleRate / targetSampleRate;
  const newLength = Math.round(audioBuffer.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    if (index + 1 < audioBuffer.length) {
      result[i] = audioBuffer[index] * (1 - fraction) + audioBuffer[index + 1] * fraction;
    } else {
      result[i] = audioBuffer[index];
    }
  }
  return result;
}

interface CapturedIdea {
  id: string;
  text: string;
  timestamp: Date;
  source: 'user' | 'arc';
  imageUrl?: string;
  isImageMirrored?: boolean;
  chunkId?: string;
  section?: string;
  synced?: boolean;
}

import { DUMMY_DOC, DocChunk } from './dummyData';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth';
// Initialize Firebase safely by checking environment variables first, falling back to optional JSON
const env = (import.meta as any).env || {};
const configGlob = (import.meta as any).glob('../firebase-applet-config.json', { eager: true });
const staticConfig = (Object.values(configGlob)[0] as any)?.default || {};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || staticConfig.apiKey || "",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || staticConfig.authDomain || "",
  projectId: env.VITE_FIREBASE_PROJECT_ID || staticConfig.projectId || "",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || staticConfig.storageBucket || "",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || staticConfig.messagingSenderId || "",
  appId: env.VITE_FIREBASE_APP_ID || staticConfig.appId || ""
};

export const hasFirebaseConfig = !!(firebaseConfig.apiKey && firebaseConfig.apiKey.trim() !== "");

export let firebaseApp: any = null;
export let firebaseAuth: any = null;
export const googleProvider = new GoogleAuthProvider();

if (hasFirebaseConfig) {
  try {
    firebaseApp = initializeApp(firebaseConfig);
    firebaseAuth = getAuth(firebaseApp);
    googleProvider.addScope('https://www.googleapis.com/auth/documents.readonly');
    googleProvider.addScope('https://www.googleapis.com/auth/drive');
    googleProvider.setCustomParameters({
      prompt: 'select_account consent'
    });
  } catch (error) {
    console.error("Failed to initialize Firebase Auth:", error);
  }
}

function extractDocId(input: string): string {
  const match = input.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  return input.trim();
}

async function extractCellText(contentArray: any[], doc?: any): Promise<string> {
  if (!contentArray) return '';
  let text = '';
  for (const element of contentArray) {
    if (element.paragraph) {
      const p = element.paragraph;
      if (p.elements) {
        for (const el of p.elements) {
          if (el.textRun && el.textRun.content) {
            text += el.textRun.content;
          } else if (el.inlineObjectElement && doc) {
            const inlineObj = doc.inlineObjects?.[el.inlineObjectElement.inlineObjectId];
            if (inlineObj) {
               const embedded = inlineObj.inlineObjectProperties?.embeddedObject;
               if (embedded && embedded.imageProperties && embedded.imageProperties.contentUri) {
                  const altText = await generateImageAltText(embedded.imageProperties.contentUri, embedded.title, embedded.description);
                  text += `\n${altText}\n`;
               }
            }
          }
        }
      }
    } else if (element.table) {
      const { markdown } = await parseTableToMarkdown(element.table, true, doc);
      text += '\n' + markdown + '\n';
    }
  }
  return text.trim();
}

async function parseTableToMarkdown(table: any, forceSimple = false, doc?: any): Promise<{ markdown: string; isComplex: boolean }> {
  const rows = table.tableRows || [];
  if (rows.length === 0) return { markdown: '', isComplex: false };

  const rowCount = rows.length;
  let colCount = 0;
  for (const row of rows) {
    colCount = Math.max(colCount, (row.tableCells || []).length);
  }

  // A table is complex if cell count > 4, or columns > 2, or rows > 2 (unless forceSimple is active)
  const isComplex = !forceSimple && (rowCount > 2 || colCount > 2 || (rowCount * colCount) > 4);

  // If it's a 1x1 table (typical for callout boxes / quotes in Docs), format as a blockquote
  if (rowCount === 1 && colCount === 1) {
    const rawContent = await extractCellText(rows[0].tableCells?.[0]?.content, doc);
    return {
      markdown: `> 💡 **Callout:**\n> ${rawContent.replace(/\n/g, '\n> ')}`,
      isComplex: false
    };
  }

  let md = '';
  const parsedRows: string[][] = [];
  for (const row of rows) {
    const cells = row.tableCells || [];
    const parsedCells: string[] = [];
    for (const cell of cells) {
      // Clean cell content and replace inside-cell newlines with spaces to hold markdown structure
      const cellText = await extractCellText(cell.content, doc);
      parsedCells.push(cellText.replace(/\r?\n/g, ' '));
    }
    parsedRows.push(parsedCells);
  }

  if (parsedRows.length > 0) {
    const header = parsedRows[0];
    md += `| ${header.join(' | ')} |\n`;
    md += `| ${header.map(() => '---').join(' | ')} |\n`;
    
    for (let i = 1; i < parsedRows.length; i++) {
      const r = parsedRows[i];
      while (r.length < colCount) r.push('');
      md += `| ${r.join(' | ')} |\n`;
    }
  }

  return { markdown: md, isComplex };
}

function formatInlineMarkdown(text: string): React.ReactNode {
  // Gracefully handles **bold** and *italics*
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} style={{ fontWeight: 600 }}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <span key={i} className="italic">{part.slice(1, -1)}</span>;
    }
    return part;
  });
}

function DocumentTextRenderer({ text }: { text: string }) {
  if (!text) return null;

  const blocks = text.split(/(?:\r?\n){2,}/);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9em' }}>
      {blocks.map((block, bIdx) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        // Render callouts nicely

        if (trimmed.startsWith('>')) {
          const calloutLines = trimmed
            .split('\n')
            .map(line => line.replace(/^>\s*/, '').trim())
            .filter(Boolean);
          
          return (
            <blockquote 
              key={bIdx} 
              style={{
                padding: '14px 16px', borderLeft: '4px solid #4ecdc4', 
                background: 'rgba(78, 205, 196, 0.08)', borderRadius: '0 8px 8px 0',
                fontStyle: 'italic', fontSize: '19px'
              }}
            >
              {calloutLines.map((line, lIdx) => {
                // Remove bold markers for the quote itself if nested since blockquote is already formatted
                const cleanLine = line.replace(/\*\*/g, '');
                return <p key={lIdx} className={lIdx > 0 ? 'mt-2' : ''}>{cleanLine}</p>;
              })}
            </blockquote>
          );
        }

        // Render markdown tables beautifully
        if (trimmed.startsWith('|')) {
          const lines = trimmed.split('\n').filter(line => line.trim().startsWith('|'));
          if (lines.length >= 2) {
            const parsedRows = lines.map(line => {
              return line
                .split('|')
                .slice(1, -1)
                .map(cell => cell.trim());
            });

            const dataRows = parsedRows.filter(row => !row.every(cell => cell.match(/^[-:\s]+$/)));
            
            if (dataRows.length > 0) {
              const header = dataRows[0];
              const body = dataRows.slice(1);

              return (
                <div key={bIdx} style={{ overflowX: 'auto', margin: '20px 0', border: '1px solid rgba(40,30,20,0.1)', borderRadius: 12, boxShadow: '0 1px 2px rgba(40,30,20,0.04)', background: '#fff' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
                    <thead style={{ background: '#f7f5f1', borderBottom: '1px solid rgba(40,30,20,0.08)' }}>
                      <tr>
                        {header.map((cell, cIdx) => (
                          <th key={cIdx} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#1a1a1a' }}>
                            {formatInlineMarkdown(cell)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {body.map((row, rIdx) => (
                        <tr key={rIdx} style={{ borderBottom: rIdx < body.length - 1 ? '1px solid rgba(40,30,20,0.06)' : 'none' }}>
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} style={{ padding: '10px 14px', whiteSpace: 'pre-wrap', color: '#5e5d59' }}>
                              {formatInlineMarkdown(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }
          }
        }

        // Parent structure for complex tables
        if (trimmed.includes('[COMPLEX_TABLE_START]') || trimmed.includes('[COMPLEX_TABLE_END]')) {
          const innerText = trimmed
            .replace('[COMPLEX_TABLE_START]', '')
            .replace('[COMPLEX_TABLE_END]', '')
            .trim();
          
          return (
            <div key={bIdx} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 600, fontFamily: 'monospace', background: 'rgba(78, 205, 196, 0.1)', color: '#16615c', padding: '4px 10px', borderRadius: 6, width: 'fit-content', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ecdc4', animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}></span>
                Complex Table / Reference Data
              </div>
              <DocumentTextRenderer text={innerText} />
            </div>
          );
        }

        return (
          <p key={bIdx} style={{ margin: 0 }}>
            {formatInlineMarkdown(trimmed)}
          </p>
        );
      })}
    </div>
  );
}

// Returned to the model after a comment is saved. Resuming is spelled out here because the model
// otherwise tends to say "Resuming..." and then stop.
export const CAPTURE_SAVED_OUTPUT = "Comment saved. Confirm in a few words (e.g. \"Noted.\"). Then, if you were cut off before finishing the current section, say \"Resuming\" and continue reading from the start of the sentence you were on, in the current reading mode, through to the end of the section. If you had already finished the section, stop speaking.";

const PAUSE_PHRASES = [/\bpause\b/, /\bstop\b/, /\bhold on\b/, /\bhang on\b/];

async function generateImageAltText(imageUrl: string, title?: string, description?: string): Promise<string> {
  const ctxStr = [title, description].filter(Boolean).join(' - ');

  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const base64 = btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));

    const res = await fetch('/api/describe-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: `data:${blob.type || 'image/jpeg'};base64,${base64}` })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);

    const summary = result.text?.trim() || ctxStr || 'Embedded visual content';
    return `*[Image/Object Summary: ${summary}]*`;
  } catch (error) {
    console.error('Error generating image description:', error);
    return `*[Image/Object: ${ctxStr || 'Visual content (could not generate summary)'}]*`;
  }
}

async function parseGoogleDoc(doc: any): Promise<DocChunk[]> {
  const content = doc.body?.content || [];
  const items: Array<{ text: string; isHeading: boolean; title: string; isTable?: boolean; isComplexTable?: boolean }> = [];

  for (const element of content) {
    if (element.paragraph) {
      const p = element.paragraph;
      let text = '';
      if (p.elements) {
        for (const el of p.elements) {
          if (el.textRun && el.textRun.content) {
            text += el.textRun.content;
          } else if (el.inlineObjectElement) {
            const inlineObj = doc.inlineObjects?.[el.inlineObjectElement.inlineObjectId];
            if (inlineObj) {
               const embedded = inlineObj.inlineObjectProperties?.embeddedObject;
               if (embedded && embedded.imageProperties && embedded.imageProperties.contentUri) {
                  const altText = await generateImageAltText(embedded.imageProperties.contentUri, embedded.title, embedded.description);
                  text += `\n${altText}\n`;
               }
            }
          }
        }
      }
      
      const namedStyle = p.paragraphStyle?.namedStyleType || 'NORMAL_TEXT';
      const isHeading = namedStyle.startsWith('HEADING') || namedStyle === 'TITLE' || namedStyle === 'SUBTITLE';
      
      const trimmedText = text.trim();
      if (trimmedText) {
        items.push({
          text: text,
          isHeading: isHeading,
          title: trimmedText
        });
      }
    } else if (element.table) {
      const { markdown, isComplex } = await parseTableToMarkdown(element.table, false, doc);
      if (markdown.trim()) {
        items.push({
          text: isComplex 
            ? `[COMPLEX_TABLE_START]\n${markdown}\n[COMPLEX_TABLE_END]`
            : markdown,
          isHeading: false,
          title: '',
          isTable: true,
          isComplexTable: isComplex
        });
      }
    }
  }

  const chunks: DocChunk[] = [];
  let currentSection = 'Introduction';
  let currentText = '';
  let chunkCount = 1;

  const flushChunk = () => {
    if (currentText.trim()) {
      chunks.push({
        id: `gdoc-${chunkCount++}`,
        section: currentSection,
        text: currentText.trim()
      });
      currentText = '';
    }
  };

  for (const item of items) {
    if (item.isHeading) {
      flushChunk();
      currentSection = item.title;
    } else {
      if (item.isComplexTable) {
        flushChunk();
        chunks.push({
          id: `gdoc-${chunkCount++}`,
          section: `${currentSection} - Complex Table`,
          text: item.text
        });
      } else {
        if (currentText && (currentText.length + item.text.length > 1500)) {
          flushChunk();
          if (!currentSection.endsWith(' (cont.)')) {
            currentSection = `${currentSection} (cont.)`;
          }
        }
        currentText += (currentText ? '\n\n' : '') + item.text;
      }
    }
  }
  flushChunk();

  if (chunks.length === 0) {
    chunks.push({
      id: 'gdoc-empty',
      section: 'Empty Document',
      text: 'No content found in this Google Document.'
    });
  }

  if (chunks.length === 1 && chunks[0].section === 'Introduction' && doc.title) {
    chunks[0].section = doc.title;
  }

  return chunks;
}

import { ConfirmDialog } from './components/ConfirmDialog';

export default function App() {
  // In phone mode, other devices must unlock the local API with a passcode first.
  const [apiLocked, setApiLocked] = useState(false);
  useEffect(() => {
    fetch('/api/status').then(r => r.ok ? r.json() : null).then(d => setApiLocked(!!d?.locked)).catch(() => {});
  }, []);
  const [screenState, setScreenState] = useState<'start' | 'player'>(() => {
    if (typeof window === 'undefined') return 'start';
    const saved = window.localStorage.getItem('review_session');
    return saved ? 'player' : 'start';
  });
  const [showConfirmReload, setShowConfirmReload] = useState(false);
  const [docChunks, setDocChunks] = useState<DocChunk[]>(() => {
    if (typeof window === 'undefined') return DUMMY_DOC;
    const saved = window.localStorage.getItem('review_session');
    return saved ? JSON.parse(saved).docChunks : DUMMY_DOC;
  });
  const [currentChunkIndex, setCurrentChunkIndex] = useState(() => {
    if (typeof window === 'undefined') return 0;
    const saved = window.localStorage.getItem('review_session');
    return saved ? JSON.parse(saved).currentChunkIndex : 0;
  });
  const currentChunk = docChunks[currentChunkIndex] || { id: 'empty', section: 'No Document', text: '' };

  const [googleUser, setGoogleUser] = useState<any | null>(() => {
    if (typeof window === 'undefined') return null;
    const profile = window.localStorage.getItem('oauth_user_profile');
    return profile ? JSON.parse(profile) : null;
  });
  const [authToken, setAuthToken] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem('oauth_auth_token');
  });
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [loadedDocTitle, setLoadedDocTitle] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const saved = window.localStorage.getItem('review_session');
    return saved ? JSON.parse(saved).docTitle : null;
  });
  const [loadedDocId, setLoadedDocId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const saved = window.localStorage.getItem('review_session');
    return saved ? JSON.parse(saved).docId : null;
  });
  const [docUrlInput, setDocUrlInput] = useState('');

  const docChunksRef = useRef<DocChunk[]>(docChunks);
  const currentChunkIndexRef = useRef<number>(currentChunkIndex);

  useEffect(() => {
    docChunksRef.current = docChunks;
  }, [docChunks]);

  useEffect(() => {
    currentChunkIndexRef.current = currentChunkIndex;
  }, [currentChunkIndex]);

  const cleanSectionHeading = (rawSection: string | undefined): string => {
    if (!rawSection) return 'General';
    return rawSection
      .replace(/\s*\(cont\.\)/i, '')
      .replace(/\s*-\s*Complex Table/i, '')
      .trim();
  };

  const loadSampleDoc = () => {
    playingSourcesRef.current.forEach(source => { try { source.stop(); } catch(e) {} });
    playingSourcesRef.current = [];
    hasPlayedAudioForSectionRef.current = false;
    isTurnCompleteRef.current = false;
    wasInterruptedRef.current = false;
    interactionsOccurredForSectionRef.current = false;
    nextPlayTimeRef.current = audioContextRef.current ? audioContextRef.current.currentTime : 0;

    setDocChunks(DUMMY_DOC);
    setLoadedDocTitle("ARC Spec Sample");
    setLoadedDocId(null);
    setCurrentChunkIndex(0);
    isSourceOfSectionChangeRef.current = 'ui';
    setScreenState('player');
  };

  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const loadUploadedDoc = async (file: File) => {
    setUploadLoading(true);
    setUploadError(null);
    try {
      const { title, chunks } = await fileToChunks(file);
      playingSourcesRef.current.forEach(source => { try { source.stop(); } catch(e) {} });
      playingSourcesRef.current = [];
      hasPlayedAudioForSectionRef.current = false;
      isTurnCompleteRef.current = false;
      wasInterruptedRef.current = false;
      interactionsOccurredForSectionRef.current = false;
      nextPlayTimeRef.current = audioContextRef.current ? audioContextRef.current.currentTime : 0;

      setDocChunks(chunks);
      setLoadedDocTitle(title);
      setLoadedDocId(null);
      setCapturedIdeas([]);
      setCurrentChunkIndex(0);
      isSourceOfSectionChangeRef.current = 'ui';
      setScreenState('player');
    } catch (err: any) {
      console.error('Failed to read uploaded file:', err);
      setUploadError(err?.message || 'Could not read that file.');
    } finally {
      setUploadLoading(false);
    }
  };

  const handleReloadClick = () => {
    setShowConfirmReload(true);
  };

  const confirmReloadNewDoc = () => {
    stopLiveSession();
    setCapturedIdeas([]);
    setLoadedDocTitle(null);
    setLoadedDocId(null);
    setCurrentChunkIndex(0);
    setScreenState('start');
    setShowConfirmReload(false);
  };

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSuccessMessage, setSyncSuccessMessage] = useState<string | null>(null);

  const syncCommentsToDoc = async () => {
    if (!authToken || !loadedDocId) {
       setSyncError("Not connected to a Google Doc or not logged in.");
       return;
    }
    const unsyncedIdeas = capturedIdeas.filter(idea => !idea.synced);
    if (unsyncedIdeas.length === 0) return;

    setIsSyncing(true);
    setSyncError(null);
    setSyncSuccessMessage(null);
    try {
      // Create clean native Google Doc sidebar comments with structured classification format
      const sidebarPromises = unsyncedIdeas.map(async (idea) => {
         const commentBody: any = {
            content: `📌 ARC [${idea.section || 'General'}]: ${idea.text}`
         };

         const commentRes = await fetch(`https://www.googleapis.com/drive/v3/files/${loadedDocId}/comments?fields=*`, {
            method: 'POST',
            headers: {
               Authorization: `Bearer ${authToken}`,
               'Content-Type': 'application/json'
            },
            body: JSON.stringify(commentBody)
         });

         if (!commentRes.ok) {
            if (commentRes.status === 403) {
               throw new Error("Permission denied from Google Drive. Ensure you have edit permissions on the document.");
            }
            throw new Error(`Google API Sidebar Error (${commentRes.status})`);
         }

         return idea.id;
      });

      // Run parallel side posting
      await Promise.all(sidebarPromises);
      
      setCapturedIdeas(prev => prev.map(idea => ({ ...idea, synced: true })));
      setSyncSuccessMessage("Comments successfully posted to the Google Doc sidebar!");
      setTimeout(() => setSyncSuccessMessage(null), 5000);

    } catch (err: any) {
       console.error("Sync error:", err);
       if (err.message && (err.message.includes('401') || err.message.includes('403') || err.message.includes('Access denied'))) {
         handleGoogleSignOut();
       }
       setSyncError(err.message || "Failed to post comments");
       setTimeout(() => setSyncError(null), 5000);
    } finally {
       setIsSyncing(false);
    }
  };

  // Listen to Firebase Auth state on mount
  useEffect(() => {
    if (!firebaseAuth) {
      // Local fallback mode when Firebase isn't initialized or configured yet
      if (typeof window !== 'undefined') {
        const storedProfile = window.localStorage.getItem('oauth_user_profile');
        if (storedProfile) {
          try {
            setGoogleUser(JSON.parse(storedProfile));
          } catch (e) {}
        }
        const storedToken = window.localStorage.getItem('oauth_auth_token');
        if (storedToken) {
          setAuthToken(storedToken);
        }
      }
      return () => {};
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
      if (user) {
        const profile = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
        };
        setGoogleUser(profile);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('oauth_user_profile', JSON.stringify(profile));
          const storedToken = window.localStorage.getItem('oauth_auth_token');
          if (storedToken) {
            setAuthToken(storedToken);
          }
        }
      } else {
        // NOTE: In nested previews (iframes), onAuthStateChanged may trigger with null
        // because cookie third-party restrictions can temporarily limit active SDK session checks.
        // We do NOT clear localStorage here automatically on mount null.
        // Credentials are only wiped on explicit user Sign Out or token expiration (401/403 responses).
      }
    });
    return () => unsubscribe();
  }, []);

  const handleGoogleSignIn = async () => {
    setIsLoggingIn(true);
    setDocError(null);
    if (!firebaseAuth) {
      setDocError("Firebase configuration is missing.");
      setIsLoggingIn(false);
      return;
    }
    try {
      const result = await signInWithPopup(firebaseAuth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setAuthToken(credential.accessToken);
        const profile = {
          uid: result.user.uid,
          email: result.user.email,
          displayName: result.user.displayName,
          photoURL: result.user.photoURL,
        };
        setGoogleUser(profile);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('oauth_auth_token', credential.accessToken);
          window.localStorage.setItem('oauth_user_profile', JSON.stringify(profile));
        }
        setDocError(null);
      } else {
        throw new Error('No access token returned from Google Sign-In.');
      }
    } catch (error: any) {
      console.error('Google Sign-In Error:', error);
      if (error.code === 'auth/popup-closed-by-user') {
        setDocError('Sign-in cancelled. You closed the sign-in popup.');
      } else {
        setDocError(error.message || 'Failed to authenticate with Google.');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleSignOut = async () => {
    try {
      if (firebaseAuth) {
        await signOut(firebaseAuth);
      }
      setGoogleUser(null);
      setAuthToken(null);
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('oauth_auth_token');
        window.localStorage.removeItem('oauth_user_profile');
        window.localStorage.removeItem('review_session');
      }
      setLoadedDocTitle(null);
      setDocChunks(DUMMY_DOC);
      setCurrentChunkIndex(0);
    } catch (error) {
      console.error('Sign-out error:', error);
    }
  };

  const loadGoogleDoc = async (inputUrl: string) => {
    if (!authToken) {
      setDocError('Please connect your Google account first.');
      return;
    }
    
    const docId = extractDocId(inputUrl);
    if (!docId) {
      setDocError('Please enter a valid Google Document URL or ID.');
      return;
    }

    setDocLoading(true);
    setDocError(null);

    try {
      const res = await fetch(`https://docs.googleapis.com/v1/documents/${docId}`, {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('Access denied. Please reconnect your Google account to authorize access to this document.');
        }
        throw new Error(`Failed to fetch document (Status Code: ${res.status}). Verify the document URL/ID matches a valid Google Document, or has been shared with you.`);
      }

      const docData = await res.json();
      const chunks = await parseGoogleDoc(docData);
      
      // Stop voice playback before switching documents
      playingSourcesRef.current.forEach(source => { try { source.stop(); } catch(e) {} });
      playingSourcesRef.current = [];
      hasPlayedAudioForSectionRef.current = false;
      isTurnCompleteRef.current = false;
      wasInterruptedRef.current = false;
      interactionsOccurredForSectionRef.current = false;
      nextPlayTimeRef.current = audioContextRef.current ? audioContextRef.current.currentTime : 0;

      setDocChunks(chunks);
      setLoadedDocTitle(docData.title || 'Loaded Google Doc');
      setLoadedDocId(docId);
      isSourceOfSectionChangeRef.current = 'ui';
      setCurrentChunkIndex(0);
      setDocError(null);
      setDocUrlInput('');
      setScreenState('player');
    } catch (err: any) {
      console.error('Error loading Google Doc:', err);
      if (err.message && (err.message.includes('401') || err.message.includes('403') || err.message.includes('Access denied') || err.message.includes('reconnect'))) {
        handleGoogleSignOut();
      }
      setDocError(err.message || 'An unexpected error occurred while loading the Google Document.');
    } finally {
      setDocLoading(false);
    }
  };

  const jumpToSection = (index: number) => {
    if (index < 0 || index >= docChunks.length) return;
    playingSourcesRef.current.forEach(source => { try { source.stop(); } catch(e) {} });
    playingSourcesRef.current = [];
    hasPlayedAudioForSectionRef.current = false;
    isTurnCompleteRef.current = false;
    wasInterruptedRef.current = false;
    interactionsOccurredForSectionRef.current = false;
    nextPlayTimeRef.current = audioContextRef.current ? audioContextRef.current.currentTime : 0;
    isSourceOfSectionChangeRef.current = 'ui';
    setCurrentChunkIndex(index);
  };

  const [showCommentsPanel, setShowCommentsPanel] = useState(false);
  // Live API State
  const [isLiveActive, setIsLiveActive] = useState(false);
  const isLiveActiveRef = useRef(false);
  const isSourceOfSectionChangeRef = useRef<'ui' | 'tool'>('ui');
  const [scrubPage, setScrubPage] = useState(0);

  useEffect(() => {
    isLiveActiveRef.current = isLiveActive;
    // Auto-mute/unmute based on live session state
    if (isLiveActive) {
      setIsMuted(false); // Unmute on start
    } else {
      setIsMuted(true); // Mute on stop/pause
    }
  }, [isLiveActive]);

  useEffect(() => {
    setScrubPage(Math.floor(currentChunkIndex / 10));
  }, [currentChunkIndex]);

  const [isArcSpeaking, setIsArcSpeaking] = useState(false);
  const speakingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const isMutedRef = useRef(true);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);
  
  const liveServiceRef = useRef<OpenAIRealtimeService | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const playingSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  // Keeps a phone's screen on during a session; a locked screen suspends the audio.
  const wakeLockRef = useRef<any>(null);
  const audioWorkletRef = useRef<ScriptProcessorNode | null>(null);
  const hasPlayedAudioForSectionRef = useRef<boolean>(false);
  const isTurnCompleteRef = useRef<boolean>(false);
  const wasInterruptedRef = useRef<boolean>(false);
  const interactionsOccurredForSectionRef = useRef<boolean>(false);
  
  
  const [capturedIdeas, setCapturedIdeas] = useState<CapturedIdea[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = window.localStorage.getItem('review_session');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.capturedIdeas) {
           return parsed.capturedIdeas.map((idea: any) => ({
             ...idea,
             timestamp: new Date(idea.timestamp)
           }));
        }
      }
    } catch(e) {}
    return [];
  });
  
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (screenState === 'player') {
      const sessionData = {
        docId: loadedDocId,
        docTitle: loadedDocTitle,
        docChunks,
        currentChunkIndex,
        capturedIdeas: capturedIdeas.map(idea => ({ ...idea, timestamp: idea.timestamp.toISOString() }))
      };
      window.localStorage.setItem('review_session', JSON.stringify(sessionData));
    } else {
      window.localStorage.removeItem('review_session');
    }
  }, [screenState, loadedDocId, loadedDocTitle, docChunks, currentChunkIndex, capturedIdeas]);

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [readMode, setReadMode] = useState<'skim' | 'full'>(() => {
    try { return window.localStorage.getItem('arc_read_mode') === 'full' ? 'full' : 'skim'; } catch { return 'skim'; }
  });
  const readModeRef = useRef(readMode);
  useEffect(() => {
    readModeRef.current = readMode;
    try { window.localStorage.setItem('arc_read_mode', readMode); } catch {}
  }, [readMode]);

  const readModeInstruction = () => readModeRef.current === 'skim'
    ? 'READING MODE: SKIM. Do not read the text verbatim: announce the section title, then give the gist in 2-3 short spoken sentences, keeping any key figures, names, dates or asks. If the user asks you to read it properly, read the full text verbatim.'
    : 'READING MODE: FULL. Read the text aloud verbatim.';

  const lastSectionInstruction = (index: number, total: number) => index === total - 1
    ? " IMPORTANT: This is the LAST section of the entire document. Once you finish reading it, you MUST clearly announce that you have now concluded reading the entire document, and ask the user if they have any final comments, feedback, or notes to take before stopping."
    : "";

  useEffect(() => {
    if (isLiveActive && liveServiceRef.current) {
      // Reset section tracking state for the new section
      isTurnCompleteRef.current = false;
      hasPlayedAudioForSectionRef.current = false;
      wasInterruptedRef.current = false;
      interactionsOccurredForSectionRef.current = false;
      nextPlayTimeRef.current = audioContextRef.current ? audioContextRef.current.currentTime : 0;

      if (isSourceOfSectionChangeRef.current === 'ui') {
        liveServiceRef.current.sendText(`Please deliver this chunk aloud (Section: ${currentChunk.section}). ${readModeInstruction()} Note: The screen is already synchronized to this section. Directly start without calling change_section or any other tools. IMPORTANT: Always start by announcing the section title (e.g. "Section ${currentChunkIndex + 1}: ${currentChunk.section}").${lastSectionInstruction(currentChunkIndex, docChunks.length)}\n\n${currentChunk.text}`);
      } else {
        // Reset tracking to default 'ui' for future user interaction clicks
        isSourceOfSectionChangeRef.current = 'ui';
      }
    }
  }, [isLiveActive, currentChunkIndex, currentChunk.id]);

  // Tell ARC when the document changes mid-session. The structure at connect time is already in the
  // system instructions, so this only sends later changes, and as context rather than a prompt to speak.
  const announcedDocRef = useRef<DocChunk[] | null>(null);
  useEffect(() => {
    if (!isLiveActive) { announcedDocRef.current = null; return; }
    if (announcedDocRef.current === null) { announcedDocRef.current = docChunks; return; }
    if (announcedDocRef.current === docChunks || !liveServiceRef.current || docChunks.length === 0) return;
    announcedDocRef.current = docChunks;
    liveServiceRef.current.sendContext(`[System Context: Active document structure updated to: "${loadedDocTitle || 'Untitled document'}" with ${docChunks.length} sections. Available indexes for the change_section tool are:\n${docChunks.map((c, i) => `${i}: "${c.section}"`).join('\n')}]`);
  }, [isLiveActive, docChunks, loadedDocTitle]);

  // Navigation
  const nextChunk = () => {
    playingSourcesRef.current.forEach(source => { try { source.stop(); } catch(e) {} });
    playingSourcesRef.current = [];
    hasPlayedAudioForSectionRef.current = false;
    isTurnCompleteRef.current = false;
    wasInterruptedRef.current = false;
    interactionsOccurredForSectionRef.current = false;
    nextPlayTimeRef.current = audioContextRef.current ? audioContextRef.current.currentTime : 0;
    isSourceOfSectionChangeRef.current = 'ui';
    setCurrentChunkIndex(prev => Math.min(docChunksRef.current.length - 1, prev + 1));
  };
  
  const prevChunk = () => {
    playingSourcesRef.current.forEach(source => { try { source.stop(); } catch(e) {} });
    playingSourcesRef.current = [];
    hasPlayedAudioForSectionRef.current = false;
    isTurnCompleteRef.current = false;
    wasInterruptedRef.current = false;
    interactionsOccurredForSectionRef.current = false;
    nextPlayTimeRef.current = audioContextRef.current ? audioContextRef.current.currentTime : 0;
    isSourceOfSectionChangeRef.current = 'ui';
    setCurrentChunkIndex(prev => Math.max(0, prev - 1));
  };

  // Called from audio and session callbacks created once per session, so it must read refs.
  const checkAutoAdvance = () => {
    if (currentChunkIndexRef.current >= docChunksRef.current.length - 1) {
      return;
    }
    if (
      isLiveActiveRef.current &&
      isTurnCompleteRef.current &&
      playingSourcesRef.current.length === 0 &&
      hasPlayedAudioForSectionRef.current &&
      !wasInterruptedRef.current &&
      !interactionsOccurredForSectionRef.current
    ) {
      setTimeout(() => {
        if (
          isLiveActiveRef.current &&
          isTurnCompleteRef.current &&
          playingSourcesRef.current.length === 0 &&
          hasPlayedAudioForSectionRef.current &&
          !wasInterruptedRef.current &&
          !interactionsOccurredForSectionRef.current
        ) {
          nextChunk();
        }
      }, 1500);
    }
  };

  // When each assistant audio item started playing (AudioContext time), so the service can tell
  // OpenAI how much the user actually heard when they interrupt.
  const itemPlaybackStartRef = useRef<Map<string, number>>(new Map());
  const getPlayedMs = (itemId: string) => {
    const ctx = audioContextRef.current;
    const start = itemPlaybackStartRef.current.get(itemId);
    if (!ctx || start === undefined) return 0;
    return Math.max(0, (ctx.currentTime - start) * 1000);
  };

  const playAudioChunk = async (base64Audio: string, itemId?: string) => {
    if (!audioContextRef.current) return;
    const ctx = audioContextRef.current;
    
    try {
      const binaryString = window.atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const pcmData = new Int16Array(bytes.buffer);
      const float32Data = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        float32Data[i] = pcmData[i] / 32768.0;
      }
      
      const audioBuffer = ctx.createBuffer(1, float32Data.length, 24000);
      audioBuffer.getChannelData(0).set(float32Data);
      
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      
      source.connect(ctx.destination);
      
      const startTime = Math.max(ctx.currentTime, nextPlayTimeRef.current);
      const endTime = startTime + audioBuffer.duration;
      source.start(startTime);
      if (itemId && !itemPlaybackStartRef.current.has(itemId)) itemPlaybackStartRef.current.set(itemId, startTime);
      
      nextPlayTimeRef.current = endTime;
      playingSourcesRef.current.push(source);
      hasPlayedAudioForSectionRef.current = true;
      
      source.onended = () => {
        playingSourcesRef.current = playingSourcesRef.current.filter(s => s !== source);
        
        if (speakingTimeoutRef.current) {
          clearTimeout(speakingTimeoutRef.current);
        }
        // Only start the breath 500ms AFTER the actual audio playback finishes
        speakingTimeoutRef.current = setTimeout(() => {
          if (playingSourcesRef.current.length === 0) {
            setIsArcSpeaking(false);
          }
        }, 500);

        if (playingSourcesRef.current.length === 0) {
          checkAutoAdvance();
        }
      };
    } catch (e) {
      console.error("Audio playback error:", e);
    }
  };

  const startLiveSession = async () => {
    if (isLiveActive) {
      stopLiveSession();
      return;
    }

    try {
      // 1. Start Audio
      setMicError(null);
      console.debug("[ARC]", "Starting live session...");
      // Created before any await so it counts as part of the click (Safari only allows audio then).
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser can't use the microphone here. Open ARC at http://localhost:3000 in Chrome, Edge, Firefox or Safari.");
      }
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      micStreamRef.current = micStream;
      setIsMuted(false);

      const liveService = new OpenAIRealtimeService();
      liveServiceRef.current = liveService;

      await liveService.connect({
        onTranscription: (text, role) => {
          if (role === 'user') {
            const cleanText = text.replace(/[^a-zA-Z0-9 ]/g, '').trim().toLowerCase();
            if (cleanText.length > 1) {
              // Only an explicit request to pause halts auto-advance; comments and questions don't.
              // Keep in sync with "Auto-Advancing" in arc_system_instruction.md.
              if (PAUSE_PHRASES.some(re => re.test(cleanText))) {
                interactionsOccurredForSectionRef.current = true;
              }
            }
          }
        },
        getPlayedMs,
        onAudioData: (base64Audio, itemId) => {
          setIsArcSpeaking(true);
          if (playingSourcesRef.current.length === 0) {
            wasInterruptedRef.current = false;
          }
          playAudioChunk(base64Audio, itemId);
          
          if (speakingTimeoutRef.current) {
            clearTimeout(speakingTimeoutRef.current);
          }
        },
        onInterrupted: () => {
          isTurnCompleteRef.current = false;
          wasInterruptedRef.current = true;
          playingSourcesRef.current.forEach(source => {
            try { source.stop(); } catch (e) {}
          });
          playingSourcesRef.current = [];
          nextPlayTimeRef.current = audioContextRef.current?.currentTime || 0;
        },
        onTurnComplete: () => {
          isTurnCompleteRef.current = true;
          checkAutoAdvance();
        },
        onToolCall: (toolCall) => {
          if (toolCall.functionCalls) {
            toolCall.functionCalls.forEach((fc: any) => {
              if (fc.name === 'capture_idea') {
                const idea = typeof fc.args.idea === 'string' ? fc.args.idea.trim() : '';
                if (!idea) {
                  liveServiceRef.current?.sendToolResponse({
                    functionResponses: [{ name: "capture_idea", response: { error: "The comment text was empty, so nothing was saved. Ask the user to repeat it." }, id: fc.id }]
                  });
                  return;
                }

                addIdea(idea, 'arc');
                
                // Send response back immediately
                liveServiceRef.current?.sendToolResponse({
                  functionResponses: [{
                    name: "capture_idea",
                    response: { output: CAPTURE_SAVED_OUTPUT },
                    id: fc.id
                  }]
                });

              } else if (fc.name === 'set_reading_mode') {
                const mode = fc.args.mode === 'full' ? 'full' : 'skim';
                readModeRef.current = mode;
                setReadMode(mode);
                liveServiceRef.current?.sendToolResponse({
                  functionResponses: [{
                    name: "set_reading_mode",
                    response: { output: `Reading mode set to ${mode}. ${readModeInstruction()} Briefly confirm the switch, then deliver the current section (${docChunksRef.current[currentChunkIndexRef.current]?.section}) in this mode: "${docChunksRef.current[currentChunkIndexRef.current]?.text}"` },
                    id: fc.id
                  }]
                });
              } else if (fc.name === 'stop_playback') {
                liveServiceRef.current?.sendToolResponse({
                  functionResponses: [{
                    name: "stop_playback",
                    response: { output: "Playback stopped successfully." },
                    id: fc.id
                  }]
                });
                // Let ARC finish speaking its goodbye (up to 8s) before closing the session.
                const stopAt = Date.now() + 8000;
                const stopWhenQuiet = () => {
                  if (playingSourcesRef.current.length === 0 || Date.now() > stopAt) stopLiveSession();
                  else setTimeout(stopWhenQuiet, 250);
                };
                setTimeout(stopWhenQuiet, 400);
              } else if (fc.name === 'change_section') {
                const index = Number(fc.args.sectionIndex);
                const chunks = docChunksRef.current;
                if (Number.isInteger(index) && index >= 0 && index < chunks.length) {
                  // Stop active playback immediately to be clean
                  playingSourcesRef.current.forEach(source => { try { source.stop(); } catch(e) {} });
                  playingSourcesRef.current = [];
                  hasPlayedAudioForSectionRef.current = false;
                  isTurnCompleteRef.current = false;
                  wasInterruptedRef.current = false;
                  interactionsOccurredForSectionRef.current = false;
                  nextPlayTimeRef.current = audioContextRef.current ? audioContextRef.current.currentTime : 0;
                  
                  // Mark the change as tool-driven so the section effect doesn't send the text again
                  // (the tool response below carries it). Re-reading the current section doesn't
                  // re-run that effect, so leave the flag alone in that case.
                  if (index !== currentChunkIndexRef.current) {
                    isSourceOfSectionChangeRef.current = 'tool';
                    setCurrentChunkIndex(index);
                  }
                  
                  liveServiceRef.current?.sendToolResponse({
                    functionResponses: [{
                      name: "change_section",
                      response: { 
                        output: `Section successfully changed to index ${index}: ${chunks[index].section}. The exact content text of this section is: "${chunks[index].text}". ${readModeInstruction()} Deliver it now without calling any more tools. IMPORTANT: Always start by announcing the section title (e.g. "Section ${index + 1}: ${chunks[index].section}").${lastSectionInstruction(index, chunks.length)}` 
                      },
                      id: fc.id
                    }]
                  });
                } else {
                  liveServiceRef.current?.sendToolResponse({
                    functionResponses: [{
                      name: "change_section",
                      response: { error: `Invalid section index: ${fc.args.sectionIndex}. Range is 0 to ${chunks.length - 1}.` },
                      id: fc.id
                    }]
                  });
                }
              }
            });
          }
        },
        onError: (err) => {
          console.error("Live session error:", err);
          setMicError(err?.message || 'Something went wrong with the voice session. Press play to try again.');
          stopLiveSession();
        },
        onClose: (info) => {
          if (!info.expected) {
            // Network drop, session time limit or server error: release the mic and audio too.
            liveServiceRef.current = null;
            teardownAudio();
            setIsLiveActive(false);
            setMicError(`The voice session ended${info.reason ? ` (${info.reason})` : ''}. Press play to carry on from this section.`);
          }
        },
        onDebugLog: (msg) => {
          console.debug("[ARC]", msg);
        }
      }, {
        systemInstruction: `${systemInstructionMarkdown}\n\n## Current Document Structure\nYou are currently reviewing the document: "${loadedDocTitle || 'Default Document'}" which contains exactly ${docChunks.length} sections.\nThe active sections that correspond to the available indexes for the \`change_section\` tool are:\n${docChunks.map((chunk, index) => `- **UI Section ${index + 1}** (Index ${index}): "${chunk.section}"`).join('\n')}\n\nCRITICAL: Use these exact indexes and titles when updating active sections. If the user asks you to skip forward, go back or go to a section, select the correct 0-based index from this list.`,
      });

      await audioContext.resume();
      
      const source = audioContext.createMediaStreamSource(micStream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      audioWorkletRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (isLiveActiveRef.current && !isMutedRef.current) {
          const inputData = e.inputBuffer.getChannelData(0);
          
          // Calculate root-mean-square (RMS) level to measure microphone amplitude
          let sum = 0;
          for (let i = 0; i < inputData.length; i++) {
            sum += inputData[i] * inputData[i];
          }
          const rms = Math.sqrt(sum / inputData.length);
          
          const isArcCurrentlySpeaking = playingSourcesRef.current.length > 0;
          
          // When ARC is not speaking, we do not apply any threshold (0.0) to ensure maximum responsiveness.
          // When ARC is speaking, we use a balanced threshold to shield against loopback speaker echo.
          const threshold = isArcCurrentlySpeaking ? 0.012 : 0.0;
          
          if (rms >= threshold) {
            const resampledData = resample(inputData, INPUT_SAMPLE_RATE, audioContext.sampleRate);
            const pcmBuffer = floatTo16BitPCM(resampledData);
            const base64 = arrayBufferToBase64(pcmBuffer);
            liveService.sendAudio(base64);
          }
        }
      };

      source.connect(processor);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);

      setIsLiveActive(true);
      try { wakeLockRef.current = await (navigator as any).wakeLock?.request('screen'); } catch { /* optional */ }
      console.debug("[ARC]", "Session active");

    } catch (err) {
      console.error("Failed to start live session:", err);
      // Release the mic and anything half-started so the browser's mic indicator goes off.
      liveServiceRef.current?.disconnect();
      liveServiceRef.current = null;
      teardownAudio();
      setIsLiveActive(false);
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
        setMicError("Microphone access was blocked. Allow the microphone for this page (the icon at the right of the address bar), then press play again.");
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        setMicError("No microphone was found. Plug one in or check your sound settings, then press play again.");
      } else {
        setMicError(err instanceof Error ? err.message : String(err));
      }
      console.debug("[ARC]", `Failed: ${err}`);
    }
  };

  // Releases the mic, audio graph and playback. Safe to call more than once.
  const teardownAudio = () => {
    wakeLockRef.current?.release?.().catch(() => {});
    wakeLockRef.current = null;
    if (audioWorkletRef.current) { audioWorkletRef.current.onaudioprocess = null; audioWorkletRef.current.disconnect(); }
    audioWorkletRef.current = null;
    if (micStreamRef.current) micStreamRef.current.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    playingSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    playingSourcesRef.current = [];
    itemPlaybackStartRef.current.clear();
    if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
    audioContextRef.current = null;
    nextPlayTimeRef.current = 0;
    setIsArcSpeaking(false);
  };

  const stopLiveSession = () => {
    const service = liveServiceRef.current;
    liveServiceRef.current = null;
    if (service) service.disconnect();
    teardownAudio();
    
    setIsLiveActive(false);
    setIsMuted(true); // Ensure UI reflects mute status
  };

  const downloadIdeas = async () => {
    if (capturedIdeas.length === 0) return;
    
    const docChildren: any[] = [];
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const dateComponent = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const timeComponent = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const safeTitle = (loadedDocTitle || 'document').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60);
    const fileName = `ARC_comments_${safeTitle}_${dateComponent}_${timeComponent}.docx`;

    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({ text: `ARC comments: ${loadedDocTitle || 'Untitled document'}`, bold: true, size: 32, font: "Arial" }),
          new TextRun({ text: `Exported ${now.toLocaleString()}`, break: 1, size: 20, color: "666666", font: "Arial" }),
        ],
        spacing: { after: 400 }
      })
    );

    for (const idea of capturedIdeas) {
      const timeStr = idea.timestamp.toLocaleTimeString();
      const dateStr = idea.timestamp.toLocaleDateString();
      const name = idea.source === 'user' ? 'You' : 'Arc';
      
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${idea.section ? `${idea.section} • ` : ''}${name} • ${dateStr} ${timeStr}`, bold: true, color: idea.source === 'user' ? "005bb5" : "333333", font: "Arial" })
          ],
          spacing: { before: 200, after: 100 }
        })
      );
      
      if (idea.imageUrl) {
        try {
          // It's already in base64 data URI format
          const response = await fetch(idea.imageUrl);
          const arrayBuffer = await response.arrayBuffer();
          
          docChildren.push(
            new Paragraph({
              children: [
                new ImageRun({
                  data: arrayBuffer,
                  type: "jpg",
                  transformation: {
                    width: 320,
                    height: 180,
                    flip: idea.isImageMirrored ? { horizontal: true, vertical: false } : undefined
                  }
                })
              ],
              spacing: { after: 100 }
            })
          );
        } catch (err) {
          console.error("Error embedding image into docx", err);
        }
      }

      if (idea.text) {
        const lines = idea.text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim() !== '') {
            docChildren.push(
              new Paragraph({
                children: [
                  new TextRun({ text: lines[i], font: "Arial" })
                ],
                spacing: { after: 100 }
              })
            );
          } else {
             docChildren.push(new Paragraph({ children: [], spacing: { after: 100 } }));
          }
        }
      }
    }

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: {
              font: "Arial",
            },
          },
        },
      },
      sections: [
        {
          properties: {},
          children: docChildren
        }
      ]
    });

    try {
      const blob = await Packer.toBlob(doc);
      saveAs(blob, fileName);
    } catch (e) {
      console.error(e);
    }
  };

  const generateId = () => Date.now().toString() + Math.random().toString();

  // Pick up a doc Claude dropped into inbox/doc.json (loaded once per drop).
  useEffect(() => {
    fetch('/api/inbox').then(r => r.ok ? r.json() : null).then(doc => {
      if (!doc?.chunks?.length) return;
      const marker = `${doc.title}|${doc.loadedAt}`;
      if (window.localStorage.getItem('inbox_loaded') === marker) return;
      window.localStorage.setItem('inbox_loaded', marker);
      setDocChunks(doc.chunks);
      setLoadedDocTitle(doc.title);
      setLoadedDocId(null);
      setCapturedIdeas([]);
      isSourceOfSectionChangeRef.current = 'ui';
      setCurrentChunkIndex(0);
      setScreenState('player');
    }).catch(() => {});
  }, []);

  // Mirror note additions/deletions to inbox/notes.json so Claude can read them back.
  // Only diffs are sent, so reloads and other tabs never overwrite the stored notes.
  // Every document load creates a new docChunks array, so a change of array means "new document":
  // the notes list was cleared by the load, not by the user, and must not be deleted from the store.
  const syncedNotesRef = useRef<{ doc: DocChunk[]; docTitle: string | null; ids: Set<string> } | null>(null);
  useEffect(() => {
    const ids = new Set(capturedIdeas.map(i => i.id));
    const prev = syncedNotesRef.current;
    syncedNotesRef.current = { doc: docChunks, docTitle: loadedDocTitle, ids };
    if (!prev || prev.doc !== docChunks || prev.docTitle !== loadedDocTitle) return;
    const post = (url: string, body: any) => fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docTitle: loadedDocTitle, ...body })
    }).catch(() => {});
    capturedIdeas.filter(i => !prev.ids.has(i.id)).forEach(i =>
      post('/api/notes/add', { note: { id: i.id, section: i.section, text: i.text, source: i.source, timestamp: i.timestamp } }));
    prev.ids.forEach(id => { if (!ids.has(id)) post('/api/notes/delete', { id }); });
  }, [capturedIdeas, loadedDocTitle, docChunks]);

  const addIdea = (text: string, source: 'user' | 'arc') => {
    const id = generateId();
    const activeChunk = docChunksRef.current[currentChunkIndexRef.current];
    setCapturedIdeas(prev => [...prev, {
      id,
      text,
      timestamp: new Date(),
      source,
      chunkId: activeChunk?.id || 'gdoc-fallback',
      section: cleanSectionHeading(activeChunk?.section)
    }]);
    return id;
  };

  if (apiLocked) {
    return (
      <div className="flex justify-center w-full h-screen overflow-hidden text-gray-900 dark:text-gray-100" style={{ background: '#ebe9e5' }}>
        <UnlockScreen />
      </div>
    );
  }

  return (
    <div className="flex justify-center w-full h-screen overflow-hidden text-gray-900 dark:text-gray-100" style={{ background: '#ebe9e5' }}>
      {screenState === 'start' && !googleUser && (
        <LoadScreenSignedOut 
          onSignIn={handleGoogleSignIn}
          onSampleLoad={loadSampleDoc}
          isLoggingIn={isLoggingIn}
          docError={docError}
          hasFirebase={hasFirebaseConfig}
          onUploadDoc={loadUploadedDoc}
          uploadLoading={uploadLoading}
          uploadError={uploadError}
        />
      )}

      {screenState === 'start' && googleUser && (
        <LoadScreenSignedIn 
          user={googleUser}
          onDisconnect={handleGoogleSignOut}
          onLoadDoc={loadGoogleDoc}
          onSampleLoad={loadSampleDoc}
          docLoading={docLoading}
          docError={docError}
          docUrlInput={docUrlInput}
          setDocUrlInput={setDocUrlInput}
          onUploadDoc={loadUploadedDoc}
          uploadLoading={uploadLoading}
          uploadError={uploadError}
        />
      )}

      {screenState === 'player' && (
        <PlaybackScreen 
          serif="'Source Serif 4', Georgia, serif"
          playing={isLiveActive}
          menuOpen={isMobileMenuOpen}
          muted={isMuted}
          commentsOpen={showCommentsPanel}
          sectionTitle={cleanSectionHeading(currentChunk.section)}
          docNode={<DocumentTextRenderer text={currentChunk.text} />}
          totalSections={docChunks.length}
          readMode={readMode}
          errorMessage={micError}
          onDismissError={() => setMicError(null)}
          onToggleReadMode={() => setReadMode(m => {
            const next = m === 'skim' ? 'full' : 'skim';
            readModeRef.current = next;
            // Takes effect from the next section: each section's prompt carries the current mode.
            return next;
          })}
          activeSection={currentChunkIndex}
          scrubPage={scrubPage}
          docTitle={loadedDocTitle || 'Untitled Document'}
          micIndicator={isMuted ? 'none' : isArcSpeaking ? 'pulse' : 'glow-shimmer'}
          comments={capturedIdeas}
          onToggleComments={() => setShowCommentsPanel(!showCommentsPanel)}
          onTogglePlay={async () => {
             if (!isLiveActive) await startLiveSession();
             else stopLiveSession();
          }}
          onToggleMute={() => setIsMuted(!isMuted)}
          onToggleMenu={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          onPrevChunk={prevChunk}
          onNextChunk={nextChunk}
          onJumpChunk={jumpToSection}
          onPrevWindow={() => setScrubPage(prev => Math.max(0, prev - 1))}
          onNextWindow={() => setScrubPage(prev => Math.min(Math.ceil(docChunks.length / 10) - 1, prev + 1))}
          // Without a connected Google Doc, the panel button exports comments as a Word file instead.
          canSyncToDoc={!!(authToken && loadedDocId)}
          onSync={authToken && loadedDocId ? syncCommentsToDoc : downloadIdeas}
          isSyncing={isSyncing}
          syncError={syncError}
          syncSuccessMessage={syncSuccessMessage}
          onDeleteComment={(id: string) => setCapturedIdeas(prev => prev.filter(c => c.id !== id))}
          onLoadNew={handleReloadClick}
          // Only Google Docs can be re-fetched; uploaded and hand-off documents have no source to reload.
          onReload={loadedDocId && authToken ? () => {
            loadGoogleDoc(`https://docs.google.com/document/d/${loadedDocId}`);
            setIsMobileMenuOpen(false);
          } : undefined}
        />
      )}

      <ConfirmDialog 
        isOpen={showConfirmReload} 
        onClose={() => setShowConfirmReload(false)} 
        onConfirm={confirmReloadNewDoc} 
      />
    </div>
  );
}