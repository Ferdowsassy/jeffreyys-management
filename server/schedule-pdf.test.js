import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './test-helper.js';
import {scheduleWeek} from './schedule-pdf.js';

test('weekly schedule download is chef-only and validates week and role',async t=>{
  const {base,login}=await fixture(t);
  const chef=await login('alex','1234'),driver=await login('leo','3456'),kitchen=await login('samira','2345');
  const path='/api/schedule.pdf?weekStart=2026-10-19';
  assert.equal((await fetch(base+path)).status,401);
  for(const cookie of [driver,kitchen])assert.equal((await fetch(base+path,{headers:{cookie}})).status,403);
  for(const query of ['', '?weekStart=2026-10-20','?weekStart=2026-02-30','?weekStart=2026-10-19&role=invalid'])
    assert.equal((await fetch(base+'/api/schedule.pdf'+query,{headers:{cookie:chef}})).status,400);
  for(const role of ['all','kitchen','driver']) {
    const pdf=await fetch(base+path+'&role='+role,{headers:{cookie:chef}});
    assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');
    assert.match(pdf.headers.get('content-disposition'),/attachment; filename="stundenplan-2026-10-19.pdf"/);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');
  }
  assert.deepEqual(scheduleWeek('2026-12-28'),['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
});
