import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS } from '../domain/assumptions';
import { analyzeIntake, type Intake } from '../domain/energy';

function intake(partial: Partial<Intake>): Intake {
  return {
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
    ...partial,
  };
}

describe('bilancio energetico', () => {
  it('limita l\'autoconsumo al consumo e non paga kWh inesistenti', () => {
    const result = analyzeIntake(intake({}), DEFAULT_ASSUMPTIONS);
    expect(result.plant?.kwp).toBe(8);
    expect(result.plant?.panels).toBe(20);
    expect(result.plant?.productionKwh).toBe(9600);
    expect(result.plant?.capexEur).toBe(13600);
    const base = result.scenarioBase!;
    expect(base.selfKwhUncapped).toBeGreaterThan(3500);
    expect(base.selfKwh).toBe(3500);
    expect(base.exportKwh).toBe(6100);
    expect(base.exportKwh).toBe(result.plant!.productionKwh - base.selfKwh);
    const price = 1800 / 3500;
    expect(base.selfSavingsEur).toBeCloseTo(3500 * price, 6);
    expect(base.selfSavingsEur!).toBeLessThanOrEqual(1800 + 1e-6);
    expect(base.selfSavingsEur!).toBeLessThan(3840 * price);
    expect(base.independenceRatio).toBeCloseTo(1, 6);
  });

  it('non conta due volte l\'autoconsumo nell\'orizzonte', () => {
    const result = analyzeIntake(intake({}), DEFAULT_ASSUMPTIONS);
    const year = result.projection!.years[0];
    expect(year.billEur).toBeCloseTo(1800, 6);
    expect(year.growthFactor).toBe(1);
    expect(year.selfSavingsEur).toBeCloseTo(1800, 6);
    expect(year.exportRevenueEur).toBeCloseTo(610, 6);
    expect(year.fiscalEur).toBe(0);
    expect(year.benefitEur).toBeCloseTo(year.selfSavingsEur + year.exportRevenueEur + year.fiscalEur, 6);
    expect(year.residualBillEur).toBeCloseTo(year.billEur - year.selfSavingsEur, 6);
    expect(year.operatingCostWithEur).toBeCloseTo(year.residualBillEur - year.exportRevenueEur - year.fiscalEur, 6);
    const doubleCounted = year.selfSavingsEur + year.benefitEur;
    expect(doubleCounted).toBeCloseTo(2 * year.selfSavingsEur + year.exportRevenueEur + year.fiscalEur, 6);
    expect(year.benefitEur).toBeLessThan(doubleCounted - 1000);
    const summed = result.projection!.years.reduce((sum, item) => sum + item.selfSavingsEur + item.exportRevenueEur + item.fiscalEur, 0);
    expect(result.projection!.cumulativeBenefitEur).toBeCloseTo(summed, 5);
    const last = result.projection!.years.at(-1)!;
    expect(last.cumulativeCostWithoutEur - last.cumulativeCostWithEur).toBeCloseTo(last.cumulativeBenefitEur - result.projection!.capexEur, 4);
  });

  it('applica la crescita dal secondo anno, non dal primo', () => {
    const result = analyzeIntake(intake({}), DEFAULT_ASSUMPTIONS);
    const second = result.projection!.years[1];
    expect(second.growthFactor).toBeCloseTo(1.05, 6);
    expect(second.billEur).toBeCloseTo(1800 * 1.05, 6);
    expect(second.exportRevenueEur).toBeCloseTo(610, 6);
    expect(second.selfSavingsEur).toBeCloseTo(1800 * 1.05, 6);
  });

  it('non include la detrazione se lo scenario fiscale è spento', () => {
    const result = analyzeIntake(intake({}), DEFAULT_ASSUMPTIONS);
    expect(result.fiscal.applied).toBe(false);
    expect(result.projection!.years.every((year) => year.fiscalEur === 0)).toBe(true);
    expect(result.fiscal.disclaimer.toLowerCase()).toContain('non');
  });

  it('con lo scenario fiscale acceso non raddoppia l\'autoconsumo e non incentiva la batteria', () => {
    const result = analyzeIntake(intake({ includeFiscalScenario: true, wantsBattery: true }), DEFAULT_ASSUMPTIONS);
    expect(result.fiscal.applied).toBe(true);
    expect(result.fiscal.appliesTo).toBe('solo_impianto');
    expect(result.fiscal.annualEur).toBeCloseTo((13600 * 0.5) / 10, 6);
    const year = result.projection!.years[0];
    expect(year.fiscalEur).toBeCloseTo(680, 6);
    expect(year.benefitEur).toBeCloseTo(year.selfSavingsEur + year.exportRevenueEur + year.fiscalEur, 6);
    expect(result.projection!.batteryCapexEur).toBeCloseTo(2800, 6);
    expect(result.warnings.join(' ').toLowerCase()).toContain('non è una verifica');
  });

  it('la batteria non crea kWh oltre il consumo con questo dimensionamento', () => {
    for (const annualKwh of [100, 800, 1400, 3500, 4800, 9200, 15000]) {
      const result = analyzeIntake(intake({ annualKwh, annualSpendEur: annualKwh * 0.28, wantsBattery: true }), DEFAULT_ASSUMPTIONS);
      expect(result.scenarioBase!.selfKwh).toBeLessThanOrEqual(annualKwh + 1e-6);
      expect(result.scenarioBase!.selfKwh).toBeLessThanOrEqual(result.plant!.productionKwh + 1e-6);
      expect(result.scenarioBase!.exportKwh).toBeCloseTo(result.plant!.productionKwh - result.scenarioBase!.selfKwh, 6);
      expect(result.scenarioBattery!.selfKwh).toBeCloseTo(result.scenarioBase!.selfKwh, 6);
      expect(result.scenarioBattery!.annualEnergyBenefitEur).toBeCloseTo(result.scenarioBase!.annualEnergyBenefitEur!, 5);
      expect(result.battery?.increasesAnnualSelfConsumption).toBe(false);
      expect(result.projection!.scenarioId).toBe('battery');
      const oneScenario = result.projection!.cumulativeBenefitEur;
      const both = (result.scenarioBase!.annualEnergyBenefitEur! + result.scenarioBattery!.annualEnergyBenefitEur!) * 9;
      expect(oneScenario).toBeLessThan(both);
    }
  });

  it('un caso che cade preciso sui kWp resta a 10 kWp', () => {
    const result = analyzeIntake(intake({ annualKwh: 4800, annualSpendEur: 1200 }), DEFAULT_ASSUMPTIONS);
    expect(result.plant?.kwp).toBe(10);
    expect(result.plant?.productionKwh).toBe(12000);
    expect(result.scenarioBase?.selfKwh).toBe(4800);
    expect(result.scenarioBase?.exportKwh).toBe(7200);
  });

  it('blocca le cifre se manca il consumo e blocca gli euro se manca la spesa', () => {
    const blocked = analyzeIntake(intake({ annualKwh: null }), DEFAULT_ASSUMPTIONS);
    expect(blocked.energyBlocked).toBe(true);
    expect(blocked.plant).toBeNull();
    expect(blocked.projection).toBeNull();
    expect(blocked.confidence).toBeNull();
    expect(blocked.scenarioBase).toBeNull();

    const noMoney = analyzeIntake(intake({ annualSpendEur: null }), DEFAULT_ASSUMPTIONS);
    expect(noMoney.energyBlocked).toBe(false);
    expect(noMoney.moneyBlocked).toBe(true);
    expect(noMoney.plant?.productionKwh).toBeGreaterThan(0);
    expect(noMoney.scenarioBase?.selfSavingsEur).toBeNull();
    expect(noMoney.projection).toBeNull();
    expect(noMoney.confidence).not.toBeNull();
    expect(noMoney.confidence!).toBeLessThan(70);
    expect(noMoney.confidence!).toBeLessThanOrEqual(82);
  });

  it('non trasforma abitudini in kilowattora e non arriva a confidenza 100', () => {
    const result = analyzeIntake(intake({ ev: true, heatPump: true }), DEFAULT_ASSUMPTIONS);
    expect(result.plant?.productionKwh).toBe(analyzeIntake(intake({}), DEFAULT_ASSUMPTIONS).plant?.productionKwh);
    expect(result.habitsNote.toLowerCase()).toContain('non aggiungiamo');
    expect(result.confidence!).toBeLessThanOrEqual(82);
    expect(result.geographicNote.toLowerCase()).toContain('non modifica la resa');
  });
});
