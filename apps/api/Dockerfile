FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
RUN npm install -g pnpm
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/ ./packages/
COPY apps/api/package.json ./apps/api/
COPY apps/ifc-service/package.json ./apps/ifc-service/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile
RUN pnpm rebuild argon2
COPY apps/api/ ./apps/api/
RUN pnpm --filter api build

FROM node:20-alpine
WORKDIR /app
RUN npm install -g pnpm
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/src/database/migrations ./apps/api/dist/database/migrations
EXPOSE 3000
CMD ["node", "apps/api/dist/main"]
