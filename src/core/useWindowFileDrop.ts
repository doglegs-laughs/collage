import { useEffect, useRef, useState } from 'react';
import { useToast } from '../ui/Toast';
import { isAudioFile } from './audio';
import { isImageFile } from './images';

const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');

/**
 * While `active`, photo files dragged from outside the app onto anywhere in the window are handed to `onFiles`.
 * Returns true while such a drag is over the window (for the drop overlay). The app's own drags carry no 'Files' and are ignored.
 * With `onAudio`, music files in the drop go there instead of being rejected (a mixed drop calls both).
 */
export function useWindowFileDrop(active: boolean, onFiles: (files: File[]) => void, onAudio?: (files: File[]) => void): boolean {
  const toast = useToast();
  const ref = useRef(onFiles);
  ref.current = onFiles;
  const audioRef = useRef(onAudio);
  audioRef.current = onAudio;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!active) return;
    let depth = 0; // dragenter/dragleave fire for every child element crossed
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setOver(true); } };
    const leave = (e: DragEvent) => { if (hasFiles(e) && --depth <= 0) { depth = 0; setOver(false); } };
    const dragOver = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      const taken = e.defaultPrevented; // the tray's own drop handler already added these
      e.preventDefault(); // never let the window navigate to the dropped file
      depth = 0;
      setOver(false);
      if (taken) return;
      const dropped = [...(e.dataTransfer?.files ?? [])];
      const files = dropped.filter(isImageFile);
      const music = audioRef.current ? dropped.filter(isAudioFile) : [];
      if (files.length) ref.current(files);
      if (music.length) audioRef.current!(music);
      if (!files.length && !music.length) toastRef.current(audioRef.current ? 'Only photos or music can be added' : 'Only photos can be added', 'error');
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', dragOver);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', dragOver);
      window.removeEventListener('drop', drop);
      setOver(false);
    };
  }, [active]);
  return over;
}
