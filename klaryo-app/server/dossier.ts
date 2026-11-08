import { caseLooksDelayed, EVENT_LABEL, STATUS_LABEL, type CaseStatus } from '../domain/caseflow';
import { CONSENT_STATEMENT, QUALITY_DISCLAIMER, STATISTICAL_BANNER } from '../domain/copy';
import type { Explanation } from '../domain/explain';
import type { EnergyResult } from '../domain/energy';
import { availableActions, type Viewer } from '../domain/roles';
import { HttpError } from './errors';
import {
  getAssignment,
  getCaseById,
  getCaseByLead,
  getCurrentAssumptions,
  getLead,
  latestAnalysis,
  listEvents,
  listFlags,
  listProposals,
  listSuggestions,
  findUserById,
  type DB,
  type LeadRecord,
  type ProposalRecord,
  type SuggestionRecord,
} from './db';

export interface Dossier {
  lead: {
    id: string;
    displayName: string;
    city: string | null;
    province: string | null;
    propertyType: string | null;
    surfaceM2: number | null;
    occupants: number | null;
    ev: boolean;
    heatPump: boolean;
    gas: boolean;
    annualSpendEur: number | null;
    annualKwh: number | null;
    wantsBattery: boolean;
    includeFiscalScenario: boolean;
    consentStatus: string;
    consentAt: string | null;
    synthetic: true;
    dataClassification: 'synthetic_demo';
    email: string | null;
    phone: string | null;
    address: string | null;
    contactVisible: boolean;
  };
  analysis: null | {
    id: string;
    createdAt: string;
    assumptionSetId: string;
    assumptionVersion: string;
    result: EnergyResult;
    explanation: Explanation;
  };
  caseFile: {
    id: string;
    status: CaseStatus;
    statusLabel: string;
    ownerName: string;
    oversightName: string;
    openedAt: string;
    updatedAt: string;
    delayHint: boolean;
    delayDisclaimer: string;
    actions: string[];
  };
  gates: {
    analysisSaved: boolean;
    eligibleSuggestion: boolean;
    adminConfirmed: boolean;
    customerConsent: boolean;
    assigned: boolean;
    proposalSubmitted: boolean;
  };
  assignBlockers: string[];
  suggestions: SuggestionRecord[];
  assignment: null | { id: string; installerId: string; companyName: string; assignedAt: string };
  proposals: Array<ProposalRecord & { divergenceNote: string | null }>;
  events: Array<{ id: string; type: string; label: string; at: string; note: string | null; actorName: string; actorRole: string }>;
  flags: Array<{ id: string; kind: string; note: string; createdAt: string; createdByName: string }>;
  flagCount: number;
  flagsVisible: boolean;
  consentStatement: string;
  qualityDisclaimer: string;
  banner: string;
}

function canRead(viewer: Viewer, lead: LeadRecord, installerId: string | null): boolean {
  if (viewer.role === 'admin') return true;
  if (viewer.role === 'customer') return lead.customerUserId === viewer.id;
  if (viewer.role === 'installer') return installerId != null && installerId === viewer.installerId;
  return false;
}

export function buildDossier(db: DB, viewer: Viewer, leadId: string): Dossier {
  const lead = getLead(db, leadId);
  if (!lead) throw new HttpError(404, 'Pratica non trovata.', 'not_found');
  const assignment = getAssignment(db, leadId) ?? null;
  if (!canRead(viewer, lead, assignment?.installerId ?? null)) {
    throw new HttpError(403, 'Non autorizzato a vedere questa pratica.', 'forbidden');
  }
  const caseFile = getCaseByLead(db, leadId);
  if (!caseFile) throw new HttpError(404, 'Pratica non trovata.', 'not_found');
  return assemble(db, viewer, lead, caseFile.id);
}

export function buildDossierByCase(db: DB, viewer: Viewer, caseId: string): Dossier {
  const caseFile = getCaseById(db, caseId);
  if (!caseFile) throw new HttpError(404, 'Pratica non trovata.', 'not_found');
  return buildDossier(db, viewer, caseFile.leadId);
}

export function loadCaseAccess(db: DB, viewer: Viewer, caseId: string) {
  const caseFile = getCaseById(db, caseId);
  if (!caseFile) throw new HttpError(404, 'Pratica non trovata.', 'not_found');
  const lead = getLead(db, caseFile.leadId);
  if (!lead) throw new HttpError(404, 'Pratica non trovata.', 'not_found');
  const assignment = getAssignment(db, caseFile.leadId) ?? null;
  if (!canRead(viewer, lead, assignment?.installerId ?? null)) {
    throw new HttpError(403, 'Non autorizzato a vedere questa pratica.', 'forbidden');
  }
  return { caseFile, lead, assignment };
}

function assemble(db: DB, viewer: Viewer, lead: LeadRecord, caseId: string): Dossier {
  const caseFile = getCaseById(db, caseId);
  if (!caseFile) throw new HttpError(404, 'Pratica non trovata.', 'not_found');
  const assignment = getAssignment(db, lead.id) ?? null;
  const contactVisible =
    viewer.role === 'admin' ||
    (viewer.role === 'customer' && lead.customerUserId === viewer.id) ||
    (viewer.role === 'installer' && assignment?.installerId === viewer.installerId);
  const analysis = latestAnalysis(db, lead.id) ?? null;
  const events = listEvents(db, caseFile.id);
  const suggestions = listSuggestions(db, lead.id);
  const proposals = listProposals(db, caseFile.id).map((proposal) => ({
    ...proposal,
    divergenceNote: divergence(proposal.checkedKwh, lead.annualKwh),
  }));
  const flags = listFlags(db, caseFile.id);
  const assumptions = getCurrentAssumptions(db).set;
  const lastEventAt = events.length ? events[events.length - 1].at : caseFile.openedAt;
  const owner = findUserById(db, caseFile.ownerUserId);
  const oversight = findUserById(db, caseFile.oversightUserId);
  const confirmed = suggestions.find((item) => item.status === 'admin_confirmed') ?? null;
  const visibleSuggestions =
    viewer.role === 'admin' ? suggestions : viewer.role === 'customer' && confirmed ? [confirmed] : [];
  const flagsVisible = viewer.role === 'admin' || (viewer.role === 'installer' && assignment?.installerId === viewer.installerId);
  const assignBlockers: string[] = [];
  if (!assignment) {
    if (!confirmed) assignBlockers.push('Manca la conferma dell\'operatore su un abbinamento idoneo.');
    else if (!confirmed.eligible) assignBlockers.push('L\'abbinamento confermato non è idoneo.');
    if (lead.consentStatus !== 'granted') assignBlockers.push('Manca il consenso esplicito della famiglia.');
  }

  return {
    lead: {
      id: lead.id,
      displayName: lead.displayName,
      city: lead.city,
      province: lead.province,
      propertyType: lead.propertyType,
      surfaceM2: lead.surfaceM2,
      occupants: lead.occupants,
      ev: lead.ev,
      heatPump: lead.heatPump,
      gas: lead.gas,
      annualSpendEur: lead.annualSpendEur,
      annualKwh: lead.annualKwh,
      wantsBattery: lead.wantsBattery,
      includeFiscalScenario: lead.includeFiscalScenario,
      consentStatus: lead.consentStatus,
      consentAt: lead.consentAt,
      synthetic: true,
      dataClassification: 'synthetic_demo',
      email: contactVisible ? lead.email : null,
      phone: contactVisible ? lead.phone : null,
      address: contactVisible ? lead.address : null,
      contactVisible,
    },
    analysis: analysis
      ? {
          id: analysis.id,
          createdAt: analysis.createdAt,
          assumptionSetId: analysis.assumptionSetId,
          assumptionVersion: analysis.result.assumptionVersion,
          result: analysis.result,
          explanation: analysis.explanation,
        }
      : null,
    caseFile: {
      id: caseFile.id,
      status: caseFile.status,
      statusLabel: STATUS_LABEL[caseFile.status],
      ownerName: owner?.name ?? 'Non indicato',
      oversightName: oversight?.name ?? 'Non indicato',
      openedAt: caseFile.openedAt,
      updatedAt: caseFile.updatedAt,
      delayHint: caseLooksDelayed(lastEventAt, caseFile.status, new Date(), assumptions.delayHintDays),
      delayDisclaimer: `Promemoria se l'ultimo evento supera ${assumptions.delayHintDays} giorni negli stati di attesa. Non misura la qualità del lavoro.`,
      actions: availableActions({
        role: viewer.role,
        status: caseFile.status,
        assignedToViewer: viewer.role === 'installer' && assignment?.installerId === viewer.installerId,
        customerOwns: viewer.role === 'customer' && lead.customerUserId === viewer.id,
      }),
    },
    gates: {
      analysisSaved: analysis != null,
      eligibleSuggestion: suggestions.some((item) => item.eligible),
      adminConfirmed: confirmed != null,
      customerConsent: lead.consentStatus === 'granted',
      assigned: assignment != null,
      proposalSubmitted: proposals.length > 0,
    },
    assignBlockers,
    suggestions: visibleSuggestions,
    assignment: assignment
      ? {
          id: assignment.id,
          installerId: assignment.installerId,
          companyName: assignment.companyName,
          assignedAt: assignment.assignedAt,
        }
      : null,
    proposals,
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      label: EVENT_LABEL[event.type] ?? event.type,
      at: event.at,
      note: event.note,
      actorName: event.actorName,
      actorRole: event.actorRole,
    })),
    flags: flagsVisible ? flags : [],
    flagCount: flags.length,
    flagsVisible,
    consentStatement: CONSENT_STATEMENT,
    qualityDisclaimer: QUALITY_DISCLAIMER,
    banner: STATISTICAL_BANNER,
  };
}

function divergence(checkedKwh: number | null, annualKwh: number | null): string | null {
  if (checkedKwh == null || annualKwh == null || annualKwh <= 0) return null;
  if (Math.abs(checkedKwh - annualKwh) / annualKwh > 0.15) {
    return 'Lo scarto fra il consumo annotato dall\'installatore e il dato raccolto supera il 15%. È un promemoria di possibile incoerenza, non una verifica automatica.';
  }
  return null;
}
