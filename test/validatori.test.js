import test from 'node:test';
import assert from 'node:assert/strict';

import {
  partitaIvaValida,
  normalizzaPartitaIva,
  codiceSdiValido,
  sdiAssente,
  pecValida,
  validaDatiFiscali,
} from '../extensions/dati-fiscali/assets/validatori.js';

test('partita IVA: casi non validi', () => {
  const nonValide = {
    'aaaa': 'non numerico',
    'RSSMRA80A01H501U': 'codice fiscale, 16 caratteri',
    '1234567001': '10 cifre',
    '123456700177': '12 cifre',
    '00000000000': 'ripetitivo',
    '11111111111': 'ripetitivo',
    '12345678901': 'codice ufficio 890 inesistente',
    '12345670018': 'checksum errato',
    '': 'vuoto',
    '   ': 'solo spazi',
  };
  for (const [input, motivo] of Object.entries(nonValide)) {
    assert.equal(partitaIvaValida(input), false, `"${input}" doveva essere rifiutata (${motivo})`);
  }
  assert.equal(partitaIvaValida(null), false);
  assert.equal(partitaIvaValida(undefined), false);
});

test('partita IVA: casi validi e normalizzazione', () => {
  const valide = ['12345670017', 'IT12345670017', 'IT 12345670017', ' 123.456.700.17 ', '12345670017\n'];
  for (const input of valide) {
    assert.equal(partitaIvaValida(input), true, `"${input}" doveva essere accettata`);
  }
  assert.equal(normalizzaPartitaIva('it 123.456.700-17'), '12345670017');
});

test('partita IVA: uffici provinciali speciali', () => {
  // 120, 121, 888 e 999 sono codici ufficio legittimi oltre all'intervallo 001-100.
  for (const ufficio of ['120', '121', '888', '999']) {
    const base = `1234567${ufficio}`;
    const completa = base + cifraDiControllo(base);
    assert.equal(partitaIvaValida(completa), true, `ufficio ${ufficio} doveva essere accettato`);
  }
  // 101-119 non esistono
  const inesistente = '1234567101';
  assert.equal(partitaIvaValida(inesistente + cifraDiControllo(inesistente)), false);
});

test('codice SDI', () => {
  assert.equal(codiceSdiValido('ABC1234'), true);
  assert.equal(codiceSdiValido('abc1234'), true, 'il case non conta');
  assert.equal(codiceSdiValido('0000000'), true, 'formalmente valido');
  assert.equal(sdiAssente('0000000'), true);
  assert.equal(sdiAssente('ABC1234'), false);
  assert.equal(codiceSdiValido('AB12'), false);
  assert.equal(codiceSdiValido('ABC12345'), false, '8 caratteri');
  assert.equal(codiceSdiValido('ABC123'), false, '6 caratteri senza modalità PA');
  assert.equal(codiceSdiValido('ABC123', { ammettiPa: true }), true, '6 caratteri con modalità PA');
  assert.equal(codiceSdiValido('ABC-123'), false, 'caratteri non alfanumerici');
  assert.equal(codiceSdiValido(''), false);
});

test('PEC', () => {
  assert.equal(pecValida('a@pec.it'), true);
  assert.equal(pecValida(' MARIO@PEC.EXAMPLE.IT '), true);
  assert.equal(pecValida('non-una-email'), false);
  assert.equal(pecValida('a@b'), false);
  assert.equal(pecValida('a@b.i'), false, 'TLD di un solo carattere');
  assert.equal(pecValida(''), false);
});

test('validaDatiFiscali: combinazioni SDI / PEC', () => {
  const base = { ragioneSociale: 'Acme Srl', partitaIva: '12345670017' };

  assert.equal(validaDatiFiscali({ ...base, codiceSdi: 'ABC1234', pec: '' }).ok, true);
  assert.equal(validaDatiFiscali({ ...base, codiceSdi: '', pec: 'a@pec.it' }).ok, true);
  assert.equal(validaDatiFiscali({ ...base, codiceSdi: '0000000', pec: 'a@pec.it' }).ok, true);

  const zeriSenzaPec = validaDatiFiscali({ ...base, codiceSdi: '0000000', pec: '' });
  assert.equal(zeriSenzaPec.ok, false);
  assert.match(zeriSenzaPec.errori.pec, /0000000/);

  const sdiCorto = validaDatiFiscali({ ...base, codiceSdi: 'AB12', pec: '' });
  assert.equal(sdiCorto.ok, false);
  assert.ok(sdiCorto.errori.codiceSdi);

  const pecRotta = validaDatiFiscali({ ...base, codiceSdi: '', pec: 'non-una-email' });
  assert.equal(pecRotta.ok, false);
  assert.ok(pecRotta.errori.pec);

  const nessunRecapito = validaDatiFiscali({ ...base, codiceSdi: '', pec: '' });
  assert.equal(nessunRecapito.ok, false);
  assert.ok(nessunRecapito.errori.recapito);
});

test('validaDatiFiscali: ragione sociale e partita IVA obbligatorie', () => {
  const senzaNulla = validaDatiFiscali({});
  assert.equal(senzaNulla.ok, false);
  assert.ok(senzaNulla.errori.ragioneSociale);
  assert.ok(senzaNulla.errori.partitaIva);
  assert.ok(senzaNulla.errori.recapito);

  const cf = validaDatiFiscali({
    ragioneSociale: 'Rossi Mario',
    partitaIva: 'RSSMRA80A01H501U',
    codiceSdi: 'ABC1234',
  });
  assert.equal(cf.ok, false);
  assert.match(cf.errori.partitaIva, /codice fiscale/i);
});

test('validaDatiFiscali: restituisce i valori normalizzati', () => {
  const { ok, valori } = validaDatiFiscali({
    ragioneSociale: '  Acme   Srl  ',
    partitaIva: 'IT 12345670017',
    codiceSdi: ' abc1234 ',
    pec: ' Acme@PEC.it ',
  });
  assert.equal(ok, true);
  assert.deepEqual(valori, {
    ragioneSociale: 'Acme Srl',
    partitaIva: '12345670017',
    codiceSdi: 'ABC1234',
    pec: 'acme@pec.it',
  });
});

/** Calcola la cifra di controllo per le prime 10 cifre, per costruire casi di test validi. */
function cifraDiControllo(dieciCifre) {
  let somma = 0;
  for (let i = 0; i < 10; i += 1) {
    let n = dieciCifre.charCodeAt(i) - 48;
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    somma += n;
  }
  return String((10 - (somma % 10)) % 10);
}
