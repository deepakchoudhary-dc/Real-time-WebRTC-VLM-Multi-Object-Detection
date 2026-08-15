# Production Dockerfile for WebRTC Object Detection Server
# Uses modern Node.js Alpine base, non-root user, and hardened security practices.

FROM node:22-alpine AS base

# Install curl for healthcheck and dumb-init for PID 1 signal handling
RUN apk add --no-cache curl dumb-init

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3443
ENV HTTP_PORT=3000

# Copy package manifests first for optimal Docker cache layering
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy application source code
COPY server/ ./server/
COPY frontend/ ./frontend/

# Set non-root ownership
RUN chown -R node:node /app

# Switch to non-root user
USER node

# Expose HTTPS and HTTP ports
EXPOSE 3443 3000

# Health check against local HTTPS endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -k -f https://localhost:3443/health || exit 1

# Start server with dumb-init for graceful SIGTERM/SIGINT propagation
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server/index.js"]
