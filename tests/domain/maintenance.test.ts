import { describe, expect, it } from 'vitest';
import { RoomUnderMaintenance } from '../../src/domain/errors';
import { assertOutsideMaintenance, type Room } from '../../src/domain/room';

// Salle Björk de l'énoncé : maintenance du 5 nov. 2026 0 h au 8 nov. 2026 0 h.
const room: Room = {
  id: 'room-4',
  name: 'Salle Björk',
  capacity: 3,
  maintenance: { start: new Date('2026-11-05T00:00:00Z'), end: new Date('2026-11-08T00:00:00Z') },
};
const slot = (start: string, end: string) => ({ start: new Date(start), end: new Date(end) });

describe('règle 5 : maintenance', () => {
  it('refuse un créneau dans la période', () => {
    expect(() => assertOutsideMaintenance(slot('2026-11-06T14:00:00Z', '2026-11-06T16:00:00Z'), room)).toThrow(
      RoomUnderMaintenance,
    );
  });

  it('refuse un créneau qui empiète sur le début de la maintenance', () => {
    expect(() => assertOutsideMaintenance(slot('2026-11-04T22:00:00Z', '2026-11-05T01:00:00Z'), room)).toThrow(
      RoomUnderMaintenance,
    );
  });

  it('refuse un créneau qui empiète sur la fin de la maintenance', () => {
    expect(() => assertOutsideMaintenance(slot('2026-11-07T23:00:00Z', '2026-11-08T02:00:00Z'), room)).toThrow(
      RoomUnderMaintenance,
    );
  });

  it('refuse un créneau qui englobe toute la maintenance', () => {
    expect(() => assertOutsideMaintenance(slot('2026-11-04T10:00:00Z', '2026-11-09T10:00:00Z'), room)).toThrow(
      RoomUnderMaintenance,
    );
  });

  it('accepte un créneau qui se termine à l’instant où la maintenance commence', () => {
    expect(() => assertOutsideMaintenance(slot('2026-11-04T22:00:00Z', '2026-11-05T00:00:00Z'), room)).not.toThrow();
  });

  it('accepte un créneau qui commence à l’instant où la maintenance se termine', () => {
    expect(() => assertOutsideMaintenance(slot('2026-11-08T00:00:00Z', '2026-11-08T02:00:00Z'), room)).not.toThrow();
  });

  it('accepte un créneau avant ou après la période', () => {
    expect(() => assertOutsideMaintenance(slot('2026-11-04T14:00:00Z', '2026-11-04T16:00:00Z'), room)).not.toThrow();
    expect(() => assertOutsideMaintenance(slot('2026-11-09T14:00:00Z', '2026-11-09T16:00:00Z'), room)).not.toThrow();
  });

  it('accepte tout créneau dans une salle sans maintenance', () => {
    const free: Room = { ...room, maintenance: null };
    expect(() => assertOutsideMaintenance(slot('2026-11-06T14:00:00Z', '2026-11-06T16:00:00Z'), free)).not.toThrow();
  });
});
