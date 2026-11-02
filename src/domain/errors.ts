/** Erreurs métier. Elles sont traduites en codes HTTP dans src/http. */
export abstract class DomainError extends Error {
  abstract readonly code: string;
}

export class InvalidSlot extends DomainError {
  readonly code = 'invalid_slot';
}

export class RoomNotFound extends DomainError {
  readonly code = 'room_not_found';
  constructor(id: string) {
    super(`Salle introuvable : ${id}`);
  }
}

export class MemberNotFound extends DomainError {
  readonly code = 'member_not_found';
  constructor(id: string) {
    super(`Membre introuvable : ${id}`);
  }
}

export class BookingNotFound extends DomainError {
  readonly code = 'booking_not_found';
  constructor(id: string) {
    super(`Réservation introuvable : ${id}`);
  }
}

export class SlotOverlap extends DomainError {
  readonly code = 'slot_overlap';
  constructor() {
    super('Ce créneau chevauche une réservation existante de la salle');
  }
}

export class MemberLimitReached extends DomainError {
  readonly code = 'member_limit_reached';
  constructor(limit: number) {
    super(`Un membre ne peut avoir plus de ${limit} réservations à venir`);
  }
}

export class RoomUnderMaintenance extends DomainError {
  readonly code = 'room_under_maintenance';
  constructor() {
    super('La salle est en maintenance sur cette période');
  }
}

export class AlreadyCancelled extends DomainError {
  readonly code = 'already_cancelled';
  constructor(id: string) {
    super(`La réservation ${id} est déjà annulée`);
  }
}
