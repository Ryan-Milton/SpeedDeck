#!/usr/bin/env bash
set -euo pipefail

echo "=== SpeedDeck OSRM Dev Setup ==="

# Check OS
if [[ "$(uname)" == "Darwin" ]]; then
    # macOS — install via Homebrew
    if ! command -v brew &>/dev/null; then
        echo "Error: Homebrew is required. Install from https://brew.sh"
        exit 1
    fi

    if command -v osrm-routed &>/dev/null; then
        echo "✓ OSRM already installed: $(osrm-routed --version 2>&1 | head -1)"
    else
        echo "Installing OSRM via Homebrew..."
        brew install osrm-backend
        echo "✓ OSRM installed"
    fi
else
    # Linux — check if available
    if command -v osrm-routed &>/dev/null; then
        echo "✓ OSRM already installed"
    else
        echo "OSRM not found. Install via your package manager or Docker:"
        echo "  apt: sudo apt install osrm-backend"
        echo "  Docker: docker pull osrm/osrm-backend"
        exit 1
    fi
fi

# Python dependencies
echo ""
echo "Installing Python dependencies..."
pip3 install osmium aiohttp 2>/dev/null || pip install osmium aiohttp
echo "✓ Python dependencies installed"

echo ""
echo "=== Setup complete ==="
echo "You can now download routing data via the SpeedDeck Settings panel."
