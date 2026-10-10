import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SeedAuth } from '@blackforestsentinel/seed-web-auth';
import { SeedUserProvider, type SeedUser } from '@blackforestsentinel/seed-web-auth/react';
import { ApiContext, type ApiClient } from './api';
import { App } from './App';
import { AuthContext } from './auth';

const admin: SeedUser = {
  name: 'Lokale Entwicklung',
  username: 'dev@localhost',
  objectId: null,
  tenantId: null,
  roles: ['Admin'],
  capabilities: ['settings.manage'],
};

const api: ApiClient = {
  getHealth: async () => ({ status: 'ok', project: 'kundenportal', environment: 'dev', version: '1.0.0' }),
  getMe: async () => admin,
};

function renderApp(auth: SeedAuth | null = null, user: SeedUser | null = null) {
  render(
    <AuthContext.Provider value={auth}>
      <ApiContext.Provider value={api}>
        <SeedUserProvider user={user}>
          <QueryClientProvider client={new QueryClient()}>
            <MemoryRouter>
              <App />
            </MemoryRouter>
          </QueryClientProvider>
        </SeedUserProvider>
      </ApiContext.Provider>
    </AuthContext.Provider>,
  );
}

afterEach(cleanup);

describe('App', () => {
  it('zeigt den Status der API an', async () => {
    renderApp();

    expect(await screen.findByText('kundenportal')).toBeTruthy();
    expect(screen.queryByText('Abmelden')).toBeNull();
    expect(screen.queryByText('Du darfst die Einstellungen verwalten.')).toBeNull();
  });

  it('zeigt die angemeldete Person, wenn sso aktiv ist', async () => {
    renderApp({
      account: { name: 'Erika Muster', username: 'erika@example.org' },
      login: async () => {},
      logout: async () => {},
      getAccessToken: async () => 'token',
    } as SeedAuth);

    expect(await screen.findByText('Erika Muster')).toBeTruthy();
    expect(screen.getByText('Abmelden')).toBeTruthy();
  });

  it('blendet Elemente nach den Capabilities aus GET /api/me ein', async () => {
    renderApp(null, admin);

    expect(await screen.findByText('Du darfst die Einstellungen verwalten.')).toBeTruthy();
    expect(screen.getByText('Lokale Entwicklung')).toBeTruthy();
    expect(screen.queryByText('Abmelden')).toBeNull();
  });
});
