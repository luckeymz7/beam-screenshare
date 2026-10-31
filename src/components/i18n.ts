import { createContext, useContext } from 'react';
import { translator, type T } from '../lib/i18n';

/** The room's translator, so every component under RoomApp can use `useT()`. */
export const TContext = createContext<T>(translator('en'));
export const useT = () => useContext(TContext);
