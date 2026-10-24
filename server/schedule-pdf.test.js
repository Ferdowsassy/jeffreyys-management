import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './test-helper.js';
import {scheduleWeek,scheduleWeekNumber} from './schedule-pdf.js';

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

test('PDF calendar weeks use ISO week numbering across New Year',()=>{
  for(const [monday,week,year] of [['2027-01-04',1,2027],['2027-01-11',2,2027],['2026-12-28',53,2026],['2025-12-29',1,2026],['2020-12-28',53,2020]])
    assert.deepEqual(scheduleWeekNumber(monday),{week,year});
});
