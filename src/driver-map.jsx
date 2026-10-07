import React, {useLayoutEffect, useRef, useState} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {driverColor, returnStatus, routeDistances, estimatedPosition, transportNames} from '../shared/return-trip';

function icon(name, className, color) {
  const label=document.createElement('span');
  label.textContent=name;
  label.style.backgroundColor=color;
  return L.divIcon({className,html:label,iconSize:[160,32],iconAnchor:[80,16]});
}
export default function LiveDriverMap({drivers, store}) {
  const container=useRef(null), map=useRef(null), markers=useRef(new Map()), routes=useRef(new Map()),
    storeMarker=useRef(null), fitted=useRef('');
  const [selected,setSelected]=useState(''), [now,setNow]=useState(Date.now()), [tileError,setTileError]=useState(false);
  const returning=drivers.filter(d=>d.returnTrip);
  const located=drivers.filter(driver=>{
    const location=driver.location;
    return !driver.returnTrip && location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)
      && now-Date.parse(location.capturedAt || location.updatedAt)<120000;
  });
  const available=drivers.filter(d=>returning.includes(d) || located.includes(d));
  const focus=available.find(d=>d.id===selected);
  useLayoutEffect(()=>{
    const timer=setInterval(()=>setNow(Date.now()),5000);
    const view=L.map(container.current).setView([48.137,11.575],12);
    map.current=view;
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom:19,referrerPolicy:'strict-origin-when-cross-origin',
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(view);
    tiles.on('tileerror',()=>setTileError(true));
    tiles.on('tileload',()=>setTileError(false));
    const resize=new ResizeObserver(()=>view.invalidateSize());resize.observe(container.current);
    let frame, last=0;
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animate=()=>{
      const time=Date.now();
      if(time-last>(reduced ? 1000 : 100)) {
        for(const entry of routes.current.values()) entry.marker.setLatLng(estimatedPosition(entry.trip,entry.lengths,time));
        last=time;
      }
      frame=requestAnimationFrame(animate);
    };
    frame=requestAnimationFrame(animate);
    return()=>{
      clearInterval(timer);cancelAnimationFrame(frame);resize.disconnect();view.remove();map.current=null;
      markers.current.clear();routes.current.clear();storeMarker.current=null;fitted.current='';
    };
  },[]);

  useLayoutEffect(()=>{
    const view=map.current;if(!view)return;
    if(store) {
      if(!storeMarker.current) storeMarker.current=L.marker([store.latitude,store.longitude],{icon:icon('Laden','store-marker','#222'),title:store.address}).addTo(view);
      storeMarker.current.setLatLng([store.latitude,store.longitude]);
      const addressLabel=document.createElement("span");addressLabel.textContent=store.address;
      storeMarker.current.bindTooltip(addressLabel);
    } else {storeMarker.current?.remove();storeMarker.current=null;}
    const ids=new Set(located.map(d=>d.id));
    for(const [id,marker] of markers.current) if(!ids.has(id)){marker.remove();markers.current.delete(id);}
    for(const driver of located) {
      const {latitude,longitude}=driver.location;
      const age=Math.max(0,now-Date.parse(driver.location.capturedAt || driver.location.updatedAt));
      let marker=markers.current.get(driver.id);
      if(!marker) {
        marker=L.marker([latitude,longitude],{title:driver.name,icon:icon(driver.name,'driver-marker',driverColor(driver.id))}).addTo(view);
        markers.current.set(driver.id,marker);
      }
      marker.setLatLng([latitude,longitude]);
      const element=marker.getElement();element.dataset.driverId=driver.id;element.dataset.latitude=latitude;element.dataset.longitude=longitude;
      element.classList.toggle('stale',age>30000);element.querySelector('span').textContent=driver.name;
    }
    const returningIds=new Set(returning.map(d=>d.id));
    for(const [id,entry] of routes.current) if(!returningIds.has(id)){entry.line.remove();entry.marker.remove();routes.current.delete(id);}
    for(const driver of returning) {
      const trip=driver.returnTrip;
      let entry=routes.current.get(driver.id);
      if(entry?.trip.id!==trip.id) {
        entry?.line.remove();entry?.marker.remove();
        const lengths=routeDistances(trip.points);
        const color=trip.color || driverColor(driver.id);
        const line=L.polyline(trip.points,{color,weight:5,opacity:0.85,dashArray:'12 8',className:'return-route'}).addTo(view);
        const marker=L.marker(estimatedPosition(trip,lengths,now),{title:`${driver.name} · geschätzter Fortschritt`,
          icon:icon(`${driver.name} · geschätzt`,'return-marker',color)}).addTo(view);
        entry={trip,lengths,line,marker};routes.current.set(driver.id,entry);
      }
      entry.marker.getElement().dataset.returnDriverId=driver.id;
      entry.marker.getElement().querySelector('span').textContent=`${driver.name} · geschätzt`;
      entry.line.getElement()?.classList.toggle('overdue',now>=Date.parse(trip.eta));
    }
    const shown=focus ? [focus] : available;
    const key=(focus?.id || 'all')+'|'+shown.map(d=>d.id+(d.returnTrip?.id || '')).sort().join('|')+'|'+JSON.stringify(store);
    const points=shown.flatMap(d=>d.returnTrip ? d.returnTrip.points : [[d.location.latitude,d.location.longitude]]);
    if(store) points.push([store.latitude,store.longitude]);
    if(points.length && (fitted.current!==key || located.some(d=>!view.getBounds().contains([d.location.latitude,d.location.longitude]) && (!focus || focus.id===d.id)))) {
      view.fitBounds(points,{padding:[65,65],maxZoom:15,animate:false});fitted.current=key;
    }
  },[drivers,store,selected,now]);

  return <>
    <label>Fahrerstandort <select aria-label="Fahrerstandort" value={focus?.id || ''} onChange={e=>setSelected(e.target.value)}>
      <option value="">Alle Fahrer</option>{available.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
    </select></label>
    <div ref={container} className="live-driver-map" role="region" aria-label="Live-Fahrerkarte" />
    {tileError && <p role="status">Kartenhintergrund konnte nicht geladen werden. Fahrerpositionen und Rückfahrten werden weiterhin angezeigt.</p>}
    {!!returning.length && <p className="muted">Gestrichelte Linien und bewegte Marker zeigen geschätzten Fortschritt ab Rückfahrtstart. Keine Live-Ortung oder Live-Verkehrsdaten. Ankunft wird erst vom Fahrer bestätigt.</p>}
    {!available.length && <p className="muted">Keine aktuellen Fahrerstandorte oder Rückfahrten. Fahrer können Standortfreigabe aktivieren oder eine Rückfahrt starten.</p>}
    <div className="location-status-list" aria-live="polite">
      {drivers.map(driver=>{
        const trip=driver.returnTrip, current=located.find(d=>d.id===driver.id);
        const age=current ? Math.max(0,now-Date.parse(current.location.capturedAt || current.location.updatedAt)) : null;
        return <div key={driver.id} data-location-status={driver.id} style={trip ? {borderLeft:`4px solid ${trip.color}`,paddingLeft:10} : undefined}>
          <strong>{driver.name}</strong>
          {trip ? <>
            <span>{returnStatus(trip,now)}</span>
            <small>Ankunft ca. {new Date(trip.eta).toLocaleTimeString('de-DE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit'})} · {transportNames[trip.transport]} · {(trip.distanceMeters/1000).toFixed(1)} km</small>
            <small>Ziel: {trip.destination.address}</small>
          </> : <>
            <span>{age===null ? 'Keine aktuelle GPS-Position' : age<=30000 ? `Live · vor ${Math.floor(age/1000)} s` : `GPS pausiert · vor ${Math.floor(age/1000)} s`}</span>
            {current?.location.accuracy!==undefined && <small>Genauigkeit ca. {Math.round(current.location.accuracy)} m</small>}
          </>}
        </div>;
      })}
    </div>
    {!!returning.length && <small>Routen: <a href="https://openrouteservice.org/" target="_blank" rel="noreferrer">openrouteservice</a> · © OpenStreetMap contributors</small>}
  </>;
}
