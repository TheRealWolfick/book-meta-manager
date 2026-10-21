#!/bin/sh
# Smoke test against a throwaway copy of the vault (never the real one).
# Usage: sh test/run.sh [vault path]   (default ~/Documents/Obsidian/books)
set -e
cd "$(dirname "$0")/.."
VAULT="${1:-$HOME/Documents/Obsidian/books}"
COPY="$(mktemp -d)"
trap 'kill $PID 2>/dev/null; rm -rf "$COPY"' EXIT
(cd "$VAULT" && tar --exclude=./.git --exclude=./.obsidian -cf - .) | (cd "$COPY" && tar -xf -)
node scripts/migrate-plans.js "$COPY" --write > /dev/null
node server.js --vault "$COPY" --port 4398 > "$COPY/.server.log" 2>&1 &
PID=$!
sleep 2
BASE=http://127.0.0.1:4398 VAULT_COPY="$COPY" node test/ui-smoke.mjs
