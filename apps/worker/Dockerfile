FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY apps/worker/package*.json ./apps/worker/
COPY packages/shared/package*.json ./packages/shared/
RUN npm ci --workspace=apps/worker --workspace=packages/shared
COPY apps/worker/ ./apps/worker/
COPY packages/shared/ ./packages/shared/
RUN npm run build --workspace=apps/worker

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/apps/worker/dist ./dist
COPY --from=builder /app/apps/worker/package.json ./
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3002
CMD ["node", "dist/index.js"]
