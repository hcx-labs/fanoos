#!/usr/bin/env bash
# Runs Invidious companion (vendor/invidious-companion), the streaming service.
#
#   scripts/companion.sh             anonymous instance: streams every video, signed out
#   scripts/companion.sh signed-in   signed-in instance: used only for age-restricted videos
#
# Both listen on 127.0.0.1 only; the API server talks to them and proxies media to browsers.
# Settings come from apps/server/.env (COMPANION_*).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
mode="${1:-anonymous}"

if [ ! -f vendor/invidious-companion/deno.jsonc ]; then
  git submodule update --init vendor/invidious-companion
fi

set -a
# shellcheck disable=SC1091
[ -f apps/server/.env ] && . apps/server/.env
set +a

: "${COMPANION_SECRET:?Set COMPANION_SECRET (exactly 16 characters) in apps/server/.env}"
export SERVER_SECRET_KEY="$COMPANION_SECRET"
export HOST="127.0.0.1"

# Each instance keeps its YouTube session in its own folder, so a sign-in never leaks
# into the anonymous instance.
cache="${COMPANION_CACHE_ROOT:-$root/apps/server/data}/companion-$mode"
mkdir -p "$cache"
export CACHE_DIRECTORY="$cache"

case "$mode" in
  anonymous)
    export PORT="${COMPANION_PORT:-8282}"
    ;;
  signed-in)
    export PORT="${COMPANION_SIGNED_IN_PORT:-8283}"
    if [ -n "${COMPANION_COOKIES:-}" ]; then
      export YOUTUBE_SESSION_COOKIES="$COMPANION_COOKIES"
    else
      # Device sign-in: the log prints a google.com/device code on first start;
      # credentials are then cached in $cache.
      export YOUTUBE_SESSION_OAUTH_ENABLED=true
    fi
    ;;
  *) echo "usage: $0 [anonymous|signed-in]" >&2; exit 2 ;;
esac

cd vendor/invidious-companion
exec deno run \
  --allow-import=github.com:443,jsr.io:443,cdn.jsdelivr.net:443,esm.sh:443,deno.land:443 \
  --allow-net --allow-env --allow-sys=hostname \
  --allow-read=.,"$cache" \
  --allow-write="$cache" \
  src/main.ts
