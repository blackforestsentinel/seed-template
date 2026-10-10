import { createContext, useContext } from 'react';
import type { SeedAuth, SeedAuthConfig } from '@blackforestsentinel/seed-web-auth';

/** Anmeldung, wenn das Feature sso aktiv ist, sonst null. */
export const AuthContext = createContext<SeedAuth | null>(null);

export function useAuth(): SeedAuth | null {
  return useContext(AuthContext);
}

/**
 * Richtet die Anmeldung ein, wenn config.json einen Auth-Teil enthält (Feature sso).
 * MSAL wird nur dann geladen und landet sonst nicht im Bundle.
 */
export async function startAuth(config: SeedAuthConfig | undefined): Promise<SeedAuth | null> {
  if (!config) {
    return null;
  }

  const { createSeedAuth } = await import('@blackforestsentinel/seed-web-auth');
  // Muss zu den Redirect-URIs des Terraform-Moduls sso passen (mit abschließendem Schrägstrich).
  return createSeedAuth(config, { redirectUri: `${window.location.origin}/` });
}
