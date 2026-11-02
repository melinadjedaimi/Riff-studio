CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE rooms (
  id                text PRIMARY KEY,
  name              text NOT NULL,
  capacity          integer NOT NULL CHECK (capacity > 0),
  maintenance_start timestamptz,
  maintenance_end   timestamptz,
  CONSTRAINT rooms_maintenance_coherent CHECK (
    (maintenance_start IS NULL AND maintenance_end IS NULL)
    OR (maintenance_start IS NOT NULL AND maintenance_end IS NOT NULL AND maintenance_end > maintenance_start)
  )
);

CREATE TABLE members (
  id   text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE bookings (
  id           text PRIMARY KEY,
  room_id      text NOT NULL REFERENCES rooms (id),
  member_id    text NOT NULL REFERENCES members (id),
  start_at     timestamptz NOT NULL,
  end_at       timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'confirmed',
  created_at   timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CONSTRAINT bookings_status_valid CHECK (status IN ('confirmed', 'cancelled', 'late_cancelled')),
  CONSTRAINT bookings_end_after_start CHECK (end_at > start_at),
  -- Deux réservations confirmées d'une même salle ne se chevauchent jamais.
  -- Intervalle [start, end) : un créneau peut commencer à l'heure où le précédent finit.
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    room_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (status = 'confirmed')
);

CREATE INDEX bookings_member ON bookings (member_id);
