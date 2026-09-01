# Configurazione del negozio

Passi da fare nell'admin Shopify, **oltre** all'installazione dell'app. Alcuni valgono
più dell'app stessa: il campo "Nome azienda" obbligatorio è l'unico controllo di questo
progetto che gira sui server di Shopify e che nessuno può aggirare.

## 1. Campo azienda obbligatorio (importante)

**Impostazioni → Check-out → Moduli del check-out → Nome azienda: Obbligatorio**

Disponibile su tutti i piani. Shopify rifiuta il check-out se il campo è vuoto, senza
JavaScript di mezzo. Il valore finisce nell'indirizzo dell'ordine, quindi compare anche
nell'export CSV standard degli ordini.

Questo si somma alla ragione sociale raccolta dal modale: la prima è la garanzia,
la seconda è il dato che usi in fattura.

## 2. Chiudere i percorsi che saltano il carrello

I pagamenti rapidi non sono tutti uguali, e trattarli allo stesso modo è un errore.

**"Compra ora" sulla scheda prodotto** (`.shopify-payment-button`) crea un check-out
partendo dal form del prodotto, **senza passare dal carrello**: gli attributi fiscali non
ci arriverebbero mai, nemmeno se il cliente li avesse compilati poco prima. Va nascosto
**sempre**, ed è quello che fa l'app quando *"Nascondi i pagamenti rapidi"* è attivo. Per
toglierlo alla radice: disattivare il pulsante di pagamento dinamico nelle impostazioni
della sezione prodotto del tema, oppure rimuovere `{{ form | payment_button }}` dal
template.

**I wallet della pagina carrello** (`shopify-accelerated-checkout-cart`) partono invece
dal carrello esistente, quindi si portano dietro gli attributi. L'app li nasconde solo
finché i dati mancano e li rimostra appena sono validi: disattivarli del tutto non serve.

> Da verificare con un ordine vero, prima di fidarsene: che gli attributi del carrello
> arrivino davvero fino all'ordine anche passando dal wallet. Se non arrivassero, vanno
> nascosti sempre come il "Compra ora".

Per disattivarli lato server: **Impostazioni → Pagamenti → Check-out accelerati** — sotto
*Pagamenti*, non sotto *Check-out*. Attenzione: toglie il wallet anche dal check-out vero
e proprio, dove è legittimo e utile. Raramente ne vale la pena.

**Canale Shop**: valutare la disattivazione. L'app Shop ha un proprio percorso d'acquisto
che non passa dal tema.

## 3. Verifiche sul tema

- Cercare link `/checkout` scritti a mano nel tema, negli upsell e nelle email.
- Individuare i selettori dei bottoni di check-out del tema in uso: se non rientrano fra
  quelli standard, aggiungerli nell'impostazione *"Selettori CSS aggiuntivi"* dell'app
  embed block.

## 4. Perimetro Italia

- **Impostazioni → Spedizione e consegna**: verificare che le zone siano limitate all'Italia.
  Il validatore accetta solo partite IVA italiane a 11 cifre.
- Verificare i campi fiscali italiani nativi di Shopify (Codice fiscale e PEC, visibili al
  check-out quando le imposte UE sono configurate) e l'eventuale CSS che oggi li nasconde:
  vanno gestiti in modo coerente con il modale, per non chiedere due volte le stesse cose.

## 5. Attivazione dell'app

**Negozio online → Temi → Personalizza → Impostazioni app** → attivare *Dati fiscali B2B*.

Impostazioni disponibili lì: colori (automatici dal tema o scelti a mano), testi del modale,
apertura automatica sulla pagina carrello, gestione dei pagamenti rapidi, codici destinatario
a 6 caratteri per la Pubblica Amministrazione.

## 6. Collaudo e cutover

`shopify app dev` richiede un development store o una sandbox Plus: su un negozio di
produzione non si può usare. Il collaudo si fa quindi sul negozio reale, ma su un tema che
nessun cliente vede.

1. **Negozio online → Temi → ⋯ sul tema live → Duplica.**
2. Sul duplicato: **⋯ → Modifica → Impostazioni tema → App embeds** → attivare
   *Dati fiscali B2B*, e **disattivare l'app embed della vecchia app**. Il duplicato ha
   ereditato anche quella: con due modali attivi si contendono il click sul bottone di
   check-out e i risultati del test non valgono niente.
3. Salvare, aprire l'**Anteprima** e percorrere la lista di test manuali del README,
   partendo dal test 0 (aggiungi, cambia quantità, rimuovi).
4. **Pubblicare il duplicato.** Un'unica azione manda live esattamente la configurazione
   collaudata, e il vecchio tema resta nella libreria come rollback: se qualcosa va storto
   lo si ripubblica in dieci secondi. Verificare prima che nessuno abbia modificato il tema
   live dopo la duplicazione, altrimenti quelle modifiche si perdono.
5. Fare un **ordine reale di prova** e verificare che i dati compaiano nei
   **Dettagli aggiuntivi** dell'ordine.
6. **Solo dopo**: disinstallare la vecchia app e ripulire il CSS lasciato da lei nel tema
   (tipicamente regole che nascondevano campi del suo modale, che ora puntano a elementi
   inesistenti).
7. Non toccare gli ordini storici: gli attributi `getfiscal_*` già acquisiti restano dove
   sono.

Il rollback dell'estensione è indipendente da quello del tema, e altrettanto rapido:

```bash
shopify app release --version=<versione-precedente> --allow-updates
```

## Opzionale — rete di sicurezza con Shopify Flow

Non è un blocco, è un allarme: serve a intercettare gli ordini che arrivano senza dati validi
(chi digita `/checkout` a mano) **prima** di spedirli. Flow è gratuito dal piano Basic in su.

1. *Order created* → **Add order tags**, valore calcolato in Liquid: se l'attributo
   `dati_fiscali_validati` non vale `1`, tag `dati-fiscali-da-verificare`.
2. *Order tags added*, condizione tag = `dati-fiscali-da-verificare` → **Hold fulfillment order**
   (con motivo e note) + **Send internal email**.

Attenzione a cosa fa davvero l'hold: l'ordine esiste comunque, il pagamento con la cattura
automatica è già incassato, e qualsiasi operatore può rilasciare la sospensione in due clic.
Per irrigidirlo: **Impostazioni → Pagamenti → Cattura del pagamento: all'evasione**, così un
ordine da annullare non genera né incasso da fatturare né commissioni di rimborso.
