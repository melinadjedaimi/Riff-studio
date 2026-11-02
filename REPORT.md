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

## 2. Cache clé-valeur (Valkey)

### Ce qui est mis en cache

La réponse de `GET /rooms/:id/bookings?from=…&to=…`, pour chaque salle et chaque fenêtre demandée
(`src/infrastructure/valkeyPlanningCache.ts`, derrière le port `PlanningCache` du domaine).

| Clé | Valeur | Durée de vie |
|---|---|---|
| `planning:{roomId}:v{version}:{from}:{to}` | JSON de la liste des réservations confirmées | 300 s (`EX 300`) |
| `planning:{roomId}:version` | entier (compteur de la salle), absent = 0 | aucune |

- **Pourquoi cette granularité** : un planning est demandé par salle et par fenêtre, donc une clé par couple (salle, fenêtre). Les membres consultent surtout « la semaine » : les mêmes fenêtres reviennent, le cache est efficace.
- **Pourquoi 300 s** : l'exactitude ne repose pas sur le TTL (l'invalidation est immédiate, voir ci-dessous). Le TTL sert à ne pas garder indéfiniment les fenêtres qu'on ne redemande plus (la mémoire se vide seule). 5 minutes suffisent pour absorber les rafales de consultation (soirée de réservation) et limitent la durée d'une éventuelle donnée obsolète si une invalidation était perdue.
- **Le compteur de version n'expire pas** : c'est une petite clé par salle (4 clés au total) ; s'il expirait, une entrée ancienne pourrait redevenir lisible.

### Invalidation immédiate

Après le `COMMIT` d'une réservation ou d'une annulation, le cas d'usage appelle `invalidateRoom(roomId)`, qui fait `INCR planning:{roomId}:version`.
Les lectures suivantes construisent leur clé avec la nouvelle version : toutes les anciennes entrées de la salle
deviennent inatteignables d'un coup, sans `KEYS` ni suppression clé par clé, et expirent seules. Seule la salle concernée est invalidée.
La version est lue *avant* la lecture PostgreSQL : si une réservation est validée pendant le chargement, le résultat
potentiellement périmé est rangé sous l'ancienne version, que personne ne lira plus.

Tests (`tests/http/cache.test.ts`) : la seconde lecture vient du cache (une modification directe en SQL n'apparaît pas) ; un `POST` puis un `DELETE` sont visibles
dans le planning à la requête suivante ; seule la salle concernée est invalidée.

### Valkey indisponible

- Le client (`ioredis`) est configuré pour échouer vite : pas de file d'attente hors ligne, timeout de commande 250 ms, connexion en arrière-plan. Démarrer l'API ne dépend pas de Valkey.
- Toute erreur du cache est attrapée et journalisée (une fois toutes les 10 s au plus), puis la réponse est calculée depuis PostgreSQL. Seules les erreurs de PostgreSQL ou du domaine remontent.
- **Défaut trouvé pendant la démonstration, puis corrigé.** Première version : Valkey arrêté, une annulation ne pouvait pas faire son `INCR`.
  Au redémarrage de Valkey (qui avait conservé ses données), l'ancienne entrée du planning redevenait lisible et affichait **une réservation déjà annulée**.
  Correctif : un échec d'invalidation marque le cache « à purger » ; la lecture suivante supprime toutes les entrées de planning (par `SCAN`, jamais les compteurs) avant de s'en servir, et contourne le cache tant que cette purge échoue.
  Le cache est aussi considéré « à purger » au démarrage de l'API, pour le cas où elle était arrêtée pendant l'incident.
  Deux tests couvrent ces cas (« une invalidation ratée… » et « un nouveau démarrage… ») ; le premier échoue si on retire le correctif.
- Limite assumée : l'état « à purger » est en mémoire du processus. Avec plusieurs instances de l'API, il faudrait le partager. L'association n'a qu'une instance.

### Sorties réelles

Serveur lancé avec `npm run start` (port 3100), base de départ, Valkey en marche. Première lecture du planning de `room-1` :

```
$ curl "localhost:3100/rooms/room-1/bookings?from=2026-11-02T00:00:00Z&to=2026-11-09T00:00:00Z"
[{"id":"booking-1","roomId":"room-1","memberId":"member-1","start":"2026-11-03T18:00:00Z","end":"2026-11-03T20:00:00Z","status":"confirmed"}] [HTTP 200]

$ valkey-cli KEYS "planning:*"
planning:room-1:v0:2026-11-02T00:00:00.000Z:2026-11-09T00:00:00.000Z

$ valkey-cli GET planning:room-1:v0:2026-11-02T00:00:00.000Z:2026-11-09T00:00:00.000Z
[{"id":"booking-1","roomId":"room-1","memberId":"member-1","start":"2026-11-03T18:00:00.000Z","end":"2026-11-03T20:00:00.000Z","status":"confirmed"}]

$ valkey-cli TTL planning:room-1:v0:2026-11-02T00:00:00.000Z:2026-11-09T00:00:00.000Z
299
```

Puis un `POST` de réservation ; le planning demandé aussitôt contient les deux réservations, et le compteur est passé à 1 :

```
$ curl -X POST localhost:3100/rooms/room-1/bookings -d '{"memberId":"member-3","start":"2026-11-04T14:00:00Z","end":"2026-11-04T16:00:00Z"}'
HTTP/1.1 201 Created
location: /bookings/d7008c9d-ae97-46f0-89ee-091b71dbef96

$ curl "localhost:3100/rooms/room-1/bookings?from=…&to=…"
[{"id":"booking-1",…},{"id":"d7008c9d-ae97-46f0-89ee-091b71dbef96","roomId":"room-1","memberId":"member-3",…,"status":"confirmed"}]

$ valkey-cli KEYS "planning:*"
planning:room-1:v0:2026-11-02T00:00:00.000Z:2026-11-09T00:00:00.000Z
planning:room-1:version
planning:room-1:v1:2026-11-02T00:00:00.000Z:2026-11-09T00:00:00.000Z

$ valkey-cli GET planning:room-1:version
1
```

Scénario d'indisponibilité avec le correctif (identifiants raccourcis ; chaque étape est une vraie commande) :

```
1) GET planning (1re lecture, amorce le cache)                 -> booking-1
2) POST réservation member-3                                    -> id=244016f3-…
3) GET planning (entrée v1 en cache)                            -> booking-1, 244016f3-
4) docker compose stop valkey                                   -> Container examen-anonyme-valkey-1 Stopped
5) GET planning, Valkey arrêté                                  -> [HTTP 200, 0.217846s]
6) DELETE de la réservation, Valkey arrêté                      -> [HTTP 204, 0.211042s]
7) docker compose start valkey
8) GET planning, Valkey revenu avec ses anciennes entrées       -> booking-1   (la réservation annulée n'apparaît pas)
9) valkey-cli KEYS "planning:*"                                 -> planning:room-1:v1:2026-11-02T00:00:00.000Z:2026-11-09T00:00:00.000Z
                                                                   planning:room-1:version
journal de l'API : « Valkey indisponible, repli sur PostgreSQL »
```

L'API répond en 200/204 sans erreur 500 pendant l'arrêt, avec un surcoût d'environ 0,2 s (le timeout de commande) tant que Valkey est coupé.

## 3. Quelles données dans Valkey, lesquelles dans PostgreSQL

| Donnée | Où | Pourquoi |
|---|---|---|
| Réservations, salles, membres | **PostgreSQL** | Source de vérité. Il faut des contraintes (clés étrangères, `CHECK`, exclusion `gist` contre le chevauchement), des transactions (limite de 2 réservations, annulation) et un historique durable : une annulation reste enregistrée. |
| Planning d'une salle sur une fenêtre | **Valkey** (copie) | Donnée dérivée, relue souvent, facile à recalculer. Si on la perd, on la recalcule : on peut perdre le cache sans perdre de donnée. |
| Compteur de version par salle | **Valkey** | Petit, atomique (`INCR`), sert uniquement l'invalidation. |
| Évolutions possibles | Valkey | Limitation du débit, sessions, verrous temporaires : des données à durée de vie courte, sans exigence d'historique. |

**Les réservations elles-mêmes pourraient-elles être stockées dans Valkey ? Non, pas raisonnablement :**

- Valkey n'a pas de contrainte d'exclusion : empêcher deux réservations simultanées de la même salle reposerait sur du code applicatif (scripts Lua, verrous) à écrire et à prouver, alors que PostgreSQL le garantit nativement.
- Pas de transactions relationnelles comparables : la limite de 2 réservations à venir par membre, l'annulation et les index secondaires seraient à maintenir à la main.
- La durabilité dépend de la configuration de persistance (RDB périodique, AOF) ; avec un instantané toutes les quelques minutes, un incident perdrait des réservations confirmées, ce qui est inacceptable pour la source de vérité (alors que perdre le cache est sans conséquence).
- Les requêtes par plage de dates (« le planning de la semaine », « les réservations à venir d'un membre ») sont naturelles en SQL et laborieuses en clé-valeur (ensembles triés, index à entretenir).

**Taille de l'association** : 4 salles, quelques membres, quelques réservations par jour, soit au plus quelques dizaines de milliers de lignes en dix ans.
À cette échelle, PostgreSQL seul répond largement (le planning est déjà de l'ordre de la milliseconde, voir section 1) : le cache est un bonus,
pas une nécessité. Il apporte un peu de marge lors des pics du soir. Son coût (une brique de plus à opérer,
une invalidation à garder juste, un défaut réel trouvé ci-dessus) se justifie par l'exercice plus que par le besoin réel : l'API fonctionne identiquement sans lui,
ce que garantit le repli sur PostgreSQL. Ne pas faire de Valkey la source de vérité garde le système simple à sauvegarder (une seule base à restaurer, voir section 4).
