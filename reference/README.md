# Collage

A photo collage maker that runs entirely in the browser: one self-contained
`index.html`, no server, no install, no internet needed. Works on macOS,
Windows, Linux, iPad, and phones. Photos never leave the device.

**To use:** double-click `index.html` (or `launch.command` on this Mac).
**To share:** send `index.html` itself (rename it to `Collage.html` if you like),
or host it on any static web host and send the link.

## What it does

Pick a grid (1×1 to 20×20) and a box shape, add photos (button, drop anywhere,
paste, or click a box), frame each one, and export a JPEG.

- **Framing:** scroll / pinch / slider to zoom up to 8×, drag to reframe,
  double-click to reset, drag the ⠿ badge to reorder. Two-finger pinch on
  touch screens.
- **Box shape:** match photo 1, or 1:1, 4:5, 3:4, 2:3, 9:16, 5:4, 4:3, 3:2, 16:9.
- **Border:** white, defaults to 1.5% of the output width.
- **Recents:** every photo added is kept in this browser's storage (IndexedDB)
  for next time; click to add, click a ✓ to take it out, × to forget it.
  Newest 60 are kept.
- **Export:** downloads a JPEG; on phones/tablets opens the share sheet so it can
  be saved to Photos.

## Non-obvious logic

- **Output size.** Each tile is the largest box of the chosen shape inside
  photo 1, so photo 1 is never upscaled. Output = tiles × grid + border × (n + 1).
- **One crop formula for preview and export.** `cropBox()` gives the source
  rectangle each tile shows; the preview positions the `<img>` with it and the
  export `drawImage`s the same rectangle, so the JPEG matches the screen.
  Crops are stored as zoom + window center (fractions of the photo), so they
  survive changes to box shape. The `min()` caps absorb float error that once
  produced a −1e-13 offset.
- **Canvas limits.** Browsers cap canvas size (iPhone Safari ≈ 16.7 MP) and fail
  silently past it, so `makeCanvas()` probes by writing and reading the last
  pixel, shrinking 20% at a time; the user is told if the export was reduced.
- **Downscaling quality.** `drawSmooth()` halves in steps before the final draw,
  because one big canvas downscale skips pixels and looks jagged.
- **Recents identity.** SHA-256 of the file (first 8 bytes) when
  `crypto.subtle` exists; otherwise name + size + date. If IndexedDB is blocked
  (some browsers block storage for files opened from disk), the Recents section
  simply hides.

## Files

| File | Role |
|---|---|
| `index.html` | The whole app: markup, styles, and script |
| `launch.command` | macOS double-click launcher; opens `index.html` in the default browser |
| `.claude/launch.json` | Static server on port 8011 for previewing in Claude Code |

The earlier Python/Pillow server version is in git history (before the
"single-file browser app" commit). Its `recents/` folder, if present, is
ignored by git and not used anymore.
