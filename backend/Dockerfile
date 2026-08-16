# Built from the repo root so the shared workspace is in context:
#   docker build -f backend/Dockerfile .

FROM node:22-slim AS build
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace @tradeit/shared --workspace @tradeit/backend --include-workspace-root

COPY packages/shared packages/shared
COPY backend backend
RUN npm run build -w packages/shared \
  && npx prisma generate --schema backend/prisma/schema.prisma \
  && npm run build -w backend

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/backend/package.json backend/package.json
COPY --from=build /app/backend/prisma backend/prisma

USER node
EXPOSE 4002
CMD ["node", "backend/dist/server.js"]
