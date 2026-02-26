FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache redis

COPY package.json package-lock.json* ./
RUN npm install --production=false

COPY . .
RUN npm run build

COPY docker/start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

EXPOSE 8080

CMD ["/usr/local/bin/start.sh"]
