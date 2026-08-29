# Dati Fiscali B2B

App Shopify **custom** (installata sul singolo negozio, fuori dall'App Store) che rende
obbligatori i dati per la fattura elettronica prima del check-out: **ragione sociale**,
**partita IVA** e **codice destinatario SDI oppure PEC**.

Sostituisce [GetFiscal](https://apps.shopify.com/getfiscal) su un negozio che vende solo B2B.
Il motivo del rimpiazzo non è l'aspetto: è che GetFiscal **non valida la partita IVA** — accetta
`aaaa` e un codice fiscale a 16 caratteri, e una fattura elettronica con quei dati viene scartata.

## Cosa fa

- Modale sul carrello (pagina e drawer) che raccoglie i dati e li salva come **cart attributes**,
  visibili poi nei *Dettagli aggiuntivi* dell'ordine.
- Validazione vera della partita IVA: 11 cifre, codice ufficio provinciale esistente,
  cifra di controllo secondo la variante italiana dell'algoritmo di Luhn.
- Regola SDI/PEC della fatturazione elettronica, incluso `0000000` (formalmente valido, ma
  rende la PEC obbligatoria).
- Blocco di tutti i punti di uscita verso il check-out finché i dati non sono validi.
- Colori copiati automaticamente dal bottone di check-out del tema, con override manuale
  nelle impostazioni dell'app embed block.

## Cosa NON fa, e perché

**Non blocca l'ordine lato server.** Chi digita `/checkout` a mano nella barra degli indirizzi,
o manipola gli attributi da DevTools, riesce a ordinare.

Il motivo è una limitazione della piattaforma, non una scelta: l'enforcement server-side
richiederebbe una Shopify Function, e
[la documentazione Shopify](https://shopify.dev/docs/apps/build/functions) è esplicita —
*"Only stores on a Shopify Plus plan can use custom apps that contain Shopify Function APIs"*.
Il negozio non è Plus e l'app è a distribuzione custom.

È lo stesso identico buco che lascia GetFiscal, che infatti lavora anche lui con un popup
sul carrello. Le strade per chiuderlo davvero sono due, entrambe fuori dallo scope attuale:
passare a Shopify Plus, oppure pubblicare questa app sull'App Store (le app pubbliche possono
usare le Function su qualunque piano).

Mitigazioni applicate: vedi [docs/configurazione-negozio.md](docs/configurazione-negozio.md).
La più importante è il campo **Nome azienda obbligatorio** nativo, che invece è un blocco
server-side vero e gratuito.

Fuori scope anche: verifica dell'esistenza della partita IVA presso l'Agenzia delle Entrate o
VIES (serve rete, impossibile lato client in modo affidabile), clienti esteri e formati VAT non
italiani, salvataggio dei dati sul profilo cliente.

## Struttura

```
extensions/dati-fiscali/          theme app extension (app embed block)
  blocks/dati-fiscali.liquid      punto di ingresso + impostazioni per il theme editor
  snippets/modale-…​.liquid        markup del <dialog>
  assets/validatori.js            validatori — unica fonte di verità, importata anche dai test
  assets/dati-fiscali.js          gate sui bottoni di check-out, modale, scrittura carrello
  assets/dati-fiscali.css
test/                             test dei validatori (node:test, nessuna dipendenza)
docs/configurazione-negozio.md    checklist delle impostazioni admin
```

`validatori.js` non tocca il DOM: è importato dal modale nello storefront **e** dai test Node,
così la logica di validazione esiste in un posto solo.

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

Il modale precompila anche dalle vecchie chiavi `getfiscal_*`, così i carrelli aperti al
momento del cutover non ripartono da zero.

## Sviluppo

```bash
npm test                 # validatori
shopify app config link  # collega l'app creata nel Dev Dashboard (compila client_id)
shopify app dev          # sviluppo sul dev store / tema duplicato
shopify app deploy       # rilascia una nuova versione
```

`shopify.app.toml` dichiara un `application_url` statico: una theme app extension non rientra
fra le estensioni compatibili con le app *extension-only*, quindi l'app deve dichiarare un URL
anche senza avere un backend. Nessun server da mantenere.

## Test manuali sul tema reale

I selettori dei bottoni di check-out cambiano da tema a tema: vanno verificati sul posto.

0. **Regressione, da fare per primo**: aggiungere al carrello, cambiare quantità, rimuovere una
   riga. Tutto deve funzionare normalmente.
1. Check-out dalla pagina carrello senza dati → si apre il modale.
2. Check-out dal cart drawer → si apre il modale.
3. P.IVA `aaaa`, poi `RSSMRA80A01H501U`, poi `1234567001` → errore inline, nessun redirect.
4. `12345670017` e `IT 12345670017` → passano.
5. SDI `0000000` senza PEC → errore; con PEC → passa.
6. Rete staccata al salvataggio → messaggio nel modale, nessun redirect.
7. Riaprire il modale → campi precompilati.
8. Ordine di prova completato → dati nei *Dettagli aggiuntivi* dell'ordine.
9. Tastiera (Tab, Esc) e mobile.
