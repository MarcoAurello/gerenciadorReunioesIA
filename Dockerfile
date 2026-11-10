# Frontend do Sistema de Apoio a Reuniões servido pelo Nginx.
# O backend continua no Google Apps Script (Code.gs), que não entra na imagem.
FROM nginx:1.27.3-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/seguranca.conf /etc/nginx/snippets/seguranca.conf

COPY index.html app.js style.css logo.svg /usr/share/nginx/html/
COPY docs/ /usr/share/nginx/html/docs/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
