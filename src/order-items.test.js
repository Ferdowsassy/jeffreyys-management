import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeItems} from './order-items.js';
test('article totals include delivered items only, merge names and retain historical price ranges', () => {
  const orders = [
    {status:'delivered',items:[{name:'Burger',quantity:2,unitPrice:10.1}]},
    {status:'delivered',items:[{name:' burger ',quantity:3,unitPrice:11}]},
    {status:'open',items:[{name:'Burger',quantity:100,unitPrice:10}]},
    {status:'delivered'},
  ];
  assert.deepEqual(summarizeItems(orders), [{name:'Burger',quantity:5,revenue:53.2,minPrice:10.1,maxPrice:11}]);
});
