import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_ASSUMPTIONS, parseAssumptionPayload, type AssumptionSet } from '../domain/assumptions';
import { caseLooksDelayed, type CaseStatus } from '../domain/caseflow';
import { deterministicExplanation, type Explanation } from '../domain/explain';
import { analyzeIntake, type EnergyResult, type Intake, type PropertyType } from '../domain/energy';
import type { Role } from '../domain/roles';
import { hashPassword } from './passwords';

export type DB = DatabaseSync;

export const DEMO_PASSWORD = 'Demo-Klaryo-2026';

export const DEMO = {
  adminId: 'user_admin_demo',
  bianchiId: 'user_bianchi_demo',
  verdiId: 'user_verdi_demo',
  nordUserId: 'user_nord_demo',
  centroUserId: 'user_centro_demo',
  nordId: 'inst_nord_demo',
  centroId: 'inst_centro_demo',
  assumptionId: 'asm_ipotesi_1',
  bianchiLeadId: 'lead_bianchi_demo',
  verdiLeadId: 'lead_verdi_demo',
  bianchiCaseId: 'case_bianchi_demo',
  verdiCaseId: 'case_verdi_demo',
  bianchiAnalysisId: 'an_bianchi_demo',
  verdiAnalysisId: 'an_verdi_demo',
  adminEmail: 'alessandro.demo@klaryo.test',
  bianchiEmail: 'famiglia.bianchi@klaryo.test',
  verdiEmail: 'famiglia.verdi@klaryo.test',
  nordEmail: 'nord.demo@klaryo.test',
  centroEmail: 'centro.demo@klaryo.test',
} as const;

const SCHEMA = `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','installer','customer')),
  installer_id TEXT,
  synthetic INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE assumption_sets (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  source_note TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id)
);
CREATE TABLE installers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  company_name TEXT NOT NULL,
  provinces_json TEXT NOT NULL,
  services_json TEXT NOT NULL,
  active INTEGER NOT NULL,
  notes TEXT NOT NULL,
  synthetic INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  customer_user_id TEXT NOT NULL REFERENCES users(id),
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  city TEXT,
  province TEXT,
  property_type TEXT,
  surface_m2 REAL,
  occupants INTEGER,
  ev INTEGER NOT NULL,
  heat_pump INTEGER NOT NULL,
  gas INTEGER NOT NULL,
  annual_spend_eur REAL,
  annual_kwh REAL,
  wants_battery INTEGER NOT NULL,
  include_fiscal_scenario INTEGER NOT NULL,
  consent_status TEXT NOT NULL,
  consent_at TEXT,
  consent_text TEXT,
  synthetic INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE analyses (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  assumption_set_id TEXT NOT NULL REFERENCES assumption_sets(id),
  result_json TEXT NOT NULL,
  explanation_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE cases (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL UNIQUE REFERENCES leads(id),
  status TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  oversight_user_id TEXT NOT NULL REFERENCES users(id),
  opened_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE case_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  type TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  at TEXT NOT NULL,
  note TEXT
);
CREATE TABLE match_suggestions (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  installer_id TEXT NOT NULL REFERENCES installers(id),
  score INTEGER NOT NULL,
  eligible INTEGER NOT NULL,
  reasons_json TEXT NOT NULL,
  status TEXT NOT NULL,
  admin_user_id TEXT REFERENCES users(id),
  admin_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE assignments (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL UNIQUE REFERENCES leads(id),
  installer_id TEXT NOT NULL REFERENCES installers(id),
  match_id TEXT NOT NULL REFERENCES match_suggestions(id),
  assigned_by TEXT NOT NULL REFERENCES users(id),
  assigned_at TEXT NOT NULL
);
CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  installer_id TEXT NOT NULL REFERENCES installers(id),
  technical_notes TEXT NOT NULL,
  economic_notes TEXT NOT NULL,
  checked_kwh REAL,
  checked_spend_eur REAL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE quality_flags (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  kind TEXT NOT NULL,
  note TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
`;

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: Role;
  installerId: string | null;
  passwordHash: string;
}

export interface LeadRecord {
  id: string;
  customerUserId: string;
  displayName: string;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
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
  consentStatus: 'none' | 'granted' | 'revoked';
  consentAt: string | null;
  consentText: string | null;
  createdAt: string;
}

export interface AnalysisRecord {
  id: string;
  leadId: string;
  assumptionSetId: string;
  result: EnergyResult;
  explanation: Explanation;
  createdAt: string;
  createdBy: string;
}

export interface CaseRecord {
  id: string;
  leadId: string;
  status: CaseStatus;
  ownerUserId: string;
  oversightUserId: string;
  openedAt: string;
  updatedAt: string;
}

export interface AssignmentRecord {
  id: string;
  leadId: string;
  installerId: string;
  matchId: string;
  assignedBy: string;
  assignedAt: string;
  companyName: string;
}

export interface SuggestionRecord {
  id: string;
  leadId: string;
  installerId: string;
  companyName: string;
  score: number;
  eligible: boolean;
  reasons: string[];
  status: string;
  adminAt: string | null;
}

export interface InstallerRecord {
  id: string;
  userId: string;
  companyName: string;
  provinces: string[];
  services: string[];
  active: boolean;
  notes: string;
  userName: string;
  email: string;
}

export interface EventRecord {
  id: string;
  caseId: string;
  type: string;
  actorUserId: string;
  actorName: string;
  actorRole: Role;
  at: string;
  note: string | null;
}

export interface ProposalRecord {
  id: string;
  caseId: string;
  installerId: string;
  technicalNotes: string;
  economicNotes: string;
  checkedKwh: number | null;
  checkedSpendEur: number | null;
  summary: string;
  createdAt: string;
}

export interface FlagRecord {
  id: string;
  caseId: string;
  kind: string;
  note: string;
  createdAt: string;
  createdByName: string;
}

export interface LeadSummary {
  id: string;
  displayName: string;
  city: string | null;
  province: string | null;
  caseId: string;
  caseStatus: CaseStatus;
  consentStatus: string;
  ownerName: string;
  updatedAt: string;
  lastEventAt: string;
  delayHint: boolean;
  synthetic: true;
}

type SqlRow = Record<string, unknown>;
type SqlParam = string | number | bigint | NodeJS.ArrayBufferView | null;

function all<T>(db: DB, sql: string, ...params: SqlParam[]): T[] {
  return db.prepare(sql).all(...params).map((row) => ({ ...(row as object) })) as T[];
}

function get<T>(db: DB, sql: string, ...params: SqlParam[]): T | undefined {
  const row = db.prepare(sql).get(...params);
  return row ? ({ ...(row as object) } as T) : undefined;
}

function run(db: DB, sql: string, ...params: SqlParam[]): void {
  db.prepare(sql).run(...params);
}

function bool(value: unknown): boolean {
  return Number(value) === 1;
}

function num(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function openDatabase(filename: string): DB {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON');
  if (filename !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  return db;
}

export function migrate(db: DB): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = get<SqlRow>(db, "SELECT id FROM schema_migrations WHERE id = '001'");
  if (done) return;
  db.exec('BEGIN');
  try {
    db.exec(SCHEMA);
    run(db, 'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', '001', new Date().toISOString());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function mapUser(row: SqlRow): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role: row.role as Role,
    installerId: row.installer_id == null ? null : String(row.installer_id),
    passwordHash: String(row.password_hash),
  };
}

function mapLead(row: SqlRow): LeadRecord {
  return {
    id: String(row.id),
    customerUserId: String(row.customer_user_id),
    displayName: String(row.display_name),
    email: String(row.email),
    phone: row.phone == null ? null : String(row.phone),
    address: row.address == null ? null : String(row.address),
    city: row.city == null ? null : String(row.city),
    province: row.province == null ? null : String(row.province),
    propertyType: (row.property_type as PropertyType | null) ?? null,
    surfaceM2: num(row.surface_m2),
    occupants: num(row.occupants),
    ev: bool(row.ev),
    heatPump: bool(row.heat_pump),
    gas: bool(row.gas),
    annualSpendEur: num(row.annual_spend_eur),
    annualKwh: num(row.annual_kwh),
    wantsBattery: bool(row.wants_battery),
    includeFiscalScenario: bool(row.include_fiscal_scenario),
    consentStatus: row.consent_status as LeadRecord['consentStatus'],
    consentAt: row.consent_at == null ? null : String(row.consent_at),
    consentText: row.consent_text == null ? null : String(row.consent_text),
    createdAt: String(row.created_at),
  };
}

export function intakeFromLead(lead: LeadRecord): Intake {
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

export function findUserByEmail(db: DB, email: string): UserRecord | undefined {
  const row = get<SqlRow>(db, 'SELECT * FROM users WHERE email = ?', email.trim().toLowerCase());
  return row ? mapUser(row) : undefined;
}

export function findUserById(db: DB, id: string): UserRecord | undefined {
  const row = get<SqlRow>(db, 'SELECT * FROM users WHERE id = ?', id);
  return row ? mapUser(row) : undefined;
}

export function createSession(db: DB, userId: string): string {
  const id = randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
  run(db, 'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)', id, userId, expires, now.toISOString());
  return id;
}

export function deleteSession(db: DB, id: string): void {
  run(db, 'DELETE FROM sessions WHERE id = ?', id);
}

export function userForSession(db: DB, sessionId: string): UserRecord | undefined {
  const row = get<SqlRow>(
    db,
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
    sessionId,
    new Date().toISOString(),
  );
  if (!row) {
    run(db, 'DELETE FROM sessions WHERE id = ?', sessionId);
    return undefined;
  }
  return mapUser(row);
}

export function getCurrentAssumptions(db: DB): { id: string; set: AssumptionSet } {
  const row = get<SqlRow>(db, 'SELECT * FROM assumption_sets ORDER BY created_at DESC LIMIT 1');
  if (!row) throw new Error('Nessuna versione di ipotesi nel database.');
  const set = parseAssumptionPayload(JSON.parse(String(row.payload_json)));
  return { id: String(row.id), set };
}

export function listAssumptionVersions(db: DB): Array<{ id: string; version: string; label: string; createdAt: string }> {
  return all<SqlRow>(db, 'SELECT id, version, label, created_at FROM assumption_sets ORDER BY created_at DESC').map((row) => ({
    id: String(row.id),
    version: String(row.version),
    label: String(row.label),
    createdAt: String(row.created_at),
  }));
}

export function insertAssumptionSet(db: DB, set: AssumptionSet, userId: string): string {
  const id = `asm_${randomUUID()}`;
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO assumption_sets (id, version, label, source_note, payload_json, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    set.version,
    set.label,
    set.sourceNote,
    JSON.stringify(set),
    now,
    userId,
  );
  return id;
}

export function listInstallers(db: DB): InstallerRecord[] {
  return all<SqlRow>(
    db,
    `SELECT i.*, u.name AS user_name, u.email AS email
     FROM installers i JOIN users u ON u.id = i.user_id ORDER BY i.company_name`,
  ).map(mapInstaller);
}

export function getInstaller(db: DB, id: string): InstallerRecord | undefined {
  const row = get<SqlRow>(
    db,
    `SELECT i.*, u.name AS user_name, u.email AS email
     FROM installers i JOIN users u ON u.id = i.user_id WHERE i.id = ?`,
    id,
  );
  return row ? mapInstaller(row) : undefined;
}

function mapInstaller(row: SqlRow): InstallerRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    companyName: String(row.company_name),
    provinces: JSON.parse(String(row.provinces_json)) as string[],
    services: JSON.parse(String(row.services_json)) as string[],
    active: bool(row.active),
    notes: String(row.notes),
    userName: String(row.user_name),
    email: String(row.email),
  };
}

export function updateInstaller(db: DB, id: string, provinces: string[], services: string[]): void {
  run(
    db,
    'UPDATE installers SET provinces_json = ?, services_json = ? WHERE id = ?',
    JSON.stringify(provinces),
    JSON.stringify(services),
    id,
  );
}

export function getLead(db: DB, id: string): LeadRecord | undefined {
  const row = get<SqlRow>(db, 'SELECT * FROM leads WHERE id = ?', id);
  return row ? mapLead(row) : undefined;
}

export function listLeadSummaries(db: DB, viewer: { id: string; role: Role; installerId: string | null }): LeadSummary[] {
  const params: SqlParam[] = [];
  let filter = '';
  if (viewer.role === 'customer') {
    filter = 'WHERE l.customer_user_id = ?';
    params.push(viewer.id);
  } else if (viewer.role === 'installer') {
    filter = 'WHERE a.installer_id = ?';
    params.push(viewer.installerId ?? '');
  }
  const days = getCurrentAssumptions(db).set.delayHintDays;
  const rows = all<SqlRow>(
    db,
    `SELECT l.id, l.display_name, l.city, l.province, l.consent_status,
            c.id AS case_id, c.status AS case_status, c.updated_at, u.name AS owner_name,
            (SELECT e.at FROM case_events e WHERE e.case_id = c.id ORDER BY e.at DESC LIMIT 1) AS last_event_at
     FROM leads l
     JOIN cases c ON c.lead_id = l.id
     JOIN users u ON u.id = c.owner_user_id
     LEFT JOIN assignments a ON a.lead_id = l.id
     ${filter}
     ORDER BY c.updated_at DESC`,
    ...params,
  );
  return rows.map((row) => ({
    id: String(row.id),
    displayName: String(row.display_name),
    city: row.city == null ? null : String(row.city),
    province: row.province == null ? null : String(row.province),
    caseId: String(row.case_id),
    caseStatus: row.case_status as CaseStatus,
    consentStatus: String(row.consent_status),
    ownerName: String(row.owner_name),
    updatedAt: String(row.updated_at),
    lastEventAt: String(row.last_event_at ?? row.updated_at),
    delayHint: caseLooksDelayed(String(row.last_event_at ?? row.updated_at), row.case_status as CaseStatus, new Date(), days),
    synthetic: true as const,
  }));
}

export interface NewLeadInput {
  customerUserId: string;
  displayName: string;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  intake: Intake;
  oversightUserId: string;
  assumptionSetId: string;
  result: EnergyResult;
  explanation: Explanation;
}

export function insertLeadBundle(db: DB, input: NewLeadInput): { leadId: string; caseId: string; analysisId: string } {
  const now = new Date().toISOString();
  const leadId = `lead_${randomUUID()}`;
  const caseId = `case_${randomUUID()}`;
  const analysisId = `an_${randomUUID()}`;
  const eventId = `ev_${randomUUID()}`;
  db.exec('BEGIN');
  try {
    run(
      db,
      `INSERT INTO leads (
        id, customer_user_id, display_name, email, phone, address, city, province, property_type,
        surface_m2, occupants, ev, heat_pump, gas, annual_spend_eur, annual_kwh, wants_battery,
        include_fiscal_scenario, consent_status, consent_at, consent_text, synthetic, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', NULL, NULL, 1, ?)`,
      leadId,
      input.customerUserId,
      input.displayName,
      input.email,
      input.phone,
      input.address,
      input.city,
      input.province,
      input.intake.propertyType,
      input.intake.surfaceM2,
      input.intake.occupants,
      input.intake.ev ? 1 : 0,
      input.intake.heatPump ? 1 : 0,
      input.intake.gas ? 1 : 0,
      input.intake.annualSpendEur,
      input.intake.annualKwh,
      input.intake.wantsBattery ? 1 : 0,
      input.intake.includeFiscalScenario ? 1 : 0,
      now,
    );
    run(
      db,
      `INSERT INTO analyses (id, lead_id, assumption_set_id, result_json, explanation_json, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      analysisId,
      leadId,
      input.assumptionSetId,
      JSON.stringify(input.result),
      JSON.stringify(input.explanation),
      now,
      input.customerUserId,
    );
    run(
      db,
      `INSERT INTO cases (id, lead_id, status, owner_user_id, oversight_user_id, opened_at, updated_at)
       VALUES (?, ?, 'analisi_iniziale', ?, ?, ?, ?)`,
      caseId,
      leadId,
      input.oversightUserId,
      input.oversightUserId,
      now,
      now,
    );
    run(
      db,
      `INSERT INTO case_events (id, case_id, type, actor_user_id, at, note) VALUES (?, ?, 'analisi_iniziale', ?, ?, ?)`,
      eventId,
      caseId,
      input.customerUserId,
      now,
      'Analisi orientativa salvata dal percorso di raccolta. Non è un preventivo tecnico.',
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { leadId, caseId, analysisId };
}

export function latestAnalysis(db: DB, leadId: string): AnalysisRecord | undefined {
  const row = get<SqlRow>(
    db,
    'SELECT * FROM analyses WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1',
    leadId,
  );
  if (!row) return undefined;
  return {
    id: String(row.id),
    leadId: String(row.lead_id),
    assumptionSetId: String(row.assumption_set_id),
    result: JSON.parse(String(row.result_json)) as EnergyResult,
    explanation: JSON.parse(String(row.explanation_json)) as Explanation,
    createdAt: String(row.created_at),
    createdBy: String(row.created_by),
  };
}

export function getCaseByLead(db: DB, leadId: string): CaseRecord | undefined {
  const row = get<SqlRow>(db, 'SELECT * FROM cases WHERE lead_id = ?', leadId);
  return row ? mapCase(row) : undefined;
}

export function getCaseById(db: DB, id: string): CaseRecord | undefined {
  const row = get<SqlRow>(db, 'SELECT * FROM cases WHERE id = ?', id);
  return row ? mapCase(row) : undefined;
}

function mapCase(row: SqlRow): CaseRecord {
  return {
    id: String(row.id),
    leadId: String(row.lead_id),
    status: row.status as CaseStatus,
    ownerUserId: String(row.owner_user_id),
    oversightUserId: String(row.oversight_user_id),
    openedAt: String(row.opened_at),
    updatedAt: String(row.updated_at),
  };
}

export function updateCase(db: DB, caseId: string, status: CaseStatus, ownerUserId: string): void {
  const now = new Date().toISOString();
  run(db, 'UPDATE cases SET status = ?, owner_user_id = ?, updated_at = ? WHERE id = ?', status, ownerUserId, now, caseId);
}

export function addEvent(db: DB, caseId: string, type: string, actorUserId: string, note: string | null): EventRecord {
  const now = new Date().toISOString();
  const id = `ev_${randomUUID()}`;
  run(
    db,
    'INSERT INTO case_events (id, case_id, type, actor_user_id, at, note) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    caseId,
    type,
    actorUserId,
    now,
    note,
  );
  run(db, 'UPDATE cases SET updated_at = ? WHERE id = ?', now, caseId);
  const actor = findUserById(db, actorUserId);
  return {
    id,
    caseId,
    type,
    actorUserId,
    actorName: actor?.name ?? 'Utente',
    actorRole: actor?.role ?? 'customer',
    at: now,
    note,
  };
}

export function listEvents(db: DB, caseId: string): EventRecord[] {
  return all<SqlRow>(
    db,
    `SELECT e.*, u.name AS actor_name, u.role AS actor_role
     FROM case_events e JOIN users u ON u.id = e.actor_user_id
     WHERE e.case_id = ? ORDER BY e.at ASC, e.id ASC`,
    caseId,
  ).map((row) => ({
    id: String(row.id),
    caseId: String(row.case_id),
    type: String(row.type),
    actorUserId: String(row.actor_user_id),
    actorName: String(row.actor_name),
    actorRole: row.actor_role as Role,
    at: String(row.at),
    note: row.note == null ? null : String(row.note),
  }));
}

export function replaceSuggestions(
  db: DB,
  leadId: string,
  items: Array<{ installerId: string; score: number; eligible: boolean; reasons: string[] }>,
): void {
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    run(db, 'DELETE FROM match_suggestions WHERE lead_id = ?', leadId);
    for (const item of items) {
      run(
        db,
        `INSERT INTO match_suggestions
          (id, lead_id, installer_id, score, eligible, reasons_json, status, admin_user_id, admin_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'proposed', NULL, NULL, ?)`,
        `match_${randomUUID()}`,
        leadId,
        item.installerId,
        item.score,
        item.eligible ? 1 : 0,
        JSON.stringify(item.reasons),
        now,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function listSuggestions(db: DB, leadId: string): SuggestionRecord[] {
  return all<SqlRow>(
    db,
    `SELECT m.*, i.company_name FROM match_suggestions m
     JOIN installers i ON i.id = m.installer_id
     WHERE m.lead_id = ? ORDER BY m.eligible DESC, m.score DESC, i.company_name ASC`,
    leadId,
  ).map((row) => ({
    id: String(row.id),
    leadId: String(row.lead_id),
    installerId: String(row.installer_id),
    companyName: String(row.company_name),
    score: Number(row.score),
    eligible: bool(row.eligible),
    reasons: JSON.parse(String(row.reasons_json)) as string[],
    status: String(row.status),
    adminAt: row.admin_at == null ? null : String(row.admin_at),
  }));
}

export function getSuggestion(db: DB, id: string): SuggestionRecord | undefined {
  const row = get<SqlRow>(
    db,
    `SELECT m.*, i.company_name FROM match_suggestions m JOIN installers i ON i.id = m.installer_id WHERE m.id = ?`,
    id,
  );
  if (!row) return undefined;
  return {
    id: String(row.id),
    leadId: String(row.lead_id),
    installerId: String(row.installer_id),
    companyName: String(row.company_name),
    score: Number(row.score),
    eligible: bool(row.eligible),
    reasons: JSON.parse(String(row.reasons_json)) as string[],
    status: String(row.status),
    adminAt: row.admin_at == null ? null : String(row.admin_at),
  };
}

export function confirmSuggestion(db: DB, suggestion: SuggestionRecord, adminUserId: string): void {
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    run(db, `UPDATE match_suggestions SET status = 'rejected' WHERE lead_id = ? AND id != ?`, suggestion.leadId, suggestion.id);
    run(
      db,
      `UPDATE match_suggestions SET status = 'admin_confirmed', admin_user_id = ?, admin_at = ? WHERE id = ?`,
      adminUserId,
      now,
      suggestion.id,
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function setConsent(db: DB, leadId: string, status: 'granted' | 'revoked', text: string | null): void {
  const now = new Date().toISOString();
  run(
    db,
    'UPDATE leads SET consent_status = ?, consent_at = ?, consent_text = ? WHERE id = ?',
    status,
    now,
    text,
    leadId,
  );
}

export function getAssignment(db: DB, leadId: string): AssignmentRecord | undefined {
  const row = get<SqlRow>(
    db,
    `SELECT a.*, i.company_name FROM assignments a JOIN installers i ON i.id = a.installer_id WHERE a.lead_id = ?`,
    leadId,
  );
  if (!row) return undefined;
  return {
    id: String(row.id),
    leadId: String(row.lead_id),
    installerId: String(row.installer_id),
    matchId: String(row.match_id),
    assignedBy: String(row.assigned_by),
    assignedAt: String(row.assigned_at),
    companyName: String(row.company_name),
  };
}

export function createAssignment(db: DB, leadId: string, installerId: string, matchId: string, assignedBy: string): AssignmentRecord {
  const now = new Date().toISOString();
  const id = `asg_${randomUUID()}`;
  run(
    db,
    `INSERT INTO assignments (id, lead_id, installer_id, match_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    leadId,
    installerId,
    matchId,
    assignedBy,
    now,
  );
  const created = getAssignment(db, leadId);
  if (!created) throw new Error('Assegnazione non rileggibile.');
  return created;
}

export function addProposal(
  db: DB,
  input: {
    caseId: string;
    installerId: string;
    technicalNotes: string;
    economicNotes: string;
    checkedKwh: number | null;
    checkedSpendEur: number | null;
    summary: string;
    createdBy: string;
  },
): ProposalRecord {
  const now = new Date().toISOString();
  const id = `prop_${randomUUID()}`;
  run(
    db,
    `INSERT INTO proposals
      (id, case_id, installer_id, technical_notes, economic_notes, checked_kwh, checked_spend_eur, summary, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.caseId,
    input.installerId,
    input.technicalNotes,
    input.economicNotes,
    input.checkedKwh,
    input.checkedSpendEur,
    input.summary,
    now,
    input.createdBy,
  );
  return {
    id,
    caseId: input.caseId,
    installerId: input.installerId,
    technicalNotes: input.technicalNotes,
    economicNotes: input.economicNotes,
    checkedKwh: input.checkedKwh,
    checkedSpendEur: input.checkedSpendEur,
    summary: input.summary,
    createdAt: now,
  };
}

export function listProposals(db: DB, caseId: string): ProposalRecord[] {
  return all<SqlRow>(db, 'SELECT * FROM proposals WHERE case_id = ? ORDER BY created_at ASC', caseId).map((row) => ({
    id: String(row.id),
    caseId: String(row.case_id),
    installerId: String(row.installer_id),
    technicalNotes: String(row.technical_notes),
    economicNotes: String(row.economic_notes),
    checkedKwh: num(row.checked_kwh),
    checkedSpendEur: num(row.checked_spend_eur),
    summary: String(row.summary),
    createdAt: String(row.created_at),
  }));
}

export function addFlag(db: DB, caseId: string, kind: string, note: string, createdBy: string): void {
  run(
    db,
    'INSERT INTO quality_flags (id, case_id, kind, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    `flag_${randomUUID()}`,
    caseId,
    kind,
    note,
    createdBy,
    new Date().toISOString(),
  );
}

export function listFlags(db: DB, caseId: string): FlagRecord[] {
  return all<SqlRow>(
    db,
    `SELECT f.*, u.name AS created_by_name FROM quality_flags f JOIN users u ON u.id = f.created_by
     WHERE f.case_id = ? ORDER BY f.created_at ASC`,
    caseId,
  ).map((row) => ({
    id: String(row.id),
    caseId: String(row.case_id),
    kind: String(row.kind),
    note: String(row.note),
    createdAt: String(row.created_at),
    createdByName: String(row.created_by_name),
  }));
}

export function firstAdminId(db: DB): string {
  const row = get<SqlRow>(db, "SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1");
  if (!row) throw new Error('Nessun operatore amministratore nel database.');
  return String(row.id);
}

function insertUser(db: DB, id: string, email: string, name: string, role: Role, passwordHash: string, at: string): void {
  run(
    db,
    `INSERT INTO users (id, email, name, password_hash, role, installer_id, synthetic, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, 1, ?)`,
    id,
    email,
    name,
    passwordHash,
    role,
    at,
  );
}

function insertDemoLead(
  db: DB,
  input: {
    leadId: string;
    caseId: string;
    analysisId: string;
    customerUserId: string;
    displayName: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    province: string;
    intake: Intake;
    at: string;
  },
  assumption: { id: string; set: AssumptionSet },
  adminId: string,
): void {
  const result = analyzeIntake(input.intake, assumption.set);
  const explanation = deterministicExplanation(result, assumption.set);
  const explanationObject: Explanation = {
    mode: 'not_configured',
    text: explanation,
    note: 'Nessun provider AI configurato: testo deterministico sui soli numeri calcolati.',
  };
  run(
    db,
    `INSERT INTO leads (
      id, customer_user_id, display_name, email, phone, address, city, province, property_type,
      surface_m2, occupants, ev, heat_pump, gas, annual_spend_eur, annual_kwh, wants_battery,
      include_fiscal_scenario, consent_status, consent_at, consent_text, synthetic, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', NULL, NULL, 1, ?)`,
    input.leadId,
    input.customerUserId,
    input.displayName,
    input.email,
    input.phone,
    input.address,
    input.city,
    input.province,
    input.intake.propertyType,
    input.intake.surfaceM2,
    input.intake.occupants,
    input.intake.ev ? 1 : 0,
    input.intake.heatPump ? 1 : 0,
    input.intake.gas ? 1 : 0,
    input.intake.annualSpendEur,
    input.intake.annualKwh,
    input.intake.wantsBattery ? 1 : 0,
    input.intake.includeFiscalScenario ? 1 : 0,
    input.at,
  );
  run(
    db,
    `INSERT INTO analyses (id, lead_id, assumption_set_id, result_json, explanation_json, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    input.analysisId,
    input.leadId,
    assumption.id,
    JSON.stringify(result),
    JSON.stringify(explanationObject),
    input.at,
    input.customerUserId,
  );
  run(
    db,
    `INSERT INTO cases (id, lead_id, status, owner_user_id, oversight_user_id, opened_at, updated_at)
     VALUES (?, ?, 'analisi_iniziale', ?, ?, ?, ?)`,
    input.caseId,
    input.leadId,
    adminId,
    adminId,
    input.at,
    input.at,
  );
  run(
    db,
    `INSERT INTO case_events (id, case_id, type, actor_user_id, at, note) VALUES (?, ?, 'analisi_iniziale', ?, ?, ?)`,
    `ev_${input.leadId}`,
    input.caseId,
    input.customerUserId,
    input.at,
    'Pratica sintetica di dimostrazione. Analisi orientativa iniziale, senza consenso alla condivisione.',
  );
}

export function seed(db: DB): void {
  const existing = get<SqlRow>(db, 'SELECT COUNT(*) AS c FROM users');
  if (existing && Number(existing.c) > 0) return;
  const now = new Date().toISOString();
  const passwordHash = hashPassword(DEMO_PASSWORD);
  db.exec('BEGIN');
  try {
    insertUser(db, DEMO.adminId, DEMO.adminEmail, 'Alessandro Demo (sintetico)', 'admin', passwordHash, now);
    insertUser(db, DEMO.bianchiId, DEMO.bianchiEmail, 'Famiglia Bianchi (sintetica)', 'customer', passwordHash, now);
    insertUser(db, DEMO.verdiId, DEMO.verdiEmail, 'Famiglia Verdi (sintetica)', 'customer', passwordHash, now);
    insertUser(db, DEMO.nordUserId, DEMO.nordEmail, 'Referente Nord Demo', 'installer', passwordHash, now);
    insertUser(db, DEMO.centroUserId, DEMO.centroEmail, 'Referente Centro Demo', 'installer', passwordHash, now);
    const assumptions = { ...DEFAULT_ASSUMPTIONS };
    run(
      db,
      `INSERT INTO assumption_sets (id, version, label, source_note, payload_json, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      DEMO.assumptionId,
      assumptions.version,
      assumptions.label,
      assumptions.sourceNote,
      JSON.stringify(assumptions),
      now,
      DEMO.adminId,
    );
    run(
      db,
      `INSERT INTO installers (id, user_id, company_name, provinces_json, services_json, active, notes, synthetic)
       VALUES (?, ?, ?, ?, ?, 1, ?, 1)`,
      DEMO.nordId,
      DEMO.nordUserId,
      'Nord Demo Impianti Srl',
      JSON.stringify(['MI', 'MB', 'VA']),
      JSON.stringify(['fotovoltaico', 'batteria']),
      'Anagrafica sintetica. Nessuna impresa reale.',
    );
    run(
      db,
      `INSERT INTO installers (id, user_id, company_name, provinces_json, services_json, active, notes, synthetic)
       VALUES (?, ?, ?, ?, ?, 1, ?, 1)`,
      DEMO.centroId,
      DEMO.centroUserId,
      'Centro Demo Energia Srl',
      JSON.stringify(['FI', 'PO']),
      JSON.stringify(['fotovoltaico', 'pompa_di_calore']),
      'Anagrafica sintetica. Nessuna impresa reale.',
    );
    run(db, 'UPDATE users SET installer_id = ? WHERE id = ?', DEMO.nordId, DEMO.nordUserId);
    run(db, 'UPDATE users SET installer_id = ? WHERE id = ?', DEMO.centroId, DEMO.centroUserId);
    const assumption = { id: DEMO.assumptionId, set: assumptions };
    insertDemoLead(
      db,
      {
        leadId: DEMO.bianchiLeadId,
        caseId: DEMO.bianchiCaseId,
        analysisId: DEMO.bianchiAnalysisId,
        customerUserId: DEMO.bianchiId,
        displayName: 'Famiglia Bianchi (sintetica)',
        email: DEMO.bianchiEmail,
        phone: '333 000 1101',
        address: 'Via Esempio 1',
        city: 'Milano',
        province: 'MI',
        at: now,
        intake: {
          annualKwh: 3500,
          annualSpendEur: 1800,
          wantsBattery: false,
          includeFiscalScenario: false,
          propertyType: 'villa',
          surfaceM2: 140,
          occupants: 3,
          ev: false,
          heatPump: false,
          gas: true,
          province: 'MI',
        },
      },
      assumption,
      DEMO.adminId,
    );
    insertDemoLead(
      db,
      {
        leadId: DEMO.verdiLeadId,
        caseId: DEMO.verdiCaseId,
        analysisId: DEMO.verdiAnalysisId,
        customerUserId: DEMO.verdiId,
        displayName: 'Famiglia Verdi (sintetica)',
        email: DEMO.verdiEmail,
        phone: '333 000 1102',
        address: 'Via Campione 12',
        city: 'Firenze',
        province: 'FI',
        at: now,
        intake: {
          annualKwh: null,
          annualSpendEur: 960,
          wantsBattery: false,
          includeFiscalScenario: false,
          propertyType: 'appartamento',
          surfaceM2: 75,
          occupants: 2,
          ev: false,
          heatPump: true,
          gas: false,
          province: 'FI',
        },
      },
      assumption,
      DEMO.adminId,
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
