# Studio Riff : API de réservation

API de réservation des quatre salles de répétition de l'association Studio Riff.
TypeScript (strict) sur Node, Fastify, PostgreSQL 17 (`pg`, SQL brut) et Valkey (cache du planning).

- Conception, règles métier, ADR : [DECISIONS.md](DECISIONS.md)
- Mesures, cache, sauvegarde, RPO/RTO : [REPORT.md](REPORT.md)

## Prérequis

- Node.js 22 ou plus (développé et testé avec Node 26) et npm
- Docker avec Docker Compose v2
- `bash` pour `backup.sh` et `restore.sh` (Git Bash sous Windows)

## Démarrage

```bash
# 1. Dépendances
npm install

# 2. Configuration (aucun secret réel : valeurs d'exemple pour le développement local)
cp .env.example .env

# 3. Démarrer PostgreSQL et Valkey, et attendre qu'ils soient prêts
docker compose up -d --wait

# 4. Appliquer les migrations (base vide acceptée), puis insérer les données de départ
npm run db:migrate
npm run db:seed

# 5. Lancer l'API (http://127.0.0.1:3000, rechargement automatique)
npm run dev
```

`npm run start` lance l'API sans rechargement. Variables : `DATABASE_URL` et `VALKEY_URL` (voir `.env.example`),
`PORT` (3000 par défaut) et `HOST` (127.0.0.1 par défaut). Si `VALKEY_URL` est absente, l'API tourne sans cache.

`db:seed` peut être rejoué sans erreur (il n'écrase rien). Pour repartir de zéro : `docker compose down -v`, puis reprendre à l'étape 3.

> **Port déjà utilisé ?** Les bases n'écoutent que sur `127.0.0.1:5432` (PostgreSQL) et `127.0.0.1:6379` (Valkey).
> Si un de ces ports est pris, créez un `compose.override.yaml` (ignoré par Git) :
>
> ```yaml
> services:
>   postgres:
>     ports: !override
>       - "127.0.0.1:5440:5432"
> ```
>
> et reportez le port dans `DATABASE_URL` (ou `VALKEY_URL`) de votre `.env`.

## Tests

```bash
npm test          # tout : unitaires, base de données, HTTP, cache
npm run typecheck # vérification des types
```

Les bases doivent tourner (`docker compose up -d --wait`). Les tests s'exécutent sur une base **dédiée**
`<nom de la base>_test` (par exemple `studio_riff_test`), créée et migrée automatiquement : vos données de développement ne sont pas touchées.
Chaque test de base de données et HTTP vide les tables, puis réinsère les données de départ de l'énoncé.
L'horloge est fixée au lundi 2 novembre 2026, 9 h UTC. Les tests unitaires du domaine (`tests/domain`) n'utilisent ni base ni HTTP.

Les tests du cache utilisent Valkey et ne suppriment que les clés `planning:*`.

## Utiliser l'API

Toutes les heures sont en UTC (ISO 8601 avec `Z`). Les erreurs ont la forme `{ "error": "code", "message": "…" }`.

```bash
# Les salles
curl localhost:3000/rooms

# Planning d'une salle sur une période (réservations confirmées, triées par début) : 200 | 400 | 404
curl "localhost:3000/rooms/room-1/bookings?from=2026-11-02T00:00:00Z&to=2026-11-09T00:00:00Z"

# Réserver : 201 + Location | 400 | 404 | 409
curl -i -X POST localhost:3000/rooms/room-1/bookings \
  -H 'content-type: application/json' \
  -d '{"memberId":"member-3","start":"2027-01-04T14:00:00Z","end":"2027-01-04T16:00:00Z"}'

# Une réservation : 200 | 404
curl localhost:3000/bookings/booking-1

# Annuler (la réservation reste enregistrée : cancelled, ou late_cancelled à moins de 24 h du début) : 204 | 404 | 409
curl -i -X DELETE localhost:3000/bookings/booking-2

# Les réservations d'un membre : 200 | 404
curl localhost:3000/members/member-1/bookings
```

| Code | Cas |
|---|---|
| 400 | corps ou dates invalides, créneau hors règles (durée, heure pleine, 10 h–23 h), `from`/`to` manquants ou invalides |
| 404 | salle, membre ou réservation inconnus |
| 409 | chevauchement, 2 réservations à venir déjà atteintes, salle en maintenance, réservation déjà annulée |

## Sauvegarde et restauration

```bash
npm run backup    # ./backup.sh : écrit backup.dump (pg_dump -Fc)
npm run restore   # ./restore.sh : restaure dans une NOUVELLE base studio_riff_restore
                  #   et compare le nombre de lignes de chaque table avec la base d'origine
```

`./backup.sh mon.dump` et `./restore.sh mon.dump ma_base` acceptent un fichier et une base cible ; le script refuse de restaurer dans la base d'origine.

## Reproduire la mesure de l'index

La migration `002` crée l'index ; la procédure ci-dessous le supprime d'abord pour mesurer le « avant ».

```bash
PSQL="docker compose exec -T postgres psql -U studio -d studio_riff"

$PSQL -c "DROP INDEX IF EXISTS bookings_room_start;"
$PSQL < scripts/measure/fill.sql      # 100 000 réservations générées + ANALYZE
$PSQL < scripts/measure/explain.sql   # EXPLAIN ANALYZE : Seq Scan (sans l'index)

$PSQL -c "CREATE INDEX bookings_room_start ON bookings (room_id, start_at);"
$PSQL -c "ANALYZE bookings;"
$PSQL < scripts/measure/explain.sql   # Bitmap Index Scan (avec l'index)

$PSQL < scripts/measure/clean.sql && npm run db:seed   # retour aux données de départ
```

Résultats commentés : [REPORT.md](REPORT.md#1-mesure-dune-requête--planning-dune-salle-sur-une-semaine).

## Organisation du code

```
src/domain/          règles métier pures, Clock, erreurs typées, ports (aucun import de Fastify, pg ni ioredis)
src/application/     cas d'usage (BookingService) : orchestrent règles, transactions et cache
src/infrastructure/  PostgreSQL (pg), cache Valkey, migrations, seed : implémentent les ports du domaine
src/http/            routes Fastify, validation (zod), erreurs du domaine → codes HTTP
src/main.ts          composition (horloge réelle, pool, cache)
migrations/          fichiers .sql numérotés
scripts/             migrate.ts, seed.ts, measure/*.sql
tests/               domain/ (unitaires), db/ (cas d'usage + base), http/ (routes, cache)
```
