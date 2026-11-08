import type { EnergyResult } from '../domain/energy';
import type { Explanation } from '../domain/explain';
import type { AssumptionSet } from '../domain/assumptions';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'installer' | 'customer';
  installerId: string | null;
  synthetic: true;
}

export interface LeadSummary {
  id: string;
  displayName: string;
  city: string | null;
  province: string | null;
  caseId: string;
  caseStatus: string;
  consentStatus: string;
  ownerName: string;
  updatedAt: string;
  delayHint: boolean;
  synthetic: true;
}

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
    email: string | null;
    phone: string | null;
    address: string | null;
    contactVisible: boolean;
    dataClassification: string;
  };
  analysis: null | {
    id: string;
    createdAt: string;
    assumptionVersion: string;
    result: EnergyResult;
    explanation: Explanation;
  };
  caseFile: {
    id: string;
    status: string;
    statusLabel: string;
    ownerName: string;
    oversightName: string;
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
  suggestions: Array<{
    id: string;
    companyName: string;
    score: number;
    eligible: boolean;
    reasons: string[];
    status: string;
  }>;
  assignment: null | { companyName: string; assignedAt: string };
  proposals: Array<{
    id: string;
    summary: string;
    technicalNotes: string;
    economicNotes: string;
    checkedKwh: number | null;
    checkedSpendEur: number | null;
    createdAt: string;
    divergenceNote: string | null;
  }>;
  events: Array<{ id: string; type: string; label: string; at: string; note: string | null; actorName: string; actorRole: string }>;
  flags: Array<{ id: string; kind: string; note: string; createdAt: string; createdByName: string }>;
  flagCount: number;
  flagsVisible: boolean;
  consentStatement: string;
  qualityDisclaimer: string;
  banner: string;
}

export interface InstallerCard {
  id: string;
  companyName: string;
  provinces: string[];
  services: string[];
  active: boolean;
  notes: string;
  contactName: string | null;
  email: string | null;
  synthetic: true;
}

export interface AssumptionResponse {
  id: string;
  assumptions: AssumptionSet;
  versions: Array<{ id: string; version: string; label: string; createdAt: string }>;
}
