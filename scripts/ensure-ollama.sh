#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
OLLAMA_HEALTH_URL="${OLLAMA_BASE_URL%/}/api/tags"
OLLAMA_BIN="${OLLAMA_BIN:-/usr/local/bin/ollama}"
LOCK_FILE="/tmp/certifyd-ollama-watchdog.lock"
LOG_DIR="$ROOT_DIR/.tmp"
LOG_FILE="$LOG_DIR/ollama-watchdog.log"

mkdir -p "$LOG_DIR"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

if curl -fsS --max-time 3 "$OLLAMA_HEALTH_URL" >/dev/null 2>&1; then
  exit 0
fi

if [[ ! -x "$OLLAMA_BIN" ]]; then
  OLLAMA_BIN="$(command -v ollama || true)"
fi

if [[ -z "$OLLAMA_BIN" || ! -x "$OLLAMA_BIN" ]]; then
  printf '%s missing ollama binary\n' "$(date -Is)" >> "$LOG_FILE"
  exit 1
fi

printf '%s starting ollama via %s\n' "$(date -Is)" "$OLLAMA_BIN" >> "$LOG_FILE"
setsid "$OLLAMA_BIN" serve >> "$LOG_FILE" 2>&1 < /dev/null &
sleep 2

curl -fsS --max-time 5 "$OLLAMA_HEALTH_URL" >/dev/null
