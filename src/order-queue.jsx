import React, {useEffect, useState} from 'react';
import {api, Badge, Empty, Form, Panel, Title} from './main';
import {euro} from './finance';

export function OrderQueue({user, data, act}) {
  const [busy, setBusy] = useState(false), [editing, setEditing] = useState(null), [drivers, setDrivers] = useState({});
  const chef = user.role === 'chef';
  const orders = (data.availableOrders || []).slice().sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  const active = data.shifts.some(s => s.employeeId === user.id && !s.end);
  const onDuty = data.employees.filter(e => e.role === 'driver' && e.active && data.shifts.some(s => s.employeeId === e.id && !s.end));
  const assigned=data.orders.filter(o=>o.status==='open').sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  async function claim(order) {
    setBusy(true);
    try {await act('claimOrder', {id:order.id, ...(chef ? {employeeId:drivers[order.id] || onDuty[0]?.id} : {})});}
    catch {} finally {setBusy(false);}
  }
  return <>
    <Title title="Verfügbare Bestellungen" subtitle={chef ? 'Neue Lieferungen freigeben und deinem Team zuordnen.' : 'Wähle deine Lieferungen. Übernommene Bestellungen findest du unter Tour.'} />
    {!chef && !active && <div className="notice">Bitte zuerst unter Schicht einstempeln, um Bestellungen zu übernehmen.</div>}
    <div className="delivery-grid">
      {orders.map(order => <Panel key={order.id} className="order-queue-card" title={'Bestellung '+order.orderNumber}
        subtitle={new Date(order.createdAt).toLocaleTimeString('de-DE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit'})+' · WinOrder'}
        action={<Badge tone={order.status === 'review' ? 'orange' : 'green'}>{order.status === 'review' ? 'Bitte prüfen' : 'Verfügbar'}</Badge>}>
        <p><strong>{order.address || 'Adresse fehlt'}</strong><br />{order.postalCode} {order.city}</p>
        <div className="delivery-amount">{order.amount === null ? 'Betrag prüfen' : euro(order.amount)}
          <small>{order.payment === 'cash' ? 'Bar kassieren' : order.payment === 'online' ? 'Bereits bezahlt' : 'Zahlungsart prüfen: '+(order.paymentLabel || 'fehlt')}</small>
        </div>
        {chef && order.customerName && <p>{order.customerName}{order.customerPhone ? ' · '+order.customerPhone : ''}</p>}
        {chef && order.deliveryNotes && <p className="order-notes">{order.deliveryNotes}</p>}
        {chef && order.articleDescription && <details><summary>Bestellte Artikel</summary><p className="order-notes">{order.articleDescription}</p></details>}
        {chef && order.reviewIssues?.length > 0 && <p className="notice">{order.reviewIssues.join(' · ')}</p>}
        {editing === order.id && chef ? <Form initial={{...order,amount:order.amount ?? '',payment:order.payment || ''}}
          fields={[{name:'address',label:'Straße & Hausnummer'}, {name:'postalCode',label:'PLZ',pattern:'[0-9]{5}'}, {name:'city',label:'Ort'},
            {name:'amount',label:'Gesamtbetrag (€)',type:'number',min:0,step:'0.01'},
            {name:'payment',label:'Zahlungsart',options:[{value:'',label:'Bitte wählen'},{value:'cash',label:'Bar kassieren'},{value:'online',label:'Bereits bezahlt'}]}]}
          submit="Prüfen & freigeben" onSubmit={async v => {
            try {await act('reviewImportedOrder',{id:order.id,...v,amount:Number(v.amount)});setEditing(null);} catch {}
          }} /> : <>
          {order.status === 'available' && <div className="order-claim">
            {chef && <label>Fahrer<select aria-label={'Fahrer für Bestellung '+order.orderNumber} value={drivers[order.id] || onDuty[0]?.id || ''}
              onChange={e => setDrivers({...drivers,[order.id]:e.target.value})}>
              {!onDuty.length && <option value="">Kein Fahrer im Dienst</option>}
              {onDuty.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select></label>}
            <button className="primary" disabled={busy || (chef ? !onDuty.length : !active)} onClick={() => claim(order)}>{chef ? 'Fahrer zuordnen' : 'Übernehmen'}</button>
          </div>}
          {chef && <button className="text-button" onClick={() => setEditing(order.id)}>Angaben prüfen</button>}
        </>}
      </Panel>)}
    </div>
    {!orders.length && <Empty>{chef ? 'Noch keine verfügbaren WinOrder-Lieferungen.' : 'Aktuell ist keine Bestellung verfügbar. Neue Lieferungen erscheinen hier automatisch.'}</Empty>}
    {chef && <Panel title="Offene Lieferungen zuordnen" subtitle="Auch manuell erfasste Bestellungen können einem anderen Fahrer im Dienst zugeteilt werden.">
      <div className="table-wrap"><table><thead><tr><th>Bestellung</th><th>Adresse</th><th>Aktueller Fahrer</th><th>Neu zuordnen</th></tr></thead><tbody>{assigned.map(o=><tr key={o.id}><td>{o.orderNumber}</td><td>{o.address}</td><td>{data.employees.find(e=>e.id===o.employeeId)?.name || '—'}</td><td><form className="order-claim" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await act('assignOrder',{id:o.id,employeeId:drivers[o.id] || o.employeeId});}catch{}finally{setBusy(false);}}}><select aria-label={'Neuer Fahrer für '+o.orderNumber} value={drivers[o.id] || o.employeeId} onChange={e=>setDrivers({...drivers,[o.id]:e.target.value})}>{!onDuty.some(e=>e.id===o.employeeId) && <option value={o.employeeId}>Bitte wählen</option>}{onDuty.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select><button className="secondary" disabled={busy || !onDuty.length || !drivers[o.id] || drivers[o.id]===o.employeeId}>Zuordnen</button></form></td></tr>)}</tbody></table></div>{!assigned.length && <Empty>Keine offenen Lieferungen.</Empty>}
    </Panel>}
  </>;
}

export function WinOrderSettings({data}) {
  const [status, setStatus] = useState(null), [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0), [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    let alive = true;
    setRefreshing(true);
    api('integrations/winorder').then(value => {if (alive) {setStatus(value);setError('');}})
      .catch(error => {if (alive) setError(error.message);})
      .finally(() => {if (alive) setRefreshing(false);});
    return () => {alive = false;};
  }, [data.settings.winorderLastReceivedAt, refresh]);
  return <Panel title="WinOrder" subtitle="Lieferbestellungen direkt aus der Kasse übernehmen."
    action={<button className="secondary" disabled={refreshing} onClick={() => setRefresh(value => value + 1)}>{refreshing ? 'Wird aktualisiert …' : 'Aktualisieren'}</button>}>
    {error ? <p role="alert">{error}</p> : !status ? <p>Verbindung wird geprüft …</p> : <>
      <p><strong>{status.configured ? 'Empfang eingerichtet' : 'Empfang noch nicht eingerichtet'}</strong></p>
      {status.lastReceivedAt ? <p>Letzter Empfang: {new Date(status.lastReceivedAt).toLocaleString('de-DE',{timeZone:'Europe/Berlin'})}</p> : <p>Noch keine Bestellung empfangen.</p>}
      {status.configured && <dl className="winorder-details"><dt>Senden an HTTP-Server</dt><dd>{status.endpoint || 'HTTPS-Adresse des Servers + /sendorder'}</dd><dt>Benutzername</dt><dd>{status.username}</dd></dl>}
      <p>In WinOrder „Bestellung auf diesem Computer speichern“ und „drucken“ auf Ja lassen. Neue Lieferungen erscheinen unter Bestellungen.</p>
      <h3>Letzte Übertragungsversuche</h3>
      <p>Nach dem Senden in WinOrder hier auf Aktualisieren drücken. Angezeigt werden bis zu 20 Versuche seit dem letzten App-Server-Neustart.</p>
      {status.attempts?.length ? <ul className="winorder-attempts">{status.attempts.map((attempt, index) => <li key={attempt.receivedAt+'-'+index}>
        <strong>{new Date(attempt.receivedAt).toLocaleString('de-DE',{timeZone:'Europe/Berlin'})} · HTTP {attempt.status}</strong>
        <p>{attempt.message}</p>
        <small>Authentifizierung: {attempt.authenticated === null ? 'nicht geprüft' : attempt.authenticated ? 'erfolgreich' : attempt.authentication === 'missing' ? 'nicht angekommen' : 'nicht akzeptiert'}
          {' · Datentyp: '}{attempt.contentType === 'missing' ? 'nicht angegeben' : attempt.contentType === 'other' ? 'anderer Typ' : attempt.contentType}
          {attempt.bytes !== null && <> · {attempt.bytes} Bytes</>}</small>
      </li>)}</ul> : <p>Noch kein Übertragungsversuch erfasst. Nur Anfragen, die diesen Empfänger erreichen, können hier erscheinen.</p>}
    </>}
  </Panel>;
}
