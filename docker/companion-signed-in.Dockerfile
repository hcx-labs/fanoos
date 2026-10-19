# The signed-in Invidious companion (age-restricted playback): upstream companion from
# vendor/invidious-companion plus companion-signed-in.patch, which keeps the Google sign-in across
# restarts and shares the pending google.com/device code with the YouTube backend (shown in
# Settings). The anonymous companion stays on the upstream image.
FROM denoland/deno:bin-2.9.2 AS deno-bin

FROM debian:13-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends patch && rm -rf /var/lib/apt/lists/*
COPY --from=deno-bin /deno /usr/bin/deno
WORKDIR /app
COPY vendor/invidious-companion/deno.jsonc vendor/invidious-companion/deno.lock ./
COPY vendor/invidious-companion/src ./src
COPY vendor/invidious-companion/config ./config
COPY docker/companion-signed-in.patch /tmp/
RUN patch -p1 < /tmp/companion-signed-in.patch
RUN mkdir -p /var/tmp/youtubei.js && deno compile \
    --include ./src/lib/helpers/youtubePlayerReq.ts --include ./src/lib/helpers/getFetchClient.ts \
    --output invidious_companion \
    --allow-import=github.com:443,jsr.io:443,cdn.jsdelivr.net:443,esm.sh:443,deno.land:443 \
    --allow-net --allow-env --allow-read --allow-sys=hostname \
    --allow-write=/var/tmp/youtubei.js,/tmp/invidious-companion.sock,/tmp/companionsock \
    src/main.ts

FROM gcr.io/distroless/cc:nonroot
WORKDIR /app
COPY --from=builder /app/invidious_companion ./
COPY --from=builder /app/config ./config
# The sign-in lives here (mount a volume): oauth-credentials.json, and oauth-pending.json while
# a code is waiting to be entered.
COPY --from=builder --chown=nonroot:nonroot /var/tmp/youtubei.js /var/tmp/youtubei.js
ENV SERVER_BASE_PATH=/companion HOST=0.0.0.0 PORT=8282 YOUTUBE_SESSION_OAUTH_ENABLED=true
EXPOSE 8282
ENTRYPOINT ["/app/invidious_companion"]
