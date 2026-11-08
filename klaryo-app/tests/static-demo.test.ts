import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addProposal,
  assignLead,
  confirmMatch,
  grantConsent,
  initialDemoState,
  suggestForLead,
  visibleLeads,
  CONSENT_STATEMENT,
} from '../static-demo/store';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('dimostrazione statica', () => {
  it('non assegna senza conferma e consenso, e non fa vedere la pratica a Nord prima', () => {
    let state = initialDemoState();
    expect(visibleLeads(state, 'nord')).toHaveLength(0);
    const suggested = suggestForLead(state, 'bianchi', 'lead_bianchi_demo');
    expect(suggested.error).toMatch(/operatore/i);
    state = suggestForLead(state, 'operatore', 'lead_bianchi_demo').state;
    const bad = state.suggestions.find((item) => item.companyName.includes('Centro'));
    const good = state.suggestions.find((item) => item.companyName.includes('Nord'));
    expect(confirmMatch(state, 'operatore', bad!.id).error).toMatch(/non idoneo/i);
    state = confirmMatch(state, 'operatore', good!.id).state;
    expect(assignLead(state, 'operatore', 'lead_bianchi_demo').error).toMatch(/consenso/i);
    expect(grantConsent(state, 'verdi', 'lead_bianchi_demo', CONSENT_STATEMENT).error).toMatch(/famiglia/i);
    state = grantConsent(state, 'bianchi', 'lead_bianchi_demo', CONSENT_STATEMENT).state;
    state = assignLead(state, 'operatore', 'lead_bianchi_demo').state;
    expect(visibleLeads(state, 'nord').map((lead) => lead.id)).toContain('lead_bianchi_demo');
    expect(visibleLeads(state, 'centro')).toHaveLength(0);
    expect(addProposal(state, 'centro', 'lead_bianchi_demo', {
      summary: 'Questa proposta non deve entrare perché Centro non è assegnato.',
      technicalNotes: 'Nota tecnica di prova abbastanza lunga.',
      economicNotes: 'Nota economica di prova abbastanza lunga.',
      checkedKwh: null,
    }).error).toMatch(/assegnato/i);
    const verdi = state.leads.find((lead) => lead.id === 'lead_verdi_demo');
    expect(verdi?.annualKwh).toBeNull();
  });

  it('il sorgente della demo non chiama rete né il server', () => {
    const files = walk(path.resolve('static-demo')).filter((file) => file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.html'));
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toMatch(/fetch\(|\/api\/|DEMO_PASSWORD|node:sqlite|mailto:/);
  });
});
