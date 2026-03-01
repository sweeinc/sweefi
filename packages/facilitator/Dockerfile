# SweeFi Facilitator — multi-stage Docker build
#
# This is a pnpm workspace package with workspace:^ dependencies.
# Build from the MONOREPO ROOT, not from packages/facilitator/:
#
#   docker build -f packages/facilitator/Dockerfile -t swee-facilitator .
#
# For Fly.io, run from monorepo root:
#   fly deploy --config packages/facilitator/fly.toml \
#              --dockerfile packages/facilitator/Dockerfile

FROM node:22-slim AS base
RUN corepack enable pnpm

FROM base AS build
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sweefi/facilitator... build
RUN pnpm --filter @sweefi/facilitator deploy /deploy --prod

FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=build /deploy ./
ENV NODE_ENV=production
EXPOSE 4022
CMD ["node", "dist/index.mjs"]
