import { assertMemberUnderLimit, assertNoOverlap, type Booking } from '../domain/booking';
import type { Clock } from '../domain/clock';
import { MemberNotFound, RoomNotFound } from '../domain/errors';
import type { Repositories, UnitOfWork } from '../domain/ports';
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
}
