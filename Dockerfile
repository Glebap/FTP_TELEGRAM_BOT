# ---- build stage ----
FROM node:22-alpine AS build
WORKDIR /app

# Prisma's engines need OpenSSL even on musl.
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src

RUN npx prisma generate
RUN npm run build

# ---- runtime stage ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma
# `prisma` is a runtime dependency here: migrations are applied on boot.
RUN npm ci --omit=dev && npx prisma generate && npm cache clean --force

# Compiled code plus the generated geo reference data (dist/data).
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# SQLite lives on the mounted volume, so it survives redeploys.
ENV DATABASE_URL=file:/data/dev.db
VOLUME /data

CMD ["./docker-entrypoint.sh"]
