import test from 'node:test';
import assert from 'node:assert/strict';
import {customerInfo,customerRows,orderReference} from './customer-info.js';

const order={id:'1',source:'winorder',status:'delivered',address:'Teststraße 12',postalCode:'80802',city:'München',amount:30,createdAt:'2026-10-01T18:00:00Z'};
test('customer contact uses imported delivery fields, with legacy and root contact fallbacks',()=>{
  const info=customerInfo({...order,customerName:'Legacy Name',customerPhone:'123',winorderDetails:{Customer:{CustomerNo:'C-1',DeliveryAddress:{Title:'Frau',FirstName:'Erika',LastName:'Mustermann',Company:'Büro',Mobile:'123',Email:'erika@example.com',AddAddress:'2. Stock',DescriptionOfWay:'Hintereingang'}},AddInfo:{Comment:'Klingeln'}}});
  assert.equal(info.displayName,'Frau Erika Mustermann');
  assert.equal(info.phone,'123');assert.equal(info.mobile,'');
  assert.equal(info.email,'erika@example.com');assert.equal(info.number,'C-1');
  assert.equal(info.notes,'2. Stock\nHintereingang\nKlingeln');
  assert.equal(customerInfo({customerName:'Legacy Name'}).name,'Legacy Name');
  assert.equal(customerInfo({winorderDetails:{Customer:{FirstName:'Root',LastName:'Contact',PhoneNo:123}}}).name,'Root Contact');
  assert.equal(customerInfo({winorderDetails:{Customer:{BillAddress:{FirstName:'Different',LastName:'Person'}}}}).name,'');
});
test('customer directory keeps people at the same address separate and includes new unclaimed orders',()=>{
  const rows=customerRows([
    {...order,customerName:'Erika Mustermann'},
    {...order,id:'2',customerName:'Erika Mustermann',customerPhone:'555',createdAt:'2026-10-02T18:00:00Z',status:'available',amount:20},
    {...order,id:'3',customerName:'Max Mustermann'},
    {...order,id:'4',customerName:'Erika Mustermann',noAddress:true},
    {...order,id:'5',customerName:'Erika Mustermann',status:'cancelled'},
  ],Date.parse('2026-10-03T18:00:00Z'));
  assert.equal(rows.length,2);
  const erika=rows.find(row=>row.info.name==='Erika Mustermann');
  assert.equal(erika.count,2);assert.equal(erika.revenue,50);assert.equal(erika.info.phone,'555');
  assert.equal(erika.last.id,'2');assert.equal(erika.days,1);
});
test('stable customer numbers retain earlier contact fields when a later import omits them',()=>{
  const rows=customerRows([
    {...order,customerName:'Erika Mustermann',customerPhone:'123',winorderDetails:{Customer:{CustomerNo:'C-1'}}},
    {...order,id:'2',status:'open',createdAt:'2026-10-02T18:00:00Z',winorderDetails:{Customer:{CustomerNo:'C-1'}}},
    {...order,id:'3',customerName:'Erika Mustermann',winorderDetails:{Customer:{CustomerNo:'C-2'}}},
    {...order,id:'4'},
  ]);
  assert.equal(rows.length,3);
  const row=rows.find(r=>r.info.number==='C-1');
  assert.equal(row.count,2);assert.equal(row.info.displayName,'Erika Mustermann');assert.equal(row.info.phone,'123');
});
test('long references stay readable without changing real order numbers',()=>{
  assert.equal(orderReference('{A733016C-D2EC-4671-9E1D-F098E424F8D6}'),'A733016C');
  assert.equal(orderReference('DETAILS-100'),'DETAILS-100');
  assert.equal(orderReference(null),'—');
});
