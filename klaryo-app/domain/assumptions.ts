/**
 * Ipotesi di lavoro versionate.
 * I numeri di partenza sono quelli del calcolatore recuperato 1.0.0
 * (1200 kWh/kWp, autoconsumo 40%/75%, 1700 €/kWp, cessione 0,10 €/kWh,
 * crescita 5%, detrazione 50% in 10 anni). Non sono valori validati,
 * tariffe vigenti o idoneità di legge.
 */
export interface AssumptionSet {
  version: string;
  label: string;
  sourceNote: string;
  specificYieldKwhPerKwp: number;
  selfConsumptionWithoutBattery: number;
  selfConsumptionWithBattery: number;
  plantCostEurPerKwp: number;
  exportPriceEurPerKwh: number;
  batteryCostEurPerKwh: number;
  batteryKwhPer1000Kwh: number;
  energyPriceGrowthAnnual: number;
  fiscalIncentiveRate: number;
  fiscalIncentiveYears: number;
  panelWatts: number;
  highPriceThresholdEurPerKwh: number;
  plausiblePriceMinEurPerKwh: number;
  plausiblePriceMaxEurPerKwh: number;
  projectionYears: number;
  delayHintDays: number;
}

export const DEFAULT_ASSUMPTIONS: AssumptionSet = {
  version: 'ipotesi-1.0.0-corrette',
  label: 'Ipotesi del calcolatore 1.0.0, con contabilità corretta',
  sourceNote:
    'Costanti lette nel sorgente recuperato Klaryo Energy Analyzer 1.0.0 (calcolaImpianto, calcolaRisparmio, calcolaBatteria, calcolaProiezione10Anni). Coerenti con le ipotesi osservate sull\'app pubblica di riferimento, che non è dimostrato essere la stessa revisione. Non sono rese misurate, prezzi di mercato aggiornati né incentivi verificati.',
  specificYieldKwhPerKwp: 1200,
  selfConsumptionWithoutBattery: 0.4,
  selfConsumptionWithBattery: 0.75,
  plantCostEurPerKwp: 1700,
  exportPriceEurPerKwh: 0.1,
  batteryCostEurPerKwh: 800,
  batteryKwhPer1000Kwh: 1,
  energyPriceGrowthAnnual: 0.05,
  fiscalIncentiveRate: 0.5,
  fiscalIncentiveYears: 10,
  panelWatts: 400,
  highPriceThresholdEurPerKwh: 0.35,
  plausiblePriceMinEurPerKwh: 0.08,
  plausiblePriceMaxEurPerKwh: 0.6,
  projectionYears: 10,
  delayHintDays: 14,
};

function num(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} deve essere un numero.`);
  }
  return value;
}

function between(value: number, min: number, max: number, label: string): number {
  if (value < min || value > max) {
    throw new Error(`${label} fuori intervallo (${min}–${max}).`);
  }
  return value;
}

export function parseAssumptionPayload(input: unknown): AssumptionSet {
  if (!input || typeof input !== 'object') {
    throw new Error('Ipotesi mancanti.');
  }
  const raw = input as Record<string, unknown>;
  const version = String(raw.version ?? '').trim();
  const label = String(raw.label ?? '').trim();
  const sourceNote = String(raw.sourceNote ?? '').trim();
  if (version.length < 3 || version.length > 80) throw new Error('Versione ipotesi non valida.');
  if (label.length < 3 || label.length > 160) throw new Error('Etichetta ipotesi non valida.');
  if (sourceNote.length < 10 || sourceNote.length > 2000) throw new Error('Nota sulle fonti troppo corta o troppo lunga.');

  const selfBase = between(num(raw.selfConsumptionWithoutBattery, 'Autoconsumo senza batteria'), 0.05, 0.95, 'Autoconsumo senza batteria');
  const selfBattery = between(num(raw.selfConsumptionWithBattery, 'Autoconsumo con batteria'), 0.05, 0.95, 'Autoconsumo con batteria');
  if (selfBattery < selfBase) {
    throw new Error('L\'ipotesi di autoconsumo con batteria non può essere inferiore a quella senza batteria.');
  }
  const priceMin = num(raw.plausiblePriceMinEurPerKwh, 'Prezzo minimo plausibile');
  const priceMax = num(raw.plausiblePriceMaxEurPerKwh, 'Prezzo massimo plausibile');
  if (!(priceMin > 0) || !(priceMax > priceMin) || priceMax > 5) {
    throw new Error('Fascia di plausibilità del prezzo non valida.');
  }

  return {
    version,
    label,
    sourceNote,
    specificYieldKwhPerKwp: between(num(raw.specificYieldKwhPerKwp, 'Resa'), 200, 2500, 'Resa'),
    selfConsumptionWithoutBattery: selfBase,
    selfConsumptionWithBattery: selfBattery,
    plantCostEurPerKwp: between(num(raw.plantCostEurPerKwp, 'Costo impianto'), 100, 10000, 'Costo impianto'),
    exportPriceEurPerKwh: between(num(raw.exportPriceEurPerKwh, 'Prezzo cessione'), 0, 1, 'Prezzo cessione'),
    batteryCostEurPerKwh: between(num(raw.batteryCostEurPerKwh, 'Costo batteria'), 50, 5000, 'Costo batteria'),
    batteryKwhPer1000Kwh: between(num(raw.batteryKwhPer1000Kwh, 'Taglia batteria'), 0.1, 10, 'Taglia batteria'),
    energyPriceGrowthAnnual: between(num(raw.energyPriceGrowthAnnual, 'Crescita prezzo'), -0.05, 0.2, 'Crescita prezzo'),
    fiscalIncentiveRate: between(num(raw.fiscalIncentiveRate, 'Aliquota scenario fiscale'), 0, 0.7, 'Aliquota scenario fiscale'),
    fiscalIncentiveYears: between(num(raw.fiscalIncentiveYears, 'Anni scenario fiscale'), 1, 30, 'Anni scenario fiscale'),
    panelWatts: between(num(raw.panelWatts, 'Watt pannello'), 200, 800, 'Watt pannello'),
    highPriceThresholdEurPerKwh: between(num(raw.highPriceThresholdEurPerKwh, 'Soglia prezzo'), 0.05, 2, 'Soglia prezzo'),
    plausiblePriceMinEurPerKwh: priceMin,
    plausiblePriceMaxEurPerKwh: priceMax,
    projectionYears: between(num(raw.projectionYears, 'Anni di orizzonte'), 1, 30, 'Anni di orizzonte'),
    delayHintDays: between(num(raw.delayHintDays, 'Soglia ritardo'), 1, 365, 'Soglia ritardo'),
  };
}
