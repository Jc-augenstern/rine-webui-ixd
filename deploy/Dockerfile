FROM node:24.18.0-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci && npm run build:all

FROM build AS api-dependencies
RUN npm prune --omit=dev

FROM node:24.18.0-bookworm-slim AS api
ENV NODE_ENV=production IXD_ROOT=/app HOST=0.0.0.0 PORT=3000 STORAGE_PATH=/data/uploads
WORKDIR /app
COPY --from=api-dependencies /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/admin/package.json ./admin/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/migrations ./server/migrations
RUN mkdir -p /data/uploads /data/private && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/server/src/index.js"]

FROM nginx:1.30.5-alpine AS web
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/admin/dist /usr/share/nginx/html/admin
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_FILTER=IXD_DOMAIN
EXPOSE 80 443
