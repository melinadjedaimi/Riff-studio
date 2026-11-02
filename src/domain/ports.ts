import type { Booking, BookingStatus } from './booking';
import type { Member, Room } from './room';

/** Ports : décrits par le domaine, implémentés par l'infrastructure. */

export interface RoomRepository {
  list(): Promise<Room[]>;
  findById(id: string): Promise<Room | null>;
}

export interface MemberRepository {
  findById(id: string): Promise<Member | null>;
  /** Verrouille la ligne jusqu'à la fin de la transaction. */
  findByIdForUpdate(id: string): Promise<Member | null>;
}

export interface BookingRepository {
  findById(id: string): Promise<Booking | null>;
  /** Verrouille la ligne jusqu'à la fin de la transaction. */
  findByIdForUpdate(id: string): Promise<Booking | null>;
  listByMember(memberId: string): Promise<Booking[]>;
  /** Confirmées dans [from, to), triées par début. */
  listConfirmedInRange(roomId: string, from: Date, to: Date): Promise<Booking[]>;
  /** Lève SlotOverlap si la contrainte d'exclusion refuse. */
  insert(booking: Booking): Promise<void>;
  updateStatus(id: string, status: BookingStatus, at: Date): Promise<void>;
}

export interface Repositories {
  rooms: RoomRepository;
  members: MemberRepository;
  bookings: BookingRepository;
}

export interface UnitOfWork {
  /** Transaction : COMMIT si fn réussit, ROLLBACK sinon. */
  run<T>(fn: (repos: Repositories) => Promise<T>): Promise<T>;
}

export interface PlanningCache {
  /** Planning en cache, sinon chargé avec `load`. Ne lève jamais à cause du cache. */
  remember(roomId: string, from: Date, to: Date, load: () => Promise<Booking[]>): Promise<Booking[]>;
  /** À appeler après un COMMIT qui change le planning. */
  invalidateRoom(roomId: string): Promise<void>;
}
