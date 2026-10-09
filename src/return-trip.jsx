import React, {useState} from 'react';
import {api, Panel, Form} from './main';
import {gpsTimestamp} from './gps';
import {returnStatus, transportNames} from '../shared/return-trip';

export function StoreSettings({data, act, notify}) {
  const [results,setResults] = useState([]), [busy,setBusy] = useState(false);
  const store = data.settings.store;
  return <>
    <Panel title="Routendienst" subtitle="Für Routen und Ankunftszeiten wird ein Geoapify API-Schlüssel benötigt.">
      <p>{data.settings.routingConfigured ? 'Geoapify eingerichtet. Du kannst den Schlüssel hier ersetzen.' : 'Geoapify noch nicht eingerichtet.'}</p>
      <p><a href="https://myprojects.geoapify.com/" target="_blank" rel="noreferrer">Geoapify Konto und API-Schlüssel</a></p>
      <Form submit="Geoapify Schlüssel speichern" fields={[{name:'key',label:'Geoapify API-Schlüssel',type:'password',maxLength:1000}]} onSubmit={async (v) => {
        try {await act('saveRoutingKey',{key:v.key});} catch {}
      }} />
    </Panel>
    <Panel title="QR-Adressen auf Belegen" subtitle="Maps-QRs mit ausgeschriebener Adresse funktionieren ohne Schlüssel. Google-Orts-IDs benötigen Places API (New).">
      <p>{data.settings.receiptMapsConfigured ? 'Google Places eingerichtet.' : 'Google Places noch nicht eingerichtet.'}</p>
      <p><a href="https://console.cloud.google.com/google/maps-apis/credentials" target="_blank" rel="noreferrer">Google Maps API-Schlüssel verwalten</a></p>
      <Form submit="Google Places Schlüssel speichern" fields={[{name:'key',label:'Google Places API-Schlüssel',type:'password',maxLength:1000}]} onSubmit={async v=>{try {await act('saveReceiptMapsKey',{key:v.key});} catch {}}} />
    </Panel>
    <Panel title="Ladenadresse" subtitle="Ziel für alle Rückfahrten. Suche die Adresse und bestätige den passenden Treffer.">
      {store && <p><strong>Gespeichert: {store.address}</strong></p>}
      <p>Bereits gestartete Rückfahrten behalten ihr bisheriges Ziel. Fahrer können ihre Route bei Bedarf neu berechnen.</p>
      <Form key={store?.address || 'store'} submit="Adresse suchen" fields={[{name:'address',label:'Straße, Hausnummer, PLZ und Ort',value:store?.address || '',maxLength:400}]} onSubmit={async v => {
        setResults([]);
        try {const response=await api('store/search',{address:v.address});setResults(response.results);} catch(error) {notify(error.message);}
      }} />
      {results.map((result,i)=><div className="correction-request" key={i}>
        <p>{result.address}</p>
        <a href={`https://www.openstreetmap.org/?mlat=${result.latitude}&mlon=${result.longitude}#map=18/${result.latitude}/${result.longitude}`} target="_blank" rel="noreferrer">Position auf Karte prüfen</a>
        <button className="secondary" disabled={busy} onClick={async()=>{
          setBusy(true);
          try {await act('saveStoreLocation',result);setResults([]);} catch {} finally {setBusy(false);}
        }}>Als Ladenadresse speichern</button>
      </div>)}
      <small>Adresssuche und Routen: <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a> · Kartendaten © OpenStreetMap contributors</small>
    </Panel>
  </>;
}
function currentPosition() {
  return new Promise((resolve,reject)=>{
    if (!window.isSecureContext || !navigator.geolocation) {reject(new Error('Standortzugriff benötigt HTTPS und einen unterstützten Browser.'));return;}
    navigator.geolocation.getCurrentPosition(resolve,error=>reject(new Error(error.code === 1
      ? 'Bitte den Standortzugriff für diese Website erlauben.' : 'GPS konnte nicht ermittelt werden. Bitte erneut versuchen.')),
    {enableHighAccuracy:true,maximumAge:0,timeout:15000});
  });
}
export function ReturnTripControls({user,data,act,notify}) {
  const [busy,setBusy]=useState(false);
  const [now,setNow]=useState(Date.now());
  React.useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),10000);return()=>clearInterval(timer);},[]);
  const employee=data.employees.find(e=>e.id===user.id), trip=employee?.returnTrip;
  const active=data.shifts.some(s=>s.employeeId===user.id && !s.end);
  const configured=data.settings.routingConfigured && data.settings.store;
  async function start() {
    setBusy(true);
    try {
      const position=await currentPosition();
      const timestamp=gpsTimestamp(position.timestamp);
      if(timestamp === null) throw new Error('GPS-Standort ist veraltet. Bitte erneut versuchen.');
      await act('startReturnTrip',{latitude:position.coords.latitude,longitude:position.coords.longitude,
        capturedAt:new Date(timestamp).toISOString(),transport:'car'});
    } catch(error) {notify(error.message);} finally {setBusy(false);}
  }
  async function finish(type) {
    setBusy(true);
    try {await act(type);} catch {} finally {setBusy(false);}
  }
  return <Panel title="Zurück zum Laden" subtitle={trip?.destination.address || data.settings.store?.address}>
    <div className="return-body">
    {!configured && <p>Der Chef muss Ladenadresse und Routendienst unter Einstellungen einrichten.</p>}
    {trip && <div className="notice">
      <strong>{returnStatus(trip,now)}</strong>
      <p>Ankunft ca. {new Date(trip.eta).toLocaleTimeString('de-DE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit'})} · {transportNames[trip.transport]}</p>
      <div className="toolbar">
        <button className="primary" disabled={busy} onClick={()=>finish('finishReturnTrip')}>Bin im Laden</button>
        <button className="secondary" disabled={busy} onClick={()=>finish('cancelReturnTrip')}>Rückfahrt abbrechen</button>
      </div>
    </div>}
    <div className="toolbar">
      <button className="primary" disabled={busy || !active || !configured} onClick={start}>
        {busy ? 'Bitte warten …' : trip ? 'Route und Ankunft neu berechnen' : 'Ich fahre zurück zum Laden'}
      </button>
    </div>
    {configured && !active && <p>Bitte zuerst einstempeln.</p>}
    </div>

  </Panel>;
}
