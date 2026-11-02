import { describe, expect, it } from 'vitest';
import { InvalidSlot } from '../../src/domain/errors';
import { validateSlot } from '../../src/domain/slot';

const at = (iso: string) => new Date(iso);
const slot = (start: string, end: string) => () => validateSlot(at(start), at(end));

describe('règle 1 : créneau', () => {
  describe('durée', () => {
    it.each([
      ['0 h', '2026-11-04T14:00:00Z', '2026-11-04T14:00:00Z'],
      ['5 h', '2026-11-04T14:00:00Z', '2026-11-04T19:00:00Z'],
      ['négative', '2026-11-04T14:00:00Z', '2026-11-04T13:00:00Z'],
    ])('refuse %s', (_, start, end) => {
      expect(slot(start, end)).toThrow(InvalidSlot);
    });

    it.each([
      ['1 h', '2026-11-04T14:00:00Z', '2026-11-04T15:00:00Z'],
      ['4 h', '2026-11-04T14:00:00Z', '2026-11-04T18:00:00Z'],
    ])('accepte %s', (_, start, end) => {
      expect(slot(start, end)).not.toThrow();
    });
  });

  describe('heure pleine', () => {
    it('refuse un début avec des minutes', () => {
      expect(slot('2026-11-04T14:30:00Z', '2026-11-04T16:30:00Z')).toThrow(InvalidSlot);
    });
    it('refuse une fin avec des minutes', () => {
      expect(slot('2026-11-04T14:00:00Z', '2026-11-04T16:15:00Z')).toThrow(InvalidSlot);
    });
    it('refuse des secondes ou millisecondes', () => {
      expect(slot('2026-11-04T14:00:01Z', '2026-11-04T16:00:00Z')).toThrow(InvalidSlot);
      expect(slot('2026-11-04T14:00:00.500Z', '2026-11-04T16:00:00Z')).toThrow(InvalidSlot);
    });
  });

  describe('plage 10 h – 23 h', () => {
    it('refuse un début à 9 h', () => {
      expect(slot('2026-11-04T09:00:00Z', '2026-11-04T11:00:00Z')).toThrow(InvalidSlot);
    });
    it('accepte un début à 10 h', () => {
      expect(slot('2026-11-04T10:00:00Z', '2026-11-04T12:00:00Z')).not.toThrow();
    });
    it('accepte une fin à 23 h', () => {
      expect(slot('2026-11-04T21:00:00Z', '2026-11-04T23:00:00Z')).not.toThrow();
    });
    it('refuse une fin à 24 h (minuit)', () => {
      expect(slot('2026-11-04T22:00:00Z', '2026-11-05T00:00:00Z')).toThrow(InvalidSlot);
    });
    it('refuse une fin à 23 h passée de plus d’une heure', () => {
      expect(slot('2026-11-04T21:00:00Z', '2026-11-05T00:00:00Z')).toThrow(InvalidSlot);
    });
    it('refuse un créneau de nuit', () => {
      expect(slot('2026-11-04T02:00:00Z', '2026-11-04T04:00:00Z')).toThrow(InvalidSlot);
    });
  });

  it('refuse une date invalide', () => {
    expect(() => validateSlot(new Date('pas une date'), at('2026-11-04T16:00:00Z'))).toThrow(InvalidSlot);
  });

  it('renvoie le créneau validé', () => {
    const start = at('2026-11-04T14:00:00Z');
    const end = at('2026-11-04T16:00:00Z');
    expect(validateSlot(start, end)).toEqual({ start, end });
  });
});
