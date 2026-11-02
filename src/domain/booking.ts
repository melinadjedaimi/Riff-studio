import type { Clock } from './clock';
import { MemberLimitReached, SlotOverlap } from './errors';
import { overlaps, type Slot } from './slot';

export type BookingStatus = 'confirmed' | 'cancelled' | 'late_cancelled';

export interface Booking {
  id: string;
  roomId: string;
  memberId: string;
  start: Date;
  end: Date;
  status: BookingStatus;
}

/** Règle 2 (premier rempart) : seules les réservations confirmées bloquent la salle. */
export function assertNoOverlap(slot: Slot, roomBookings: Booking[]): void {
  const clash = roomBookings.some((b) => b.status === 'confirmed' && overlaps(slot, b));
  if (clash) throw new SlotOverlap();
}

export const MAX_UPCOMING_BOOKINGS = 2;

/** Réservations à venir : confirmées, et qui commencent après l'instant de l'horloge. */
export function countUpcoming(memberBookings: Booking[], clock: Clock): number {
  const now = clock.now();
  return memberBookings.filter((b) => b.status === 'confirmed' && b.start > now).length;
}

/**
 * Règle 3 : au plus 2 réservations à venir par membre.
 * Porte sur plusieurs réservations : l'appelant doit sérialiser les créations d'un même membre
 * (verrou de ligne sur le membre), sinon deux requêtes simultanées passent toutes les deux.
 */
export function assertMemberUnderLimit(memberBookings: Booking[], clock: Clock): void {
  if (countUpcoming(memberBookings, clock) >= MAX_UPCOMING_BOOKINGS) {
    throw new MemberLimitReached(MAX_UPCOMING_BOOKINGS);
  }
}
