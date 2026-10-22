#!/usr/bin/env bash
# Deploy VANTA on an OCI Linux VM. Existing Railway data must be migrated first.
set -euo pipefail
cd "$(dirname "$0")/../.."

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is not installed." >&2; exit 1
fi
docker compose version >/dev/null

if [[ ! -f .env ]]; then
  echo "ERROR: Create .env from deploy/oracle/example.env and provide secrets locally." >&2
  exit 1
fi
chmod 600 .env
mkdir -p data

if [[ ! -f data/accounts.enc && "${VANTA_ALLOW_EMPTY_DATA:-}" != "1" ]]; then
  echo "BLOCKED: data/accounts.enc is missing. Migrate the encrypted Railway /data volume first." >&2
  echo "Only for a deliberate new install: VANTA_ALLOW_EMPTY_DATA=1 ./deploy/oracle/deploy.sh" >&2
  exit 1
fi

echo "Validating OCI Compose configuration..."
docker compose --env-file .env -f compose.oracle.yaml config --quiet

echo "Building OCI application image..."
docker compose --env-file .env -f compose.oracle.yaml build vanta

echo "Running the same VANTA regression checks used for Railway..."
docker compose --env-file .env -f compose.oracle.yaml run --rm --no-deps vanta npm run check

echo "Starting VANTA and HTTPS reverse proxy..."
docker compose --env-file .env -f compose.oracle.yaml up -d --wait
docker compose --env-file .env -f compose.oracle.yaml ps
echo "OCI deployment is up. Verify public HTTPS, login/session, Account Pool, history and uploads before switching users."
