export const defaultShiftTemplates = [
  {id:'midday',name:'Mittag',start:'11:00',end:'17:00'},
  {id:'evening',name:'Abend',start:'17:00',end:'00:00'},
  {id:'all-day',name:'Ganztags',start:'11:00',end:'00:00'},
];
export const absenceNames = {free:'Frei',vacation:'Urlaub',sick:'Krank'};
export function scheduleHours(entry) {
  if ((entry.kind || 'shift') !== 'shift' || !entry.start || !entry.end) return 0;
  const minutes = value => Number(value.slice(0,2))*60+Number(value.slice(3,5));
  let duration=minutes(entry.end)-minutes(entry.start);
  if (duration < 0) duration+=1440;
  return duration/60;
}
