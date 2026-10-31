import { createHash } from 'node:crypto';
import { client, ensureDb } from './db';

const db = () => ensureDb().then(() => client);

export async function saveThumb(room: string, mime: string, data: ArrayBuffer) {
  const c = await db();
  await c.batch(
    [
      {
        sql: 'insert into thumbs (room, mime, data, updated_at) values (?, ?, ?, ?) on conflict(room) do update set mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at',
        args: [room, mime, data, Date.now()],
      },
      // Rooms close on their own; drop previews nobody has refreshed for a day
      { sql: 'delete from thumbs where updated_at < ?', args: [Date.now() - 86_400_000] },
    ],
    'write',
  );
}

export async function getThumb(room: string) {
  const { rows } = await (await db()).execute({ sql: 'select mime, data, updated_at from thumbs where room = ?', args: [room] });
  const row = rows[0];
  return row ? { mime: String(row.mime), data: row.data as ArrayBuffer, updatedAt: Number(row.updated_at) } : null;
}

/** When each room's preview was last refreshed. */
export async function thumbTimes(rooms: string[]) {
  if (rooms.length === 0) return new Map<string, number>();
  const { rows } = await (await db()).execute({
    sql: `select room, updated_at from thumbs where room in (${rooms.map(() => '?').join(', ')})`,
    args: rooms,
  });
  return new Map(rows.map((r) => [String(r.room), Number(r.updated_at)]));
}

const CREATE_LIMIT = 5;
const CREATE_WINDOW = 10 * 60_000;

/**
 * At most a few new rooms per address every ten minutes, so nobody can fill the media server
 * with empty rooms. Only a hash of the address is kept, and only for the window. If the
 * database is down, creating a room still works.
 */
export async function allowCreate(address: string) {
  try {
    const c = await db();
    const who = createHash('sha256').update(address).digest('hex').slice(0, 32);
    const now = Date.now();
    const { rows } = await c.execute({
      sql: 'select count(*) as n from creations where who = ? and at > ?',
      args: [who, now - CREATE_WINDOW],
    });
    if (Number(rows[0]?.n ?? 0) >= CREATE_LIMIT) return false;
    await c.batch(
      [
        { sql: 'insert into creations (who, at) values (?, ?)', args: [who, now] },
        { sql: 'delete from creations where at < ?', args: [now - CREATE_WINDOW] },
      ],
      'write',
    );
    return true;
  } catch (e) {
    console.error('Rate limit:', (e as Error).message);
    return true;
  }
}
