#!/usr/bin/env bash
# Installs Mission Control as a systemd user service on Linux, so it starts at
# boot (lingering keeps it running without a login) and restarts if it crashes. (Mac and Windows autostart are pinned for later.)
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
node_bin="$(command -v node)"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$unit_dir"

cat > "$unit_dir/mission-control.service" <<UNIT
[Unit]
Description=Mission Control dashboard (http://127.0.0.1:4747)

[Service]
WorkingDirectory=$repo
ExecStart=$node_bin --disable-warning=ExperimentalWarning server/main.ts
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
UNIT

cd "$repo"
npm run build
systemctl --user daemon-reload
loginctl enable-linger "$USER"
systemctl --user enable --now mission-control.service
systemctl --user restart mission-control.service
echo "Mission Control is running at http://127.0.0.1:4747"
