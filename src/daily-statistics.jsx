import React, {useEffect, useState} from 'react';
import {Panel, Title} from './main';
import {dailyStats, berlinDate} from '../shared/daily-stats';
import {payroll} from '../shared/payroll';
import {euro, formatHours} from './finance';
import EarningsWeek from './earnings-week';

function Bars({title, values}) {
  const maximum=Math.max(1,...values.map(v=>v.value));
  return <Panel title={title}>
    <div className="daily-chart" role="img" aria-label={title+'. Genaue Werte in der Tabelle darunter.'}>
      {values.map((v,i)=><div className="daily-bar-slot" key={i}>
        <span>{v.value}</span>
        <div className="daily-bar" style={{height:`${v.value/maximum*130}px`}} />
        <small>{v.label}</small>
      </div>)}
    </div>
    <details><summary>Alle Werte anzeigen</summary>
      <div className="table-wrap"><table><thead><tr><th>Zeit</th><th>Bestellungen</th></tr></thead>
        <tbody>{values.map((v,i)=><tr key={i}><td>{v.label}</td><td>{v.value}</td></tr>)}</tbody>
      </table></div>
    </details>
  </Panel>;
}
export default function DailyStatistics({user,data}) {
  const [date,setDate]=useState(()=>berlinDate(Date.now())),[now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer);},[]);
  const stats=dailyStats(data,user,date,now);
  const own=payroll({...data,employees:data.employees.filter(e=>e.id===user.id)},now)[0];
  const business=user.role==='chef',driver=user.role==='driver';
  const metrics=[['Erfasste Bestellungen',stats.orders],['Am gewählten Tag zugestellt',stats.completed],
    ['Automatisch beim Ausstempeln geschlossen',stats.automatic],['Jetzt offene Lieferungen',stats.open],
    [business ? 'Arbeitsstunden · Team' : 'Deine Arbeitsstunden',formatHours(stats.hours)],
    [business ? 'Teamverdienst vor Bargeldabzug' : 'Dein Verdienst vor Bargeldabzug',euro(stats.gross)],
    ['Ø bestätigte Lieferzeit',stats.averageMinutes===null ? '—' : Math.round(stats.averageMinutes)+' Min.']];
  if(business)metrics.push(['Umsatz erfasster Bestellungen',euro(stats.revenue)]);
  if(driver)metrics.push(['Barzahlungen zugestellter Tagesbestellungen',euro(stats.collectedCash)],
    ['Bargeld bei dir · alle erfassten Tage',euro(own.retainedCash)],['Deine Auszahlung · alle erfassten Tage',euro(own.payout)]);
  return <>
    <Title title="Dein Tag in Zahlen." subtitle={driver ? 'Deine Lieferungen und dein Verdienst.' : business ? 'Täglicher Überblick für deinen Betrieb.' : 'Küchenüberblick und dein persönlicher Verdienst.'} />
    <EarningsWeek user={user} data={data} date={date} onDateChange={setDate} />
    <div className="toolbar"><label>Statistiktag <input type="date" value={date} max={berlinDate(now)} onChange={e=>{if(e.target.value)setDate(e.target.value);}} /></label><span>Zeitzone: Berlin</span></div>
    <div className="daily-stat-grid">{metrics.map(([label,value])=><div className="daily-stat" key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
    <details className="earnings-help"><summary>Details zu den Tageszahlen</summary><p className="muted">Arbeitsstunden werden am Tageswechsel aufgeteilt. Verdienst enthält den Lohnanteil am gewählten Tag und Liefergeld zugestellter Bestellungen nach Erfassungsdatum. Laufende Schichten sind vorläufig. Automatische Abschlüsse zählen als zugestellt, werden aus der durchschnittlichen Lieferzeit ausgenommen.</p></details>
    <Bars title="Erfasste Bestellungen nach Uhrzeit" values={stats.hourly} />
    <Bars title="Erfasste Bestellungen · letzte 7 Tage bis zum gewählten Tag" values={stats.weekly} />
  </>;
}
