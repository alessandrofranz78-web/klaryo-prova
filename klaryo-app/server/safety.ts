/** Il processo non deve partire come servizio di produzione: l'accesso è solo dimostrativo. */
export function assertDemoRuntime(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'Avvio production rifiutato. L\'accesso è dimostrativo (utenti seme, sessione locale, nessun provider reale). Non impostare NODE_ENV=production e non esporre questo processo.',
    );
  }
}
