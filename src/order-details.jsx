import React, {useState} from 'react';
import {MapPin, Navigation} from 'lucide-react';
import {Form} from './main';

const text = value => ['string','number','boolean'].includes(typeof value) ? String(value) : '';
const list = value => !value ? [] : Array.isArray(value) ? value : [value];
const labels = {
  OrderID:'Bestellnummer', ProviderReference:'Bestellreferenz', Customer:'Kunde', CustomerNo:'Kundennummer', DeliveryAddress:'Lieferadresse', BillAddress:'Rechnungsadresse',
  Title:'Anrede', FirstName:'Vorname', LastName:'Nachname', Company:'Firma', Street:'Straße', HouseNo:'Hausnummer',
  AddAddress:'Adresszusatz', Zip:'Postleitzahl', City:'Ort', State:'Bundesland', Country:'Land', PhoneNo:'Telefon', Mobile:'Mobiltelefon', EMail:'E-Mail', Email:'E-Mail',
  DescriptionOfWay:'Anfahrt / Wegbeschreibung', StoreData:'Filiale', StoreId:'Filialnummer', StoreID:'Filialnummer', StoreName:'Filialname',
  AddInfo:'Bestellung und Zahlung', DeliverType:'Lieferart', DeliveryType:'Lieferart', DateTimeOrder:'Vorbestellung / gewünschte Zeit', PromisedETA:'Zugesagte Lieferzeit',
  DiscountValue:'Rabattbetrag', DiscountPercent:'Rabatt (%)', DiscountName:'Rabatt', DeliverLumpSum:'Liefergebühr', CurrencyStr:'Währung',
  PaymentType:'Zahlungsart', PaymentFee:'Zahlungsgebühr', MinQuantitySurcharge:'Mindermengenzuschlag', MinOrderValue:'Mindestbestellwert',
  Tip:'Trinkgeld', Total:'Gesamtbetrag', TransactionID:'Zahlungsreferenz', ContactlessDelivery:'Kontaktlose Lieferung', Comment:'Hinweis',
  ArticleList:'Bestellte Artikel', Article:'Artikel', ArticleNo:'Artikelnummer', ArticleName:'Artikelname', ArticleSize:'Größe', Count:'Anzahl',
  Price:'Preis laut Kasse', Tax:'Steuer', Deposit:'Pfand', SubArticleList:'Zusätze', SubArticle:'Zusatz', Partition:'Aufteilung',
};

export function NavigationLinks({order}) {
  if (!order.address?.trim() || order.noAddress) return null;
  const destination=[order.address.trim(),[order.postalCode,order.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return <>
    <a className="secondary" href={'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(destination)} target="_blank" rel="noreferrer"><MapPin size={17} />Google Maps öffnen</a>
    <a className="secondary" href={'https://waze.com/ul?q='+encodeURIComponent(destination)+'&navigate=yes&utm_source=jeffreyys-management'} target="_blank" rel="noreferrer"><Navigation size={17} />Waze öffnen</a>
  </>;
}

function SourceFields({value,depth=0}) {
  if (!value || typeof value!=='object') return <span>{text(value) || '—'}</span>;
  if (depth>12) return <pre className="order-notes">{JSON.stringify(value,null,2)}</pre>;
  return <dl className="order-source-fields">{Object.entries(value).map(([key,entry]) => <div key={key}>
    <dt>{Array.isArray(value) ? Number(key)+1 : Object.hasOwn(labels,key) ? labels[key] : key}</dt>
    <dd>{entry && typeof entry==='object' ? <SourceFields value={entry} depth={depth+1} /> : text(entry) || '—'}</dd>
  </div>)}</dl>;
}

function Article({article,extra=false}) {
  if (!article || typeof article!=='object') return null;
  const quantity=text(article.Count), price=text(article.Price), size=text(article.ArticleSize);
  return <li>
    <strong>{quantity ? quantity+' × ' : ''}{text(article.ArticleName) || (extra ? 'Zusatz' : 'Artikel')}{size ? ' · '+size : ''}</strong>
    {price && <span className="order-item-price">Preis laut Kasse: {price}</span>}
    {text(article.ArticleNo) && <small>Art.-Nr. {text(article.ArticleNo)}</small>}
    {text(article.Partition) && <small>Aufteilung: {text(article.Partition)}</small>}
    {text(article.Comment) && <p className="order-notes">{text(article.Comment)}</p>}
    {list(article.SubArticleList?.SubArticle).length>0 && <ul>{list(article.SubArticleList.SubArticle).map((item,index)=><Article key={index} article={item} extra />)}</ul>}
  </li>;
}

export function OrderDetails({order,act,canCorrect=false}) {
  const [showAll,setShowAll]=useState(false);
  const [error,setError]=useState('');
  if (order.source!=='winorder') return null;
  const details=order.winorderDetails, address=details?.Customer?.DeliveryAddress || {};
  const articles=list(details?.ArticleList?.Article);
  const name=[text(address.Title),order.customerName].filter(Boolean).join(' ');
  const phone=order.customerPhone, mobile=text(address.Mobile), email=text(address.EMail || address.Email);
  return <div className="imported-order-details">
    {(name || text(address.Company)) && <div className="order-customer"><h3>Kunde</h3>{name && <p><strong>{name}</strong></p>}{text(address.Company) && <p>{text(address.Company)}</p>}</div>}
    <div className="order-contact-actions">
      {phone && <a className="secondary" href={'tel:'+phone}>Anrufen: {phone}</a>}
      {mobile && mobile!==phone && <a className="secondary" href={'tel:'+mobile}>Mobil: {mobile}</a>}
      {email && <p>E-Mail: {email}</p>}
    </div>
    <p><strong>Zahlungsart:</strong> {order.payment==='cash' ? 'Bar kassieren' : order.payment==='online' ? 'Bereits bezahlt' : 'Noch ergänzen'}{order.paymentLabel && <> · Kasse: {order.paymentLabel}</>}</p>
    {order.deliveryNotes && <p className="order-notes">{order.deliveryNotes}</p>}
    {order.reviewIssues?.length>0 && <div className="notice">{order.reviewIssues.join(' · ')}</div>}
    {canCorrect && act && order.reviewIssues?.length>0 && <details><summary>Angaben ergänzen</summary>
      <Form initial={{...order,amount:order.amount ?? '',payment:order.payment || ''}}
        fields={[{name:'address',label:'Straße & Hausnummer'},{name:'postalCode',label:'PLZ',pattern:'[0-9]{5}'},{name:'city',label:'Ort'},
          {name:'amount',label:'Gesamtbetrag (€)',type:'number',min:0,step:0.01},
          {name:'payment',label:'Zahlungsart',options:[{value:'',label:'Bitte wählen'},{value:'cash',label:'Bar kassieren'},{value:'online',label:'Bereits bezahlt'}]}]}
        submit="Angaben speichern" onSubmit={async values=>{setError('');try{await act('reviewImportedOrder',{id:order.id,...values,amount:Number(values.amount)});}catch(e){setError(e.message);}}} />
      {error && <p role="alert">{error}</p>}
    </details>}
    <h3>Bestellte Artikel</h3>
    {articles.length>0 ? <ul className="order-article-list">{articles.map((article,index)=><Article key={index} article={article} />)}</ul>
      : order.articleDescription ? <p className="order-notes">{order.articleDescription}</p> : <p>Keine Artikelangaben übertragen.</p>}
    {details && <details className="order-all-details" onToggle={event=>setShowAll(event.currentTarget.open)}><summary>Alle Bestellangaben</summary>{showAll && <SourceFields value={details} />}</details>}
  </div>;
}

export function DeliveryBoard({data,user,act}) {
  if (user.role!=='chef') return null;
  const orders=(data.deliveryBoard || []).slice().sort((a,b)=>(b.claimedAt || b.createdAt).localeCompare(a.claimedAt || a.createdAt));
  return <section className="delivery-board" aria-label="Lieferübersicht"><h2>Wer liefert welche Bestellung?</h2>
    {!orders.length ? <p>Noch keine Lieferungen übernommen.</p> : <div className="delivery-grid">{orders.map(order=><article className="delivery-board-card" key={order.id}>
      <h3>Bestellung {order.orderNumber} · {order.driverName}</h3>
      <p><strong>{order.status==='delivered' ? 'Zugestellt' : 'Unterwegs / übernommen'}</strong>{order.claimedAt ? ' · '+new Date(order.claimedAt).toLocaleTimeString('de-DE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit'}) : ''}</p>
      <p>{order.address} · {order.postalCode} {order.city}</p>
      <details><summary>Bestelldetails</summary><OrderDetails order={order} act={act} canCorrect={order.status==='open' && (user.role==='chef' || user.id===order.employeeId)} /><div className="order-contact-actions"><NavigationLinks order={order} /></div></details>
    </article>)}</div>}
  </section>;
}
