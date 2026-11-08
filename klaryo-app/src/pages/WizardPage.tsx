import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AssumptionSet } from '../../domain/assumptions';
import { deterministicExplanation } from '../../domain/explain';
import { analyzeIntake, type Intake, type PropertyType } from '../../domain/energy';
import { EXAMPLE_CONTACT, EXAMPLE_INTAKE } from '../../domain/example';
import { formatEur, formatKwh, formatNum, formatPercentRatio } from '../../domain/format';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import type { AssumptionResponse } from '../types';

const STEPS = ['Nucleo', 'Casa', 'Bolletta', 'Impianto', 'Quadro', '10 anni', 'Batteria', 'Riepilogo'];

interface Draft {
  displayName: string;
  phone: string;
  address: string;
  city: string;
  province: string;
  propertyType: PropertyType | '';
  surfaceM2: string;
  occupants: number;
  ev: boolean;
  heatPump: boolean;
  gas: boolean;
  annualSpendEur: string;
  annualKwh: string;
  wantsBattery: boolean;
  includeFiscalScenario: boolean;
}

const EMPTY: Draft = {
  displayName: '',
  phone: '',
  address: '',
  city: '',
  province: '',
  propertyType: '',
  surfaceM2: '',
  occupants: 2,
  ev: false,
  heatPump: false,
  gas: false,
  annualSpendEur: '',
  annualKwh: '',
  wantsBattery: false,
  includeFiscalScenario: false,
};

export function WizardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [assumptions, setAssumptions] = useState<AssumptionSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api<AssumptionResponse>('/api/assumption-sets/current')
      .then((result) => setAssumptions(result.assumptions))
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Ipotesi non disponibili.'));
  }, []);

  const intake = useMemo(() => toIntake(draft), [draft]);
  const result = assumptions ? analyzeIntake(intake, assumptions) : null;
  const explanation = result && assumptions ? deterministicExplanation(result, assumptions) : '';

  function fillExample() {
    setDraft({
      ...EMPTY,
      displayName: EXAMPLE_CONTACT.displayName,
      phone: EXAMPLE_CONTACT.phone,
      address: EXAMPLE_CONTACT.address,
      city: EXAMPLE_CONTACT.city,
      province: EXAMPLE_CONTACT.province,
      propertyType: EXAMPLE_INTAKE.propertyType ?? '',
      surfaceM2: String(EXAMPLE_INTAKE.surfaceM2 ?? ''),
      occupants: EXAMPLE_INTAKE.occupants ?? 2,
      ev: EXAMPLE_INTAKE.ev,
      heatPump: EXAMPLE_INTAKE.heatPump,
      gas: EXAMPLE_INTAKE.gas,
      annualSpendEur: String(EXAMPLE_INTAKE.annualSpendEur ?? ''),
      annualKwh: String(EXAMPLE_INTAKE.annualKwh ?? ''),
      wantsBattery: false,
      includeFiscalScenario: false,
    });
    setStep(2);
  }

  function next() {
    if (step === 0 && draft.displayName.trim().length < 2) {
      setError('Serve un nome pratica, anche solo «Famiglia Esempio (sintetica)».');
      return;
    }
    if (step === 1 && !draft.propertyType) {
      setError('Scegli il tipo di immobile.');
      return;
    }
    setError(null);
    setStep((value) => Math.min(7, value + 1));
  }

  async function save() {
    if (!user || user.role !== 'customer') return;
    setPending(true);
    setError(null);
    try {
      const created = await api<{ leadId: string }>('/api/leads', {
        method: 'POST',
        body: JSON.stringify({
          displayName: draft.displayName,
          phone: draft.phone || null,
          address: draft.address || null,
          city: draft.city || null,
          province: draft.province || null,
          propertyType: draft.propertyType || null,
          surfaceM2: numberOrNull(draft.surfaceM2),
          occupants: draft.occupants,
          ev: draft.ev,
          heatPump: draft.heatPump,
          gas: draft.gas,
          annualSpendEur: numberOrNull(draft.annualSpendEur),
          annualKwh: numberOrNull(draft.annualKwh),
          wantsBattery: draft.wantsBattery,
          includeFiscalScenario: draft.includeFiscalScenario,
        }),
      });
      navigate(`/famiglie/${created.leadId}`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Salvataggio non riuscito.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <p className="muted">Percorso in 8 passi, lo stesso ordine del wizard recuperato.</p>
      <h1>Raccolta orientativa</h1>
      <div className="steps">
        {STEPS.map((label, index) => (
          <button key={label} type="button" className={index === step ? 'on' : ''} onClick={() => setStep(index)}>
            {index + 1}. {label}
          </button>
        ))}
      </div>
      <div className="row">
        <button type="button" className="btn-line" data-testid="fill-example" onClick={fillExample}>
          Compila un esempio sintetico
        </button>
        {assumptions && <span className="tag">Ipotesi {assumptions.version}</span>}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="card" style={{ marginTop: 16 }}>
        {step === 0 && (
          <>
            <h2>Nucleo</h2>
            <p className="muted">L'email resta quella dell'accesso. Non inserire dati di persone reali.</p>
            <Field label="Nome pratica" value={draft.displayName} onChange={(value) => setDraft({ ...draft, displayName: value })} />
            <Field label="Telefono sintetico" value={draft.phone} onChange={(value) => setDraft({ ...draft, phone: value })} />
            <Field label="Comune" value={draft.city} onChange={(value) => setDraft({ ...draft, city: value })} />
            <Field label="Provincia (sigla)" value={draft.province} onChange={(value) => setDraft({ ...draft, province: value.toUpperCase() })} />
            <Field label="Indirizzo" value={draft.address} onChange={(value) => setDraft({ ...draft, address: value })} />
            <p className="note">Senza provincia non c'è un abbinamento geografico. La provincia non cambia la resa dei pannelli.</p>
          </>
        )}
        {step === 1 && (
          <>
            <h2>Casa</h2>
            <div className="choice">
              {(['appartamento', 'villa', 'bifamiliare'] as PropertyType[]).map((type) => (
                <button key={type} type="button" className={draft.propertyType === type ? 'on' : ''} onClick={() => setDraft({ ...draft, propertyType: type })}>
                  {type}
                </button>
              ))}
            </div>
            <Field label="Superficie m²" value={draft.surfaceM2} onChange={(value) => setDraft({ ...draft, surfaceM2: value })} />
            <label>
              Persone: {draft.occupants}
              <input type="range" min={1} max={10} value={draft.occupants} onChange={(event) => setDraft({ ...draft, occupants: Number(event.target.value) })} />
            </label>
            <Toggle label="Auto elettrica" checked={draft.ev} onChange={(ev) => setDraft({ ...draft, ev })} />
            <Toggle label="Pompa di calore" checked={draft.heatPump} onChange={(heatPump) => setDraft({ ...draft, heatPump })} />
            <Toggle label="Gas in casa" checked={draft.gas} onChange={(gas) => setDraft({ ...draft, gas })} />
            <p className="note">Queste abitudini non aggiungono kilowattora. Servono all'abbinamento dei servizi e al racconto dei dati mancanti.</p>
          </>
        )}
        {step === 2 && (
          <>
            <h2>Bolletta</h2>
            <Field label="Spesa annua elettricità (€)" value={draft.annualSpendEur} onChange={(value) => setDraft({ ...draft, annualSpendEur: value })} testId="spend" />
            <Field label="Consumo annuo (kWh)" value={draft.annualKwh} onChange={(value) => setDraft({ ...draft, annualKwh: value })} testId="kwh" />
            {result?.priceEurPerKwh != null ? (
              <div className="kpi">
                <span>Prezzo unitario ricavato</span>
                <b>{formatEur(result.priceEurPerKwh, 2)} / kWh</b>
              </div>
            ) : (
              <p className="warn">Senza spesa e consumo non c'è un prezzo, e le cifre in euro restano bloccate.</p>
            )}
            {result?.warnings.filter((item) => item.includes('soglia')).map((item) => <p key={item} className="warn">{item}</p>)}
          </>
        )}
        {step === 3 && <PlantStep result={result} />}
        {step === 4 && (
          <MoneyStep
            result={result}
            fiscal={draft.includeFiscalScenario}
            onFiscal={(includeFiscalScenario) => setDraft({ ...draft, includeFiscalScenario })}
          />
        )}
        {step === 5 && <ProjectionStep result={result} />}
        {step === 6 && (
          <>
            <h2>Batteria</h2>
            <Toggle label="Includi lo scenario batteria" checked={draft.wantsBattery} onChange={(wantsBattery) => setDraft({ ...draft, wantsBattery })} />
            <p className="note">Lo scenario non si somma a quello senza batteria. Con il dimensionamento ereditato l'autoconsumo annuo è spesso già al tetto del consumo: in quel caso non attribuiamo alla batteria altri kWh.</p>
            {result?.battery && <p className="warn">{result.battery.heuristicNote}</p>}
            {result?.warnings.filter((item) => item.toLowerCase().includes('batteria')).map((item) => <p key={item} className="warn">{item}</p>)}
            {result?.scenarioBase && result.scenarioBattery && (
              <div className="grid-2">
                <ScenarioCard title="Senza batteria" self={result.scenarioBase.selfKwh} exp={result.scenarioBase.exportKwh} money={result.scenarioBase.annualEnergyBenefitEur} />
                <ScenarioCard title="Con ipotesi batteria" self={result.scenarioBattery.selfKwh} exp={result.scenarioBattery.exportKwh} money={result.scenarioBattery.annualEnergyBenefitEur} />
              </div>
            )}
          </>
        )}
        {step === 7 && (
          <>
            <h2>Riepilogo</h2>
            <p>{result?.energyBlocked ? 'Analisi senza cifre: mancano dati.' : 'Anteprima locale. Il salvataggio ricalcola gli stessi numeri sul server.'}</p>
            {result && (
              <p className="note">
                Completezza interna: {result.confidence == null ? 'non assegnata' : `${formatNum(result.confidence, 0)}/100`}. Non è una probabilità validata.
              </p>
            )}
            <pre style={{ whiteSpace: 'pre-wrap', font: 'inherit' }}>{explanation}</pre>
            {user?.role === 'customer' ? (
              <button type="button" className="btn" data-testid="save-analysis" disabled={pending} onClick={save}>
                {pending ? 'Salvo…' : 'Salva analisi orientativa'}
              </button>
            ) : (
              <p className="warn">Il salvataggio è riservato al ruolo famiglia, così la pratica resta intestata a un nucleo.</p>
            )}
          </>
        )}
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button type="button" className="btn-line" disabled={step === 0} onClick={() => setStep((value) => value - 1)}>Indietro</button>
        {step < 7 && (
          <button type="button" className="btn" data-testid="wizard-next" onClick={next}>Continua</button>
        )}
      </div>
    </div>
  );
}

function PlantStep({ result }: { result: ReturnType<typeof analyzeIntake> | null }) {
  if (!result || result.energyBlocked || !result.plant) {
    return <p className="bad">Senza consumo annuo non stimiamo kWp, pannelli o produzione.</p>;
  }
  return (
    <>
      <h2>Impianto indicativo</h2>
      <div className="grid-3">
        <Kpi label="Potenza" value={`${formatNum(result.plant.kwp, 0)} kWp`} />
        <Kpi label="Pannelli" value={formatNum(result.plant.panels, 0)} />
        <Kpi label="Produzione" value={formatKwh(result.plant.productionKwh)} />
        <Kpi label="Capitale impianto" value={formatEur(result.plant.capexEur)} />
      </div>
      <p className="note">{result.plant.sizingNote}</p>
      {result.disclosures.map((item) => <p key={item} className="muted">{item}</p>)}
    </>
  );
}

function MoneyStep({
  result,
  fiscal,
  onFiscal,
}: {
  result: ReturnType<typeof analyzeIntake> | null;
  fiscal: boolean;
  onFiscal: (value: boolean) => void;
}) {
  if (!result || result.moneyBlocked || !result.scenarioBase) {
    return <p className="bad">Cifre in euro bloccate: servono consumo e spesa, insieme.</p>;
  }
  const flow = result.scenarioBase;
  return (
    <>
      <h2>Quadro economico</h2>
      <div className="grid-3">
        <Kpi label="Autoconsumo" value={formatKwh(flow.selfKwh)} />
        <Kpi label="Cessione" value={formatKwh(flow.exportKwh)} />
        <Kpi label="Beneficio energia / anno" value={formatEur(flow.annualEnergyBenefitEur)} />
      </div>
      <p className="muted">Indipendenza sul consumo: {formatPercentRatio(flow.independenceRatio)}. Non è la quota di autoconsumo sulla produzione.</p>
      <Toggle label="Includi scenario fiscale ipotetico (non è una verifica di idoneità)" checked={fiscal} onChange={onFiscal} />
      <p className="note">{result.fiscal.disclaimer}</p>
      {result.warnings.map((item) => <p key={item} className="warn">{item}</p>)}
    </>
  );
}

function ProjectionStep({ result }: { result: ReturnType<typeof analyzeIntake> | null }) {
  if (!result?.projection) return <p className="bad">Orizzonte economico non calcolato: mancano le cifre in euro.</p>;
  const max = Math.max(...result.projection.years.map((year) => Math.max(year.cumulativeCostWithoutEur, year.cumulativeCostWithEur)), 1);
  return (
    <>
      <h2>Orizzonte {result.projection.years.length} anni</h2>
      <p className="note">{result.projection.accountingNote}</p>
      <div className="grid-3">
        <Kpi label="Capitale nello scenario" value={formatEur(result.projection.capexEur)} />
        <Kpi label="Beneficio cumulato" value={formatEur(result.projection.cumulativeBenefitEur)} />
        <Kpi label="Rientro indicativo" value={result.projection.indicativePaybackYears == null ? 'oltre l\'orizzonte' : `${formatNum(result.projection.indicativePaybackYears, 1)} anni`} />
      </div>
      <div className="legend" style={{ marginTop: 12 }}>
        <span><i className="a" /> Senza impianto</span> <span><i className="b" /> Con scenario</span>
      </div>
      <div className="bars" data-testid="projection-chart">
        {result.projection.years.map((year) => (
          <div key={year.year} className="bar-col">
            <div className="pair">
              <i className="a" style={{ height: `${(year.cumulativeCostWithoutEur / max) * 140}px` }} />
              <i className="b" style={{ height: `${Math.max(4, (Math.max(year.cumulativeCostWithEur, 0) / max) * 140)}px` }} />
            </div>
            <small>{year.year}</small>
          </div>
        ))}
      </div>
    </>
  );
}

function ScenarioCard({ title, self, exp, money }: { title: string; self: number; exp: number; money: number | null }) {
  return (
    <div className="kpi">
      <span>{title}</span>
      <b>{formatKwh(self)}</b>
      <span>cessione {formatKwh(exp)} · beneficio {formatEur(money)}</span>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="kpi"><span>{label}</span><b>{value}</b></div>;
}

function Field({ label, value, onChange, testId }: { label: string; value: string; onChange: (value: string) => void; testId?: string }) {
  return (
    <label>
      {label}
      <input data-testid={testId} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </div>
  );
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function toIntake(draft: Draft): Intake {
  return {
    annualKwh: numberOrNull(draft.annualKwh),
    annualSpendEur: numberOrNull(draft.annualSpendEur),
    wantsBattery: draft.wantsBattery,
    includeFiscalScenario: draft.includeFiscalScenario,
    propertyType: draft.propertyType || null,
    surfaceM2: numberOrNull(draft.surfaceM2),
    occupants: draft.occupants,
    ev: draft.ev,
    heatPump: draft.heatPump,
    gas: draft.gas,
    province: draft.province.trim() ? draft.province.trim().toUpperCase() : null,
  };
}
