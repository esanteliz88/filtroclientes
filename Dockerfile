FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache redis

COPY package.json package-lock.json* ./
RUN npm install --production=false

COPY . .
RUN npm run build

COPY docker/start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

EXPOSE 3000

CMD ["/usr/local/bin/start.sh"]
