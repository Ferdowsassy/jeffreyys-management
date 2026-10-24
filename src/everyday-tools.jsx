import React, {useEffect, useRef, useState} from 'react';
import {Search, ArrowUpRight, CalendarDays} from 'lucide-react';
import {berlinDate} from '../shared/daily-stats';

const hints={
  Heute:'Übersicht und aktuelle Aufgaben', Tafel:'Küche und laufender Betrieb', Schicht:'Einstempeln und ausstempeln',
  Plan:'Dienstplan, Schichten, Urlaub und freie Tage', Zeiten:'Arbeitszeit und Zeitkorrekturen freigeben',
  'Meine Arbeitszeiten':'Stunden prüfen und fehlende Zeiten melden', Team:'Mitarbeiter, Rollen, Master-Zugang und PIN zurücksetzen',
  'Mein Zugang':'Eigene PIN ändern, Passwort, Face ID und Benachrichtigungen', Geld:'Lohn, Gehalt und Auszahlung',
  Finanzen:'Ausgaben und Kosten', Bestellungen:'Lieferungen suchen und zuordnen', Gebiete:'Liefergebiete und Liefergeld',
  Verdienst:'Mein Lohn, Liefergeld und Abrechnung', 'Mein Verdienst':'Mein Lohn und Abrechnung',
  Belege:'Beleg fotografieren und Bestellungen erfassen', Tour:'Meine Lieferungen und Navigation',
  Daten:'Export und Änderungsprotokoll', Einstellungen:'Restaurant, Adresse und WinOrder',
};
const normalize=value=>value.toLocaleLowerCase('de-DE').normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/ß/g,'ss');

export function PageFinder({nav,labels,go}) {
  const dialog=useRef(null), [query,setQuery]=useState('');
  const open=()=>{setQuery('');if(!dialog.current.open)dialog.current.showModal();dialog.current.querySelector('input').focus();};
  useEffect(()=>{
    const shortcut=event=>{if((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase()==='k'){event.preventDefault();open();}};
    window.addEventListener('keydown',shortcut);
    return ()=>window.removeEventListener('keydown',shortcut);
  },[]);
  const terms=normalize(query).trim().split(/\s+/).filter(Boolean);
  const results=nav.filter(([key])=>terms.every(term=>normalize(`${labels[key] || key} ${hints[key] || ''}`).includes(term)));
  const choose=key=>{dialog.current.close();go(key);};
  return <>
    <button className="secondary finder-trigger" aria-label="Seite finden" onClick={open}><Search size={17} /><span>Seite finden</span><kbd>⌘ / Ctrl K</kbd></button>
    <dialog ref={dialog} className="page-finder" aria-labelledby="finder-title" onClick={event=>{if(event.target===event.currentTarget)dialog.current.close();}}>
      <div className="finder-heading"><h2 id="finder-title">Was möchtest du erledigen?</h2><button className="text-button" aria-label="Suche schließen" onClick={()=>dialog.current.close()}>Schließen</button></div>
      <form onSubmit={event=>{event.preventDefault();if(results[0])choose(results[0][0]);}}>
        <label>Seite oder Aufgabe suchen<input type="search" autoFocus value={query} onChange={event=>setQuery(event.target.value)} placeholder="z. B. PIN ändern, Urlaub, Lohn …" autoComplete="off" /></label>
      </form>
      <nav className="finder-results" aria-label="Gefundene Seiten">
        {results.map(([key,Icon])=><button key={key} onClick={()=>choose(key)}><Icon size={21} /><span><strong>{labels[key] || key}</strong><small>{hints[key] || 'Seite öffnen'}</small></span><ArrowUpRight size={17} /></button>)}
        {!results.length && <p role="status">Keine passende Seite. Versuche „PIN“, „Plan“ oder „Lohn“.</p>}
      </nav>
      <p className="finder-help">Mit Tab auswählen · Enter öffnen · Esc schließen</p>
    </dialog>
  </>;
}

export function HomeShortcuts({user,data,go}) {
  const chef=user.role==='chef', active=data.shifts.some(shift=>shift.employeeId===user.id && !shift.end);
  const pending=(data.shiftRequests || []).filter(request=>request.status==='pending').length;
  const available=(data.availableOrders || []).length;
  const date=berlinDate(Date.now()), clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
  const next=data.schedule.filter(entry=>entry.employeeId===user.id && (entry.kind || 'shift')==='shift' && (entry.date>date || (entry.date===date && entry.start>=clock)))
    .sort((a,b)=>`${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))[0];
  const links=chef ? [
    ['Bestellungen',`${available} Bestellungen verfügbar`,'Lieferungen prüfen und zuordnen'],
    ['Zeiten',pending?`${pending} Zeitkorrekturen offen`:'Arbeitszeiten prüfen',pending?'Anfragen freigeben':'Schichten und Stunden im Blick'],
    ['Team','Team & Zugänge','Mitarbeiter und PIN verwalten'],
  ] : [
    [user.role==='driver' && !active?'Schicht':'Bestellungen',available?`${available} Bestellungen verfügbar`:'Bestellungen öffnen',user.role==='driver' && !active?'Zuerst einstempeln':'Aktuelle Bestellungen ansehen'],
    ['Meine Arbeitszeiten','Meine Stunden','Zeiten prüfen und Korrektur melden'],
    ['Mein Zugang','Meine PIN & Anmeldung','PIN ändern und Face ID einrichten'],
  ];
  return <section className="home-shortcuts" aria-label="Schnellzugriff">
    {links.map(([target,title,description])=><button key={target} onClick={()=>go(target)}><span><strong>{title}</strong><small>{description}</small></span><ArrowUpRight size={18} /></button>)}
    <button onClick={()=>go('Plan')}><CalendarDays size={20} /><span><strong>{chef?'Stundenplan öffnen':next?'Deine nächste Schicht':'Mein Stundenplan'}</strong><small>{!chef && next?`${new Date(next.date+'T12:00').toLocaleDateString('de-DE',{weekday:'short',day:'numeric',month:'short'})} · ${next.start}–${next.end}${next.end<next.start?' (+1 Tag)':''}`:chef?'Küche und Fahrer planen':'Geplante Schichten und freie Tage'}</small></span><ArrowUpRight size={18} /></button>
  </section>;
}
