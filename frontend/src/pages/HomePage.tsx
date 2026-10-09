import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api';

export function HomePage() {
  const api = useApi();
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.getHealth() });

  return (
    <section>
      <h1>Willkommen</h1>
      {health.isPending && <p>Prüfe die API …</p>}
      {health.isError && <p role="alert">API nicht erreichbar: {health.error.message}</p>}
      {health.isSuccess && (
        <p>
          API erreichbar: <strong>{health.data.project}</strong> ({health.data.environment}), Version{' '}
          {health.data.version}
        </p>
      )}
    </section>
  );
}
