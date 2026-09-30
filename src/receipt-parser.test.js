import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReceipt} from './receipt-parser.js';
test('receipt parser selects customer address and final total rather than store address, item prices or VAT',()=>{
  const result=parseReceipt(`Example Burger
Storestraße 7
81245 München
Test Customer
Teststralle 80
81375 Munchen
Etage EG
RE / AN-Nr.: 9848 / 46
RECHNUNG
Deine Bestellnummer: ABC123
1 Burger 14,99 €
Rabatt -4,20 €
Rechnungsbetrag 56,93 €
7% MwSt. 56,93 € 3,72 €
Zahlungsart: Online bezahlt`);
  assert.deepEqual(result.draft,{address:'Teststraße 80',postalCode:'81375',city:'München',amount:56.93,payment:'online',orderNumber:'ABC123'});
  assert.deepEqual(result.warnings,[]);
});
test('unknown or conflicting values remain blank and never default to online payment',()=>{
  const result=parseReceipt('Burger 12,99 €\nRechnungsbetrag 15,00 €\nGesamtbetrag 17,00 €');
  assert.equal(result.draft.payment,'');assert.equal(result.draft.amount,'');assert.equal(result.draft.address,'');
  assert.ok(result.warnings.some(w=>w.includes('Mehrere')));
  assert.equal(parseReceipt('Zahlungsart: Bar\nRechnungsbetrag\n1.234,56 €').draft.amount,1234.56);
  assert.equal(parseReceipt('Zahlungsart: Bar').draft.payment,'cash');
  assert.equal(parseReceipt('Zahlungsart: Bar\nOnline bezahlt').draft.payment,'');
  assert.equal(parseReceipt('RE / AN-Nr.: 9848 / 46').draft.orderNumber,'9848/46');
});
