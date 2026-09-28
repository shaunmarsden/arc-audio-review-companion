import React, { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({ isOpen, onClose, onConfirm }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;

        const focusableElements = dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
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
    
    // Focus the first button on mount
    const timer = setTimeout(() => {
      if (dialogRef.current) {
        const cancelBtn = dialogRef.current.querySelector('#cancel-reload-btn') as HTMLButtonElement;
        if (cancelBtn) {
            cancelBtn.focus();
        } else {
             const firstBtn = dialogRef.current.querySelector('button');
             if (firstBtn) firstBtn.focus();
        }
      }
    }, 50);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timer);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div 
      id="confirm-reload-modal" 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div 
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-description"
        className="bg-white dark:bg-gray-900 border border-gray-250 dark:border-gray-800 rounded-2xl max-w-sm w-full p-6 shadow-xl animate-in zoom-in-95 duration-200 focus:outline-none"
        tabIndex={-1}
      >
        <h3 id="dialog-title" className="text-lg font-bold text-gray-950 dark:text-white leading-tight font-sans mb-2">
          Unsaved Comments Will Be Lost
        </h3>
        <p id="dialog-description" className="text-base text-gray-600 dark:text-gray-300 leading-relaxed mb-6">
          Loading a new document clears this review and its comments. Use Download comments in the notes panel first if you want to keep them.
        </p>
        <div className="flex justify-start gap-3">
          <button
            id="confirm-reload-btn"
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl cursor-pointer shadow-xs focus-ring"
          >
            Yes, Load New
          </button>
          <button
            id="cancel-reload-btn"
            onClick={onClose}
            className="px-4 py-2 text-sm font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl cursor-pointer border border-gray-300 dark:border-gray-700 focus-ring"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
