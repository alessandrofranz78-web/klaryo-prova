import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AssumptionSet } from '../../domain/assumptions';
import { STATUS_LABEL, type CaseStatus } from '../../domain/caseflow';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import type { AssumptionResponse, InstallerCard, LeadSummary } from '../types';

export function LeadsPage() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ leads: LeadSummary[] }>('/api/leads')
      .then((result) => setLeads(result.leads))
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Errore'));
  }, []);

  return (
    <div>
      <h1>{user?.role === 'installer' ? 'Pratiche assegnate' : 'Famiglie'}</h1>
      <p className="muted">Elenco senza telefono né email. I record segnati sono sintetici.</p>
      {error && <p className="error">{error}</p>}
      {leads.length === 0 ? (
        <p className="note">Nessuna pratica visibile per questo ruolo. Un installatore vede una famiglia solo dopo l'assegnazione.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Pratica</th><th>Luogo</th><th>Stato</th><th>Responsabile</th><th></th></tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id}>
                <td>{lead.displayName}<div className="tag">sintetica</div></td>
                <td>{lead.city ?? '—'} {lead.province ?? ''}</td>
                <td>
                  {STATUS_LABEL[lead.caseStatus as CaseStatus] ?? lead.caseStatus}
                  {lead.delayHint && <div className="warn">Possibile ritardo, solo promemoria</div>}
                </td>
                <td>{lead.ownerName}</td>
                <td><Link to={`/famiglie/${lead.id}`}>Apri</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function InstallersPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<InstallerCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    api<{ installers: InstallerCard[] }>('/api/installers')
      .then((result) => setItems(result.installers))
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Errore'));
  }

  useEffect(load, []);

  async function save(item: InstallerCard, provinces: string, services: string[]) {
    setError(null);
    try {
      await api(`/api/installers/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          provinces: provinces.split(',').map((part) => part.trim()).filter(Boolean),
          services,
        }),
      });
      setNotice('Copertura aggiornata. Vale per i prossimi abbinamenti, non riscrive le pratiche già assegnate.');
      load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Aggiornamento non riuscito.');
    }
  }

  return (
    <div>
      <h1>Installatori</h1>
      <p className="muted">Copertura e servizi sono dichiarati, non verificati sul territorio. Nessuna impresa di questo elenco è reale.</p>
      {error && <p className="error">{error}</p>}
      {notice && <p className="good">{notice}</p>}
      <div className="grid-2">
        {items.map((item) => (
          <InstallerEditor key={item.id} item={item} canEdit={user?.role === 'admin' || user?.installerId === item.id} onSave={save} />
        ))}
      </div>
    </div>
  );
}

function InstallerEditor({
  item,
  canEdit,
  onSave,
}: {
  item: InstallerCard;
  canEdit: boolean;
  onSave: (item: InstallerCard, provinces: string, services: string[]) => void;
}) {
  const [provinces, setProvinces] = useState(item.provinces.join(', '));
  const [services, setServices] = useState(item.services);
  function toggle(service: string) {
    setServices((current) => current.includes(service) ? current.filter((item) => item !== service) : [...current, service]);
  }
  return (
    <article className="card">
      <h2>{item.companyName}</h2>
      <p className="muted">{item.notes}</p>
      {item.contactName && <p>Referente: {item.contactName}</p>}
      <label>Province dichiarate<input value={provinces} onChange={(event) => setProvinces(event.target.value)} disabled={!canEdit} /></label>
      {['fotovoltaico', 'batteria', 'pompa_di_calore'].map((service) => (
        <label key={service} className="check">
          <input type="checkbox" checked={services.includes(service)} disabled={!canEdit} onChange={() => toggle(service)} />
          {service.replaceAll('_', ' ')}
        </label>
      ))}
      {canEdit && <button type="button" className="btn" onClick={() => onSave(item, provinces, services)}>Salva anagrafica</button>}
    </article>
  );
}

export function AssumptionsPage() {
  const [current, setCurrent] = useState<AssumptionSet | null>(null);
  const [versions, setVersions] = useState<AssumptionResponse['versions']>([]);
  const [version, setVersion] = useState('ipotesi-locale-2');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<AssumptionResponse>('/api/assumption-sets/current').then((result) => {
      setCurrent(result.assumptions);
      setVersions(result.versions);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Errore'));
  }, []);

  async function save() {
    if (!current) return;
    setError(null);
    try {
      const saved = await api<{ assumptions: AssumptionSet }>('/api/assumption-sets', {
        method: 'POST',
        body: JSON.stringify({ ...current, version, label: `Revisione ${version}` }),
      });
      setCurrent(saved.assumptions);
      setNotice('Nuova versione salvata. Le analisi già registrate restano sulla versione con cui sono nate.');
      const again = await api<AssumptionResponse>('/api/assumption-sets/current');
      setVersions(again.versions);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Salvataggio non riuscito.');
    }
  }

  if (!current) return <p>Carico le ipotesi…</p>;

  return (
    <div>
      <h1>Ipotesi di calcolo</h1>
      <p className="muted">{current.sourceNote}</p>
      {error && <p className="error">{error}</p>}
      {notice && <p className="good">{notice}</p>}
      <div className="card">
        <NumberField label="Resa kWh/kWp" value={current.specificYieldKwhPerKwp} onChange={(specificYieldKwhPerKwp) => setCurrent({ ...current, specificYieldKwhPerKwp })} />
        <NumberField label="Autoconsumo senza batteria (0–1)" value={current.selfConsumptionWithoutBattery} onChange={(selfConsumptionWithoutBattery) => setCurrent({ ...current, selfConsumptionWithoutBattery })} />
        <NumberField label="Autoconsumo con batteria (0–1)" value={current.selfConsumptionWithBattery} onChange={(selfConsumptionWithBattery) => setCurrent({ ...current, selfConsumptionWithBattery })} />
        <NumberField label="€/kWp impianto" value={current.plantCostEurPerKwp} onChange={(plantCostEurPerKwp) => setCurrent({ ...current, plantCostEurPerKwp })} />
        <NumberField label="€/kWh cessione" value={current.exportPriceEurPerKwh} onChange={(exportPriceEurPerKwh) => setCurrent({ ...current, exportPriceEurPerKwh })} />
        <NumberField label="Crescita annua prezzo (0–1)" value={current.energyPriceGrowthAnnual} onChange={(energyPriceGrowthAnnual) => setCurrent({ ...current, energyPriceGrowthAnnual })} />
        <NumberField label="Aliquota scenario fiscale, non applicata da sola" value={current.fiscalIncentiveRate} onChange={(fiscalIncentiveRate) => setCurrent({ ...current, fiscalIncentiveRate })} />
        <label>Codice della nuova versione<input value={version} onChange={(event) => setVersion(event.target.value)} /></label>
        <button type="button" className="btn" onClick={save}>Salva come nuova versione</button>
      </div>
      <h2>Versioni presenti</h2>
      <ul>{versions.map((item) => <li key={item.id}>{item.version} — {item.label}</li>)}</ul>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>
      {label}
      <input value={String(value)} onChange={(event) => onChange(Number(event.target.value.replace(',', '.')))} />
    </label>
  );
}
