const text = value => typeof value==='string' || typeof value==='number' ? String(value).trim() : '';
const list = value => !value ? [] : Array.isArray(value) ? value : [value];
export const usablePhone = value => /\d{3}/.test(text(value).replace(/[\s()+.-]/g,'')) ? text(value) : '';
export const winorderPlaceId = value => /^Places-ID:\s*([A-Za-z0-9_-]{10,255})$/i.exec(text(value))?.[1] || '';

// Portal metadata is forwarded as zero-price, unnamed article comments.
// Keep the source untouched; expose useful delivery fields separately.
export function winorderFields(details={}) {
  const address=details.Customer?.DeliveryAddress || {};
  const comments=list(details.ArticleList?.Article)
    .filter(a=>a && !text(a.ArticleName) && Number(a.Price)===0)
    .map(a=>text(a.Comment)).filter(Boolean);
  const uber=/^uber\s*eats(?:\s|\()/i.test(comments[0] || '') || /^uber\s*eats(?:\s|$)/i.test(text(details.AddInfo?.PaymentType));
  const city=text(address.City), zip=text(address.Zip);
  const postal=/^(\d{5})\s+([^,]+)(?:,\s*(?:Deutschland|Germany|DE))?$/i.exec(city);
  const phoneComment=uber ? comments.find(c=>/^Tel\.\s*[+\d]/i.test(c)) : '';
  const phoneMatch=phoneComment && /^Tel\.\s*([+\d][\d\s/-]*\d)(?:\s*\(([^)]+)\))?$/i.exec(phoneComment);
  const reference=uber ? comments.map(c=>/^Deine Bestellnummer:\s*(\S+)$/i.exec(c)?.[1]).find(Boolean) : '';
  const notes=uber ? comments.filter(c=>!/^uber\s*eats(?:\s|\()|^Deine Bestellnummer:|^Tel\./i.test(c)) : [];
  if(phoneMatch?.[2]) notes.push('Telefon-Zugangscode: '+phoneMatch[2]);
  return {
    postalCode:zip || postal?.[1] || '', city:postal && (!zip || zip===postal[1]) ? postal[2].trim() : city,
    customerPhone:usablePhone(address.PhoneNo) || usablePhone(address.Mobile) || phoneMatch?.[1]?.trim() || '',
    deliveryNotes:[...new Set([text(address.AddAddress),text(address.DescriptionOfWay),text(details.AddInfo?.Comment),...notes].filter(Boolean))].join('\n'),
    providerReference:text(details.ProviderReference) || reference || '',
    prepaid:/^uber\s*eats\s+onlinezahlung$/i.test(text(details.AddInfo?.PaymentType)),
    placeId:winorderPlaceId(address.Street),
  };
}
