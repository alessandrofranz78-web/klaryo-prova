import type { AssumptionSet } from './assumptions';
import { AI_BOUNDARY } from './copy';
import type { EnergyResult } from './energy';
import { formatEur, formatNum } from './format';

export interface AiEnv {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface Explanation {
  mode: 'not_configured' | 'provider' | 'rejected_fallback' | 'provider_error_fallback';
  text: string;
  note: string;
}

const FORBIDDEN = /certificat|idoneità fiscale riconosciuta|\bapprovo\b|\bapprovato\b|\bgarantiamo\b|dimensionamento esecutivo|preventivo vincolante/i;

export function deterministicExplanation(result: EnergyResult, assumptions: AssumptionSet): string {
  const lines = [
    `Spiegazione deterministica sulla versione ipotesi ${assumptions.version}.`,
    'Nessuna cifra di questo testo è aggiunta fuori dal calcolo.',
    'Analisi statistica orientativa: non è un preventivo tecnico, né un progetto esecutivo, né una verifica di idoneità.',
  ];
  for (const reason of result.blockReasons) lines.push(reason);
  if (result.plant && result.scenarioBase) {
    lines.push(
      `Impianto indicativo ${formatNum(result.plant.kwp, 0)} kWp, ${formatNum(result.plant.panels, 0)} pannelli da ${formatNum(result.plant.panelWatts, 0)} W, produzione ${formatNum(result.plant.productionKwh, 0)} kWh all'anno.`,
    );
    lines.push(
      `Autoconsumo considerato ${formatNum(result.scenarioBase.selfKwh, 0)} kWh all'anno. Cessione ${formatNum(result.scenarioBase.exportKwh, 0)} kWh all'anno.`,
    );
  }
  const active = result.activeScenarioId === 'battery' ? result.scenarioBattery : result.scenarioBase;
  if (active?.annualEnergyBenefitEur != null && result.projection) {
    lines.push(
      `Beneficio energetico annuo dello scenario attivo: ${formatEur(active.annualEnergyBenefitEur, 0)}. L'autoconsumo entra una volta sola.`,
    );
    lines.push(`Capitale considerato: ${formatEur(result.projection.capexEur, 0)}.`);
    if (result.projection.indicativePaybackYears == null) {
      lines.push('Nell\'orizzonte indicato il beneficio cumulato non copre il capitale. Non è un giudizio di convenienza verificato.');
    } else {
      lines.push(
        `Rientro indicativo del capitale in circa ${formatNum(result.projection.indicativePaybackYears, 1)} anni, dentro queste ipotesi. Non è un ROI misurato.`,
      );
    }
  }
  if (result.confidence != null) {
    lines.push(`Completezza interna dei dati: ${formatNum(result.confidence, 0)} su 100. Non è una probabilità validata.`);
  }
  lines.push(result.fiscal.applied ? result.fiscal.disclaimer : 'Nessuna detrazione fiscale è inclusa nel totale.');
  for (const warning of result.warnings) lines.push(warning);
  for (const note of result.confidenceNotes) lines.push(note);
  lines.push(result.habitsNote);
  lines.push(result.geographicNote);
  return lines.join('\n');
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function walk(value: unknown, add: (n: number) => void): void {
  if (typeof value === 'number') add(value);
  else if (Array.isArray(value)) value.forEach((item) => walk(item, add));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => walk(item, add));
}

export function allowedNumberKeys(result: EnergyResult, assumptions: AssumptionSet): Set<string> {
  const keys = new Set<string>();
  const add = (value: number) => {
    if (!Number.isFinite(value)) return;
    for (const digits of [0, 1, 2, 3, 4, 6]) keys.add(String(round(value, digits)));
    keys.add(String(round(value * 100, 0)));
    keys.add(String(round(value * 100, 1)));
  };
  walk(result, add);
  walk(assumptions, add);
  for (let year = 0; year <= assumptions.projectionYears; year += 1) add(year);
  add(100);
  return keys;
}

export function parseLocaleNumber(token: string): number {
  if (token.includes('.') && token.includes(',')) {
    return Number(token.replace(/\./g, '').replace(',', '.'));
  }
  if (/^\d{1,3}(\.\d{3})+$/.test(token)) return Number(token.replace(/\./g, ''));
  if (token.includes(',') && !token.includes('.')) return Number(token.replace(',', '.'));
  return Number(token);
}

export function findInventedNumbers(text: string, allowed: Set<string>): string[] {
  const tokens = text.match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g) ?? [];
  const invented: string[] = [];
  for (const token of tokens) {
    const value = parseLocaleNumber(token);
    if (!Number.isFinite(value)) continue;
    const candidates = [0, 1, 2, 3, 4, 6].map((digits) => String(round(value, digits)));
    if (!candidates.some((candidate) => allowed.has(candidate))) invented.push(token);
  }
  return invented;
}

export function explanationViolatesBoundary(text: string, result: EnergyResult, assumptions: AssumptionSet): string | null {
  if (FORBIDDEN.test(text)) return 'Il testo contiene una approvazione o una garanzia non consentita.';
  const invented = findInventedNumbers(text, allowedNumberKeys(result, assumptions));
  if (invented.length > 0) return `Numeri non presenti nel calcolo: ${invented.join(', ')}.`;
  return null;
}

export async function buildExplanation(
  result: EnergyResult,
  assumptions: AssumptionSet,
  env: AiEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Explanation> {
  const fallback = deterministicExplanation(result, assumptions);
  const notConfigured: Explanation = {
    mode: 'not_configured',
    text: fallback,
    note: 'Nessun provider AI configurato: testo deterministico sui soli numeri calcolati. ' + AI_BOUNDARY,
  };
  if (!env.apiKey || !env.baseUrl) return notConfigured;

  try {
    const response = await fetchImpl(env.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.apiKey}`,
      },
      body: JSON.stringify({
        model: env.model || 'klaryo-explain',
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'Spiega in italiano solo i numeri JSON forniti. Non inventare cifre, non approvare impianti, non dichiarare idoneità fiscali, non produrre un preventivo. Se un dato manca, dillo. Non usare nomi, telefoni o indirizzi: non sono nel JSON.',
          },
          {
            role: 'user',
            content: JSON.stringify({ assumptions, result }),
          },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return {
        mode: 'provider_error_fallback',
        text: fallback,
        note: 'Il provider AI non ha risposto in modo utilizzabile. Resta il testo deterministico. ' + AI_BOUNDARY,
      };
    }
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text || text.length > 4000) {
      return {
        mode: 'rejected_fallback',
        text: fallback,
        note: 'Risposta AI vuota o troppo lunga, scartata. ' + AI_BOUNDARY,
      };
    }
    const violation = explanationViolatesBoundary(text, result, assumptions);
    if (violation) {
      return {
        mode: 'rejected_fallback',
        text: fallback,
        note: `Risposta AI scartata: ${violation} ${AI_BOUNDARY}`,
      };
    }
    return {
      mode: 'provider',
      text,
      note: 'Testo del provider, controllato: ogni numero compare nel calcolo e non ci sono formule di approvazione. ' + AI_BOUNDARY,
    };
  } catch {
    return {
      mode: 'provider_error_fallback',
      text: fallback,
      note: 'Errore nel contattare il provider AI. Resta il testo deterministico. ' + AI_BOUNDARY,
    };
  }
}
