/** Full-window hint shown while photos are dragged over the app (see useWindowFileDrop). */
export function DropOverlay({ show }: { show: boolean }) {
  return show ? <div className="drop-overlay" aria-hidden="true">Drop photos to add them</div> : null;
}
