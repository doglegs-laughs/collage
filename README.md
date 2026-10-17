# Collage

Desktop photo app (Electron + React + TypeScript). Apple Silicon Mac first; the same code runs on Windows and Linux.

- **Collage:** grid collage, same behavior as the original browser app (`reference/`).
- **Story:** one click turns your photos into a multi-page story in a Clean or Stylized style. Edit afterwards: drag, resize, rotate, crop, text and reorder pages. Export as JPEGs or as an MP4, with or without music. Panoramas spanning two slides use a left-to-right slide transition.
- **Borders:** add a white (or any color) border to many photos at once.

## Install (unsigned build)

Unzip `Collage-mac-arm64.zip`, move `Collage.app` to Applications, then run once:

```
xattr -dr com.apple.quarantine /Applications/Collage.app
```

## Develop

```
npm install
npm run dev          # Vite + Electron
npm test             # unit tests
npm run e2e          # Electron end-to-end tests (Linux: xvfb-run -a npm run e2e)
npm run dist:mac     # release/Collage-mac-arm64.zip, ad-hoc signed
```

Design and contracts: `docs/PLAN.md`.
