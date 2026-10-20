# Fanoos Plex backend: Plex sign-in, owned/shared server libraries and proxied media playback.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY services/kit/package.json services/kit/
COPY services/youtube/package.json services/youtube/
COPY services/crunchyroll/package.json services/crunchyroll/
COPY services/plex/package.json services/plex/
RUN npm ci --omit=dev --workspace @fanoos/plex --workspace @fanoos/kit

FROM node:24-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8790 DATA_DIR=/data
WORKDIR /app/services/plex
COPY --from=deps /app/node_modules /app/node_modules
COPY packages/shared /app/packages/shared
COPY services/kit /app/services/kit
COPY services/plex/package.json ./
COPY services/plex/src ./src
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8790
CMD ["node", "src/index.ts"]
