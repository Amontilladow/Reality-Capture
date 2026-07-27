FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
RUN npm install -g pnpm@11.15.1
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/ ./packages/
COPY apps/api/package.json ./apps/api/
COPY apps/ifc-service/package.json ./apps/ifc-service/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile
COPY apps/ifc-service/ ./apps/ifc-service/
RUN pnpm --filter ifc-service build

FROM node:22-alpine
WORKDIR /app
RUN npm install -g pnpm@11.15.1
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/ifc-service/dist ./apps/ifc-service/dist
COPY --from=builder /app/apps/ifc-service/package.json ./apps/ifc-service/
EXPOSE 3100
CMD ["node", "apps/ifc-service/dist/main"]
