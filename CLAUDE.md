# Istruzioni per Claude Code

Theme app extension Shopify che raccoglie i dati della fattura elettronica prima del
check-out. Nessun backend, nessuna dipendenza a runtime, nessun build step: gli asset
vanno sulla CDN di Shopify così come sono.

Il [README](README.md) spiega cosa fa l'app e perché, e
[la checklist del negozio](docs/configurazione-negozio.md) copre le impostazioni lato
admin. Qui c'è solo quello che serve per lavorarci senza rompere niente.

## Comandi

```bash
npm test                                                  # validatori (node:test)
npx shopify app deploy --no-release                       # crea e valida una versione
npx shopify app release --version=<nome> --allow-updates  # la manda live
```

`shopify app dev` non serve qui: vuole un development store, e il negozio è di
produzione. Il collaudo si fa su un tema duplicato non pubblicato, oppure dal vivo.

## Consegna

- Si committa **direttamente su `main`**. Niente branch secondari, niente pull request:
  un solo sviluppatore, nessuna revisione, i branch sono solo attrito. Se il lavoro si
  trova su un altro branch, va riportato su `main` in fast-forward e il branch va
  cancellato, senza chiedere.
- **Nessuna riga di attribuzione** nei messaggi di commit.
- Il messaggio di commit dice *perché*, non *cosa*: il diff il cosa lo mostra già.
- **Il repo è pubblico.** Non ci deve mai finire il nome del negozio del cliente. Se
  `shopify app config link` scrive `[build] dev_store_url` in `shopify.app.toml`, va
  tolto prima di committare, e dopo ogni link vanno ricontrollati `embedded`,
  `application_url` e `redirect_urls` con `git diff`.

## Rilascio

`release` **è** la produzione: la versione rilasciata viene servita a tutti i temi che
hanno l'app embed attivo, quindi non esiste modo di provarne una in produzione senza
rilasciarla. Il rollback è un comando solo e va tenuto pronto a ogni rilascio.

Trappole del CLI, tutte già pagate una volta:

- `--force` **non esiste**. In ambiente non interattivo servono `--no-release`,
  `--allow-updates` o `--allow-deletes`.
- `extensions/*/locales/` deve esistere, anche vuota. Se manca, il theme check muore con
  `ENOENT` e **il deploy prosegue lo stesso**: l'estensione va in produzione senza essere
  mai stata controllata.
- Massimo sei setting non interattivi (`header` più `paragraph`) per blocco. Lo schema è
  esattamente a sei: per aggiungerne uno bisogna toglierne un altro.
- Un setting non può avere `"default": ""`. Si omette la chiave e si usa `| default: ''`
  nel Liquid.
- Cambiare il `default` di un setting non tocca i temi già configurati.

## Verifica

`npm test` copre i validatori e nient'altro: non tocca il DOM, né il gate, né il tema.
Passare i test unitari non significa che la funzione funzioni.

**Prima di dire che è fatto, si prova dal vivo sul negozio**, guidando Chrome headless
con il Chrome DevTools Protocol. La prima tornata sistematica di prove dal vivo, il 10
settembre 2026, ha trovato due difetti che nessun test unitario e nessun banco statico
avrebbe visto, entrambi sul percorso del pagamento: un clic arrivato prima che il gate
esistesse finiva al check-out senza dati fiscali, e con `validatori.js` irraggiungibile
il bottone restava inerte per sempre.

Cosa provare, oltre ai casi felici: clic che arrivano prima dell'inizializzazione, rete
strozzata, singoli asset ritardati o bloccati, doppio invio, tastiera, schermi da 320 px,
carrelli scritti dalla versione precedente.

Regole del banco dal vivo:

- **Mai completare un ordine di prova.** Ci si ferma alla pagina di check-out, e alla
  fine si svuota il carrello.
- Uno script iniettato con `Page.addScriptToEvaluateOnNewDocument` gira **anche negli
  iframe** dei pixel di Shopify, che sono `about:blank`. Senza una guardia su
  `window.top` sovrascrivono i risultati del documento principale, e il banco misura
  se stesso.
- Senza `Network.setCacheDisabled` i ritardi simulati sugli asset **non si applicano**:
  il file arriva dalla cache del profilo e la prova non prova niente.
- Le pause fisse producono rossi finti. Si attende una condizione, non un tempo.

Il banco di quella tornata (una cinquantina di prove sui gruppi gate, validazione, tipo
di cliente, salvataggio, retrocompatibilità, mobile e tastiera) **non è nel repo**,
perché sarebbe l'unico posto in cui comparirebbe il negozio del cliente. È stato
consegnato come archivio a parte, parametrizzato su `NEGOZIO` e `VARIANTE_PRODOTTO`:
conviene chiederlo prima di riscriverlo da zero.

## Invarianti da non rompere

**Il gate non deve mai impedire di comprare.** È UX, non sicurezza: l'enforcement
server-side richiederebbe una Shopify Function, fuori portata per un'app custom su un
piano non Plus. Quando qualcosa non è verificabile (carrello non leggibile, validatori
non caricati, modulo mai arrivato) si lascia passare. Un negozio che non incassa è un
danno peggiore di una fattura senza codice SDI.

**Lo scudo di partenza è la ragione per cui il blocco contiene uno script classico e
inline.** Non trasformarlo in un modulo e non spostarlo: i moduli sono differiti, e in
quella finestra i clic sul check-out sfuggono al gate. Lo scudo trattiene i clic durante
il parsing e li consegna al gate appena esiste; dopo dieci secondi senza modulo si toglie
di mezzo da solo.

**I pagamenti rapidi hanno due regimi distinti.** Il "Compra ora" della scheda prodotto
crea un check-out senza passare dal carrello, quindi gli attributi non arriverebbero mai
e va nascosto *sempre*. I wallet della pagina carrello partono dal carrello esistente e
si portano dietro gli attributi, quindi si nascondono solo finché i dati mancano. Da qui
i due attributi su `<html>`: `data-df-stato` (verdetto del gate, un carrello vuoto è
valido) e `data-df-dati` (validità pura dei dati, è quello che guarda la CSS dei wallet).
Usare `data-df-stato` per i wallet aprirebbe un bypass a carrello vuoto, dove il gate
risponde "ok" perché non c'è niente da bloccare. Ogni selettore di wallet nuovo va prima
classificato in una delle due categorie. **Resta da verificare con un ordine vero** che
Shop Pay dal carrello porti davvero gli attributi fino all'ordine.

**`tipo_cliente: 'azienda'` è il valore che la versione 1.0.0 scriveva per tutti.**
Tenerlo come valore delle società fa sì che i carrelli già compilati restino validi a
ogni nuova versione, e che a nessuno si riapra il modale con la spesa già fatta.

**`validatori.js` non tocca il DOM.** È l'unica fonte di verità della validazione,
importato sia dallo storefront sia dai test Node. Va tenuto così.

## Trappole di piattaforma già pagate

- Un app embed block con `target: body` viene iniettato **in fondo al body**: tutto ciò
  che contiene, script inline compresi, entra in funzione a parsing quasi finito.
- Shopify **cancella** l'attributo del carrello quando gli si passa stringa vuota: la
  chiave sparisce invece di restare con valore vuoto. Va bene per azzerare un residuo,
  ma non aspettarsi di rileggerla.
- La `<legend>` viene disegnata sul bordo del `<fieldset>`: su un pannello con sfondo e
  senza bordo finisce a filo del margine, in modo diverso da browser a browser. Per i
  gruppi con sfondo si usa `div[role="group"]` con `aria-labelledby`.
- `form.elements.namedItem('tipoCliente')` restituisce una `RadioNodeList`, che non ha
  `setAttribute` né `focus`: il gruppo radio sta fuori da `CAMPI` di proposito.
- Una custom property con una funzione sconosciuta è valida al parsing e vincerebbe la
  cascata, fallendo poi al calcolo: `color-mix` va dentro `@supports`.

## Stile

- **Italiano ovunque**: codice, commenti, messaggi di commit, documentazione. Nomi di
  variabili e funzioni compresi.
- **Accenti veri sempre** (`è`, `perché`, `così`, `più`), mai l'apostrofo al posto
  dell'accento. Restano legittimi gli apostrofi veri: le elisioni (`l'ordine`,
  `un'idea`) e i troncamenti (`un po'`).
- I commenti spiegano **perché**, non cosa. Un commento che ripete il codice va tolto.
- Unità metriche decimali.
- **UI: prima si toglie testo, poi si comprime.** Se qualcosa non ci sta, si cerca la
  prosa ridondante prima di stringere le spaziature o allargare il modale. I messaggi
  d'errore spesso dicono già quello che una riga di spiegazione ripete. Densità visiva e
  quantità di testo sono due problemi diversi: comprimere risolve il secondo peggiorando
  il primo. Quando lo spazio si recupera, va restituito all'aria, non riempito.
- **Comunicazione strutturale al posto della prosa**: un "oppure" fra due campi dice da
  solo che ne basta uno, e costa una riga di testo in meno.
- **Nel modale non si reintroducono filetti orizzontali né grassetti sulle etichette.**
  I gruppi si fanno con lo sfondo dei pannelli, il grassetto è solo del titolo, e su
  mobile i bordi restano più stretti che su desktop.
