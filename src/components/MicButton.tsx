import React, { useEffect } from 'react';

const ARC_MIC_CSS = `
/* Mic active-state indicator — soft glow + shimmer animation. */
.arc-mic-btn {
  position: relative;
  overflow: visible;
  width: 48px; height: 48px;
  border-radius: 999px;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; padding: 0;
  background: transparent;
  border: 1px solid rgba(40,30,20,0.10);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.6);
  color: #1a1a1a;
  transition: background 120ms ease, box-shadow 120ms ease, transform 80ms ease;
}
.arc-mic-btn:hover  { background: rgba(40,30,20,0.035); }
.arc-mic-btn:active {
  background: rgba(40,30,20,0.06);
  box-shadow: inset 0 1px 2px rgba(40,30,20,0.10), inset 0 -1px 0 rgba(255,255,255,0.4);
  transform: translateY(0.5px);
}
.arc-mic-btn:focus-visible {
  outline: 2.5px solid #1a8a82;
  outline-offset: 2px;
}
.arc-mic-btn[data-muted="true"] {
  background: rgba(40,30,20,0.06);
  box-shadow: inset 0 1px 2px rgba(40,30,20,0.10), inset 0 -1px 0 rgba(255,255,255,0.4);
  color: rgba(40,30,20,0.55);
}

.arc-mic-glow {
  position: absolute; inset: 0; border-radius: 999px;
  background: transparent;
  box-shadow: 0 0 10px 2px color-mix(in srgb, var(--mic-accent, #4ECDC4) 60%, transparent);
  pointer-events: none;
  will-change: transform, opacity;
  z-index: 0;
  animation: arcMicShimmer 3.4s ease-in-out infinite;
}

.arc-mic-icon {
  position: relative;
  z-index: 1;
  display: flex;
}

@keyframes arcMicShimmer {
  0%, 100% { transform: scale(0.94); opacity: 0.55; }
  50%      { transform: scale(1.12); opacity: 0.95; }
}

@media (prefers-reduced-motion: reduce) {
  .arc-mic-glow { animation: none; opacity: 0.85; }
}
`;

function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('arc-mic-styles')) return;
  const s = document.createElement('style');
  s.id = 'arc-mic-styles';
  s.textContent = ARC_MIC_CSS;
  document.head.appendChild(s);
}

function IconMicStrike({ muted = false, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth={1.6}
         strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      {muted && <line x1="4" y1="4" x2="20" y2="20" strokeWidth={1.8} />}
    </svg>
  );
}

export function MicButton({ muted = false, onToggle, indicator = 'none' }: { muted?: boolean, onToggle: () => void, indicator?: string }) {
  useEffect(() => { injectStyles(); }, []);

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={muted ? 'Unmute microphone' : 'Microphone active'}
      aria-pressed={muted}
      data-muted={muted ? 'true' : 'false'}
      className="arc-mic-btn flex-shrink-0"
    >
      {!muted && indicator === 'pulse' && <span className="mic-pulse-ring" aria-hidden="true" />}
      {!muted && indicator !== 'none' && <span className="arc-mic-glow" aria-hidden="true" />}
      <span className="arc-mic-icon">
        <IconMicStrike muted={muted} size={22} />
      </span>
    </button>
  );
}
