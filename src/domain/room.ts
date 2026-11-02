import { RoomUnderMaintenance } from './errors';
import { overlaps, type Slot } from './slot';

export interface Room {
  id: string;
  name: string;
  capacity: number;
  /** Période de maintenance. */
  maintenance: Slot | null;
}

export interface Member {
  id: string;
  name: string;
}

/** Règle 5 : refuse un créneau qui empiète sur la maintenance (bornes [début, fin)). */
export function assertOutsideMaintenance(slot: Slot, room: Room): void {
  if (room.maintenance && overlaps(slot, room.maintenance)) throw new RoomUnderMaintenance();
}
