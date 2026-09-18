#!/usr/bin/env bash
# Containerized smoke check (spec AC row 7): build both images, boot the
# compose stack, assert health, a real auth round-trip through the nginx
# proxy, and that containers do not run as root — then tear everything down.
# Needs docker compose v2, curl, openssl; nothing else.
set -euo pipefail
cd "$(dirname "$0")/../.."

SMOKE_ENV=$(mktemp /tmp/ideaforge-smoke-env.XXXXXX)
cleanup() {
  docker compose --env-file "$SMOKE_ENV" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$SMOKE_ENV"
}
trap cleanup EXIT

# Ephemeral secrets generated per run — nothing real is ever needed here.
cp backend/.env.example "$SMOKE_ENV"
sed -i \
  -e "s|^MONGO_URL=.*|MONGO_URL=mongodb://mongo:27017|" \
  -e "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 32)|" \
  -e "s|^ENCRYPTION_MASTER_KEY=.*|ENCRYPTION_MASTER_KEY=$(openssl rand -base64 32)|" \
  -e "s|^CORS_ORIGINS=.*|CORS_ORIGINS=http://localhost:3000|" \
  -e "s|^API_ENV_FILE=.*||" \
  "$SMOKE_ENV"
echo "API_ENV_FILE=$SMOKE_ENV" >> "$SMOKE_ENV"

docker compose --env-file "$SMOKE_ENV" up -d --build

echo "--- waiting for api health (live + ready/mongo ping)"
healthy=0
for i in $(seq 1 60); do
  if curl -fsS http://localhost:8000/health/live >/dev/null 2>&1 \
     && curl -fsS http://localhost:8000/health/ready >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done
if [ "$healthy" != 1 ]; then
  echo "FAIL: api never became healthy"
  docker compose --env-file "$SMOKE_ENV" logs api || true
  exit 1
fi

echo "--- web shell served by nginx"
curl -fsS http://localhost:3000/ | grep -q '<div id="root">'

echo "--- register + /me round-trip through the nginx proxy (browser path)"
EMAIL="smoke-$(date +%s)@ideaforge.test"
BODY="{\"name\":\"Smoke\",\"email\":\"$EMAIL\",\"password\":\"correct-horse-42\"}"
curl -fsS -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' -d "$BODY" > /tmp/ideaforge-smoke-register.json
TOK=$(python3 -c "import json;print(json.load(open('/tmp/ideaforge-smoke-register.json'))['access_token'])")
curl -fsS http://localhost:3000/api/auth/me -H "Authorization: Bearer $TOK" | grep -q "$EMAIL"

echo "--- containers run non-root"
uid_api=$(docker compose --env-file "$SMOKE_ENV" exec -T api id -u)
uid_web=$(docker compose --env-file "$SMOKE_ENV" exec -T web id -u)
if [ "$uid_api" = "0" ] || [ "$uid_web" = "0" ]; then
  echo "FAIL: container runs as root (api=$uid_api web=$uid_web)"
  exit 1
fi

echo "compose smoke OK (health, auth round-trip, non-root)"
