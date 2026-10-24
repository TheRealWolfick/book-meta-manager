#!/bin/sh
# Install (or update) Books Meta Viewer as a systemd user service on this device.
#   sh scripts/install-service.sh [--vault /path/to/Obsidian/books] [--port 4321] [--host 127.0.0.1] [--dry-run]
# Port and host go into the installed unit (~/.config/systemd/user/books-meta-viewer.service); the vault folder goes
# there too and into the app's settings (~/.config/books-meta-viewer/settings.json, also set on its Settings page).
# Without --vault, choose the folder on the Settings page. Settings not given keep their installed value.
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="" PORT="" HOST="" DRY="" VAULT_GIVEN=""
while [ $# -gt 0 ]; do
    case "$1" in
        --vault) VAULT="$2"; VAULT_GIVEN=1; shift 2 ;;
        --port) PORT="$2"; shift 2 ;;
        --host) HOST="$2"; shift 2 ;;
        --dry-run) DRY=1; shift ;;
        -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
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
VAULT="$(printf '%s' "$VAULT" | sed "s|^%h|$HOME|; s|^~/|$HOME/|")"
if [ -z "$VAULT" ]; then echo "No vault folder given: choose it on the app's Settings page" >&2
elif [ -d "$VAULT" ]; then VAULT="$(cd "$VAULT" && pwd)"; else echo "Warning: vault folder $VAULT does not exist (yet)" >&2; fi
PORT="${PORT:-4321}"
HOST="${HOST:-127.0.0.1}"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "node not found on PATH" >&2; exit 1; }

UNITTEXT="$(sed -e "s|^Environment=BOOKS_VAULT=.*|Environment=BOOKS_VAULT=$VAULT|" -e "s|^Environment=PORT=.*|Environment=PORT=$PORT|" \
    -e "s|^Environment=BOOKS_HOST=.*|Environment=BOOKS_HOST=$HOST|" -e "s|^WorkingDirectory=.*|WorkingDirectory=$REPO|" \
    -e "s|^ExecStart=.*|ExecStart=$NODE server.js|" "$REPO/books-meta-viewer.service")"

if [ -n "$DRY" ]; then printf '== %s\n%s\n' "$UNIT" "$UNITTEXT"; exit 0; fi
# a folder given here replaces the one chosen on the Settings page (which would otherwise win)
if [ -n "$VAULT_GIVEN" ] && [ -n "$VAULT" ]; then
    SETTINGS="${XDG_CONFIG_HOME:-$HOME/.config}/books-meta-viewer/settings.json"
    "$NODE" -e 'const fs=require("fs"),p=process.argv[1];let s={};try{s=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}s.vault=process.argv[2];fs.mkdirSync(require("path").dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(s,null,2)+"\n")' "$SETTINGS" "$VAULT"
fi
mkdir -p "$(dirname "$UNIT")"
printf '%s\n' "$UNITTEXT" > "$UNIT"
systemctl --user daemon-reload
systemctl --user enable books-meta-viewer >/dev/null 2>&1 || true
systemctl --user restart books-meta-viewer
echo "Books Meta Viewer: http://$HOST:$PORT (vault: ${VAULT:-choose on the Settings page})"
