#!/usr/bin/env bash
# Runs Redis as the API's cache: local only, memory-capped, nothing written to disk.
set -euo pipefail
exec redis-server \
  --bind 127.0.0.1 --port "${REDIS_PORT:-6379}" \
  --protected-mode yes \
  --save "" --appendonly no \
  --maxmemory "${REDIS_MAXMEMORY:-256mb}" --maxmemory-policy allkeys-lru
