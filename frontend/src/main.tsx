import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { loadRuntimeConfig, type RuntimeConfig } from '@blackforestsentinel/seed-web-core';
import type { SeedAuthConfig, SeedLocalAuthConfig } from '@blackforestsentinel/seed-web-auth';
import { SeedUserProvider } from '@blackforestsentinel/seed-web-auth/react';
import { ApiContext, createApiClient } from './api';
import { App } from './App';
import { AuthContext, startAuth } from './auth';
import './styles.css';

interface AppConfig extends RuntimeConfig {
  auth?: SeedAuthConfig | SeedLocalAuthConfig;
}

const root = createRoot(document.getElementById('root')!);

async function start() {
  const config = await loadRuntimeConfig<AppConfig>();

  const auth = await startAuth(config.auth);
  if (auth && !auth.account) {
    // Leitet zu Entra ID um; nach der Anmeldung startet die Seite neu.
    await auth.login();
    return;
  }

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  });
  const api = createApiClient(config, auth?.getAccessToken);

  // Mit Anmeldung (oder lokal) liefert die API Rollen und Capabilities der Person; das UI blendet
  // damit Elemente ein oder aus. Ohne sso gibt es keine Person.
  root.render(
    <StrictMode>
      <AuthContext.Provider value={auth}>
        <ApiContext.Provider value={api}>
          <SeedUserProvider load={config.auth ? api.getMe : undefined}>
            <QueryClientProvider client={queryClient}>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </QueryClientProvider>
          </SeedUserProvider>
        </ApiContext.Provider>
      </AuthContext.Provider>
    </StrictMode>,
  );
}

start().catch((error: unknown) => {
  root.render(<p role="alert">Start fehlgeschlagen: {String(error)}</p>);
});
