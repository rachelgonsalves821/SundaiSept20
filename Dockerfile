# syntax=docker/dockerfile:1

# Canvas MCP connector.
#
# One image, two transports:
#   HTTP  (default) — `docker run -p 3000:3000 ...`, serves /health and /mcp.
#   stdio           — `docker run -i ... node dist/src/index.js`, driven by an
#                     MCP client over stdin/stdout.
#
# tsconfig.json sets rootDir "." so tsc emits to dist/src/, not dist/. Every
# entrypoint path below reflects that; the RUN check fails the build if it
# ever stops being true.
#
# Credentials are supplied at runtime via environment variables and are never
# baked into an image layer.

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS build
WORKDIR /app

# Install against the committed lockfile so the build is reproducible.
COPY package.json package-lock.json ./
RUN npm ci

# test/ is deliberately not copied: the image ships runtime code only, and an
# include pattern that matches nothing is not a tsc error.
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build \
 && test -f dist/src/index.js \
 && test -f dist/src/http-index.js

FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build --chown=node:node /app/dist/src ./dist/src

# node:alpine ships an unprivileged `node` user (uid 1000).
USER node

EXPOSE 3000
CMD ["node", "dist/src/http-index.js"]
