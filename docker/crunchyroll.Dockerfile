# Fanoos Crunchyroll backend: activation-code linking, catalogue, DRM playback sessions and licence forwarding.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY services/kit/package.json services/kit/
COPY services/youtube/package.json services/youtube/
COPY services/crunchyroll/package.json services/crunchyroll/
RUN npm ci --omit=dev --workspace @fanoos/crunchyroll --workspace @fanoos/kit

FROM node:24-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8789 DATA_DIR=/data
WORKDIR /app/services/crunchyroll
COPY --from=deps /app/node_modules /app/node_modules
COPY packages/shared /app/packages/shared
COPY services/kit /app/services/kit
COPY services/crunchyroll/package.json ./
COPY services/crunchyroll/src ./src
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8789
CMD ["node", "src/index.ts"]
