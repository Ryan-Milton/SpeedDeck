#!/usr/bin/env bash
set -euo pipefail

# SteamOS / Steam Deck setup script for SpeedDeck
# Run this once after copying the AppImage to the Steam Deck.
#
# Usage: bash setup-steamos.sh [path-to-appimage]

APP_NAME="SpeedDeck"
INSTALL_DIR="$HOME/Applications"
APPIMAGE="${1:-}"

echo "=== SpeedDeck — SteamOS Setup ==="
echo ""

# --- Step 1: Install the AppImage ---

if [[ -z "$APPIMAGE" ]]; then
  # Look for it in common locations
  APPIMAGE=$(ls ~/Downloads/SpeedDeck*.AppImage ~/Desktop/SpeedDeck*.AppImage ./*.AppImage 2>/dev/null | head -1)
fi

if [[ -z "$APPIMAGE" || ! -f "$APPIMAGE" ]]; then
  echo "Error: No AppImage found."
  echo "Usage: bash setup-steamos.sh /path/to/SpeedDeck.AppImage"
  exit 1
fi

mkdir -p "$INSTALL_DIR"
DEST="$INSTALL_DIR/SpeedDeck.AppImage"
cp "$APPIMAGE" "$DEST"
chmod +x "$DEST"
echo "[1/4] Installed to $DEST"

# --- Step 2: USB serial permissions (udev rule for GPS receivers) ---

UDEV_RULE='SUBSYSTEM=="tty", ATTRS{idVendor}=="067b", MODE="0666", TAG+="uaccess"'
UDEV_FILE="/etc/udev/rules.d/99-gps-receiver.rules"

if [[ -f "$UDEV_FILE" ]]; then
  echo "[2/4] Udev rule already exists at $UDEV_FILE"
else
  echo "[2/4] Installing udev rule for Prolific USB-to-serial GPS receivers..."
  echo "      This requires sudo (for /etc/udev/rules.d/)."
  echo "$UDEV_RULE" | sudo tee "$UDEV_FILE" > /dev/null
  sudo udevadm control --reload-rules
  sudo udevadm trigger
  echo "      Done. GPS receivers will now be accessible without sudo."
fi

# --- Step 3: Create desktop entry (for adding as non-Steam game) ---

DESKTOP_FILE="$HOME/.local/share/applications/gps-speedometer.desktop"
mkdir -p "$(dirname "$DESKTOP_FILE")"

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Name=$APP_NAME
Exec="$DEST" --no-sandbox
Type=Application
Categories=Utility;
Comment=SpeedDeck — GPS Speedometer HUD for Steam Deck
Terminal=false
EOF

echo "[3/4] Created desktop entry at $DESKTOP_FILE"

# --- Step 4: Instructions for Gaming Mode ---

echo "[4/4] Setup complete!"
echo ""
echo "=== Next Steps ==="
echo ""
echo "To use in Gaming Mode:"
echo "  1. Open Steam (Desktop Mode)"
echo "  2. Games → Add a Non-Steam Game"
echo "  3. Select '$APP_NAME' from the list (or Browse to $DEST)"
echo "  4. Right-click the game → Properties → Launch Options, add:"
echo "       --no-sandbox"
echo "  5. Right-click → Manage → Controller Layout → Edit Layout"
echo "     → Action Sets → Add Always-On Command"
echo "     → System → Touchscreen Native Support (ON)"
echo "  6. Switch to Gaming Mode and launch!"
echo ""
echo "To plug in the GPS receiver:"
echo "  - Connect the Navisys GR-M02U via USB-C adapter"
echo "  - The app will auto-detect it at /dev/ttyUSB0"
echo "  - Wait ~24 seconds for satellite fix (first use)"
echo ""
