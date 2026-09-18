# Multi-stage, non-root (spec AC row 7): node builds the Vite bundle, nginx
# (unprivileged variant, listens 8080) serves it and proxies /api to the api
# container — browser traffic is same-origin, so CORS stays an explicit list.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
