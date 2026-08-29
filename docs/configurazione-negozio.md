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

I pagamenti rapidi portano dalla scheda prodotto direttamente al check-out, saltando la
pagina carrello e quindi il modale.

- **Impostazioni → Check-out → Pagamenti accelerati**: disattivare Shop Pay, PayPal,
  Google Pay, Apple Pay.
- **Tema**: rimuovere `{{ form | payment_button }}` dal template prodotto.
  In alternativa l'app li nasconde via CSS finché i dati mancano (impostazione
  *"Nascondi i pagamenti rapidi"*), ma disattivarli del tutto è più pulito.
- **Canale Shop**: valutare la disattivazione. L'app Shop ha un proprio percorso
  d'acquisto che non passa dal tema.

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

## 6. Cutover da GetFiscal

1. Provare tutto su un tema duplicato non pubblicato.
2. Attivare l'app embed sul tema live.
3. Fare un ordine reale di prova e verificare che i dati compaiano nei **Dettagli aggiuntivi**
   dell'ordine.
4. **Solo dopo**: disinstallare GetFiscal e rimuovere il CSS che nascondeva il campo
   codice fiscale.
5. Non toccare gli ordini storici: gli attributi `getfiscal_*` già acquisiti restano dove sono.

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
