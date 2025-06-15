FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/app.js ./
COPY --from=builder /app/.env* ./

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "app.js"] 