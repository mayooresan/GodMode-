# ---------------------------------------------------------------- dashboard --
FROM node:20-alpine AS web-build
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ------------------------------------------------------------------- engine --
FROM node:20-alpine AS server-build
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

# Production dependency tree only — no compilers, no type packages.
FROM node:20-alpine AS deps
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ------------------------------------------------------------------ runtime --
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
# Keep the heap bounded so a runaway world is killed by Node, not by the OOM
# killer taking the whole droplet with it.
ENV NODE_OPTIONS="--max-old-space-size=768"
WORKDIR /app

# dumb-init gives us correct signal forwarding, so SIGTERM reaches the engine
# and it can write a final snapshot before the container stops.
RUN apk add --no-cache dumb-init wget

COPY --from=deps        /build/server/node_modules ./node_modules
COPY --from=server-build /build/server/dist        ./dist
COPY --from=web-build    /build/web/dist           ./public
COPY server/package.json ./package.json

# The snapshot directory is a volume; it must be writable by the runtime user.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 8080
ENV PORT=8080 HOST=0.0.0.0 DATA_DIR=/data

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
