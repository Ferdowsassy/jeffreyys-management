import PDFDocument from 'pdfkit';
import {monthlyPayroll,periodRange} from '../shared/accounting.js';
import {berlinDate,dailyEarnings,shiftDate} from '../shared/daily-stats.js';
const euro=value=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(value);
const duration=value=>{const m=Math.max(0,Math.round(value*60));return Math.floor(m/60)+' Std. '+String(m%60).padStart(2,'0')+' Min.';};
const role={chef:'Chef',kitchen:'Küche',driver:'Fahrer'};
export function payrollPdf(data,employees,month,now=Date.now()) {
  const doc=new PDFDocument({size:'A4',margin:40,bufferPages:true,info:{Title:'Jeffreyys Monatsübersicht '+month,Author:'Jeffreyys'}}),parts=[];
  const complete=new Promise((resolve,reject)=>{doc.on('data',p=>parts.push(p));doc.on('end',()=>resolve(Buffer.concat(parts)));doc.on('error',reject);});
  const title=subtitle=>{doc.fillColor('#ee642b').font('Helvetica-Bold').fontSize(23).text('jeffreyys');doc.fillColor('#243930').fontSize(17).text('Monatsübersicht '+month);doc.font('Helvetica').fontSize(10).fillColor('#506157').text(subtitle,{width:515});doc.moveDown();};
  let tableHeader;
  function row(cells,widths,{header=false}={}){
    doc.font(header?'Helvetica-Bold':'Helvetica').fontSize(9);
    const height=Math.max(24,...cells.map((c,i)=>doc.heightOfString(String(c),{width:widths[i]-12})+12));
    if(doc.y+height>760){doc.addPage();title('Fortsetzung');if(!header && tableHeader)row(tableHeader.cells,tableHeader.widths,{header:true});}
    if(header)tableHeader={cells,widths};
    const y=doc.y;let x=40;
    if(header)doc.rect(40,y,515,height).fill('#edf1ec');
    cells.forEach((c,i)=>{doc.fillColor('#243930').text(String(c),x+6,y+6,{width:widths[i]-12});x+=widths[i];});
    doc.moveTo(40,y+height).lineTo(555,y+height).strokeColor('#dce2dc').stroke();doc.y=y+height;doc.x=40;
  }
  title('Erstellt am '+new Date(now).toLocaleString('de-DE',{timeZone:'Europe/Berlin'})+' · Zeitzone Europe/Berlin');
  row(['Mitarbeiter','Verdienst','Bargeldabzug','Ausgezahlt','Noch offen'],[155,90,90,90,90],{header:true});
  const rows=employees.map(e=>({e,...monthlyPayroll(e,data,month,now)}));
  for(const r of rows)row([r.e.name,euro(r.gross),euro(r.retained),euro(r.paid),euro(r.balance)],[155,90,90,90,90]);
  row(['Gesamt',...['gross','retained','paid','balance'].map(k=>euro(rows.reduce((n,r)=>n+r[k],0)))],[155,90,90,90,90],{header:true});
  for(const r of rows){
    doc.addPage();title(r.e.name+' · '+role[r.e.role]);
    for(const [label,value] of [['Arbeitszeit',duration(r.hours)],['Stundenlohn gesamt',euro(r.wages)],['Liefergeld',euro(r.fees)],['Verdienst vor Bargeldabzug',euro(r.gross)],['Bar kassiert (zugestellte Bestellungen)',euro(r.cash)],['Bargeld zurückgegeben',euro(r.returned)],['Bargeldabzug',euro(r.retained)],['Auszahlung vor Zahlungen',euro(r.payout)],['Bereits ausgezahlt',euro(r.paid)],['Noch offen',euro(r.balance)]])row([label,value],[350,165]);
    doc.moveDown();doc.font('Helvetica-Bold').fontSize(12).text('Arbeitszeit und Verdienst pro Tag');doc.moveDown(.5);
    row(['Tag','Arbeitszeit','Lohn','Liefergeld','Verdienst'],[95,135,95,95,95],{header:true});
    const range=periodRange('month',month);
    for(let d=range.first;d<range.end;d=shiftDate(d,1)){const pay=dailyEarnings(data,r.e.id,d,now);row([d.slice(8)+'.'+d.slice(5,7)+'.',duration(pay.hours),euro(pay.wages),euro(pay.fees),euro(pay.gross)],[95,135,95,95,95]);}
    doc.moveDown();doc.font('Helvetica-Bold').fontSize(12).text('Erfasste Gehaltszahlungen');doc.moveDown(.5);
    row(['Datum','Zahlungsart','Betrag','Notiz'],[90,100,100,225],{header:true});
    const payments=(data.salaryPayments || []).filter(p=>p.employeeId===r.e.id && p.month===month);
    if(!payments.length)row(['Keine Zahlungen erfasst.','','',''],[185,100,100,130]);
    for(const p of payments)row([berlinDate(p.createdAt),p.method==='cash'?'Bar':'Überweisung',euro(p.amount),p.note || '-'],[90,100,100,225]);
    if(doc.y>700){doc.addPage();title('Fortsetzung');}
    doc.moveDown();doc.font('Helvetica').fontSize(9).text('Auszahlung = Lohn + Liefergeld - einbehaltenes Bargeld. Die gesamte Schicht und zugehörige Lieferungen zählen zum Berliner Tag des Schichtbeginns, auch nach Mitternacht. Bereits erfasste Gehaltszahlungen verringern den offenen Betrag. Laufende Schichten sind vorläufig.');
  }
  const pages=doc.bufferedPageRange();
  for(let i=pages.start;i<pages.start+pages.count;i++){doc.switchToPage(i);doc.font('Helvetica').fontSize(8).fillColor('#65756c').text('JEFFREYYS / '+month+' / Seite '+(i+1)+' von '+pages.count,40,786,{lineBreak:false});}
  doc.end();return complete;
}
