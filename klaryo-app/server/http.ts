import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ZodError, z } from 'zod';
import { parseAssumptionPayload, type AssumptionSet } from '../domain/assumptions';
import { assertEventAllowed, statusAfter } from '../domain/caseflow';
import { CONSENT_STATEMENT, QUALITY_DISCLAIMER } from '../domain/copy';
import { buildExplanation, type AiEnv } from '../domain/explain';
import type { Intake, PropertyType } from '../domain/energy';
import { analyzeIntake } from '../domain/energy';
import { suggestMatches } from '../domain/matching';
import type { Viewer } from '../domain/roles';
import { buildDossier, buildDossierByCase, loadCaseAccess } from './dossier';
import {
  addEvent,
  addFlag,
  addProposal,
  confirmSuggestion,
  createAssignment,
  createSession,
  deleteSession,
  DEMO,
  findUserByEmail,
  firstAdminId,
  getAssignment,
  getCurrentAssumptions,
  getInstaller,
  getLead,
  getSuggestion,
  insertAssumptionSet,
  listSuggestions,
  insertLeadBundle,
  latestAnalysis,
  listAssumptionVersions,
  listInstallers,
  listLeadSummaries,
  migrate,
  replaceSuggestions,
  seed,
  setConsent,
  updateCase,
  updateInstaller,
  userForSession,
  type DB,
  type UserRecord,
} from './db';
import { HttpError } from './errors';
import { verifyPassword } from './passwords';

type AuthedRequest = Request & { user?: UserRecord };

const LoginBody = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

const LeadBody = z.object({
  displayName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  province: z.string().trim().max(8).nullable().optional(),
  propertyType: z.enum(['appartamento', 'villa', 'bifamiliare']).nullable().optional(),
  surfaceM2: z.number().positive().max(2000).nullable().optional(),
  occupants: z.number().int().min(1).max(20).nullable().optional(),
  ev: z.boolean(),
  heatPump: z.boolean(),
  gas: z.boolean(),
  annualSpendEur: z.number().positive().max(1_000_000).nullable().optional(),
  annualKwh: z.number().positive().max(1_000_000).nullable().optional(),
  wantsBattery: z.boolean(),
  includeFiscalScenario: z.boolean(),
});

const InstallerBody = z.object({
  provinces: z.array(z.string().trim().regex(/^[A-Za-z]{2}$/)).max(30),
  services: z.array(z.enum(['fotovoltaico', 'batteria', 'pompa_di_calore'])).max(3),
});

const NoteBody = z.object({ note: z.string().trim().min(3).max(2000) });

const FlagBody = z.object({
  kind: z.enum(['ritardo', 'incoerenza', 'reclamo']),
  note: z.string().trim().min(3).max(2000),
});

const ProposalBody = z.object({
  technicalNotes: z.string().trim().min(10).max(4000),
  economicNotes: z.string().trim().min(10).max(4000),
  summary: z.string().trim().min(20).max(4000),
  checkedKwh: z.number().positive().max(1_000_000).nullable().optional(),
  checkedSpendEur: z.number().positive().max(1_000_000).nullable().optional(),
});

const ConsentBody = z.object({
  granted: z.boolean(),
  acceptedStatement: z.string().optional(),
});

const AssignBody = z.object({ matchId: z.string().min(3).max(80) });

function textOrNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function publicUser(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    installerId: user.installerId,
    synthetic: true as const,
  };
}

function viewerOf(user: UserRecord): Viewer {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    installerId: user.installerId,
  };
}

function requireUser(req: AuthedRequest): UserRecord {
  if (!req.user) throw new HttpError(401, 'Accesso richiesto.', 'auth_required');
  return req.user;
}

function requireRole(user: UserRecord, roles: Array<UserRecord['role']>): void {
  if (!roles.includes(user.role)) throw new HttpError(403, 'Non autorizzato per questo ruolo.', 'forbidden_role');
}

const DEMO_PICK_EMAILS = new Set<string>([
  DEMO.adminEmail,
  DEMO.bianchiEmail,
  DEMO.verdiEmail,
  DEMO.nordEmail,
  DEMO.centroEmail,
]);

export function createReadyApp(db: DB, options?: { distDir?: string; aiEnv?: AiEnv; allowDemoPick?: boolean }) {
  migrate(db);
  seed(db);
  const allowDemoPick = options?.allowDemoPick === true;
  const aiEnv: AiEnv = options?.aiEnv ?? {
    apiKey: process.env.KLARYO_AI_API_KEY,
    baseUrl: process.env.KLARYO_AI_BASE_URL,
    model: process.env.KLARYO_AI_MODEL,
  };
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use(express.json({ limit: '32kb' }));

  const router = express.Router();
  router.use((req: AuthedRequest, _res, next) => {
    const sessionId = readCookie(req, 'klaryo_session');
    req.user = sessionId ? userForSession(db, sessionId) : undefined;
    next();
  });

  const wrap =
    (fn: (req: AuthedRequest, res: Response) => Promise<void> | void) =>
    (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const result = fn(req, res);
        if (result && typeof (result as Promise<void>).then === 'function') {
          (result as Promise<void>).catch(next);
        }
      } catch (error) {
        next(error);
      }
    };

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      demo: true,
      productionReady: false,
      demoPick: allowDemoPick,
      ai: Boolean(aiEnv.apiKey && aiEnv.baseUrl) ? 'configured' : 'not_configured',
    });
  });

  router.post(
    '/demo-session',
    wrap((req, res) => {
      if (!allowDemoPick || process.env.NODE_ENV === 'production') {
        throw new HttpError(403, 'Scelta del ruolo disattivata su questo avvio.', 'demo_pick_disabled');
      }
      const body = z.object({ email: z.string().trim().email().max(200) }).parse(req.body);
      const email = body.email.toLowerCase();
      if (!DEMO_PICK_EMAILS.has(email)) {
        throw new HttpError(403, 'Questo indirizzo non è un utente sintetico di prova.', 'demo_pick_denied');
      }
      const user = findUserByEmail(db, email);
      if (!user) throw new HttpError(403, 'Utente sintetico non trovato.', 'demo_pick_denied');
      const sessionId = createSession(db, user.id);
      res.setHeader(
        'Set-Cookie',
        `klaryo_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`,
      );
      res.json({ user: publicUser(user), demo: true, productionReady: false });
    }),
  );

  router.post(
    '/login',
    wrap((req, res) => {
      const body = LoginBody.parse(req.body);
      const user = findUserByEmail(db, body.email);
      if (!user || !verifyPassword(body.password, user.passwordHash)) {
        throw new HttpError(401, 'Credenziali non valide.', 'invalid_credentials');
      }
      const sessionId = createSession(db, user.id);
      res.setHeader(
        'Set-Cookie',
        `klaryo_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`,
      );
      res.json({ user: publicUser(user), demo: true, productionReady: false });
    }),
  );

  router.post(
    '/logout',
    wrap((req, res) => {
      const sessionId = readCookie(req, 'klaryo_session');
      if (sessionId) deleteSession(db, sessionId);
      res.setHeader('Set-Cookie', 'klaryo_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
      res.json({ ok: true });
    }),
  );

  router.get(
    '/me',
    wrap((req, res) => {
      const user = requireUser(req);
      res.json({ user: publicUser(user), demo: true, productionReady: false });
    }),
  );

  router.get(
    '/assumption-sets/current',
    wrap((req, res) => {
      requireUser(req);
      const current = getCurrentAssumptions(db);
      res.json({ id: current.id, assumptions: current.set, versions: listAssumptionVersions(db), productionReady: false });
    }),
  );

  router.post(
    '/assumption-sets',
    wrap((req, res) => {
      const user = requireUser(req);
      requireRole(user, ['admin']);
      let set: AssumptionSet;
      try {
        set = parseAssumptionPayload(req.body);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : 'Ipotesi non valide.', 'invalid_assumptions');
      }
      if (listAssumptionVersions(db).some((item) => item.version === set.version)) {
        throw new HttpError(409, 'Questa versione esiste già. Le analisi vecchie non si riscrivono: scegli un nuovo codice.', 'version_exists');
      }
      const id = insertAssumptionSet(db, set, user.id);
      res.status(201).json({ id, assumptions: set });
    }),
  );

  router.get(
    '/leads',
    wrap((req, res) => {
      const user = requireUser(req);
      res.json({
        leads: listLeadSummaries(db, user),
        synthetic: true,
        note: 'Gli elenchi non includono telefono né email.',
      });
    }),
  );

  router.post(
    '/leads',
    wrap(async (req, res) => {
      const user = requireUser(req);
      requireRole(user, ['customer']);
      const body = LeadBody.parse(req.body);
      let province = textOrNull(body.province)?.toUpperCase() ?? null;
      if (province && !/^[A-Z]{2}$/.test(province)) {
        throw new HttpError(400, 'La provincia va indicata con due lettere, per esempio MI.', 'invalid_province');
      }
      const intake: Intake = {
        annualKwh: body.annualKwh ?? null,
        annualSpendEur: body.annualSpendEur ?? null,
        wantsBattery: body.wantsBattery,
        includeFiscalScenario: body.includeFiscalScenario,
        propertyType: (body.propertyType ?? null) as PropertyType | null,
        surfaceM2: body.surfaceM2 ?? null,
        occupants: body.occupants ?? null,
        ev: body.ev,
        heatPump: body.heatPump,
        gas: body.gas,
        province,
      };
      const current = getCurrentAssumptions(db);
      const result = analyzeIntake(intake, current.set);
      const explanation = await buildExplanation(result, current.set, aiEnv);
      const created = insertLeadBundle(db, {
        customerUserId: user.id,
        displayName: body.displayName.trim(),
        email: user.email,
        phone: textOrNull(body.phone),
        address: textOrNull(body.address),
        city: textOrNull(body.city),
        province,
        intake,
        oversightUserId: firstAdminId(db),
        assumptionSetId: current.id,
        result,
        explanation,
      });
      res.status(201).json({ ...created, synthetic: true, productionReady: false });
    }),
  );

  router.get(
    '/leads/:id/dossier',
    wrap((req, res) => {
      const user = requireUser(req);
      res.json(buildDossier(db, viewerOf(user), String(req.params.id)));
    }),
  );

  router.post(
    '/leads/:id/match-suggestions',
    wrap((req, res) => {
      const user = requireUser(req);
      requireRole(user, ['admin']);
      const lead = getLead(db, String(req.params.id));
      if (!lead) throw new HttpError(404, 'Pratica non trovata.', 'not_found');
      if (getAssignment(db, lead.id)) throw new HttpError(409, 'La pratica è già assegnata.', 'already_assigned');
      const existing = buildDossier(db, viewerOf(user), lead.id).suggestions;
      if (existing.some((item) => item.status === 'admin_confirmed')) {
        throw new HttpError(409, 'C\'è già una conferma dell\'operatore. Questo MVP non ricalcola dopo la conferma.', 'already_confirmed');
      }
      const suggestions = suggestMatches(
        { province: lead.province, wantsBattery: lead.wantsBattery, heatPump: lead.heatPump },
        listInstallers(db).map((installer) => ({
          id: installer.id,
          companyName: installer.companyName,
          provinces: installer.provinces,
          services: installer.services,
          active: installer.active,
        })),
      );
      replaceSuggestions(db, lead.id, suggestions);
      const caseFile = loadCaseAccess(db, viewerOf(user), buildDossier(db, viewerOf(user), lead.id).caseFile.id).caseFile;
      addEvent(
        db,
        caseFile.id,
        'abbinamento_calcolato',
        user.id,
        'Abbinamenti ricalcolati per provincia dichiarata e servizi. Nessun dato è stato condiviso.',
      );
      res.json(buildDossier(db, viewerOf(user), lead.id));
    }),
  );

  router.post(
    '/match-suggestions/:id/confirm',
    wrap((req, res) => {
      const user = requireUser(req);
      requireRole(user, ['admin']);
      const suggestion = getSuggestion(db, String(req.params.id));
      if (!suggestion) throw new HttpError(404, 'Abbinamento non trovato.', 'not_found');
      if (getAssignment(db, suggestion.leadId)) throw new HttpError(409, 'La pratica è già assegnata.', 'already_assigned');
      if (!suggestion.eligible) {
        throw new HttpError(409, 'Abbinamento non idoneo: la conferma è bloccata.', 'not_eligible');
      }
      confirmSuggestion(db, suggestion, user.id);
      const caseId = buildDossier(db, viewerOf(user), suggestion.leadId).caseFile.id;
      const caseFile = loadCaseAccess(db, viewerOf(user), caseId).caseFile;
      const next = statusAfter(caseFile.status, 'conferma_admin');
      updateCase(db, caseFile.id, next, caseFile.ownerUserId);
      addEvent(
        db,
        caseFile.id,
        'conferma_admin',
        user.id,
        `Operatore ha confermato ${suggestion.companyName}. I dati non sono ancora condivisi: serve il consenso della famiglia.`,
      );
      res.json(buildDossier(db, viewerOf(user), suggestion.leadId));
    }),
  );

  router.post(
    '/leads/:id/consent',
    wrap((req, res) => {
      const user = requireUser(req);
      requireRole(user, ['customer']);
      const lead = getLead(db, String(req.params.id));
      if (!lead) throw new HttpError(404, 'Pratica non trovata.', 'not_found');
      if (lead.customerUserId !== user.id) throw new HttpError(403, 'Non autorizzato a vedere questa pratica.', 'forbidden');
      const body = ConsentBody.parse(req.body);
      if (getAssignment(db, lead.id)) {
        throw new HttpError(409, 'Dopo l\'assegnazione il consenso non si modifica da solo. Va segnalato all\'operatore.', 'consent_locked');
      }
      const caseId = getRequiredCaseId(db, user, lead.id);
      if (body.granted) {
        const confirmed = listSuggestions(db, lead.id).find((item) => item.status === 'admin_confirmed');
        if (!confirmed) {
          throw new HttpError(409, 'L\'operatore non ha ancora confermato un installatore. Senza quello il consenso non è informato.', 'match_required');
        }
        if (body.acceptedStatement !== CONSENT_STATEMENT) {
          throw new HttpError(400, 'Il testo del consenso non coincide con la formula richiesta.', 'consent_text');
        }
        setConsent(db, lead.id, 'granted', CONSENT_STATEMENT);
        addEvent(db, caseId, 'consenso', user.id, 'Consenso esplicito registrato. La condivisione avviene solo con l\'assegnazione dell\'operatore.');
      } else {
        setConsent(db, lead.id, 'revoked', null);
        addEvent(db, caseId, 'revoca_consenso', user.id, 'Consenso revocato prima dell\'assegnazione.');
      }
      res.json(buildDossier(db, viewerOf(user), lead.id));
    }),
  );

  router.post(
    '/leads/:id/assignments',
    wrap((req, res) => {
      const user = requireUser(req);
      requireRole(user, ['admin']);
      const body = AssignBody.parse(req.body);
      const lead = getLead(db, String(req.params.id));
      if (!lead) throw new HttpError(404, 'Pratica non trovata.', 'not_found');
      if (getAssignment(db, lead.id)) throw new HttpError(409, 'La pratica è già assegnata.', 'already_assigned');
      const suggestion = getSuggestion(db, body.matchId);
      if (!suggestion || suggestion.leadId !== lead.id) throw new HttpError(404, 'Abbinamento non trovato.', 'not_found');
      if (suggestion.status !== 'admin_confirmed' || !suggestion.eligible) {
        throw new HttpError(409, 'Serve prima la conferma dell\'operatore su un abbinamento idoneo.', 'admin_confirmation_required');
      }
      if (lead.consentStatus !== 'granted') {
        throw new HttpError(409, 'Manca il consenso esplicito della famiglia. Nessun dato è stato condiviso.', 'consent_required');
      }
      const installer = getInstaller(db, suggestion.installerId);
      if (!installer) throw new HttpError(404, 'Installatore non trovato.', 'not_found');
      createAssignment(db, lead.id, installer.id, suggestion.id, user.id);
      const caseId = getRequiredCaseId(db, user, lead.id);
      const caseFile = loadCaseAccess(db, viewerOf(user), caseId).caseFile;
      const next = statusAfter(caseFile.status, 'assegnazione');
      updateCase(db, caseFile.id, next, installer.userId);
      addEvent(
        db,
        caseFile.id,
        'assegnazione',
        user.id,
        `Pratica assegnata a ${installer.companyName}. Responsabile operativo: ${installer.userName}.`,
      );
      res.json(buildDossier(db, viewerOf(user), lead.id));
    }),
  );

  router.get(
    '/installers',
    wrap((req, res) => {
      const user = requireUser(req);
      if (user.role === 'customer') throw new HttpError(403, 'L\'elenco installatori è riservato all\'operatore e all\'anagrafica stessa.', 'forbidden_role');
      const items = listInstallers(db).filter((item) => user.role === 'admin' || item.id === user.installerId);
      res.json({
        installers: items.map((item) => ({
          id: item.id,
          companyName: item.companyName,
          provinces: item.provinces,
          services: item.services,
          active: item.active,
          notes: item.notes,
          contactName: user.role === 'admin' || item.id === user.installerId ? item.userName : null,
          email: user.role === 'admin' ? item.email : null,
          synthetic: true,
        })),
      });
    }),
  );

  router.patch(
    '/installers/:id',
    wrap((req, res) => {
      const user = requireUser(req);
      const installer = getInstaller(db, String(req.params.id));
      if (!installer) throw new HttpError(404, 'Installatore non trovato.', 'not_found');
      if (user.role !== 'admin' && user.installerId !== installer.id) {
        throw new HttpError(403, 'Non autorizzato a modificare questo installatore.', 'forbidden');
      }
      const body = InstallerBody.parse(req.body);
      const provinces = [...new Set(body.provinces.map((item) => item.toUpperCase()))];
      const services = [...new Set(body.services)];
      if (!services.includes('fotovoltaico')) {
        throw new HttpError(400, 'Il servizio fotovoltaico è richiesto per restare abbinabile.', 'service_required');
      }
      updateInstaller(db, installer.id, provinces, services);
      res.json({ installer: getInstaller(db, installer.id) });
    }),
  );

  router.get(
    '/cases/:id',
    wrap((req, res) => {
      const user = requireUser(req);
      res.json(buildDossierByCase(db, viewerOf(user), String(req.params.id)));
    }),
  );

  router.post(
    '/cases/:id/controllo',
    wrap((req, res) => {
      const user = requireUser(req);
      requireRole(user, ['admin']);
      const note = NoteBody.parse(req.body).note;
      res.json(applyCaseEvent(db, user, String(req.params.id), 'controllo', note));
    }),
  );

  router.post(
    '/cases/:id/revisione',
    wrap((req, res) => {
      const user = requireUser(req);
      requireRole(user, ['installer']);
      const access = loadCaseAccess(db, viewerOf(user), String(req.params.id));
      if (access.assignment?.installerId !== user.installerId) {
        throw new HttpError(403, 'Solo l\'installatore assegnato può revisionare la pratica.', 'forbidden');
      }
      const note = NoteBody.parse(req.body).note;
      res.json(applyCaseEvent(db, user, access.caseFile.id, 'revisione_installatore', note));
    }),
  );

  router.post(
    '/cases/:id/proposals',
    wrap((req, res) => {
      const user = requireUser(req);
      requireRole(user, ['installer']);
      const access = loadCaseAccess(db, viewerOf(user), String(req.params.id));
      if (!access.assignment || access.assignment.installerId !== user.installerId) {
        throw new HttpError(403, 'Solo l\'installatore assegnato può scrivere la proposta.', 'forbidden');
      }
      const before = latestAnalysis(db, access.lead.id);
      const body = ProposalBody.parse(req.body);
      const problem = assertEventAllowed(access.caseFile.status, 'proposta');
      if (problem) throw new HttpError(409, problem, 'invalid_transition');
      addProposal(db, {
        caseId: access.caseFile.id,
        installerId: access.assignment.installerId,
        technicalNotes: body.technicalNotes,
        economicNotes: body.economicNotes,
        checkedKwh: body.checkedKwh ?? null,
        checkedSpendEur: body.checkedSpendEur ?? null,
        summary: body.summary,
        createdBy: user.id,
      });
      const next = statusAfter(access.caseFile.status, 'proposta');
      updateCase(db, access.caseFile.id, next, access.caseFile.ownerUserId);
      addEvent(
        db,
        access.caseFile.id,
        'proposta',
        user.id,
        'Proposta scritta dall\'installatore. Il calcolo statistico non è stato modificato e non costituisce approvazione automatica.',
      );
      const after = latestAnalysis(db, access.lead.id);
      if (JSON.stringify(before?.result) !== JSON.stringify(after?.result) || before?.id !== after?.id) {
        throw new Error('La proposta non deve riscrivere l\'analisi statistica.');
      }
      res.json(buildDossier(db, viewerOf(user), access.lead.id));
    }),
  );

  router.post(
    '/cases/:id/esito',
    wrap((req, res) => {
      const user = requireUser(req);
      requireRole(user, ['admin']);
      res.json(applyCaseEvent(db, user, String(req.params.id), 'esito', NoteBody.parse(req.body).note));
    }),
  );

  router.post(
    '/cases/:id/feedback',
    wrap((req, res) => {
      const user = requireUser(req);
      requireRole(user, ['admin']);
      res.json(applyCaseEvent(db, user, String(req.params.id), 'feedback', NoteBody.parse(req.body).note));
    }),
  );

  router.post(
    '/cases/:id/chiusura',
    wrap((req, res) => {
      const user = requireUser(req);
      requireRole(user, ['admin']);
      res.json(applyCaseEvent(db, user, String(req.params.id), 'chiusura', NoteBody.parse(req.body).note));
    }),
  );

  router.post(
    '/cases/:id/feedback-cliente',
    wrap((req, res) => {
      const user = requireUser(req);
      requireRole(user, ['customer']);
      const access = loadCaseAccess(db, viewerOf(user), String(req.params.id));
      if (access.lead.customerUserId !== user.id) throw new HttpError(403, 'Non autorizzato.', 'forbidden');
      res.json(applyCaseEvent(db, user, access.caseFile.id, 'feedback_cliente', NoteBody.parse(req.body).note));
    }),
  );

  router.post(
    '/cases/:id/flags',
    wrap((req, res) => {
      const user = requireUser(req);
      requireRole(user, ['admin']);
      const access = loadCaseAccess(db, viewerOf(user), String(req.params.id));
      const body = FlagBody.parse(req.body);
      addFlag(db, access.caseFile.id, body.kind, body.note, user.id);
      addEvent(db, access.caseFile.id, 'segnalazione', user.id, 'Segnalazione di oversight registrata. Il dettaglio resta all\'operatore e all\'installatore assegnato.');
      const dossier = buildDossier(db, viewerOf(user), access.lead.id);
      res.json({ ...dossier, qualityDisclaimer: QUALITY_DISCLAIMER });
    }),
  );

  app.use('/api', router);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Percorso non trovato.', code: 'not_found' });
  });

  const distDir = options?.distDir;
  const indexFile = distDir ? path.join(distDir, 'index.html') : '';
  if (distDir && existsSync(indexFile)) {
    app.use(express.static(distDir));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(indexFile);
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .type('html')
        .send(
          '<!doctype html><html lang="it"><body><p>API dimostrativa Klaryo in ascolto. Interfaccia non compilata: in sviluppo usa Vite su http://127.0.0.1:5173 dopo npm run dev, oppure esegui npm run build prima di npm start.</p></body></html>',
        );
    });
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: 'Dati non validi.',
        code: 'invalid_body',
        details: error.issues.map((issue) => issue.message),
      });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: 'JSON non valido.', code: 'invalid_json' });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Errore interno.', code: 'internal' });
  });

  return app;
}

function getRequiredCaseId(db: DB, user: UserRecord, leadId: string): string {
  return buildDossier(db, viewerOf(user), leadId).caseFile.id;
}

function applyCaseEvent(db: DB, user: UserRecord, caseId: string, event: string, note: string) {
  const access = loadCaseAccess(db, viewerOf(user), caseId);
  const problem = assertEventAllowed(access.caseFile.status, event);
  if (problem) throw new HttpError(409, problem, 'invalid_transition');
  const next = statusAfter(access.caseFile.status, event);
  updateCase(db, access.caseFile.id, next, access.caseFile.ownerUserId);
  addEvent(db, access.caseFile.id, event, user.id, note);
  return buildDossier(db, viewerOf(user), access.lead.id);
}

