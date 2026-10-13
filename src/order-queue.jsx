import React, {useEffect, useState} from 'react';
import {api, Badge, Empty, Form, Panel, Title} from './main';
import {euro} from './finance';

export function OrderQueue({user, data, act}) {
  const [busy, setBusy] = useState(false), [editing, setEditing] = useState(null), [drivers, setDrivers] = useState({});
  const chef = user.role === 'chef';
  const orders = (data.availableOrders || []).slice().sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  const active = data.shifts.some(s => s.employeeId === user.id && !s.end);
  const onDuty = data.employees.filter(e => e.role === 'driver' && e.active && data.shifts.some(s => s.employeeId === e.id && !s.end));
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
  </>;
}

export function WinOrderSettings({data}) {
  const [status, setStatus] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api('integrations/winorder').then(value => {if (alive) {setStatus(value);setError('');}}).catch(error => {if (alive) setError(error.message);});
    return () => {alive = false;};
  }, [data.settings.winorderLastReceivedAt]);
  return <Panel title="WinOrder" subtitle="Lieferbestellungen direkt aus der Kasse übernehmen.">
    {error ? <p role="alert">{error}</p> : !status ? <p>Verbindung wird geprüft …</p> : <>
      <p><strong>{status.configured ? 'Empfang eingerichtet' : 'Empfang noch nicht eingerichtet'}</strong></p>
      {status.lastReceivedAt ? <p>Letzter Empfang: {new Date(status.lastReceivedAt).toLocaleString('de-DE',{timeZone:'Europe/Berlin'})}</p> : <p>Noch keine Bestellung empfangen.</p>}
      {status.configured && <dl className="winorder-details"><dt>Senden an HTTP-Server</dt><dd>{status.endpoint || 'HTTPS-Adresse des Servers + /sendorder'}</dd><dt>Benutzername</dt><dd>{status.username}</dd></dl>}
      <p>In WinOrder „Bestellung auf diesem Computer speichern“ und „drucken“ auf Ja lassen. Neue Lieferungen erscheinen unter Bestellungen.</p>
    </>}
  </Panel>;
}
