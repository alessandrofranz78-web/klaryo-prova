import { useMemo, useState } from 'react';
import { HashRouter, Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { STATUS_LABEL } from '../domain/caseflow';
import { deterministicExplanation } from '../domain/explain';
import { formatEur, formatKwh, formatNum } from '../domain/format';
import type { PropertyType } from '../domain/energy';
import { EXAMPLE_CONTACT, EXAMPLE_INTAKE } from '../domain/example';
import './demo.css';
import '../src/styles.css';
import {
  CONSENT_STATEMENT,
  DEFAULT_ASSUMPTIONS,
  INSTALLERS,
  addFlag,
  addLead,
  addProposal,
  analysisOf,
  assignLead,
  canSeeContact,
  caseStatus,
  confirmMatch,
  grantConsent,
  loadState,
  resetState,
  saveState,
  suggestForLead,
  visibleLeads,
  type DemoLead,
  type DemoState,
  type SimRole,
} from './store';

const ROLE_LABEL: Record<SimRole, string> = {
  bianchi: 'Famiglia Bianchi',
  verdi: 'Famiglia Verdi',
  operatore: 'Operatore',
  nord: 'Installatore Nord',
  centro: 'Installatore Centro',
};

export function DemoApp() {
  const [state, setState] = useState<DemoState>(() => loadState());
  const [role, setRole] = useState<SimRole>('bianchi');
  const [notice, setNotice] = useState<string | null>(null);

  function commit(next: DemoState, error: string | null) {
    if (error) {
      setNotice(error);
      return;
    }
    saveState(next);
    setState(next);
    setNotice(null);
  }

  function reset() {
    const fresh = resetState();
    setState(fresh);
    setNotice('Dimostrazione azzerata. Sono tornati solo i dati fittizi iniziali.');
  }

  return (
    <HashRouter>
      <div className="shell">
        <aside className="sidebar">
          <Link to="/" className="brand">
            <div className="mark">K</div>
            <div>
              <strong>Klaryo</strong>
              <span>Demo pubblica</span>
            </div>
          </Link>
          <nav className="side-nav">
            <NavLink to="/analisi">Raccolta</NavLink>
            <NavLink to="/famiglie">Pratiche</NavLink>
            <NavLink to="/installatori">Installatori fittizi</NavLink>
          </nav>
          <div className="who">
            <b>Simulazione di ruolo</b>
            Non è un accesso protetto
          </div>
        </aside>
        <main className="main">
          <div className="public-banner" data-testid="public-banner">
            <strong>Dimostrazione pubblica. Solo dati fittizi.</strong>
            Nessun invio a server, CRM, posta o installatori. Il cambio ruolo è una simulazione visibile a chiunque apra la pagina, non un controllo di sicurezza. Non inserire dati reali.
            <div className="role-switch">
              {(Object.keys(ROLE_LABEL) as SimRole[]).map((item) => (
                <button key={item} type="button" className="btn-line" aria-pressed={role === item} data-testid={`role-${item}`} onClick={() => setRole(item)}>
                  {ROLE_LABEL[item]}
                </button>
              ))}
              <button type="button" className="btn" data-testid="reset-demo" onClick={reset}>Azzera dimostrazione</button>
            </div>
          </div>
          {notice && <p className="warn">{notice}</p>}
          <Routes>
            <Route path="/" element={<Home role={role} />} />
            <Route path="/analisi" element={<Wizard role={role} onSave={(lead) => { const step = addLead(state, role, lead); commit(step.state, step.error); return step.error == null; }} />} />
            <Route path="/famiglie" element={<LeadList state={state} role={role} />} />
            <Route path="/famiglie/:leadId" element={<Dossier state={state} role={role} onCommit={commit} />} />
            <Route path="/installatori" element={<Installers />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}

function Home({ role }: { role: SimRole }) {
  return (
    <div>
      <h1>Prova il percorso, senza inviare nulla.</h1>
      <p>Ruolo simulato adesso: {ROLE_LABEL[role]}. Bianchi ha una bolletta completa. Verdi non ha i kWh, quindi non compaiono cifre. Nord e Centro sono imprese inventate.</p>
      <p className="note">Ipotesi di calcolo, versione {DEFAULT_ASSUMPTIONS.version}. {DEFAULT_ASSUMPTIONS.sourceNote}</p>
      <div className="row">
        <Link className="btn" to="/analisi">Apri la raccolta</Link>
        <Link className="btn-dark" to="/famiglie/lead_bianchi_demo">Apri la pratica Bianchi</Link>
      </div>
    </div>
  );
}

function LeadList({ state, role }: { state: DemoState; role: SimRole }) {
  const leads = visibleLeads(state, role);
  return (
    <div>
      <h1>Pratiche fittizie</h1>
      <p className="muted">Elenco filtrato dal ruolo simulato. Non è una protezione: i dati sono già in questa pagina.</p>
      {leads.length === 0 ? <p className="note" data-testid="empty-leads">Nessuna pratica visibile per questo ruolo simulato. Un installatore ne vede una solo dopo l'assegnazione simulata.</p> : (
        <table>
          <thead><tr><th>Pratica</th><th>Luogo</th><th>Stato</th><th></th></tr></thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id}>
                <td>{lead.displayName}</td>
                <td>{lead.city} ({lead.province})</td>
                <td>{STATUS_LABEL[caseStatus(state, lead.id)]}</td>
                <td><Link to={`/famiglie/${lead.id}`}>Apri</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Dossier({ state, role, onCommit }: { state: DemoState; role: SimRole; onCommit: (state: DemoState, error: string | null) => void }) {
  const { leadId = '' } = useParams();
  const lead = state.leads.find((item) => item.id === leadId);
  const visible = Boolean(lead && visibleLeads(state, role).some((item) => item.id === lead.id));
  const [summary, setSummary] = useState('Proposta fittizia dell\'installatore simulato, distinta dai numeri orientativi.');
  const [accepted, setAccepted] = useState(false);
  const suggestions = state.suggestions.filter((item) => item.leadId === leadId);
  const confirmed = suggestions.find((item) => item.status === 'admin_confirmed');
  const assignment = state.assignments.find((item) => item.leadId === leadId);
  const blockers = useMemo(() => {
    const items: string[] = [];
    if (!confirmed) items.push('Manca la conferma simulata dell\'operatore.');
    if (lead?.consent !== 'granted') items.push('Manca il consenso esplicito della famiglia.');
    return items;
  }, [confirmed, lead?.consent]);
  if (!lead || !visible) {
    return <p className="bad" data-testid="hidden-lead">In questa simulazione il ruolo non mostra la pratica. Non è un divieto tecnico: i dati restano nel browser.</p>;
  }
  const result = analysisOf(lead);
  const active = result.activeScenarioId === 'battery' ? result.scenarioBattery : result.scenarioBase;
  const showContact = canSeeContact(state, role, lead);

  return (
    <div>
      <p className="tag">fittizia · solo in questo browser</p>
      <h1>{lead.displayName}</h1>
      <p>{STATUS_LABEL[caseStatus(state, lead.id)]}. {result.energyBlocked ? 'Cifre bloccate.' : `Completezza interna ${formatNum(result.confidence, 0)}/100.`}</p>
      <section className="card">
        <p>{lead.city} ({lead.province}) · {lead.propertyType ?? 'immobile non indicato'}</p>
        {showContact ? <p>Contatto fittizio visibile in questa simulazione: {lead.email} · {lead.phone} · {lead.address}</p> : <p className="note">Contatto nascosto per il ruolo simulato.</p>}
        {result.energyBlocked ? <p className="bad">{result.blockReasons.join(' ')}</p> : (
          <div className="grid-3">
            <div className="kpi"><span>kWp</span><b>{formatNum(result.plant?.kwp, 0)}</b></div>
            <div className="kpi"><span>Autoconsumo</span><b>{formatKwh(active?.selfKwh)}</b></div>
            <div className="kpi"><span>Cessione</span><b>{formatKwh(active?.exportKwh)}</b></div>
            <div className="kpi"><span>Beneficio annuo</span><b>{formatEur(active?.annualEnergyBenefitEur)}</b></div>
          </div>
        )}
        <p className="note">{result.fiscal.disclaimer}</p>
      </section>

      {role === 'operatore' && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Abbinamento simulato</h2>
          <p className="muted">Regole su provincia e servizi dichiarati delle imprese inventate. Nessuno viene contattato.</p>
          <button type="button" className="btn" data-testid="suggest-matches" onClick={() => { const step = suggestForLead(state, role, lead.id); onCommit(step.state, step.error); }}>Calcola abbinamenti</button>
          {suggestions.map((item) => (
            <article key={item.id}>
              <strong>{item.companyName}</strong> · {item.eligible ? 'idoneo' : 'non idoneo'} · {item.status}
              <ul>{item.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              {item.eligible && item.status !== 'admin_confirmed' && (
                <button type="button" className="btn-dark" data-testid="confirm-match" onClick={() => { const step = confirmMatch(state, role, item.id); onCommit(step.state, step.error); }}>Conferma simulata</button>
              )}
            </article>
          ))}
          {blockers.length > 0 && <div className="warn">{blockers.map((item) => <div key={item}>{item}</div>)}</div>}
          <button type="button" className="btn" data-testid="assign" disabled={blockers.length > 0 || Boolean(assignment)} onClick={() => { const step = assignLead(state, role, lead.id); onCommit(step.state, step.error); }}>Assegna nella simulazione</button>
        </section>
      )}

      {role === lead.owner && confirmed && !assignment && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Consenso simulato</h2>
          <p>L'operatore simulato ha indicato {confirmed.companyName}. Spuntare non invia i dati.</p>
          <label className="check">
            <input data-testid="consent-check" type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
            <span>{CONSENT_STATEMENT}</span>
          </label>
          <button type="button" className="btn" data-testid="grant-consent" disabled={!accepted} onClick={() => { const step = grantConsent(state, role, lead.id, CONSENT_STATEMENT); onCommit(step.state, step.error); }}>Registro il consenso in locale</button>
        </section>
      )}

      {assignment && <p className="good">Assegnazione simulata a {assignment.companyName}. Nessuna trasmissione.</p>}

      {(role === 'nord' || role === 'centro') && assignment && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Proposta simulata</h2>
          <label>Sintesi<textarea value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
          <button type="button" className="btn" data-testid="proposal-submit" onClick={() => {
            const step = addProposal(state, role, lead.id, {
              summary,
              technicalNotes: 'Verifica umana simulata. Nessun documento è stato caricato.',
              economicNotes: 'Quadro economico fittizio, non inviato.',
              checkedKwh: null,
            });
            onCommit(step.state, step.error);
          }}>Registra la proposta in locale</button>
        </section>
      )}

      {state.proposals.filter((item) => item.leadId === lead.id).map((item) => (
        <p key={item.id} className="note">{item.summary}</p>
      ))}

      {role === 'operatore' && (
        <button type="button" className="btn-line" data-testid="flag-incoerenza" onClick={() => { const step = addFlag(state, role, lead.id, 'incoerenza', 'Promemoria interno della simulazione.'); onCommit(step.state, step.error); }}>Segnala incoerenza simulata</button>
      )}
      <p className="muted">Le segnalazioni non garantiscono la qualità del lavoro. Non partono messaggi.</p>
      <p className="note" data-testid="no-upload">Caricamento documenti disattivato. Questa dimostrazione non accetta file.</p>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Spiegazione deterministica</h2>
        <pre style={{ whiteSpace: 'pre-wrap', font: 'inherit' }}>{deterministicExplanation(result, DEFAULT_ASSUMPTIONS)}</pre>
      </section>
      <ul className="timeline" data-testid="case-timeline">
        {state.events.filter((event) => event.leadId === lead.id).map((event) => (
          <li key={event.id}><strong>{event.type}</strong> · {event.actor}<div>{event.note}</div></li>
        ))}
      </ul>
    </div>
  );
}

function Installers() {
  return (
    <div>
      <h1>Installatori fittizi</h1>
      <p className="bad">Nessuna di queste imprese esiste. La pagina non invia richieste e non propone contatti reali.</p>
      <div className="grid-2">
        {INSTALLERS.map((item) => (
          <article key={item.id} className="card">
            <h2>{item.companyName}</h2>
            <p>{item.note}</p>
            <p>Province dichiarate: {item.provinces.join(', ')}</p>
            <p>Servizi dichiarati: {item.services.join(', ')}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function Wizard({ role, onSave }: { role: SimRole; onSave: (lead: DemoLead) => boolean }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [fictitious, setFictitious] = useState(false);
  const [draft, setDraft] = useState({
    displayName: '',
    city: '',
    province: '',
    propertyType: '' as PropertyType | '',
    surface: '',
    occupants: 2,
    ev: false,
    heatPump: false,
    gas: false,
    spend: '',
    kwh: '',
    battery: false,
  });
  const [error, setError] = useState<string | null>(null);

  function fill() {
    setFictitious(true);
    setDraft({
      displayName: EXAMPLE_CONTACT.displayName,
      city: EXAMPLE_CONTACT.city,
      province: EXAMPLE_CONTACT.province,
      propertyType: EXAMPLE_INTAKE.propertyType ?? '',
      surface: String(EXAMPLE_INTAKE.surfaceM2 ?? ''),
      occupants: EXAMPLE_INTAKE.occupants ?? 2,
      ev: false,
      heatPump: false,
      gas: true,
      spend: '1800',
      kwh: '3500',
      battery: false,
    });
    setStep(2);
  }

  function save() {
    if (role !== 'bianchi' && role !== 'verdi') {
      setError('Passa al ruolo famiglia per salvare. Il ruolo operatore non è un account.');
      return;
    }
    if (!fictitious) {
      setError('Conferma che i dati sono inventati. La dimostrazione non accetta dati reali.');
      return;
    }
    if (draft.displayName.trim().length < 2) {
      setError('Serve un nome pratica fittizio.');
      return;
    }
    const lead: DemoLead = {
      id: `lead_${Date.now()}`,
      owner: role,
      displayName: draft.displayName.trim(),
      email: 'esempio@example.invalid',
      phone: '333 000 0000',
      address: 'Via Dimostrazione 8',
      city: draft.city || 'Milano',
      province: (draft.province || 'MI').toUpperCase(),
      propertyType: draft.propertyType || null,
      surfaceM2: numberOrNull(draft.surface),
      occupants: draft.occupants,
      ev: draft.ev,
      heatPump: draft.heatPump,
      gas: draft.gas,
      annualSpendEur: numberOrNull(draft.spend),
      annualKwh: numberOrNull(draft.kwh),
      wantsBattery: draft.battery,
      includeFiscalScenario: false,
      consent: 'none',
    };
    if (!onSave(lead)) return;
    navigate(`/famiglie/${lead.id}`);
  }

  const labels = ['Nucleo', 'Casa', 'Bolletta', 'Impianto', 'Quadro', '10 anni', 'Batteria', 'Riepilogo'];
  return (
    <div>
      <h1>Raccolta orientativa</h1>
      <div className="steps">
        {labels.map((label, index) => (
          <button key={label} type="button" className={step === index ? 'on' : ''} onClick={() => setStep(index)}>{index + 1}. {label}</button>
        ))}
      </div>
      <button type="button" className="btn-line" data-testid="fill-example" onClick={fill}>Compila un esempio fittizio</button>
      {error && <p className="error">{error}</p>}
      <div className="card" style={{ marginTop: 12 }}>
        {step === 0 && (
          <>
            <label>Nome pratica fittizio<input data-testid="demo-name" value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></label>
            <label>Comune<input value={draft.city} onChange={(event) => setDraft({ ...draft, city: event.target.value })} /></label>
            <label>Provincia<input value={draft.province} onChange={(event) => setDraft({ ...draft, province: event.target.value.toUpperCase() })} /></label>
          </>
        )}
        {step === 1 && (
          <div className="choice">
            {(['appartamento', 'villa', 'bifamiliare'] as PropertyType[]).map((type) => (
              <button key={type} type="button" className={draft.propertyType === type ? 'on' : ''} onClick={() => setDraft({ ...draft, propertyType: type })}>{type}</button>
            ))}
          </div>
        )}
        {step === 2 && (
          <>
            <label>Spesa annua €<input data-testid="spend" value={draft.spend} onChange={(event) => setDraft({ ...draft, spend: event.target.value })} /></label>
            <label>Consumo annuo kWh<input data-testid="kwh" value={draft.kwh} onChange={(event) => setDraft({ ...draft, kwh: event.target.value })} /></label>
          </>
        )}
        {step >= 3 && step <= 6 && <p className="note">I numeri si calcolano in questa pagina con le ipotesi già presenti nel programma. Non partono richieste.</p>}
        {step === 7 && (
          <>
            <label className="check">
              <input data-testid="fictitious-check" type="checkbox" checked={fictitious} onChange={(event) => setFictitious(event.target.checked)} />
              <span>Confermo che questi dati sono inventati. Non scrivo nomi, telefoni o indirizzi reali.</span>
            </label>
            <button type="button" className="btn" data-testid="save-analysis" onClick={save}>Salva solo in questo browser</button>
          </>
        )}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        {step < 7 && <button type="button" className="btn" data-testid="wizard-next" onClick={() => setStep((value) => value + 1)}>Continua</button>}
      </div>
      <p data-testid="no-upload">Nessun caricamento di bollette o documenti.</p>
    </div>
  );
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
