FROM node:20-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages packages
RUN npm install
COPY apps/mobile apps/mobile
RUN npm run build:web -w apps/mobile

FROM nginx:1.30.5-alpine
COPY infrastructure/docker/nginx-main.conf /etc/nginx/nginx.conf
COPY infrastructure/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/mobile/dist /usr/share/nginx/html
RUN chmod -R a+rX /etc/nginx/nginx.conf /etc/nginx/conf.d /usr/share/nginx/html
USER 101:101
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
