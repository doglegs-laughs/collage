<p align="center"><img src="docs/screenshots/icon.png" width="128" alt="Collage app icon"></p>

<h1 align="center">Collage</h1>

<p align="center">Photo collages, multi-page photo stories and batch borders. Offline, on your Mac or PC.</p>

<p align="center"><img src="docs/screenshots/story-clean.jpg" alt="Story editor with a Faroes cover page" width="900"></p>

Three tools in one window:

- **Story:** turns a folder of photos into a finished Instagram-style carousel in one click, then lets you refine every page. Export as numbered JPEGs or an MP4 with music.
- **Collage:** a single image, either as a classic grid or using any Story layout.
- **Borders:** adds a white border, black border, print mat, frame or polaroid card to many photos at once.

Photos never leave your computer.

## Download

Get the latest build from [Releases](../../releases/latest):

| File | For |
|---|---|
| `Collage-mac-arm64.zip` | Macs with Apple Silicon (M1 or later) |
| `Collage-Setup-<version>-x64.exe` | Windows 10/11 installer |
| `Collage-win-x64.zip` | Windows, portable (no install) |

The builds are not code-signed, so the first launch needs one extra step:

- **macOS:** unzip, move `Collage.app` to Applications, then run once in Terminal:
  ```
  xattr -dr com.apple.quarantine /Applications/Collage.app
  ```
- **Windows:** if SmartScreen says "Windows protected your PC", click **More info**, then **Run anyway**.

## Story

<p><img src="docs/screenshots/story-start.jpg" alt="Make story start screen" width="900"></p>

1. Add photos: **Add photos**, drag and drop, or paste. Click a thumbnail to include or exclude it. Double-click a thumbnail (or press Space) for a large preview.
2. Pick **Clean** or **Stylized**, optionally type a title and subtitle, and choose a page shape (4:5 suits Instagram).
3. Click **Make story**. **Shuffle** regenerates the whole story with a different arrangement.

<p><img src="docs/screenshots/photo-preview.jpg" alt="Large photo preview with Include toggle" width="900"></p>

**Styles**
- **Clean:** full-bleed or white-border cover in a thin display title, inset singles, stacks with even white gutters, panoramas across two slides, and an overview grid.
- **Stylized:** matted and framed prints, print mats, polaroids over a blurred photo, seamless splits and tight stacks.

<p><img src="docs/screenshots/story-spread.jpg" alt="A panorama spanning two pages" width="900"></p>

**Layouts: arrangement × finish.** Every page has an *arrangement* (where photos go: single, pair, stack, trio, grid, panorama…) and a *finish* (how they are presented: plain, tight, black borders, print mat, shadow, full bleed). Pick both from the **Layout ▾** menu in the toolbar or the Page panel. Thumbnails show your own photos. Use **‹ ›** to step through arrangements.

<p><img src="docs/screenshots/layout-picker.jpg" alt="Layout picker with finish chips and arrangement tiles" width="900"></p>

**Editing a page**
- **Drag a photo** to reposition it inside its box. **Scroll or pinch** to zoom.
- **Double-click a photo** to move or resize its box. Esc or click outside to finish.
- **Right-click** for Move to its own page, Replace photo, Reset crop, Duplicate, layer order and Delete.
- **Titles:** type a title in the Story panel, then **Add title page** or **Add to this page**. Fonts include Italiana, Playfair, Montserrat, Josefin Sans, Cormorant, Bebas Neue, Caveat, DM Mono and more, all bundled offline.
- **Pages:** drag thumbnails in the bottom strip to reorder. Click one and press Delete to remove it. Use the eye button to hide a page without deleting it; hidden pages are skipped on export.

<p><img src="docs/screenshots/story-stylized.jpg" alt="Stylized story page" width="900"></p>

**Export** (top right)
- **Images:** one JPEG per page at 1080 or 2160 px wide, numbered in order.
- **Video:** an MP4 with crossfades and a slow zoom, optionally with music, with "fit to music" timing. Panoramas that span two slides pan left to right.

**Saving:** stories autosave and reopen where you left off. **Save** / **Open** (⌘S / ⌘O) keep named copies, and File → Open Recent lists the last ten.

## Collage

<p><img src="docs/screenshots/collage-grid.jpg" alt="Collage grid mode" width="900"></p>

- **Grid:** rows × columns (1–20), ten box shapes, and a white border sized automatically. Drag inside a box to reframe, scroll to zoom, and drag the ⠿ badge to swap. The export keeps photo 1 at full resolution.
- **Layout:** any Story arrangement and finish as a single image, with page shape, background, spacing and an export size of up to the photos' own resolution.

**Send to Story** adds the finished collage to your story's photos.

<p><img src="docs/screenshots/collage-layout.jpg" alt="Collage layout mode with a print mat" width="900"></p>

## Borders

<p><img src="docs/screenshots/borders.jpg" alt="Borders tab with a print mat finish" width="900"></p>

Pick a finish (**White border, Black border, Print mat, Framed, Polaroid**), the border size, colour, canvas shape (Original, 1:1, 4:5, 9:16) and output size, then **Export all** to a folder. Each photo is saved as `<name>-border.jpg`, and existing files are never overwritten.

## Shortcuts

| Keys | Action (Story) |
|---|---|
| ⌘Z / ⇧⌘Z | Undo / redo (Ctrl on Windows) |
| ⌘S / ⌘O | Save / open story |
| ⌘D | Duplicate selection |
| ⌘A | Select all on page |
| ⌘⇧N | Move selected photo to its own page |
| ⌘⇧H | Hide or show the current page |
| ⌘] / ⌘[ | Bring forward / send backward (add ⇧ for front/back) |
| Delete | Remove selection, or the page selected in the strip |
| Arrows | Nudge selection (⇧ ×10), or change page when nothing is selected |
| ] / [ | Next / previous arrangement |
| } / { | Next / previous finish |
| Space | Large preview of the focused thumbnail |
| Esc | Deselect, or leave box-moving mode |

## Develop

Electron + React + TypeScript (Vite). ffmpeg (bundled) handles video.

```
npm install
npm run dev          # Vite + Electron with reload
npm test             # unit tests (Vitest)
npm run e2e          # Electron end-to-end tests (Linux: xvfb-run -a npm run e2e)
npm run dist:mac     # release/Collage-mac-arm64.zip, ad-hoc signed
npm run screenshots  # regenerate docs/screenshots (node scripts/screenshots.mjs <photo folder>)
```

Design notes and data contracts: [`docs/PLAN.md`](docs/PLAN.md).

## Sync a story to music beats

In **Story → Export → Video**, choose music and enable **Sync photo changes to beats**. The app detects the rhythm locally; choose **1, 2, 4, or 8 beats per page**, then make the video. Beat timing replaces manual page durations for that export, skips hidden pages, and repeats short music tracks as needed. Turn beat sync off to return to manual timing or **Fit to music length**. Music with a clear rhythm works best; analysis supports local audio files under 25 minutes.

**CI and releases.** [`.github/workflows/build.yml`](.github/workflows/build.yml) builds the Mac app and the Windows installer and zip on every pull request and push to `main`. The downloads are attached to each run. When a push to `main` changes `version` in `package.json`, the `release` job publishes GitHub Release `v<version>` with all three files once both builds pass.

Sample photos in the screenshots are from [Unsplash](https://unsplash.com) (Unsplash License).
