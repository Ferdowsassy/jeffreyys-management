import React, {useState} from 'react';
import {Panel} from './main';
import {absenceNames, defaultShiftTemplates} from '../shared/schedule';

export function ScheduleEditor({data,editing,defaultDate,act,onClose}) {
  const employees=data.employees.filter(e=>e.active !== false);
  const [employeeId,setEmployeeId]=useState(editing?.employeeId || employees[0]?.id || '');
  const [date,setDate]=useState(editing?.date || defaultDate);
  const [start,setStart]=useState(editing?.start || '11:00'), [end,setEnd]=useState(editing?.end || '00:00');
  const [busy,setBusy]=useState(false);
  const templates=data.settings.shiftTemplates || defaultShiftTemplates;
  const selected=data.schedule.find(s=>s.employeeId===employeeId && s.date===date);
  const employee=employees.find(e=>e.id===employeeId);
  const ready=!!employeeId && !!date && !busy;
  async function save(values) {
    if (!ready) return;
    setBusy(true);
    try {await act('saveSchedule',{employeeId,date,...values,...(editing?.id ? {id:editing.id} : {})});onClose();}
    catch {} finally {setBusy(false);}
  }
  async function remove() {
    const id=editing?.id || selected?.id;
    if (!id || busy) return;
    setBusy(true);
    try {await act('deleteSchedule',{id});onClose();} catch {} finally {setBusy(false);}
  }
  return <Panel className="shift-editor" title={editing?.id ? 'Planeintrag bearbeiten' : 'Schicht eintragen'}
    action={<button className="text-button" disabled={busy} onClick={onClose}>Abbrechen</button>}>
    <form className="shift-editor-body" onSubmit={event=>{event.preventDefault();save({kind:'shift',start,end});}}>
      <div className="shift-editor-fields">
        <label>Mitarbeiter<select aria-label="Mitarbeiter" disabled={busy} value={employeeId} onChange={e=>setEmployeeId(e.target.value)}>
          {employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
        </select></label>
        <label>Datum<input aria-label="Datum" type="date" required disabled={busy} value={date} onChange={e=>setDate(e.target.value)} /></label>
      </div>
      {employee && <p className="shift-editor-context"><strong>{employee.name}</strong>{date && ' · '+new Date(date+'T12:00:00Z').toLocaleDateString('de-DE',{weekday:'long',day:'2-digit',month:'2-digit',timeZone:'Europe/Berlin'})}</p>}
      {selected && !editing?.id && <p className="muted">Der vorhandene Planeintrag für diesen Tag wird ersetzt.</p>}
      <div className="shift-template-list" aria-label="Schichtvorlagen">
        {templates.map(template=><button type="button" className="shift-template" disabled={!ready} key={template.id}
          onClick={()=>save({kind:'shift',start:template.start,end:template.end,templateName:template.name})}>
          <strong>{template.name}</strong><span>{template.start} – {template.end}{template.end < template.start ? ' (+1 Tag)' : ''}</span>
        </button>)}
      </div>
      <div className="shift-absence-options">
        {Object.entries(absenceNames).map(([kind,label])=><button className="secondary" type="button" key={kind} disabled={!ready} onClick={()=>save({kind})}>{label}</button>)}
      </div>
      <fieldset className="shift-custom"><legend>Andere Zeit</legend>
        <div className="shift-editor-fields"><label>Beginn<input aria-label="Beginn" type="time" required value={start} disabled={busy} onChange={e=>setStart(e.target.value)} /></label>
          <label>Ende<input aria-label="Ende" type="time" required value={end} disabled={busy} onChange={e=>setEnd(e.target.value)} /></label></div>
        <button className="primary" disabled={!ready} type="submit">{busy ? 'Wird gespeichert …' : 'Diese Zeit eintragen'}</button>
      </fieldset>
      {(editing?.id || selected) && <button className="text-button" type="button" disabled={busy} onClick={remove}>Planeintrag entfernen</button>}
    </form>
  </Panel>;
}

export function ShiftTemplateEditor({data,act,onClose}) {
  const [templates,setTemplates]=useState(()=>structuredClone(data.settings.shiftTemplates || defaultShiftTemplates));
  const [busy,setBusy]=useState(false);
  const update=(index,key,value)=>setTemplates(current=>current.map((template,i)=>i===index?{...template,[key]:value}:template));
  return <Panel title="Schichtvorlagen" subtitle="Name und Zeiten für die schnelle Planung. Bereits geplante Schichten behalten ihre Zeiten."
    action={<button className="text-button" disabled={busy} onClick={onClose}>Abbrechen</button>}>
    <form className="shift-editor-body" onSubmit={async event=>{
      event.preventDefault();setBusy(true);
      try {await act('saveShiftTemplates',{templates});onClose();} catch {} finally {setBusy(false);}
    }}>
      {templates.map((template,index)=><div className="template-edit-row" key={template.id}>
        <label>Name<input aria-label={'Vorlage '+(index+1)+' Name'} maxLength={60} required value={template.name} onChange={e=>update(index,'name',e.target.value)} /></label>
        <label>Beginn<input aria-label={'Vorlage '+(index+1)+' Beginn'} type="time" required value={template.start} onChange={e=>update(index,'start',e.target.value)} /></label>
        <label>Ende<input aria-label={'Vorlage '+(index+1)+' Ende'} type="time" required value={template.end} onChange={e=>update(index,'end',e.target.value)} /></label>
        <button className="text-button" type="button" aria-label={'Vorlage '+(index+1)+' entfernen'} disabled={busy || templates.length===1} onClick={()=>setTemplates(current=>current.filter(t=>t.id!==template.id))}>Entfernen</button>
      </div>)}
      <div className="row"><button type="button" className="secondary" disabled={busy || templates.length>=12}
        onClick={()=>setTemplates(current=>[...current,{id:crypto.randomUUID(),name:'Neue Vorlage',start:'11:00',end:'17:00'}])}>+ Vorlage</button>
        <button className="primary" type="submit" disabled={busy}>Vorlagen speichern</button></div>
    </form>
  </Panel>;
}
