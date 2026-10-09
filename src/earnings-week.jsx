import React, {useEffect, useState} from 'react';
import {Panel} from './main';
import {euro, formatHours} from './finance';
import {berlinDate, shiftDate, dailyEarnings} from '../shared/daily-stats';

const weekday = date => new Date(date+'T12:00:00Z').toLocaleDateString('de-DE',{weekday:'short',timeZone:'Europe/Berlin'});
const shortDate = date => date.slice(8)+'.'+date.slice(5,7)+'.';
export default function EarningsWeek({user, data, date, onDateChange}) {
  const [selected, setSelected] = useState(()=>berlinDate(Date.now()));
  const [scope, setScope] = useState(user.id);
  const [now, setNow] = useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer);},[]);
  const current=date || selected, today=berlinDate(now);
  const choose=value=>{if(value){setSelected(value);onDateChange?.(value);}};
  const monday=shiftDate(current,-((new Date(current+'T12:00:00Z').getUTCDay()+6)%7));
  const employeeId=user.role==='chef' ? (scope==='team'?null:scope) : user.id;
  const days=Array.from({length:7},(_,i)=>{
    const key=shiftDate(monday,i);
    return {date:key,...dailyEarnings(data,employeeId,key,now)};
  });
  const maximum=Math.max(1,...days.map(d=>d.gross));
  const total=days.reduce((n,d)=>n+Math.round(d.gross*100),0)/100;
  const chosen=days.find(d=>d.date===current);
  return <Panel className="earnings-panel" title="Verdienst · Wochenübersicht" subtitle="Tippe auf einen Tag für die Aufschlüsselung.">
    <div className="earnings-body">
    <div className="toolbar earnings-toolbar">
      <div className="row week-navigation">
        <button className="secondary" aria-label="Vorherige Verdienstwoche" onClick={()=>choose(shiftDate(current,-7))}>‹</button>
        <strong>{shortDate(monday)} – {shortDate(shiftDate(monday,6))}</strong>
        <button className="secondary" aria-label="Nächste Verdienstwoche" disabled={shiftDate(monday,7)>today} onClick={()=>choose(shiftDate(current,7)>today?today:shiftDate(current,7))}>›</button>
      </div>
      <label>Tag <input aria-label="Verdiensttag" type="date" value={current} max={today} onChange={e=>choose(e.target.value)} /></label>
      <button className="text-button" onClick={()=>choose(today)}>Heute</button>
      {user.role==='chef' && <label>Verdienst für <select aria-label="Verdienst für" value={scope} onChange={e=>setScope(e.target.value)}>
        <option value="team">Gesamtes Team</option>
        {data.employees.map(e=><option key={e.id} value={e.id}>{e.name}{e.id===user.id?' (ich)':''}</option>)}
      </select></label>}
    </div>
    <div className="earnings-summary"><span>Wochenverdienst</span><strong>{euro(total)}</strong><small>Vor Bargeldabzug</small></div>
    <div className="earnings-chart" role="group" aria-label="Verdienst nach Wochentag">
      {days.map(d=><button key={d.date} className={'earnings-day'+(d.date===current?' selected':'')} aria-pressed={d.date===current}
        aria-label={`${weekday(d.date)}, ${shortDate(d.date)}: ${euro(d.gross)}${d.provisional?', vorläufig':''}`} disabled={d.date>today} onClick={()=>choose(d.date)}>
        <span className="earnings-value">{euro(d.gross)}</span>
        <span className="earnings-bar-space"><span className="earnings-bar" style={{height:Math.max(3,d.gross/maximum*112)+'px'}} /></span>
        <strong>{weekday(d.date)}</strong><small>{shortDate(d.date)}</small>
      </button>)}
    </div>
    <div className="earnings-detail" aria-live="polite">
      <h3>{weekday(current)}, {shortDate(current)} · {euro(chosen.gross)}{chosen.provisional && <small> · Vorläufig</small>}</h3>
      <dl><div><dt>Arbeitszeit</dt><dd>{formatHours(chosen.hours)}</dd></div><div><dt>Lohn</dt><dd>{euro(chosen.wages)}</dd></div><div><dt>Liefergeld</dt><dd>{euro(chosen.fees)}</dd></div></dl>
      {chosen.hours===0 && chosen.fees===0 && <p className="muted">Für diesen Tag ist noch kein Verdienst erfasst.</p>}
    </div>
    <details className="earnings-help"><summary>Wie wird der Verdienst berechnet?</summary><p>Lohn + Liefergeld zugestellter Bestellungen, vor Bargeldabzug. Arbeitszeit wird am Tageswechsel aufgeteilt. Liefergeld zählt zum Tag der Belegerfassung. Laufende Schichten sind vorläufig; die Auszahlung findest du in der Monatsabrechnung.</p></details>
    </div>
  </Panel>;
}
