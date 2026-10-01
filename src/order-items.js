export function summarizeItems(orders) {
  const articles = new Map();
  for (const order of orders) {
    if (order.status !== "delivered") continue;
    for (const item of order.items || []) {
      const key = item.name.trim().toLocaleLowerCase("de-DE");
      const row = articles.get(key) || {name: item.name, quantity: 0, revenueCents: 0, prices: new Set()};
      const price = Math.round(item.unitPrice * 100);
      row.quantity += item.quantity;
      row.revenueCents += price * item.quantity;
      row.prices.add(price);
      articles.set(key, row);
    }
  }
  return [...articles.values()].map(row => ({name:row.name, quantity:row.quantity, revenue:row.revenueCents / 100, minPrice:Math.min(...row.prices) / 100, maxPrice:Math.max(...row.prices) / 100})).sort((a,b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
}
