import React, {useState} from 'react';
import {Title, Panel, Form, Empty} from './main';
import {MonthPicker, DataTable} from './operations';
import {euro, day, sum} from './finance';

export function DriverFuel({data, act}) {
  const [month, setMonth] = useState(() => day(Date.now()).slice(0,7));
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const entries = (data.driverFuel || []).filter(entry => entry.date.startsWith(month))
    .sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const liters = sum(entries, entry => entry.liters || 0);
  return <>
    <Title title="Mein Benzin" subtitle="Dein privates Tankbuch. Für deinen persönlichen Überblick." />
    <div className="notice">Nur für deinen Überblick: Tankbeträge ändern weder Lohn, Auszahlung noch Bargeldabzug und sind keine Betriebsausgaben.</div>
    <div className="toolbar"><MonthPicker value={month} onChange={setMonth} label="Tankmonat" /><button className="primary" onClick={() => {setEditing({});setError('');}}>+ Tankfüllung</button></div>
    <div className="metrics driver-money-metrics">
      <div className="metric featured"><span>Getankt im Monat</span><strong>{euro(sum(entries, entry => entry.amount))}</strong><small>{entries.length} Tankfüllungen · {month}</small></div>
      <div className="metric"><span>Erfasste Liter</span><strong>{liters.toLocaleString('de-DE',{maximumFractionDigits:2})} l</strong><small>Literangabe ist freiwillig</small></div>
    </div>
    {editing && <Panel title={editing.id ? 'Tankfüllung bearbeiten' : 'Tankfüllung eintragen'} action={<button className="text-button" onClick={() => setEditing(null)}>Abbrechen</button>}>
      <Form key={editing.id || 'new'} initial={editing} submit="Tankfüllung speichern" fields={[
        {name:'date', label:'Tankdatum', type:'date', value:day(Date.now()), max:day(Date.now())},
        {name:'amount', label:'Tankbetrag (€)', type:'number', min:0.01, max:100000, step:0.01},
        {name:'liters', label:'Liter (optional)', type:'number', min:0.01, max:1000, step:0.01, required:false},
        {name:'note', label:'Notiz (optional)', maxLength:200, required:false},
      ]} onSubmit={async values => {await act('saveDriverFuel',{...values,id:editing.id,amount:Number(values.amount),liters:values.liters ? Number(values.liters) : null});setMonth(values.date.slice(0,7));setEditing(null);}} />
    </Panel>}
    <Panel title="Deine Tankfüllungen">
      {error && <p className="form-error" role="alert">{error}</p>}
      {entries.length ? <DataTable headers={['Datum','Betrag','Liter','Notiz','Aktion']}>{entries.map(entry => <tr key={entry.id}>
        <td>{new Date(entry.date+'T12:00:00').toLocaleDateString('de-DE')}</td><td><strong>{euro(entry.amount)}</strong></td><td>{entry.liters == null ? '—' : entry.liters.toLocaleString('de-DE')}</td><td>{entry.note || '—'}</td>
        <td><div className="row"><button className="text-button" onClick={() => {setEditing(entry);setError('');}}>Bearbeiten</button><button className="text-button" onClick={async () => {if(!confirm('Diese Tankfüllung löschen?'))return;try{await act('deleteDriverFuel',{id:entry.id});setEditing(current => current?.id===entry.id ? null : current);setError('');}catch(error){setError(error.message);}}}>Löschen</button></div></td>
      </tr>)}</DataTable> : <Empty>Noch keine Tankfüllung in diesem Monat. Trage deinen ersten Tankbetrag ein.</Empty>}
    </Panel>
  </>;
}

export function OrderTipEditor({order, act, canEdit=false}) {
  const [open, setOpen] = useState(false);
  return <div className="order-tip-editor">
    <div className="row"><span>Trinkgeld: <strong>{euro((order.tipOnline || 0)+(order.tipCash || 0))}</strong></span>{canEdit && <button className="text-button" onClick={() => setOpen(value => !value)}>{open ? 'Schließen' : 'Trinkgeld bearbeiten'}</button>}</div>
    {!canEdit && <p className="muted">Online: {euro(order.tipOnline || 0)} · Bar erhalten: {euro(order.tipCash || 0)}</p>}
    {canEdit && open && <><p className="muted">Online wird zusätzlich ausgezahlt. Bar hast du bereits erhalten. Beide Beträge sind zusätzlich zum Bestellbetrag.</p>
      <Form key={order.id} initial={{tipOnline:order.tipOnline || 0,tipCash:order.tipCash || 0}} fields={[
        {name:'tipOnline',label:'Online-Trinkgeld (€)',type:'number',min:0,max:100000,step:0.01},
        {name:'tipCash',label:'Bar-Trinkgeld (€)',type:'number',min:0,max:100000,step:0.01},
      ]} submit="Trinkgeld speichern" onSubmit={async values => {await act('saveOrderTips',{id:order.id,tipOnline:Number(values.tipOnline),tipCash:Number(values.tipCash)});setOpen(false);}} />
    </>}
  </div>;
}
