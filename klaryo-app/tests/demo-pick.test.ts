import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO, openDatabase } from '../server/db';
import { createReadyApp } from '../server/http';

describe('scelta ruolo solo nell’avvio di prova', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const db = openDatabase(':memory:');
    const app = createReadyApp(db, { aiEnv: { apiKey: '', baseUrl: '' }, allowDemoPick: true });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('fa entrare un ruolo sintetico e tiene chiusa la pratica altrui', async () => {
    const health = await fetch(base + '/api/health');
    const healthBody = await health.json();
    expect(healthBody.demoPick).toBe(true);
    expect(healthBody.productionReady).toBe(false);

    const denied = await fetch(base + '/api/demo-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'persona.reale@example.com' }),
    });
    expect(denied.status).toBe(403);

    const session = await fetch(base + '/api/demo-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: DEMO.bianchiEmail }),
    });
    expect(session.status).toBe(200);
    const cookie = session.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ');
    const own = await fetch(base + `/api/leads/${DEMO.bianchiLeadId}/dossier`, { headers: { cookie } });
    const other = await fetch(base + `/api/leads/${DEMO.verdiLeadId}/dossier`, { headers: { cookie } });
    expect(own.status).toBe(200);
    expect(other.status).toBe(403);

    const assign = await fetch(base + `/api/leads/${DEMO.bianchiLeadId}/assignments`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ matchId: 'match_inesistente' }),
    });
    expect(assign.status).toBe(403);
  });
});
