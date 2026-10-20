# Fanoos YouTube backend: Google OAuth, YouTube.js, streaming through Invidious companion (its own container).
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
RUN npm ci --omit=dev --workspace @fanoos/youtube --workspace @fanoos/kit

FROM node:24-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8788 DATA_DIR=/data
WORKDIR /app/services/youtube
COPY --from=deps /app/node_modules /app/node_modules
COPY packages/shared /app/packages/shared
COPY services/kit /app/services/kit
COPY services/youtube/package.json ./
COPY services/youtube/src ./src
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8788
CMD ["node", "src/index.ts"]
