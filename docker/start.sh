#!/bin/sh
set -e

# Start an internal Redis instance for single-container deployments.
redis-server --save "" --appendonly no --bind 127.0.0.1 --port 6379 --daemonize yes

exec node dist/index.js
