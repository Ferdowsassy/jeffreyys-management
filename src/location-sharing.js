import {useEffect, useState, useRef} from 'react';
import {gpsTimestamp} from './gps';

// Mounted by App so changing pages does not stop a driver's GPS watch.
export function useDriverLocation({user, data, send, ready}) {
  const [enabledFor, setEnabledFor] = useState(() => {
    try {return sessionStorage.getItem('jeffreyys-location-sharing');} catch {return null;}
  });
  const [status, setStatus] = useState('Standortfreigabe aus');
  const operations = useRef(Promise.resolve());
  const active = data?.shifts.find(s => s.employeeId === user?.id && !s.end);
  const tracking = user?.role === 'driver' && !!active && enabledFor === user.id;

  useEffect(() => {
    if (ready && (!active || user?.role !== 'driver' || (enabledFor && enabledFor !== user.id))) {
      setEnabledFor(null);
      setStatus('Standortfreigabe aus');
    }
  }, [ready, active?.id, user?.id, user?.role, enabledFor]);
  useEffect(() => {
    try {
      if (enabledFor) sessionStorage.setItem('jeffreyys-location-sharing',enabledFor);
      else sessionStorage.removeItem('jeffreyys-location-sharing');
    } catch {}
  }, [enabledFor]);

  useEffect(() => {
    if (!tracking) return;
    let cancelled = false, latest = null, uploading = false, lastAttempt = 0, lastFixAt = 0;
    let pending = Promise.resolve();
    const geo = navigator.geolocation;
    if (!window.isSecureContext || !geo) {
      setStatus(!window.isSecureContext ? 'Standort benötigt HTTPS. Bitte die sichere App-Adresse öffnen.' : 'Dieser Browser unterstützt keinen Standortzugriff.');
      setEnabledFor(null);
      return;
    }
    setStatus('Standortberechtigung bestätigen · GPS wird gesucht …');
    async function publish() {
      if (cancelled || uploading) return;
      if (lastFixAt && Date.now() - lastFixAt > 20000) {
        setStatus('GPS-Position ist veraltet. Neuer Standort wird gesucht …');
        return;
      }
      if (!latest || Date.now() - lastAttempt < 5000) return;
      const position = latest;
      latest = null;
      uploading = true;
      lastAttempt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      pending = operations.current.catch(() => {}).then(() => send('action', {
        type:'saveLocation', employeeId:user.id, latitude:position.coords.latitude, longitude:position.coords.longitude,
        accuracy:position.coords.accuracy, capturedAt:new Date(position.timestamp).toISOString(),
      }, {signal:controller.signal})).then(() => {
        if (!cancelled) setStatus('Standort wird live mit Chef und Küche geteilt.');
      }).catch(error => {
        if (!cancelled) {
          latest = latest || position;
          if (error.status === 401 || error.status === 403) {
            setStatus('Standortfreigabe benötigt eine gültige Fahrer-Anmeldung. Bitte erneut anmelden.');
            setEnabledFor(null);
          } else {
            setStatus(error.status === 400 ? 'GPS-Werte konnten nicht übernommen werden. Standort und Gerätezeit prüfen.' : 'Standort konnte nicht gesendet werden. Verbindung wird erneut versucht.');
          }
        }
      }).finally(() => {clearTimeout(timeout); uploading = false;});
      operations.current = pending;
      await pending;
    }
    const success = position => {
      if (cancelled) return;
      const timestamp = gpsTimestamp(position.timestamp);
      if (timestamp === null) {
        setStatus('GPS-Zeitstempel ist veraltet oder ungültig. Neuer Standort wird gesucht; bitte Gerätezeit prüfen.');
        return;
      }
      latest = {coords:position.coords,timestamp};
      lastFixAt = timestamp;
      publish();
    };
    const failure = error => {
      if (cancelled) return;
      if (error.code === 1) {
        setStatus('Standortzugriff blockiert. In den Browser- und Geräteeinstellungen für diese App erlauben und erneut aktivieren.');
        setEnabledFor(null);
      } else {
        setStatus(error.code === 3 ? 'GPS antwortet noch nicht. Standort wird erneut gesucht …' : 'Kein GPS-Signal. Bitte Gerätestandort prüfen; erneuter Versuch läuft.');
      }
    };
    const options = {enableHighAccuracy:true, maximumAge:0, timeout:12000};
    const watch = geo.watchPosition(success, failure, options);
    const request = () => geo.getCurrentPosition(success, failure, options);
    // Refresh even while stationary; never label an old cached fix as live.
    request();
    const refresh = setInterval(request, 10000);
    const upload = setInterval(publish, 5000);
    const foreground = () => {if (document.visibilityState === 'visible') request();};
    document.addEventListener('visibilitychange', foreground);
    window.addEventListener('online', request);
    return () => {
      cancelled = true;
      geo.clearWatch(watch);
      clearInterval(refresh);
      clearInterval(upload);
      document.removeEventListener('visibilitychange', foreground);
      window.removeEventListener('online', request);
      // Order stop after any already-started upload, so it cannot resurrect sharing.
      operations.current = operations.current.catch(() => {}).then(() => send('action', {type:'stopLocation',employeeId:user.id}).catch(() => {}));
    };
  }, [tracking, active?.id, user?.id, send]);

  return {tracking, status, toggle() {
    if (tracking) {setEnabledFor(null);setStatus('Standortfreigabe aus');}
    else setEnabledFor(user?.id || null);
  }};
}
