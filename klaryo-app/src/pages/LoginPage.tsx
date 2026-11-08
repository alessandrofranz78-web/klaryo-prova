import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import type { SessionUser } from '../types';

const ACCOUNTS = [
  { role: 'Famiglia', name: 'Famiglia Bianchi (sintetica)', email: 'famiglia.bianchi@klaryo.test' },
  { role: 'Famiglia', name: 'Famiglia Verdi (sintetica)', email: 'famiglia.verdi@klaryo.test' },
  { role: 'Operatore', name: 'Alessandro Demo (sintetico)', email: 'alessandro.demo@klaryo.test' },
  { role: 'Installatore', name: 'Nord Demo Impianti Srl', email: 'nord.demo@klaryo.test' },
  { role: 'Installatore', name: 'Centro Demo Energia Srl', email: 'centro.demo@klaryo.test' },
];

export function LoginPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function enter(email: string) {
    setPending(true);
    setError(null);
    try {
      const result = await api<{ user: SessionUser }>('/api/login', {
        method: 'POST',
        body: JSON.stringify({ email, password: 'Demo-Klaryo-2026' }),
      });
      setUser(result.user);
      navigate('/');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Accesso non riuscito.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="login">
      <section className="login-hero">
        <div className="mark">K</div>
        <h1>Vederci chiaro, senza fingere un preventivo.</h1>
        <p>
          Klaryo raccoglie casa, bolletta e abitudini e restituisce una stima statistica orientativa.
          Un installatore, dopo conferma dell'operatore e consenso della famiglia, verifica i dati e scrive la proposta.
        </p>
        <p className="muted">Questo ambiente è dimostrativo. Gli utenti e le pratiche sono sintetici. Non va esposto come servizio.</p>
      </section>
      <section className="login-panel">
        <h2>Accesso dimostrativo</h2>
        <p className="muted">Password unica dei dati seme: Demo-Klaryo-2026. Non usare dati di persone reali.</p>
        {error && <p className="error">{error}</p>}
        <div className="accounts">
          {ACCOUNTS.map((account) => (
            <button
              key={account.email}
              className="account"
              type="button"
              disabled={pending}
              data-testid={`login-${account.email}`}
              onClick={() => enter(account.email)}
            >
              <small>{account.role}</small>
              <strong>{account.name}</strong>
              <small>{account.email}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
