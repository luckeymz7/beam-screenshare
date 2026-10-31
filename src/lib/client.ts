// Small browser-side helpers shared by the islands

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

export const savedName = () => read('beam:name') ?? '';
export const saveName = (name: string) => write('beam:name', name);

/** The creator keeps the room's host key in this browser; it's what makes them the host. */
export const hostKeyFor = (room: string) => read(`beam:host:${room}`);
export const saveHostKey = (room: string, key: string) => write(`beam:host:${room}`, key);

export function since(ts: number, now = Date.now()) {
  const m = Math.max(0, Math.floor((now - ts) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}
