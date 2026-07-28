#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

for env_file in \
  "$ROOT_DIR/.env.blog-engine.local" \
  "$ROOT_DIR/deploy/admin/local.env"
do
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
done

export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-8000}"

export CONTENT_DASHBOARD_ENABLED="${CONTENT_DASHBOARD_ENABLED:-true}"
export CONTENT_DASHBOARD_ENV="${CONTENT_DASHBOARD_ENV:-local}"
export CONTENT_DASHBOARD_AUTH_MODE="${CONTENT_DASHBOARD_AUTH_MODE:-local}"
export ALLOW_TEMPORARY_TUNNEL_TESTING="${ALLOW_TEMPORARY_TUNNEL_TESTING:-false}"
export CONTENT_DASHBOARD_PUBLIC_URL="${CONTENT_DASHBOARD_PUBLIC_URL:-http://127.0.0.1:8000}"

export CONTENT_MODEL_PROVIDER="${CONTENT_MODEL_PROVIDER:-ollama}"
export OLLAMA_ENABLED="${OLLAMA_ENABLED:-true}"
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
export OLLAMA_CONTENT_MODEL="${OLLAMA_CONTENT_MODEL:-qwen2.5:1.5b}"
export OLLAMA_CONTEXT_LIMIT="${OLLAMA_CONTEXT_LIMIT:-4096}"
export OLLAMA_MAX_OUTPUT_TOKENS="${OLLAMA_MAX_OUTPUT_TOKENS:-700}"
export OLLAMA_REQUEST_TIMEOUT_MS="${OLLAMA_REQUEST_TIMEOUT_MS:-120000}"
export OLLAMA_THINK="${OLLAMA_THINK:-false}"
export OLLAMA_MAX_CONCURRENT_GENERATIONS="${OLLAMA_MAX_CONCURRENT_GENERATIONS:-1}"

if [[ "$CONTENT_MODEL_PROVIDER" == "ollama" && "$OLLAMA_ENABLED" == "true" ]]; then
  OLLAMA_HEALTH_URL="${OLLAMA_BASE_URL%/}/api/tags"
  if ! curl -fsS --max-time 2 "$OLLAMA_HEALTH_URL" >/dev/null 2>&1; then
    OLLAMA_BIN="${OLLAMA_BIN:-}"
    if [[ -z "$OLLAMA_BIN" && -x /usr/local/bin/ollama ]]; then
      OLLAMA_BIN=/usr/local/bin/ollama
    elif [[ -z "$OLLAMA_BIN" ]]; then
      OLLAMA_BIN="$(command -v ollama || true)"
    fi

    if [[ -n "$OLLAMA_BIN" && -x "$OLLAMA_BIN" ]]; then
      mkdir -p "$ROOT_DIR/.tmp"
      echo "Ollama is not reachable at ${OLLAMA_BASE_URL}; starting ${OLLAMA_BIN}."
      setsid "$OLLAMA_BIN" serve > "$ROOT_DIR/.tmp/ollama.log" 2>&1 < /dev/null &
      sleep 2
    fi
  fi

  if ! curl -fsS --max-time 5 "$OLLAMA_HEALTH_URL" >/dev/null 2>&1; then
    echo "WARNING: Ollama is still unavailable at ${OLLAMA_BASE_URL}. Qwen generation will fail until Ollama is running." >&2
  fi
fi

if [[ -z "${CONTENT_DASHBOARD_GITHUB_PUBLISHING_ENABLED:-}" ]]; then
  if [[ -n "${GITHUB_APP_ID:-}" || -n "${CONTENT_DASHBOARD_GITHUB_TOKEN:-}" || -n "${GITHUB_TOKEN:-}" ]]; then
    export CONTENT_DASHBOARD_GITHUB_PUBLISHING_ENABLED=true
  else
    export CONTENT_DASHBOARD_GITHUB_PUBLISHING_ENABLED=false
  fi
fi
export CONTENT_DASHBOARD_GITHUB_OWNER="${CONTENT_DASHBOARD_GITHUB_OWNER:-BEATiFYAUDIO}"
export CONTENT_DASHBOARD_GITHUB_REPO="${CONTENT_DASHBOARD_GITHUB_REPO:-certifyd-me-site}"
export CONTENT_DASHBOARD_GITHUB_BASE_BRANCH="${CONTENT_DASHBOARD_GITHUB_BASE_BRANCH:-main}"
export CONTENT_DASHBOARD_GITHUB_BRANCH_PREFIX="${CONTENT_DASHBOARD_GITHUB_BRANCH_PREFIX:-content-dashboard}"
export CONTENT_DASHBOARD_GITHUB_PUBLISH_MODE="${CONTENT_DASHBOARD_GITHUB_PUBLISH_MODE:-direct}"
export CONTENT_DASHBOARD_GITHUB_MIRROR_ENABLED="${CONTENT_DASHBOARD_GITHUB_MIRROR_ENABLED:-true}"
export CONTENT_DASHBOARD_GITHUB_MIRROR_OWNER="${CONTENT_DASHBOARD_GITHUB_MIRROR_OWNER:-BEATiFYAUDIO}"
export CONTENT_DASHBOARD_GITHUB_MIRROR_REPO="${CONTENT_DASHBOARD_GITHUB_MIRROR_REPO:-certifyd-me-site-preview}"
export CONTENT_DASHBOARD_GITHUB_MIRROR_BASE_BRANCH="${CONTENT_DASHBOARD_GITHUB_MIRROR_BASE_BRANCH:-main}"
export CONTENT_DASHBOARD_GITHUB_MIRROR_PUBLIC_URL="${CONTENT_DASHBOARD_GITHUB_MIRROR_PUBLIC_URL:-https://vassal.certifyd.me}"
export CONTENT_DASHBOARD_GITHUB_MIRROR_EXCLUDE_PATHS="${CONTENT_DASHBOARD_GITHUB_MIRROR_EXCLUDE_PATHS:-index.html}"
export CONTENT_DASHBOARD_COVER_IMAGE_PROVIDER="${CONTENT_DASHBOARD_COVER_IMAGE_PROVIDER:-${CONTENT_DASHBOARD_PEXELS_API_KEY:+pexels}}"
export CONTENT_DASHBOARD_COVER_IMAGE_PROVIDER="${CONTENT_DASHBOARD_COVER_IMAGE_PROVIDER:-local}"
export CONTENT_DASHBOARD_PEXELS_LOCALE="${CONTENT_DASHBOARD_PEXELS_LOCALE:-en-US}"
export CONTENT_DASHBOARD_COVER_IMAGE_TIMEOUT_MS="${CONTENT_DASHBOARD_COVER_IMAGE_TIMEOUT_MS:-12000}"

if [[ -z "${CONTENT_DASHBOARD_LOCAL_LOGIN_TOKEN:-}" && "$CONTENT_DASHBOARD_AUTH_MODE" == "local" ]]; then
  echo "ERROR: CONTENT_DASHBOARD_LOCAL_LOGIN_TOKEN is required for local dashboard login." >&2
  echo "Set it in .env.blog-engine.local, deploy/admin/local.env, or the shell before running this script." >&2
  exit 1
fi

echo "Starting Certifyd Blog Engine at http://${HOST}:${PORT}"
echo "Dashboard enabled: ${CONTENT_DASHBOARD_ENABLED}"
echo "Auth mode: ${CONTENT_DASHBOARD_AUTH_MODE}"
echo "Model provider: ${CONTENT_MODEL_PROVIDER}"
echo "Ollama model: ${OLLAMA_CONTENT_MODEL}"
echo "GitHub publishing: ${CONTENT_DASHBOARD_GITHUB_PUBLISHING_ENABLED}"
echo "GitHub publish mode: ${CONTENT_DASHBOARD_GITHUB_PUBLISH_MODE}"
echo "GitHub mirror: ${CONTENT_DASHBOARD_GITHUB_MIRROR_ENABLED} ${CONTENT_DASHBOARD_GITHUB_MIRROR_OWNER}/${CONTENT_DASHBOARD_GITHUB_MIRROR_REPO}"
echo "Cover image provider: ${CONTENT_DASHBOARD_COVER_IMAGE_PROVIDER}"

exec node scripts/content-dashboard-server.js
