import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONSENT_STATEMENT } from '../domain/copy';
import { DEMO, DEMO_PASSWORD, openDatabase } from '../server/db';
import { createReadyApp } from '../server/http';

describe('confini di accesso e pratica', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const db = openDatabase(':memory:');
    const app = createReadyApp(db, { aiEnv: { apiKey: '', baseUrl: '' } });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('tiene separati i ruoli e i cancelli di consenso', async () => {
    const health = await call('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.productionReady).toBe(false);
    expect(health.body.ai).toBe('not_configured');

    const home = await fetch(base + '/');
    const html = await home.text();
    expect(html.toLowerCase()).not.toContain('ricostruita dal satellite');

    expect((await call('/api/leads')).status).toBe(401);

    const bianchi = await login(DEMO.bianchiEmail);
    const verdi = await login(DEMO.verdiEmail);
    const admin = await login(DEMO.adminEmail);
    const nord = await login(DEMO.nordEmail);
    const centro = await login(DEMO.centroEmail);

    const bianchiList = await call('/api/leads', { cookie: bianchi });
    expect(JSON.stringify(bianchiList.body)).not.toContain('Verdi');
    expect(JSON.stringify(bianchiList.body)).not.toContain('333');

    expect((await call(`/api/leads/${DEMO.bianchiLeadId}/consent`, {
      method: 'POST',
      cookie: verdi,
      body: { granted: true, acceptedStatement: CONSENT_STATEMENT },
    })).status).toBe(403);

    const hidden = await call(`/api/leads/${DEMO.verdiLeadId}/dossier`, { cookie: bianchi });
    expect(hidden.status).toBe(403);
    expect(JSON.stringify(hidden.body)).not.toContain('333 000 1102');

    expect((await call(`/api/leads/${DEMO.bianchiLeadId}/dossier`, { cookie: nord })).status).toBe(403);
    const nordList = await call('/api/leads', { cookie: nord });
    expect(JSON.stringify(nordList.body)).not.toContain('Bianchi');

    const nordInstallers = await call('/api/installers', { cookie: nord });
    expect(JSON.stringify(nordInstallers.body)).not.toContain('Centro Demo');
    expect((await call('/api/installers', { cookie: bianchi })).status).toBe(403);
    expect((await call('/api/leads', { method: 'POST', cookie: admin, body: { displayName: 'No' } })).status).toBe(403);

    const suggested = await call(`/api/leads/${DEMO.bianchiLeadId}/match-suggestions`, { method: 'POST', cookie: admin });
    expect(suggested.status, JSON.stringify(suggested.body)).toBe(200);
    const suggestions = suggested.body.suggestions as Array<{ id: string; companyName: string; eligible: boolean }>;
    const bad = suggestions.find((item) => item.companyName.includes('Centro'));
    const good = suggestions.find((item) => item.companyName.includes('Nord'));
    expect(bad?.eligible).toBe(false);
    expect(good?.eligible).toBe(true);
    expect((await call(`/api/match-suggestions/${bad!.id}/confirm`, { method: 'POST', cookie: admin })).status).toBe(409);
    expect((await call(`/api/match-suggestions/${good!.id}/confirm`, { method: 'POST', cookie: bianchi })).status).toBe(403);

    const confirmed = await call(`/api/match-suggestions/${good!.id}/confirm`, { method: 'POST', cookie: admin });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.gates.adminConfirmed).toBe(true);
    expect(confirmed.body.caseFile.status).toBe('abbinamento_proposto');

    const tooSoon = await call(`/api/leads/${DEMO.bianchiLeadId}/assignments`, {
      method: 'POST',
      cookie: admin,
      body: { matchId: good!.id },
    });
    expect(tooSoon.status).toBe(409);
    expect(tooSoon.body.code).toBe('consent_required');

    const wrongConsent = await call(`/api/leads/${DEMO.bianchiLeadId}/consent`, {
      method: 'POST',
      cookie: bianchi,
      body: { granted: true, acceptedStatement: 'acconsento in modo generico' },
    });
    expect(wrongConsent.status).toBe(400);
    expect((await call(`/api/leads/${DEMO.bianchiLeadId}/dossier`, { cookie: nord })).status).toBe(403);

    const consent = await call(`/api/leads/${DEMO.bianchiLeadId}/consent`, {
      method: 'POST',
      cookie: bianchi,
      body: { granted: true, acceptedStatement: CONSENT_STATEMENT },
    });
    expect(consent.status, JSON.stringify(consent.body)).toBe(200);
    expect(consent.body.lead.consentStatus).toBe('granted');
    expect((await call(`/api/leads/${DEMO.bianchiLeadId}/assignments`, { method: 'POST', cookie: nord, body: { matchId: good!.id } })).status).toBe(403);

    const assigned = await call(`/api/leads/${DEMO.bianchiLeadId}/assignments`, {
      method: 'POST',
      cookie: admin,
      body: { matchId: good!.id },
    });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    expect(assigned.body.gates.assigned).toBe(true);
    expect(assigned.body.caseFile.ownerName).toContain('Nord');
    const analysisBefore = JSON.stringify(assigned.body.analysis.result);
    const analysisId = assigned.body.analysis.id as string;
    const caseId = assigned.body.caseFile.id as string;

    const nordView = await call(`/api/leads/${DEMO.bianchiLeadId}/dossier`, { cookie: nord });
    expect(nordView.status).toBe(200);
    expect(nordView.body.lead.phone).toBe('333 000 1101');
    expect((await call(`/api/leads/${DEMO.bianchiLeadId}/dossier`, { cookie: centro })).status).toBe(403);
    expect((await call(`/api/leads/${DEMO.verdiLeadId}/dossier`, { cookie: nord })).status).toBe(403);

    expect((await call(`/api/cases/${caseId}/esito`, { method: 'POST', cookie: admin, body: { note: 'Troppo presto per un esito.' } })).status).toBe(409);

    const proposal = await call(`/api/cases/${caseId}/proposals`, {
      method: 'POST',
      cookie: nord,
      body: {
        technicalNotes: 'Sopralluogo ancora necessario: esposizione e ombre non sono nel modello.',
        economicNotes: 'Quadro economico scritto a mano, distinto dai numeri orientativi e senza idoneità fiscale.',
        summary: 'Proposta dimostrativa dell\'installatore, da verificare prima di qualsiasi offerta.',
        checkedKwh: 8000,
        checkedSpendEur: null,
      },
    });
    expect(proposal.status, JSON.stringify(proposal.body)).toBe(200);
    expect(proposal.body.analysis.id).toBe(analysisId);
    expect(JSON.stringify(proposal.body.analysis.result)).toBe(analysisBefore);
    expect(proposal.body.proposals[0].divergenceNote).toMatch(/15%/);
    expect((await call(`/api/cases/${caseId}/proposals`, {
      method: 'POST',
      cookie: centro,
      body: {
        technicalNotes: 'Non dovrei poter scrivere questa proposta altrui.',
        economicNotes: 'Tentativo di accesso a una pratica non assegnata.',
        summary: 'Questa proposta non deve essere accettata dal server.',
      },
    })).status).toBe(403);

    const unique = 'NOTA-INTERNA-NON-PUBBLICA-7f3a';
    expect((await call(`/api/cases/${caseId}/flags`, { method: 'POST', cookie: bianchi, body: { kind: 'reclamo', note: unique } })).status).toBe(403);
    const flagged = await call(`/api/cases/${caseId}/flags`, { method: 'POST', cookie: admin, body: { kind: 'incoerenza', note: unique } });
    expect(flagged.status).toBe(200);
    expect(flagged.body.qualityDisclaimer.toLowerCase()).toContain('non garantisce');
    const familyView = await call(`/api/leads/${DEMO.bianchiLeadId}/dossier`, { cookie: bianchi });
    expect(familyView.body.flagCount).toBeGreaterThan(0);
    expect(familyView.body.flags).toEqual([]);
    expect(JSON.stringify(familyView.body)).not.toContain(unique);

    const verdiView = await call(`/api/leads/${DEMO.verdiLeadId}/dossier`, { cookie: admin });
    expect(verdiView.body.analysis.result.energyBlocked).toBe(true);
    expect(verdiView.body.analysis.result.plant).toBeNull();

    const adminList = await call('/api/leads', { cookie: admin });
    expect(JSON.stringify(adminList.body)).not.toContain('333');

    const created = await call('/api/leads', {
      method: 'POST',
      cookie: bianchi,
      body: {
        displayName: 'Famiglia Esempio (sintetica)',
        phone: '333 000 0000',
        address: 'Via Dimostrazione 8',
        city: 'Milano',
        province: 'MI',
        propertyType: 'villa',
        surfaceM2: 120,
        occupants: 3,
        ev: false,
        heatPump: false,
        gas: true,
        annualSpendEur: 1800,
        annualKwh: 3500,
        wantsBattery: false,
        includeFiscalScenario: false,
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const saved = await call(`/api/leads/${created.body.leadId}/dossier`, { cookie: bianchi });
    expect(saved.body.analysis.result.scenarioBase.selfKwh).toBe(3500);
    expect(saved.body.analysis.explanation.mode).toBe('not_configured');
  });

  it('una nuova versione di ipotesi non riscrive l\'analisi già salvata', async () => {
    const admin = await login(DEMO.adminEmail);
    const before = await call(`/api/leads/${DEMO.verdiLeadId}/dossier`, { cookie: admin });
    const oldVersion = before.body.analysis.assumptionVersion as string;
    const current = await call('/api/assumption-sets/current', { cookie: admin });
    const created = await call('/api/assumption-sets', {
      method: 'POST',
      cookie: admin,
      body: { ...current.body.assumptions, version: 'ipotesi-test-resa', specificYieldKwhPerKwp: 1000, label: 'Prova resa' },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const after = await call(`/api/leads/${DEMO.verdiLeadId}/dossier`, { cookie: admin });
    expect(after.body.analysis.assumptionVersion).toBe(oldVersion);
    expect(after.body.analysis.assumptionVersion).not.toBe('ipotesi-test-resa');
  });

  async function login(email: string): Promise<string> {
    const response = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: DEMO_PASSWORD }),
    });
    expect(response.status).toBe(200);
    const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    expect(cookies.length).toBeGreaterThan(0);
    return cookies.map((item) => item.split(';')[0]).join('; ');
  }

  async function call(path: string, init: { method?: string; cookie?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = {};
    if (init.cookie) headers.cookie = init.cookie;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(base + path, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await response.text();
    let body: Record<string, any> = {};
    if (text) body = JSON.parse(text);
    return { status: response.status, body };
  }
});
