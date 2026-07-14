# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --prefer-offline

COPY . .
RUN npm run build

# ── Dev stage (usado en docker-compose.override.yml) ──────────────────────────
FROM node:20-slim AS dev

WORKDIR /app
EXPOSE 5173

# CMD se sobreescribe en docker-compose.override.yml
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ── Static serve stage (producción) ───────────────────────────────────────────
FROM nginx:alpine AS production

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
