import type { Clock } from './clock';
import { AlreadyCancelled, MemberLimitReached, SlotOverlap } from './errors';
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

/** Règle 2 : seules les réservations confirmées bloquent la salle. */
export function assertNoOverlap(slot: Slot, roomBookings: Booking[]): void {
  const clash = roomBookings.some((b) => b.status === 'confirmed' && overlaps(slot, b));
  if (clash) throw new SlotOverlap();
}

export const MAX_UPCOMING_BOOKINGS = 2;

/** À venir : confirmées et commençant après maintenant. */
export function countUpcoming(memberBookings: Booking[], clock: Clock): number {
  const now = clock.now();
  return memberBookings.filter((b) => b.status === 'confirmed' && b.start > now).length;
}

/** Règle 3 : 2 réservations à venir au plus. L'appelant doit verrouiller le membre. */
export function assertMemberUnderLimit(memberBookings: Booking[], clock: Clock): void {
  if (countUpcoming(memberBookings, clock) >= MAX_UPCOMING_BOOKINGS) {
    throw new MemberLimitReached(MAX_UPCOMING_BOOKINGS);
  }
}

export const LATE_CANCELLATION_HOURS = 24;

/** Règle 4 : late_cancelled si moins de 24 h avant le début, sinon cancelled. Pas de double annulation. */
export function cancellationStatus(booking: Booking, clock: Clock): 'cancelled' | 'late_cancelled' {
  if (booking.status !== 'confirmed') throw new AlreadyCancelled(booking.id);
  const msBeforeStart = booking.start.getTime() - clock.now().getTime();
  return msBeforeStart < LATE_CANCELLATION_HOURS * 3_600_000 ? 'late_cancelled' : 'cancelled';
}
