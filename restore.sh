#!/usr/bin/env bash
# Restaure une sauvegarde dans une NOUVELLE base (jamais dans la base d'origine),
# puis compare le nombre de lignes de chaque table des deux côtés.
# Usage : ./restore.sh [fichier] [base_cible]   (défauts : backup.dump, <base>_restore)
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
POSTGRES_USER="${POSTGRES_USER:-studio}"
POSTGRES_DB="${POSTGRES_DB:-studio_riff}"
DUMP="${1:-backup.dump}"
TARGET_DB="${2:-${POSTGRES_DB}_restore}"
TABLES=(rooms members bookings)

if [ "$TARGET_DB" = "$POSTGRES_DB" ]; then
  echo "Refus : la restauration ne doit pas écraser la base d'origine (${POSTGRES_DB})." >&2
  exit 1
fi
if [ ! -s "$DUMP" ]; then
  echo "Sauvegarde introuvable ou vide : ${DUMP} (lancez ./backup.sh d'abord)." >&2
  exit 1
fi

pg() { docker compose exec -T postgres "$@"; }

echo "Création de la base ${TARGET_DB} (supprimée d'abord si elle existe)"
pg dropdb -U "$POSTGRES_USER" --if-exists "$TARGET_DB"
pg createdb -U "$POSTGRES_USER" "$TARGET_DB"

echo "Restauration de ${DUMP} dans ${TARGET_DB}"
pg pg_restore -U "$POSTGRES_USER" -d "$TARGET_DB" --no-owner --exit-on-error < "$DUMP"

count() { pg psql -U "$POSTGRES_USER" -d "$1" -tA -c "SELECT count(*) FROM $2" | tr -d '\r'; }

printf '\n%-10s %12s %12s  %s\n' table "${POSTGRES_DB}" "${TARGET_DB}" résultat
status=0
for table in "${TABLES[@]}"; do
  original="$(count "$POSTGRES_DB" "$table")"
  restored="$(count "$TARGET_DB" "$table")"
  if [ "$original" = "$restored" ]; then verdict=identique; else verdict=DIFFERENT; status=1; fi
  printf '%-10s %12s %12s  %s\n' "$table" "$original" "$restored" "$verdict"
done

if [ "$status" -eq 0 ]; then echo "Restauration vérifiée : les nombres de lignes concordent."; else echo "ÉCHEC : écart de lignes." >&2; fi
exit "$status"
