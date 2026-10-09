import {mapsURL, addressFromMaps} from '../shared/receipt-maps.js';

export async function resolveReceiptMaps(value, request=fetch, key='') {
  let url=mapsURL(value);
  if(!url || value.length>2000)throw Object.assign(Error('Nur Google-Maps-Links sind erlaubt.'),{status:400});
  const signal=AbortSignal.timeout(8000);
  for(let step=0;step<4;step++) {
    const address=addressFromMaps(url.href);
    if(address)return address;
    const placeId=url.searchParams.get('query_place_id') || url.searchParams.get('q')?.match(/^place_id:([A-Za-z0-9_-]+)$/)?.[1];
    if(placeId && /^[A-Za-z0-9_-]{10,255}$/.test(placeId)) {
      if(!key)throw Object.assign(Error('Dieser QR-Code enthält eine Google-Orts-ID. Der Chef muss unter Einstellungen Google Places einrichten; alternativ die Adresse aus Google Maps übernehmen.'),{status:422});
      const details=await request('https://places.googleapis.com/v1/places/'+encodeURIComponent(placeId)+'?languageCode=de', {
        signal,redirect:'error',headers:{'X-Goog-Api-Key':key,'X-Goog-FieldMask':'formattedAddress'},
      });
      if(!details.ok){await details.body?.cancel();throw Object.assign(Error('Google Places konnte die Adresse nicht lesen. Bitte Schlüssel und Freigabe für Places API (New) prüfen.'),{status:502});}
      const result=await details.json();
      return typeof result.formattedAddress==='string' ? addressFromMaps('https://www.google.com/maps?q='+encodeURIComponent(result.formattedAddress)) : null;
    }
    const response=await request(url.href,{redirect:'manual',signal,headers:{Accept:'text/html'}});
    const location=response.headers.get('location');
    await response.body?.cancel();
    if(response.status<300 || response.status>=400 || !location)return null;
    // Every hop is validated before making a request; never follow to arbitrary hosts.
    url=mapsURL(new URL(location,url).href);
    if(!url)throw Object.assign(Error('Maps-Link verweist auf eine nicht erlaubte Adresse.'),{status:400});
  }
  return null;
}
