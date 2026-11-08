import { assertEventAllowed, type CaseStatus } from './caseflow';

export type Role = 'admin' | 'installer' | 'customer';

export interface Viewer {
  id: string;
  email: string;
  name: string;
  role: Role;
  installerId: string | null;
}

export function availableActions(input: {
  role: Role;
  status: CaseStatus;
  assignedToViewer: boolean;
  customerOwns: boolean;
}): string[] {
  const actions: string[] = [];
  const allow = (event: string, enabled: boolean) => {
    if (enabled && assertEventAllowed(input.status, event) === null) actions.push(event);
  };
  if (input.role === 'admin') {
    allow('controllo', true);
    actions.push('segnalazione');
    allow('esito', true);
    allow('feedback', true);
    allow('chiusura', true);
  }
  if (input.role === 'installer' && input.assignedToViewer) {
    allow('revisione_installatore', true);
    allow('proposta', true);
  }
  if (input.role === 'customer' && input.customerOwns) {
    allow('feedback_cliente', true);
  }
  return actions;
}
