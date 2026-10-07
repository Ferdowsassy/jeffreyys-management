import {randomUUID} from 'node:crypto';
import {fail} from './domain.js';

const profiles = {car:'driving-car'};
export function routingKey(settings) {
  return process.env.ORS_API_KEY || settings.routingApiKey;
}
function coordinate(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    fail('Ungültige Standortkoordinaten.');
  return value;
}
export function validateStore(store) {
  if (!store || typeof store.address !== 'string' || !store.address.trim() || store.address.length > 400)
    fail('Bitte eine vollständige Ladenadresse angeben.');
  return {address:store.address.trim(),latitude:coordinate(store.latitude,-90,90),longitude:coordinate(store.longitude,-180,180)};
}
async function request(url, key, body, send) {
  let response;
  try {
    response = await send(url, {method:body ? 'POST' : 'GET',signal:AbortSignal.timeout(15000),
      headers:{Authorization:key,'Content-Type':'application/json'},...(body ? {body:JSON.stringify(body)} : {})});
  } catch {fail('Der Routendienst ist nicht erreichbar. Bitte erneut versuchen.', 502);}
  if (!response.ok) {
    if ([401,403].includes(response.status)) fail('Der Routendienst hat den API-Schlüssel abgelehnt. Bitte den Chef informieren.', 503);
    if (response.status === 429) fail('Das Routenlimit ist erreicht. Bitte später erneut versuchen.', 429);
    fail('Keine passende Route oder Adresse gefunden. Bitte Adresse und Standort prüfen.', 502);
  }
  try {return await response.json();} catch {fail('Ungültige Antwort des Routendienstes.',502);}
}
export async function searchStore(settings, query, send = fetch) {
  const key = routingKey(settings);
  if (!key) fail('Bitte zuerst einen openrouteservice API-Schlüssel in den Einstellungen speichern.',503);
  if (typeof query !== 'string' || query.trim().length < 5 || query.length > 400) fail('Bitte eine vollständige Adresse eingeben.');
  const url = new URL('https://api.heigit.org/pelias/v1/search');
  url.searchParams.set('api_key', key);
  url.searchParams.set('text',query.trim());
  url.searchParams.set('size','5');
  const response = await request(url,key,null,send);
  const results = (response.features || []).filter(f => Array.isArray(f.geometry?.coordinates)).map(f => {
    const [longitude,latitude] = f.geometry.coordinates;
    return validateStore({address:f.properties?.label || query,latitude,longitude});
  });
  if (!results.length) fail('Adresse nicht gefunden. Bitte Straße, Hausnummer, PLZ und Ort angeben.',404);
  return results;
}
export async function prepareReturnTrip(state, user, payload, send = fetch) {
  if (user.role !== 'driver') fail('Nur Fahrer können eine Rückfahrt starten.',403);
  const shift = state.shifts.find(s => s.employeeId === user.id && !s.end);
  if (!shift) fail('Bitte zuerst einstempeln.',409);
  const key = routingKey(state.settings);
  if (!key) fail('Der Chef muss zuerst den Routendienst in den Einstellungen einrichten.',503);
  const destination = validateStore(state.settings.store);
  const profile = Object.hasOwn(profiles,payload.transport) ? profiles[payload.transport] : null;
  if (!profile) fail('Rückfahrten werden mit dem Auto berechnet.');
  const latitude = coordinate(payload.latitude,-90,90), longitude = coordinate(payload.longitude,-180,180);
  const captured = Date.parse(payload.capturedAt);
  if (!Number.isFinite(captured) || Date.now()-captured > 30000 || captured-Date.now() > 5000)
    fail('Der GPS-Standort ist veraltet. Bitte erneut starten.');
  const response = await request(`https://api.heigit.org/openrouteservice/v2/directions/${profile}/geojson`,key,
    {coordinates:[[longitude,latitude],[destination.longitude,destination.latitude]],instructions:false},send);
  const feature = response.features?.[0], summary = feature?.properties?.summary;
  const coordinates = feature?.geometry?.coordinates;
  if (feature?.geometry?.type !== 'LineString' || !Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 30000
    || !Number.isFinite(summary?.duration) || summary.duration <= 0 || summary.duration > 86400
    || !Number.isFinite(summary?.distance) || summary.distance < 0)
    fail('Der Routendienst hat keine verwendbare Route geliefert.',502);
  const points = coordinates.map(([lng,lat]) => [coordinate(lat,-90,90),coordinate(lng,-180,180)]);
  const startedAt = new Date().toISOString();
  return {id:randomUUID(),shiftId:shift.id,destination,points,durationSeconds:summary.duration,distanceMeters:summary.distance,
    transport:payload.transport,startedAt,eta:new Date(Date.parse(startedAt)+summary.duration*1000).toISOString(),
    origin:{latitude,longitude,capturedAt:new Date(captured).toISOString()},provider:'openrouteservice'};
}
