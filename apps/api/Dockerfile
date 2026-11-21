FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
RUN npm install -g pnpm@11.15.1
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
# pnpm-workspace.yaml's patchedDependencies points at files under
# patches/ (e.g. pdf-parse@2.4.5.patch); pnpm install reads that file
# directly, so it must be present before install runs, not copied later
# alongside the rest of apps/api/ -- confirmed by hand: this exact
# COPY list, missing patches/, broke every deploy of the dependency this
# patch was added for with "ENOENT: no such file or directory, open
# '/app/patches/pdf-parse@2.4.5.patch'" (CI's own checkout never
# reproduced this, since CI clones the whole repo instead of copying
# this selective file list).
COPY patches/ ./patches/
COPY packages/ ./packages/
COPY apps/api/package.json ./apps/api/
COPY apps/ifc-service/package.json ./apps/ifc-service/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile
RUN pnpm rebuild argon2
COPY apps/api/ ./apps/api/
RUN pnpm --filter api build

FROM node:22-alpine
WORKDIR /app
RUN npm install -g pnpm@11.15.1
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/src/database/migrations ./apps/api/dist/database/migrations
EXPOSE 3000
CMD ["node", "apps/api/dist/main"]
