import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SeedAuth } from '@blackforestsentinel/seed-web-auth';
import { ApiContext, type ApiClient } from './api';
import { App } from './App';
import { AuthContext } from './auth';

const api: ApiClient = {
  getHealth: async () => ({ status: 'ok', project: 'kundenportal', environment: 'dev', version: '1.0.0' }),
};

function renderApp(auth: SeedAuth | null = null) {
  render(
    <AuthContext.Provider value={auth}>
      <ApiContext.Provider value={api}>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <App />
          </MemoryRouter>
        </QueryClientProvider>
      </ApiContext.Provider>
    </AuthContext.Provider>,
  );
}

describe('App', () => {
  it('zeigt den Status der API an', async () => {
    renderApp();

    expect(await screen.findByText('kundenportal')).toBeTruthy();
    expect(screen.queryByText('Abmelden')).toBeNull();
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
});
