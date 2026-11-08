import type { Intake } from './energy';

export const EXAMPLE_INTAKE: Intake = {
  annualKwh: 3500,
  annualSpendEur: 1800,
  wantsBattery: false,
  includeFiscalScenario: false,
  propertyType: 'villa',
  surfaceM2: 120,
  occupants: 3,
  ev: false,
  heatPump: false,
  gas: true,
  province: 'MI',
};

export const EXAMPLE_CONTACT = {
  displayName: 'Famiglia Esempio (sintetica)',
  phone: '333 000 0000',
  address: 'Via Dimostrazione 8',
  city: 'Milano',
  province: 'MI',
};
