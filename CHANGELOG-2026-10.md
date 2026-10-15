# Änderungen aus IMG_6216 / IMG_6217

Die zweite Notiz erläutert die Bereiche: Geld = Monatsübersicht, Statistik = Mitarbeiterkosten, Zeiten = Zeiterfassung, Team = Mitarbeiterliste, Gebiete = Liefergebiete, Analyse = Umsatz.

- Bestellungen: verfügbare WinOrder-Aufträge zuordnen und offene Lieferungen einem anderen Fahrer im Dienst zuteilen. Historische Liefergeld-Snapshots bleiben erhalten.
- Dienstplan: schnelle Vorlagen, eigene Vorlagen bearbeiten, Frei/Urlaub/Krank, Nacht-Schichten, Rollenfilter, Einträge bearbeiten/entfernen und Vorwoche übernehmen. Die vorhandenen, noch nicht eingebundenen Plan-Bausteine wurden integriert.
- Geld / Zeiten: Monatsauswahl mit vor/zurück, Arbeitszeit pro Tag als Balken, sichtbarer Bargeldabzug, Gehaltszahlungen und Restbetrag. Zeitanteile über Monatsgrenzen verwenden Berlin-Zeit. Spätere Bargeldabgaben korrigieren den Monat der ursprünglichen Bestellung.
- Monatsabrechnungen: CSV und echte PDF-Dateien für das gesamte Team oder einen Mitarbeiter. Mitarbeiter können nur die eigene Übersicht herunterladen, auch für frühere Monate.
- Kasse: separater Menüpunkt entfernt. Bargeldabgaben sind in Geld integriert.
- Team: Mitarbeiter bearbeiten, aus dem aktiven Team entfernen und wiederherstellen. Abgeschlossene Schichten und Abrechnungen behalten ihre Zuordnung. Eigener Zugang, letzter aktiver Chef und laufende Schichten sind geschützt.
- Kunden: Suche, Statusfilter und Sortierung nach Umsatz, Häufigkeit, letzter Bestellung, Bestellpause oder Adresse; Kennzahlen für gefilterte Adressen.
- Liefergebiete: löschen; bereits erfasste Liefergelder bleiben erhalten.
- Finanzen: datierte Ausgaben für Einkauf/Waren, Benzin, Provisionen, Fixkosten und Sonstiges; Rechnung als PDF/JPG/PNG bis 2 MB. Rechnungen sind nur für Chefs zugänglich. Ausgaben und Gehaltszahlungen werden in beiden Speicheradaptern persistiert.
- Heute / Analyse: gemeinsame Kostenberechnung und erfasste Ausgaben; tatsächliche Waren-/Fixkosteneinträge ersetzen die jeweilige Schätzung im gewählten Zeitraum. Fixkosten werden nach Kalendertagen bis heute anteilig geschätzt. Umsatzlinie mit Tag/Woche/Monat/Jahr, Werteauswahl und zugänglicher Tabelle.
- Statistik: Mitarbeiterkosten mit Tag/Woche/Monat/Jahr und Barumsatz; Fahrer und Küche bekommen eigene Periodenübersichten. Küche sieht im Schichtbereich den eigenen Tagesverdienst.
- Ausstempeln: optional ein früheres tatsächliches Ende eingeben. Ende muss nach Beginn und nach allen erfassten Bestellungen/Zustellungen liegen; Protokoll speichert auch den tatsächlichen Ausstempelzeitpunkt.
- Fahrer: größere Bedienelemente, Formulare und Touch-Flächen.
- Anmeldung: 4–12-stellige PIN für Mitarbeiter und Passkeys mit erforderlicher Geräteverifikation (Face ID, Touch ID oder Gerätesperre). Die Erstinitialisierung eines Stores behält eine 8–12-stellige Bootstrap-PIN. Passkey-Einrichtung erfordert die aktuelle PIN; Challenge, Origin, Signatur und Zähler werden serverseitig geprüft.
- Push: geräteweise an-/abschaltbare Web-Push-Abos, persistierte VAPID-Schlüssel, Benachrichtigungen für Bestellungen/Zuordnungen, Planänderungen, Zeitkorrekturen und erfasste Gehaltszahlungen. Keine Beträge, Adressen oder Kundendaten im Push-Inhalt. Abmelden löst das Geräteabo. Auf dem iPhone muss die App installiert und die Freigabe vom Benutzer erteilt werden.

## Prüfung

Erweiterte Tests umfassen Monatsgrenzen, centgenaue Bargeldzuordnung, Auszahlungslimits und doppelte Zahlungsanfragen, Berechtigungen, PDF-Dateien, Rechnungsspeicherung, Wiederladen, frühere Schichtenden, kryptografisch signierte WebAuthn-Registrierung/Anmeldung samt Replay-Abwehr und Push-Endpunktvalidierung. PDF-Seiten werden zusätzlich gerendert und visuell geprüft.

Ein physischer Face-ID-Dialog und die Push-Zustellung auf einem persönlichen iPhone benötigen das Gerät, die installierte HTTPS-App und die vom Benutzer erteilte Gerätefreigabe. Diese Gerätetests sind nicht durch die lokalen automatisierten Prüfungen ersetzt. Der optionale echte MySQL-Test benötigt eine konfigurierte Testdatenbank.
