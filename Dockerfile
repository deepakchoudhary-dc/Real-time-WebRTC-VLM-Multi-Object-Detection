# Multi-Stage Production Dockerfile for WebRTC Object Detection Server
# Stage 1: Dependency Builder
FROM node:22-alpine AS dependencies

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Stage 2: Hardened Runtime
FROM node:22-alpine AS runtime

RUN apk add --no-cache curl dumb-init

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3443
ENV HTTP_PORT=3000

# Copy node_modules from builder stage
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./

# Copy application source
COPY server/ ./server/
COPY frontend/ ./frontend/

# Set non-root permissions
RUN chown -R node:node /app

USER node

EXPOSE 3443 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -k -f https://localhost:3443/health || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server/index.js"]
