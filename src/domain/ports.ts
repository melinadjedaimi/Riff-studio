import type { Booking, BookingStatus } from './booking';
import type { Member, Room } from './room';
import type { Slot } from './slot';

/** Ports : le domaine décrit ce dont il a besoin, l'infrastructure l'implémente. */

export interface RoomRepository {
  list(): Promise<Room[]>;
  findById(id: string): Promise<Room | null>;
}

export interface MemberRepository {
  findById(id: string): Promise<Member | null>;
  /** Verrouille la ligne du membre jusqu'à la fin de la transaction en cours. */
  findByIdForUpdate(id: string): Promise<Member | null>;
}

export interface BookingRepository {
  findById(id: string): Promise<Booking | null>;
  /** Verrouille la réservation jusqu'à la fin de la transaction en cours. */
  findByIdForUpdate(id: string): Promise<Booking | null>;
  listByMember(memberId: string): Promise<Booking[]>;
  /** Réservations confirmées dont [start, end) rencontre [from, to), triées par début. */
  listConfirmedInRange(roomId: string, from: Date, to: Date): Promise<Booking[]>;
  /** Réservations confirmées de la salle qui chevauchent le créneau. */
  findConfirmedOverlapping(roomId: string, slot: Slot): Promise<Booking[]>;
  /** Lève SlotOverlap si la base refuse l'insertion (contrainte d'exclusion). */
  insert(booking: Booking): Promise<void>;
  updateStatus(id: string, status: BookingStatus, at: Date): Promise<void>;
}

export interface Repositories {
  rooms: RoomRepository;
  members: MemberRepository;
  bookings: BookingRepository;
}

export interface UnitOfWork {
  /** Exécute fn dans une transaction : validée si fn réussit, annulée si elle lève. */
  run<T>(fn: (repos: Repositories) => Promise<T>): Promise<T>;
}
