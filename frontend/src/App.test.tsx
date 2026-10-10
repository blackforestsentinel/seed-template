import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiContext, type ApiClient } from './api';
import { App } from './App';

describe('App', () => {
  it('zeigt den Status der API an', async () => {
    const api: ApiClient = {
      getHealth: async () => ({ status: 'ok', project: 'kundenportal', environment: 'dev', version: '1.0.0' }),
    };

    render(
      <ApiContext.Provider value={api}>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <App />
          </MemoryRouter>
        </QueryClientProvider>
      </ApiContext.Provider>,
    );

    expect(await screen.findByText('kundenportal')).toBeTruthy();
  });
});
