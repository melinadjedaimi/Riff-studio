import { SlotOverlap } from './errors';
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
