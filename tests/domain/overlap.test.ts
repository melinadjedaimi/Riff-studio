import { describe, expect, it } from 'vitest';
import { assertNoOverlap, type Booking } from '../../src/domain/booking';
import { SlotOverlap } from '../../src/domain/errors';

const existing: Booking = {
  id: 'b',
  roomId: 'room-1',
  memberId: 'member-1',
  start: new Date('2026-11-04T14:00:00Z'),
  end: new Date('2026-11-04T16:00:00Z'),
  status: 'confirmed',
};
const slot = (start: string, end: string) => ({ start: new Date(start), end: new Date(end) });

describe('règle 2 : chevauchement (domaine)', () => {
  it('accepte un créneau qui commence à l’heure où le précédent se termine', () => {
    expect(() => assertNoOverlap(slot('2026-11-04T16:00:00Z', '2026-11-04T18:00:00Z'), [existing])).not.toThrow();
  });

  it('accepte un créneau qui se termine à l’heure où le suivant commence', () => {
    expect(() => assertNoOverlap(slot('2026-11-04T12:00:00Z', '2026-11-04T14:00:00Z'), [existing])).not.toThrow();
  });

  it('refuse un chevauchement partiel au début', () => {
    expect(() => assertNoOverlap(slot('2026-11-04T13:00:00Z', '2026-11-04T15:00:00Z'), [existing])).toThrow(SlotOverlap);
  });

  it('refuse un chevauchement partiel à la fin', () => {
    expect(() => assertNoOverlap(slot('2026-11-04T15:00:00Z', '2026-11-04T17:00:00Z'), [existing])).toThrow(SlotOverlap);
  });

  it('refuse un créneau contenu dans une réservation', () => {
    expect(() => assertNoOverlap(slot('2026-11-04T15:00:00Z', '2026-11-04T16:00:00Z'), [existing])).toThrow(SlotOverlap);
  });

  it('refuse un créneau qui en englobe un autre', () => {
    expect(() => assertNoOverlap(slot('2026-11-04T12:00:00Z', '2026-11-04T18:00:00Z'), [existing])).toThrow(SlotOverlap);
  });

  it('refuse le même créneau', () => {
    expect(() => assertNoOverlap(slot('2026-11-04T14:00:00Z', '2026-11-04T16:00:00Z'), [existing])).toThrow(SlotOverlap);
  });

  it('ignore les réservations annulées', () => {
    const cancelled = { ...existing, status: 'cancelled' as const };
    const late = { ...existing, status: 'late_cancelled' as const };
    const same = slot('2026-11-04T14:00:00Z', '2026-11-04T16:00:00Z');
    expect(() => assertNoOverlap(same, [cancelled, late])).not.toThrow();
  });
});
