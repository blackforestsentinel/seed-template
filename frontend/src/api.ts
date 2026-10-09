import { createContext, useContext } from 'react';
import type { RuntimeConfig } from './config';

export interface HealthReport {
  status: string;
  project: string;
  environment: string;
  version: string;
}

export interface ApiClient {
  getHealth(): Promise<HealthReport>;
}

export function createApiClient(config: RuntimeConfig, fetchFn: typeof fetch = fetch): ApiClient {
  async function get<T>(path: string): Promise<T> {
    const response = await fetchFn(`${config.apiBaseUrl}${path}`);
    if (!response.ok) {
      throw new Error(`GET ${path} fehlgeschlagen (HTTP ${response.status})`);
    }
    return (await response.json()) as T;
  }

  return {
    getHealth: () => get<HealthReport>('/api/health'),
  };
}

export const ApiContext = createContext<ApiClient | null>(null);

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) {
    throw new Error('useApi() braucht einen ApiContext.Provider');
  }
  return api;
}
