#!/usr/bin/env bash
set -euo pipefail

# SpeedDeck v2 — Steam Deck (SteamOS) installer.
# Installs the AppImage, a udev rule for the USB GPS receiver, a systemd *user*
# service, and a udev-triggered auto-launch on GPS connect. Falls back to the
# "Add as Non-Steam Game" flow for Gaming Mode.
#
# Usage: bash setup-steamos.sh [path-to-SpeedDeck.AppImage]
#
# SteamOS notes: the rootfs is immutable, so the service lives under the user's
# ~/.config; only the udev rule (in /etc) needs sudo.

APP_NAME="SpeedDeck"
USER_NAME="$(id -un)"
USER_UID="$(id -u)"
INSTALL_DIR="$HOME/Applications"
DEST="$INSTALL_DIR/$APP_NAME.AppImage"
BIN_DIR="$HOME/.local/bin"
LAUNCH_HELPER="$BIN_DIR/speeddeck-udev-launch.sh"
UDEV_FILE="/etc/udev/rules.d/99-speeddeck-gps.rules"
UNIT_FILE="$HOME/.config/systemd/user/speeddeck.service"
DESKTOP_FILE="$HOME/.local/share/applications/SpeedDeck.desktop"

echo "=== SpeedDeck — SteamOS Setup ==="

# --- 1. Locate + install the AppImage ---
APPIMAGE="${1:-}"
if [[ -z "$APPIMAGE" ]]; then
  APPIMAGE="$(ls -1 \
    ~/Downloads/SpeedDeck*.AppImage \
    ~/Desktop/SpeedDeck*.AppImage \
    ./SpeedDeck*.AppImage \
    ./src-tauri/target/release/bundle/appimage/*.AppImage \
    2>/dev/null | head -1 || true)"
fi
if [[ -z "$APPIMAGE" || ! -f "$APPIMAGE" ]]; then
  echo "Error: no AppImage found. Usage: bash setup-steamos.sh /path/to/SpeedDeck.AppImage" >&2
  exit 1
fi
mkdir -p "$INSTALL_DIR"
cp "$APPIMAGE" "$DEST"
chmod +x "$DEST"
echo "[1/5] Installed AppImage -> $DEST"

# --- 2. udev: serial access + auto-launch on GPS connect ---
# Common USB GNSS / USB-serial bridge vendor IDs (broadened beyond v1's 067b):
#   067b Prolific PL2303 · 10c4 Silicon Labs CP210x · 0403 FTDI ·
#   1546 u-blox · 1a86 QinHeng CH340 · 067b/2303 PL2303 variants
VENDORS=(067b 10c4 0403 1546 1a86)

mkdir -p "$BIN_DIR"
cat > "$LAUNCH_HELPER" <<EOF
#!/usr/bin/env bash
# Triggered by udev (as root) when the GPS receiver is plugged in; starts the
# SpeedDeck user service in ${USER_NAME}'s graphical session.
export XDG_RUNTIME_DIR="/run/user/${USER_UID}"
/usr/bin/systemctl --user --machine="${USER_NAME}@.host" start speeddeck.service \
  || /usr/bin/su "${USER_NAME}" -c "XDG_RUNTIME_DIR=/run/user/${USER_UID} /usr/bin/systemctl --user start speeddeck.service"
EOF
chmod +x "$LAUNCH_HELPER"

{
  echo "# SpeedDeck — USB GPS receiver: non-root access + auto-launch"
  for v in "${VENDORS[@]}"; do
    echo "SUBSYSTEM==\"tty\", ATTRS{idVendor}==\"$v\", MODE=\"0660\", TAG+=\"uaccess\""
  done
  for v in "${VENDORS[@]}"; do
    echo "ACTION==\"add\", SUBSYSTEM==\"tty\", ATTRS{idVendor}==\"$v\", RUN+=\"$LAUNCH_HELPER\""
  done
} | sudo tee "$UDEV_FILE" > /dev/null
sudo udevadm control --reload-rules
sudo udevadm trigger
echo "[2/5] Installed udev rule -> $UDEV_FILE (vendors: ${VENDORS[*]})"

# --- 3. systemd user service ---
mkdir -p "$(dirname "$UNIT_FILE")"
cat > "$UNIT_FILE" <<EOF
[Unit]
Description=SpeedDeck CarPlay
After=graphical-session.target
PartOf=graphical-session.target

[Service]
Type=simple
ExecStart=%h/Applications/$APP_NAME.AppImage --no-sandbox
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable speeddeck.service >/dev/null 2>&1 || true
echo "[3/5] Installed systemd user service -> $UNIT_FILE"

# --- 4. Desktop entry (Gaming Mode / launcher) ---
mkdir -p "$(dirname "$DESKTOP_FILE")"
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Name=$APP_NAME
Exec="$DEST" --no-sandbox
Icon=$APP_NAME
Type=Application
Categories=Utility;
Comment=CarPlay-style infotainment for the Steam Deck
Terminal=false
EOF
echo "[4/5] Created desktop entry -> $DESKTOP_FILE"

# --- 5. Next steps ---
echo "[5/5] Done."
cat <<EOF

=== Next steps ===

Auto-boot (Desktop Mode — the supported kiosk path):
  • Set the Deck to boot into Desktop Mode (KDE Plasma).
  • Plug in the USB GPS receiver — udev starts speeddeck.service automatically,
    and the app opens fullscreen. (Or run: systemctl --user start speeddeck.service)

Gaming Mode (manual launch):
  1. Desktop Mode → Steam → Games → Add a Non-Steam Game → "$APP_NAME".
  2. Right-click → Properties → Launch Options:  --no-sandbox
  3. Right-click → Controller Layout → enable Touchscreen Native Support.
  4. Switch to Gaming Mode and launch.

GPS receiver:
  • Connect via USB-C; it appears at /dev/ttyUSB0 (or /dev/ttyACM0).
  • Allow ~24 s for the first satellite fix.
  • The udev rule grants access for vendors: ${VENDORS[*]} — if your receiver
    isn't detected, find its id with 'lsusb' and add it to $UDEV_FILE.

EOF
