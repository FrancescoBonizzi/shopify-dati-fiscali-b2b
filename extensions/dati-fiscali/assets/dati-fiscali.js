/**
 * Dati Fiscali B2B — raccolta obbligatoria dei dati per la fattura elettronica.
 *
 * Il file non fa nulla al momento dell'import: il blocco app embed chiama avvia().
 * I validatori arrivano da validatori.js, caricato dal suo URL sulla CDN di Shopify.
 */

const CHIAVI = {
  tipoCliente: 'tipo_cliente',
  ragioneSociale: 'ragione_sociale',
  partitaIva: 'partita_iva',
  codiceSdi: 'codice_sdi',
  pec: 'pec',
  validati: 'dati_fiscali_validati',
  versione: 'dati_fiscali_versione',
};

/** Chiavi della vecchia app GetFiscal: usate solo per precompilare il modale. */
const CHIAVI_LEGACY = {
  ragioneSociale: 'getfiscal_company',
  partitaIva: 'getfiscal_vat',
  codiceSdi: 'getfiscal_sdi',
  pec: 'getfiscal_pec',
};

const CAMPI = ['ragioneSociale', 'partitaIva', 'codiceSdi', 'pec'];
const CHIAVE_LOCALE = 'dati-fiscali-b2b';

const SELETTORI_CHECKOUT = [
  '[name="checkout"]',
  'a[href$="/checkout"]',
  'a[href*="/checkout?"]',
  'a[href*="/cart/checkout"]',
  '[data-checkout-trigger]',
  '#checkout',
].join(', ');

let config = {};
let validatori = null;
/** null = non ancora noto. Altrimenti { ok, dati }. */
let stato = null;
let modale;
let form;
let bottone;
let apertoAutomaticamente = false;
/** 'checkout' se il modale nasce da un tentativo di check-out, 'auto' se dalla pagina carrello. */
let motivoApertura = 'checkout';

export async function avvia() {
  config = leggiConfig();
  modale = document.getElementById('dati-fiscali-modale');
  form = document.getElementById('df-form');
  bottone = document.getElementById('df-conferma');

  if (!modale || !form) {
    console.warn('[dati-fiscali] markup del modale non trovato');
    return;
  }

  // I listener vanno registrati subito: un click puo' arrivare prima che il
  // carrello sia stato letto. In quel caso intercettiamo e decidiamo dopo.
  registraGate();
  applicaColori();

  if (config.nascondiPagamentiRapidi) {
    document.documentElement.dataset.dfNascondiRapidi = '1';
  }

  form.addEventListener('submit', alSalvataggio);
  modale.addEventListener('close', () => {
    if (modale.returnValue === 'annulla') log('modale chiuso senza salvare');
  });

  validatori = await import(config.urlValidatori);
  await aggiornaStato();

  if (config.apriSuCarrello && sullaPaginaCarrello() && !apertoAutomaticamente && stato && !stato.ok) {
    apertoAutomaticamente = true;
    apriModale('auto');
  }

  window.addEventListener('pageshow', (e) => {
    if (e.persisted) aggiornaStato();
  });
}

/* ------------------------------------------------------------------ config */

function leggiConfig() {
  const nodo = document.getElementById('dati-fiscali-config');
  try {
    return JSON.parse(nodo.textContent);
  } catch (errore) {
    console.error('[dati-fiscali] configurazione non leggibile', errore);
    return {};
  }
}

function log(...argomenti) {
  if (config.log) console.info('[dati-fiscali]', ...argomenti);
}

function percorso(relativo) {
  const radice = (config.radiceNegozio || '/').replace(/\/+$/, '');
  return `${radice}/${relativo}`;
}

/* ------------------------------------------------------------- stato carrello */

async function aggiornaStato() {
  if (!validatori) validatori = await import(config.urlValidatori);

  let carrello;
  try {
    const risposta = await fetch(percorso('cart.js'), { headers: { Accept: 'application/json' } });
    if (!risposta.ok) throw new Error(`HTTP ${risposta.status}`);
    carrello = await risposta.json();
  } catch (errore) {
    // Se il carrello non e' leggibile non blocchiamo il negozio: il gate e' UX,
    // non sicurezza, e un errore di rete non deve impedire di comprare.
    console.warn('[dati-fiscali] carrello non leggibile', errore);
    stato = { ok: true, dati: {} };
    document.documentElement.dataset.dfStato = 'completi';
    return stato;
  }

  const dati = datiDaAttributi(carrello.attributes);
  // Carrello vuoto: non c'e' nulla da bloccare.
  const ok = !carrello.item_count
    || validatori.validaDatiFiscali(dati, { ammettiPa: !!config.ammettiPa }).ok;
  stato = { ok, dati };

  document.documentElement.dataset.dfStato = stato.ok ? 'completi' : 'incompleti';
  log('stato', stato);
  return stato;
}

function datiDaAttributi(attributi = {}) {
  const prendi = (chiave, chiaveLegacy) =>
    String(attributi[chiave] ?? attributi[chiaveLegacy] ?? '').trim();

  return {
    ragioneSociale: prendi(CHIAVI.ragioneSociale, CHIAVI_LEGACY.ragioneSociale),
    partitaIva: prendi(CHIAVI.partitaIva, CHIAVI_LEGACY.partitaIva),
    codiceSdi: prendi(CHIAVI.codiceSdi, CHIAVI_LEGACY.codiceSdi),
    pec: prendi(CHIAVI.pec, CHIAVI_LEGACY.pec),
  };
}

/* ---------------------------------------------------------------------- gate */

function registraGate() {
  const selettori = [SELETTORI_CHECKOUT, config.selettoriExtra].filter(Boolean).join(', ');

  document.addEventListener(
    'click',
    (evento) => {
      const trigger = evento.target instanceof Element ? evento.target.closest(selettori) : null;
      if (!trigger) return;
      if (stato && stato.ok) return;
      ferma(evento);
      tentativoCheckout();
    },
    true,
  );

  document.addEventListener(
    'submit',
    (evento) => {
      const modulo = evento.target;
      if (!(modulo instanceof HTMLFormElement)) return;
      if (!modulo.matches('form[action*="/cart"]')) return;
      // Senza submitter non sappiamo se e' un aggiornamento quantita': non intercettiamo.
      if (!evento.submitter || evento.submitter.name !== 'checkout') return;
      if (stato && stato.ok) return;
      ferma(evento);
      tentativoCheckout();
    },
    true,
  );
}

function ferma(evento) {
  evento.preventDefault();
  evento.stopPropagation();
  evento.stopImmediatePropagation();
}

/** Chiamato quando l'utente prova ad andare al check-out con dati non validi o non ancora noti. */
async function tentativoCheckout() {
  if (!stato || !validatori) {
    // Corsa fra il click e la lettura del carrello: risolviamo e proseguiamo.
    if (!validatori) validatori = await import(config.urlValidatori);
    await aggiornaStato();
    if (stato.ok) {
      vaiAlCheckout();
      return;
    }
  }
  apriModale();
}

function vaiAlCheckout() {
  window.location.href = percorso('checkout');
}

function sullaPaginaCarrello() {
  const attuale = window.location.pathname.replace(/\/+$/, '');
  return attuale === percorso('cart').replace(/\/+$/, '');
}

/* -------------------------------------------------------------------- modale */

function apriModale(motivo = 'checkout') {
  motivoApertura = motivo;
  precompila();
  pulisciErrori();
  if (!modale.open) modale.showModal();
  const primoVuoto = CAMPI.map(campoInput).find((input) => input && !input.value);
  (primoVuoto || campoInput('ragioneSociale')).focus();
}

function campoInput(nome) {
  return form.elements.namedItem(nome);
}

function precompila() {
  const salvati = leggiDaLocalStorage();
  const daCarrello = (stato && stato.dati) || {};

  for (const nome of CAMPI) {
    const input = campoInput(nome);
    if (!input || input.value) continue;
    input.value = daCarrello[nome] || salvati[nome] || '';
  }
}

function leggiDaLocalStorage() {
  try {
    return JSON.parse(window.localStorage.getItem(CHIAVE_LOCALE)) || {};
  } catch {
    return {};
  }
}

function scriviInLocalStorage(valori) {
  try {
    window.localStorage.setItem(CHIAVE_LOCALE, JSON.stringify(valori));
  } catch {
    /* modalita' privata o storage pieno: non e' un problema */
  }
}

function pulisciErrori() {
  form.querySelectorAll('.df-errore').forEach((nodo) => {
    nodo.textContent = '';
  });
  document.getElementById('df-errore-generale').textContent = '';
  CAMPI.forEach((nome) => campoInput(nome)?.removeAttribute('aria-invalid'));
}

function mostraErrori(errori) {
  pulisciErrori();
  for (const [campo, messaggio] of Object.entries(errori)) {
    const nodo = document.getElementById(`df-errore-${campo}`);
    if (nodo) nodo.textContent = messaggio;
    campoInput(campo)?.setAttribute('aria-invalid', 'true');
  }
  const primo = Object.keys(errori).find((campo) => campoInput(campo));
  if (primo) campoInput(primo).focus();
}

function erroreGenerale(messaggio) {
  document.getElementById('df-errore-generale').textContent = messaggio;
}

/* ---------------------------------------------------------------- salvataggio */

async function alSalvataggio(evento) {
  evento.preventDefault();

  const inseriti = Object.fromEntries(CAMPI.map((nome) => [nome, campoInput(nome).value]));
  const esito = validatori.validaDatiFiscali(inseriti, { ammettiPa: !!config.ammettiPa });

  if (!esito.ok) {
    mostraErrori(esito.errori);
    return;
  }

  pulisciErrori();
  bottone.disabled = true;

  try {
    await salvaNelCarrello(esito.valori);
    scriviInLocalStorage(esito.valori);
    stato = { ok: true, dati: esito.valori };
    document.documentElement.dataset.dfStato = 'completi';

    if (motivoApertura === 'checkout') {
      vaiAlCheckout();
    } else {
      // Aperto da solo sulla pagina carrello: l'utente non aveva chiesto di pagare.
      modale.close('salvato');
      bottone.disabled = false;
    }
  } catch (errore) {
    console.error('[dati-fiscali] salvataggio non riuscito', errore);
    erroreGenerale(
      'Non siamo riusciti a salvare i dati. Controlla la connessione e riprova: l’ordine non è stato avviato.',
    );
    bottone.disabled = false;
  }
}

async function salvaNelCarrello(valori) {
  const risposta = await fetch(percorso('cart/update.js'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      attributes: {
        [CHIAVI.tipoCliente]: 'azienda',
        [CHIAVI.ragioneSociale]: valori.ragioneSociale,
        [CHIAVI.partitaIva]: valori.partitaIva,
        [CHIAVI.codiceSdi]: valori.codiceSdi,
        [CHIAVI.pec]: valori.pec,
        // Scritto solo dopo che il validatore e' passato: e' il flag che permette
        // di distinguere a colpo d'occhio gli ordini raccolti dal modale.
        [CHIAVI.validati]: '1',
        [CHIAVI.versione]: validatori.VERSIONE_VALIDATORE,
      },
    }),
  });

  if (!risposta.ok) throw new Error(`HTTP ${risposta.status}`);
  return risposta.json();
}

/* -------------------------------------------------------------------- colori */

function applicaColori() {
  const radice = document.documentElement.style;
  radice.setProperty('--df-raggio', `${config.raggioBordi ?? 8}px`);

  const manuale = () => {
    if (config.colorePrimario) radice.setProperty('--df-primario', config.colorePrimario);
    if (config.coloreTestoPrimario) {
      radice.setProperty('--df-primario-testo', config.coloreTestoPrimario);
    }
  };

  if (config.modalitaColore !== 'auto') {
    manuale();
    return;
  }

  const dalTema = coloriDalTema();
  if (!dalTema) {
    log('colori del tema non rilevati, uso quelli delle impostazioni');
    manuale();
    return;
  }

  radice.setProperty('--df-primario', dalTema.sfondo);
  radice.setProperty('--df-primario-testo', dalTema.testo);
  log('colori copiati dal tema', dalTema);
}

/** Copia i colori dal primo bottone "primario" reale che troviamo nel tema. */
function coloriDalTema() {
  const candidati = [
    '[name="checkout"]',
    '.shopify-payment-button__button--unbranded',
    '.button--primary',
    '.btn--primary',
    '.button:not(.button--secondary):not(.button--tertiary)',
  ];

  for (const selettore of candidati) {
    const elemento = document.querySelector(selettore);
    if (!elemento) continue;
    const stile = window.getComputedStyle(elemento);
    if (opaco(stile.backgroundColor)) {
      return { sfondo: stile.backgroundColor, testo: stile.color };
    }
  }
  return null;
}

function opaco(colore) {
  if (!colore) return false;
  if (colore === 'transparent') return false;
  const alfa = colore.match(/rgba?\([^)]*?,\s*([\d.]+)\s*\)/);
  return !alfa || Number.parseFloat(alfa[1]) > 0.1;
}
