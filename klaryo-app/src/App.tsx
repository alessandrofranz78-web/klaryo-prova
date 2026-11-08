import { useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './api';
import { AuthContext, useAuth } from './auth';
import { AssumptionsPage, InstallersPage, LeadsPage } from './pages/ListsPage';
import { DossierPage } from './pages/DossierPage';
import { LoginPage } from './pages/LoginPage';
import { WizardPage } from './pages/WizardPage';
import type { SessionUser } from './types';

export function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api<{ user: SessionUser }>('/api/me')
      .then((result) => setUser(result.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <p className="boot">Carico Klaryo…</p>;

  return (
    <AuthContext.Provider value={{ user, setUser }}>
      <BrowserRouter>
        <Routes>
          <Route path="/accesso" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<Shell />}>
              <Route path="/" element={<Home />} />
              <Route path="/analisi" element={<WizardPage />} />
              <Route path="/famiglie" element={<LeadsPage />} />
              <Route path="/famiglie/:leadId" element={<DossierPage />} />
              <Route path="/installatori" element={<InstallersPage />} />
              <Route path="/ipotesi" element={<AssumptionsPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}

function RequireAuth() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/accesso" replace />;
  return <Outlet />;
}

function Shell() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const links = [
    user.role === 'customer' ? ['/analisi', 'Nuova analisi'] : null,
    ['/famiglie', user.role === 'customer' ? 'Le mie pratiche' : 'Famiglie'],
    user.role !== 'customer' ? ['/installatori', 'Installatori'] : null,
    user.role === 'admin' ? ['/ipotesi', 'Ipotesi'] : null,
  ].filter((item): item is [string, string] => item != null);

  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          <div className="mark">K</div>
          <div>
            <strong>Klaryo</strong>
            <span>Analisi orientativa</span>
          </div>
        </NavLink>
        <nav className="side-nav">
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="who">
          <b>{user.name}</b>
          {labelRole(user.role)} · dato sintetico
          <button
            className="ghost"
            type="button"
            onClick={() => {
              api('/api/logout', { method: 'POST' }).finally(() => {
                setUser(null);
                navigate('/accesso');
              });
            }}
          >
            Esci
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="ribbon">
          Ambiente dimostrativo, solo su questo computer. Dati sintetici. Nessuna condivisione esterna. Non è un sistema di produzione e non è un preventivo tecnico.
        </div>
        <Outlet />
      </main>
    </div>
  );
}

function Home() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role === 'customer') return <Navigate to="/analisi" replace />;
  if (user.role === 'installer') return <Navigate to="/famiglie" replace />;
  return <Navigate to="/famiglie" replace />;
}

function labelRole(role: SessionUser['role']): string {
  if (role === 'admin') return 'Operatore';
  if (role === 'installer') return 'Installatore';
  return 'Famiglia';
}
