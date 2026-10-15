// Keep only bounded, fixed diagnostic messages. Never retain request bodies,
// credentials, URLs, IPs, or arbitrary exception text.
const messages = new Map([
  ['Supply a WinOrder XML or JSON order', 'Keine Bestelldaten empfangen. XML oder JSON wird erwartet.'],
  ['Invalid WinOrder text encoding', 'Die Zeichenkodierung der Bestelldaten wird nicht unterstützt.'],
  ['Invalid or unsupported WinOrder XML', 'Die XML-Daten sind ungültig oder enthalten nicht unterstützte Deklarationen.'],
  ['Invalid WinOrder XML', 'Die XML-Daten konnten nicht gelesen werden.'],
  ['Invalid WinOrder JSON', 'Die Daten sind kein gültiges JSON. Erwartet wird eine XML- oder JSON-Bestellung.'],
  ['Expected WinOrder.OrderList', 'Die Bestellstruktur WinOrder → OrderList fehlt.'],
  ['WinOrder batch must contain 1–100 orders', 'Die Bestellliste muss 1 bis 100 Bestellungen enthalten.'],
  ['Invalid WinOrder order', 'Ein Eintrag in der Bestellliste ist ungültig.'],
  ['WinOrder OrderID is required', 'Die Bestellnummer OrderID fehlt.'],
  ['Invalid WinOrder order creation time', 'Das Bestelldatum ist ungültig oder liegt in der Zukunft.'],
  ['Duplicate OrderID in WinOrder batch', 'Die Bestellliste enthält eine doppelte Bestellnummer.'],
  ['Invalid WinOrder field', 'Ein Bestellfeld hat einen unerwarteten Datentyp.'],
  ['WinOrder field too long', 'Ein Bestellfeld überschreitet die erlaubte Länge.'],
  ['Too many WinOrder articles', 'Die Bestellung enthält mehr als 100 Artikel.'],
  ['Too many WinOrder toppings', 'Ein Artikel enthält mehr als 100 Zusätze.'],
  ['WinOrder article details too long', 'Die Artikelbeschreibung ist zu lang.'],
  ['This WinOrder order was already assigned or closed; review the change with the chef', 'Die geänderte Bestellung ist bereits zugeordnet oder abgeschlossen. Bitte mit dem Chef abgleichen.'],
  ['This order number was already entered manually today; the chef must resolve the duplicate', 'Diese Bestellnummer wurde heute bereits manuell erfasst. Bitte mit dem Chef abgleichen.'],
]);
const contentTypes = new Set(['text/xml', 'application/xml', 'application/json', 'text/json', 'application/octet-stream', 'application/x-www-form-urlencoded', 'multipart/form-data']);

export function createWinorderDiagnostics() {
  const attempts = [];
  return {
    begin(req, res, next) {
      const authorization = req.headers.authorization || '';
      const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const attempt = req.winorderAttempt = {
        receivedAt:new Date().toISOString(), authenticated:null,
        authentication:!authorization ? 'missing' : /^Basic /i.test(authorization) ? 'basic' : 'other',
        contentType:contentTypes.has(type) ? type : type ? 'other' : 'missing',
      };
      res.once('finish', () => {
        attempts.unshift({...attempt, status:res.statusCode,
          bytes:Buffer.isBuffer(req.body) ? req.body.length : null,
          message:attempt.message || (res.statusCode === 200 ? 'Anfrage erfolgreich verarbeitet.' : 'Anfrage konnte nicht verarbeitet werden.')});
        attempts.length = Math.min(attempts.length, 20);
      });
      next();
    },
    failure(req, error) {
      const attempt = req.winorderAttempt;
      if (!attempt) return;
      const status = error.status || 500;
      if (status === 401) attempt.authenticated = false;
      attempt.message = status === 401
        ? attempt.authentication === 'missing' ? 'Kein Authentifizierungsheader am Empfänger angekommen.'
          : attempt.authentication === 'other' ? 'Die gesendete Authentifizierungsart wird nicht unterstützt. HTTP Basic wird erwartet.'
            : 'HTTP-Basic-Anmeldung wurde nicht akzeptiert.'
        : status === 413 ? 'Die Bestelldaten überschreiten die erlaubte Größe von 1 MiB.'
        : status === 429 ? 'Zu viele Übertragungsversuche. Bitte später erneut senden.'
        : status === 503 ? 'Der Empfang ist derzeit nicht verfügbar.'
        : status >= 500 ? 'Interner Fehler beim Empfang oder Speichern der Bestellung.'
        : messages.get(error.message) || 'Die Anfrage konnte nicht verarbeitet werden.';
    },
    list:() => attempts.map(attempt => ({...attempt})),
  };
}
