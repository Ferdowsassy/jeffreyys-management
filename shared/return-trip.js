export const transportNames = {car:'Auto'};
export const driverColors = ["#2563eb","#dc2626","#16a34a","#9333ea","#ea580c","#0891b2","#db2777","#854d0e"];
export function driverColor(id) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return driverColors[hash % driverColors.length];
}
export function returnStatus(trip, now = Date.now()) {
  const remaining = Date.parse(trip.eta) - now;
  return remaining > 0 ? `Zurück in ca. ${Math.max(1,Math.ceil(remaining/60000))} Min.` : 'Ankunftszeit erreicht · Rückkehr noch nicht bestätigt';
}
export function routeDistances(points) {
  const lengths = [0];
  for (let i=1;i<points.length;i++) {
    const [lat,lng] = points[i], [prevLat,prevLng] = points[i-1];
    const radians = Math.PI/180;
    const a = Math.sin((lat-prevLat)*radians/2)**2 + Math.cos(lat*radians)*Math.cos(prevLat*radians)*Math.sin((lng-prevLng)*radians/2)**2;
    lengths.push(lengths[i-1]+6371000*2*Math.asin(Math.sqrt(Math.min(1,a))));
  }
  return lengths;
}
export function estimatedPosition(trip, lengths, now = Date.now()) {
  const fraction = Math.max(0,Math.min(1,(now-Date.parse(trip.startedAt))/(trip.durationSeconds*1000)));
  const distance = lengths[lengths.length-1]*fraction;
  let low=1, high=lengths.length-1;
  while(low<high) {const mid=(low+high)>>1;if(lengths[mid]<distance)low=mid+1;else high=mid;}
  const segment=lengths[low]-lengths[low-1];
  const t=segment ? (distance-lengths[low-1])/segment : 0;
  return trip.points[low-1].map((v,i)=>v+(trip.points[low][i]-v)*t);
}
