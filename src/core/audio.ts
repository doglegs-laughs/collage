/** Same list as AUDIO_EXT in electron/main.cjs (the native music dialog). */
export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'aiff', 'flac', 'ogg'];
const AUDIO_NAME = new RegExp(`\\.(${AUDIO_EXTENSIONS.join('|')})$`, 'i');

export const isAudioFile = (file: { name: string }) => AUDIO_NAME.test(file.name);

export type DroppedMusic = { path: string; name: string } | { error: string };

/** The first audio file of a drop as a music choice. A file the app cannot locate on disk (no real path) is an error. */
export function musicFromDrop<F extends { name: string }>(files: F[], pathFor: (file: F) => string): DroppedMusic | null {
  const file = files.find(isAudioFile);
  if (!file) return null;
  const path = pathFor(file);
  return path ? { path, name: path.split(/[\\/]/).pop() || file.name } : { error: `Could not find "${file.name}" on this computer. Choose it with Choose music… instead.` };
}
