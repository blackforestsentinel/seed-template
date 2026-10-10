import { createContext, useContext } from 'react';
import { createHttpClient, type RuntimeConfig } from '@blackforestsentinel/seed-web-core';

export interface HealthReport {
  status: string;
  project: string;
  environment: string;
  version: string;
}

export interface ApiClient {
  getHealth(): Promise<HealthReport>;
}

/** getAccessToken kommt aus der Anmeldung (Feature sso) und hängt ein Bearer-Token an. */
export function createApiClient(config: RuntimeConfig, getAccessToken?: () => Promise<string>): ApiClient {
  const http = createHttpClient({ baseUrl: config.apiBaseUrl, getAccessToken });

  return {
    getHealth: () => http.get<HealthReport>('/api/health'),
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
