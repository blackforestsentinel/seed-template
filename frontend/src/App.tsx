import { NavLink, Route, Routes } from 'react-router';
import { HomePage } from './pages/HomePage';

export function App() {
  return (
    <div className="app">
      <header>
        <strong>Sentinel Seed</strong>
        <nav>
          <NavLink to="/">Start</NavLink>
        </nav>
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
