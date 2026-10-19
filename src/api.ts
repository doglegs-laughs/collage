export interface VideoJob {
  /** Output path; empty asks the user with a save dialog. */
  output: string;
  /** Default file name in that dialog. */
  suggestedName?: string;
  frames: Uint8Array[];
  durations: number[];
  transition: 'none' | 'crossfade';
  /** Per-boundary override (length = frames - 1). 'slide' pans both pages together. */
  transitions?: ('none' | 'crossfade' | 'slide')[];
  transitionSeconds: number;
  /** Per-boundary fade length (length = frames - 1); overrides `transitionSeconds` where present. */
  transitionDurations?: number[];
  /** Photo changes are timed to music beats: fades are centred on the boundary instead of starting at it. */
  beatSync?: boolean;
  /** Music repeats every this many seconds (shorter than the file when it ends in silence). */
  audioLoopSeconds?: number;
  kenBurns: boolean;
  /** Per-page Ken Burns switch (length = frames); overrides `kenBurns` when present. */
  kenBurnsPages?: boolean[];
  audioPath?: string;
  /** The music starts this many seconds into the file (after any looping). */
  audioStartSeconds?: number;
  fps: number;
  /** Cache key from `videoCacheLookup`. With no frames, the cached video is copied to the output; with frames, the finished video is kept in the cache under this key. */
  cacheKey?: string;
}

export interface VideoCacheLookup { key: string | null; hit: boolean }

/** A photo that has no file on disk (pasted, sent from Collage); saved beside the project so it can be found again. */
export interface SidecarPhoto { id: string; name: string; data: Uint8Array }

/** `peaks`: loudness envelope for drawing the waveform, 0..1 per bucket across `duration` (absent in analyses made before it existed). */
export interface BeatAnalysis { beats: number[]; duration: number; bpm: number; peaks?: number[] }

export interface FileFilter { name: string; extensions: string[] }

export interface Api {
  platform: 'darwin' | 'win32' | 'linux';
  pathForFile(file: File): string;
  openImages(): Promise<string[]>;
  openAudio(): Promise<string | null>;
  analyzeAudio(path: string): Promise<BeatAnalysis>;
  readFile(path: string): Promise<Uint8Array>;
  saveFile(opts: { defaultName: string; filters: FileFilter[]; data: Uint8Array }): Promise<string | null>;
  chooseFolder(): Promise<string | null>;
  /** Temp + rename/link, or exclusive copy on filesystems without hard links. Refuses to replace an existing file unless `overwrite` is true. */
  writeFile(path: string, data: Uint8Array, options?: { overwrite?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Resolves to the output path, or '' if the user cancelled the save dialog. */
  /** Whether a video for exactly this spec (see videoCacheSpec) was already made and kept. */
  videoCacheLookup(spec: unknown): Promise<VideoCacheLookup>;
  makeVideo(job: VideoJob): Promise<string>;
  onVideoProgress(cb: (fraction: number) => void): () => void;
  cancelVideo(): Promise<void>;
  revealInFolder(path: string): void;
  /**
   * Saves the project JSON. `sidecar` photos are written to `<project name> Photos/` next to it and their
   * `path` in the JSON becomes that relative path. Resolves to the saved path, or null if cancelled.
   */
  saveProject(json: string, suggestedName: string, sidecar?: SidecarPhoto[]): Promise<string | null>;
  /** Tells the main process whether there is unsaved Story work (asks before closing or quitting). */
  setDirty(dirty: boolean): void;
  openProject(): Promise<{ path: string; json: string } | null>;
  getRecentStories(): Promise<RecentStory[]>;
  removeRecentStory(path: string): Promise<void>;
  /** Reads a recent project; null (and drops it from the list) when the file is gone. */
  openRecentStory(path: string): Promise<{ path: string; json: string } | null>;
  /** Fires when File > Open Recent picks a project. */
  onOpenRecent(cb: (file: { path: string; json: string }) => void): () => void;
  /** Writes the autosave. `sidecar` holds photos with no file on disk that have not been sent yet. */
  autosaveWrite(json: string, sidecar: SidecarPhoto[], meta: AutosaveMeta): Promise<boolean>;
  autosaveRead(): Promise<AutosaveFile | null>;
  autosaveClear(): Promise<void>;
  /** The main process asks for an immediate autosave before closing; resolve true when it is written. */
  onAutosaveFlush(cb: () => Promise<boolean>): () => void;
  /** Edit > Undo / Redo (the menu owns the shortcuts, so the renderer never sees the key). */
  onMenuCommand(cb: (command: 'undo' | 'redo') => void): () => void;
}

export interface RecentStory { path: string; name: string; exists: boolean }
export interface AutosaveMeta { savedAt?: number; title?: string; pageCount?: number; thumb?: string | null }
export interface AutosaveFile { path: string; json: string; meta: AutosaveMeta }

declare global {
  interface Window { api?: Api }
}

export const isDesktop = (): boolean => typeof window !== 'undefined' && !!window.api;

const unsupported = (what: string) => () => {
  throw new Error(`${what} needs the desktop app.`);
};

function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept, multiple });
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

const mimeFor = (name: string) =>
  /\.jpe?g$/i.test(name) ? 'image/jpeg' : /\.png$/i.test(name) ? 'image/png' : /\.json$|\.collage$/i.test(name) ? 'application/json' : 'application/octet-stream';

const AUTOSAVE_KEY = 'collage-autosave';
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

const browserApi: Api = {
  platform: 'linux',
  pathForFile: () => '',
  openImages: unsupported('Choosing files by path'),
  openAudio: unsupported('Choosing music'),
  analyzeAudio: unsupported('Detecting music beats'),
  readFile: unsupported('Reading files by path'),
  async saveFile({ defaultName, data }) {
    download(data as BlobPart, defaultName, mimeFor(defaultName));
    return defaultName;
  },
  chooseFolder: unsupported('Choosing a folder'),
  writeFile: unsupported('Writing to a folder'),
  exists: async () => false,
  videoCacheLookup: async () => ({ key: null, hit: false }),
  makeVideo: unsupported('Making video'),
  onVideoProgress: () => () => {},
  cancelVideo: async () => {},
  setDirty: () => {},
  revealInFolder: () => {},
  async saveProject(json, suggestedName) {
    download(json, suggestedName, 'application/json');
    return suggestedName;
  },
  getRecentStories: async () => [],
  removeRecentStory: async () => {},
  openRecentStory: async () => null,
  onOpenRecent: () => () => {},
  async autosaveWrite(json, _sidecar, meta) {
    try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ json, meta: { ...meta, savedAt: Date.now() } })); return true; } catch { return false; }
  },
  async autosaveRead() {
    const raw = lsGet(AUTOSAVE_KEY);
    try { return raw ? { path: '', ...(JSON.parse(raw) as { json: string; meta: AutosaveMeta }) } : null; } catch { return null; }
  },
  async autosaveClear() { try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ } },
  onAutosaveFlush: () => () => {},
  onMenuCommand: () => () => {},
  async openProject() {
    const [file] = await pickFiles('.collage,.json,application/json', false);
    return file ? { path: file.name, json: await file.text() } : null;
  },
};

/** The preload-provided API, or a limited browser fallback when running without Electron. */
export const api: Api = new Proxy({} as Api, {
  get: (_t, key: string) => (window.api ?? browserApi)[key as keyof Api],
});
