#!/usr/bin/env bash
# Sauvegarde logique de la base PostgreSQL (format custom de pg_dump).
# Usage : ./backup.sh [fichier]   (défaut : backup.dump)
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
POSTGRES_USER="${POSTGRES_USER:-studio}"
POSTGRES_DB="${POSTGRES_DB:-studio_riff}"
OUT="${1:-backup.dump}"

# Écrit dans un fichier temporaire : un échec de pg_dump ne détruit pas la sauvegarde précédente.
TMP="$(mktemp "${OUT}.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "$TMP"
mv "$TMP" "$OUT"
trap - EXIT

echo "Sauvegarde de ${POSTGRES_DB} écrite dans ${OUT} ($(wc -c < "$OUT") octets)"
