/**
 * Validatori dei dati fiscali italiani per la fatturazione elettronica B2B.
 *
 * Unica fonte di verita': questo file e' importato sia dal modale nello storefront
 * (come ES module servito dalla CDN di Shopify) sia dai test Node.
 * Per questo non tocca il DOM e non ha dipendenze.
 */

export const VERSIONE_VALIDATORE = '1.0.0';

/** Codici ufficio provinciale ammessi oltre all'intervallo 001-100. */
const UFFICI_SPECIALI = [120, 121, 888, 999];

/** Codice destinatario che significa "recapito non disponibile": impone la PEC. */
export const SDI_NON_DISPONIBILE = '0000000';

const testo = (raw) => String(raw ?? '').trim();

/** Toglie spazi, punti, trattini e il prefisso IT. */
export function normalizzaPartitaIva(raw) {
  return testo(raw).replace(/[\s.\-_]/g, '').toUpperCase().replace(/^IT/, '');
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
  ragioneSocialeMancante: 'Inserisci la ragione sociale dell’azienda.',
  partitaIvaMancante: 'Inserisci la partita IVA dell’azienda.',
  partitaIvaNonValida:
    'Partita IVA non valida: servono 11 cifre. Il codice fiscale a 16 caratteri non è accettato.',
  recapitoMancante:
    'Serve un recapito per la fattura elettronica: inserisci il codice SDI oppure la PEC.',
  codiceSdiNonValido: 'Il codice destinatario SDI deve avere 7 caratteri alfanumerici.',
  codiceSdiNonValidoPa:
    'Il codice destinatario deve avere 7 caratteri (6 per la Pubblica Amministrazione).',
  pecNonValida: 'Indirizzo PEC non valido.',
  sdiZeriSenzaPec:
    'Con codice SDI 0000000 la PEC è obbligatoria: è l’unico recapito rimasto per la fattura.',
};

/**
 * Valida il set completo di dati fiscali.
 * @returns {{ok: boolean, valori: object, errori: Object<string,string>}}
 *          `valori` contiene i dati normalizzati, pronti per il carrello.
 */
export function validaDatiFiscali(dati = {}, { ammettiPa = false } = {}) {
  const valori = {
    ragioneSociale: normalizzaRagioneSociale(dati.ragioneSociale),
    partitaIva: normalizzaPartitaIva(dati.partitaIva),
    codiceSdi: normalizzaCodiceSdi(dati.codiceSdi),
    pec: normalizzaPec(dati.pec),
  };

  const errori = {};

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
