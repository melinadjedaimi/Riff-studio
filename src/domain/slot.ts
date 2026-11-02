import { InvalidSlot } from './errors';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const MIN_DURATION_HOURS = 1;
export const MAX_DURATION_HOURS = 4;
export const OPENING_HOUR = 10;
export const CLOSING_HOUR = 23;

export interface Slot {
  start: Date;
  end: Date;
}

/**
 * Règle 1 : durée de 1 h à 4 h, début et fin à une heure pleine (UTC),
 * le créneau tient dans la plage 10 h – 23 h du même jour.
 */
export function validateSlot(start: Date, end: Date): Slot {
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new InvalidSlot('Dates invalides');
  }
  if (startMs % HOUR_MS !== 0 || endMs % HOUR_MS !== 0) {
    throw new InvalidSlot('Un créneau commence et se termine à une heure pleine');
  }
  const hours = (endMs - startMs) / HOUR_MS;
  if (hours < MIN_DURATION_HOURS || hours > MAX_DURATION_HOURS) {
    throw new InvalidSlot(`Un créneau dure de ${MIN_DURATION_HOURS} h à ${MAX_DURATION_HOURS} h`);
  }
  const startOfDay = startMs - (startMs % DAY_MS);
  const startHour = (startMs - startOfDay) / HOUR_MS;
  const endHour = (endMs - startOfDay) / HOUR_MS;
  if (startHour < OPENING_HOUR || endHour > CLOSING_HOUR) {
    throw new InvalidSlot(`Un créneau tient entre ${OPENING_HOUR} h et ${CLOSING_HOUR} h (UTC)`);
  }
  return { start, end };
}
