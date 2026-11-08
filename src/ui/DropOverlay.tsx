/** Full-window hint shown while files are dragged over the app (see useWindowFileDrop). */
export function DropOverlay({ show, music = false }: { show: boolean; music?: boolean }) {
  return show ? <div className="drop-overlay" aria-hidden="true">{music ? 'Drop photos or music' : 'Drop photos to add them'}</div> : null;
}
