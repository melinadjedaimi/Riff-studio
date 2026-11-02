import type { Pool, PoolClient } from 'pg';
import type { Booking, BookingStatus } from '../domain/booking';
import { SlotOverlap } from '../domain/errors';
import type { BookingRepository } from '../domain/ports';
import type { Slot } from '../domain/slot';

export type Queryable = Pick<Pool | PoolClient, 'query'>;

interface BookingRow {
  id: string;
  room_id: string;
  member_id: string;
  start_at: Date;
  end_at: Date;
  status: BookingStatus;
}

const COLUMNS = 'id, room_id, member_id, start_at, end_at, status';
const EXCLUSION_VIOLATION = '23P01';

function toBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    roomId: row.room_id,
    memberId: row.member_id,
    start: row.start_at,
    end: row.end_at,
    status: row.status,
  };
}

export class PgBookingRepository implements BookingRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: string): Promise<Booking | null> {
    const { rows } = await this.db.query<BookingRow>(`SELECT ${COLUMNS} FROM bookings WHERE id = $1`, [id]);
    return rows[0] ? toBooking(rows[0]) : null;
  }

  async findByIdForUpdate(id: string): Promise<Booking | null> {
    const { rows } = await this.db.query<BookingRow>(
      `SELECT ${COLUMNS} FROM bookings WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return rows[0] ? toBooking(rows[0]) : null;
  }

  async listByMember(memberId: string): Promise<Booking[]> {
    const { rows } = await this.db.query<BookingRow>(
      `SELECT ${COLUMNS} FROM bookings WHERE member_id = $1 ORDER BY start_at`,
      [memberId],
    );
    return rows.map(toBooking);
  }

  async listConfirmedInRange(roomId: string, from: Date, to: Date): Promise<Booking[]> {
    const { rows } = await this.db.query<BookingRow>(
      `SELECT ${COLUMNS} FROM bookings
        WHERE room_id = $1 AND status = 'confirmed' AND start_at < $3 AND end_at > $2
        ORDER BY start_at`,
      [roomId, from, to],
    );
    return rows.map(toBooking);
  }

  async findConfirmedOverlapping(roomId: string, slot: Slot): Promise<Booking[]> {
    return this.listConfirmedInRange(roomId, slot.start, slot.end);
  }

  async insert(booking: Booking): Promise<void> {
    try {
      await this.db.query(`INSERT INTO bookings (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6)`, [
        booking.id,
        booking.roomId,
        booking.memberId,
        booking.start,
        booking.end,
        booking.status,
      ]);
    } catch (err) {
      // Second rempart : la contrainte d'exclusion tranche les requêtes simultanées.
      if ((err as { code?: string }).code === EXCLUSION_VIOLATION) throw new SlotOverlap();
      throw err;
    }
  }

  async updateStatus(id: string, status: BookingStatus, at: Date): Promise<void> {
    await this.db.query('UPDATE bookings SET status = $2, cancelled_at = $3 WHERE id = $1', [id, status, at]);
  }
}
