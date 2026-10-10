import { NavLink, Route, Routes } from 'react-router';
import { useAuth } from './auth';
import { HomePage } from './pages/HomePage';

export function App() {
  const auth = useAuth();

  return (
    <div className="app">
      <header>
        <strong>Sentinel Seed</strong>
        <nav>
          <NavLink to="/">Start</NavLink>
        </nav>
        {auth?.account && (
          <span className="account">
            {auth.account.name ?? auth.account.username}
            <button type="button" onClick={() => void auth.logout()}>
              Abmelden
            </button>
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
