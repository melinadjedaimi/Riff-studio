import type { Booking } from '../domain/booking';
import type { PlanningCache } from '../domain/ports';

/** Cache désactivé : chaque lecture va à PostgreSQL. */
export class NoPlanningCache implements PlanningCache {
  remember(_roomId: string, _from: Date, _to: Date, load: () => Promise<Booking[]>): Promise<Booking[]> {
    return load();
  }

  async invalidateRoom(): Promise<void> {}
}
