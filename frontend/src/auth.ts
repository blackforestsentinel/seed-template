import { createContext, useContext } from 'react';
import type { SeedAuth, SeedAuthConfig, SeedLocalAuthConfig } from '@blackforestsentinel/seed-web-auth';

/** Anmeldung, wenn das Feature sso aktiv ist, sonst null. */
export const AuthContext = createContext<SeedAuth | null>(null);

export function useAuth(): SeedAuth | null {
  return useContext(AuthContext);
}

/**
 * Richtet die Anmeldung ein, wenn config.json einen Auth-Teil enthält (Feature sso).
 * MSAL wird nur dann geladen und landet sonst nicht im Bundle. Im lokalen Modus
 * (auth.mode: "local") kennt die API den Entwicklungsnutzer, MSAL bleibt aus.
 */
export async function startAuth(config: SeedAuthConfig | SeedLocalAuthConfig | undefined): Promise<SeedAuth | null> {
  if (!config || 'mode' in config) {
    return null;
  }

  const { createSeedAuth } = await import('@blackforestsentinel/seed-web-auth');
  return createSeedAuth(config);
}
