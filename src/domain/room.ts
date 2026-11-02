import type { Slot } from './slot';

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
