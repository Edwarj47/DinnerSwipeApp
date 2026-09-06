FROM node:20-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages packages
RUN npm install
COPY apps/mobile apps/mobile
RUN npm run build:web -w apps/mobile

FROM nginx:1.27-alpine
COPY infrastructure/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/mobile/dist /usr/share/nginx/html
