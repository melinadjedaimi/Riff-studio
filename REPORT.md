# REPORT — Studio Riff

Toutes les sorties ci-dessous viennent d'exécutions réelles sur PostgreSQL 17.6 (conteneur Docker de `compose.yaml`).

## 1. Mesure d'une requête : planning d'une salle sur une semaine

### Jeu de données

Base de développement remplie avec le script du sujet (100 000 réservations `gen-*` réparties sur les 4 salles,
13 créneaux par jour, à partir du 1er janvier 2027), exécuté directement en SQL, puis `ANALYZE bookings` :

```
INSERT 0 100000
ANALYZE
 total
--------
 100004          -- 100 000 générées + 4 réservations de départ
```

L'insertion de 100 000 lignes (contrainte d'exclusion comprise) a pris environ 8 s, `docker compose exec` compris.
La base a ensuite été remise aux données de départ (`TRUNCATE` + `npm run db:seed`).

### Requête

Celle du planning (`listConfirmedInRange` dans `src/infrastructure/pgBookingRepository.ts`), pour `room-1`
du 1er au 8 mars 2028 :

```sql
EXPLAIN ANALYZE SELECT * FROM bookings
 WHERE room_id = 'room-1' AND status = 'confirmed'
   AND start_at < '2028-03-08' AND end_at > '2028-03-01'
 ORDER BY start_at;
```

### Avant l'index

À ce stade, la table ne porte que sa clé primaire, l'index sur `member_id` et l'index GiST de la contrainte
d'exclusion (inutilisable ici : la requête compare `start_at` et `end_at` séparément, pas la plage `tstzrange`).

```
 Sort  (cost=3498.66..3509.60 rows=4375 width=67) (actual time=6.377..6.381 rows=91 loops=1)
   Sort Key: start_at
   Sort Method: quicksort  Memory: 32kB
   ->  Seq Scan on bookings  (cost=0.00..3234.08 rows=4375 width=67) (actual time=1.508..6.352 rows=91 loops=1)
         Filter: ((start_at < '2028-03-08 00:00:00+00'::timestamp with time zone) AND (end_at > '2028-03-01 00:00:00+00'::timestamp with time zone) AND (room_id = 'room-1'::text) AND (status = 'confirmed'::text))
         Rows Removed by Filter: 99913
 Planning Time: 0.323 ms
 Execution Time: 6.415 ms
```

### Création de l'index

Migration `migrations/002_bookings_room_start_index.sql`, appliquée avec `npm run db:migrate`, puis `ANALYZE bookings` :

```sql
CREATE INDEX bookings_room_start ON bookings (room_id, start_at);
```

### Après l'index (même requête)

```
 Sort  (cost=1750.05..1760.83 rows=4313 width=67) (actual time=1.141..1.145 rows=91 loops=1)
   Sort Key: start_at
   Sort Method: quicksort  Memory: 32kB
   ->  Bitmap Heap Scan on bookings  (cost=144.89..1489.67 rows=4313 width=67) (actual time=1.092..1.111 rows=91 loops=1)
         Recheck Cond: ((room_id = 'room-1'::text) AND (start_at < '2028-03-08 00:00:00+00'::timestamp with time zone))
         Filter: ((end_at > '2028-03-01 00:00:00+00'::timestamp with time zone) AND (status = 'confirmed'::text))
         Rows Removed by Filter: 5526
         Heap Blocks: exact=277
         ->  Bitmap Index Scan on bookings_room_start  (cost=0.00..143.81 rows=5539 width=0) (actual time=0.157..0.158 rows=5617 loops=1)
               Index Cond: ((room_id = 'room-1'::text) AND (start_at < '2028-03-08 00:00:00+00'::timestamp with time zone))
 Planning Time: 0.358 ms
 Execution Time: 1.185 ms
```

(Deux exécutions de chaque requête ont été faites ; la seconde, à cache chaud, est reproduite ici. La première donnait 6,690 ms avant l'index et 1,331 ms après.)

### Analyse

| | Avant | Après |
|---|---|---|
| Parcours | `Seq Scan` sur toute la table | `Bitmap Index Scan` + `Bitmap Heap Scan` |
| Lignes lues puis écartées (`Rows Removed by Filter`) | 99 913 | 5 526 |
| Pages de table lues | toute la table | 277 (`Heap Blocks: exact=277`) |
| Temps d'exécution | 6,415 ms | 1,185 ms |

L'index trouve directement les lignes de `room-1` dont le début est avant le 8 mars (5 617 entrées) au lieu de
lire les 100 004 lignes : le travail est divisé par près de 18 sur les lignes examinées, et le temps
par environ 5. En valeur absolue les deux requêtes restent rapides (quelques millisecondes) ; l'intérêt est
dans la croissance : le `Seq Scan` coûte proportionnellement au nombre total de réservations, l'index à celles de la salle.

Limite visible dans le plan : l'index ne couvre que `room_id` et `start_at`. La condition `end_at > from` est
filtrée après lecture de la table (5 526 lignes de la salle commençant avant le 8 mars mais finissant avant le 1er mars sont lues
puis écartées). Pour un planning d'une semaine c'est acceptable ; un index sur `(room_id, start_at, end_at)`
ou une requête bornant aussi `start_at` par le bas réduirait encore ce volume, mais n'est pas justifié à la taille de l'association.
