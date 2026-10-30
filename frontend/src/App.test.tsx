import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SeedAuth, SeedAuthConfig, SeedLocalAuthConfig } from '@blackforestsentinel/seed-web-auth';
import { SeedUserProvider, type SeedUser } from '@blackforestsentinel/seed-web-auth/react';
import { DirectoryProvider } from '@blackforestsentinel/seed-web-people';
import { ApiContext, type ApiClient } from './api';
import { App } from './App';
import { AuthContext } from './auth';

const admin: SeedUser = {
  name: 'Lokale Entwicklung',
  username: 'dev@localhost',
  objectId: null,
  tenantId: null,
  roles: ['Admin'],
  roleDetails: [{ value: 'Admin', displayName: 'Administrator' }],
  capabilities: ['settings.manage'],
};

const api: ApiClient = {
  getHealth: async () => ({ status: 'ok', project: 'kundenportal', environment: 'dev', version: '1.0.0' }),
  getMe: async () => admin,
};

const localConfig: SeedLocalAuthConfig = {
  mode: 'local',
  directory: {
    people: [
      { id: 'p1', displayName: 'Erika Mustermann', department: 'Buchhaltung' },
      { id: 'p2', displayName: 'Max Mustermann', department: 'IT' },
      { id: 'a1', displayName: 'Nachtlauf', kind: 'servicePrincipal', servicePrincipalType: 'ManagedIdentity' },
    ],
  },
};

interface Options {
  auth?: SeedAuth | null;
  user?: SeedUser | null;
  config?: SeedAuthConfig | SeedLocalAuthConfig;
  path?: string;
}

function renderApp({ auth = null, user = null, config, path = '/' }: Options = {}) {
  render(
    <AuthContext.Provider value={auth}>
      <ApiContext.Provider value={api}>
        <SeedUserProvider user={user}>
          <DirectoryProvider config={config} auth={auth}>
            <QueryClientProvider client={new QueryClient()}>
              <MemoryRouter initialEntries={[path]}>
                <App />
              </MemoryRouter>
            </QueryClientProvider>
          </DirectoryProvider>
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
    expect(screen.queryByRole('button', { name: 'Abmelden' })).toBeNull();
    expect(screen.queryByText('Du darfst die Einstellungen verwalten.')).toBeNull();
  });

  it('zeigt die angemeldete Person im Benutzermenü, wenn sso aktiv ist', async () => {
    renderApp({
      auth: {
        account: { name: 'Erika Mustermann', username: 'erika@example.org' },
        login: async () => {},
        logout: async () => {},
        getAccessToken: async () => 'token',
      } as SeedAuth,
      config: { clientId: 'spa-id', tenantId: 'tenant-id', apiScope: 'api://api-id/access_as_user' },
    });

    expect(await screen.findByText('Erika Mustermann')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abmelden' })).toBeTruthy();
  });

  it('blendet Elemente nach den Capabilities aus GET /api/me ein und zeigt die Rolle', async () => {
    renderApp({ user: admin, config: localConfig });

    expect(await screen.findByText('Du darfst die Einstellungen verwalten.')).toBeTruthy();
    expect(screen.getByText('Lokale Entwicklung')).toBeTruthy();
    expect(screen.getByText('Administrator')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Abmelden' })).toBeNull();
  });

  it('erklärt angemeldeten Personen ohne Rolle, warum sie nichts sehen', async () => {
    renderApp({ user: { ...admin, roles: [], roleDetails: [], capabilities: [] }, config: localConfig });

    expect(screen.getByRole('heading', { name: 'Kein Zugriff' })).toBeTruthy();
    expect(screen.getByText(/hast in „Sentinel Seed“ aber noch keine Rolle/)).toBeTruthy();
    expect(screen.queryByText('Willkommen')).toBeNull();
  });

  it('sucht auf der Seite Personen in den Personen und Anwendungen aus config.json', async () => {
    renderApp({ user: admin, config: localConfig, path: '/personen' });
    const picker = screen.getByRole('combobox', { name: 'Personen oder Anwendungen auswählen' });

    fireEvent.change(picker, { target: { value: 'max' } });
    fireEvent.click(await screen.findByRole('option', { name: /Max Mustermann/ }));
    expect(screen.getByRole('button', { name: 'Max Mustermann entfernen' })).toBeTruthy();
    expect(screen.getByText('IT')).toBeTruthy();

    fireEvent.change(picker, { target: { value: 'nacht' } });
    fireEvent.click(await screen.findByRole('option', { name: /Nachtlauf/ }));
    expect(screen.getByRole('button', { name: 'Nachtlauf entfernen' })).toBeTruthy();
    expect(screen.getByText('Verwaltete Identität')).toBeTruthy();
  });
});
