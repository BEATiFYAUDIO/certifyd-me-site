#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$ROOT_DIR/.tmp"
PID_FILE="$TMP_DIR/blog-engine-daemon.pid"
LOG_FILE="$TMP_DIR/blog-engine-daemon.log"
PORT="${PORT:-8000}"

mkdir -p "$TMP_DIR"

is_running() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

port_pid() {
  ss -ltnp "sport = :$PORT" 2>/dev/null | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -n 1
}

start() {
  local existing=""
  [[ -f "$PID_FILE" ]] && existing="$(cat "$PID_FILE" 2>/dev/null || true)"
  if is_running "$existing"; then
    echo "Blog engine daemon already running: $existing"
    return 0
  fi

  local stale_port_pid
  stale_port_pid="$(port_pid)"
  if [[ -n "$stale_port_pid" ]]; then
    echo "Port $PORT is already owned by pid $stale_port_pid; not starting another daemon." >&2
    return 1
  fi

  nohup setsid bash -c '
    set -u
    ROOT_DIR="$1"
    trap "exit 0" TERM INT
    cd "$ROOT_DIR"
    while true; do
      echo "[$(date -Is)] starting blog engine"
      bash scripts/start-blog-engine-local.sh
      status=$?
      echo "[$(date -Is)] blog engine exited with status ${status}; restarting in 2s"
      sleep 2
    done
  ' _ "$ROOT_DIR" >> "$LOG_FILE" 2>&1 < /dev/null &

  echo "$!" > "$PID_FILE"
  echo "Blog engine daemon started: $(cat "$PID_FILE")"
}

stop() {
  local pid=""
  [[ -f "$PID_FILE" ]] && pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if is_running "$pid"; then
    kill -TERM "-$pid" >/dev/null 2>&1 || kill -TERM "$pid" >/dev/null 2>&1 || true
    sleep 1
  fi

  local owned_pid
  owned_pid="$(port_pid)"
  if [[ -n "$owned_pid" ]]; then
    kill "$owned_pid" >/dev/null 2>&1 || true
  fi

  rm -f "$PID_FILE"
  echo "Blog engine daemon stopped."
}

status() {
  local pid=""
  [[ -f "$PID_FILE" ]] && pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if is_running "$pid"; then
    echo "Daemon: running ($pid)"
  else
    echo "Daemon: stopped"
  fi

  local owned_pid
  owned_pid="$(port_pid)"
  if [[ -n "$owned_pid" ]]; then
    echo "Port $PORT: listening ($owned_pid)"
  else
    echo "Port $PORT: not listening"
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  log) tail -n "${2:-120}" "$LOG_FILE" ;;
  *) echo "Usage: $0 {start|stop|restart|status|log [lines]}" >&2; exit 2 ;;
esac
