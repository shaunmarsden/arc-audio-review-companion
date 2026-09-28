import React from 'react';
import { MicButton } from './MicButton';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ARC, 
  embossShadow, 
  outlineShadow, 
  embossedDivider,
  embossedDividerV,
  recessShadow,
  darkEmbossShadow,
  cardCopy,
  btnSecondary,
  btnGhost,
  btnPrimary,
  Card,
  CardHeader,
  ArcLogo,
  IconGoogle,
  Screen
} from './Layout';

// Simple Icons inline
const Icon = ({ d, size = 18, fill = 'none', stroke = 'currentColor', sw = 1.5, vb = 24, children }: any) =>
  <svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} fill={fill} stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    {children || <path d={d} />}
  </svg>;

const IconCycle = (p: any) => <Icon {...p}><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M3 21v-5h5" /></Icon>;
const IconChevL = (p: any) => <Icon {...p}><polyline points="15 18 9 12 15 6" /></Icon>;
const IconChevR = (p: any) => <Icon {...p}><polyline points="9 18 15 12 9 6" /></Icon>;
const IconPlay = (p: any) => <Icon {...p} fill="currentColor" stroke="none"><path d="M8 5v14l11-7z" /></Icon>;
const IconPause = (p: any) => <Icon {...p} fill="currentColor" stroke="none"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></Icon>;
const IconSkipPrev = (p: any) => <Icon {...p} fill="currentColor" stroke="currentColor" sw={1.2}><path d="M6 5v14M19 5L9 12l10 7V5z" /></Icon>;
const IconSkipNext = (p: any) => <Icon {...p} fill="currentColor" stroke="currentColor" sw={1.2}><path d="M18 5v14M5 5l10 7L5 19V5z" /></Icon>;
const IconDoc = (p: any) => <Icon {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><polyline points="14 3 14 8 19 8" /></Icon>;
const IconTrash = (p: any) => <Icon {...p}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /></Icon>;
const IconDots = (p: any) => <Icon {...p} fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></Icon>;
const IconMessage = (p: any) => <Icon {...p}><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z" /></Icon>;
const IconX = (p: any) => <Icon {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Icon>;
const IconArrowUp = (p: any) => <Icon {...p}><path d="M12 19V5M5 12l7-7 7 7" /></Icon>;

function UploadCard({ onUploadDoc, uploadLoading, uploadError }: any) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <Card>
      <CardHeader icon={<IconDoc size={20} stroke={ARC.text} />} title="Upload a file" />
      <p style={cardCopy}>Listen to a PDF, Word (.docx), Markdown or text file. Headings become sections.</p>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.txt,.md,.markdown,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUploadDoc(file);
          e.target.value = '';
        }}
      />
      <button className="arc-btn arc-btn-outline" onClick={() => inputRef.current?.click()} disabled={uploadLoading} style={{ ...btnSecondary, width: '100%' }}>
        {uploadLoading ? 'Reading file...' : 'Choose file'}
      </button>
      {uploadError && <div style={{ color: ARC.error, fontSize: 12, marginTop: 8 }}>{uploadError}</div>}
    </Card>
  );
}

export function LoadScreenSignedOut({ onSignIn, onSampleLoad, isLoggingIn, docError, hasFirebase, onUploadDoc, uploadLoading, uploadError }: any) {
  return (
    <Screen>
      <div style={{ padding: '24px 20px 24px', display: 'flex', flexDirection: 'column', gap: 24, flex: 1, overflowY: 'auto' }} className="arc-scroll">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 28, alignItems: 'flex-start' }}>
          <ArcLogo height={72} />
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: ARC.muted, maxWidth: 320 }}>
            Listen to your documents and add comments hands free.
          </p>
        </div>

        <UploadCard onUploadDoc={onUploadDoc} uploadLoading={uploadLoading} uploadError={uploadError} />

        {hasFirebase && <Card>
          <CardHeader icon={<IconDoc size={20} stroke={ARC.text} />} title="Google doc loader" />
          <p style={cardCopy}>Connect your Google account securely to load and read private or shared Google docs directly.</p>
          
          <button className="arc-btn arc-btn-outline" onClick={onSignIn} disabled={isLoggingIn} style={{ ...btnSecondary, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <IconGoogle size={18} />
            {isLoggingIn ? 'Connecting...' : 'Sign in with Google'}
          </button>
          
          <div style={{ fontSize: 11, color: ARC.muted, marginTop: 8, padding: '0 8px', textAlign: 'center', lineHeight: 1.3 }}>
            Note: When signing in, please explicitly check the boxes to grant access to Google Drive and Docs, otherwise documents cannot be loaded.
          </div>

          {docError && <div style={{ color: ARC.error, fontSize: 12, marginTop: 8 }}>{docError}</div>}
        </Card>}

        <Card>
          <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: ARC.accentText, marginBottom: 8 }}>
            Default resource
          </div>
          <div style={{ fontSize: 17, fontWeight: 500, marginBottom: 8 }}>Sample draft: ARC Spec</div>
          <p style={cardCopy}>Test-drive ARC, review text callouts, and try structured simple tables with a pre-configured sample document.</p>
          <button className="arc-btn arc-btn-ghost" onClick={onSampleLoad} style={{ ...btnGhost, padding: '0', alignSelf: 'flex-start', color: ARC.accentText }}>
            Open sample  →
          </button>
        </Card>
      </div>
    </Screen>
  );
}

export function LoadScreenSignedIn({ user, onDisconnect, onLoadDoc, onSampleLoad, docLoading, docError, docUrlInput, setDocUrlInput, onUploadDoc, uploadLoading, uploadError }: any) {
  return (
    <Screen>
      <div style={{ padding: '24px 20px 24px', display: 'flex', flexDirection: 'column', gap: 24, flex: 1, overflowY: 'auto' }} className="arc-scroll">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 28, alignItems: 'flex-start' }}>
          <ArcLogo height={72} />
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: ARC.muted, maxWidth: 320 }}>
            Listen to your Google Docs and add comments hands free.
          </p>
        </div>

        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <IconDoc size={20} stroke={ARC.text} />
            <div style={{ fontSize: 15, fontWeight: 500, flex: 1 }}>Google doc loader</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: ARC.surface2, borderRadius: 8, marginBottom: 14, border: `1px solid ${ARC.border}` }}>
            <img referrerPolicy="no-referrer" src={user?.photoURL} style={{ width: 26, height: 26, borderRadius: 999 }} alt=""/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: ARC.text, lineHeight: 1.2 }}>{user?.displayName}</div>
              <div style={{ fontSize: 11, color: ARC.muted, lineHeight: 1.2, textOverflow: 'ellipsis', overflow: 'hidden' }}>{user?.email}</div>
            </div>
          <button className="arc-btn arc-btn-outline" onClick={onDisconnect} style={{ ...btnSecondary, color: ARC.text, fontSize: 13 }}>Disconnect</button>
          </div>

          <label style={{ display: 'block', fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: ARC.muted, marginBottom: 6 }}>
            Paste Google doc URL
          </label>
          <input
            className="focus-ring"
            placeholder="docs.google.com/document/d/…"
            value={docUrlInput}
            onChange={(e) => setDocUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onLoadDoc(docUrlInput)}
            style={{
              width: '100%', height: 44, padding: '0 14px', boxSizing: 'border-box',
              border: `1px solid ${ARC.border}`, borderRadius: 10,
              background: ARC.surface2, color: ARC.text, fontSize: 13,
              fontFamily: 'inherit', boxShadow: recessShadow
            }}
          />
          {docError && <div style={{ color: ARC.error, fontSize: 12, marginTop: 8 }}>{docError}</div>}
          
          <button className="arc-btn arc-btn-primary" onClick={() => onLoadDoc(docUrlInput)} disabled={docLoading} style={{ ...btnPrimary, width: '100%', marginTop: 12 }}>
            {docLoading ? 'Loading...' : 'Load document'}
          </button>
        </Card>

        <UploadCard onUploadDoc={onUploadDoc} uploadLoading={uploadLoading} uploadError={uploadError} />

        <Card>
          <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: ARC.accentText, marginBottom: 8 }}>
            Default resource
          </div>
          <div style={{ fontSize: 17, fontWeight: 500, marginBottom: 8 }}>Sample draft: ARC Spec</div>
          <p style={cardCopy}>Test-drive ARC with a pre-configured sample.</p>
          <button className="arc-btn arc-btn-ghost" onClick={onSampleLoad} style={{ ...btnGhost, padding: 0, alignSelf: 'flex-start', color: ARC.accentText }}>
            Open sample  →
          </button>
        </Card>
      </div>
    </Screen>
  );
}

function PlaybackHeader({ onMenu, menuOpen, docTitle, buttonRef }: any) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, height: 60, padding: '0 16px' }}>
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center' }}>
          <ArcLogo height={26} />
        </div>
        <div style={{ ...embossedDividerV, height: 18 }} />
        <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 500, color: ARC.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '-0.005em' }}>
          {docTitle}
        </div>
        <button 
          ref={buttonRef}
          onClick={onMenu} 
          aria-label="More" 
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          className="arc-btn arc-btn-outline" 
          style={{
          width: 40, height: 40, borderRadius: 12, flex: '0 0 auto', background: 'transparent',
          border: `1px solid ${ARC.border}`, boxShadow: menuOpen ? recessShadow : outlineShadow,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: ARC.text, cursor: 'pointer', padding: 0
        }}>
          <IconDots size={20} />
        </button>
      </div>
      <div style={embossedDivider} />
    </>
  );
}

function CommentsPanel({ isOpen, comments, onClose, serifFamily, onSync, isSyncing, syncError, syncSuccessMessage, onDeleteComment, canSyncToDoc = true }: any) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    // Initial focus on the panel itself
    if (isOpen && panelRef.current) {
      panelRef.current.focus({ preventScroll: true });
    }
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      
      if (e.key === 'Tab') {
        const dialog = panelRef.current;
        if (!dialog) return;

        const focusableElements = dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        } else if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{
              position: 'absolute', inset: 0,
              background: 'rgba(26,26,26,0.45)',
              zIndex: 30
            }}
          />
      <motion.div 
        key="panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Comments panel"
        className="focus-ring"
        tabIndex={-1}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        style={{ 
          position: 'absolute', inset: 0, top: 12,
          background: ARC.surface, padding: '0 20px', 
          display: 'flex', flexDirection: 'column', gap: 0, zIndex: 40,
          borderRadius: '24px 24px 0 0',
          boxShadow: '0 -8px 24px rgba(40,30,20,0.12), inset 0 1px 0 rgba(255,255,255,0.85)',
          overflow: 'hidden', outline: 'none'
        }}
      >
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0' }}>
          <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: ARC.text }}>
            Comments <span style={{ margin: '0 6px', opacity: 0.5 }}>·</span> <span style={{ color: ARC.text }}>{comments.length}</span>
          </div>
          <button onClick={onClose} aria-label="Close comments" className="arc-btn arc-btn-outline" style={{
            display: 'flex', alignItems: 'center', gap: 6,
            height: 40, padding: '0 14px', background: 'transparent',
            border: `1px solid ${ARC.border}`, boxShadow: outlineShadow,
            borderRadius: 12, color: '#000000', fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.04em',
            textTransform: 'uppercase', fontWeight: 600
          }}>
            Close <IconX size={14} />
          </button>
        </div>

        <div style={embossedDivider} />

        {/* Scrollable list */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }} className="arc-scroll">
          {comments.map((c: any, i: number) => (
            <React.Fragment key={c.id}>
              <div style={{ padding: '14px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: ARC.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: 1 }}>
                    {c.section}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {c.synced && <span style={{ fontSize: 12, color: ARC.success, padding: '2px 6px', borderRadius: 6, border: `1px solid ${ARC.success}` }}>SYNCED</span>}
                    <span style={{ fontSize: 12, color: ARC.dark, fontVariantNumeric: 'tabular-nums', flex: '0 0 auto' }}>
                      {new Date(c.timestamp).toLocaleTimeString()}
                    </span>
                    {onDeleteComment && (
                      <button onClick={() => onDeleteComment(c.id)} aria-label="Delete comment" className="arc-btn arc-btn-ghost" style={{ width: 32, height: 32, borderRadius: 8, padding: 0, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <IconTrash size={16} />
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ fontFamily: serifFamily, fontSize: 16, lineHeight: 1.45, fontWeight: 400, color: ARC.text, letterSpacing: '-0.005em' }}>
                  “{c.text}”
                </div>
              </div>
              {i < comments.length - 1 && <div style={embossedDivider} />}
            </React.Fragment>
          ))}
          {comments.length === 0 && <div style={{ padding: '20px 0', textAlign: 'center', color: ARC.muted, fontSize: 14 }}>No comments captured yet.</div>}
        </div>

        <div style={embossedDivider} />

        {syncSuccessMessage && <div style={{ color: ARC.success, fontSize: 12, marginTop: 8, textAlign: 'center' }}>{syncSuccessMessage}</div>}
        {syncError && <div style={{ color: ARC.error, fontSize: 12, marginTop: 8, textAlign: 'center' }}>{syncError}</div>}

        <button className="arc-btn arc-btn-primary" onClick={onSync} disabled={isSyncing || comments.length === 0} style={{
          ...btnPrimary, marginTop: 14, marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          opacity: isSyncing || comments.length === 0 ? 0.5 : 1
        }}>
          {isSyncing ? 'Syncing...' : canSyncToDoc ? `Sync comments (${comments.filter((c:any) => !c.synced).length})` : `Download comments (${comments.length})`}
          {!isSyncing && <IconArrowUp size={16} />}
        </button>
      </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

const controlBtn: any = {
  width: 48, height: 48, borderRadius: 999,
  background: 'transparent', border: `1px solid ${ARC.border}`,
  boxShadow: outlineShadow,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', padding: 0, transition: 'background 150ms'
};

function Controls({ playing, muted, commentsOpen, onPlayToggle, onMuteToggle, onCommentsToggle, commentsCount, onPrev, onNext, micIndicator }: any) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
      gap: 6, alignItems: 'center', justifyItems: 'center',
      padding: '4px 16px 0',
      width: '100%', maxWidth: 420, margin: '0 auto',
    }}>
      <MicButton muted={muted} onToggle={onMuteToggle} indicator={micIndicator} />
      <button aria-label="Previous section" onClick={onPrev} className="arc-btn arc-btn-outline" style={{ ...controlBtn, color: ARC.text }}><IconSkipPrev size={22} /></button>
      <button onClick={onPlayToggle} aria-label={playing ? 'Pause' : 'Play'} className="arc-btn arc-btn-primary" style={{
        width: 68, height: 68, borderRadius: 999,
        background: ARC.dark, color: '#f7f5f1',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${ARC.dark}`, cursor: 'pointer', padding: 0,
        boxShadow: darkEmbossShadow,
      }}>
        {playing ? <IconPause size={32} /> : <IconPlay size={32} />}
      </button>
      <button aria-label="Next section" onClick={onNext} className="arc-btn arc-btn-outline" style={{ ...controlBtn, color: ARC.text }}><IconSkipNext size={22} /></button>
      <button onClick={onCommentsToggle} aria-label={`Comments (${commentsCount})`} aria-pressed={commentsOpen}
        className="arc-btn arc-btn-outline" style={{
          ...controlBtn, color: ARC.text, position: 'relative',
          boxShadow: commentsOpen ? recessShadow : outlineShadow,
          background: commentsOpen ? 'rgba(40,30,20,0.06)' : 'transparent',
        }}>
        <IconMessage size={20} />
        {commentsCount > 0 && <span style={{ position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, padding: '0 4px', boxSizing: 'border-box', borderRadius: 999, background: ARC.saffron, color: ARC.saffronOn, fontSize: 10, fontWeight: 600, lineHeight: '14px', textAlign: 'center', border: `1px solid ${ARC.bg}` }}>{commentsCount}</span>}
      </button>
    </div>
  );
}

const carouselChev: any = {
  width: 40, height: 40, borderRadius: 12,
  background: 'transparent', border: 'none',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: ARC.text, cursor: 'pointer', padding: 0, flex: '0 0 auto'
};

function SectionCarousel({ total, active, scrubPage, onPrevWindow, onNextWindow, onSelect }: any) {
  const max = 10;
  const start = scrubPage * max;
  const end = Math.min(total, start + max);
  const visible = [];
  for (let i = start; i < end; i++) visible.push(i);

  const prevScrubPage = React.useRef(scrubPage);
  const direction = scrubPage > prevScrubPage.current ? 1 : scrubPage < prevScrubPage.current ? -1 : 1;
  React.useEffect(() => { prevScrubPage.current = scrubPage; }, [scrubPage]);

  const carouselRef = React.useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const focusableButtons = Array.from(
        carouselRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') || []
      ) as HTMLButtonElement[];
      if (!focusableButtons.length) return;

      const currentIdx = focusableButtons.findIndex(btn => btn === document.activeElement);
      let nextIdx = 0;

      if (e.key === 'ArrowRight') {
        nextIdx = currentIdx < focusableButtons.length - 1 ? currentIdx + 1 : 0;
      } else {
        nextIdx = currentIdx > 0 ? currentIdx - 1 : focusableButtons.length - 1;
      }
      
      focusableButtons[nextIdx]?.focus();
    }
  };

  return (
    <div 
      role="group"
      aria-label="Section carousel"
      aria-roledescription="carousel"
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 20px', width: '100%', maxWidth: 500, margin: '0 auto' }}
    >
      <button className="arc-btn arc-btn-ghost" onClick={onPrevWindow} aria-label="Scroll carousel left" disabled={start === 0} style={{ ...carouselChev, opacity: start === 0 ? 0.3 : 1 }}><IconChevL size={18} /></button>
      <div 
        ref={carouselRef}
        onKeyDown={handleKeyDown}
        role="tablist"
        aria-label="Document sections"
        style={{ flex: 1, overflow: 'hidden', position: 'relative', height: 28, display: 'flex', alignItems: 'center', margin: '0 -4px', padding: '0 4px' }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={scrubPage}
            initial={{ x: direction === 1 ? '50%' : '-50%', opacity: 0 }}
            animate={{ x: '0%', opacity: 1 }}
            exit={{ x: direction === 1 ? '-50%' : '50%', opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            style={{ display: 'flex', alignItems: 'center', gap: 5, width: 'calc(100% - 8px)', height: '100%', position: 'absolute' }}
          >
            {visible.map((i) => {
              const done = i < active;
              const cur = i === active;
              return (
                <button 
                  key={i}
                  role="tab"
                  tabIndex={cur ? 0 : -1}
                  aria-selected={cur}
                  onClick={() => onSelect(i)} 
                  onFocus={() => {
                    // Optional: auto-select on focus
                    // onSelect(i);
                  }}
                  className="cursor-pointer arc-btn" 
                  aria-label={`Go to section ${i + 1}`}
                  style={{
                  flex: 1, height: cur ? 14 : 10, borderRadius: 999, border: 'none',
                  background: cur ? ARC.dark : done ? 'rgba(40,30,20,0.22)' : 'rgba(40,30,20,0.10)',
                  boxShadow: cur ? 'inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.18)' : 'inset 0 1px 0 rgba(255,255,255,0.5)',
                  transition: 'background 150ms ease, height 150ms ease, outline 150ms ease'
                }} />
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>
      <button className="arc-btn arc-btn-ghost" onClick={onNextWindow} aria-label="Scroll carousel right" disabled={end >= total} style={{ ...carouselChev, opacity: end >= total ? 0.3 : 1 }}><IconChevR size={18} /></button>
    </div>
  );
}

export function PlaybackScreen({ 
  serif, playing = true, menuOpen = false, muted = false, commentsOpen = false, 
  sectionTitle, docNode, totalSections, activeSection, scrubPage = 0, docTitle, micIndicator, 
  comments, onToggleComments, onTogglePlay, onToggleMute, onToggleMenu,
  onPrevChunk, onNextChunk, onJumpChunk, onPrevWindow, onNextWindow,
  onSync, isSyncing, syncError, syncSuccessMessage, onDeleteComment, canSyncToDoc,
  onLoadNew, onReload, readMode, onToggleReadMode
}: any) {
  const menuRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [activeSection]);

  React.useEffect(() => {
    if (menuOpen && menuRef.current) {
      const firstItem = menuRef.current.querySelector<HTMLButtonElement>('[role="menuitem"]');
      if (firstItem) {
        firstItem.focus();
      }
    } else if (!menuOpen && buttonRef.current) {
      buttonRef.current.focus();
    }
  }, [menuOpen]);

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onToggleMenu();
      return;
    }
    
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || []) as HTMLButtonElement[];
      if (!items.length) return;
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
      let nextIndex = 0;
      if (e.key === 'ArrowDown') {
        nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
      }
      items[nextIndex]?.focus();
    }
  };

  return (
    <Screen>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, position: 'relative' }}>
        
        {/* Upper container bounded by the top of the bottom controls */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative', zIndex: 1 }}>
          <div style={{ position: 'relative', zIndex: 10 }}>
            <PlaybackHeader menuOpen={menuOpen} docTitle={docTitle} onMenu={onToggleMenu} buttonRef={buttonRef} />
          </div>

          <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'var(--color-surface)' }}>
            <div ref={scrollContainerRef} style={{ height: '100%', overflowY: 'auto', padding: '24px 24px 0 24px' }} className="arc-scroll">
              <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: ARC.text, textAlign: 'center', marginBottom: 12 }}>
                {sectionTitle}
              </div>
              <div style={{ fontFamily: serif, fontSize: 22, lineHeight: 1.4, fontWeight: 400, color: ARC.text, letterSpacing: '-0.005em', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.9em' }}>
                {docNode}
              </div>
              <div style={{ height: 20 }} />
            </div>
          </div>

            <CommentsPanel isOpen={commentsOpen} comments={comments} serifFamily={serif} onClose={onToggleComments} onSync={onSync} isSyncing={isSyncing} syncError={syncError} syncSuccessMessage={syncSuccessMessage} onDeleteComment={onDeleteComment} canSyncToDoc={canSyncToDoc} />
        </div>

        {/* Bottom controls container */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: ARC.bg, position: 'relative', zIndex: 20, paddingBottom: 16 }}>
          <div style={{ ...embossedDivider, marginBottom: 4 }} />
          <div style={{ display: 'flex', justifyContent: 'center', padding: '0 22px', fontSize: 14, color: ARC.muted, fontVariantNumeric: 'tabular-nums' }}>
            <span>
              <span style={{ letterSpacing: '0.04em', textTransform: 'uppercase' }}>Active section</span>
              <span style={{ margin: '0 6px', opacity: 0.5 }}>·</span>
              <span style={{ color: ARC.text, fontWeight: 500 }}>{activeSection + 1} / {totalSections}</span>
              {onToggleReadMode && (
                <>
                  <span style={{ margin: '0 6px', opacity: 0.5 }}>·</span>
                  <button
                    type="button"
                    onClick={onToggleReadMode}
                    title={readMode === 'skim' ? 'Skimming: ARC gives the gist of each section. Click to read in full.' : 'Reading in full. Click to skim.'}
                    style={{ letterSpacing: '0.04em', textTransform: 'uppercase', color: ARC.text, fontWeight: 500, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3, font: 'inherit' }}
                  >
                    {readMode === 'skim' ? 'Skim' : 'Full'}
                  </button>
                </>
              )}
            </span>
          </div>
          <SectionCarousel total={totalSections} active={activeSection} scrubPage={scrubPage} onSelect={onJumpChunk} onPrevWindow={onPrevWindow} onNextWindow={onNextWindow} />
          <Controls playing={playing} muted={muted} commentsOpen={commentsOpen} onPlayToggle={onTogglePlay} onMuteToggle={onToggleMute} onCommentsToggle={onToggleComments} commentsCount={comments.length} onPrev={onPrevChunk} onNext={onNextChunk} micIndicator={micIndicator} />
        </div>

      </div>

      {menuOpen && (
        <>
          <div 
            style={{ position: 'absolute', inset: 0, zIndex: 29, background: 'transparent' }} 
            onClick={onToggleMenu} 
          />
          <div 
            id="mobile-menu"
            role="menu"
            ref={menuRef}
            onKeyDown={handleMenuKeyDown}
            style={{ position: 'absolute', top: 60, right: 14, background: ARC.surface2, border: `1px solid ${ARC.border}`, borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.06)', padding: 6, minWidth: 200, zIndex: 30 }}
          >
            <MenuItem icon={<IconDoc size={16} stroke={ARC.muted} />} label="Load new document" onClick={() => { onLoadNew(); onToggleMenu(); }} />
            <MenuItem icon={<IconCycle size={16} stroke={ARC.muted} />} label="Reload document" onClick={() => { onReload(); onToggleMenu(); }} />
            <div style={{ ...embossedDivider, margin: '4px 6px' }} />
            <MenuItem label="Comments" badge={comments.length} onClick={() => { onToggleComments(); onToggleMenu(); }} />
          </div>
        </>
      )}
    </Screen>
  );
}

function MenuItem({ icon, label, badge, trailing, onClick, onKeyDown }: any) {
  return (
    <button 
      role="menuitem" 
      tabIndex={-1} 
      className="arc-btn arc-btn-ghost hover:bg-gray-200/50 focus:bg-gray-200/50" 
      onClick={onClick} 
      onKeyDown={onKeyDown}
      style={{
      display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 10px', borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer', color: ARC.text, fontFamily: 'inherit', fontSize: 13, textAlign: 'left'
    }}>
      {icon && <span style={{ width: 16, display: 'flex' }}>{icon}</span>}
      <span style={{ flex: 1 }}>{label}</span>
      {badge > 0 && <span style={{ fontSize: 11, fontWeight: 500, color: ARC.muted, padding: '1px 6px', borderRadius: 999 }}>{badge}</span>}
      {trailing && <span style={{ fontSize: 12, color: ARC.muted }}>{trailing}</span>}
    </button>
  );
}
