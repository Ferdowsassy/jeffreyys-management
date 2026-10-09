const money = text => {
  const match=text.match(/(?:^|\s)(\d+(?:[.\s]\d{3})*[,\.]\d{2})(?:\s|€|EUR|$)/i);
  if(!match)return null;
  const value=Number(match[1].replace(/\s/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.'));
  return Number.isFinite(value) && value>0 ? value : null;
};
export function parseReceipt(text) {
  const lines=String(text||'').normalize('NFKC').split(/\r?\n/).map(line=>line.replace(/[|]/g,' ').replace(/\s+/g,' ').trim()).filter(Boolean);
  const draft={address:'',postalCode:'',city:'',amount:'',payment:'',orderNumber:''};
  const warnings=[];
  const invoiceStart=lines.findIndex(line=>/RE\s*\/\s*AN|RECHNUNG\b|RECHNUNGSNUMMER/i.test(line));
  const header=lines.slice(0,invoiceStart<0?Math.min(lines.length,25):invoiceStart);
  const deliveryStart=lines.findIndex(line=>/^lieferadresse\b|^kundenadresse\b/i.test(line));
  const addressLines=deliveryStart>=0 ? lines.slice(deliveryStart+1,deliveryStart+6) : header;
  const addresses=[];
  for(let i=1;i<addressLines.length;i++) {
    const postal=addressLines[i].match(/^(\d{5})\s+([A-Za-zÀ-ž][A-Za-zÀ-ž .-]+)$/);
    const street=addressLines[i-1];
    const shop=/burger|restaurant|pizzeria|imbiss|jeffrey/i.test(addressLines[i-2]||'');
    if(postal && !shop && /[A-Za-zÀ-ž].*\s\d+[a-z]?(?:\s*[-/]\s*\d+[a-z]?)?$/i.test(street) && !/telefon|tel\.?|kunden|datum/i.test(street))
      addresses.push({address:street.replace(/stra(?:Be|ße|sse|f?lle)(?=\s*\d)/gi,'straße'),postalCode:postal[1],city:postal[2].replace(/m[uü]nchen/i,'München')});
  }
  // The restaurant header precedes the customer's address on this receipt layout.
  if(addresses.length) Object.assign(draft,addresses.at(-1));
  const order=lines.map(line=>line.match(/(?:deine\s+)?bestell(?:nummer|nr\.?|ung)\s*[:#]?\s*([A-Z0-9][A-Z0-9\/-]{2,30})\s*$/i)).find(Boolean);
  if(order) draft.orderNumber=order[1].toUpperCase();
  else {
    const invoice=lines.map(line=>line.match(/RE\s*\/\s*AN\s*[-–]?\s*Nr\.?\s*[:#]?\s*(\d+(?:\s*\/\s*\d+)?)/i)).find(Boolean);
    if(invoice){draft.orderNumber=invoice[1].replace(/\s/g,'');warnings.push('Bestellnummer nicht erkannt: Rechnungsnummer vorgeschlagen. Bitte prüfen.');}
  }
  const totals=[];
  for(let i=0;i<lines.length;i++)
    if(/rechnungsbetrag|^gesamt(?:betrag)?\b|endsumme|zu zahlen|total\b/i.test(lines[i])) {
      const value=money(lines[i]) ?? (i+1<lines.length ? money(lines[i+1]) : null);
      if(value!==null)totals.push(value);
    }
  const unique=[...new Set(totals)];
  if(unique.length===1)draft.amount=unique[0];
  else if(unique.length>1)warnings.push('Mehrere Gesamtbeträge erkannt. Betrag bitte selbst eintragen.');
  const paymentLines=lines.filter(line=>/zahlungsart|zahlungsweise|^zahlung\b|payment|online\s+bezahlt|bar\s*bezahlt|barzahlung/i.test(line)).join(' ');
  const online=/online\s*(?:bezahlt|zahlung)|paypal|(?:zahlungsart|zahlungsweise|zahlung|payment)\s*[:]?\s*(?:online|karte|card|kredit)/i.test(paymentLines);
  const cash=/bar\s*bezahlt|barzahlung|(?:zahlungsart|zahlungsweise|zahlung|payment)\s*[:]?\s*(?:bar\b|cash\b)/i.test(paymentLines);
  if(online!==cash)draft.payment=online?'online':'cash';
  const labels={address:'Adresse',postalCode:'PLZ',city:'Ort',amount:'Gesamtbetrag',payment:'Zahlungsart',orderNumber:'Bestellnummer'};
  for(const [field,label] of Object.entries(labels))if(draft[field]==='')warnings.push(`${label} nicht sicher erkannt. Bitte ergänzen.`);
  const format=/ubereats|uber\s*eats/i.test(lines.join(' '))?'Uber Eats':/lieferando/i.test(lines.join(' '))?'Lieferando':deliveryStart>=0?'Lieferbeleg':'Kassenbon';
  return {draft,warnings,format};
}
