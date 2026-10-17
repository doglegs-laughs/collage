# Collage desktop: plan and contracts

Source of truth for all implementers. Reference behavior: `reference/index.html` (browser collage app) and `reference/README.md`.

## Stack (chosen for fast prototyping, low maintenance, one codebase for Mac/Windows/Linux)

- Electron (main + preload, plain CommonJS, small) + Vite + React 18 + TypeScript (strict) renderer.
- No UI framework or CSS library. Plain CSS modules-free: one `src/styles.css` with CSS variables (light + dark via `prefers-color-scheme`). Visual style follows `reference/index.html` (indigo accent, rounded cards, frosted top bar).
- Tests: Vitest for pure logic (`src/core`, `src/story/templates.ts`, etc.). Playwright `_electron` smoke test under xvfb.
- Video: bundled `ffmpeg-static` binary, driven from the main process.
- HEIC: Chromium cannot decode HEIC. On macOS the main process converts with the built-in `sips` to a temp JPEG. Other platforms: show a clear error.
- Packaging: electron-builder, mac `zip` for arm64 and x64 (unsigned), plus `dir` for local runs. Mac ffmpeg binaries fetched by `scripts/fetch-ffmpeg.mjs` into `resources/ffmpeg/<platform>-<arch>/ffmpeg`.

Dependencies allowed: electron, electron-builder, vite, @vitejs/plugin-react, react, react-dom, typescript, @types/*, vitest, @playwright/test, ffmpeg-static. Ask root before adding anything else.

## Layout

```
package.json, tsconfig.json, vite.config.ts, electron-builder.yml
electron/main.cjs        window, menus, IPC handlers
electron/preload.cjs     exposes window.api (contextIsolation on, nodeIntegration off)
electron/video.cjs       ffmpeg slideshow builder
src/main.tsx, App.tsx    top bar with mode tabs: Collage | Story | Borders
src/api.ts               typed wrapper/types for window.api (falls back gracefully in plain browser for dev)
src/core/geometry.ts     ported pure math (cropBox, cellSizeFor, zoomAt, defaultBorder, outputSize, edges)
src/core/images.ts       Photo type, import from File/path, oriented ImageBitmap cache, thumbnails
src/core/canvas.ts       makeCanvas (size probe), drawSmooth, drawPhotoCropped, toJpegBlob
src/core/recents.ts      IndexedDB recents (port of reference, max 60)
src/core/history.ts      generic undo/redo stack hook (useHistory)
src/ui/*                 shared components: PhotoFrame (crop pan/zoom), Stepper, Segmented, Slider, Toast, PhotoTray
src/collage/*            Collage mode (port of reference)
src/story/model.ts       story types and pure helpers
src/story/templates.ts   template catalog + layout functions
src/story/autofill.ts    distribute photos over templates
src/story/render.ts      render one page to canvas (shared by preview thumbnails and export)
src/story/*.tsx          editor UI
src/story/export.ts      export pages as JPEGs / video
src/borders/*            batch border mode
tests/                   vitest + e2e
```

## window.api (preload)

All binary payloads are `ArrayBuffer`/`Uint8Array`.

```ts
interface Api {
  platform: 'darwin' | 'win32' | 'linux';
  pathForFile(file: File): string;                     // webUtils.getPathForFile
  openImages(): Promise<string[]>;                     // native multi-select dialog
  openAudio(): Promise<string | null>;
  readFile(path: string): Promise<Uint8Array>;         // HEIC/HEIF on darwin -> converted JPEG bytes
  saveFile(opts: { defaultName: string; filters: {name: string; extensions: string[]}[]; data: Uint8Array }): Promise<string | null>; // dialog, atomic write
  chooseFolder(): Promise<string | null>;
  writeFile(path: string, data: Uint8Array): Promise<void>; // atomic temp+rename; refuses to overwrite unless allowed
  exists(path: string): Promise<boolean>;
  makeVideo(job: VideoJob): Promise<string>;           // returns output path
  onVideoProgress(cb: (fraction: number) => void): () => void;
  cancelVideo(): Promise<void>;
  revealInFolder(path: string): void;
  saveProject(json: string, suggestedName: string): Promise<string | null>;
  openProject(): Promise<{ path: string; json: string } | null>;
}
interface VideoJob {
  output: string;                 // chosen by saveFile-like dialog in main (pass '' to prompt)
  frames: Uint8Array[];           // one JPEG per page, all same size (even dimensions)
  durations: number[];            // seconds per page
  transition: 'none' | 'crossfade';
  transitionSeconds: number;      // e.g. 0.6
  kenBurns: boolean;              // slow 1.0 -> 1.06 zoom per page
  audioPath?: string;             // optional music; trimmed to video length, 1.5 s fade out
  fps: number;                    // 30
}
```

Video build: write frames to a temp dir; ffmpeg with one `-loop 1 -t d -i frame_i.jpg` input per page, optional `zoompan`/`scale` for Ken Burns, chained `xfade` for crossfade, `format=yuv420p`, `libx264 -crf 18 -preset medium -movflags +faststart`, AAC 192k audio with `afade`, `-shortest` relative to video. Parse `-progress pipe:1` `out_time_ms` for progress. Cancel kills the process and deletes partial output. Temp dir always removed.

## Core photo model

```ts
type Photo = { id: string; name: string; path?: string; file?: File; width: number; height: number; } // oriented size
type Crop = { zoom: number; cx: number; cy: number }   // same semantics as reference: zoom 1..8, center fractions of oriented photo
```
Decode with `createImageBitmap(blob, { imageOrientation: 'from-image' })`. Keep a bounded LRU of preview bitmaps (long edge ~2048) and decode full-res only during export, one at a time, closing bitmaps after use.

`cropBox(size, crop, aspect)` is the reference formula but takes the target aspect as an argument (frames in stories have arbitrary aspect). The reference's collage geometry and fixtures in `reference/README.md` and `parity` numbers must keep holding:
- 4000×3000 photo 1, 2×2, match-photo shape: default border 126, output 8378×6378.
- 20×20 same source: border 400 (slider max), output 88400×68400. 1×1 1px: border 0, output 1×1.
- Square crop of 4000×3000, zoom 1→2 anchored (.25,.75): box left 875, top 1125, 1500×1500; center (.40625, .625).
- Resizing 2×3 [A,_,B,C,D,E] to 3×2 → [A,B,C,D,E,_]; to 1×2 → [A,B].

## Mode 1: Collage (parity with reference)

Everything in reference README "What it does": grid 1..20, ten box shapes, per-tile pan/zoom/pinch/wheel/double-click reset, drag badge to swap, white border slider with auto default, recents strip toggle, export JPEG via native save dialog. Additions: "Send to Story" button adds the rendered collage as a photo to the story library; the export renders through `src/core/canvas.ts`.

## Mode 2: Story

A story is an ordered list of pages of one aspect, each a free canvas of elements. Goal: finished product in under a minute: import photos → pick a style → Auto-create → tweak → export.

```ts
type Aspect = '4:5' | '1:1' | '9:16' | '16:9' | '3:2' | '2:3';
type ElementBase = { id: string; x: number; y: number; w: number; h: number; rotation: number; z: number }; // x,y,w,h in page fractions (0..1) of page width/height; rotation degrees about center
type PhotoEl = ElementBase & { kind: 'photo'; photoId: string | null; crop: Crop; frame: number; frameColor: string; shadow: boolean }; // frame = border thickness as fraction of page width; null photoId = placeholder slot
type TextEl = ElementBase & { kind: 'text'; text: string; font: 'sans' | 'serif' | 'mono' | 'display'; size: number /* fraction of page height */; weight: 400 | 600 | 800; color: string; align: 'left' | 'center' | 'right'; letterSpacing: number; uppercase: boolean };
type El = PhotoEl | TextEl;
type Page = { id: string; templateId: string | null; background: string; elements: El[]; duration: number /* video seconds */ };
type Story = { version: 1; title: string; aspect: Aspect; background: string; pages: Page[]; photos: Photo[] /* library, without File objects when serialized */; video: { transition: 'none'|'crossfade'; transitionSeconds: number; kenBurns: boolean; audioPath: string | null; fitToMusic: boolean } };
```

Photo frame element aspect is free; the photo inside is cropped with `cropBox(size, crop, frameAspectInPixels)`. Default crop: cover, centered.

### Templates (`templates.ts`)

`type Template = { id; name; category: 'title'|'single'|'pair'|'trio'|'grid'|'story'; slots: number; fits(orientations: ('p'|'l'|'s')[]) : number /* score 0..1 */; layout(aspect, photos: Photo[], opts: { title?: string; subtitle?: string; gap: number }): El[] }`.

Required at minimum (all white background by default, uniform gutters = `gap` fraction of page width, default 0.04):
- **Title card**: big title + subtitle/date text, optionally one hero photo above or below.
- **Single, full bleed** and **Single, white border** (photo fit inside page with even margin, preserving the photo's own aspect: the classic white-border Instagram post).
- **Pair stacked** (two landscapes) and **Pair side by side** (two portraits), each preserving photo aspects and centering the group.
- **Trio**: one large + two small; and **Triptych** (three equal portrait columns).
- **Grid 2×2** and **Grid 3×3**.
- **Film strip**: 3–4 landscape frames in a vertical strip on black with sprocket marks drawn as small rounded rectangles.
- **Polaroid scatter**: 2–3 photos with thick bottom frame, slight random rotations (seeded, deterministic).
- **Magazine**: hero photo with large serif title overlapping a margin and a caption line.

Layouts must never place photos outside the page, must keep equal gutters, and must center the group both ways.

### Reference look (from user screenshots, Instagram 4:5 carousels)

Highest priority; these define the default **Carousel** style:
1. **Stack 2**: two landscapes stacked, thin white margin (~2.5% of page width) around and between, photos full width.
2. **Stack 3**: three landscapes stacked, cropped wider (≈2.6:1) to fill height, same thin margins.
3. **Matted single**: one landscape centered on white with wide side space and a thick black mat (frame ≈1.7% of page width, `frameColor` black).
4. **Seamless split**: a photo that crosses the boundary between two consecutive pages. E.g. left ~45% of the page is full-bleed photo continuing from the previous slide, right side is a portrait photo inset with thin white margin. Implemented by allowing element `x` outside 0..1: an element whose box extends past the right edge of page i is also drawn on page i+1 shifted by −1 page width (and past the left edge onto page i−1). The editor draws neighbor overflow on the current page (selectable from its owning page only) and shows a faint ghost of the overflow beyond the page edge. `renderPage` must draw own elements plus neighbors' overflowing elements so slides line up perfectly when swiped.
5. **Panorama spread**: one wide photo spanning 2 (or 3) consecutive pages as a single element, with white margin on top, bottom and the outer left/right edges only, continuous across the inner seams. Auto-fill uses it for photos wider than ~1.9:1 (or offers it for any landscape).
6. **Inset single**: one portrait centered with white margin (~5% sides, ~1.5% top/bottom when the aspect allows).
7. **Overview grid 3×2**: six tall portrait crops (≈0.48:1) with thin white gutters, used as a "contents" or closing slide.
8. **Cover**: full-bleed photo with a large display title overlaid near the top, light color, thin weight, wide letter-spacing, uppercase. Default first page when a title is entered and the first photo is portrait. Text gets an optional subtle shadow for legibility.
9. **Print mat**: two stacked landscapes inside a slightly larger "paper" rectangle drawn with a hairline light-gray outline (and a faint shadow), on white page. Implement as a `shape` element (`kind: 'rect'`, fill, stroke, strokeWidth, shadow) behind the photos.
10. **Framed portrait with shadow**: single portrait, black frame, soft large drop shadow (`shadow: true` = blur ≈3% of page width, offset ≈1%, 35% black).
11. **Polaroid on photo**: full-bleed background photo (optional `blur` property on PhotoEl, 0..1, rendered via canvas `filter: blur()` and CSS `filter` in the editor) with a polaroid card on top: off-white card, square-ish photo, thick bottom band, small caption in mono font (defaults to the date or empty), rotation −3..+3°, shadow.
12. **Stack 3 tight**: same as stack 2/3 but gutter ≈0.5% of width (hairline).
13. Light film grain is part of the source photos, not the app.

Model additions: `RectEl = ElementBase & { kind: 'rect'; fill: string; stroke: string; strokeWidth: number; shadow: boolean }`; `PhotoEl.blur: number` (0 default); `PhotoEl.frame` applies as a frame around the photo; polaroid uses `frameBottom` extra (fraction of page width, 0 default) for the thick bottom band.

Default gutter for Carousel = 0.025 of page width. Templates take `gap` and `margin` separately.

### Two headline styles (user decision)

Offer exactly two primary styles up front, others secondary ("More styles"):
- **Clean** (reference: the Faroes landscape set): cover page = full-bleed photo with large thin uppercase display title; then inset singles, panorama spreads across 2 pages, overview grid 3×2, stacks with thin even white margins. No frames, shadows or rotation. Restrained, white.
- **Stylized** (reference: the autumn portrait set): matted single with black frame, framed portrait with shadow, print mat, polaroid on blurred photo with mono caption, seamless split, stack 2/3 tight, title as a text overlay or polaroid caption. Mixed treatments, slight rotations allowed.

**One click**: the Story tab's empty state is a single big button "Make story" (style toggle Clean | Stylized beside it, title field optional). Pressing it with N imported photos (all selected by default) produces a complete multi-page story immediately, no further dialogs. Re-pressing (or "Shuffle") regenerates with a new seed. If no photos are imported yet, the button opens the picker and then generates.

### Styles and auto-fill (`autofill.ts`)

`autofill(photos, { style, aspect, title, subtitle, seed }) => Page[]`.
Styles are template sets: **Carousel** (default: stack 2, stack 3, matted single, seamless splits between consecutive pages, white-border singles), **Clean** (white border singles and pairs), **Gallery** (mix of pair/trio/grid), **Film** (film strip + black background), **Polaroid**, **Magazine**. Algorithm: title card first if title present; then greedy: look at next 1–4 photos' orientations, pick the style template with highest `fits` score (tie broken by seeded variety, never the same template three times in a row), consume photos. Photos keep their library order (user order = selection order). `relayout(page, photos, nextTemplate)` cycles a page through compatible templates keeping its photos ("Shuffle layout").

### Editor UI

- Left: **Photo tray**. Import (button, drop, paste, native dialog). Thumbnails with a check toggle (selected = used in auto-create, numbered in selection order), select all / none. Drag a thumb onto a page frame to replace, onto empty canvas to add.
- Top of center: style picker (cards with mini previews), aspect segmented control, title + subtitle fields, **Auto-create** primary button (replaces pages after confirm if pages exist).
- Center: the current page, large. Elements are absolutely positioned DOM nodes scaled from page fractions. Interactions:
  - click select, shift-click multi-select, click empty to deselect, marquee optional.
  - drag to move; 8 resize handles (corner keeps aspect with Shift toggling free; edges change frame aspect and the crop adapts); rotate handle above (Shift snaps 15°).
  - snapping guides to page center/edges and other elements' edges/centers (threshold 6 screen px).
  - double-click a photo enters crop mode: drag pans, wheel/pinch zooms (reference behavior), Esc/Enter exits.
  - double-click text edits inline.
  - keyboard: Delete, arrows nudge (Shift ×10), ⌘D duplicate, ⌘Z / ⇧⌘Z undo/redo, ⌘] / ⌘[ bring forward/backward, Esc deselect.
- Right: **Inspector** for selection: frame width/color, shadow, rotation, text props, page background, page duration, "Shuffle layout", "Reset crop".
- Bottom: **Page strip** of rendered thumbnails; drag to reorder; add blank, duplicate, delete; click to open.
- Top bar: Save project / Open project (JSON with photo paths), Export ▾: "Images (JPEG, one per page)" to a chosen folder at 1080 or 2160 wide; "Video (MP4)" with options dialog: transition, Ken Burns, music file (optional), per-page duration default 3 s, "fit to music" which spreads music length over pages.

Rendering for export and thumbnails uses one `renderPage(page, story, widthPx, getBitmap)` in `render.ts` (canvas 2D). The DOM editor must match it: same fonts (bundle no fonts; map to system stacks: sans = -apple-system/system-ui, serif = "New York", Georgia, serif, mono = ui-monospace, display = "Didot", "Bodoni 72", serif), same frame/shadow math.

## Mode 3: Borders (batch)

Drop or pick many photos (and folders not required). Options: border size as % of the long edge (default 5%), color (white default, black, custom), output canvas shape: Original (even border all round) | 1:1 | 4:5 | 9:16 (photo fit inside with at least the border on the tight sides) and output long edge: original | 2160 | 1080. Live preview of the selected photo. "Export all" to a chosen folder as `<name>-border.jpg` (quality 0.95, never overwrites: append ` 2`, ` 3`). Progress and cancel. Process one image at a time and release memory.

## Quality bar

- TypeScript strict, `npm run typecheck`, `npm test`, `npm run build` all pass.
- No `any` except at the IPC boundary.
- Keep files under ~500 lines; split components.
- Every async import/export shows progress and errors via toast.
