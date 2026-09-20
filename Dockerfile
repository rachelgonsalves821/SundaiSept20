# syntax=docker/dockerfile:1

# Canvas MCP connector.
#
# The server speaks MCP over stdio, so the container is driven by an MCP client
# that attaches to stdin/stdout. There is no listening port and nothing to
# EXPOSE; run it with `docker run -i --rm` (interactive, stdin attached).
#
# Credentials are supplied at runtime via environment variables and are never
# baked into an image layer.

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS build
WORKDIR /app

# Install against the committed lockfile so the build is reproducible.
COPY package.json package-lock.json ./
RUN npm ci

# tsconfig.json sets rootDir "." and includes test/**/*, so compiled output
# lands in dist/src/. test/ is deliberately not copied: the image ships runtime
# code only, and an include pattern that matches nothing is not a tsc error.
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build && test -f dist/src/index.js

FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist/src ./dist/src

# node:alpine ships an unprivileged `node` user (uid 1000).
USER node

CMD ["node", "dist/src/index.js"]
