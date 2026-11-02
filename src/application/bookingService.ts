import { assertMemberUnderLimit, assertNoOverlap, cancellationStatus, type Booking } from '../domain/booking';
import type { Clock } from '../domain/clock';
import { BookingNotFound, MemberNotFound, RoomNotFound } from '../domain/errors';
import type { Repositories, UnitOfWork } from '../domain/ports';
import { assertOutsideMaintenance, type Room } from '../domain/room';
import { validateSlot } from '../domain/slot';

export interface CreateBookingInput {
  roomId: string;
  memberId: string;
  start: Date;
  end: Date;
}

export interface BookingServiceDeps {
  uow: UnitOfWork;
  /** Accès en lecture, hors transaction. */
  reads: Repositories;
  clock: Clock;
  newId: () => string;
}

/** Cas d'usage : orchestre les règles du domaine, ne contient aucune règle lui-même. */
export class BookingService {
  constructor(private readonly deps: BookingServiceDeps) {}

  async createBooking(input: CreateBookingInput): Promise<Booking> {
    const { uow, clock, newId } = this.deps;
    const slot = validateSlot(input.start, input.end);

    return uow.run(async ({ rooms, members, bookings }) => {
      const room = await rooms.findById(input.roomId);
      if (!room) throw new RoomNotFound(input.roomId);

      assertOutsideMaintenance(slot, room);

      // Verrou sur le membre : sérialise ses créations simultanées, sinon la limite de 2
      // se lit « 1 à venir » dans deux transactions à la fois.
      const member = await members.findByIdForUpdate(input.memberId);
      if (!member) throw new MemberNotFound(input.memberId);

      assertMemberUnderLimit(await bookings.listByMember(member.id), clock);
      assertNoOverlap(slot, await bookings.findConfirmedOverlapping(room.id, slot));

      const booking: Booking = {
        id: newId(),
        roomId: room.id,
        memberId: member.id,
        start: slot.start,
        end: slot.end,
        status: 'confirmed',
      };
      await bookings.insert(booking);
      return booking;
    });
  }

  async cancelBooking(id: string): Promise<Booking> {
    const { uow, clock } = this.deps;

    return uow.run(async ({ bookings }) => {
      // Verrou de ligne : deux annulations simultanées de la même réservation sont sérialisées.
      const booking = await bookings.findByIdForUpdate(id);
      if (!booking) throw new BookingNotFound(id);

      const status = cancellationStatus(booking, clock);
      await bookings.updateStatus(id, status, clock.now());
      return { ...booking, status };
    });
  }

  listRooms(): Promise<Room[]> {
    return this.deps.reads.rooms.list();
  }

  async getBooking(id: string): Promise<Booking> {
    const booking = await this.deps.reads.bookings.findById(id);
    if (!booking) throw new BookingNotFound(id);
    return booking;
  }

  async listMemberBookings(memberId: string): Promise<Booking[]> {
    const { members, bookings } = this.deps.reads;
    if (!(await members.findById(memberId))) throw new MemberNotFound(memberId);
    return bookings.listByMember(memberId);
  }

  /** Planning d'une salle : réservations confirmées qui rencontrent [from, to), triées par début. */
  async getRoomPlanning(roomId: string, from: Date, to: Date): Promise<Booking[]> {
    const { rooms, bookings } = this.deps.reads;
    if (!(await rooms.findById(roomId))) throw new RoomNotFound(roomId);
    return bookings.listConfirmedInRange(roomId, from, to);
  }
}
