import { NavLink, Route, Routes } from 'react-router';
import { useSeedUser } from '@blackforestsentinel/seed-web-auth/react';
import { AccessDenied, CurrentUserMenu } from '@blackforestsentinel/seed-web-people';
import { HomePage } from './pages/HomePage';
import { PeoplePage } from './pages/PeoplePage';

/** Name der App in Kopfzeile und Anmeldeseite. */
export const appName = 'Sentinel Seed';

export function App() {
  const { status, user } = useSeedUser();
  // Angemeldet, aber ohne Rolle mit Capabilities (auth.roles in project.yaml): statt der Inhalte
  // eine Erklärung, wen man fragen muss. Die API prüft jeden Aufruf trotzdem selbst.
  const denied = status === 'ready' && user !== null && user.capabilities.length === 0;

  return (
    <div className="app">
      <header>
        <strong>{appName}</strong>
        <nav>
          <NavLink to="/">Start</NavLink>
          <NavLink to="/personen">Personen</NavLink>
        </nav>
        {/* Avatar, Name, Rolle und Abmelden; ohne sso nichts. */}
        <CurrentUserMenu className="account" />
      </header>
      <main>
        {denied ? (
          <AccessDenied appName={appName} />
        ) : (
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/personen" element={<PeoplePage />} />
            <Route path="*" element={<p>Seite nicht gefunden.</p>} />
          </Routes>
        )}
      </main>
    </div>
  );
}
