#!/bin/sh
# Smoke test against a throwaway copy of the vault (never the real one).
# Usage: sh test/run.sh [vault path]   (default: BOOKS_VAULT, else the installed service's vault folder)
set -e
cd "$(dirname "$0")/.."
UNIT="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/books-meta-viewer.service"
VAULT="${1:-${BOOKS_VAULT:-$( [ -f "$UNIT" ] && sed -n 's/^Environment=BOOKS_VAULT=//p' "$UNIT" | tail -1 )}}"
[ -n "$VAULT" ] && [ -d "$VAULT" ] || { echo "No vault to copy: pass a path, set BOOKS_VAULT, or install the service" >&2; exit 1; }
COPY="$(mktemp -d)"
trap 'kill $PID 2>/dev/null; rm -rf "$COPY"' EXIT
(cd "$VAULT" && tar --exclude=./.git --exclude=./.obsidian -cf - .) | (cd "$COPY" && tar -xf -)
node scripts/migrate-plans.js "$COPY" --write > /dev/null
node server.js --vault "$COPY" --port 4398 > "$COPY/.server.log" 2>&1 &
PID=$!
sleep 2
BASE=http://127.0.0.1:4398 VAULT_COPY="$COPY" node test/ui-smoke.mjs
