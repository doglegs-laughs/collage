import type { BoundaryTransition } from '../model';

const base = { viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const TRANSITION_LABEL: Record<BoundaryTransition, string> = { none: 'cut', crossfade: 'crossfade', slide: 'slide' };

/** Cut: two blocks with a gap. Crossfade: two overlapping rings. Slide: an arrow between two blocks. */
export function TransitionIcon({ kind }: { kind: BoundaryTransition }) {
  if (kind === 'none') return <svg {...base}><path d="M3 5.5v9M17 5.5v9M8 10h4" /></svg>;
  if (kind === 'crossfade') return <svg {...base}><circle cx="7.5" cy="10" r="4.6" /><circle cx="12.5" cy="10" r="4.6" /></svg>;
  return <svg {...base}><path d="M3.5 10h12M11.5 6l4 4-4 4" /></svg>;
}

export const LockIcon = () => <svg {...base} strokeWidth={2}><rect x="4.5" y="9" width="11" height="8" rx="2" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></svg>;
export const PlayIcon = () => <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M6 3.8v12.4a.8.8 0 0 0 1.2.7l10-6.2a.8.8 0 0 0 0-1.4l-10-6.2A.8.8 0 0 0 6 3.8Z" /></svg>;
export const PauseIcon = () => <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><rect x="4.5" y="3.5" width="4" height="13" rx="1" /><rect x="11.5" y="3.5" width="4" height="13" rx="1" /></svg>;
