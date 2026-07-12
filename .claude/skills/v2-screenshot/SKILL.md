---
name: v2-screenshot
description: Launch, navigate, screenshot, and surface a screen of the v2 (Tauri 2 + React) SpeedDeck app on macOS during development. Use when asked to screenshot/capture a v2 screen, visually verify a v2 UI change, show what a screen looks like, or compare a v2 screen against a reference design. macOS only.
---

# v2 SpeedDeck — Launch → Navigate → Capture → Surface

Reproducible loop for seeing a real v2 screen during development: launch the Tauri
dev app with simulated GPS, jump to a specific screen, screenshot just the app
window, and surface the image to the developer (optionally diffing it against a
reference).

**Platform:** macOS only. The v2 app is a Tauri WKWebView; this skill drives it with
macOS synthetic keystrokes + `screencapture`. It does not apply to v1.

## One-time prerequisites

1. **Toolchain:** Rust/Cargo installed; `cd v2 && npm install` has been run.
2. **Stub OSRM sidecar** (macOS arm64) so the Tauri build passes — routing is inert
   locally, everything else works:
   ```sh
   mkdir -p v2/src-tauri/binaries
   printf '#!/bin/sh\nexit 1\n' > v2/src-tauri/binaries/osrm-routed-$(uname -m | sed 's/arm64/aarch64/')-apple-darwin
   chmod +x v2/src-tauri/binaries/osrm-routed-*-apple-darwin
   ```
   (`v2/src-tauri/binaries/` is gitignored.)
3. **macOS permissions** for the terminal running Claude Code — grant BOTH in
   System Settings → Privacy & Security:
   - **Accessibility** (to send the navigation keystroke)
   - **Screen Recording** (to screenshot the window)
4. **Dev-nav hook** must be present: `v2/src/hooks/useDevNav.ts`, wired into
   `Shell.tsx`. It is `import.meta.env.DEV`-gated (compiled out of production) and
   adds `Ctrl+Alt+<digit>` shortcuts + a `?app=<id>` URL deep-link. If it's missing,
   recreate it before navigating (see "Dev-nav hook" below).

## Steps

### 1. Launch (if not already running)
Run from the repo root, **in the background** (use the Bash tool's `run_in_background`
so it survives the turn — do not foreground it):
```sh
cd v2 && SPEEDDECK_SIMULATOR=1 npm run tauri:dev
```
Wait until the log shows `` Running `target/debug/speeddeck` `` (first build can take a
few minutes; later runs are incremental). To wait without polling, use a Bash
`run_in_background` until-loop on the log, e.g.
`until grep -q "Running .target/debug/speeddeck." <log>; do sleep 1; done`.
`SPEEDDECK_SIMULATOR=1` forces the GPS simulator (no receiver needed).

### 2 + 3. Navigate and Capture
One command does both — it sends the nav keystroke and screenshots the window:
```sh
.claude/skills/v2-screenshot/scripts/capture.sh <screen> [output.png]
```
- `<screen>`: `home | maps | music | dashboard | nowplaying | trips | settings`
- Prints the PNG path on success. Default output: `$TMPDIR/speeddeck-<screen>.png`.

It (a) finds the running app, (b) brings its window forward and presses
`Ctrl+Alt+<digit>`, (c) resolves the window id via `scripts/winid.swift`, and
(d) `screencapture -l<id>` (captures the window even if occluded).

### 4. Surface to the developer
**Read the PNG** with the Read tool — that renders it inline so the developer sees it
— then briefly describe what's on screen and give the path. Capture more screens by
re-running step 2+3 with a different `<screen>`.

### Optional: compare against a reference
If the developer provides a reference image (mockup/Figma export/screenshot), Read both
the capture and the reference and report concrete structural diffs: layout, spacing,
alignment, color, font weight, missing/extra elements. This is a visual critique, not a
pixel diff (Retina scaling makes exact pixel diffing meaningless).

## Notes & gotchas

- **Keymap:** `0` home · `1` maps · `2` music · `3` dashboard · `4` nowplaying ·
  `5` trips · `6` settings (each with `Ctrl+Alt`). `phone` is intentionally disabled.
- **Map screens** show an empty basemap unless region PMTiles are built (gitignored);
  simulated GPS/telemetry still flows (status-bar clock + green dot).
- **Transient white flash:** capturing during a Vite HMR reload can catch a half-painted
  frame. If a capture looks wrong, just re-run it.
- **Window not found / 0 AX windows:** the unbundled dev binary registers oddly with
  Accessibility. `winid.swift` deliberately uses the CoreGraphics window list (not the
  AX tree) to avoid that; if it returns nothing, confirm the app is running and not
  minimized.
- The app keeps running between captures — reuse it across a dev cycle; relaunch only
  after a Rust change (Vite hot-reloads frontend changes automatically).

## Dev-nav hook (recreate if missing)

`v2/src/hooks/useDevNav.ts` — dev-only; reads `?app=<id>` / `#<id>` on load and binds
`Ctrl+Alt+<digit>` to switch surfaces via `useShellStore`. Call `useDevNav()` once in
`src/shell/Shell.tsx`. Digit→app map matches the keymap above (0=home). Guard the whole
hook with `if (!import.meta.env.DEV) return;`.
