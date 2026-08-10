FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Expose HTTPS (3443) and HTTP redirect (3000)
EXPOSE 3443 3000

# Health check against HTTPS endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -k -f https://localhost:3443/health || exit 1

# Start application
CMD ["npm", "start"]
