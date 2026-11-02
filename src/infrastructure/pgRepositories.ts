import type { Pool } from 'pg';
import type { Repositories, RoomRepository, MemberRepository, UnitOfWork } from '../domain/ports';
import type { Member, Room } from '../domain/room';
import { PgBookingRepository, type Queryable } from './pgBookingRepository';

interface RoomRow {
  id: string;
  name: string;
  capacity: number;
  maintenance_start: Date | null;
  maintenance_end: Date | null;
}

function toRoom(row: RoomRow): Room {
  return {
    id: row.id,
    name: row.name,
    capacity: row.capacity,
    maintenance:
      row.maintenance_start && row.maintenance_end
        ? { start: row.maintenance_start, end: row.maintenance_end }
        : null,
  };
}

const ROOM_COLUMNS = 'id, name, capacity, maintenance_start, maintenance_end';

class PgRoomRepository implements RoomRepository {
  constructor(private readonly db: Queryable) {}

  async list(): Promise<Room[]> {
    const { rows } = await this.db.query<RoomRow>(`SELECT ${ROOM_COLUMNS} FROM rooms ORDER BY id`);
    return rows.map(toRoom);
  }

  async findById(id: string): Promise<Room | null> {
    const { rows } = await this.db.query<RoomRow>(`SELECT ${ROOM_COLUMNS} FROM rooms WHERE id = $1`, [id]);
    return rows[0] ? toRoom(rows[0]) : null;
  }
}

class PgMemberRepository implements MemberRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: string): Promise<Member | null> {
    const { rows } = await this.db.query<Member>('SELECT id, name FROM members WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  async findByIdForUpdate(id: string): Promise<Member | null> {
    const { rows } = await this.db.query<Member>('SELECT id, name FROM members WHERE id = $1 FOR UPDATE', [id]);
    return rows[0] ?? null;
  }
}

export function createRepositories(db: Queryable): Repositories {
  return {
    rooms: new PgRoomRepository(db),
    members: new PgMemberRepository(db),
    bookings: new PgBookingRepository(db),
  };
}

export class PgUnitOfWork implements UnitOfWork {
  constructor(private readonly pool: Pool) {}

  async run<T>(fn: (repos: Repositories) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(createRepositories(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
