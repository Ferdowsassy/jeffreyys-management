import PDFDocument from 'pdfkit';
import {shiftDate} from '../shared/daily-stats.js';
import {absenceNames, scheduleHours} from '../shared/schedule.js';

const roles = {kitchen:'Küche',driver:'Fahrer',chef:'Chef'};
const dateLabel = date => date.slice(8)+'.'+date.slice(5,7)+'.'+date.slice(0,4);
export function scheduleWeek(weekStart, role='all') {
  const date = typeof weekStart==='string' && /^\d{4}-\d{2}-\d{2}$/.test(weekStart) ? new Date(weekStart+'T12:00:00Z') : null;
  if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==weekStart || date.getUTCDay()!==1 || date.getUTCFullYear()<1900 || date.getUTCFullYear()>2200)
    throw Object.assign(new Error('Bitte einen gültigen Wochenbeginn (Montag) wählen.'),{status:400});
  if (!['all',...Object.keys(roles)].includes(role)) throw Object.assign(new Error('Ungültige Planrolle.'),{status:400});
  return Array.from({length:7},(_,i)=>shiftDate(weekStart,i));
}
export function scheduleWeekNumber(weekStart) {
  const days=scheduleWeek(weekStart);
  const thursday=new Date(days[3]+'T00:00:00Z'),year=thursday.getUTCFullYear();
  return {year,week:Math.ceil(((thursday-new Date(Date.UTC(year,0,1)))/86400000+1)/7)};
}
export function schedulePdf(data, weekStart, role='all') {
  const days=scheduleWeek(weekStart,role);
  const doc=new PDFDocument({size:'A4',layout:'landscape',margin:32,bufferPages:true,info:{Title:'Stundenplan '+weekStart,Author:'Jeffreyys'}});
  const chunks=[];
  const complete=new Promise((resolve,reject)=>{doc.on('data',part=>chunks.push(part));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  const left=32,width=doc.page.width-64,nameWidth=134,dayWidth=(width-nameWidth)/7;
  const bottom=doc.page.height-64;
  const entries=data.schedule.filter(entry=>days.includes(entry.date));
  const {year,week}=scheduleWeekNumber(weekStart);
  function title() {
    doc.fillColor('#284b3d').font('Helvetica-Bold').fontSize(22).text('jeffreyys',left,28);
    doc.fontSize(18).text('Stundenplan',left,62);
    doc.font('Helvetica').fontSize(12).fillColor('#536557').text(`${dateLabel(days[0])} - ${dateLabel(days[6])}  |  KW ${week} / ${year}`,left,87);
    doc.y=116;
  }
  function header(group,continued=false) {
    const y=doc.y;
    doc.rect(left,y,width,30).fill(group==='driver'?'#edf3f7':'#edf2e8');
    doc.fillColor('#243a33').font('Helvetica-Bold').fontSize(13).text(roles[group]+(continued?' (Fortsetzung)':''),left+10,y+8);
    const top=y+30;
    doc.rect(left,top,width,39).fill('#fafbf7');
    doc.fillColor('#243a33').font('Helvetica-Bold').fontSize(10).text('Mitarbeiter',left+10,top+13,{width:nameWidth-20});
    days.forEach((day,i)=>{
      const weekday=new Date(day+'T12:00:00Z').toLocaleDateString('de-DE',{weekday:'short',timeZone:'UTC'});
      doc.text(weekday+'\n'+day.slice(8)+'.'+day.slice(5,7)+'.',left+nameWidth+i*dayWidth+6,top+7,{width:dayWidth-12,align:'center'});
    });
    doc.y=top+39;
  }
  title();
  const groups=role==='all'?['kitchen','driver',...(entries.some(entry=>data.employees.some(e=>e.id===entry.employeeId && e.role==='chef'))?['chef']:[])]:[role];
  for(const group of groups) {
    const employees=data.employees.filter(e=>e.role===group && (e.active!==false || entries.some(entry=>entry.employeeId===e.id)))
      .sort((a,b)=>a.name.localeCompare(b.name,'de'));
    if(doc.y+110>bottom){doc.addPage();title();}
    header(group);
    if(!employees.length){doc.font('Helvetica').fontSize(11).fillColor('#66736c').text('Keine Mitarbeiter für diese Woche.',left+10,doc.y+12);doc.y+=28;}
    for(const employee of employees) {
      const cells=days.map(day=>entries.filter(entry=>entry.employeeId===employee.id && entry.date===day)
        .sort((a,b)=>(a.start || '').localeCompare(b.start || ''))
        .map(entry=>absenceNames[entry.kind] || `${entry.start} - ${entry.end}${entry.end<entry.start?'\n(+1 Tag)':''}`).join('\n') || '-');
      doc.font('Helvetica').fontSize(11);
      const height=Math.max(48,...cells.map(cell=>doc.heightOfString(cell,{width:dayWidth-12})+20),
        doc.font('Helvetica-Bold').heightOfString(employee.name,{width:nameWidth-20})+20);
      if(doc.y+height>bottom){doc.addPage();title();header(group,true);}
      const y=doc.y;
      doc.rect(left,y,nameWidth,height).fill('#f7f9f4');
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#243a33').text(employee.name,left+10,y+12,{width:nameWidth-20});
      doc.font('Helvetica');
      cells.forEach((cell,i)=>{
        const x=left+nameWidth+i*dayWidth;
        doc.moveTo(x,y).lineTo(x,y+height).strokeColor('#e2e6df').stroke();
        doc.fillColor(cell==='-'?'#8b968d':'#243a33').text(cell,x+6,y+12,{width:dayWidth-12,align:'center'});
      });
      doc.moveTo(left,y+height).lineTo(left+width,y+height).strokeColor('#e2e6df').stroke();
      doc.y=y+height;
    }
    const hours=entries.filter(entry=>data.employees.some(e=>e.id===entry.employeeId && e.role===group)).reduce((n,entry)=>n+scheduleHours(entry),0);
    if(doc.y+25>bottom){doc.addPage();title();}
    doc.font('Helvetica').fontSize(10).fillColor('#66736c').text(`${hours.toLocaleString('de-DE',{maximumFractionDigits:2})} Stunden geplant`,left+10,doc.y+9);
    doc.y+=30;
  }
  const range=doc.bufferedPageRange();
  for(let i=range.start;i<range.start+range.count;i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(9).fillColor('#66736c').text('Geplante Schichten | (+1 Tag) = Ende am Folgetag | - = kein Eintrag',left,doc.page.height-35,{lineBreak:false});
    doc.text(`Seite ${i+1} von ${range.count}`,doc.page.width-130,doc.page.height-35,{lineBreak:false});
  }
  doc.end();return complete;
}
