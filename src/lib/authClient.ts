import { createAuthClient } from 'better-auth/client';

// Browser side of better-auth: same origin, so no base URL needed
export const authClient = createAuthClient();

export const login = (provider: 'google' | 'discord') =>
  authClient.signIn.social({ provider, callbackURL: location.pathname + location.search });

export const logout = () => authClient.signOut().then(() => location.reload());
