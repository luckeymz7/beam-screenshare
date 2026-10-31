import { publicRooms, type RoomInfo } from './livekit';
import { thumbTimes } from './thumbs';

export type RoomCard = RoomInfo & { thumbAt: number | null };

/** Public rooms with when their preview was last refreshed (null: never shared yet). */
export async function listRooms(): Promise<RoomCard[]> {
  const rooms = await publicRooms();
  const times = await thumbTimes(rooms.map((r) => r.id)).catch(() => new Map<string, number>());
  return rooms.map((r) => ({ ...r, thumbAt: times.get(r.id) ?? null }));
}
