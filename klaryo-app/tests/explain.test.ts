import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS } from '../domain/assumptions';
import { analyzeIntake, type Intake } from '../domain/energy';
import {
  buildExplanation,
  deterministicExplanation,
  explanationViolatesBoundary,
  findInventedNumbers,
  allowedNumberKeys,
} from '../domain/explain';

const intake: Intake = {
  annualKwh: 3500,
  annualSpendEur: 1800,
  wantsBattery: false,
  includeFiscalScenario: false,
  propertyType: 'villa',
  surfaceM2: 140,
  occupants: 3,
  ev: false,
  heatPump: false,
  gas: false,
  province: 'MI',
};

describe('spiegazione', () => {
  it('il testo deterministico usa solo numeri del calcolo', () => {
    const result = analyzeIntake(intake, DEFAULT_ASSUMPTIONS);
    const text = deterministicExplanation(result, DEFAULT_ASSUMPTIONS);
    expect(explanationViolatesBoundary(text, result, DEFAULT_ASSUMPTIONS)).toBeNull();
    expect(text.toLowerCase()).toContain('non è un preventivo');
    expect(text.toLowerCase()).not.toContain('certificat');
  });

  it('scarta numeri inventati e approvazioni', () => {
    const result = analyzeIntake(intake, DEFAULT_ASSUMPTIONS);
    const allowed = allowedNumberKeys(result, DEFAULT_ASSUMPTIONS);
    expect(findInventedNumbers('Risparmio inventato 987654 euro', allowed)).toContain('987654');
    expect(explanationViolatesBoundary('Impianto approvato e certificato.', result, DEFAULT_ASSUMPTIONS)).toMatch(/approvazione|garanzia/i);
  });

  it('senza chiavi non chiama il provider', async () => {
    const result = analyzeIntake({ ...intake, annualKwh: null }, DEFAULT_ASSUMPTIONS);
    let called = false;
    const explanation = await buildExplanation(result, DEFAULT_ASSUMPTIONS, {}, async () => {
      called = true;
      throw new Error('non doveva partire');
    });
    expect(called).toBe(false);
    expect(explanation.mode).toBe('not_configured');
    expect(explanation.text.toLowerCase()).toContain('manca il consumo');
    expect(explanation.note.toLowerCase()).toContain('nessun provider');
  });

  it('rifiuta una risposta AI con cifre nuove e torna al testo sicuro', async () => {
    const result = analyzeIntake(intake, DEFAULT_ASSUMPTIONS);
    const explanation = await buildExplanation(result, DEFAULT_ASSUMPTIONS, { apiKey: 'test', baseUrl: 'http://ai.invalid' }, async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Risparmi certi di 987654 euro, impianto approvato.' } }] }), { status: 200 });
    });
    expect(explanation.mode).toBe('rejected_fallback');
    expect(explanation.text).not.toContain('987654');
    expect(explanation.note.toLowerCase()).toContain('scartata');
  });
});
