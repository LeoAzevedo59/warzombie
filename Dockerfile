# ---------- 1. deps + build ----------
FROM node:24-bookworm-slim AS build
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --ignore-scripts

COPY shared ./shared
COPY client ./client
COPY server ./server

# Prisma Client gerado a partir do schema (fonte da verdade do banco)
RUN npx prisma generate --schema=server/prisma/schema.prisma
# View (SPA) + API
RUN npm run build -w client && npm run build -w server

# ---------- 2. runtime ----------
FROM node:24-bookworm-slim AS runtime
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
# prisma (CLI) fica nas deps de produção do server para rodar `migrate deploy` no container
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy --schema=server/prisma/schema.prisma && node server/dist/server/src/index.js"]
