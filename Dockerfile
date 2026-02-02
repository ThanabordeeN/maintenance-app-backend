# ==================================================
# SmartQuary Maintenance App Backend - Dockerfile
# ==================================================

# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
# Copy prisma directory for generation
COPY prisma ./prisma/
RUN npm ci
COPY . .
RUN npm run build
RUN npx prisma generate

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 3002
CMD ["npm", "run", "start"]
