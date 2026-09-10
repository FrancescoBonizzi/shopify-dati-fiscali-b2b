/**
 * Validatori dei dati fiscali italiani per la fatturazione elettronica B2B.
 *
 * Unica fonte di verita': questo file e' importato sia dal modale nello storefront
 * (come ES module servito dalla CDN di Shopify) sia dai test Node.
 * Per questo non tocca il DOM e non ha dipendenze.
 */

export const VERSIONE_VALIDATORE = '1.1.0';

/**
 * Tipo di cliente. Decide se il codice fiscale è obbligatorio: le società hanno
 * un codice fiscale numerico che coincide con la partita IVA, le persone fisiche
 * con partita IVA (ditte individuali e liberi professionisti) ne hanno uno diverso,
 * a 16 caratteri, e senza quello il Sistema di Interscambio scarta la fattura.
 *
 * 'azienda' è anche il valore che la versione 1.0.0 scriveva per tutti: tenerlo
 * significa che i carrelli già compilati restano validi.
 */
export const TIPI_CLIENTE = {
  azienda: 'azienda',
  dittaIndividuale: 'ditta_individuale',
};

/** Codici ufficio provinciale ammessi oltre all'intervallo 001-100. */
const UFFICI_SPECIALI = [120, 121, 888, 999];

/** Codice destinatario che significa "recapito non disponibile": impone la PEC. */
export const SDI_NON_DISPONIBILE = '0000000';

const testo = (raw) => String(raw ?? '').trim();

/** Toglie spazi, punti, trattini e il prefisso IT. */
export function normalizzaPartitaIva(raw) {
  return testo(raw).replace(/[\s.\-_]/g, '').toUpperCase().replace(/^IT/, '');
}

/** Come la partita IVA, ma senza togliere IT: un codice fiscale può iniziare per IT. */
export function normalizzaCodiceFiscale(raw) {
  return testo(raw).replace(/[\s.\-_]/g, '').toUpperCase();
}

export function normalizzaCodiceSdi(raw) {
  return testo(raw).replace(/\s/g, '').toUpperCase();
}

export function normalizzaPec(raw) {
  return testo(raw).toLowerCase();
}

export function normalizzaRagioneSociale(raw) {
  return testo(raw).replace(/\s+/g, ' ');
}

/** Restituisce uno dei due tipi ammessi, oppure '' se non è stato scelto nulla. */
export function normalizzaTipoCliente(raw) {
  const s = testo(raw).toLowerCase();
  return s === TIPI_CLIENTE.azienda || s === TIPI_CLIENTE.dittaIndividuale ? s : '';
}

/**
 * Partita IVA italiana: 11 cifre, codice ufficio provinciale esistente,
 * cifra di controllo secondo la variante italiana dell'algoritmo di Luhn.
 * Non verifica l'esistenza reale presso l'Agenzia delle Entrate: impossibile senza rete.
 */
export function partitaIvaValida(raw) {
  const s = normalizzaPartitaIva(raw);

  // 1. esattamente 11 cifre: esclude il codice fiscale a 16 caratteri e le stringhe alfabetiche
  if (!/^\d{11}$/.test(s)) return false;

  // 2. esclude i ripetitivi (00000000000, 11111111111, ...) che passerebbero il checksum
  if (/^(\d)\1{10}$/.test(s)) return false;

  // 3. cifre 8-10 = codice dell'ufficio provinciale: 001-100, oppure 120, 121, 888, 999
  const ufficio = Number.parseInt(s.slice(7, 10), 10);
  if (!((ufficio >= 1 && ufficio <= 100) || UFFICI_SPECIALI.includes(ufficio))) return false;

  // 4. checksum: le cifre in posizione pari (1-based) si raddoppiano, se >9 si sottrae 9;
  //    la cifra di controllo e' inclusa nella somma, che deve essere multiplo di 10
  let somma = 0;
  for (let i = 0; i < 11; i += 1) {
    let n = s.charCodeAt(i) - 48;
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    somma += n;
  }
  return somma % 10 === 0;
}

/* ------------------------------------------------------------ codice fiscale */

const ALFANUMERICI = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LETTERE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Valori dei caratteri in posizione dispari (1-based) per il carattere di controllo.
 * Indicizzati come ALFANUMERICI: prima le dieci cifre, poi le ventisei lettere.
 * In posizione pari il valore è semplicemente la posizione nell'alfabeto.
 */
const VALORI_DISPARI = [
  1, 0, 5, 7, 9, 13, 15, 17, 19, 21,
  1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23,
];

/** In posizione pari il valore è la cifra stessa, o la posizione della lettera nell'alfabeto. */
const valorePari = (posto) => (posto < 10 ? posto : posto - 10);

/** Il sedicesimo carattere, calcolato dai primi quindici. */
function carattereDiControllo(codice) {
  let somma = 0;
  for (let i = 0; i < 15; i += 1) {
    const posto = ALFANUMERICI.indexOf(codice[i]);
    // i indicizza da 0, la norma conta da 1: gli indici pari sono le posizioni dispari
    somma += i % 2 === 0 ? VALORI_DISPARI[posto] : valorePari(posto);
  }
  return LETTERE[somma % 26];
}

/**
 * Codice fiscale di persona fisica: 16 caratteri alfanumerici, carattere di controllo
 * che torna. Nient'altro.
 *
 * Di proposito non controlliamo la struttura interna (lettera del mese, codice catastale
 * del comune, posizioni dell'omocodia): è la parte che rifiuta codici veri quando una
 * delle assunzioni è sbagliata, e aggiunge poco, perché il carattere di controllo scarta
 * già i refusi e le stringhe inventate. Senza vincolo posizionale, per inciso, i codici
 * con omocodia passano da soli.
 *
 * Il codice fiscale numerico a 11 cifre non è accettato: appartiene alle società, dove
 * coincide con la partita IVA, e li' il campo va lasciato vuoto.
 */
export function codiceFiscaleValido(raw) {
  const s = normalizzaCodiceFiscale(raw);
  if (!/^[A-Z0-9]{16}$/.test(s)) return false;
  return s[15] === carattereDiControllo(s);
}

/* ------------------------------------------------------------------ recapito */

/**
 * Codice destinatario SDI.
 * 7 caratteri alfanumerici per i privati; 6 per la Pubblica Amministrazione
 * (Codice Univoco Ufficio IPA), accettati solo se `ammettiPa` e' attivo.
 * "0000000" e' un valore legittimo ma impone la PEC: vedi sdiAssente().
 */
export function codiceSdiValido(raw, { ammettiPa = false } = {}) {
  const s = normalizzaCodiceSdi(raw);
  return ammettiPa ? /^[A-Z0-9]{6,7}$/.test(s) : /^[A-Z0-9]{7}$/.test(s);
}

/** true se il codice SDI e' formalmente valido ma significa "recapito non disponibile". */
export function sdiAssente(raw) {
  return normalizzaCodiceSdi(raw) === SDI_NON_DISPONIBILE;
}

export function pecValida(raw) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizzaPec(raw));
}

export function ragioneSocialeValida(raw) {
  return normalizzaRagioneSociale(raw).length >= 2;
}

export const MESSAGGI = {
  tipoClienteMancante:
    'Indica se la fattura va intestata a una società o a una ditta individuale.',
  ragioneSocialeMancante: 'Inserisci la ragione sociale dell’azienda.',
  partitaIvaMancante: 'Inserisci la partita IVA dell’azienda.',
  partitaIvaNonValida:
    'Partita IVA non valida: servono 11 cifre. Il codice fiscale a 16 caratteri va nel campo dedicato.',
  codiceFiscaleMancante:
    'Ditte individuali e liberi professionisti devono indicare anche il codice fiscale del titolare.',
  codiceFiscaleUgualePartitaIva:
    'Il codice fiscale non può coincidere con la partita IVA: serve quello a 16 caratteri del titolare.',
  codiceFiscaleNonValido:
    'Codice fiscale non valido: servono 16 caratteri e il carattere di controllo finale non torna.',
  recapitoMancante:
    'Serve un recapito per la fattura elettronica: inserisci il codice SDI oppure la PEC.',
  codiceSdiNonValido: 'Il codice destinatario SDI deve avere 7 caratteri alfanumerici.',
  codiceSdiNonValidoPa:
    'Il codice destinatario deve avere 7 caratteri (6 per la Pubblica Amministrazione).',
  pecNonValida: 'Indirizzo PEC non valido.',
  sdiZeriSenzaPec:
    'Con codice SDI 0000000 la PEC è obbligatoria: è l’unico recapito rimasto per la fattura.',
};

/**
 * Valida il set completo di dati fiscali.
 * @returns {{ok: boolean, valori: object, errori: Object<string,string>}}
 *          `valori` contiene i dati normalizzati, pronti per il carrello.
 */
export function validaDatiFiscali(dati = {}, { ammettiPa = false } = {}) {
  const tipoCliente = normalizzaTipoCliente(dati.tipoCliente);
  const personaFisica = tipoCliente === TIPI_CLIENTE.dittaIndividuale;

  const valori = {
    tipoCliente,
    ragioneSociale: normalizzaRagioneSociale(dati.ragioneSociale),
    partitaIva: normalizzaPartitaIva(dati.partitaIva),
    // Una società non deve portarsi nel carrello un codice fiscale digitato
    // prima di cambiare idea sul tipo di cliente.
    codiceFiscale: personaFisica ? normalizzaCodiceFiscale(dati.codiceFiscale) : '',
    codiceSdi: normalizzaCodiceSdi(dati.codiceSdi),
    pec: normalizzaPec(dati.pec),
  };

  const errori = {};

  if (!valori.tipoCliente) {
    errori.tipoCliente = MESSAGGI.tipoClienteMancante;
  }

  if (!valori.ragioneSociale) {
    errori.ragioneSociale = MESSAGGI.ragioneSocialeMancante;
  } else if (!ragioneSocialeValida(valori.ragioneSociale)) {
    errori.ragioneSociale = MESSAGGI.ragioneSocialeMancante;
  }

  if (!valori.partitaIva) {
    errori.partitaIva = MESSAGGI.partitaIvaMancante;
  } else if (!partitaIvaValida(valori.partitaIva)) {
    errori.partitaIva = MESSAGGI.partitaIvaNonValida;
  }

  // Codice fiscale: solo per le persone fisiche, e in quest'ordine, perche' chi
  // copia la partita IVA deve leggere il motivo vero invece di "non valido".
  if (personaFisica) {
    if (!valori.codiceFiscale) {
      errori.codiceFiscale = MESSAGGI.codiceFiscaleMancante;
      // Confrontata con la normalizzazione della partita IVA, cosi' "IT12345670017"
      // e "123.456.700.17" vengono riconosciuti per quello che sono.
    } else if (valori.partitaIva && normalizzaPartitaIva(valori.codiceFiscale) === valori.partitaIva) {
      errori.codiceFiscale = MESSAGGI.codiceFiscaleUgualePartitaIva;
    } else if (!codiceFiscaleValido(valori.codiceFiscale)) {
      errori.codiceFiscale = MESSAGGI.codiceFiscaleNonValido;
    }
  }

  // Recapito per la fattura elettronica: SDI utile OPPURE PEC valida.
  const sdiFormalmenteValido = valori.codiceSdi
    ? codiceSdiValido(valori.codiceSdi, { ammettiPa })
    : false;
  const sdiUtile = sdiFormalmenteValido && !sdiAssente(valori.codiceSdi);
  const pecOk = valori.pec ? pecValida(valori.pec) : false;

  if (!sdiUtile && !pecOk) {
    if (!valori.codiceSdi && !valori.pec) {
      errori.recapito = MESSAGGI.recapitoMancante;
    }
    if (valori.codiceSdi && !sdiFormalmenteValido) {
      errori.codiceSdi = ammettiPa ? MESSAGGI.codiceSdiNonValidoPa : MESSAGGI.codiceSdiNonValido;
    }
    if (valori.pec && !pecOk) {
      errori.pec = MESSAGGI.pecNonValida;
    }
    if (sdiFormalmenteValido && sdiAssente(valori.codiceSdi) && !pecOk && !valori.pec) {
      errori.pec = MESSAGGI.sdiZeriSenzaPec;
    }
  }

  return { ok: Object.keys(errori).length === 0, valori, errori };
}
