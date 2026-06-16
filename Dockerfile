# Base node image
FROM node:20-alpine AS base

# Install build dependencies
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy dependency configs
COPY package*.json ./
COPY agent/package*.json ./agent/

# Install all dependencies (production & devDependencies)
RUN npm ci

# Copy all project source files
COPY . .

# Build Next.js
ENV NEXT_TELEMETRY_DISABLED 1
RUN npm run build

# Production runner image
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

# Create directory for sharing logs between containers
RUN mkdir -p /app/shared

# Copy build artifacts and dependencies from base
COPY --from=base /app ./

# Expose Next.js dashboard port
EXPOSE 3000

# Default command is to start the Next.js dashboard
CMD ["npm", "run", "start"]
