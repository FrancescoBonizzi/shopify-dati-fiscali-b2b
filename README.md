# Dati Fiscali B2B — app Shopify

Rende obbligatori i dati per la fattura elettronica prima del check-out di un negozio
Shopify che vende solo B2B: **ragione sociale**, **partita IVA** e **codice destinatario
SDI oppure PEC**.

Nasce per sostituire le app esistenti su un punto preciso: **la validazione della partita
IVA**. Un campo che accetta `aaaa` o un codice fiscale a 16 caratteri produce una fattura
elettronica che viene scartata, e il costo lo paghi in tempo di amministrazione.

**Pagina dell'app → [francescobonizzi.github.io/shopify-dati-fiscali-b2b](https://francescobonizzi.github.io/shopify-dati-fiscali-b2b/)**

## Cosa fa

- Modale sul carrello (pagina e drawer) che raccoglie i dati e li salva come **cart
  attributes**, visibili poi nei *Dettagli aggiuntivi* dell'ordine.
- Validazione vera della partita IVA: 11 cifre, codice ufficio provinciale esistente,
  cifra di controllo secondo la variante italiana dell'algoritmo di Luhn.
- Regola SDI/PEC della fatturazione elettronica, incluso `0000000` — formalmente valido,
  ma rende la PEC obbligatoria.
- Blocco di tutti i punti di uscita verso il check-out finché i dati non sono validi.
- Pagamenti rapidi gestiti in due regimi distinti: il **"Compra ora"** della scheda
  prodotto crea un check-out dal form del prodotto **senza passare dal carrello**, quindi
  gli attributi non ci arriverebbero mai e va nascosto *sempre*; i **wallet della pagina
  carrello** partono dal carrello esistente e si portano dietro gli attributi, quindi
  vengono nascosti solo finché i dati mancano. Da qui i due attributi su `<html>`:
  `data-df-stato` (verdetto del gate, considera valido il carrello vuoto) e
  `data-df-dati` (validità pura dei dati, è quello che guarda la CSS dei wallet).
- Colori copiati automaticamente dal bottone di check-out del tema, con override manuale
  nelle impostazioni dell'app embed block.

## Cosa NON fa, e perché

**Non blocca l'ordine lato server.** Chi digita `/checkout` a mano nella barra degli
indirizzi, o manipola gli attributi da DevTools, riesce a ordinare.

Il motivo è una limitazione della piattaforma, non una scelta. L'enforcement server-side
richiederebbe una Shopify Function, e
[la documentazione Shopify](https://shopify.dev/docs/apps/build/functions) è esplicita:

> Only stores on a Shopify Plus plan can use custom apps that contain Shopify Function APIs.

Un negozio non Plus con un'app a distribuzione custom non può quindi averlo. È lo stesso
buco che lasciano le app equivalenti sull'App Store, che lavorano anche loro con un popup
sul carrello.

Le due strade per chiuderlo davvero, entrambe fuori dallo scope di questo progetto:
passare a Shopify Plus, oppure pubblicare l'app sull'App Store — le app **pubbliche**
possono usare le Function su qualunque piano.

Le mitigazioni applicabili sono in [docs/configurazione-negozio.md](docs/configurazione-negozio.md).
La più importante non è codice: il campo **Nome azienda obbligatorio** nelle impostazioni
di check-out è un controllo server-side vero, gratuito e disponibile su tutti i piani.

Fuori scope anche: verifica dell'esistenza della partita IVA presso l'Agenzia delle Entrate
o VIES (serve rete, impossibile lato client in modo affidabile), clienti esteri e formati
VAT non italiani, salvataggio dei dati sul profilo cliente.

## Struttura

```
extensions/dati-fiscali/          theme app extension (app embed block)
  blocks/dati-fiscali.liquid      punto di ingresso + impostazioni per il theme editor
  snippets/modale-…​.liquid        markup del <dialog>
  assets/validatori.js            validatori — unica fonte di verità, importata anche dai test
  assets/dati-fiscali.js          gate sui bottoni di check-out, modale, scrittura carrello
  assets/dati-fiscali.css
test/                             test dei validatori (node:test, nessuna dipendenza)
docs/                             checklist delle impostazioni admin + pagina GitHub Pages
```

`validatori.js` non tocca il DOM: è importato dal modale nello storefront **e** dai test
Node, così la logica di validazione esiste in un posto solo.

### Perché c'è una pagina web in `docs/`

L'app non ha backend: è composta solo da una theme app extension e gira interamente
sull'infrastruttura di Shopify. In teoria è quindi un'app **extension-only**, che non
richiede alcun URL applicativo.

In pratica no: le theme app extension non rientrano nella
[tabella di compatibilità delle app extension-only](https://shopify.dev/docs/apps/build/app-extensions/build-extension-only-app),
e un'app che ne contiene una deve dichiarare un `application_url` raggiungibile anche se
dietro non c'è nulla da servire. `docs/index.html` è quella dichiarazione: una pagina
statica, senza script né richieste esterne, pubblicata da GitHub Pages.

## Attributi scritti sul carrello

| Chiave | Contenuto |
|---|---|
| `tipo_cliente` | sempre `azienda` |
| `ragione_sociale` | normalizzata |
| `partita_iva` | 11 cifre, senza prefisso `IT`, spazi o punti |
| `codice_sdi` | maiuscolo, 7 caratteri (6 se attivata la modalità PA) |
| `pec` | minuscolo |
| `dati_fiscali_validati` | `1`, scritto **solo** dopo che il validatore è passato |
| `dati_fiscali_versione` | versione del validatore che ha approvato i dati |

Il modale precompila anche dalle vecchie chiavi `getfiscal_*`, così i carrelli già aperti
al momento della migrazione da [GetFiscal](https://apps.shopify.com/getfiscal) non
ripartono da zero.

## Sviluppo

```bash
npm test                                              # validatori
shopify app config link                               # collega l'app del Dev Dashboard
shopify app deploy --no-release                       # crea e valida una versione
shopify app release --version=<nome> --allow-updates  # la manda live
```

Nessuna dipendenza a runtime, nessun build step: gli asset vanno sulla CDN di Shopify
così come sono.

**`shopify app dev` non serve qui.** Richiede un development store o una sandbox Plus, e
un negozio di produzione non è né l'uno né l'altro. Il collaudo si fa su un **tema
duplicato non pubblicato** del negozio reale, che è anche l'unico modo di verificare i
selettori del tema vero: vedi [docs/configurazione-negozio.md](docs/configurazione-negozio.md).

**Le versioni dell'estensione non sono per-tema.** La versione rilasciata viene servita a
tutti i temi che hanno l'app embed attivo, quindi non esiste modo di provarne una in
produzione senza rilasciarla. Il rollback è però immediato:

```bash
shopify app release --version=<versione-precedente> --allow-updates
```

**`shopify app config link` sovrascrive `shopify.app.toml`** con la configurazione remota,
commenti compresi: non aggiunge solo il `client_id`. Dopo ogni link ricontrollare
`embedded`, `application_url` e `redirect_urls` con `git diff` prima di committare. Se il
CLI scrive `[build] dev_store_url`, va rimosso: nomina il negozio del cliente, e questo
repo è pubblico.

### Trappole della validazione al deploy

Errori che il CLI segnala solo al momento del rilascio, tutti già inciampati una volta:

- **`extensions/*/locales/` deve esistere**, anche vuota. Se manca, il theme check muore
  con `ENOENT` — e il deploy *prosegue lo stesso*, quindi l'estensione finisce in
  produzione senza essere mai stata controllata.
- **Massimo 6 settings non interattivi** (`header` e `paragraph` sommati) per blocco.
  Lo schema attuale è esattamente a 6: per aggiungere un header bisogna toglierne un altro.
- **Un setting non può avere `"default": ""`**. Si omette la chiave e si mette
  `| default: ''` nel Liquid che la consuma.
- **In ambiente non interattivo** servono `--no-release`, `--allow-updates` o
  `--allow-deletes`: senza, il comando si rifiuta di partire. `--force` non esiste.
- **Cambiare il `default` di un setting non tocca i temi già configurati.** Il valore
  resta quello salvato nelle impostazioni del tema: il default vale solo per chi
  installa da zero. Per far sparire davvero un testo da un negozio esistente bisogna
  svuotare il campo nel theme editor.

Un'app a distribuzione custom si installa su **un solo negozio** (più negozi solo nella
stessa organizzazione Plus), e la scelta della distribuzione è definitiva. Per un secondo
cliente serve una nuova app nel Dev Dashboard: il codice si riusa, l'app no.

## Test manuali sul tema reale

I selettori dei bottoni di check-out cambiano da tema a tema: vanno verificati sul posto.

0. **Regressione, da fare per primo**: aggiungere al carrello, cambiare quantità, rimuovere
   una riga. Tutto deve funzionare normalmente. Se qualcosa si inceppa qui, il gate sta
   intercettando più del dovuto.
1. Check-out dalla pagina carrello senza dati → si apre il modale.
2. Check-out dal cart drawer → si apre il modale.
3. P.IVA `aaaa`, poi `RSSMRA80A01H501U`, poi `1234567001` → errore inline, nessun redirect.
4. `12345670017` e `IT 12345670017` → passano.
5. SDI `0000000` senza PEC → errore; con PEC → passa.
6. Rete staccata al salvataggio → messaggio nel modale, nessun redirect.
7. Riaprire il modale → campi precompilati.
8. Ordine di prova completato → dati nei *Dettagli aggiuntivi* dell'ordine.
9. Tastiera (Tab, Esc) e mobile.

## Contributi

Il progetto nasce per un'installazione specifica, quindi non ha una roadmap pubblica.
Segnalazioni e correzioni sono benvenute; per adattarlo a un altro negozio, il fork è la
strada più rapida.

## Licenza

[MIT](LICENSE) — Copyright (c) 2026 Francesco Bonizzi

---

**[Imagine Software](https://imaginesoftware.it)** — Sviluppo software, App e MVP
· [info@imaginesoftware.it](mailto:info@imaginesoftware.it)
