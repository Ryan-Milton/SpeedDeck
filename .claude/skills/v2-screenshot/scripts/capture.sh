#!/usr/bin/env bash
# Navigate the running SpeedDeck (v2) dev app to a screen and screenshot its window.
#
# Usage:   capture.sh <screen> [output.png]
#   screen: home | maps | music | dashboard | nowplaying | trips | settings
#
# Requires (see ../SKILL.md):
#   - The v2 dev app already running:  cd v2 && SPEEDDECK_SIMULATOR=1 npm run tauri:dev
#   - macOS Accessibility + Screen Recording permission granted to the terminal
#   - The dev-nav hook in the app (src/hooks/useDevNav.ts) — provides Ctrl+Alt+<digit> nav
#
# Prints the path of the written PNG on success.
set -euo pipefail

SCREEN="${1:-home}"
OUT="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Map screen name -> AppleScript key code for its Ctrl+Alt+<digit> shortcut.
# (macOS ships bash 3.2 with no associative arrays, so use case.)
case "$SCREEN" in
  home)       KC=29 ;; # 0
  maps)       KC=18 ;; # 1
  music)      KC=19 ;; # 2
  dashboard)  KC=20 ;; # 3
  nowplaying) KC=21 ;; # 4
  trips)      KC=23 ;; # 5
  settings)   KC=22 ;; # 6
  *)
    echo "unknown screen: '$SCREEN'" >&2
    echo "expected one of: home maps music dashboard nowplaying trips settings" >&2
    exit 2 ;;
esac

PID="$(pgrep -f 'target/debug/speeddeck' | head -1 || true)"
if [ -z "$PID" ]; then
  echo "SpeedDeck dev app is not running. Start it first:" >&2
  echo "  cd v2 && SPEEDDECK_SIMULATOR=1 npm run tauri:dev" >&2
  exit 1
fi

# Bring the window forward and send the dev-nav keystroke.
if ! osascript >/dev/null 2>&1 <<AS
tell application "System Events"
  set frontmost of (first process whose unix id is $PID) to true
  delay 0.5
  key code $KC using {control down, option down}
end tell
AS
then
  echo "AppleScript/keystroke failed." >&2
  echo "Grant the terminal 'Accessibility' in System Settings > Privacy & Security." >&2
  exit 1
fi

# Let the React view switch + repaint before capturing.
sleep 1

WID="$(swift "$SCRIPT_DIR/winid.swift" 2>/dev/null || true)"
if [ -z "$WID" ]; then
  echo "Could not locate the SpeedDeck window (is it minimized?)." >&2
  exit 1
fi

if [ -z "$OUT" ]; then
  OUT="${TMPDIR:-/tmp}/speeddeck-${SCREEN}.png"
fi

# -x: silent, -o: omit window shadow, -l: capture this window id (works when occluded).
if ! screencapture -x -o -l"$WID" -t png "$OUT" 2>/dev/null; then
  echo "screencapture failed." >&2
  echo "Grant the terminal 'Screen Recording' in System Settings > Privacy & Security." >&2
  exit 1
fi

echo "$OUT"
