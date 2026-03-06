# SweeFi Demo Server — s402-gated API on Sui Testnet
# Deploy: fly deploy --remote-only
#
# NOTE: This Dockerfile works AFTER npm publish (uses published @sweefi/sui).
# The workspace:* dependency must be replaced with a version before building.

FROM node:22-slim AS base
WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --omit=dev 2>/dev/null || true

# Copy source
COPY server.ts tsconfig.json ./

# Install tsx for running TypeScript directly
RUN npm install tsx

EXPOSE 3402

ENV PORT=3402
ENV NODE_ENV=production

CMD ["node", "--import", "tsx/esm", "server.ts"]
