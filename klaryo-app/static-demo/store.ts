import { DEFAULT_ASSUMPTIONS } from '../domain/assumptions';
import { statusAfter, type CaseStatus } from '../domain/caseflow';
import { CONSENT_STATEMENT } from '../domain/copy';
import { analyzeIntake, type EnergyResult, type Intake, type PropertyType } from '../domain/energy';
import { suggestMatches } from '../domain/matching';

export const DEMO_STORAGE_KEY = 'klaryo-static-demo-v1';

export type SimRole = 'bianchi' | 'verdi' | 'operatore' | 'nord' | 'centro';

export interface InstallerCard {
  id: string;
  companyName: string;
  provinces: string[];
  services: string[];
  active: boolean;
  note: string;
}

export const INSTALLERS: InstallerCard[] = [
  {
    id: 'inst_nord_demo',
    companyName: 'Nord Demo Impianti Srl',
    provinces: ['MI', 'MB', 'VA'],
    services: ['fotovoltaico', 'batteria'],
    active: true,
    note: 'Impresa inventata per la dimostrazione. Non esiste e non va contattata.',
  },
  {
    id: 'inst_centro_demo',
    companyName: 'Centro Demo Energia Srl',
    provinces: ['FI', 'PO'],
    services: ['fotovoltaico', 'pompa_di_calore'],
    active: true,
    note: 'Impresa inventata per la dimostrazione. Non esiste e non va contattata.',
  },
];

export interface DemoLead {
  id: string;
  owner: 'bianchi' | 'verdi';
  displayName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  province: string;
  propertyType: PropertyType | null;
  surfaceM2: number | null;
  occupants: number | null;
  ev: boolean;
  heatPump: boolean;
  gas: boolean;
  annualSpendEur: number | null;
  annualKwh: number | null;
  wantsBattery: boolean;
  includeFiscalScenario: boolean;
  consent: 'none' | 'granted' | 'revoked';
}

export interface DemoEvent {
  id: string;
  leadId: string;
  type: string;
  at: string;
  actor: string;
  note: string;
}

export interface DemoSuggestion {
  id: string;
  leadId: string;
  installerId: string;
  companyName: string;
  score: number;
  eligible: boolean;
  reasons: string[];
  status: 'proposed' | 'admin_confirmed' | 'rejected';
}

export interface DemoAssignment {
  leadId: string;
  installerId: string;
  companyName: string;
  at: string;
}

export interface DemoProposal {
  id: string;
  leadId: string;
  installerId: string;
  summary: string;
  technicalNotes: string;
  economicNotes: string;
  checkedKwh: number | null;
  at: string;
}

export interface DemoFlag {
  id: string;
  leadId: string;
  kind: string;
  note: string;
  at: string;
}

export interface DemoState {
  leads: DemoLead[];
  events: DemoEvent[];
  suggestions: DemoSuggestion[];
  assignments: DemoAssignment[];
  proposals: DemoProposal[];
  flags: DemoFlag[];
}

export interface StepResult {
  state: DemoState;
  error: string | null;
}

const ROLE_INSTALLER: Partial<Record<SimRole, string>> = {
  nord: 'inst_nord_demo',
  centro: 'inst_centro_demo',
};

export function intakeOf(lead: DemoLead): Intake {
  return {
    annualKwh: lead.annualKwh,
    annualSpendEur: lead.annualSpendEur,
    wantsBattery: lead.wantsBattery,
    includeFiscalScenario: lead.includeFiscalScenario,
    propertyType: lead.propertyType,
    surfaceM2: lead.surfaceM2,
    occupants: lead.occupants,
    ev: lead.ev,
    heatPump: lead.heatPump,
    gas: lead.gas,
    province: lead.province,
  };
}

export function analysisOf(lead: DemoLead): EnergyResult {
  return analyzeIntake(intakeOf(lead), DEFAULT_ASSUMPTIONS);
}

export function caseStatus(state: DemoState, leadId: string): CaseStatus {
  const types = state.events.filter((event) => event.leadId === leadId).map((event) => event.type);
  let status: CaseStatus = 'analisi_iniziale';
  for (const type of types) status = statusAfter(status, type);
  return status;
}

export function initialDemoState(): DemoState {
  const at = '2026-01-15T09:00:00.000Z';
  return {
    leads: [
      {
        id: 'lead_bianchi_demo',
        owner: 'bianchi',
        displayName: 'Famiglia Bianchi (fittizia)',
        email: 'famiglia.bianchi@example.invalid',
        phone: '333 000 1101',
        address: 'Via Esempio 1',
        city: 'Milano',
        province: 'MI',
        propertyType: 'villa',
        surfaceM2: 140,
        occupants: 3,
        ev: false,
        heatPump: false,
        gas: true,
        annualSpendEur: 1800,
        annualKwh: 3500,
        wantsBattery: false,
        includeFiscalScenario: false,
        consent: 'none',
      },
      {
        id: 'lead_verdi_demo',
        owner: 'verdi',
        displayName: 'Famiglia Verdi (fittizia)',
        email: 'famiglia.verdi@example.invalid',
        phone: '333 000 1102',
        address: 'Via Campione 12',
        city: 'Firenze',
        province: 'FI',
        propertyType: 'appartamento',
        surfaceM2: 75,
        occupants: 2,
        ev: false,
        heatPump: true,
        gas: false,
        annualSpendEur: 960,
        annualKwh: null,
        wantsBattery: false,
        includeFiscalScenario: false,
        consent: 'none',
      },
    ],
    events: [
      {
        id: 'ev_bianchi_seed',
        leadId: 'lead_bianchi_demo',
        type: 'analisi_iniziale',
        at,
        actor: 'Famiglia Bianchi (fittizia)',
        note: 'Analisi orientativa già presente nei dati di esempio. Non è stata trasmessa.',
      },
      {
        id: 'ev_verdi_seed',
        leadId: 'lead_verdi_demo',
        type: 'analisi_iniziale',
        at,
        actor: 'Famiglia Verdi (fittizia)',
        note: 'Consumo annuo assente: le cifre economiche restano bloccate.',
      },
    ],
    suggestions: [],
    assignments: [],
    proposals: [],
    flags: [],
  };
}

export function assignmentFor(state: DemoState, leadId: string): DemoAssignment | undefined {
  return state.assignments.find((item) => item.leadId === leadId);
}

export function visibleLeads(state: DemoState, role: SimRole): DemoLead[] {
  if (role === 'operatore') return state.leads;
  if (role === 'bianchi' || role === 'verdi') return state.leads.filter((lead) => lead.owner === role);
  const installerId = ROLE_INSTALLER[role];
  return state.leads.filter((lead) => assignmentFor(state, lead.id)?.installerId === installerId);
}

export function canSeeContact(state: DemoState, role: SimRole, lead: DemoLead): boolean {
  if (role === 'operatore') return true;
  if (role === lead.owner) return true;
  const installerId = ROLE_INSTALLER[role];
  return installerId != null && assignmentFor(state, lead.id)?.installerId === installerId;
}

function deny(state: DemoState, error: string): StepResult {
  return { state, error };
}

function stamp(note: string, actor: string, leadId: string, type: string, state: DemoState): DemoState {
  return {
    ...state,
    events: [
      ...state.events,
      { id: `ev_${Date.now()}_${state.events.length}`, leadId, type, at: new Date().toISOString(), actor, note },
    ],
  };
}

export function addLead(state: DemoState, role: SimRole, lead: DemoLead): StepResult {
  if (role !== 'bianchi' && role !== 'verdi') {
    return deny(state, 'Nella simulazione solo una famiglia salva la raccolta. Cambia ruolo.');
  }
  if (lead.owner !== role) return deny(state, 'La pratica resta intestata al ruolo famiglia selezionato.');
  const next = stamp(
    'Analisi salvata solo in questo browser. Nessun invio.',
    lead.displayName,
    lead.id,
    'analisi_iniziale',
    { ...state, leads: [lead, ...state.leads] },
  );
  return { state: next, error: null };
}

export function suggestForLead(state: DemoState, role: SimRole, leadId: string): StepResult {
  if (role !== 'operatore') return deny(state, 'Simulazione: solo il ruolo operatore calcola gli abbinamenti.');
  const lead = state.leads.find((item) => item.id === leadId);
  if (!lead) return deny(state, 'Pratica non trovata.');
  if (assignmentFor(state, leadId)) return deny(state, 'Pratica già assegnata nella simulazione.');
  if (state.suggestions.some((item) => item.leadId === leadId && item.status === 'admin_confirmed')) {
    return deny(state, 'C\'è già una conferma simulata. Non si ricalcola.');
  }
  const matches = suggestMatches(
    { province: lead.province, wantsBattery: lead.wantsBattery, heatPump: lead.heatPump },
    INSTALLERS.map((item) => ({
      id: item.id,
      companyName: item.companyName,
      provinces: item.provinces,
      services: item.services,
      active: item.active,
    })),
  );
  const suggestions = [
    ...state.suggestions.filter((item) => item.leadId !== leadId),
    ...matches.map((match, index) => ({
      id: `match_${leadId}_${index}`,
      leadId,
      installerId: match.installerId,
      companyName: match.companyName,
      score: match.score,
      eligible: match.eligible,
      reasons: match.reasons,
      status: 'proposed' as const,
    })),
  ];
  return {
    state: stamp('Abbinamenti ricalcolati in locale. Nessuna impresa è stata contattata.', 'Operatore (simulato)', leadId, 'abbinamento_calcolato', {
      ...state,
      suggestions,
    }),
    error: null,
  };
}

export function confirmMatch(state: DemoState, role: SimRole, suggestionId: string): StepResult {
  if (role !== 'operatore') return deny(state, 'Simulazione: solo il ruolo operatore conferma.');
  const suggestion = state.suggestions.find((item) => item.id === suggestionId);
  if (!suggestion) return deny(state, 'Abbinamento non trovato.');
  if (!suggestion.eligible) return deny(state, 'Abbinamento non idoneo: conferma bloccata.');
  if (assignmentFor(state, suggestion.leadId)) return deny(state, 'Pratica già assegnata.');
  const suggestions = state.suggestions.map((item) => {
    if (item.leadId !== suggestion.leadId) return item;
    if (item.id === suggestion.id) return { ...item, status: 'admin_confirmed' as const };
    return { ...item, status: 'rejected' as const };
  });
  return {
    state: stamp(
      `Conferma simulata per ${suggestion.companyName}. Nessun dato è uscito dal browser.`,
      'Operatore (simulato)',
      suggestion.leadId,
      'conferma_admin',
      { ...state, suggestions },
    ),
    error: null,
  };
}

export function grantConsent(state: DemoState, role: SimRole, leadId: string, statement: string): StepResult {
  const lead = state.leads.find((item) => item.id === leadId);
  if (!lead) return deny(state, 'Pratica non trovata.');
  if (role !== lead.owner) return deny(state, 'Simulazione: il consenso lo dà solo la famiglia della pratica.');
  if (assignmentFor(state, leadId)) return deny(state, 'Assegnazione già simulata.');
  if (!state.suggestions.some((item) => item.leadId === leadId && item.status === 'admin_confirmed')) {
    return deny(state, 'Manca la conferma simulata dell\'operatore.');
  }
  if (statement !== CONSENT_STATEMENT) return deny(state, 'Serve la formula di consenso, anche se qui non viene inviata.');
  const leads = state.leads.map((item) => (item.id === leadId ? { ...item, consent: 'granted' as const } : item));
  return {
    state: stamp('Consenso registrato solo in questo browser. Nessuna condivisione è avvenuta.', lead.displayName, leadId, 'consenso', {
      ...state,
      leads,
    }),
    error: null,
  };
}

export function assignLead(state: DemoState, role: SimRole, leadId: string): StepResult {
  if (role !== 'operatore') return deny(state, 'Simulazione: solo il ruolo operatore assegna.');
  const lead = state.leads.find((item) => item.id === leadId);
  if (!lead) return deny(state, 'Pratica non trovata.');
  if (assignmentFor(state, leadId)) return deny(state, 'Già assegnata.');
  const confirmed = state.suggestions.find((item) => item.leadId === leadId && item.status === 'admin_confirmed' && item.eligible);
  if (!confirmed) return deny(state, 'Manca la conferma su un abbinamento idoneo.');
  if (lead.consent !== 'granted') return deny(state, 'Manca il consenso esplicito della famiglia. Nessun dato è stato condiviso.');
  const assignment: DemoAssignment = {
    leadId,
    installerId: confirmed.installerId,
    companyName: confirmed.companyName,
    at: new Date().toISOString(),
  };
  return {
    state: stamp(
      `Assegnazione simulata a ${confirmed.companyName}. Resta una finzione nel browser.`,
      'Operatore (simulato)',
      leadId,
      'assegnazione',
      { ...state, assignments: [...state.assignments, assignment] },
    ),
    error: null,
  };
}

export function addProposal(
  state: DemoState,
  role: SimRole,
  leadId: string,
  input: { summary: string; technicalNotes: string; economicNotes: string; checkedKwh: number | null },
): StepResult {
  const installerId = ROLE_INSTALLER[role];
  const assignment = assignmentFor(state, leadId);
  if (!installerId || assignment?.installerId !== installerId) {
    return deny(state, 'Simulazione: solo l\'installatore assegnato scrive la proposta.');
  }
  if (input.summary.trim().length < 20) return deny(state, 'La sintesi è troppo corta.');
  const proposal: DemoProposal = {
    id: `prop_${state.proposals.length}`,
    leadId,
    installerId,
    summary: input.summary.trim(),
    technicalNotes: input.technicalNotes.trim(),
    economicNotes: input.economicNotes.trim(),
    checkedKwh: input.checkedKwh,
    at: new Date().toISOString(),
  };
  return {
    state: stamp(
      'Proposta scritta nella simulazione. Il calcolo statistico non cambia e non esce dal browser.',
      assignment.companyName,
      leadId,
      'proposta',
      { ...state, proposals: [...state.proposals, proposal] },
    ),
    error: null,
  };
}

export function addFlag(state: DemoState, role: SimRole, leadId: string, kind: string, note: string): StepResult {
  if (role !== 'operatore') return deny(state, 'Simulazione: solo il ruolo operatore segnala.');
  if (note.trim().length < 3) return deny(state, 'Nota troppo corta.');
  const flag: DemoFlag = { id: `flag_${state.flags.length}`, leadId, kind, note: note.trim(), at: new Date().toISOString() };
  return {
    state: stamp('Segnalazione registrata in locale. Non garantisce qualità né tempi.', 'Operatore (simulato)', leadId, 'segnalazione', {
      ...state,
      flags: [...state.flags, flag],
    }),
    error: null,
  };
}

export function loadState(): DemoState {
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return initialDemoState();
    const parsed = JSON.parse(raw) as DemoState;
    if (!Array.isArray(parsed.leads) || !Array.isArray(parsed.events)) return initialDemoState();
    return parsed;
  } catch {
    return initialDemoState();
  }
}

export function saveState(state: DemoState): void {
  localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
}

export function resetState(): DemoState {
  localStorage.removeItem(DEMO_STORAGE_KEY);
  return initialDemoState();
}

export { CONSENT_STATEMENT, DEFAULT_ASSUMPTIONS };
