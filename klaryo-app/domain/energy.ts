import type { AssumptionSet } from './assumptions';

export type PropertyType = 'appartamento' | 'villa' | 'bifamiliare';

export interface Intake {
  annualKwh: number | null;
  annualSpendEur: number | null;
  wantsBattery: boolean;
  includeFiscalScenario: boolean;
  propertyType: PropertyType | null;
  surfaceM2: number | null;
  occupants: number | null;
  ev: boolean;
  heatPump: boolean;
  gas: boolean;
  province: string | null;
}

export interface ScenarioFlow {
  id: 'base' | 'battery';
  label: string;
  selfConsumptionRateAssumption: number;
  selfKwhUncapped: number;
  selfKwh: number;
  cappedToConsumption: boolean;
  exportKwh: number;
  independenceRatio: number;
  selfSavingsEur: number | null;
  exportRevenueEur: number | null;
  annualEnergyBenefitEur: number | null;
}

export interface ProjectionYear {
  year: number;
  growthFactor: number;
  billEur: number;
  selfSavingsEur: number;
  exportRevenueEur: number;
  fiscalEur: number;
  benefitEur: number;
  residualBillEur: number;
  operatingCostWithEur: number;
  cumulativeCostWithoutEur: number;
  cumulativeBenefitEur: number;
  cumulativeCostWithEur: number;
}

export interface EnergyResult {
  assumptionVersion: string;
  energyBlocked: boolean;
  moneyBlocked: boolean;
  blockReasons: string[];
  warnings: string[];
  disclosures: string[];
  confidence: number | null;
  confidenceNotes: string[];
  priceEurPerKwh: number | null;
  priceBand: 'missing' | 'plausible' | 'outside_band';
  kwhPerM2: number | null;
  plant: null | {
    kwp: number;
    panels: number;
    panelWatts: number;
    productionKwh: number;
    productionTargetKwh: number;
    capexEur: number;
    sizingNote: string;
  };
  battery: null | {
    capacityKwh: number;
    capexEur: number;
    heuristicNote: string;
    increasesAnnualSelfConsumption: boolean;
  };
  scenarioBase: ScenarioFlow | null;
  scenarioBattery: ScenarioFlow | null;
  activeScenarioId: 'base' | 'battery' | null;
  fiscal: {
    applied: boolean;
    rate: number | null;
    years: number | null;
    annualEur: number | null;
    appliesTo: 'solo_impianto' | 'nessuno';
    disclaimer: string;
  };
  projection: null | {
    scenarioId: 'base' | 'battery';
    years: ProjectionYear[];
    plantCapexEur: number;
    batteryCapexEur: number;
    capexEur: number;
    cumulativeBenefitEur: number;
    indicativePaybackYears: number | null;
    accountingNote: string;
  };
  habitsNote: string;
  geographicNote: string;
}

const FISCAL_DISCLAIMER =
  'Scenario fiscale ipotetico, acceso solo se richiesto. Non è una verifica di idoneità, non è un incentivo riconosciuto e non è consulenza fiscale. L\'aliquota si applica solo al capitale dell\'impianto, non alla batteria.';

function ceilStable(value: number): number {
  return Math.ceil(value - 1e-9);
}

function flow(
  id: 'base' | 'battery',
  label: string,
  rate: number,
  productionKwh: number,
  consumptionKwh: number,
  price: number | null,
  exportPrice: number,
): ScenarioFlow {
  const selfKwhUncapped = productionKwh * rate;
  const selfKwh = Math.min(selfKwhUncapped, consumptionKwh, productionKwh);
  const exportKwh = productionKwh - selfKwh;
  const selfSavingsEur = price == null ? null : selfKwh * price;
  const exportRevenueEur = price == null ? null : exportKwh * exportPrice;
  const annualEnergyBenefitEur =
    selfSavingsEur == null || exportRevenueEur == null ? null : selfSavingsEur + exportRevenueEur;
  return {
    id,
    label,
    selfConsumptionRateAssumption: rate,
    selfKwhUncapped,
    selfKwh,
    cappedToConsumption: selfKwhUncapped - selfKwh > 1e-6,
    exportKwh,
    independenceRatio: consumptionKwh > 0 ? selfKwh / consumptionKwh : 0,
    selfSavingsEur,
    exportRevenueEur,
    annualEnergyBenefitEur,
  };
}

function paybackYears(years: ProjectionYear[], capex: number): number | null {
  let previous = 0;
  for (const year of years) {
    if (year.cumulativeBenefitEur + 1e-9 >= capex) {
      if (year.benefitEur <= 0) return year.year;
      const fraction = (capex - previous) / year.benefitEur;
      return year.year - 1 + Math.min(1, Math.max(0, fraction));
    }
    previous = year.cumulativeBenefitEur;
  }
  return null;
}

function project(input: {
  spend: number;
  price: number;
  selfKwh: number;
  exportKwh: number;
  exportPrice: number;
  growth: number;
  years: number;
  plantCapex: number;
  batteryCapex: number;
  fiscalAnnual: number;
  fiscalYears: number;
  fiscalApplied: boolean;
  scenarioId: 'base' | 'battery';
}): EnergyResult['projection'] {
  const capex = input.plantCapex + input.batteryCapex;
  const rows: ProjectionYear[] = [];
  let cumWithout = 0;
  let cumBenefit = 0;
  let cumOperating = 0;
  for (let year = 1; year <= input.years; year += 1) {
    const growthFactor = Math.pow(1 + input.growth, year - 1);
    const billEur = input.spend * growthFactor;
    const selfSavingsEur = input.selfKwh * input.price * growthFactor;
    const exportRevenueEur = input.exportKwh * input.exportPrice;
    const fiscalEur = input.fiscalApplied && year <= input.fiscalYears ? input.fiscalAnnual : 0;
    const benefitEur = selfSavingsEur + exportRevenueEur + fiscalEur;
    const residualBillEur = billEur - selfSavingsEur;
    const operatingCostWithEur = residualBillEur - exportRevenueEur - fiscalEur;
    cumWithout += billEur;
    cumBenefit += benefitEur;
    cumOperating += operatingCostWithEur;
    rows.push({
      year,
      growthFactor,
      billEur,
      selfSavingsEur,
      exportRevenueEur,
      fiscalEur,
      benefitEur,
      residualBillEur,
      operatingCostWithEur,
      cumulativeCostWithoutEur: cumWithout,
      cumulativeBenefitEur: cumBenefit,
      cumulativeCostWithEur: capex + cumOperating,
    });
  }
  return {
    scenarioId: input.scenarioId,
    years: rows,
    plantCapexEur: input.plantCapex,
    batteryCapexEur: input.batteryCapex,
    capexEur: capex,
    cumulativeBenefitEur: cumBenefit,
    indicativePaybackYears: paybackYears(rows, capex),
    accountingNote:
      'Il beneficio di un anno è autoconsumo + cessione + eventuale scenario fiscale, una volta sola. La bolletta residua è già al netto dell\'autoconsumo: quel risparmio non viene sottratto di nuovo. L\'anno 1 usa la spesa inserita; la crescita parte dall\'anno 2 e riguarda solo la bolletta, non il prezzo di cessione. Un costo operativo negativo è un flusso di cassa indicativo, non un credito certificato. Il cumulato non viene tagliato a zero.',
  };
}

export function analyzeIntake(intake: Intake, assumptions: AssumptionSet): EnergyResult {
  const blockReasons: string[] = [];
  const warnings: string[] = [];
  const kwh = intake.annualKwh != null && intake.annualKwh > 0 ? intake.annualKwh : null;
  const spend = intake.annualSpendEur != null && intake.annualSpendEur > 0 ? intake.annualSpendEur : null;
  const energyBlocked = kwh == null;
  const moneyBlocked = energyBlocked || spend == null;
  if (energyBlocked) {
    blockReasons.push('Manca il consumo annuo in kWh: nessuna produzione, nessun autoconsumo e nessuna cifra economica.');
  }
  if (spend == null) {
    blockReasons.push('Manca la spesa annua: le cifre in euro sono bloccate.');
  } else if (energyBlocked) {
    blockReasons.push('Senza i kWh non si calcola un prezzo unitario, quindi le cifre in euro restano bloccate.');
  }

  const price = !moneyBlocked && kwh != null && spend != null ? spend / kwh : null;
  let priceBand: EnergyResult['priceBand'] = 'missing';
  if (price != null) {
    if (price < assumptions.plausiblePriceMinEurPerKwh || price > assumptions.plausiblePriceMaxEurPerKwh) {
      priceBand = 'outside_band';
      warnings.push(
        'Prezzo unitario fuori dalla fascia di plausibilità interna. Le cifre restano visibili, con confidenza più bassa. La fascia non è un benchmark ufficiale.',
      );
    } else {
      priceBand = 'plausible';
    }
    if (price > assumptions.highPriceThresholdEurPerKwh) {
      warnings.push(
        `Prezzo unitario sopra la soglia di attenzione interna di ${assumptions.highPriceThresholdEurPerKwh.toLocaleString('it-IT')} €/kWh. La soglia arriva dal calcolatore recuperato e non è un prezzo di mercato aggiornato.`,
      );
    }
  }

  const kwhPerM2 = kwh != null && intake.surfaceM2 != null && intake.surfaceM2 > 0 ? kwh / intake.surfaceM2 : null;
  if (kwhPerM2 != null && (kwhPerM2 < 5 || kwhPerM2 > 200)) {
    warnings.push(
      'Il rapporto kWh/m² è fuori da una fascia descrittiva interna (5–200). Può indicare un dato incompleto. Non è una diagnosi dell\'edificio.',
    );
  }

  const disclosures = [
    `Resa usata: ${assumptions.specificYieldKwhPerKwp} kWh/kWp. È un valore unico di ipotesi, non una previsione geografica e non dipende dalla provincia.`,
    'Il tipo di immobile non modifica i numeri: non c\'è un modello tipologico validato in questo calcolo.',
    'Parametri della versione «' + assumptions.version + '». ' + assumptions.sourceNote,
    'L\'impianto è dimensionato con la regola del calcolatore recuperato: produzione ≈ consumo / autoconsumo senza batteria, arrotondata al kWp intero per eccesso.',
  ];

  const habits: string[] = [];
  if (intake.ev) habits.push('auto elettrica');
  if (intake.heatPump) habits.push('pompa di calore');
  if (intake.gas) habits.push('gas');
  const habitsNote = habits.length
    ? `Abitudini annotate (${habits.join(', ')}). Non aggiungiamo kWh né euro: mancano fattori di consumo dichiarati. Il modulo di simulazione del sorgente recuperato stimava cifre fisse che qui non usiamo.`
    : 'Nessuna abitudine energetica aggiuntiva annotata. Anche in quel caso il calcolo non inventa consumi oltre la bolletta.';

  const geographicNote = intake.province
    ? `Provincia ${intake.province.toUpperCase()} usata solo per l'abbinamento con le coperture dichiarate dagli installatori. Non modifica la resa.`
    : 'Provincia assente: l\'analisi energetica può esistere, l\'abbinamento geografico no.';

  const fiscalBase: EnergyResult['fiscal'] = {
    applied: false,
    rate: null,
    years: null,
    annualEur: null,
    appliesTo: 'nessuno',
    disclaimer: 'Detrazione non inclusa. Il 50% presente nelle ipotesi non è applicato e non dimostra un\'idoneità.',
  };

  if (energyBlocked || kwh == null) {
    return {
      assumptionVersion: assumptions.version,
      energyBlocked: true,
      moneyBlocked: true,
      blockReasons,
      warnings,
      disclosures,
      confidence: null,
      confidenceNotes: ['Confidenza numerica non assegnata: mancano i dati per una cifra.'],
      priceEurPerKwh: null,
      priceBand: 'missing',
      kwhPerM2,
      plant: null,
      battery: null,
      scenarioBase: null,
      scenarioBattery: null,
      activeScenarioId: null,
      fiscal: fiscalBase,
      projection: null,
      habitsNote,
      geographicNote,
    };
  }

  const rate = assumptions.selfConsumptionWithoutBattery;
  const productionTargetKwh = kwh / rate;
  const kwp = ceilStable(productionTargetKwh / assumptions.specificYieldKwhPerKwp);
  const panels = ceilStable((kwp * 1000) / assumptions.panelWatts);
  const productionKwh = kwp * assumptions.specificYieldKwhPerKwp;
  const plantCapex = kwp * assumptions.plantCostEurPerKwp;
  const plant = {
    kwp,
    panels,
    panelWatts: assumptions.panelWatts,
    productionKwh,
    productionTargetKwh,
    capexEur: plantCapex,
    sizingNote:
      'kWp arrotondati per eccesso. L\'autoconsumo teorico (produzione × aliquota) che supera il consumo annuo viene limitato al consumo. L\'eccedenza è energia immessa, non un altro risparmio in bolletta.',
  };

  const scenarioBase = flow('base', 'Senza batteria', rate, productionKwh, kwh, price, assumptions.exportPriceEurPerKwh);
  const scenarioBattery = flow(
    'battery',
    'Con ipotesi batteria',
    assumptions.selfConsumptionWithBattery,
    productionKwh,
    kwh,
    price,
    assumptions.exportPriceEurPerKwh,
  );

  if (scenarioBase.cappedToConsumption || scenarioBattery.cappedToConsumption) {
    warnings.push(
      'L\'autoconsumo teorico supera il consumo annuo ed è stato limitato. L\'energia eccedente è trattata come immessa, non come ulteriore risparmio in bolletta.',
    );
  }

  const batteryCapacity = (kwh / 1000) * assumptions.batteryKwhPer1000Kwh;
  const batteryCapex = batteryCapacity * assumptions.batteryCostEurPerKwh;
  const increases = scenarioBattery.selfKwh > scenarioBase.selfKwh + 1e-6;
  const battery = intake.wantsBattery
    ? {
        capacityKwh: batteryCapacity,
        capexEur: batteryCapex,
        heuristicNote:
          'Taglia euristica del calcolatore recuperato: kilowattora di batteria proporzionali al consumo annuo (1 kWh ogni 1000 kWh, salvo diversa ipotesi). Non è un dimensionamento.',
        increasesAnnualSelfConsumption: increases,
      }
    : null;

  if (intake.wantsBattery && !increases) {
    warnings.push(
      'Con questa ipotesi di dimensionamento l\'autoconsumo annuo è già al tetto del consumo. La batteria non aumenta i kWh autoconsumati in questo modello. Il suo costo entra nel capitale dello scenario, ma non inventiamo un risparmio orario: manca il profilo di carico. Non è un giudizio sull\'opportunità di installarla.',
    );
  }

  if (price != null && scenarioBase.exportRevenueEur != null && scenarioBase.exportRevenueEur > spend!) {
    warnings.push(
      'Il ricavo di cessione stimato supera la bolletta annua. Dipende dall\'impianto dimensionato più grande del consumo e da un prezzo di cessione fisso, non da una tariffa verificata.',
    );
  }

  const activeScenarioId: 'base' | 'battery' = intake.wantsBattery ? 'battery' : 'base';
  const active = activeScenarioId === 'battery' ? scenarioBattery : scenarioBase;

  let fiscal = fiscalBase;
  if (!moneyBlocked && intake.includeFiscalScenario) {
    const annual = (plantCapex * assumptions.fiscalIncentiveRate) / assumptions.fiscalIncentiveYears;
    fiscal = {
      applied: true,
      rate: assumptions.fiscalIncentiveRate,
      years: assumptions.fiscalIncentiveYears,
      annualEur: annual,
      appliesTo: 'solo_impianto',
      disclaimer: FISCAL_DISCLAIMER,
    };
    warnings.push(FISCAL_DISCLAIMER);
  }

  const projection = moneyBlocked || price == null || active.selfKwh == null
    ? null
    : project({
        spend: spend as number,
        price,
        selfKwh: active.selfKwh,
        exportKwh: active.exportKwh,
        exportPrice: assumptions.exportPriceEurPerKwh,
        growth: assumptions.energyPriceGrowthAnnual,
        years: assumptions.projectionYears,
        plantCapex,
        batteryCapex: intake.wantsBattery ? batteryCapex : 0,
        fiscalAnnual: fiscal.annualEur ?? 0,
        fiscalYears: assumptions.fiscalIncentiveYears,
        fiscalApplied: fiscal.applied,
        scenarioId: activeScenarioId,
      });

  let confidence = 58;
  const confidenceNotes = ['Punteggio interno di completezza dei dati. Non è una probabilità statistica validata e non arriva a 100.'];
  if (moneyBlocked) {
    confidence -= 22;
    confidenceNotes.push('Manca la spesa: nessuna cifra in euro.');
  } else if (priceBand === 'outside_band') {
    confidence -= 14;
    confidenceNotes.push('Prezzo unitario fuori fascia interna.');
  } else {
    confidence += 8;
  }
  if (!intake.province) {
    confidence -= 6;
    confidenceNotes.push('Provincia assente.');
  }
  if (intake.surfaceM2 == null) {
    confidence -= 4;
    confidenceNotes.push('Superficie assente.');
  }
  if (intake.wantsBattery) {
    confidence -= 6;
    confidenceNotes.push('Scenario batteria: ipotesi aggiuntiva, senza profilo orario.');
  }
  if (intake.includeFiscalScenario) {
    confidence -= 10;
    confidenceNotes.push('Scenario fiscale incluso senza verifica di idoneità.');
  }
  if (scenarioBase.cappedToConsumption) {
    confidence -= 4;
    confidenceNotes.push('Autoconsumo limitato al consumo annuo dopo l\'arrotondamento.');
  }
  confidence = Math.max(8, Math.min(82, confidence));

  return {
    assumptionVersion: assumptions.version,
    energyBlocked: false,
    moneyBlocked,
    blockReasons,
    warnings,
    disclosures,
    confidence: moneyBlocked && energyBlocked ? null : confidence,
    confidenceNotes,
    priceEurPerKwh: price,
    priceBand,
    kwhPerM2,
    plant,
    battery,
    scenarioBase,
    scenarioBattery,
    activeScenarioId,
    fiscal,
    projection,
    habitsNote,
    geographicNote,
  };
}
