import { NavLink, Route, Routes } from 'react-router';
import { useSeedUser } from '@blackforestsentinel/seed-web-auth/react';
import { useAuth } from './auth';
import { HomePage } from './pages/HomePage';

export function App() {
  const auth = useAuth();
  const { user } = useSeedUser();
  // Lokal ohne MSAL kommt der Name von der API (Entwicklungsnutzer).
  const name = auth?.account ? (auth.account.name ?? auth.account.username) : (user?.name ?? user?.username);

  return (
    <div className="app">
      <header>
        <strong>Sentinel Seed</strong>
        <nav>
          <NavLink to="/">Start</NavLink>
        </nav>
        {name && (
          <span className="account">
            {name}
            {auth && (
              <button type="button" onClick={() => void auth.logout()}>
                Abmelden
              </button>
            )}
          </span>
        )}
      </header>
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="*" element={<p>Seite nicht gefunden.</p>} />
        </Routes>
      </main>
    </div>
  );
}
