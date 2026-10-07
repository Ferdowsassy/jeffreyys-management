import React, {useState} from 'react';
import {Panel, Form, Badge} from './main';
import {day} from './finance';

const localTime = value => {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16);
};
const display = value => value ? new Date(value).toLocaleString('de-DE', {timeZone:'Europe/Berlin',dateStyle:'short',timeStyle:'short'}) : 'Offen';
const statusName = {pending:'Wartet auf Freigabe',approved:'Genehmigt',rejected:'Abgelehnt'};

export function ShiftCorrections({user, data, act}) {
  const [month, setMonth] = useState(day(Date.now()).slice(0,7));
  const [editing, setEditing] = useState(null);
  const shifts = data.shifts.filter(s => s.employeeId === user.id && day(s.start).startsWith(month))
    .sort((a,b) => b.start.localeCompare(a.start));
  const requests = (data.shiftRequests || []).filter(r => r.employeeId === user.id)
    .sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const pending = shiftId => requests.some(r => r.shiftId === shiftId && r.status === 'pending');
  return <Panel title="Meine Arbeitszeiten" subtitle="Einstempeln oder Ausstempeln vergessen? Änderungen werden erst nach Freigabe durch den Chef übernommen.">
    <div className="toolbar">
      <label>Monat <input type="month" value={month} onChange={e => setMonth(e.target.value)} /></label>
      <button className="secondary" onClick={() => setEditing({id:null,start:'',end:''})}>Vergessene Schicht melden</button>
    </div>
    <div className="table-wrap"><table>
      <thead><tr><th>Beginn</th><th>Ende</th><th>Änderung</th></tr></thead>
      <tbody>{shifts.map(s => <tr key={s.id}><td>{display(s.start)}</td><td>{display(s.end)}</td><td>
        <button className="text-button" disabled={pending(s.id)} onClick={() => setEditing(s)}>
          {pending(s.id) ? 'Wartet auf Freigabe' : 'Korrektur beantragen'}
        </button>
      </td></tr>)}</tbody>
    </table></div>
    {!shifts.length && <p>Für diesen Monat sind keine Schichten erfasst.</p>}
    {editing && <div className="notice">
      <h3>{editing.id ? 'Zeitkorrektur beantragen' : 'Vergessene Schicht melden'}</h3>
      <Form key={editing.id || 'missing'} submit="An Chef senden" fields={[
        {name:'start',label:'Tatsächlicher Beginn (Ortszeit dieses Geräts)',type:'datetime-local',value:editing.start ? localTime(editing.start) : ''},
        {name:'end',label:'Tatsächliches Ende (Ortszeit dieses Geräts)',type:'datetime-local',value:editing.end ? localTime(editing.end) : ''},
        {name:'reason',label:'Begründung',maxLength:1000},
      ]} onSubmit={async v => {
        try {
          await act('requestShiftCorrection', {shiftId:editing.id,start:new Date(v.start).toISOString(),end:new Date(v.end).toISOString(),reason:v.reason});
          setEditing(null);
        } catch {}
      }} />
      <button className="text-button" onClick={() => setEditing(null)}>Abbrechen</button>
    </div>}
    {!!requests.length && <>
      <h3>Meine Anfragen</h3>
      {requests.map(r => <div className="correction-request" key={r.id}>
        <div className="row"><strong>{display(r.start)} – {display(r.end)}</strong><Badge tone={r.status === 'pending' ? 'orange' : ''}>{statusName[r.status]}</Badge></div>
        <p>{r.reason}</p>
        {r.reviewedAt && <small>Entschieden am {display(r.reviewedAt)}</small>}
      </div>)}
    </>}
  </Panel>;
}

export function ShiftApprovals({data, act}) {
  const [busy, setBusy] = useState(false);
  const requests = (data.shiftRequests || []).filter(r => r.status === 'pending')
    .sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  const review = async (id, decision) => {
    setBusy(true);
    try {await act('reviewShiftCorrection', {id,decision});} catch {} finally {setBusy(false);}
  };
  return <Panel title={`Zeitkorrekturen · ${requests.length} offen`} subtitle="Prüfe die vorgeschlagenen Zeiten. Nur genehmigte Anfragen ändern Arbeitszeit und Verdienst.">
    {!requests.length && <p>Keine offenen Anfragen.</p>}
    {requests.map(r => <div className="correction-request" key={r.id}>
      <h3>{data.employees.find(e => e.id === r.employeeId)?.name || 'Mitarbeiter'}</h3>
      <p>Erfasst: {r.shiftId ? `${display(r.originalStart)} – ${display(r.originalEnd)}` : 'Schicht nicht erfasst'}</p>
      <p><strong>Vorschlag: {display(r.start)} – {display(r.end)}</strong></p>
      <p>Begründung: {r.reason}</p>
      <small>Angefragt am {display(r.createdAt)}</small>
      <div className="toolbar">
        <button className="primary" disabled={busy} onClick={() => review(r.id, 'approved')}>Genehmigen</button>
        <button className="secondary" disabled={busy} onClick={() => review(r.id, 'rejected')}>Ablehnen</button>
      </div>
    </div>)}
  </Panel>;
}
