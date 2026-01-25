#!/bin/bash

# Cleanup function to tear down docker containers
cleanup() {
  echo ""
  echo "Shutting down..."
  docker compose down
  exit 0
}

# Trap SIGINT (Ctrl+C) and SIGTERM
trap cleanup SIGINT SIGTERM

# Start docker compose in the background
echo "Starting PostgreSQL container..."
docker compose up -d

# Wait for postgres to be ready
echo "Waiting for PostgreSQL to be ready..."
until docker compose exec -T postgres pg_isready -U user -d everyfield > /dev/null 2>&1; do
  sleep 1
done
echo "PostgreSQL is ready!"

# Start next dev
echo "Starting Next.js development server..."
pnpm dev:next &
NEXT_PID=$!

# Wait for next process to finish
wait $NEXT_PID

# Cleanup when next exits
cleanup
