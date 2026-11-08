export const CASE_STATUSES = [
  'analisi_iniziale',
  'controlli',
  'abbinamento_proposto',
  'assegnato',
  'revisione_installatore',
  'proposta',
  'esito',
  'feedback',
  'chiuso',
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

export const STATUS_LABEL: Record<CaseStatus, string> = {
  analisi_iniziale: 'Analisi iniziale',
  controlli: 'Controlli',
  abbinamento_proposto: 'Abbinamento in attesa di consenso',
  assegnato: 'Assegnata',
  revisione_installatore: 'Revisione installatore',
  proposta: 'Proposta dell\'installatore',
  esito: 'Esito',
  feedback: 'Feedback',
  chiuso: 'Chiusa',
};

export const EVENT_LABEL: Record<string, string> = {
  analisi_iniziale: 'Analisi iniziale salvata',
  controllo: 'Controllo operatore',
  abbinamento_calcolato: 'Abbinamenti ricalcolati',
  conferma_admin: 'Conferma operatore',
  consenso: 'Consenso della famiglia',
  revoca_consenso: 'Revoca del consenso',
  assegnazione: 'Assegnazione',
  revisione_installatore: 'Revisione installatore',
  proposta: 'Proposta dell\'installatore',
  esito: 'Esito registrato',
  feedback: 'Feedback operatore',
  feedback_cliente: 'Feedback della famiglia',
  segnalazione: 'Segnalazione di oversight',
  chiusura: 'Chiusura',
};

const EVENT_FROM: Record<string, CaseStatus[]> = {
  controllo: [
    'analisi_iniziale',
    'controlli',
    'abbinamento_proposto',
    'assegnato',
    'revisione_installatore',
    'proposta',
    'esito',
    'feedback',
  ],
  revisione_installatore: ['assegnato', 'revisione_installatore'],
  proposta: ['assegnato', 'revisione_installatore', 'proposta'],
  esito: ['proposta'],
  feedback: ['esito', 'feedback'],
  chiusura: ['feedback'],
  feedback_cliente: [
    'analisi_iniziale',
    'controlli',
    'abbinamento_proposto',
    'assegnato',
    'revisione_installatore',
    'proposta',
    'esito',
    'feedback',
    'chiuso',
  ],
};

const EVENT_TARGET: Partial<Record<string, CaseStatus>> = {
  controllo: 'controlli',
  conferma_admin: 'abbinamento_proposto',
  assegnazione: 'assegnato',
  revisione_installatore: 'revisione_installatore',
  proposta: 'proposta',
  esito: 'esito',
  feedback: 'feedback',
  chiusura: 'chiuso',
};

export function statusIndex(status: CaseStatus): number {
  return CASE_STATUSES.indexOf(status);
}

export function assertEventAllowed(current: CaseStatus, event: string): string | null {
  const allowed = EVENT_FROM[event];
  if (!allowed) return 'Evento non gestito da questo passaggio.';
  if (!allowed.includes(current)) {
    return `Passaggio non consentito dallo stato «${STATUS_LABEL[current]}».`;
  }
  return null;
}

export function statusAfter(current: CaseStatus, event: string): CaseStatus {
  const target = EVENT_TARGET[event];
  if (!target) return current;
  if (statusIndex(target) > statusIndex(current)) return target;
  return current;
}

const DELAY_STATUSES: CaseStatus[] = ['abbinamento_proposto', 'assegnato', 'revisione_installatore'];

export function caseLooksDelayed(
  lastEventAtIso: string,
  status: CaseStatus,
  now: Date,
  thresholdDays: number,
): boolean {
  if (!DELAY_STATUSES.includes(status)) return false;
  const at = new Date(lastEventAtIso).getTime();
  if (!Number.isFinite(at)) return false;
  return now.getTime() - at > thresholdDays * 24 * 60 * 60 * 1000;
}
