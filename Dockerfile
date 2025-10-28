########################
# Stage 1: deps cache
########################
FROM node:22-alpine AS deps
WORKDIR /app

# Install dependencies using a clean, reproducible install
# Leverage BuildKit cache to speed up repeated builds
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts

########################
# Stage 2: builder
########################
FROM node:22-alpine AS builder
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN node -e "console.log('BUILD ENV NEXT_PUBLIC_API_URL=', process.env.NEXT_PUBLIC_API_URL)"

ARG NEXT_PUBLIC_PHANTASMA_NEXUS
ENV NEXT_PUBLIC_PHANTASMA_NEXUS=${NEXT_PUBLIC_PHANTASMA_NEXUS}

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build Next.js (standalone output -> .next/standalone)
RUN npm run build

########################
# Stage 3: runner (tiny runtime)
########################
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

# Use non-root user for security
# The official node image already has a "node" user
USER node

# Copy only what the standalone server needs
COPY --chown=node:node --from=builder /app/.next/standalone ./
COPY --chown=node:node --from=builder /app/.next/static ./.next/static

# Optional: healthcheck (requires wget busybox included on alpine)
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:${PORT} >/dev/null 2>&1 || exit 1

EXPOSE 3000
# In .next/standalone the entrypoint is server.js at the root we copied
CMD ["node", "server.js"]
