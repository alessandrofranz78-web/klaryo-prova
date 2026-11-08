# Klaryo — prima fetta web

Applicazione dimostrativa, in italiano, per una stima **statistica e orientativa** sul fotovoltaico e per il percorso che segue: famiglia, operatore, installatore.

Non è un preventivo tecnico. Non è un dimensionamento certificato. Non è una verifica di idoneità fiscale o geografica. Non è un servizio di produzione.

Il sito statico già presente nella radice del repository non viene toccato. Questa applicazione sta solo in `klaryo-app/`.

## Cosa fa il percorso

1. La famiglia compila il wizard in otto passi: nucleo, casa, bolletta, impianto indicativo, quadro economico, orizzonte 10 anni, batteria, riepilogo.
2. Il server ricalcola e salva l'analisi, con la versione delle ipotesi usata in quel momento.
3. L'operatore vede la pratica, i dati mancanti e un abbinamento spiegabile per provincia e servizi dichiarati.
4. L'operatore conferma un solo abbinamento idoneo. Questo **non** condivide i dati.
5. La famiglia legge chi riceverebbe i dati e dà un consenso esplicito, con la formula richiesta. Senza quel testo il consenso è rifiutato.
6. Solo dopo conferma e consenso l'operatore assegna la pratica. Da quel momento l'installatore assegnato vede il contatto.
7. L'installatore scrive una proposta umana. Il calcolo statistico non viene riscritto e non diventa un'approvazione.
8. L'operatore registra esito, feedback e chiusura, e può segnalare ritardi, incoerenze o reclami. Il sistema non garantisce la qualità del lavoro.

Ruoli: `admin` (operatore), `installer`, `customer` (famiglia). I controlli sono sul server. Gli elenchi non includono telefono né email.

## Architettura

- Interfaccia React (Vite) in `src/`.
- API Express in `server/`.
- Calcolo, abbinamento, stati e spiegazione in `domain/`, condivisi fra anteprima e server. Al salvataggio conta solo il risultato del server.
- Database SQLite del runtime Node (`node:sqlite`), file `data/klaryo.sqlite`, creato al primo avvio. Lo schema è applicato da `migrate`. I dati seme partono solo se il database è vuoto.
- Sessioni in tabella, cookie `HttpOnly`. Nessuna registrazione aperta.
- Spiegazione: testo deterministico sui numeri già calcolati. Se `KLARYO_AI_BASE_URL` e `KLARYO_AI_API_KEY` sono entrambi valorizzati, un adattatore compatibile con chat completions può riscrivere il testo; ogni numero deve già esistere nel calcolo e il testo non può approvare impianti. Altrimenti, o se il controllo fallisce, resta il testo deterministico. Il provider non riceve nome, telefono o indirizzo.

`NODE_ENV=production` fa rifiutare l'avvio. L'accesso è dimostrativo. Il processo ascolta solo `127.0.0.1`.

Node mostra un avviso sperimentale su `node:sqlite`. È il motore usato da questo MVP, non un database esterno.

## Provenienza del calcolo

Il wizard e le costanti di partenza vengono dal sorgente recuperato **Klaryo Energy Analyzer 1.0.0** (calcolatore in `lib/energy-calculator.ts`: `calcolaImpianto`, `calcolaRisparmio`, `calcolaBatteria`, `calcolaProiezione10Anni`). Non è dimostrato che quella revisione sia la stessa dell'app pubblica di riferimento `https://klaryo-energy-analyzer-two.vercel.app/`. Il metodo Formica Furba non è stato usato: non è stato fornito.

Le costanti iniziali, tutte **ipotesi e non valori validati**, sono:

| Ipotesi | Valore di partenza |
| --- | --- |
| Resa | 1200 kWh/kWp, unica, non geografica |
| Autoconsumo senza batteria | 40% della produzione |
| Autoconsumo con batteria | 75% della produzione |
| Capitale impianto | 1700 €/kWp |
| Cessione | 0,10 €/kWh, fisso |
| Batteria | 800 €/kWh e 1 kWh ogni 1000 kWh di consumo |
| Crescita della bolletta | 5% annuo dall'anno 2 |
| Scenario fiscale, spento di default | 50% del solo capitale impianto in 10 anni |
| Pannello | 400 W |
| Soglia di attenzione prezzo | 0,35 €/kWh |

L'operatore può salvare una **nuova versione**. Le analisi già registrate restano sulla versione con cui sono nate.

### Correzioni rispetto al calcolatore recuperato

Il dimensionamento resta quello del sorgente: produzione ≈ consumo / 0,40, arrotondata al kWp intero per eccesso. Con quella regola l'autoconsumo teorico raggiunge o supera il consumo annuo. Qui:

- i kWh autoconsumati non superano il consumo né la produzione;
- la cessione è produzione meno autoconsumo, non una seconda percentuale staccata;
- il beneficio annuo è autoconsumo + cessione + eventuale scenario fiscale, **una volta sola**;
- la bolletta residua è già al netto dell'autoconsumo, quindi quel risparmio non viene sottratto di nuovo nell'orizzonte a 10 anni;
- l'anno 1 usa la spesa inserita; la crescita parte dall'anno 2 e non si applica al prezzo di cessione;
- il cumulato non viene tagliato a zero;
- la detrazione non entra nei totali se la famiglia non accende lo scenario, e anche allora non è un'idoneità;
- la batteria, con questo dimensionamento, non aumenta i kWh autoconsumati oltre il tetto del consumo: non inventiamo un risparmio orario;
- auto elettrica, pompa di calore e gas non aggiungono kWh. Il modulo di simulazione del sorgente stimava cifre fisse: non è usato;
- se manca il consumo non ci sono kWp né euro; se manca la spesa ci possono essere i kWh ma non gli euro;
- la completezza interna non supera 82/100 e non è una probabilità.

La provincia serve solo all'abbinamento con le coperture dichiarate. Non modifica la resa.

## Avvio

Servono Node.js 22.5 o successivo e npm. Dalla cartella `klaryo-app`:

```bash
npm install
npm test
npm run typecheck
npm run build
npm run test:preview
```

`npm run test:preview` accende la scelta del ruolo sintetico e rifiuta comunque `NODE_ENV=production`. Il processo ascolta solo sull'interfaccia locale della macchina dove lo avvii. Non è un indirizzo pubblico. Il comando stampa la porta. `npm start` senza quella variabile non mostra i pulsanti dei ruoli.

`npm start` senza build risponde solo con l'API e una pagina che indica di usare Vite oppure di compilare. Non serve alcuna chiave API.

Per ripartire dai dati seme:

```bash
rm -f data/klaryo.sqlite data/klaryo.sqlite-wal data/klaryo.sqlite-shm
```

Variabili facoltative:

| Variabile | Effetto |
| --- | --- |
| `KLARYO_PORT` | Porta API, default 8787 |
| `KLARYO_DB` | Percorso del file SQLite |
| `KLARYO_AI_BASE_URL`, `KLARYO_AI_API_KEY`, `KLARYO_AI_MODEL` | Adattatore di spiegazione, non obbligatorio |
| `KLARYO_ALLOW_DEMO_PICK=1` | Abilita i pulsanti dei ruoli sintetici. `npm run test:preview` la imposta. Non scavalca il rifiuto di production. |
| `NODE_ENV=production` | L'avvio viene rifiutato |

## Accessi dimostrativi

Con `npm run test:preview` la schermata elenca i ruoli sintetici e non mostra una password. Senza quella modalità l'ingresso resta email e password, e la password non è scritta in questa pagina.

| Ruolo | Email |
| --- | --- |
| Operatore Alessandro Demo (sintetico) | `alessandro.demo@klaryo.test` |
| Famiglia Bianchi (sintetica), bolletta completa, Milano | `famiglia.bianchi@klaryo.test` |
| Famiglia Verdi (sintetica), consumo mancante, Firenze | `famiglia.verdi@klaryo.test` |
| Nord Demo Impianti Srl, copre MI MB VA, fotovoltaico e batteria | `nord.demo@klaryo.test` |
| Centro Demo Energia Srl, copre FI PO, fotovoltaico e pompa di calore | `centro.demo@klaryo.test` |

Bianchi non è assegnata all'avvio: conferma, consenso e assegnazione si fanno nell'interfaccia. Verdi mostra il blocco delle cifre quando manca il consumo.

## Test

`npm test` esegue Vitest.

- `tests/energy.test.ts`: tetto dell'autoconsumo, niente doppio conteggio, crescita dall'anno 2, fiscale spento di default, batteria che non somma un secondo scenario, dati mancanti.
- `tests/matching.test.ts`: idoneità geografica e di servizio, stati che non tornano indietro, rifiuto dell'avvio production.
- `tests/explain.test.ts`: numeri inventati e approvazioni scartate, provider assente.
- `tests/access.test.ts`: ruoli, consenso, assegnazione, proposta che non riscrive l'analisi, segnalazione non visibile alla famiglia, ipotesi versionate.

`npm run typecheck` è `tsc --noEmit`.

## Anteprima nell'agente Cursor

Non esiste un URL pubblico dell'app. L'anteprima supportata è il desktop remoto di questo cloud agent, visibile al proprietario dell'agente. Il processo di prova non va messo su un dominio, su Vercel o su un tunnel.

## Schermate

In `docs/screenshots/` ci sono immagini dell'interfaccia davvero avviata in locale: accesso, bolletta, orizzonte, pratica con cifre bloccate, stato dopo la proposta e storia della pratica. Non sono mockup.

## Limiti consapevoli

- Utenti seme, password unica, cookie di sessione non firmati, nessun recupero password, nessuna registrazione.
- Nessun invio di email, nessun CRM esterno, nessun import di lead reali.
- Nessuna misura di irraggiamento, nessun profilo orario, nessun preventivo di cantiere.
- Il rientro del capitale è indicativo e sensibile al prezzo di cessione ipotetico, spesso alto perché l'impianto è dimensionato più grande del consumo.
- Le segnalazioni e il promemoria di ritardo (14 giorni) non certificano ritardi né qualità.
- Dopo l'assegnazione il consenso non si revoca da solo: va una segnalazione all'operatore.
- Non pubblicare questo processo, non impostare `NODE_ENV=production`, non collegarlo a un dominio.
