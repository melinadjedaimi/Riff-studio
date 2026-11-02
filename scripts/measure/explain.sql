EXPLAIN ANALYZE SELECT * FROM bookings WHERE room_id = 'room-1' AND status = 'confirmed' AND start_at < '2028-03-08' AND end_at > '2028-03-01' ORDER BY start_at;
