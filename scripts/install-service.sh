#!/bin/sh
# Install (or update) Books Meta Viewer as a systemd user service on this device.
#   sh scripts/install-service.sh --vault /path/to/Obsidian/books [--port 4321] [--host 127.0.0.1] [--dry-run]
# The settings go into the installed unit (~/.config/systemd/user/books-meta-viewer.service), so each device can
# point at its own copy of the vault. Settings not given keep their installed value. Run it again to change them.
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="" PORT="" HOST="" DRY=""
while [ $# -gt 0 ]; do
    case "$1" in
        --vault) VAULT="$2"; shift 2 ;;
        --port) PORT="$2"; shift 2 ;;
        --host) HOST="$2"; shift 2 ;;
        --dry-run) DRY=1; shift ;;
        -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
        *) echo "Unknown option $1" >&2; exit 2 ;;
    esac
done
UNIT="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/books-meta-viewer.service"
setting() { sed -n "s/^Environment=$1=//p" "$UNIT" | tail -1; }
# keep the installed settings for anything not given now
if [ -f "$UNIT" ]; then
    [ -z "$VAULT" ] && VAULT="$(setting BOOKS_VAULT)"
    [ -z "$PORT" ] && PORT="$(setting PORT)"
    [ -z "$HOST" ] && HOST="$(setting BOOKS_HOST)"
    # older units passed the vault on the command line
    [ -z "$VAULT" ] && VAULT="$(sed -n 's/^ExecStart=.*--vault \([^ ]*\).*/\1/p' "$UNIT")"
fi
[ -z "$VAULT" ] && { echo "Give the vault folder: --vault /path/to/Obsidian/books" >&2; exit 2; }
VAULT="$(printf '%s' "$VAULT" | sed "s|^%h|$HOME|; s|^~/|$HOME/|")"
if [ -d "$VAULT" ]; then VAULT="$(cd "$VAULT" && pwd)"; else echo "Warning: vault folder $VAULT does not exist (yet)" >&2; fi
PORT="${PORT:-4321}"
HOST="${HOST:-127.0.0.1}"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "node not found on PATH" >&2; exit 1; }

UNITTEXT="$(sed -e "s|^Environment=BOOKS_VAULT=.*|Environment=BOOKS_VAULT=$VAULT|" -e "s|^Environment=PORT=.*|Environment=PORT=$PORT|" \
    -e "s|^Environment=BOOKS_HOST=.*|Environment=BOOKS_HOST=$HOST|" -e "s|^WorkingDirectory=.*|WorkingDirectory=$REPO|" \
    -e "s|^ExecStart=.*|ExecStart=$NODE server.js|" "$REPO/books-meta-viewer.service")"

if [ -n "$DRY" ]; then printf '== %s\n%s\n' "$UNIT" "$UNITTEXT"; exit 0; fi
mkdir -p "$(dirname "$UNIT")"
printf '%s\n' "$UNITTEXT" > "$UNIT"
systemctl --user daemon-reload
systemctl --user enable books-meta-viewer >/dev/null 2>&1 || true
systemctl --user restart books-meta-viewer
echo "Books Meta Viewer: http://$HOST:$PORT (vault: $VAULT)"
