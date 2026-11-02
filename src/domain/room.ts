import { RoomUnderMaintenance } from './errors';
import { overlaps, type Slot } from './slot';

export interface Room {
  id: string;
  name: string;
  capacity: number;
  /** Période pendant laquelle la salle refuse toute réservation. */
  maintenance: Slot | null;
}

export interface Member {
  id: string;
  name: string;
}

/**
 * Règle 5 : une salle en maintenance refuse tout créneau qui empiète sur la période.
 * Intervalles semi-ouverts : finir à l'instant où la maintenance commence, ou commencer
 * à l'instant où elle se termine, n'empiète pas.
 */
export function assertOutsideMaintenance(slot: Slot, room: Room): void {
  if (room.maintenance && overlaps(slot, room.maintenance)) throw new RoomUnderMaintenance();
}
