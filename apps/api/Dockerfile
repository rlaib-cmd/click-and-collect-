# Image de production de l'API Splash360 Commande.
# Construire depuis la racine du dépôt : docker build -f apps/api/Dockerfile -t splash360-api .

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter api...
COPY apps/api ./apps/api
RUN pnpm --filter api build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Seule dépendance non embarquée dans le bundle (instrumentation Sentry).
RUN npm install --omit=dev --no-audit --no-fund @sentry/node@11 && npm cache clean --force
COPY --from=build /repo/apps/api/dist ./dist
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT:-8787}/ready || exit 1
CMD ["node", "--enable-source-maps", "dist/server.mjs"]
