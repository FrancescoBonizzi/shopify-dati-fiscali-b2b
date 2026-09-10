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
  codiceFiscale: 'codice_fiscale',
  codiceSdi: 'codice_sdi',
  pec: 'pec',
  validati: 'dati_fiscali_validati',
  versione: 'dati_fiscali_versione',
};

/**
 * Solo i campi testuali. Il gruppo radio del tipo cliente sta fuori di proposito:
 * form.elements.namedItem() restituisce una RadioNodeList, che non ha setAttribute
 * né focus, e passarla dove passano gli input romperebbe la gestione degli errori.
 */
const CAMPI = ['ragioneSociale', 'partitaIva', 'codiceFiscale', 'codiceSdi', 'pec'];
const CHIAVE_LOCALE = 'dati-fiscali-b2b';

const TIPO_DITTA_INDIVIDUALE = 'ditta_individuale';

/**
 * Quanto vale la precompilazione salvata nel browser. Oltre, i campi ripartono vuoti:
 * a distanza di mesi un recapito o una ragione sociale possono essere cambiati, e i
 * campi gia' pieni si confermano per inerzia. Non tocca il gate, che guarda solo il
 * carrello: il modale si apre comunque e chiede conferma a ogni carrello nuovo.
 */
const DURATA_MEMORIA_LOCALE = 90 * 24 * 60 * 60 * 1000;

/** Un professionista non ha una ragione sociale: l'etichetta segue il tipo di cliente. */
const ETICHETTE_RAGIONE_SOCIALE = {
  azienda: 'Ragione sociale',
  ditta_individuale: 'Nome e cognome o ditta',
};

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
/** true appena il cliente tocca i radio: da li' in poi la sua scelta non si sovrascrive. */
let tipoClienteToccato = false;
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

  osservaMutazioniCarrello();

  form.addEventListener('submit', alSalvataggio);
  form.addEventListener('change', (evento) => {
    if (evento.target instanceof Element && evento.target.name === 'tipoCliente') {
      tipoClienteToccato = true;
      aggiornaTipoCliente();
    }
  });
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

/* ------------------------------------------------- mutazioni del carrello */

const MUTAZIONI_CARRELLO = /\/cart\/(add|change|update|clear)(\.js)?(\?|$)/;

/**
 * I temi aggiungono al carrello via AJAX senza ricaricare la pagina: senza
 * questo, lo stato resta quello del primo caricamento e la CSS continua a
 * mostrare i pagamenti rapidi anche dopo che il carrello si e' riempito.
 * Avvolgiamo fetch e XMLHttpRequest senza alterarne il comportamento.
 */
function osservaMutazioniCarrello() {
  // Idempotente: avvolgere due volte moltiplicherebbe le letture del carrello.
  if (window.__datiFiscaliOsserva) return;
  window.__datiFiscaliOsserva = true;

  const fetchOriginale = window.fetch;
  if (typeof fetchOriginale === 'function') {
    window.fetch = function (...argomenti) {
      const risultato = fetchOriginale.apply(this, argomenti);
      try {
        const primo = argomenti[0];
        const url = String((primo && primo.url) || primo || '');
        if (MUTAZIONI_CARRELLO.test(url) && typeof risultato?.then === 'function') {
          risultato.then(() => aggiornaStato()).catch(() => {});
        }
      } catch (errore) {
        // Non deve mai rompere il fetch del tema.
      }
      return risultato;
    };
  }

  const apriOriginale = XMLHttpRequest.prototype.open;
  const inviaOriginale = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (metodo, url, ...resto) {
    this.__dfUrl = String(url ?? '');
    return apriOriginale.call(this, metodo, url, ...resto);
  };
  XMLHttpRequest.prototype.send = function (...argomenti) {
    if (MUTAZIONI_CARRELLO.test(this.__dfUrl || '')) {
      this.addEventListener('load', () => aggiornaStato());
    }
    return inviaOriginale.apply(this, argomenti);
  };
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
    stato = { ok: true, dati: {}, datiOk: true };
    document.documentElement.dataset.dfStato = 'completi';
    document.documentElement.dataset.dfDati = 'validi';
    return stato;
  }

  const dati = datiDaAttributi(carrello.attributes);
  const datiOk = validatori.validaDatiFiscali(dati, { ammettiPa: !!config.ammettiPa }).ok;
  // Carrello vuoto: non c'e' nulla da bloccare.
  const ok = !carrello.item_count || datiOk;
  stato = { ok, dati, datiOk };

  document.documentElement.dataset.dfStato = ok ? 'completi' : 'incompleti';
  // I pagamenti rapidi vanno nascosti in base alla validita' dei dati, non al
  // verdetto del gate: "Compra ora" non passa dal carrello, quindi a carrello
  // vuoto il gate dice ok ma quel bottone porterebbe comunque al check-out.
  document.documentElement.dataset.dfDati = datiOk ? 'validi' : 'mancanti';
  log('stato', stato);
  return stato;
}

function datiDaAttributi(attributi = {}) {
  const prendi = (chiave) => String(attributi[chiave] ?? '').trim();

  return {
    tipoCliente: prendi(CHIAVI.tipoCliente),
    ragioneSociale: prendi(CHIAVI.ragioneSociale),
    partitaIva: prendi(CHIAVI.partitaIva),
    codiceFiscale: prendi(CHIAVI.codiceFiscale),
    codiceSdi: prendi(CHIAVI.codiceSdi),
    pec: prendi(CHIAVI.pec),
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

  const primoVuoto = CAMPI.map(campoInput).find((input) => input && !input.value && visibile(input));
  (primoVuoto || campoInput('ragioneSociale')).focus();
}

function campoInput(nome) {
  return form.elements.namedItem(nome);
}

/** Il campo del codice fiscale è nascosto alle società: non deve mai prendere il focus. */
function visibile(input) {
  return !input.closest('[hidden]');
}

function primoRadioTipoCliente() {
  return form.querySelector('input[name="tipoCliente"]');
}

function tipoClienteSelezionato() {
  // .value su una RadioNodeList restituisce il valore selezionato, o '' se nessuno lo è.
  return form.elements.tipoCliente?.value || '';
}

function impostaTipoCliente(valore) {
  if (form.elements.tipoCliente && valore) form.elements.tipoCliente.value = valore;
}

/** Adegua al tipo di cliente i campi che cambiano: codice fiscale ed etichetta del nome. */
function aggiornaTipoCliente() {
  const tipo = tipoClienteSelezionato();
  const contenitore = document.getElementById('df-campo-codice-fiscale');
  if (contenitore) contenitore.hidden = tipo !== TIPO_DITTA_INDIVIDUALE;

  const etichetta = document.getElementById('df-etichetta-ragione-sociale');
  if (etichetta && tipo) etichetta.textContent = ETICHETTE_RAGIONE_SOCIALE[tipo];
}

function precompila() {
  const salvati = leggiDaLocalStorage();
  const daCarrello = (stato && stato.dati) || {};

  for (const nome of CAMPI) {
    const input = campoInput(nome);
    if (!input || input.value) continue;
    input.value = daCarrello[nome] || salvati[nome] || '';
  }

  // "Societa'" e' preselezionato nel markup, quindi qui non basta guardare se c'e'
  // gia' una scelta: un tipo salvato deve poter vincere sul default, ma non su una
  // scelta appena fatta dal cliente.
  if (!tipoClienteToccato) {
    impostaTipoCliente(daCarrello.tipoCliente || salvati.tipoCliente || '');
  }
  aggiornaTipoCliente();
}

function leggiDaLocalStorage() {
  try {
    const salvato = JSON.parse(window.localStorage.getItem(CHIAVE_LOCALE));
    // Senza data e' il formato precedente: si scarta invece di indovinarne l'eta'.
    if (!salvato || typeof salvato.salvatoIl !== 'number') return {};
    if (Date.now() - salvato.salvatoIl > DURATA_MEMORIA_LOCALE) {
      window.localStorage.removeItem(CHIAVE_LOCALE);
      return {};
    }
    return salvato.valori || {};
  } catch {
    return {};
  }
}

function scriviInLocalStorage(valori) {
  try {
    window.localStorage.setItem(CHIAVE_LOCALE, JSON.stringify({ salvatoIl: Date.now(), valori }));
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
  primoRadioTipoCliente()?.removeAttribute('aria-invalid');
}

/** Il bersaglio di aria-invalid e del focus per un errore: input, o primo radio. */
function bersaglioErrore(campo) {
  if (campo === 'tipoCliente') return primoRadioTipoCliente();
  const input = campoInput(campo);
  return input instanceof HTMLElement ? input : null;
}

function mostraErrori(errori) {
  pulisciErrori();
  for (const [campo, messaggio] of Object.entries(errori)) {
    const nodo = document.getElementById(`df-errore-${campo}`);
    if (nodo) nodo.textContent = messaggio;
    bersaglioErrore(campo)?.setAttribute('aria-invalid', 'true');
  }
  const primo = Object.keys(errori).find((campo) => bersaglioErrore(campo));
  if (primo) bersaglioErrore(primo).focus();
}

function erroreGenerale(messaggio) {
  document.getElementById('df-errore-generale').textContent = messaggio;
}

/* ---------------------------------------------------------------- salvataggio */

async function alSalvataggio(evento) {
  evento.preventDefault();

  const inseriti = Object.fromEntries(CAMPI.map((nome) => [nome, campoInput(nome).value]));
  inseriti.tipoCliente = tipoClienteSelezionato();
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
        [CHIAVI.tipoCliente]: valori.tipoCliente,
        [CHIAVI.ragioneSociale]: valori.ragioneSociale,
        [CHIAVI.partitaIva]: valori.partitaIva,
        // Vuoto per le società: cancella un valore rimasto da un tentativo precedente.
        [CHIAVI.codiceFiscale]: valori.codiceFiscale,
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

  // Testo e sfondo del modale seguono il body del tema, in entrambe le modalita':
  // i grigi del modale (pannelli, bordi, etichette) sono derivati da questi due
  // in CSS, e su un tema blu notte devono venire blu notte. Solo se sono
  // entrambi pienamente opachi: con uno solo dei due si rischia testo chiaro su
  // fondo chiaro, e il ripiego nero su bianco e' sempre leggibile.
  const superficie = coloriSuperficieDalTema();
  if (superficie) {
    radice.setProperty('--df-testo', superficie.testo);
    radice.setProperty('--df-sfondo', superficie.sfondo);
  }

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

/** Colore del testo e dello sfondo della pagina: dal body, o in ripiego da <html>. */
function coloriSuperficieDalTema() {
  const testo = window.getComputedStyle(document.body).color;
  const sfondo = [document.body, document.documentElement]
    .map((elemento) => window.getComputedStyle(elemento).backgroundColor)
    .find(pienamenteOpaco);
  if (!pienamenteOpaco(testo) || !sfondo) return null;
  return { testo, sfondo };
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

/** Alfa di un colore come lo restituisce getComputedStyle: rgb()/rgba(), con le
 *  virgole o con la barra. 1 se il canale manca o il formato non e' riconosciuto.
 *  Non si prende "l'ultimo numero prima della parentesi": in rgb(0, 0, 0) quello
 *  e' il blu, e il nero puro risultava trasparente. */
function alfaDi(colore) {
  if (!colore || colore === 'transparent') return 0;
  const m = colore.match(
    /^rgba?\(\s*[\d.]+\s*[, ]\s*[\d.]+\s*[, ]\s*[\d.]+\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/,
  );
  if (!m || m[1] === undefined) return 1;
  const alfa = Number.parseFloat(m[1]);
  return m[2] ? alfa / 100 : alfa;
}

/** Abbastanza opaco da essere un colore di sfondo, e non un velo. */
function opaco(colore) {
  return alfaDi(colore) > 0.1;
}

/** Senza tolleranza: un testo al 75% di alfa non va copiato negli input. */
function pienamenteOpaco(colore) {
  return alfaDi(colore) >= 0.99;
}
