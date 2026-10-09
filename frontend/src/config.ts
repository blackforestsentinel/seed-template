/**
 * Laufzeitkonfiguration aus /config.json. Die Pipeline schreibt die Datei beim Deploy
 * je Umgebung neu, deshalb reicht ein Build für alle Umgebungen.
 */
export interface RuntimeConfig {
  apiBaseUrl: string;
}

export async function loadRuntimeConfig(fetchFn: typeof fetch = fetch): Promise<RuntimeConfig> {
  const response = await fetchFn('/config.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`config.json konnte nicht geladen werden (HTTP ${response.status})`);
  }

  const config = (await response.json()) as Partial<RuntimeConfig>;
  if (!config.apiBaseUrl) {
    throw new Error('config.json enthält keine apiBaseUrl');
  }

  return { apiBaseUrl: config.apiBaseUrl.replace(/\/+$/, '') };
}
