import { describe, expect, it } from 'vitest';
import { assertMemberUnderLimit, countUpcoming, type Booking } from '../../src/domain/booking';
import { FixedClock } from '../../src/domain/clock';
import { MemberLimitReached } from '../../src/domain/errors';

// Horloge de l'énoncé : lundi 2 novembre 2026, 9 h UTC.
const clock = new FixedClock(new Date('2026-11-02T09:00:00Z'));

const booking = (id: string, start: string, status: Booking['status'] = 'confirmed'): Booking => {
  const s = new Date(start);
  return { id, roomId: 'room-1', memberId: 'member-1', start: s, end: new Date(s.getTime() + 3_600_000), status };
};

describe('règle 3 : 2 réservations à venir au plus', () => {
  it('accepte un membre sans réservation', () => {
    expect(() => assertMemberUnderLimit([], clock)).not.toThrow();
  });

  it('accepte un membre avec 1 réservation à venir', () => {
    expect(() => assertMemberUnderLimit([booking('a', '2026-11-03T18:00:00Z')], clock)).not.toThrow();
  });

  it('refuse une 3e réservation à venir', () => {
    const two = [booking('a', '2026-11-03T18:00:00Z'), booking('b', '2026-11-10T14:00:00Z')];
    expect(() => assertMemberUnderLimit(two, clock)).toThrow(MemberLimitReached);
  });

  it('ne compte pas les réservations passées', () => {
    const list = [
      booking('past', '2026-10-28T19:00:00Z'),
      booking('a', '2026-11-03T18:00:00Z'),
      booking('b', '2026-11-10T14:00:00Z'),
    ];
    expect(countUpcoming(list, clock)).toBe(2);
    expect(() => assertMemberUnderLimit([list[0]!, list[1]!], clock)).not.toThrow();
  });

  it('ne compte pas les réservations annulées', () => {
    const list = [
      booking('a', '2026-11-03T18:00:00Z'),
      booking('b', '2026-11-10T14:00:00Z', 'cancelled'),
      booking('c', '2026-11-11T14:00:00Z', 'late_cancelled'),
    ];
    expect(countUpcoming(list, clock)).toBe(1);
    expect(() => assertMemberUnderLimit(list, clock)).not.toThrow();
  });

  it('une réservation qui commence exactement maintenant n’est plus à venir', () => {
    expect(countUpcoming([booking('now', '2026-11-02T09:00:00Z')], clock)).toBe(0);
  });

  it('dépend de l’horloge : le même membre peut réserver quand ses créneaux sont passés', () => {
    const two = [booking('a', '2026-11-03T18:00:00Z'), booking('b', '2026-11-10T14:00:00Z')];
    const later = new FixedClock(new Date('2026-11-04T00:00:00Z'));
    expect(() => assertMemberUnderLimit(two, later)).not.toThrow();
  });
});
