INSERT INTO bookings (id, room_id, member_id, start_at, end_at, status)
SELECT 'gen-' || g, 'room-' || (g % 4 + 1), 'member-' || (g % 3 + 1),
  timestamptz '2027-01-01 10:00+00' + (g / 52) * interval '1 day' + (g / 4 % 13) * interval '1 hour',
  timestamptz '2027-01-01 11:00+00' + (g / 52) * interval '1 day' + (g / 4 % 13) * interval '1 hour',
  'confirmed'
FROM generate_series(0, 99999) AS g;
ANALYZE bookings;
SELECT count(*) AS total FROM bookings;
