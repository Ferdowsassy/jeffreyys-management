import React, {useLayoutEffect, useRef, useState} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export default function LiveDriverMap({drivers}) {
  const container = useRef(null), map = useRef(null), markers = useRef(new Map()), fitted = useRef('');
  const [selected, setSelected] = useState(''), [now, setNow] = useState(Date.now());
  const [tileError, setTileError] = useState(false);
  const located = drivers.filter(driver => {
    const location = driver.location;
    return location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)
      && now - Date.parse(location.capturedAt || location.updatedAt) < 120000;
  });
  const focus = located.find(driver => driver.id === selected);

  useLayoutEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    const view = L.map(container.current).setView([48.137, 11.575], 12);
    map.current = view;
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom:19, referrerPolicy:'strict-origin-when-cross-origin',
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(view);
    tiles.on('tileerror', () => setTileError(true));
    tiles.on('tileload', () => setTileError(false));
    const resize = new ResizeObserver(() => view.invalidateSize());
    resize.observe(container.current);
    return () => {
      clearInterval(timer);
      resize.disconnect();
      view.remove();
      map.current = null;
      markers.current.clear();
    };
  }, []);

  useLayoutEffect(() => {
    const view = map.current;
    if (!view) return;
    const currentIds = new Set(located.map(driver => driver.id));
    for (const [id, marker] of markers.current) {
      if (!currentIds.has(id)) {marker.remove();markers.current.delete(id);}
    }
    for (const driver of located) {
      const {latitude, longitude} = driver.location;
      const age = Math.max(0, now - Date.parse(driver.location.capturedAt || driver.location.updatedAt));
      let marker = markers.current.get(driver.id);
      if (!marker) {
        const name = document.createElement('span');
        name.textContent = driver.name;
        marker = L.marker([latitude,longitude], {title:driver.name,
          icon:L.divIcon({className:'driver-marker',html:name,iconSize:[110,32],iconAnchor:[55,16]}),
        }).addTo(view);
        markers.current.set(driver.id, marker);
      }
      marker.setLatLng([latitude,longitude]);
      const element = marker.getElement();
      element.dataset.driverId = driver.id;
      element.dataset.latitude = latitude;
      element.dataset.longitude = longitude;
      element.classList.toggle('stale', age > 30000);
      element.querySelector('span').textContent = driver.name;
    }
    const key = focus?.id || located.map(driver => driver.id).sort().join('|');
    const points = (focus ? [focus] : located).map(driver => [driver.location.latitude,driver.location.longitude]);
    if (points.length && (fitted.current !== key || points.some(point => !view.getBounds().contains(point)))) {
      view.fitBounds(points, {padding:[40,40],maxZoom:15,animate:false});
      fitted.current = key;
    }
  }, [drivers, selected, now]);

  return <>
    <label>Fahrerstandort <select aria-label="Fahrerstandort" value={focus?.id || ''} onChange={e => setSelected(e.target.value)}>
      <option value="">Alle Fahrer</option>
      {located.map(driver => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
    </select></label>
    <div ref={container} className="live-driver-map" role="region" aria-label="Live-Fahrerkarte" />
    {tileError && <p role="status">Kartenhintergrund konnte nicht geladen werden. Fahrerpositionen werden weiterhin aktualisiert.</p>}
    {!located.length && <p className="muted">Keine aktuellen Fahrerstandorte. Fahrer müssen einstempeln, Standortfreigabe aktivieren und den Browserzugriff erlauben.</p>}
    <div className="location-status-list" aria-live="polite">
      {drivers.map(driver => {
        const current = located.find(item => item.id === driver.id);
        const age = current ? Math.max(0, now - Date.parse(current.location.capturedAt || current.location.updatedAt)) : null;
        return <div key={driver.id} data-location-status={driver.id}>
          <strong>{driver.name}</strong>
          <span>{age === null ? 'Keine aktuelle GPS-Position' : age <= 30000 ? `Live · vor ${Math.floor(age / 1000)} s` : `GPS pausiert · vor ${Math.floor(age / 1000)} s`}</span>
          {current?.location.accuracy !== undefined && <small>Genauigkeit ca. {Math.round(current.location.accuracy)} m</small>}
        </div>;
      })}
    </div>
  </>;
}
