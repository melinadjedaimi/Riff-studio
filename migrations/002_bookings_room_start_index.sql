-- Planning d'une salle : filtre sur room_id puis sur la plage de dates (GET /rooms/:id/bookings).
CREATE INDEX bookings_room_start ON bookings (room_id, start_at);
