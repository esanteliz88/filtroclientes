#!/bin/sh
set -e

# Start internal Redis for single-container deployments.
redis-server --save "" --appendonly no --bind 127.0.0.1 --port 6379 --daemonize yes

# Wait until Redis is reachable to avoid Fastify plugin startup timeout.
for i in $(seq 1 30); do
  if redis-cli -h 127.0.0.1 -p 6379 ping >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

exec node dist/index.js
