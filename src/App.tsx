import { useEffect, useState } from 'react';
import { api } from './api';
import { handleMenuCommand } from './core/menuHistory';
import { PhotoLibraryProvider } from './core/library';
import { ToastProvider } from './ui/Toast';
import { CollageView } from './collage/CollageView';
import { StoryView } from './story/StoryView';
import { BordersView } from './borders/BordersView';

export type Mode = 'collage' | 'story' | 'borders';

const TABS: { id: Mode; label: string }[] = [
  { id: 'collage', label: 'Collage' },
  { id: 'story', label: 'Story' },
  { id: 'borders', label: 'Borders' },
];

function Brand() {
  return (
    <div className="brand">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id="brandFill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6366f1" /><stop offset="1" stopColor="#8b5cf6" /></linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill="url(#brandFill)" />
        <rect x="6" y="6" width="9" height="12" rx="2" fill="#fff" />
        <rect x="17" y="6" width="9" height="7" rx="2" fill="#fff" opacity=".7" />
        <rect x="6" y="20" width="9" height="6" rx="2" fill="#fff" opacity=".7" />
        <rect x="17" y="15" width="9" height="11" rx="2" fill="#fff" />
      </svg>
      Collage
    </div>
  );
}

export function App() {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const saved = localStorage.getItem('collage.mode');
      return TABS.some((t) => t.id === saved) ? (saved as Mode) : 'collage';
    } catch {
      return 'collage';
    }
  });
  useEffect(() => api.onMenuCommand((cmd) => { handleMenuCommand(cmd, document.activeElement, (c) => document.execCommand(c)); }), []);
  const choose = (m: Mode) => {
    setMode(m);
    try { localStorage.setItem('collage.mode', m); } catch { /* storage unavailable */ }
  };

  return (
    <ToastProvider>
      <PhotoLibraryProvider>
        <div className="app">
          <header className="topbar">
            <Brand />
            <nav className="tabs" role="tablist" aria-label="Mode">
              {TABS.map((t) => (
                <button key={t.id} role="tab" type="button" aria-selected={mode === t.id} onClick={() => choose(t.id)}>
                  {t.label}
                </button>
              ))}
            </nav>
            <div className="spacer" id="topbar-actions" />
          </header>
          <main className="mode-host">
            <div className="mode-pane" hidden={mode !== 'collage'}><CollageView /></div>
            <div className="mode-pane" hidden={mode !== 'story'}><StoryView /></div>
            <div className="mode-pane" hidden={mode !== 'borders'}><BordersView /></div>
          </main>
        </div>
      </PhotoLibraryProvider>
    </ToastProvider>
  );
}
