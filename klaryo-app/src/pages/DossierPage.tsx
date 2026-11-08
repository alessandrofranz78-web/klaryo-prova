import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatEur, formatKwh, formatNum, formatPercentRatio } from '../../domain/format';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import type { Dossier } from '../types';

export function DossierPage() {
  const { leadId = '' } = useParams();
  const { user } = useAuth();
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function load() {
    api<Dossier>(`/api/leads/${leadId}/dossier`)
      .then((result) => {
        setDossier(result);
        setError(null);
      })
      .catch((cause) => setError(cause instanceof ApiError ? cause.message : 'Pratica non disponibile.'));
  }

  useEffect(load, [leadId]);

  async function act(path: string, body?: unknown) {
    setPending(true);
    setError(null);
    try {
      const next = await api<Dossier>(path, { method: 'POST', body: body == null ? undefined : JSON.stringify(body) });
      setDossier(next);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Operazione non riuscita.');
    } finally {
      setPending(false);
    }
  }

  if (error && !dossier) return <p className="error">{error}</p>;
  if (!dossier) return <p>Carico la pratica…</p>;
  const result = dossier.analysis?.result ?? null;
  const active = result?.activeScenarioId === 'battery' ? result.scenarioBattery : result?.scenarioBase;

  return (
    <div>
      <p className="tag">sintetica · {dossier.lead.dataClassification}</p>
      <h1>{dossier.lead.displayName}</h1>
      <p>{dossier.banner}</p>
      {error && <p className="error">{error}</p>}
      <div className="grid-2">
        <section className="card">
          <h2>{dossier.caseFile.statusLabel}</h2>
          <p>Responsabile: {dossier.caseFile.ownerName}</p>
          <p>Oversight: {dossier.caseFile.oversightName}</p>
          {dossier.caseFile.delayHint && <p className="warn">{dossier.caseFile.delayDisclaimer}</p>}
          <Gates gates={dossier.gates} />
          {dossier.assignBlockers.length > 0 && user?.role === 'admin' && (
            <div className="warn">{dossier.assignBlockers.map((item) => <div key={item}>{item}</div>)}</div>
          )}
          <p className="muted">
            {dossier.lead.city ?? 'Comune non indicato'} {dossier.lead.province ? `(${dossier.lead.province})` : ''}
            {' · '}
            {dossier.lead.propertyType ?? 'immobile non indicato'}
            {dossier.lead.surfaceM2 ? ` · ${dossier.lead.surfaceM2} m²` : ''}
          </p>
          {dossier.lead.contactVisible ? (
            <p>Contatto visibile a questo ruolo: {dossier.lead.email ?? '—'} · {dossier.lead.phone ?? '—'} · {dossier.lead.address ?? '—'}</p>
          ) : (
            <p className="note">Contatto non visibile.</p>
          )}
        </section>
        <section className="card">
          <h2>Numeri</h2>
          {!result || result.energyBlocked ? (
            <p className="bad">{result?.blockReasons.join(' ') || 'Nessuna analisi.'}</p>
          ) : (
            <div className="grid-3">
              <Mini label="kWp" value={formatNum(result.plant?.kwp, 0)} />
              <Mini label="Produzione" value={formatKwh(result.plant?.productionKwh)} />
              <Mini label="Autoconsumo" value={formatKwh(active?.selfKwh)} />
              <Mini label="Cessione" value={formatKwh(active?.exportKwh)} />
              <Mini label="Beneficio annuo" value={formatEur(active?.annualEnergyBenefitEur)} />
              <Mini label="Completezza" value={result.confidence == null ? '—' : `${formatNum(result.confidence, 0)}/100`} />
            </div>
          )}
          {result?.priceEurPerKwh != null && <p>Prezzo unitario {formatEur(result.priceEurPerKwh, 2)}/kWh · indipendenza {formatPercentRatio(active?.independenceRatio)}</p>}
          <p className="muted">Versione ipotesi dell'analisi: {dossier.analysis?.assumptionVersion ?? '—'}</p>
          {result?.fiscal && <p className="note">{result.fiscal.disclaimer}</p>}
        </section>
      </div>

      {user?.role === 'admin' && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Abbinamento spiegabile</h2>
          <p className="muted">Regole su provincia e servizi dichiarati. Non è una distanza reale e non condivide i dati.</p>
          <button type="button" className="btn" data-testid="suggest-matches" disabled={pending || dossier.gates.adminConfirmed || dossier.gates.assigned} onClick={() => act(`/api/leads/${leadId}/match-suggestions`)}>
            Calcola abbinamenti
          </button>
          {dossier.suggestions.map((item) => (
            <article key={item.id} style={{ marginTop: 12 }}>
              <strong>{item.companyName}</strong> · punteggio {item.score} · {item.eligible ? 'idoneo' : 'non idoneo'} · {item.status}
              <ul>{item.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              {item.eligible && item.status !== 'admin_confirmed' && (
                <button type="button" className="btn-dark" data-testid={`confirm-${item.companyName}`} disabled={pending} onClick={() => act(`/api/match-suggestions/${item.id}/confirm`)}>
                  Conferma questo abbinamento
                </button>
              )}
            </article>
          ))}
          {dossier.gates.adminConfirmed && dossier.gates.customerConsent && !dossier.gates.assigned && (
            <button
              type="button"
              className="btn"
              data-testid="assign"
              disabled={pending}
              onClick={() => {
                const match = dossier.suggestions.find((item) => item.status === 'admin_confirmed');
                if (match) act(`/api/leads/${leadId}/assignments`, { matchId: match.id });
              }}
            >
              Assegna e condividi i dati
            </button>
          )}
        </section>
      )}

      {user?.role === 'customer' && dossier.gates.adminConfirmed && !dossier.gates.assigned && (
        <ConsentPanel dossier={dossier} pending={pending} onAct={act} leadId={leadId} />
      )}

      {dossier.assignment && (
        <p className="good">Assegnata a {dossier.assignment.companyName} il {new Date(dossier.assignment.assignedAt).toLocaleString('it-IT')}.</p>
      )}

      {result?.projection && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Orizzonte indicativo</h2>
          <p>Capitale {formatEur(result.projection.capexEur)} · beneficio cumulato {formatEur(result.projection.cumulativeBenefitEur)} · rientro {result.projection.indicativePaybackYears == null ? 'oltre l\'orizzonte' : `${formatNum(result.projection.indicativePaybackYears, 1)} anni`}</p>
          <p className="muted">{result.projection.accountingNote}</p>
        </section>
      )}

      {dossier.analysis && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Spiegazione</h2>
          <p className="note">{dossier.analysis.explanation.note}</p>
          <pre style={{ whiteSpace: 'pre-wrap', font: 'inherit' }}>{dossier.analysis.explanation.text}</pre>
        </section>
      )}

      <CaseActions dossier={dossier} pending={pending} onAct={act} role={user?.role ?? 'customer'} />

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Storia</h2>
        <ul className="timeline" data-testid="case-timeline">
          {dossier.events.map((event) => (
            <li key={event.id}>
              <strong>{event.label}</strong> · {new Date(event.at).toLocaleString('it-IT')} · {event.actorName}
              {event.note && <div>{event.note}</div>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Gates({ gates }: { gates: Dossier['gates'] }) {
  const items: Array<[boolean, string]> = [
    [gates.analysisSaved, 'Analisi salvata'],
    [gates.eligibleSuggestion, 'Abbinamento idoneo'],
    [gates.adminConfirmed, 'Conferma operatore'],
    [gates.customerConsent, 'Consenso famiglia'],
    [gates.assigned, 'Assegnazione'],
    [gates.proposalSubmitted, 'Proposta installatore'],
  ];
  return (
    <div className="row">
      {items.map(([ok, label]) => (
        <span key={label} className={ok ? 'good' : 'note'}>{ok ? 'Fatto' : 'In attesa'} · {label}</span>
      ))}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="kpi"><span>{label}</span><b style={{ fontSize: 18 }}>{value}</b></div>;
}

function ConsentPanel({
  dossier,
  pending,
  onAct,
  leadId,
}: {
  dossier: Dossier;
  pending: boolean;
  leadId: string;
  onAct: (path: string, body?: unknown) => Promise<void>;
}) {
  const [accepted, setAccepted] = useState(false);
  const company = dossier.suggestions[0]?.companyName ?? 'l\'installatore confermato';
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>Consenso prima della condivisione</h2>
      <p>L'operatore ha confermato <strong>{company}</strong>. I dati non sono ancora stati trasferiti.</p>
      <ul>{dossier.suggestions[0]?.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      <p>Verrebbero condivisi nome pratica, contatto, indirizzo, consumi, abitudini e questa analisi orientativa.</p>
      <label className="check">
        <input data-testid="consent-check" type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
        <span>{dossier.consentStatement}</span>
      </label>
      <button
        type="button"
        className="btn"
        data-testid="grant-consent"
        disabled={pending || !accepted}
        onClick={() => onAct(`/api/leads/${leadId}/consent`, { granted: true, acceptedStatement: dossier.consentStatement })}
      >
        Do il consenso
      </button>
    </section>
  );
}

function CaseActions({
  dossier,
  pending,
  onAct,
  role,
}: {
  dossier: Dossier;
  pending: boolean;
  role: 'admin' | 'installer' | 'customer';
  onAct: (path: string, body?: unknown) => Promise<void>;
}) {
  const caseId = dossier.caseFile.id;
  const [note, setNote] = useState('Controllo sui dati raccolti: restano da verificare in sopralluogo.');
  const [summary, setSummary] = useState('Proposta umana di verifica: non sostituisce il modello statistico e non è un preventivo vincolante.');
  const [technical, setTechnical] = useState('Sopralluogo ancora necessario. Esposizione e ombre non sono nel modello.');
  const [economic, setEconomic] = useState('Quadro economico scritto dall\'installatore, distinto dai numeri orientativi.');
  const [checkedKwh, setCheckedKwh] = useState('');
  const [flagNote, setFlagNote] = useState('Promemoria interno di incoerenza da ricontrollare con la famiglia.');

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>Lavoro sulla pratica</h2>
      {dossier.proposals.map((proposal) => (
        <article key={proposal.id} className="note">
          <strong>Proposta installatore</strong>
          <p>{proposal.summary}</p>
          <p>{proposal.technicalNotes}</p>
          <p>{proposal.economicNotes}</p>
          {proposal.divergenceNote && <p className="warn">{proposal.divergenceNote}</p>}
        </article>
      ))}
      {role === 'installer' && dossier.caseFile.actions.includes('proposta') && (
        <div>
          <label>Note tecniche<textarea value={technical} onChange={(event) => setTechnical(event.target.value)} /></label>
          <label>Note economiche<textarea value={economic} onChange={(event) => setEconomic(event.target.value)} /></label>
          <label>Sintesi<textarea value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
          <label>Consumo verificato, se diverso (kWh)<input value={checkedKwh} onChange={(event) => setCheckedKwh(event.target.value)} /></label>
          <button
            type="button"
            className="btn"
            data-testid="proposal-submit"
            disabled={pending}
            onClick={() => onAct(`/api/cases/${caseId}/proposals`, {
              technicalNotes: technical,
              economicNotes: economic,
              summary,
              checkedKwh: checkedKwh.trim() ? Number(checkedKwh.replace(',', '.')) : null,
              checkedSpendEur: null,
            })}
          >
            Registra la proposta
          </button>
          {dossier.caseFile.actions.includes('revisione_installatore') && (
            <button type="button" className="btn-line" disabled={pending} onClick={() => onAct(`/api/cases/${caseId}/revisione`, { note: 'Prendo in carico la revisione dei dati. Non è ancora una proposta.' })}>
              Segna la revisione
            </button>
          )}
        </div>
      )}
      {role === 'admin' && (
        <div>
          {dossier.caseFile.actions.includes('controllo') && (
            <div>
              <label>Nota di controllo<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
              <button type="button" className="btn-line" disabled={pending} onClick={() => onAct(`/api/cases/${caseId}/controllo`, { note })}>Registra un controllo</button>
            </div>
          )}
          {dossier.caseFile.actions.includes('esito') && (
            <button type="button" className="btn-line" disabled={pending} onClick={() => onAct(`/api/cases/${caseId}/esito`, { note: 'Esito registrato dall\'operatore dopo la proposta. Non è una certificazione.' })}>Registra l'esito</button>
          )}
          {dossier.caseFile.actions.includes('feedback') && (
            <button type="button" className="btn-line" disabled={pending} onClick={() => onAct(`/api/cases/${caseId}/feedback`, { note: 'Feedback di chiusura raccolto dall\'operatore.' })}>Registra il feedback</button>
          )}
          {dossier.caseFile.actions.includes('chiusura') && (
            <button type="button" className="btn-dark" disabled={pending} onClick={() => onAct(`/api/cases/${caseId}/chiusura`, { note: 'Pratica chiusa in archivio dimostrativo.' })}>Chiudi la pratica</button>
          )}
          <label>Segnalazione interna<textarea value={flagNote} onChange={(event) => setFlagNote(event.target.value)} /></label>
          <div className="row">
            {(['ritardo', 'incoerenza', 'reclamo'] as const).map((kind) => (
              <button key={kind} type="button" className="btn-line" data-testid={`flag-${kind}`} disabled={pending} onClick={() => onAct(`/api/cases/${caseId}/flags`, { kind, note: flagNote })}>
                Segnala {kind}
              </button>
            ))}
          </div>
          <p className="muted">{dossier.qualityDisclaimer}</p>
          {dossier.flagsVisible && dossier.flags.map((flag) => (
            <p key={flag.id} className="warn">{flag.kind}: {flag.note}</p>
          ))}
        </div>
      )}
      {role === 'customer' && (
        <div>
          <p className="muted">{dossier.qualityDisclaimer}</p>
          <p>Segnalazioni di oversight visibili come numero, senza le note interne: {dossier.flagCount}.</p>
          {dossier.caseFile.actions.includes('feedback_cliente') && (
            <button type="button" className="btn-line" disabled={pending} onClick={() => onAct(`/api/cases/${caseId}/feedback-cliente`, { note: 'Feedback della famiglia: percorso chiaro, numeri da far verificare.' })}>
              Invia un feedback
            </button>
          )}
        </div>
      )}
    </section>
  );
}
