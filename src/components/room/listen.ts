import { useSyncExternalStore } from 'react';
import type { Participant } from 'livekit-client';
import { metaOf } from './meta';

/**
 * What you hear, like Discord: deafen (nothing at all), and a mute or volume per person. Only in
 * your browser, nobody else is affected. People with an account are remembered across rooms;
 * guests only for this visit, since their identity is new each time.
 */
type UserPref = { muted?: boolean; volume?: number };
type Listen = { deafened: boolean; users: Record<string, UserPref> };

const KEY = 'beam:listen';
const subscribers = new Set<() => void>();

function load(): Listen {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { users?: unknown } | null;
    const users: Record<string, UserPref> = {};
    if (saved?.users && typeof saved.users === 'object') {
      for (const [k, v] of Object.entries(saved.users as Record<string, UserPref>)) {
        if (!k.startsWith('u:') || !v || typeof v !== 'object') continue;
        users[k] = {
          muted: v.muted === true || undefined,
          volume: typeof v.volume === 'number' ? Math.min(1, Math.max(0, v.volume)) : undefined,
        };
      }
    }
    return { deafened: false, users };
  } catch {
    return { deafened: false, users: {} };
  }
}

let state: Listen | null = null;
const current = () => (state ??= load());

function update(next: Listen) {
  state = next;
  try {
    const keep = Object.fromEntries(Object.entries(next.users).filter(([k]) => k.startsWith('u:')));
    localStorage.setItem(KEY, JSON.stringify({ users: keep }));
  } catch {}
  subscribers.forEach((fn) => fn());
}

const subscribe = (fn: () => void) => {
  subscribers.add(fn);
  return () => void subscribers.delete(fn);
};

export const useListen = () => useSyncExternalStore(subscribe, current, current);

export const setDeafened = (deafened: boolean) => current().deafened !== deafened && update({ ...current(), deafened });

/** The account when there is one (the same person in every room), the room identity otherwise. */
export const listenKey = (p: Participant) => {
  const uid = metaOf(p).uid;
  return uid ? `u:${uid}` : `p:${p.identity}`;
};

export function setUserPref(key: string, change: UserPref) {
  const users = { ...current().users };
  const next = { ...users[key], ...change };
  // Back to normal: forget them
  if (!next.muted && (next.volume ?? 1) === 1) delete users[key];
  else users[key] = next;
  update({ ...current(), users });
}

export const userPref = (listen: Listen, key: string): Required<UserPref> => ({
  muted: !!listen.users[key]?.muted,
  volume: listen.users[key]?.volume ?? 1,
});

/** How loud someone's voice plays for you. */
export function voiceGain(listen: Listen, key: string) {
  if (listen.deafened) return 0;
  const pref = userPref(listen, key);
  return pref.muted ? 0 : pref.volume;
}
