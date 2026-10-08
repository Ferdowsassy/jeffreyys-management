import {randomUUID} from 'node:crypto';
import {fail} from './domain.js';

export function routingKey(settings) {
  return process.env.GEOAPIFY_API_KEY || settings.geoapifyApiKey;
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
async function request(endpoint, key, parameters, send) {
  const url = new URL(`https://api.geoapify.com/v1/${endpoint}`);
  url.search = new URLSearchParams({...parameters,apiKey:key}).toString();
  let response;
  try {
    response = await send(url, {signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'}});
  } catch {fail('Geoapify ist nicht erreichbar. Bitte erneut versuchen.',502);}
  if (!response.ok) {
    if ([401,403].includes(response.status)) fail('Geoapify hat den API-Schlüssel abgelehnt. Schlüssel und Zugriffsbeschränkungen in den Einstellungen prüfen.',503);
    if (response.status === 429) fail('Das Geoapify Routenlimit ist erreicht. Bitte später erneut versuchen.',429);
    fail('Keine passende Route oder Adresse gefunden. Bitte Adresse und Standort prüfen.',502);
  }
  try {return await response.json();} catch {fail('Ungültige Antwort von Geoapify.',502);}
}
export async function searchStore(settings, query, send = fetch) {
  const key = routingKey(settings);
  if (!key) fail('Bitte zuerst einen Geoapify API-Schlüssel in den Einstellungen speichern.',503);
  if (typeof query !== 'string' || query.trim().length < 5 || query.length > 400) fail('Bitte eine vollständige Adresse eingeben.');
  const response = await request('geocode/search',key,{text:query.trim(),lang:'de',limit:'5',format:'json',bias:'countrycode:de'},send);
  if (!Array.isArray(response.results)) fail('Ungültige Antwort der Geoapify Adresssuche.',502);
  const results = response.results.slice(0,5).map(r => validateStore({address:r.formatted,latitude:r.lat,longitude:r.lon}));
  if (!results.length) fail('Adresse nicht gefunden. Bitte Straße, Hausnummer, PLZ und Ort angeben.',404);
  return results;
}
export async function prepareReturnTrip(state, user, payload, send = fetch) {
  if (user.role !== 'driver') fail('Nur Fahrer können eine Rückfahrt starten.',403);
  const shift = state.shifts.find(s => s.employeeId === user.id && !s.end);
  if (!shift) fail('Bitte zuerst einstempeln.',409);
  const key = routingKey(state.settings);
  if (!key) fail('Der Chef muss zuerst Geoapify in den Einstellungen einrichten.',503);
  const destination = validateStore(state.settings.store);
  if (payload.transport !== 'car') fail('Rückfahrten werden mit dem Auto berechnet.');
  const latitude = coordinate(payload.latitude,-90,90), longitude = coordinate(payload.longitude,-180,180);
  const captured = Date.parse(payload.capturedAt);
  if (!Number.isFinite(captured) || Date.now()-captured > 30000 || captured-Date.now() > 5000)
    fail('Der GPS-Standort ist veraltet. Bitte erneut starten.');
  const response = await request('routing',key,{
    waypoints:`${latitude},${longitude}|${destination.latitude},${destination.longitude}`,
    mode:'drive',units:'metric',lang:'de',format:'geojson',traffic:'free_flow',
  },send);
  const feature = response.features?.[0], properties = feature?.properties, geometry = feature?.geometry;
  let coordinates;
  if (geometry?.type === 'MultiLineString' && Array.isArray(geometry.coordinates) && geometry.coordinates.every(Array.isArray))
    coordinates = geometry.coordinates.flat();
  else if (geometry?.type === 'LineString') coordinates = geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 30000
    || !coordinates.every(point=>Array.isArray(point) && point.length>=2)
    || !Number.isFinite(properties?.time) || properties.time<=0 || properties.time>86400
    || !Number.isFinite(properties?.distance) || properties.distance<0)
    fail('Geoapify hat keine verwendbare Route geliefert.',502);
  const points = coordinates.map(([lng,lat])=>[coordinate(lat,-90,90),coordinate(lng,-180,180)]);
  const startedAt = new Date().toISOString();
  return {id:randomUUID(),shiftId:shift.id,destination,points,durationSeconds:properties.time,distanceMeters:properties.distance,
    transport:payload.transport,startedAt,eta:new Date(Date.parse(startedAt)+properties.time*1000).toISOString(),
    origin:{latitude,longitude,capturedAt:new Date(captured).toISOString()},provider:'geoapify'};
}
