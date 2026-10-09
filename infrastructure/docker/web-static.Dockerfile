FROM nginx:1.30.5-alpine
COPY nginx-main.conf /etc/nginx/nginx.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist /usr/share/nginx/html
RUN chmod -R a+rX /etc/nginx/nginx.conf /etc/nginx/conf.d /usr/share/nginx/html
USER 101:101
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
