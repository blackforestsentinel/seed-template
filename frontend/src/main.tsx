import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiContext, createApiClient } from './api';
import { App } from './App';
import { loadRuntimeConfig } from './config';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

loadRuntimeConfig()
  .then((config) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
    });

    root.render(
      <StrictMode>
        <ApiContext.Provider value={createApiClient(config)}>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </QueryClientProvider>
        </ApiContext.Provider>
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    root.render(<p role="alert">Start fehlgeschlagen: {String(error)}</p>);
  });
