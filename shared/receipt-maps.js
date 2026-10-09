// Only a Maps URL can supply a delivery address. Fiscal/TSE QR data is ignored.
export function mapsURL(value) {
  try {
    const url=new URL(value);
    if(url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443'))return null;
    const host=url.hostname.toLowerCase();
    const google=/^(?:www\.|maps\.)?google\.(?:com|de|at|ch|co\.uk)$/.test(host);
    if((google && (url.pathname.startsWith('/maps') || host.startsWith('maps.'))) ||
       (host==='maps.app.goo.gl' && /^\/[A-Za-z0-9_-]+$/.test(url.pathname)) ||
       (host==='goo.gl' && url.pathname.startsWith('/maps/')))return url;
  } catch {}
  return null;
}
export function addressFromMaps(value) {
  const url=mapsURL(value);
  if(!url)return null;
  let candidate=['destination','query','q','daddr'].map(key=>url.searchParams.get(key)).find(Boolean);
  if(!candidate) {
    const match=url.pathname.match(/\/maps\/(?:place|search)\/([^/]+)/);
    if(match)try {candidate=decodeURIComponent(match[1].replace(/\+/g,' '));} catch {}
  }
  if(!candidate || candidate.length>500)return null;
  candidate=candidate.replace(/\+/g,' ').replace(/\s+/g,' ').trim();
  // Coordinates/place IDs are navigation targets, not postal addresses.
  if(/^(?:loc:|place_id:)|^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/i.test(candidate))return null;
  const postal=candidate.match(/(?:^|[,\s])(\d{5})\s+([A-Za-zÀ-ž][A-Za-zÀ-ž .-]*?)(?=,|$)/);
  if(!postal)return null;
  const street=candidate.slice(0,postal.index).replace(/[,\s]+$/,'').trim();
  if(!/[A-Za-zÀ-ž].*\s\d+[a-z]?(?:\s*[-/]\s*\d+[a-z]?)?$/i.test(street))return null;
  return {address:street,postalCode:postal[1],city:postal[2].trim().replace(/m[uü]nchen/i,'München')};
}
