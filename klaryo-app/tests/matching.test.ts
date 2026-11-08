import { describe, expect, it } from 'vitest';
import { suggestMatches, type InstallerProfile } from '../domain/matching';
import { assertEventAllowed, caseLooksDelayed, statusAfter } from '../domain/caseflow';
import { assertDemoRuntime } from '../server/safety';

const nord: InstallerProfile = {
  id: 'nord',
  companyName: 'Nord Demo Impianti Srl',
  provinces: ['MI', 'MB'],
  services: ['fotovoltaico', 'batteria'],
  active: true,
};
const centro: InstallerProfile = {
  id: 'centro',
  companyName: 'Centro Demo Energia Srl',
  provinces: ['FI'],
  services: ['fotovoltaico', 'pompa_di_calore'],
  active: true,
};

describe('abbinamento', () => {
  it('idoneo solo con provincia coperta e servizio richiesto', () => {
    const [first, second] = suggestMatches({ province: 'MI', wantsBattery: false, heatPump: false }, [centro, nord]);
    expect(first.installerId).toBe('nord');
    expect(first.eligible).toBe(true);
    expect(first.reasons.join(' ')).toContain('MI');
    expect(second.eligible).toBe(false);
  });

  it('senza provincia non afferma una copertura', () => {
    const suggestions = suggestMatches({ province: null, wantsBattery: false, heatPump: false }, [nord]);
    expect(suggestions[0].eligible).toBe(false);
    expect(suggestions[0].score).toBe(0);
    expect(suggestions[0].reasons.join(' ').toLowerCase()).toContain('provincia');
  });

  it('la batteria richiesta senza servizio blocca, la pompa di calore no', () => {
    const battery = suggestMatches({ province: 'MI', wantsBattery: true, heatPump: false }, [centro, nord]);
    expect(battery.find((item) => item.installerId === 'nord')?.eligible).toBe(true);
    expect(battery.find((item) => item.installerId === 'centro')?.eligible).toBe(false);
    const heat = suggestMatches({ province: 'FI', wantsBattery: false, heatPump: true }, [centro]);
    expect(heat[0].eligible).toBe(true);
    expect(heat[0].reasons.join(' ').toLowerCase()).toContain('pompa');
  });
});

describe('stati e produzione', () => {
  it('non permette l\'esito prima della proposta e non torna indietro', () => {
    expect(assertEventAllowed('assegnato', 'esito')).toMatch(/non consentito/i);
    expect(assertEventAllowed('proposta', 'esito')).toBeNull();
    expect(statusAfter('proposta', 'controllo')).toBe('proposta');
    expect(statusAfter('assegnato', 'proposta')).toBe('proposta');
  });

  it('il ritardo è un promemoria a soglia, non uno stato di qualità', () => {
    const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    expect(caseLooksDelayed(old, 'assegnato', new Date(), 14)).toBe(true);
    expect(caseLooksDelayed(new Date().toISOString(), 'assegnato', new Date(), 14)).toBe(false);
    expect(caseLooksDelayed(old, 'chiuso', new Date(), 14)).toBe(false);
  });

  it('rifiuta l\'avvio production', () => {
    expect(() => assertDemoRuntime({ NODE_ENV: 'production' })).toThrow(/production rifiutato/i);
    expect(() => assertDemoRuntime({ NODE_ENV: 'production', KLARYO_ALLOW_DEMO_PICK: '1' })).toThrow(/production rifiutato/i);
    expect(() => assertDemoRuntime({ NODE_ENV: 'development' })).not.toThrow();
  });
});
