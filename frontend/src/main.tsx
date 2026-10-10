import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { loadRuntimeConfig, type RuntimeConfig } from '@blackforestsentinel/seed-web-core';
import type { SeedAuthConfig } from '@blackforestsentinel/seed-web-auth';
import { ApiContext, createApiClient } from './api';
import { App } from './App';
import { AuthContext, startAuth } from './auth';
import './styles.css';

interface AppConfig extends RuntimeConfig {
  auth?: SeedAuthConfig;
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

  root.render(
    <StrictMode>
      <AuthContext.Provider value={auth}>
        <ApiContext.Provider value={createApiClient(config, auth?.getAccessToken)}>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </QueryClientProvider>
        </ApiContext.Provider>
      </AuthContext.Provider>
    </StrictMode>,
  );
}

start().catch((error: unknown) => {
  root.render(<p role="alert">Start fehlgeschlagen: {String(error)}</p>);
});
