export const INSTALLER_SERVICES = ['fotovoltaico', 'batteria', 'pompa_di_calore'] as const;
export type InstallerService = (typeof INSTALLER_SERVICES)[number];

export interface InstallerProfile {
  id: string;
  companyName: string;
  provinces: string[];
  services: string[];
  active: boolean;
}

export interface MatchInput {
  province: string | null;
  wantsBattery: boolean;
  heatPump: boolean;
}

export interface MatchSuggestion {
  installerId: string;
  companyName: string;
  score: number;
  eligible: boolean;
  reasons: string[];
}

export function suggestMatches(input: MatchInput, installers: InstallerProfile[]): MatchSuggestion[] {
  const province = input.province?.trim().toUpperCase() || null;
  const suggestions = installers.map((installer) => scoreInstaller(input, installer, province));
  suggestions.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return a.companyName.localeCompare(b.companyName, 'it');
  });
  return suggestions;
}

function scoreInstaller(input: MatchInput, installer: InstallerProfile, province: string | null): MatchSuggestion {
  const reasons: string[] = [];
  if (!installer.active) {
    reasons.push(`${installer.companyName} non è attivo in anagrafica.`);
    return { installerId: installer.id, companyName: installer.companyName, score: 0, eligible: false, reasons };
  }
  if (!province) {
    reasons.push('Provincia della famiglia assente: non si afferma alcuna copertura geografica.');
    return { installerId: installer.id, companyName: installer.companyName, score: 0, eligible: false, reasons };
  }

  let score = 0;
  let eligible = true;
  if (installer.provinces.map((item) => item.toUpperCase()).includes(province)) {
    score += 50;
    reasons.push(
      `Copertura dichiarata sulla provincia ${province}. È un dato inserito nell'anagrafica, non una verifica sul territorio.`,
    );
  } else {
    eligible = false;
    reasons.push(`La provincia ${province} non è tra le coperture dichiarate da ${installer.companyName}.`);
  }

  if (installer.services.includes('fotovoltaico')) {
    score += 30;
    reasons.push('Dichiara il servizio fotovoltaico.');
  } else {
    eligible = false;
    reasons.push('Non dichiara il servizio fotovoltaico, necessario per questa pratica.');
  }

  if (input.wantsBattery) {
    if (installer.services.includes('batteria')) {
      score += 15;
      reasons.push('La pratica include lo scenario batteria e il servizio batteria è dichiarato.');
    } else {
      eligible = false;
      reasons.push('La pratica include lo scenario batteria, ma il servizio batteria non è dichiarato.');
    }
  }

  if (input.heatPump) {
    if (installer.services.includes('pompa_di_calore')) {
      score += 5;
      reasons.push('È annotata una pompa di calore e il servizio è dichiarato. Non è un progetto termico.');
    } else {
      reasons.push(
        'È annotata una pompa di calore, senza servizio dichiarato. L\'idoneità sul fotovoltaico non cambia; la copertura del servizio termico no.',
      );
    }
  }

  if (!eligible) {
    reasons.push('Abbinamento non idoneo: la conferma dell\'operatore è bloccata.');
  }

  return { installerId: installer.id, companyName: installer.companyName, score, eligible, reasons };
}
