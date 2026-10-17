import { useEffect, useRef } from 'react';
import { isImageFile } from './images';

/** Image files in a clipboard event (pasted screenshots, copied files). */
export const clipboardImages = (e: ClipboardEvent): File[] => [...(e.clipboardData?.files ?? [])].filter(isImageFile);

/** While `active`, pasting images anywhere outside a text field hands them to `onFiles`. */
export function usePasteImages(active: boolean, onFiles: (files: File[]) => void) {
  const ref = useRef(onFiles);
  ref.current = onFiles;
  useEffect(() => {
    if (!active) return;
    const paste = (e: ClipboardEvent) => {
      const files = clipboardImages(e);
      if (!files.length) return;
      e.preventDefault();
      ref.current(files);
    };
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, [active]);
}
