export interface VideoJob {
  output: string;
  frames: Uint8Array[];
  durations: number[];
  transition: 'none' | 'crossfade';
  transitionSeconds: number;
  kenBurns: boolean;
  audioPath?: string;
  fps: number;
}

export interface FileFilter { name: string; extensions: string[] }

export interface Api {
  platform: 'darwin' | 'win32' | 'linux';
  pathForFile(file: File): string;
  openImages(): Promise<string[]>;
  openAudio(): Promise<string | null>;
  readFile(path: string): Promise<Uint8Array>;
  saveFile(opts: { defaultName: string; filters: FileFilter[]; data: Uint8Array }): Promise<string | null>;
  chooseFolder(): Promise<string | null>;
  /** Atomic temp + rename. Refuses to replace an existing file unless `overwrite` is true. */
  writeFile(path: string, data: Uint8Array, options?: { overwrite?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Resolves to the output path, or '' if the user cancelled the save dialog. */
  makeVideo(job: VideoJob): Promise<string>;
  onVideoProgress(cb: (fraction: number) => void): () => void;
  cancelVideo(): Promise<void>;
  revealInFolder(path: string): void;
  saveProject(json: string, suggestedName: string): Promise<string | null>;
  openProject(): Promise<{ path: string; json: string } | null>;
}

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

const browserApi: Api = {
  platform: 'linux',
  pathForFile: () => '',
  openImages: unsupported('Choosing files by path'),
  openAudio: unsupported('Choosing music'),
  readFile: unsupported('Reading files by path'),
  async saveFile({ defaultName, data }) {
    download(data as BlobPart, defaultName, mimeFor(defaultName));
    return defaultName;
  },
  chooseFolder: unsupported('Choosing a folder'),
  writeFile: unsupported('Writing to a folder'),
  exists: async () => false,
  makeVideo: unsupported('Making video'),
  onVideoProgress: () => () => {},
  cancelVideo: async () => {},
  revealInFolder: () => {},
  async saveProject(json, suggestedName) {
    download(json, suggestedName, 'application/json');
    return suggestedName;
  },
  async openProject() {
    const [file] = await pickFiles('.collage,.json,application/json', false);
    return file ? { path: file.name, json: await file.text() } : null;
  },
};

/** The preload-provided API, or a limited browser fallback when running without Electron. */
export const api: Api = new Proxy({} as Api, {
  get: (_t, key: string) => (window.api ?? browserApi)[key as keyof Api],
});
