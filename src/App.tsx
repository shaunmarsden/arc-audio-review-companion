import React, { useState, useRef, useEffect } from 'react';
import { 
  Mic, 
  MicOff, 
  Volume2, 
  VolumeX, 
  Brain, 
  Play,
  Square,
  Terminal,
  MessageSquare,
  RotateCcw,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Move,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
  Send,
  Cpu,
  Trash2,
  MoreHorizontal,
  Lightbulb,
  Download,
  ExternalLink,
  FlipHorizontal,
  Menu,
  Aperture,
  StickyNote,
  Sun,
  Moon,
  SwitchCamera,
  CirclePlus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { OpenAIRealtimeService, INPUT_SAMPLE_RATE } from './services/openaiRealtimeService';
import { Document, Packer, Paragraph, TextRun, ImageRun } from 'docx';
import { saveAs } from 'file-saver';
import systemInstructionMarkdown from './prompts/arc_system_instruction.md?raw';
// Import custom UI components
import { LoadScreenSignedOut, LoadScreenSignedIn, PlaybackScreen } from './components/ArcScreens';
import { floatTo16BitPCM, arrayBufferToBase64 } from './lib/audioUtils';

import * as mammoth from 'mammoth/mammoth.browser';
import * as pdfjsLib from 'pdfjs-dist';

// Safe worker loading for Vite
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
}

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

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text?: string;
  imageUrl?: string;
  timestamp: Date;
  capturedIdeaId?: string;
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
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
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
  const [isReviewPaused, setIsReviewPaused] = useState(false);
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

  const handleScrubTouchStart = (e: React.TouchEvent) => { touchStartRef.current = e.touches[0].clientX; };
  const handleScrubTouchEnd = (e: React.TouchEvent) => {
    const delta = touchStartRef.current - e.changedTouches[0].clientX;
    if (Math.abs(delta) > 50) {
      if (delta > 0) { // swipe left
         setScrubPage(prev => Math.min(Math.ceil(docChunks.length / 10) - 1, prev + 1));
      } else { // swipe right
         setScrubPage(prev => Math.max(0, prev - 1));
      }
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

  const [activeChatMenuId, setActiveChatMenuId] = useState<string | null>(null);
  const [activeStickyMenuId, setActiveStickyMenuId] = useState<string | null>(null);
  const [showCommentsPanel, setShowCommentsPanel] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  // Live API State
  const [isLiveActive, setIsLiveActive] = useState(false);
  const isLiveActiveRef = useRef(false);
  const isSourceOfSectionChangeRef = useRef<'ui' | 'tool'>('ui');
  const [scrubPage, setScrubPage] = useState(0);
  const touchStartRef = useRef(0);

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
  const [tokenUsage, setTokenUsage] = useState({ prompt: 0, candidates: 0, total: 0 });
  const [micLevel, setMicLevel] = useState(0);
  const [arcLevel, setArcLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const isMutedRef = useRef(true);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);
  
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [inputText, setInputText] = useState('');
  const liveServiceRef = useRef<OpenAIRealtimeService | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const playingSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioWorkletRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const arcAnalyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastCaptureTimeRef = useRef<number>(0);
  const motionDetectedRef = useRef<boolean>(false);
  const hasPlayedAudioForSectionRef = useRef<boolean>(false);
  const isTurnCompleteRef = useRef<boolean>(false);
  const wasInterruptedRef = useRef<boolean>(false);
  const interactionsOccurredForSectionRef = useRef<boolean>(false);
  
  const [stagedFiles, setStagedFiles] = useState<{name: string, content: string, imageUrl?: string}[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: '1', role: 'assistant', text: "Hello! I'm ARC, your ideation partner.", timestamp: new Date() }
  ]);
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

  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'context'>('chat');
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 1024 : false);
  const [isTablet, setIsTablet] = useState(() => typeof window !== 'undefined' ? window.innerWidth >= 768 && window.innerWidth <= 1180 : false);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const [highlightedIdeaId, setHighlightedIdeaId] = useState<string | null>(null);
  const [isLandscape, setIsLandscape] = useState(() => typeof window !== 'undefined' ? window.innerWidth > window.innerHeight : false);

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

  useEffect(() => {
    if (isLiveActive && liveServiceRef.current) {
      // Reset section tracking state for the new section
      isTurnCompleteRef.current = false;
      hasPlayedAudioForSectionRef.current = false;
      wasInterruptedRef.current = false;
      interactionsOccurredForSectionRef.current = false;
      nextPlayTimeRef.current = audioContextRef.current ? audioContextRef.current.currentTime : 0;

      if (isSourceOfSectionChangeRef.current === 'ui') {
        const isLastSection = currentChunkIndex === docChunks.length - 1;
        const lastSectionInstruction = isLastSection 
          ? " IMPORTANT: This is the LAST section of the entire document. Once you finish reading it, you MUST clearly announce that you have now concluded reading the entire document, and ask the user if they have any final comments, feedback, or notes to take before stopping." 
          : "";
        liveServiceRef.current.sendText(`Please deliver this chunk aloud (Section: ${currentChunk.section}). ${readModeInstruction()} Note: The screen is already synchronized to this section. Directly start without calling change_section or any other tools. IMPORTANT: Always start by announcing the section title (e.g. "Section ${currentChunkIndex + 1}: ${currentChunk.section}").${lastSectionInstruction}\n\n${currentChunk.text}`);
      } else {
        // Reset tracking to default 'ui' for future user interaction clicks
        isSourceOfSectionChangeRef.current = 'ui';
      }
    }
  }, [isLiveActive, currentChunkIndex, currentChunk.id]);

  // Keep Arc updated about document structure changes dynamically
  useEffect(() => {
    if (isLiveActive && liveServiceRef.current && docChunks.length > 0) {
      liveServiceRef.current.sendText(`[System Context: Active document structure updated to: "${loadedDocTitle || 'Untitled document'}" with ${docChunks.length} sections. Available indexes for the change_section tool are:\n${docChunks.map((c, i) => `${i}: "${c.section}"`).join('\n')}]`);
    }
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
    setCurrentChunkIndex(prev => Math.min(docChunks.length - 1, prev + 1));
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

  const checkAutoAdvance = () => {
    if (currentChunkIndex >= docChunks.length - 1) {
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

  const chatEndRef = useRef<HTMLDivElement>(null);
  const panelContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!panelContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setIsNarrow(entry.contentRect.width < 550);
      }
    });
    observer.observe(panelContainerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const checkMobile = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      setIsMobile(width < 1024);
      setIsTablet(width >= 768 && width <= 1180);
      setIsLandscape(width > height);
    };
    checkMobile(); // Check on initial client side render
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const playAudioChunk = async (base64Audio: string) => {
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
      
      if (arcAnalyserRef.current) {
        source.connect(arcAnalyserRef.current);
      } else {
        source.connect(ctx.destination);
      }
      
      const startTime = Math.max(ctx.currentTime, nextPlayTimeRef.current);
      const endTime = startTime + audioBuffer.duration;
      source.start(startTime);
      
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

  const scrollToIdea = (ideaId: string) => {
    setActiveTab('context');
    if (isMobile) setIsMobileDrawerOpen(true);
    setHighlightedIdeaId(ideaId);
    
    // Wait for the DOM to render the new activeTab, then scroll the note into view
    setTimeout(() => {
      const el = document.getElementById(`idea-${ideaId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);

    setTimeout(() => {
      setHighlightedIdeaId(null);
    }, 2000);
  };

  const approveIdea = (messageId: string) => {
    setMessages(prev => prev.map(m => {
      if (m.id === messageId && m.suggestion) {
        const ideaId = addIdea(m.suggestion.idea, 'arc', m.imageUrl);
        
        // Send tool response back to Arc
        liveServiceRef.current?.sendToolResponse({
          functionResponses: [{
            name: "suggest_idea_capture",
            response: { output: "Idea captured successfully." },
            id: m.suggestion.toolCallId
          }]
        });

        return { ...m, suggestion: { ...m.suggestion, status: 'approved' }, capturedIdeaId: ideaId };
      }
      return m;
    }));
  };

  const rejectIdea = (messageId: string) => {
    setMessages(prev => prev.map(m => {
      if (m.id === messageId && m.suggestion) {
        // Send tool response back to Arc
        liveServiceRef.current?.sendToolResponse({
          functionResponses: [{
            name: "suggest_idea_capture",
            response: { output: "User declined to capture this idea." },
            id: m.suggestion.toolCallId
          }]
        });

        return { ...m, suggestion: { ...m.suggestion, status: 'rejected' } };
      }
      return m;
    }));
  };

  const startLiveSession = async () => {
    if (isLiveActive) {
      stopLiveSession();
      return;
    }

    try {
      // 1. Start Audio
      setMicError(null);
      setDebugLogs(prev => ["Starting live session...", ...prev.slice(0, 19)]);
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = micStream;
      setIsMuted(false);

      const liveService = new OpenAIRealtimeService();
      liveServiceRef.current = liveService;

      await liveService.connect({
        onTranscription: (text, role) => {
          if (role === 'user') {
            const cleanText = text.replace(/[^a-zA-Z0-9 ]/g, '').trim().toLowerCase();
            if (cleanText.length > 1) {
              const stopWords = [
                'pause', 'stop', 'wait', 'hold', 'second', 'hang on', 'minute',
                'note', 'comment', 'discuss', 'think', 'thought', 'idea', 'question',
                'explain', 'what', 'why', 'how', 'mean'
              ];
              if (stopWords.some(w => cleanText.includes(w))) {
                interactionsOccurredForSectionRef.current = true;
              }
            }
          }
          setMessages(prev => {
            const last = prev[prev.length - 1];
            // If the last message is from the same role and is recent, append to it
            if (last && last.role === (role === 'model' ? 'assistant' : 'user') && last.text !== undefined && Date.now() - last.timestamp.getTime() < 5000) {
              const newText = last.text + " " + text;
              return [...prev.slice(0, -1), { ...last, text: newText }];
            }
            return [...prev, { id: generateId(), role: role === 'model' ? 'assistant' : 'user', text, timestamp: new Date() }];
          });
        },
        onAudioData: (base64Audio) => {
          setIsArcSpeaking(true);
          if (playingSourcesRef.current.length === 0) {
            wasInterruptedRef.current = false;
          }
          playAudioChunk(base64Audio);
          
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
        onUsageUpdate: (usage) => {
          setTokenUsage(prev => ({
            prompt: Math.max(prev.prompt, usage.promptTokens),
            candidates: Math.max(prev.candidates, usage.candidatesTokens),
            total: Math.max(prev.total, usage.totalTokens)
          }));
        },
        onToolCall: (toolCall) => {
          if (toolCall.functionCalls) {
            toolCall.functionCalls.forEach((fc: any) => {
              if (fc.name === 'capture_idea') {
                const idea = fc.args.idea;
                
                const ideaId = addIdea(idea, 'arc', undefined, true);
                
                // Send response back immediately
                liveServiceRef.current?.sendToolResponse({
                  functionResponses: [{
                    name: "capture_idea",
                    response: { output: "Idea correctly logged and saved." },
                    id: fc.id
                  }]
                });
                
                // Attach sticky note to the latest assistant message
                setMessages(prev => {
                  const cloned = [...prev];
                  for (let i = cloned.length - 1; i >= 0; i--) {
                    if (cloned[i].role === 'assistant') {
                      cloned[i] = { ...cloned[i], capturedIdeaId: ideaId };
                      return cloned;
                    }
                  }
                  // Fallback: if no assistant message exists yet
                  return [...cloned, {
                    id: Date.now().toString() + Math.random().toString(),
                    role: 'assistant',
                    timestamp: new Date(),
                    text: '',
                    capturedIdeaId: ideaId
                  }];
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
                setTimeout(() => {
                  stopLiveSession();
                }, 200);
              } else if (fc.name === 'change_section') {
                const index = Number(fc.args.sectionIndex);
                if (!isNaN(index) && index >= 0 && index < docChunks.length) {
                  // Stop active playback immediately to be clean
                  playingSourcesRef.current.forEach(source => { try { source.stop(); } catch(e) {} });
                  playingSourcesRef.current = [];
                  hasPlayedAudioForSectionRef.current = false;
                  isTurnCompleteRef.current = false;
                  wasInterruptedRef.current = false;
                  interactionsOccurredForSectionRef.current = false;
                  nextPlayTimeRef.current = audioContextRef.current ? audioContextRef.current.currentTime : 0;
                  
                  // Set source of section change to 'tool'
                  isSourceOfSectionChangeRef.current = 'tool';
                  
                  // Set section
                  setCurrentChunkIndex(index);
                  
                  liveServiceRef.current?.sendToolResponse({
                    functionResponses: [{
                      name: "change_section",
                      response: { 
                        output: `Section successfully changed to index ${index}: ${docChunks[index].section}. The exact content text of this section is: "${docChunks[index].text}". ${readModeInstruction()} Deliver it now without calling any more tools. IMPORTANT: Always start by announcing the section title (e.g. "Section ${index + 1}: ${docChunks[index].section}").` 
                      },
                      id: fc.id
                    }]
                  });
                } else {
                  liveServiceRef.current?.sendToolResponse({
                    functionResponses: [{
                      name: "change_section",
                      response: { error: `Invalid section index: ${fc.args.sectionIndex}. Range is 0 to ${docChunks.length - 1}.` },
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
          stopLiveSession();
        },
        onClose: () => {
          setIsLiveActive(false);
        },
        onDebugLog: (msg) => {
          setDebugLogs(prev => [msg, ...prev.slice(0, 19)]);
        }
      }, {
        systemInstruction: `${systemInstructionMarkdown}\n\n## Current Document Structure\nYou are currently reviewing the document: "${loadedDocTitle || 'Default Document'}" which contains exactly ${docChunks.length} sections.\nThe active sections that correspond to the available indexes for the \`change_section\` tool are:\n${docChunks.map((chunk, index) => `- **UI Section ${index + 1}** (Index ${index}): "${chunk.section}"`).join('\n')}\n\nCRITICAL: Use these exact indexes and titles when updating active sections. If the user asks you to skip forward, go back or go to a section, select the correct 0-based index from this list.`,
      });

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      await audioContext.resume();
      audioContextRef.current = audioContext;
      
      // Arc Output Analyser
      const arcAnalyser = audioContext.createAnalyser();
      arcAnalyser.fftSize = 256;
      arcAnalyser.connect(audioContext.destination);
      arcAnalyserRef.current = arcAnalyser;
      
      const source = audioContext.createMediaStreamSource(micStream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      source.connect(analyser);

      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      audioWorkletRef.current = processor;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const arcDataArray = new Uint8Array(arcAnalyserRef.current.frequencyBinCount);
      
      const updateLevel = () => {
        if (analyserRef.current) {
          analyserRef.current.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
          setMicLevel(average);
        }
        
        if (arcAnalyserRef.current) {
          arcAnalyserRef.current.getByteFrequencyData(arcDataArray);
          const average = arcDataArray.reduce((a, b) => a + b) / arcDataArray.length;
          setArcLevel(average);
        }
        
        animationFrameRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();

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
      setDebugLogs(prev => ["Session active", ...prev.slice(0, 19)]);

    } catch (err) {
      console.error("Failed to start live session:", err);
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
        setMicError("Microphone access was denied. Please ensure you've granted permission in your browser settings.");
      } else {
        setMicError(err instanceof Error ? err.message : String(err));
      }
      setDebugLogs(prev => [`Failed: ${err}`, ...prev.slice(0, 19)]);
    }
  };

  const stopLiveSession = () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (audioWorkletRef.current) audioWorkletRef.current.disconnect();
    if (micStreamRef.current) micStreamRef.current.getTracks().forEach(t => t.stop());
    
    if (liveServiceRef.current) liveServiceRef.current.disconnect();
    
    playingSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    playingSourcesRef.current = [];
    
    setIsLiveActive(false);
    setMicLevel(0);
    setIsMuted(true); // Ensure UI reflects mute status
    setDebugLogs(prev => [
      `Session stopped. Final Usage: P:${tokenUsage.prompt} C:${tokenUsage.candidates} T:${tokenUsage.total}`,
      ...prev.slice(0, 19)
    ]);
  };

  const deleteMessage = (id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files: File[] = Array.from(e.target.files || []);
    
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target?.result) {
            setStagedFiles(prev => {
              if (prev.some(f => f.name === file.name)) return prev;
              return [...prev, { name: file.name, content: '', imageUrl: event.target!.result as string }];
            });
          }
        };
        reader.readAsDataURL(file);
      } else if (file.name.toLowerCase().endsWith('.pdf')) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
          let text = '';
          for (let i = 1; i <= pdf.numPages; i++) {
             const page = await pdf.getPage(i);
             const content = await page.getTextContent();
             text += content.items.map((item: any) => item.str).join(' ') + '\n';
          }
          setStagedFiles(prev => {
            if (prev.some(f => f.name === file.name)) return prev;
             return [...prev, { name: file.name, content: text }];
          });
        } catch (err) {
          console.error("Failed to parse PDF", err);
          alert("Failed to read PDF.");
        }
      } else if (file.name.toLowerCase().endsWith('.docx')) {
         try {
           const arrayBuffer = await file.arrayBuffer();
           const result = await mammoth.extractRawText({ arrayBuffer });
           setStagedFiles(prev => {
             if (prev.some(f => f.name === file.name)) return prev;
             return [...prev, { name: file.name, content: result.value }];
           });
         } catch (err) {
           console.error("Failed to parse DOCX", err);
           alert("Failed to read DOCX.");
         }
      } else {
         const reader = new FileReader();
         reader.onload = (event) => {
           if (event.target?.result) {
             setStagedFiles(prev => {
               if (prev.some(f => f.name === file.name)) return prev;
               return [...prev, { name: file.name, content: event.target!.result as string }];
             });
           }
         };
         reader.readAsText(file);
      }
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeStagedFile = (name: string) => {
    setStagedFiles(prev => prev.filter(f => f.name !== name));
  };

  const handleSendMessage = (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!inputText.trim() && stagedFiles.length === 0) || !liveServiceRef.current || !isLiveActive) return;

    const cleanText = inputText.replace(/[^a-zA-Z0-9 ]/g, '').trim().toLowerCase();
    const stopWords = [
      'pause', 'stop', 'wait', 'hold', 'second', 'hang on', 'minute',
      'note', 'comment', 'discuss', 'think', 'thought', 'idea', 'question',
      'explain', 'what', 'why', 'how', 'mean'
    ];
    if (stopWords.some(w => cleanText.includes(w))) {
      interactionsOccurredForSectionRef.current = true;
    }

    const text = inputText.trim();
    let finalPayload = text;
    let displayText = text;

    let attachedImageUrls: string[] = [];

    if (stagedFiles.length > 0) {
      const textFiles = stagedFiles.filter(f => f.content);
      const textContextStr = textFiles.map(f => `[Context File: ${f.name}]\n${f.content}\n`).join('\n---\n');
      
      const imageFiles = stagedFiles.filter(f => f.imageUrl);
      
      if (textFiles.length > 0) {
          finalPayload = `Here are some attached files for context:\n${textContextStr}\n\n`;
      } else {
          finalPayload = '';
      }
      
      if (imageFiles.length > 0) {
          finalPayload += `[User also attached ${imageFiles.length} image(s).]\n\n`;
          // We no longer send images to the live feed since video functionality was removed
          imageFiles.forEach(img => {
            if (img.imageUrl) {
              attachedImageUrls.push(img.imageUrl);
            }
          });
      }
      
      finalPayload += `User Question:\n${text}`;
      const attachedNames = stagedFiles.map(f => f.name).join(', ');
      displayText = text ? `${text}\n\n(Attached files: ${attachedNames})` : `(Attached files: ${attachedNames})`;
    }
    
    // Check if user is explicitly asking to capture something
    const captureMatch = text.match(/^capture:\s*(.*)/i);
    if (captureMatch) {
      const ideaId = addIdea(captureMatch[1], 'user');
      setMessages(prev => [...prev, { 
        id: Date.now().toString(), 
        role: 'user', 
        text: `Captured idea: ${captureMatch[1]}`, 
        timestamp: new Date(),
        capturedIdeaId: ideaId,
        imageUrl: attachedImageUrls[0] // just attach the first one if multiple for the ui
      }]);
      setInputText('');
      setStagedFiles([]);
      return;
    }

    liveServiceRef.current.sendText(finalPayload);
    
    setMessages(prev => [...prev, { 
      id: Date.now().toString(), 
      role: 'user', 
      text: displayText, 
      timestamp: new Date(),
      imageUrl: attachedImageUrls[0] // keep thumbnail context hook attached to log
    }]);
    
    setInputText('');
    setStagedFiles([]);
  };

  const exportChatToDocx = async () => {
    if (messages.length === 0) return;
    
    const docChildren: any[] = [];
    
    // YYYYMMDD_HHMMSS formatting
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const dateComponent = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const timeComponent = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const fileName = `arc_chat_${dateComponent}_${timeComponent}.docx`;

    // Add a title
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({ text: `ARC Chat Log - ${now.toLocaleString()}`, bold: true, size: 32, font: "Arial" }),
        ],
        spacing: { after: 400 }
      })
    );

    for (const msg of messages) {
      const isUser = msg.role === 'user';
      const timeStr = msg.timestamp.toLocaleTimeString();
      const dateStr = msg.timestamp.toLocaleDateString();
      const name = isUser ? 'You' : 'ARC';
      
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${name} • ${dateStr} ${timeStr}`, bold: true, color: isUser ? "005bb5" : "333333", font: "Arial" })
          ],
          spacing: { before: 200, after: 100 }
        })
      );
      
      if (msg.imageUrl) {
        try {
          const mimeTypeMatch = msg.imageUrl.match(/^data:(image\/\w+);base64,/);
          const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/png';
          let imageType = 'png';
          if (mimeType.includes('jpeg') || mimeType.includes('jpg')) imageType = 'jpg';
          if (mimeType.includes('gif')) imageType = 'gif';

          const response = await fetch(msg.imageUrl);
          const arrayBuffer = await response.arrayBuffer();
          
          docChildren.push(
            new Paragraph({
              children: [
                new ImageRun({
                  data: arrayBuffer,
                  type: imageType as any,
                  transformation: {
                    width: 320,
                    height: 180
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

      if (msg.text) {
        // MS Word XML does not allow raw newline \n characters in TextRun
        // Split and map them to discrete runs with break, or multiple paragraphs
        const lines = msg.text.split('\n');
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
             // add empty paragraph for spacing 
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

  const downloadIdeas = async () => {
    if (capturedIdeas.length === 0) return;
    
    const docChildren: any[] = [];
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const dateComponent = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const timeComponent = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const fileName = `arc_notes_${dateComponent}_${timeComponent}.docx`;

    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({ text: `Arc Saved Notes - ${now.toLocaleString()}`, bold: true, size: 32, font: "Arial" }),
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
            new TextRun({ text: `${name} • ${dateStr} ${timeStr}`, bold: true, color: idea.source === 'user' ? "005bb5" : "333333", font: "Arial" })
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

  const toggleIdeaImageMirror = (ideaId: string) => {
    setCapturedIdeas(prev => prev.map(idea => 
      idea.id === ideaId ? { ...idea, isImageMirrored: !idea.isImageMirrored } : idea
    ));
    setActiveStickyMenuId(null);
  };

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

  // Mirror captured notes to inbox/notes.json so Claude can read them back.
  useEffect(() => {
    fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        docTitle: loadedDocTitle,
        notes: capturedIdeas.map(i => ({ section: i.section, text: i.text, source: i.source, timestamp: i.timestamp }))
      })
    }).catch(() => {});
  }, [capturedIdeas, loadedDocTitle]);

  const addIdea = (text: string, source: 'user' | 'arc', explicitImageUrl?: string, skipImage: boolean = false) => {
    const id = generateId();
    
    let imageUrl = explicitImageUrl;

    const activeChunk = docChunksRef.current[currentChunkIndexRef.current];
    setCapturedIdeas(prev => [...prev, {
      id,
      text,
      timestamp: new Date(),
      source,
      imageUrl,
      chunkId: activeChunk?.id || 'gdoc-fallback',
      section: cleanSectionHeading(activeChunk?.section)
    }]);
    return id;
  };

  return (
    <div className="flex justify-center w-full h-screen overflow-hidden text-gray-900 dark:text-gray-100" style={{ background: '#ebe9e5' }}>
      {screenState === 'start' && !googleUser && (
        <LoadScreenSignedOut 
          onSignIn={handleGoogleSignIn}
          onSampleLoad={loadSampleDoc}
          isLoggingIn={isLoggingIn}
          docError={docError}
          hasFirebase={hasFirebaseConfig}
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
          onSync={syncCommentsToDoc}
          isSyncing={isSyncing}
          syncError={syncError}
          syncSuccessMessage={syncSuccessMessage}
          onDeleteComment={(id: string) => setCapturedIdeas(prev => prev.filter(c => c.id !== id))}
          onLoadNew={handleReloadClick}
          onReload={() => {
            // Re-loads document by fetching again
            if (loadedDocId) {
              loadGoogleDoc(`https://docs.google.com/document/d/${loadedDocId}`);
              setIsMobileMenuOpen(false);
            }
          }}
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