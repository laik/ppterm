# Use Node.js Alpine base image
FROM node:18-alpine

# Install necessary packages for node-pty
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    bash \
    zsh

# Set working directory
WORKDIR /app

# Copy backend package files
COPY ppterm-backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm ci --only=production

# Copy backend source
COPY ppterm-backend/src ./src

# Build frontend
WORKDIR /app
COPY ppterm-frontend/package*.json ./frontend/
WORKDIR /app/frontend
RUN npm ci

# Copy frontend source and build
COPY ppterm-frontend/src ./src
COPY ppterm-frontend/index.html ./
COPY ppterm-frontend/vite.config.ts ./
COPY ppterm-frontend/tsconfig*.json ./
RUN npm run build

# Set working directory back to backend
WORKDIR /app/backend

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start the server
CMD ["npm", "start"]