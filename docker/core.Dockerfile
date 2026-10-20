# Fanoos core: accounts, sessions, linked-account registry, app data, merging across
# backends, the backends' public proxy, and the built web app.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY services/kit/package.json services/kit/
COPY services/youtube/package.json services/youtube/
COPY services/crunchyroll/package.json services/crunchyroll/
COPY services/plex/package.json services/plex/
RUN npm ci --workspace @tube/web --workspace @tube/server --include-workspace-root
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG FANOOS_COMMIT=""
RUN FANOOS_COMMIT="$FANOOS_COMMIT" npm run build --workspace @tube/web

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
RUN npm ci --omit=dev --workspace @tube/server

FROM node:24-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/data WEB_ROOT=/app/web
WORKDIR /app/apps/server
COPY --from=deps /app/node_modules /app/node_modules
COPY packages/shared /app/packages/shared
COPY apps/server/package.json ./
COPY apps/server/src ./src
COPY --from=build /app/apps/web/dist /app/web
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
CMD ["node", "src/index.ts"]
