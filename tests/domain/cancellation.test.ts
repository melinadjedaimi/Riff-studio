import { describe, expect, it } from 'vitest';
import { cancellationStatus, type Booking } from '../../src/domain/booking';
import { FixedClock } from '../../src/domain/clock';
import { AlreadyCancelled } from '../../src/domain/errors';

// Horloge de l'énoncé : lundi 2 novembre 2026, 9 h UTC.
const clock = new FixedClock(new Date('2026-11-02T09:00:00Z'));

const booking = (start: string, status: Booking['status'] = 'confirmed'): Booking => {
  const s = new Date(start);
  return { id: 'b', roomId: 'room-1', memberId: 'member-1', start: s, end: new Date(s.getTime() + 3_600_000), status };
};

describe('règle 4 : annulation', () => {
  it('à exactement 24 h du début : cancelled', () => {
    expect(cancellationStatus(booking('2026-11-03T09:00:00Z'), clock)).toBe('cancelled');
  });

  it('à 23 h 59 du début : late_cancelled', () => {
    expect(cancellationStatus(booking('2026-11-03T08:59:00Z'), clock)).toBe('late_cancelled');
  });

  it('booking-3 de l’énoncé (début dans 10 h) : late_cancelled', () => {
    expect(cancellationStatus(booking('2026-11-02T19:00:00Z'), clock)).toBe('late_cancelled');
  });

  it('booking-2 de l’énoncé (début dans 8 jours) : cancelled', () => {
    expect(cancellationStatus(booking('2026-11-10T14:00:00Z'), clock)).toBe('cancelled');
  });

  it('après le début du créneau : late_cancelled', () => {
    expect(cancellationStatus(booking('2026-11-02T08:00:00Z'), clock)).toBe('late_cancelled');
  });

  it('dépend de l’horloge, pas de l’heure système', () => {
    const lateClock = new FixedClock(new Date('2026-11-09T14:00:00Z'));
    expect(cancellationStatus(booking('2026-11-10T14:00:00Z'), lateClock)).toBe('cancelled');
    lateClock.set(new Date('2026-11-09T14:00:01Z'));
    expect(cancellationStatus(booking('2026-11-10T14:00:00Z'), lateClock)).toBe('late_cancelled');
  });

  it('refuse d’annuler deux fois', () => {
    expect(() => cancellationStatus(booking('2026-11-10T14:00:00Z', 'cancelled'), clock)).toThrow(AlreadyCancelled);
    expect(() => cancellationStatus(booking('2026-11-10T14:00:00Z', 'late_cancelled'), clock)).toThrow(AlreadyCancelled);
  });
});
