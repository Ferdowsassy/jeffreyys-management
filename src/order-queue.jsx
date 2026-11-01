import React, {useEffect, useState} from 'react';
import {api, Badge, Empty, Form, Panel, Title} from './main';
import {euro} from './finance';
import {OrderDetails,NavigationLinks,DeliveryBoard} from './order-details';
import {orderReference} from './customer-info';

export function OrderQueue({user, data, act}) {
  const [query,setQuery]=useState(""), [payment,setPayment]=useState("all"), [busy, setBusy] = useState(false), [editing, setEditing] = useState(null), [drivers, setDrivers] = useState({});
  const chef = user.role === 'chef';
  const canClaim = chef || user.role==='driver';
  const allOrders=(data.availableOrders || []), search=query.trim().toLocaleLowerCase('de-DE');
  const orders=allOrders.filter(order=>(payment==='all' || (payment==='unknown'?!['cash','online'].includes(order.payment):order.payment===payment)) &&
    [order.orderNumber,order.address,order.postalCode,order.city,order.customerName].filter(Boolean).join(' ').toLocaleLowerCase('de-DE').includes(search))
    .sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  const active = data.shifts.some(s => s.employeeId === user.id && !s.end);
  const onDuty = data.employees.filter(e => e.role === 'driver' && e.active && data.shifts.some(s => s.employeeId === e.id && !s.end));
  const assigned=data.orders.filter(o=>o.status==='open').sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  async function claim(order) {
    setBusy(true);
    try {await act('claimOrder', {id:order.id, ...(chef ? {employeeId:drivers[order.id] || onDuty[0]?.id} : {})});}
    catch {} finally {setBusy(false);}
  }
  return <>
    <Title title="Verfügbare Bestellungen" subtitle="Bestellung finden, Angaben prüfen und eine Lieferung übernehmen." />
    <div className="toolbar order-filters">
      <label>Bestellungen suchen<input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Bestellnummer, Adresse oder Name" /></label>
      <label>Zahlung filtern<select value={payment} onChange={event=>setPayment(event.target.value)}><option value="all">Alle Zahlungsarten</option><option value="cash">Bar kassieren</option><option value="online">Bereits bezahlt</option><option value="unknown">Zahlung prüfen</option></select></label>
      {(query || payment!=='all') && <button className="secondary" onClick={()=>{setQuery('');setPayment('all');}}>Filter zurücksetzen</button>}
      <span role="status">{orders.length} von {allOrders.length} verfügbaren Bestellungen</span>
    </div>
    {user.role==='driver' && !active && <div className="notice">Bitte zuerst unter Meine Schicht einstempeln, um Bestellungen zu übernehmen.</div>}
    <div className="delivery-grid">
      {orders.map(order => <Panel key={order.id} className="order-queue-card delivery-card" title={order.address || 'Adresse fehlt'}
        subtitle={[order.postalCode,order.city].filter(Boolean).join(' ')}
        action={<Badge tone={order.reviewIssues?.length ? 'orange' : 'green'}>{order.reviewIssues?.length ? 'Angaben fehlen' : new Date(order.createdAt).toLocaleTimeString('de-DE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit'})}</Badge>}>
        <p className="order-reference" title={order.orderNumber}>Bestellung {orderReference(order.orderNumber)}</p>
        <div className="delivery-amount">{order.amount === null ? 'Betrag prüfen' : euro(order.amount)}
          <small>{order.payment === 'cash' ? 'Bar kassieren' : order.payment === 'online' ? 'Bereits bezahlt' : 'Zahlungsart prüfen: '+(order.paymentLabel || 'fehlt')}</small>
        </div>
        <OrderDetails order={order} role={user.role} showPayment={false} />
        {canClaim && <div className="row navigation-actions"><NavigationLinks order={order} /></div>}
        {editing === order.id && chef ? <Form initial={{...order,amount:order.amount ?? '',payment:order.payment || ''}}
          fields={[{name:'address',label:'Straße & Hausnummer'}, {name:'postalCode',label:'PLZ',pattern:'[0-9]{5}'}, {name:'city',label:'Ort'},
            {name:'amount',label:'Gesamtbetrag (€)',type:'number',min:0,step:'0.01'},
            {name:'payment',label:'Zahlungsart',options:[{value:'',label:'Bitte wählen'},{value:'cash',label:'Bar kassieren'},{value:'online',label:'Bereits bezahlt'}]}]}
          submit="Angaben speichern" onSubmit={async v => {
            try {await act('reviewImportedOrder',{id:order.id,...v,amount:Number(v.amount)});setEditing(null);} catch {}
          }} /> : <>
          {canClaim && order.status === 'available' && <div className="order-claim">
            {chef && <label>Fahrer<select aria-label={'Fahrer für Bestellung '+order.orderNumber} value={drivers[order.id] || onDuty[0]?.id || ''}
              onChange={e => setDrivers({...drivers,[order.id]:e.target.value})}>
              {!onDuty.length && <option value="">Kein Fahrer im Dienst</option>}
              {onDuty.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select></label>}
            <button className="primary" disabled={busy || (chef ? !onDuty.length : !active)} onClick={() => claim(order)}>{chef ? 'Fahrer zuordnen' : 'Übernehmen'}</button>
          </div>}
          {chef && <button className="text-button" onClick={() => setEditing(order.id)}>Angaben bearbeiten</button>}
        </>}
      </Panel>)}
    </div>
    {!orders.length && <Empty>{allOrders.length?'Keine Treffer. Suche oder Zahlungsfilter ändern.':'Keine verfügbaren Bestellungen. Neue Lieferungen erscheinen hier automatisch.'}</Empty>}
    {chef && <DeliveryBoard data={data} user={user} act={act} />}
    {chef && <CompletedOrderReturns data={data} act={act} />}
    {chef && assigned.length>0 && <details className="order-reassignment"><summary>Fahrer ändern · {assigned.length} offene Lieferungen</summary><Panel title="Offene Lieferungen zuordnen">
      <div className="table-wrap"><table><thead><tr><th>Bestellung</th><th>Adresse</th><th>Aktueller Fahrer</th><th>Neu zuordnen</th></tr></thead><tbody>{assigned.map(o=><tr key={o.id}><td>{o.orderNumber}</td><td>{o.address}{o.source==='winorder' && <details><summary>Bestelldetails</summary><OrderDetails order={o} /><div className="row"><NavigationLinks order={o} /></div></details>}</td><td>{data.employees.find(e=>e.id===o.employeeId)?.name || '—'}</td><td><form className="order-claim" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await act('assignOrder',{id:o.id,employeeId:drivers[o.id] || o.employeeId});}catch{}finally{setBusy(false);}}}><select aria-label={'Neuer Fahrer für '+o.orderNumber} value={drivers[o.id] || o.employeeId} onChange={e=>setDrivers({...drivers,[o.id]:e.target.value})}>{!onDuty.some(e=>e.id===o.employeeId) && <option value={o.employeeId}>Bitte wählen</option>}{onDuty.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select><button className="secondary" disabled={busy || !onDuty.length || !drivers[o.id] || drivers[o.id]===o.employeeId}>Zuordnen</button></form></td></tr>)}</tbody></table></div>{!assigned.length && <Empty>Keine offenen Lieferungen.</Empty>}
    </Panel></details>}
  </>;
}

function CompletedOrderReturns({data, act}) {
  const [employeeId,setEmployeeId]=useState('all'), [query,setQuery]=useState(''), [busy,setBusy]=useState(false);
  const completed=data.orders.filter(order=>order.status==='delivered');
  const search=query.trim().toLocaleLowerCase('de-DE');
  const orders=completed.filter(order=>(employeeId==='all' || order.employeeId===employeeId) &&
    [order.orderNumber,order.address,order.customerName].filter(Boolean).join(' ').toLocaleLowerCase('de-DE').includes(search))
    .sort((a,b)=>(b.deliveredAt || b.createdAt).localeCompare(a.deliveredAt || a.createdAt));
  async function returnOrder(order) {
    const name=data.employees.find(employee=>employee.id===order.employeeId)?.name || 'bisherigen Fahrer';
    if (!confirm(`Bestellung ${order.orderNumber} von ${name} zurückholen? Sie wird wieder verfügbar. Liefergeld, Trinkgeld und Bargeldabzug werden aus der bisherigen Fahrerabrechnung entfernt.`)) return;
    setBusy(true);
    try {await act('returnDeliveredOrder',{id:order.id});} catch {} finally {setBusy(false);}
  }
  return <details className="completed-order-returns">
    <summary>Zugestellte Bestellungen zurückholen · {completed.length}</summary>
    <Panel title="Zugestellte Bestellungen" subtitle="Bestellungen aller Mitarbeiter zurück in die verfügbaren Bestellungen verschieben. Auch frühere und abgeschlossene Schichten sind enthalten.">
      <p className="notice">Die Fahrerzuordnung wird aufgehoben. Liefergeld, Trinkgeld und Bargeldabzug zählen erst nach erneuter Zustellung wieder zur Fahrerabrechnung. Bereits erfasste Auszahlungen bleiben bestehen.</p>
      <div className="toolbar order-filters">
        <label>Mitarbeiter filtern<select value={employeeId} onChange={event=>setEmployeeId(event.target.value)}>
          <option value="all">Alle Mitarbeiter</option>
          {data.employees.filter(employee=>completed.some(order=>order.employeeId===employee.id)).map(employee=><option key={employee.id} value={employee.id}>{employee.name}</option>)}
        </select></label>
        <label>Zugestellte Bestellung suchen<input type="search" placeholder="Bestellnummer, Adresse oder Name" value={query} onChange={event=>setQuery(event.target.value)} /></label>
        <span role="status">{orders.length} von {completed.length} zugestellten Bestellungen</span>
      </div>
      <div className="delivery-grid">{orders.map(order=><Panel key={order.id} title={'Bestellung '+orderReference(order.orderNumber)} subtitle={data.employees.find(employee=>employee.id===order.employeeId)?.name || 'Nicht zugeordnet'}>
        <p>{order.noAddress ? 'Ohne Adresse · Pauschale' : order.address}</p>
        <p>{new Date(order.deliveredAt || order.createdAt).toLocaleString('de-DE',{timeZone:'Europe/Berlin'})} · {euro(order.amount)}</p>
        <button className="secondary" disabled={busy} onClick={()=>returnOrder(order)}>Zurück zu verfügbaren Bestellungen</button>
      </Panel>)}</div>
      {!orders.length && <Empty>{completed.length ? 'Keine passenden zugestellten Bestellungen.' : 'Keine zugestellten Bestellungen.'}</Empty>}
    </Panel>
  </details>;
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
