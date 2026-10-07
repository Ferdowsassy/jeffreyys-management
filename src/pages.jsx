import React, { useState, useEffect } from "react";
import {
  Plus,
  ArrowUpRight,
  Download,
  Camera,
  MapPin,
  Check,
  Clock,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { api, Title, Panel, Form, Empty, Badge, roleName } from "./main";
import {payroll as calculatePayroll} from "../shared/payroll";
import { euro, day, sum, hours, payroll } from "./finance";
import {StoreSettings, ReturnTripControls} from "./return-trip";
import {ShiftCorrections, ShiftApprovals} from "./shift-corrections";
import { scanReceipt } from "./receipt-ocr";
import { summarizeItems } from "./order-items";
const today = () => day(Date.now());
const person = (data, id) =>
  data.employees.find((e) => e.id === id)?.name || "Unbekannt";
const time = (d) =>
  d
    ? new Date(d).toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Berlin",
      })
    : "Offen";
const moneyField = (name, label, value = 0) => ({
  name,
  label,
  type: "number",
  min: 0,
  step: 0.01,
  value,
});
function download(name, text, type = "text/plain") {
  const u = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function Table({ headers, rows }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <Empty />}
    </div>
  );
}
function ItemsEditor({ items, onChange }) {
  const update = (index, key, value) => onChange(items.map((item,i) => i === index ? {...item,[key]:value} : item));
  return <fieldset className="order-items"><legend>Artikel · optional</legend>
    <p className="muted">Stückpreis nach Rabatt. Artikelbeträge können wegen Lieferkosten vom Gesamtbetrag abweichen.</p>
    {items.map((item,index) => <div className="item-row" key={index}>
      <label>Artikel <input aria-label={`Artikel ${index + 1}`} value={item.name} required maxLength={120} onChange={e => update(index,"name",e.target.value)} /></label>
      <label>Menge <input aria-label={`Menge ${index + 1}`} type="number" min="1" max="1000" step="1" required value={item.quantity} onChange={e => update(index,"quantity",e.target.value)} /></label>
      <label>Stückpreis (€) <input aria-label={`Stückpreis ${index + 1}`} type="number" min="0" max="100000" step="0.01" required value={item.unitPrice} onChange={e => update(index,"unitPrice",e.target.value)} /></label>
      <button type="button" className="text-button" aria-label={`Artikel ${index + 1} entfernen`} onClick={() => onChange(items.filter((_,i) => i !== index))}>Entfernen</button>
    </div>)}
    <button type="button" className="secondary" disabled={items.length >= 100} onClick={() => onChange([...items,{name:"",quantity:1,unitPrice:""}])}>+ Artikel</button>
  </fieldset>;
}
const numericItems = items => items.map(item => ({...item,quantity:Number(item.quantity),unitPrice:Number(item.unitPrice)}));
export function Schedule({ user, data, act }) {
  const [offset, setOffset] = useState(0),
    [show, setShow] = useState(false),
    [editing, setEditing] = useState(null),
    [role, setRole] = useState("all");
  let monday = new Date(today() + "T12:00:00Z");
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) + offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() + i);
    return day(d);
  });
  const scheduled = data.schedule.filter(s => days.includes(s.date) && (role === "all" || data.employees.find(e => e.id === s.employeeId)?.role === role)).sort((a,b) => a.start.localeCompare(b.start));
  const cost = sum(scheduled, (s) => {
    const e = data.employees.find((e) => e.id === s.employeeId);
    let diff =
      (new Date(`${s.date}T${s.end}`) - new Date(`${s.date}T${s.start}`)) /
      3600000;
    if (diff < 0) diff += 24;
    return diff * (e?.hourlyRate || 0);
  });
  return (
    <>
      <Title
        title="Ein Team. Ein Plan."
        subtitle="Der Wochenplan für einen reibungslosen Betrieb."
      >
        {user.role === "chef" && (
          <button className="primary" onClick={() => {setEditing(null);setShow(!show);}}>
            <Plus size={18} />
            Schicht eintragen
          </button>
        )}
      </Title>
      <div className="toolbar">
        <div className="row">
          <button
            className="secondary"
            aria-label="Vorherige Woche"
            onClick={() => setOffset(offset - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <strong>
            {days[0]} — {days[6]}
          </strong>
          <button
            className="secondary"
            aria-label="Nächste Woche"
            onClick={() => setOffset(offset + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <button className="secondary" onClick={() => setOffset(0)}>Diese Woche</button>
        {user.role !== "driver" && <label>Rolle <select aria-label="Planrolle" value={role} onChange={e => setRole(e.target.value)}><option value="all">Alle Rollen</option>{Object.entries(roleName).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>}
        {user.role === "chef" && (
          <button
            className="secondary"
            onClick={() =>
              act("copyWeek", { weekStart: days[0] }).catch(() => {})
            }
          >
            Vorwoche übernehmen
          </button>
        )}
      </div>
      {show && (
        <Panel title={editing?.id ? "Geplante Schicht bearbeiten" : "Schicht hinzufügen"} action={<button className="text-button" onClick={() => {setShow(false);setEditing(null);}}>Abbrechen</button>}>
          <Form
            key={editing ? `${editing.employeeId}-${editing.date}` : "new"}
            initial={editing || {}}
            fields={[
              {
                name: "employeeId",
                label: "Mitarbeiter",
                options: data.employees
                  .filter((e) => e.active !== false)
                  .map((e) => ({ value: e.id, label: e.name })),
              },
              { name: "date", label: "Datum", type: "date", value: days[0] },
              { name: "start", label: "Beginn", type: "time", value: "17:00" },
              { name: "end", label: "Ende", type: "time", value: "22:00" },
            ]}
            onSubmit={async (v) => {
              await act("saveSchedule", {...v, ...(editing?.id ? {id:editing.id} : {})});
              setShow(false);
              setEditing(null);
            }}
          >{editing?.id && <button type="button" className="text-button" onClick={async () => {try {await act("deleteSchedule", {id:editing.id});setShow(false);setEditing(null);} catch {}}}>Schicht entfernen</button>}</Form>
        </Panel>
      )}
      <Panel
        title="Wochenübersicht"
        subtitle={
          user.role === "chef"
            ? `Geplante Lohnkosten: ${euro(cost)} · Schätzung zum aktuellen Lohn`
            : user.role === "kitchen" ? "Der gemeinsame Teamplan" : "Deine geplanten Schichten"
        }
      >
        <div className="week-grid">
          {days.map((d) => (
            <div
              className={"week-day " + (d === today() ? "is-today" : "")}
              key={d}
            >
              <header>
                {new Date(d + "T12:00").toLocaleDateString("de-DE", {
                  weekday: "short",
                })}
                <strong>{d.slice(8)}</strong>
              </header>
              {scheduled
                .filter((s) => s.date === d)
                .map((s) => (
                  <div className="schedule-shift" key={s.id}>
                    <strong>{person(data, s.employeeId)}</strong>
                    <span>
                      {s.start}–{s.end}{s.end < s.start ? " (+1 Tag)" : ""}
                    </span>
                    <span>{roleName[data.employees.find(e => e.id === s.employeeId)?.role]}</span>
                    {user.role === "chef" && <button className="text-button" onClick={() => {setEditing(s);setShow(true);}}>Bearbeiten</button>}
                  </div>
                ))}
              {!scheduled.some((s) => s.date === d) && (
                <span className="muted">Keine Schicht</span>
              )}
              {user.role === "chef" && <button className="text-button" onClick={() => {setEditing({date:d,start:"17:00",end:"22:00"});setShow(true);}}>+ Schicht</button>}
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
function Payroll({ data, personal = false }) {
  const [month, setMonth] = useState(today().slice(0, 7)),
    [detail, setDetail] = useState(null);
  const rows = data.employees.map((e) => ({ e, ...payroll(e, data, month) }));
  return (
    <>
      <div className="toolbar">
        <label>
          Abrechnungsmonat{" "}
          <input
            aria-label="Abrechnungsmonat"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        <button
          className="secondary"
          onClick={() => {
            const safe = (s) =>
              '"' +
              String(s)
                .replace(/^[=+@-]/, "'")
                .replaceAll('"', '""') +
              '"';
            download(
              `abrechnung-${month}.csv`,
              "\ufeff" +
                [
                  [
                    "Name",
                    "Rolle",
                    "Telefon",
                    "Stunden",
                    "Lohn",
                    "Liefergeld",
                    "Verdienst",
                    "Bar kassiert",
                    "Zurückgegeben",
                    "Einbehalten",
                    "Auszahlung",
                  ],
                  ...rows.map((r) => [
                    r.e.name,
                    roleName[r.e.role],
                    r.e.phone || "",
                    r.hours.toFixed(2),
                    r.wages,
                    r.fees,
                    r.wages + r.fees,
                    r.cash,
                    r.returned,
                    r.retained,
                    r.payout,
                  ]),
                ]
                  .map((r) => r.map(safe).join(";"))
                  .join("\n"),
              "text/csv",
            );
          }}
        >
          <Download size={16} />
          CSV exportieren
        </button>
      </div>
      <Panel
        title={personal ? "Dein Monatsverdienst" : "Monatsabrechnung"}
        subtitle="Lohn + Liefergeld − einbehaltenes Bargeld. Bereits abgegebenes Bargeld wird nicht doppelt abgezogen."
      >
        {personal ? <div className="personal-earnings">
          {rows.map(r => <React.Fragment key={r.e.id}>
            <p className="earnings-owner">{r.e.name} · {roleName[r.e.role]}</p>
            <div><span>Verdienst vor Bargeldabzug</span><strong>{euro(r.wages + r.fees)}</strong></div>
            <div><span>Arbeitsstunden</span><strong>{r.hours.toFixed(2)}</strong></div>
            <div><span>Stundenlohn gesamt</span><strong>{euro(r.wages)}</strong></div>
            <div><span>Auszahlung</span><strong>{euro(r.payout)}</strong></div>
            {r.fees !== 0 && <div><span>Liefergeld</span><strong>{euro(r.fees)}</strong></div>}
            {r.retained !== 0 && <div><span>Einbehaltenes Bargeld</span><strong>{euro(r.retained)}</strong></div>}
          </React.Fragment>)}
        </div> : <Table
          headers={[
            "Mitarbeiter",
            "Rolle",
            "Telefon",
            "Stunden",
            "Lohn",
            "Liefergeld",
            "Verdienst",
            "Einbehalten",
            "Auszahlung",
          ]}
          rows={rows.map((r) => [
            <button
              className="text-button"
              onClick={() => setDetail(detail === r.e.id ? null : r.e.id)}
            >
              {r.e.name}
            </button>,
            roleName[r.e.role],
            r.e.phone || "—",
            r.hours.toFixed(2),
            euro(r.wages),
            euro(r.fees),
            euro(r.wages + r.fees),
            euro(r.retained),
            <strong>{euro(r.payout)}</strong>,
          ])}
        />}
      </Panel>
      {detail && (
        <Panel title={"Barbestellungen · " + person(data, detail)}>
          <OrderTable
            data={data}
            orders={data.orders.filter(
              (o) =>
                o.employeeId === detail &&
                o.payment === "cash" &&
                day(o.createdAt).startsWith(month),
            )}
          />
        </Panel>
      )}
      <div className="notice">
        Offene Schichten sind vorläufig. Monatsübergreifende Schichten und
        Übergaben müssen vor einer echten Abrechnung geprüft werden.
      </div>
    </>
  );
}
function OrderTable({ orders, data }) {
  return (
    <Table
      headers={[
        "Bestellung",
        "Adresse",
        "Fahrer",
        "Betrag",
        "Zahlung",
        "Status",
      ]}
      rows={orders.map((o) => [
        o.orderNumber || "—",
        o.noAddress ? "Ohne Adresse · Pauschale" : o.address,
        person(data, o.employeeId),
        euro(o.amount),
        o.payment === "cash" ? "Bar" : "Online",
        <Badge tone={o.status === "delivered" ? "green" : "orange"}>
          {o.status === "delivered" ? o.completionSource === "clockOut" ? "Zugestellt · beim Ausstempeln" : "Zugestellt" : "Offen"}
        </Badge>,
      ])}
    />
  );
}
export function Management({ user, data, page, act, notify }) {
  const [editing, setEditing] = useState(null),
    [show, setShow] = useState(false),
    [teamRole, setTeamRole] = useState("all"),
    [timeView, setTimeView] = useState("day"),
    [date, setDate] = useState(today());
  useEffect(() => {
    setEditing(null);
    setShow(false);
  }, [page]);
  const titles = {
    Geld: [
      "Fair gerechnet. Klar geregelt.",
      "Die Monatsabrechnung für dein Team.",
    ],
    Team: [
      "Die Menschen hinter den Burgern.",
      "Rollen, Zugänge und datierte Stundenlöhne.",
    ],
    Gebiete: [
      "Von hier bis zur Haustür.",
      "Liefergebiete und Vergütung je Postleitzahl.",
    ],
    Kasse: [
      "Jeder Euro nachvollziehbar.",
      "Bargeld-Übergaben prüfen und bestätigen.",
    ],
    Kunden: [
      "Aus Gästen werden Stammgäste.",
      "Zusammengefasst nach Lieferadresse, nicht nach identifizierter Person.",
    ],
    Zeiten: [
      "Zeit für Transparenz.",
      "Erfasste Schichten prüfen und nachvollziehbar korrigieren.",
    ],
    Einstellungen: ["Dein Laden.", "Ladenadresse und Routen für Rückfahrten."],
    Finanzen: [
      "Die Zahlen hinter dem Betrieb.",
      "Kosten als Grundlage für deine Gewinnschätzung.",
    ],
    Daten: [
      "Deine Daten. Deine Kontrolle.",
      "Sichern, Demo-Daten entfernen oder neu beginnen.",
    ],
  };
  let body;
  const openNew = () => {
    setEditing(null);
    setShow(!show);
  };
  if (page === "Geld") body = <Payroll data={data} />;
  if (page === "Team")
    body = (
      <>
        <div className="toolbar">
          <label>Rolle <select aria-label="Teamrolle" value={teamRole} onChange={e => setTeamRole(e.target.value)}>
            <option value="all">Alle Mitarbeiter ({data.employees.length})</option>
            {Object.entries(roleName).map(([role, label]) => <option key={role} value={role}>{label} ({data.employees.filter(e => e.role === role).length})</option>)}
          </select></label>
          <button className="primary" onClick={openNew}>
            <Plus size={17} />
            Mitarbeiter anlegen
          </button>
        </div>
        {show && (
          <Panel
            title={editing ? "Mitarbeiter bearbeiten" : "Neuer Mitarbeiter"}
          >
            <Form
              key={editing?.id || "new"}
              initial={editing || {}}
              fields={[
                { name: "name", label: "Name" },
                { name: "phone", label: "Telefon", type: "tel", required: false, maxLength: 40 },
                {
                  name: "role",
                  label: "Rolle",
                  options: [
                    { value: "chef", label: "Chef" },
                    { value: "kitchen", label: "Küche" },
                    { value: "driver", label: "Fahrer" },
                  ],
                },
                {
                  name: "pin",
                  label: editing
                    ? `Neue PIN (optional, ${user?.demo ? "4–12" : "8–12"} Ziffern)`
                    : `${user?.demo ? "4–12" : "8–12"}-stellige PIN`,
                  type: "password",
                  inputMode: "numeric",
                  pattern: user?.demo ? "[0-9]{4,12}" : "[0-9]{8,12}",
                  minLength: user?.demo ? 4 : 8,
                  maxLength: 12,
                  required: !editing,
                },
                moneyField("hourlyRate", "Stundenlohn (€)", 14),
                {
                  name: "effectiveDate",
                  label: "Gültig ab",
                  type: "date",
                  value: today(),
                },
              ]}
              onSubmit={async (v) => {
                await act("saveEmployee", {
                  ...v,
                  id: editing?.id,
                  hourlyRate: Number(v.hourlyRate),
                });
                setShow(false);
              }}
            />
          </Panel>
        )}
        <Panel title="Teamübersicht">
          <Table
            headers={["Name", "Rolle", "Telefon", "Stundenlohn", "Status", "Aktion"]}
            rows={data.employees.filter(e => teamRole === "all" || e.role === teamRole).map((e) => [
              <strong>{e.name}</strong>,
              roleName[e.role],
              e.phone || "—",
              euro(e.hourlyRate),
              <Badge tone={e.active !== false ? "green" : ""}>
                {e.active !== false ? "Aktiv" : "Pausiert"}
              </Badge>,
              <div className="row">
                <button
                  className="text-button"
                  onClick={() => {
                    setEditing(e);
                    setShow(true);
                  }}
                >
                  Bearbeiten
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    if (confirm(e.name + " deaktivieren?"))
                      act("deactivateEmployee", { id: e.id }).catch(() => {});
                  }}
                >
                  Deaktivieren
                </button>
              </div>,
            ])}
          />
        </Panel>
      </>
    );
  if (page === "Gebiete")
    body = (
      <>
        <div className="toolbar">
          <span>Datierte Lieferpauschalen</span>
          <button className="primary" onClick={openNew}>
            <Plus size={17} />
            Gebiet hinzufügen
          </button>
        </div>
        {show && (
          <Panel title="Liefergebiet">
            <Form
              key={editing?.id || "new"}
              initial={editing || {}}
              fields={[
                {
                  name: "postalCode",
                  label: "Postleitzahl",
                  pattern: "[0-9]{5}",
                },
                { name: "name", label: "Ortsteil" },
                moneyField("fee", "Liefergeld (€)", 1.5),
                {
                  name: "effectiveDate",
                  label: "Gültig ab",
                  type: "date",
                  value: today(),
                },
              ]}
              onSubmit={async (v) => {
                await act("saveZone", {
                  ...v,
                  id: editing?.id,
                  fee: Number(v.fee),
                });
                setShow(false);
              }}
            />
          </Panel>
        )}
        <Panel title="Liefergebiete">
          <Table
            headers={["PLZ", "Ortsteil", "Liefergeld", ""]}
            rows={data.zones.map((z) => [
              <strong>{z.postalCode}</strong>,
              z.name,
              euro(z.fee),
              <button
                className="text-button"
                onClick={() => {
                  setEditing(z);
                  setShow(true);
                }}
              >
                Bearbeiten
              </button>,
            ])}
          />
        </Panel>
        <Panel
          title="Ohne Kundenadresse"
          subtitle="Belege ohne Adresse nutzen diese Pauschale, nicht den PLZ-Tarif."
        >
          <Form
            fields={[
              moneyField(
                "flatFee",
                "Pauschale (€)",
                data.settings.flatFee || 0,
              ),
            ]}
            onSubmit={(v) =>
              act("saveSettings", { flatFee: Number(v.flatFee) })
            }
          />
        </Panel>
      </>
    );
  if (page === "Einstellungen") body = <StoreSettings data={data} act={act} notify={notify} />;
  if (page === "Finanzen")
    body = (
      <Panel
        title="Kalkulationsgrundlagen"
        subtitle="Fixkosten als monatliche Gesamtsumme; Tagesanteil nach Kalendertagen."
      >
        <Form
          initial={data.settings}
          fields={[
            moneyField("fixedCosts", "Monatliche Fixkosten (€)"),
            {
              ...moneyField("foodCostPercent", "Wareneinsatz (%)", 30),
              max: 100,
            },
            moneyField("longShiftHours", "Warnung nach Schichtstunden", 10),
          ]}
          onSubmit={(v) =>
            act(
              "saveSettings",
              Object.fromEntries(
                Object.entries(v).map(([k, v]) => [k, Number(v)]),
              ),
            )
          }
        />
      </Panel>
    );
  if (page === "Kasse")
    body = (
      <Panel title="Bargeld-Übergaben">
        <div className="handoffs">
          {data.handoffs.map((h) => (
            <div className="handoff" key={h.id}>
              <div>
                <strong>{person(data, h.employeeId)}</strong>
                <small>{new Date(h.createdAt).toLocaleString("de-DE")}</small>
                <p>
                  Erwartet <b>{euro(h.expected)}</b>
                </p>
                <Badge tone={h.driverConfirmed ? "green" : "orange"}>
                  {h.cashRetained && !h.chefConfirmed ? "Beim Fahrer · vom Lohn abgezogen" : h.driverConfirmed
                    ? "Fahrer bestätigt"
                    : "Fahrerbestätigung offen"}
                </Badge>
              </div>
              {h.chefConfirmed ? (
                <div>
                  <Badge
                    tone={
                      Number(h.counted) === Number(h.expected)
                        ? "green"
                        : "orange"
                    }
                  >
                    Gezählt: {euro(h.counted)}
                  </Badge>
                  <p>Differenz: {euro(h.counted - h.expected)}</p>
                </div>
              ) : (
                <Form
                  fields={[
                    moneyField(
                      "counted",
                      "Tatsächlich gezählt (€)",
                      h.expected,
                    ),
                  ]}
                  submit={h.cashRetained ? "Nachträgliche Bargeldabgabe bestätigen" : "Übergabe bestätigen"}
                  onSubmit={(v) =>
                    act("confirmHandoff", {
                      id: h.id,
                      counted: Number(v.counted),
                    })
                  }
                />
              )}
            </div>
          ))}
          {!data.handoffs.length && <Empty>Keine Übergaben offen.</Empty>}
        </div>
      </Panel>
    );
  if (page === "Kunden") {
    const grouped = {};
    for (const o of data.orders.filter((o) => !o.noAddress && o.address)) {
      const key = (o.address + " " + o.postalCode).toLowerCase().trim();
      (grouped[key] ??= []).push(o);
    }
    body = (
      <Panel
        title="Deine Lieferadressen"
        subtitle="Eine Adresse kann mehrere Haushalte enthalten. Keine automatische Kontaktaufnahme."
      >
        <Table
          headers={[
            "Adresse",
            "Bestellungen",
            "Umsatz",
            "Ø Wert",
            "Zuletzt",
            "Status",
            "",
          ]}
          rows={Object.values(grouped).map((os) => {
            os.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            const last = os.at(-1),
              days = Math.floor(
                (Date.now() - new Date(last.createdAt)) / 86400000,
              ),
              interval =
                os.length > 1
                  ? (new Date(last.createdAt) - new Date(os[0].createdAt)) /
                    86400000 /
                    (os.length - 1)
                  : null,
              risk = interval !== null && days > Math.max(7, interval * 1.5),
              status = risk
                ? "Gefährdet"
                : os.length === 1
                  ? "Neu"
                  : os.length >= 5
                    ? "Stammkunde"
                    : "Aktiv";
            return [
              last.address + ", " + last.postalCode,
              os.length,
              euro(sum(os, (o) => o.amount)),
              euro(sum(os, (o) => o.amount) / os.length),
              days + " Tage",
              <Badge tone={risk ? "orange" : "green"}>{status}</Badge>,
              risk ? (
                <button
                  className="text-button"
                  onClick={() =>
                    act("addTask", {
                      text:
                        "Kundenreaktivierung prüfen: " +
                        last.address +
                        " " +
                        last.postalCode,
                      visibility: "chef",
                    }).catch(() => {})
                  }
                >
                  Aufgabe anlegen
                </button>
              ) : (
                "—"
              ),
            ];
          })}
        />
        <div className="panel-foot">
          Belege ohne Adresse können keinem Haushalt zugeordnet werden.
        </div>
      </Panel>
    );
  }
  if (page === "Zeiten") {
    const shifts = data.shifts.filter((s) => day(s.start) === date);
    body = (
      <>
        <div className="toolbar">
          <div className="segmented">
            <button className={timeView === "day" ? "selected" : ""} onClick={() => setTimeView("day")}>Schichten</button>
            <button className={timeView === "month" ? "selected" : ""} onClick={() => setTimeView("month")}>Mitarbeiter · Monat</button>
          </div>
          {timeView === "day" &&
          <input
            aria-label="Schichtdatum"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />}
        </div>
        <ShiftApprovals data={data} act={act} />
        {timeView === "month" ? <Payroll data={data} /> : <>
        <Panel title="Erfasste Arbeitszeit">
          <Table
            headers={[
              "Mitarbeiter",
              "Beginn",
              "Ende",
              "Stunden",
              "Verdienst",
              "Hinweis",
              "",
            ]}
            rows={shifts.map((s) => [
              person(data, s.employeeId),
              time(s.start),
              time(s.end),
              hours(s).toFixed(2),
              euro(Math.round(hours(s) * Math.round(s.hourlyRate * 100)) / 100 + sum(data.orders.filter(o => o.shiftId === s.id && o.status === "delivered"), o => o.deliveryFee)),
              <Badge
                tone={
                  !s.end &&
                  hours(s) > Number(data.settings.longShiftHours || 10)
                    ? "orange"
                    : ""
                }
              >
                {!s.end && hours(s) > Number(data.settings.longShiftHours || 10)
                  ? "Lange offene Schicht"
                  : data.schedule.some(
                        (p) => p.employeeId === s.employeeId && p.date === date,
                      )
                    ? "Eingeteilt"
                    : "Nicht eingeteilt"}
              </Badge>,
              <button className="text-button" onClick={() => setEditing(s)}>
                Korrigieren
              </button>,
            ])}
          />
        </Panel>
        <div className="notice">Verdienst = Stundenlohn + Liefergeld zugestellter Bestellungen, vor Bargeldabzug. Offene Schichten sind vorläufig.</div>
        {editing && (
          <Panel title="Zeitkorrektur · wird protokolliert">
            <Form
              key={editing.id}
              fields={[
                {
                  name: "start",
                  label: "Beginn (Ortszeit dieses Geräts)",
                  type: "datetime-local",
                  value: localTime(editing.start),
                },
                {
                  name: "end",
                  label: "Ende (optional)",
                  type: "datetime-local",
                  value: editing.end ? localTime(editing.end) : "",
                  required: false,
                },
              ]}
              onSubmit={async (v) => {
                await act("updateShift", {
                  id: editing.id,
                  start: new Date(v.start).toISOString(),
                  end: v.end ? new Date(v.end).toISOString() : null,
                });
                setEditing(null);
              }}
            />
          </Panel>
        )}
        <Panel title="Änderungsprotokoll">
          <Table
            headers={["Zeit", "Aktion", "Details"]}
            rows={(data.audit || [])
              .slice(-15)
              .reverse()
              .map((a) => [
                new Date(a.at || a.createdAt).toLocaleString("de-DE"),
                a.type || a.action,
                JSON.stringify(a.details || a.changes || {}),
              ])}
          />
        </Panel>
        </>}
      </>
    );
  }
  if (page === "Daten")
    body = (
      <div className="settings-stack">
        <Panel
          title="Datenauszug herunterladen"
          subtitle="Sanitierter JSON-Auszug ohne PIN-Hashes. Enthält personenbezogene Daten, ist aber keine wiederherstellbare Systemsicherung."
        >
          <button
            className="secondary"
            onClick={async () => {
              try {
                download(
                  "jeffreyys-export-" + today() + ".json",
                  JSON.stringify(await api("export"), null, 2),
                  "application/json",
                );
              } catch (e) {
                notify(e.message);
              }
            }}
          >
            <Download size={18} />
            JSON herunterladen
          </button>
        </Panel>
        <Panel
          title="Demo-Daten entfernen"
          subtitle="Markierte Beispieldaten entfernen. Für eine echte Wiederherstellung vorher die Server-Datendatei sichern."
        >
          <button
            className="secondary"
            onClick={() => {
              if (confirm("Markierte Demo-Daten wirklich entfernen?"))
                act("clearDemo").catch(() => {});
            }}
          >
            Demo-Daten entfernen
          </button>
        </Panel>
        <Panel
          title="Alles zurücksetzen"
          subtitle="Unwiderruflich. Für eine Wiederherstellung muss vorher die Server-Datendatei gesichert werden."
        >
          <button
            className="danger"
            onClick={() => {
              if (prompt("Zum Bestätigen RESET eingeben:") === "RESET")
                act("reset", { confirmation: "RESET" })
                  .then(() => location.reload())
                  .catch(() => {});
            }}
          >
            Alles zurücksetzen
          </button>
        </Panel>
        <div className="notice">
          Der JSON-Download ist ein lesbarer, sanitierter Auszug und kein Restore-Backup.
          Produktive Backups und Wiederherstellung werden auf dem Server gemäß
          DEPLOYMENT.md durchgeführt.
        </div>
      </div>
    );
  return (
    <>
      <Title title={titles[page]?.[0] || page} subtitle={titles[page]?.[1]} />
      {body}
    </>
  );
}
function localTime(d) {
  const date = new Date(d);
  return new Date(date - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function Driver({ user, data, page, act, notify }) {
  const [form, setForm] = useState(false),
    [receipt, setReceipt] = useState({}),
    [items, setItems] = useState([]),
    [scan, setScan] = useState(null),
    [scanBusy, setScanBusy] = useState(false),
    [scanStatus, setScanStatus] = useState(''),
    [scanPhoto, setScanPhoto] = useState(''),
    [tick, setTick] = useState(0);
  useEffect(()=>()=>{if(scanPhoto)URL.revokeObjectURL(scanPhoto);},[scanPhoto]);
  const personalPay = calculatePayroll({...data, employees:data.employees.filter(e => e.id === user.id)})[0];
  const active = data.shifts.find((s) => s.employeeId === user.id && !s.end);
  useEffect(() => {
    const t = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const orders = data.orders.filter((o) => o.employeeId === user.id),
    open = orders.filter((o) => o.status === "open"),
    todays = orders.filter((o) => day(o.createdAt) === today());
  const fields = [
    { name: "orderNumber", label: "Bestellnummer", required: false },
    { name: "address", label: "Straße & Hausnummer", required: false },
    {
      name: "postalCode",
      label: "PLZ (5 Ziffern)",
      required: false,
      pattern: "[0-9]{5}",
    },
    { name: "city", label: "Ort", value: "München", required: false },
    moneyField("amount", "Betrag (€)"),
    {
      name: "payment",
      label: "Zahlungsart",
      options: [
        { value: "", label: "Bitte wählen" },
        { value: "online", label: "Online bezahlt" },
        { value: "cash", label: "Bar" },
      ],
    },
    {
      name: "noAddress",
      label: "Adressart",
      options: [
        { value: "false", label: "Mit Kundenadresse" },
        { value: "true", label: "Ohne Adresse / Uber-Pauschale" },
      ],
    },
  ];
  async function photo(file) {
    if (!file || scanBusy) return;
    if (file.size > 8 * 1024 * 1024) {
      notify("Bitte ein Foto kleiner als 8 MB wählen.");
      return;
    }
    setScanBusy(true);
    setScanStatus('Foto vorbereiten …');
    try {
      const r = await scanReceipt(file, setScanStatus);
      setReceipt(r.draft || {});
      setItems([]);
      setScan(r);
      setScanPhoto(URL.createObjectURL(file));
      setForm(true);
      notify("Beleg auf deinem Gerät gelesen. Bitte jedes Feld mit dem Foto vergleichen.");
    } catch (e) {
      notify(e.message || 'Texterkennung fehlgeschlagen. Bitte Beleg manuell erfassen.');
    } finally {setScanBusy(false);setScanStatus('');}
  }
  return (
    <>
      {user.role === "driver" && (
        <Title
          title={
            page === "Schicht"
              ? "Bereit für die nächste Runde?"
              : page === "Tour"
                ? "Deine nächste Haustür wartet."
                : page === "Belege"
                  ? "Alles auf einem Beleg."
                  : "Dein Einsatz zahlt sich aus."
          }
          subtitle={
            page === "Tour"
              ? `${open.length} offene Lieferungen · Reihenfolge nach Erfassung`
              : "Dein persönlicher Arbeitsbereich"
          }
        />
      )}{" "}
      {user.role === "kitchen" && page === "Verdienst" && <Title title="Mein Verdienst" subtitle="Deine Arbeitszeit und dein Verdienst nach Monat." />}
      {user.role === "driver" && ["Schicht", "Tour"].includes(page) && <ReturnTripControls user={user} data={data} act={act} notify={notify} />}
      {page === "Schicht" && (
        <>
          <Panel
            title={
              active ? "Du bist im Dienst." : "Deine Schicht beginnt hier."
            }
            subtitle={
              active
                ? "Eingestempelt um " + time(active.start)
                : "Ein Klick. Und los geht’s."
            }
          >
            <div className="shift-overview">
              <div className="shift-clock">
                {active ? hours(active).toFixed(2) : "0,00"}
                <span>Stunden gearbeitet</span>
              </div>
              {user.role === "driver" && (
                <div className="shift-clock">
                  {euro(
                    sum(
                      data.shifts.filter(
                        (s) =>
                          s.employeeId === user.id && day(s.start) === today(),
                      ),
                      (s) => hours(s) * s.hourlyRate,
                    ) + sum(todays, (o) => o.deliveryFee),
                  )}
                  <span>Heute verdient · vor Bargeldabzug</span>
                  <small>Auszahlung gesamt: {euro(personalPay.payout)} · Bargeld bei dir: {euro(personalPay.retainedCash)}</small>
                </div>
              )}
              <button
                className={active ? "secondary" : "primary"}
                onClick={async () => {
                  try {
                    if (active) {
                      await act("clockOut");
                    } else await act("clockIn");
                  } catch {}
                }}
              >
                <Clock size={18} />
                {active ? "Ausstempeln" : "Jetzt einstempeln"}
              </button>
            </div>
          {user.role === "driver" && <p className="muted">Beim Ausstempeln werden offene Lieferungen automatisch als zugestellt markiert. Das Bargeld bleibt bei dir und wird von deiner Auszahlung abgezogen.</p>}
          </Panel>
          <ShiftCorrections user={user} data={data} act={act} />
          {user.role === "driver" && (
            <div className="quick-actions">
              <button className="primary" onClick={() => setForm(!form)}>
                <Plus size={18} />
                Beleg manuell erfassen
              </button>
              <label className="secondary file-button">
                <Camera size={18} />
                {scanBusy ? 'Beleg wird gelesen …' : 'Beleg fotografieren'}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={scanBusy}
                  onChange={(e) => {photo(e.target.files[0]);e.target.value='';}}
                />
              </label>
            </div>
          )}
        </>
      )}
      {(page === "Belege" || page === "Tour") && (
        <div className="toolbar">
          <span>
            {page === "Belege"
              ? `${euro(sum(todays, (o) => o.amount))} Gesamt · ${euro(
                  sum(
                    todays.filter((o) => o.payment === "cash"),
                    (o) => o.amount,
                  ),
                )} Bar`
              : "Navigation öffnet Google Maps. Für GPS-Updates die App geöffnet lassen."}
          </span>
          <button className="primary" onClick={() => setForm(!form)}>
            <Plus size={17} />
            Beleg erfassen
          </button>
        </div>
      )}
      {scanBusy && <div className="notice" role="status" aria-live="polite">{scanStatus} · Das Foto bleibt auf deinem Gerät.</div>}
      {form && (
        <Panel
          title="Beleg prüfen & übernehmen"
          subtitle="Keine automatische Buchung: Adresse, Betrag und Zahlungsart kontrollieren."
        >
          {scan && <div className="receipt-review">
            <p>Auf deinem Gerät gelesen · kein KI-Dienst. Vergleiche alle Angaben mit dem Originalbeleg, besonders Bestellnummer und Adresse.</p>
            {scanPhoto && <details><summary>Originalbeleg anzeigen</summary><img className="receipt-preview" src={scanPhoto} alt="Originalbeleg zum Vergleichen" /></details>}
            {!!scan.warnings.length && <ul>{scan.warnings.map(message=><li key={message}>{message}</li>)}</ul>}
            <details><summary>Gelesenen Text anzeigen</summary><pre>{scan.text}</pre></details>
          </div>}
          <Form
            key={JSON.stringify(receipt)}
            initial={receipt}
            fields={fields}
            submit="Beleg übernehmen"
            onSubmit={async (v) => {
              await act("addOrder", {
                ...v,
                amount: Number(v.amount),
                noAddress: v.noAddress === "true",
                items: numericItems(items),
              });
              setForm(false);
              setReceipt({});
              setItems([]);
              setScan(null);
              setScanPhoto('');
            }}
          ><ItemsEditor items={items} onChange={setItems} /></Form>
        </Panel>
      )}
      {page === "Belege" && (
        <Panel title="Deine Belege heute">
          <OrderTable data={data} orders={todays} />
        </Panel>
      )}
      {page === "Tour" && (
        <>
          <div className="delivery-grid">
            {open.map((o, i) => (
              <Panel
                key={o.id}
                title={i + 1 + ". " + (o.address || "Ohne Adresse")}
                subtitle={o.postalCode + " " + (o.city || "")}
                action={
                  <Badge tone={o.payment === "cash" ? "orange" : "green"}>
                    {o.payment === "cash" ? "Bar kassieren" : "Online bezahlt"}
                  </Badge>
                }
              >
                <div className="delivery-amount">
                  {euro(o.amount)}
                  <small>
                    Bestellung {o.orderNumber || "—"} · Liefergeld{" "}
                    {euro(o.deliveryFee)}
                  </small>
                </div>
                <div className="row">
                  {o.address && (
                    <a
                      className="secondary"
                      href={
                        "https://www.google.com/maps/dir/?api=1&destination=" +
                        encodeURIComponent(
                          o.address + ", " + o.postalCode + " " + o.city,
                        )
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      <MapPin size={17} />
                      Maps öffnen
                    </a>
                  )}
                  <button
                    className="primary"
                    onClick={() =>
                      act("delivered", { id: o.id }).catch(() => {})
                    }
                  >
                    <Check size={17} />
                    Zugestellt
                  </button>
                </div>
              </Panel>
            ))}
          </div>
          {!open.length && <Empty>Alles zugestellt. Gute Fahrt zurück!</Empty>}
          <div className="notice">
            Entfernungssortierung, eingebettete Navigation und Mehrstopp-Routing
            sind noch nicht verbunden. Keine geschätzten Entfernungen werden
            erfunden.
          </div>
        </>
      )}
      {page === "Verdienst" && (
        <Payroll
          personal={user.role === "kitchen"}
          data={{
            ...data,
            employees: data.employees.filter((e) => e.id === user.id),
            shifts: data.shifts.filter(s => s.employeeId === user.id),
            orders: data.orders.filter(o => o.employeeId === user.id),
            handoffs: data.handoffs.filter(h => h.employeeId === user.id),
          }}
        />
      )}
    </>
  );
}
export function Analytics({ data, notify, act }) {
  const [period, setPeriod] = useState("week"),
    [offset, setOffset] = useState(0),
    [coach, setCoach] = useState(null),
    [busy, setBusy] = useState(false);
  const [itemOrder, setItemOrder] = useState(""), [items, setItems] = useState([]);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const length = {week: 7, month: 30, quarter: 90, year: 365}[period];
  end.setDate(end.getDate() + offset * length);
  const start = new Date(end);
  start.setDate(start.getDate() - length + 1);
  start.setHours(0, 0, 0, 0);
  const prevEnd = new Date(start - 1),
    prevStart = new Date(start);
  prevStart.setDate(prevStart.getDate() - length);
  const calc = (a, b) => {
    const os = data.orders.filter(
        (o) => new Date(o.createdAt) >= a && new Date(o.createdAt) <= b,
      ),
      revenue = sum(os, (o) => o.amount),
      wages =
        sum(
          data.shifts.filter(
            (s) => new Date(s.start) >= a && new Date(s.start) <= b,
          ),
          (s) => hours(s) * s.hourlyRate,
        ) + sum(os, (o) => o.deliveryFee);
    return {
      os,
      revenue,
      count: os.length,
      average: os.length ? revenue / os.length : 0,
      wages,
      ratio: revenue ? (wages / revenue) * 100 : 0,
      profit:
        revenue -
        wages -
        (revenue * Number(data.settings.foodCostPercent || 0)) / 100 -
        (Number(data.settings.fixedCosts || 0) * length) / 30,
    };
  };
  const a = calc(start, end),
    b = calc(prevStart, prevEnd),
    areas = {};
  const articles = summarizeItems(a.os);
  a.os.forEach((o) => {
    const key = o.postalCode || "Ohne Adresse";
    areas[key] = (areas[key] || 0) + o.amount;
  });
  return (
    <>
      <Title
        title="Nicht raten. Besser wissen."
        subtitle="Vergleiche, Muster und Zahlen aus deinem Betrieb."
      />
      <div className="toolbar">
        <div className="segmented">
          {[
            ["week", "7 Tage"],
            ["month", "30 Tage"],
            ["quarter", "90 Tage"],
            ["year", "365 Tage"],
          ].map(([v, l]) => (
            <button
              key={v}
              className={period === v ? "selected" : ""}
              onClick={() => {
                setPeriod(v);
                setOffset(0);
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="row">
          <button
            className="secondary"
            aria-label="Vorheriger Zeitraum"
            onClick={() => setOffset(offset - 1)}
          >
            <ChevronLeft size={17} />
          </button>
          <span>
            {day(start)} — {day(end)}
          </span>
          <button
            className="secondary"
            aria-label="Nächster Zeitraum"
            disabled={offset === 0}
            onClick={() => setOffset(offset + 1)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
      <Panel title="Im Vergleich zum vorherigen Zeitraum">
        <Table
          headers={["Kennzahl", "Aktuell", "Vorperiode", "Differenz"]}
          rows={[
            ["Umsatz", "revenue", euro],
            ["Bestellungen", "count", (n) => n],
            ["Ø Bestellwert", "average", euro],
            ["Personalquote", "ratio", (n) => n.toFixed(1) + " %"],
            ["Gewinn (geschätzt)", "profit", euro],
          ].map(([label, key, fmt]) => [
            label,
            <strong>{fmt(a[key])}</strong>,
            fmt(b[key]),
            fmt(a[key] - b[key]),
          ])}
        />
      </Panel>
      <Panel title="Verkaufte Artikel" subtitle={`${a.os.filter(o => o.status === "delivered" && o.items?.length).length} von ${a.os.filter(o => o.status === "delivered").length} zugestellten Bestellungen mit Artikeln · Nur erfasste Artikel im gewählten Zeitraum`}>
        <Table headers={["Artikel", "Anzahl", "Stückpreis", "Artikelumsatz"]} rows={articles.map(item => [item.name,item.quantity,item.minPrice === item.maxPrice ? euro(item.minPrice) : `${euro(item.minPrice)}–${euro(item.maxPrice)}`,euro(item.revenue)])} />
        <details className="article-capture"><summary>Artikel einer Bestellung erfassen oder korrigieren</summary>
          <form onSubmit={async e => {e.preventDefault();try {await act("saveOrderItems", {id:itemOrder,items:numericItems(items)});setItemOrder("");setItems([]);} catch {}}}>
            <label>Bestellung <select aria-label="Bestellung" required value={itemOrder} onChange={e => {setItemOrder(e.target.value);setItems(data.orders.find(o => o.id === e.target.value)?.items || []);}}><option value="">Bestellung wählen</option>{[...data.orders].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(o => <option value={o.id} key={o.id}>{day(o.createdAt)} · {o.orderNumber} · {person(data,o.employeeId)}</option>)}</select></label>
            {itemOrder && <><ItemsEditor items={items} onChange={setItems} /><button className="primary">Artikel speichern</button></>}
          </form>
        </details>
      </Panel>
      <div className="two-column">
        <Panel title="Stärkste Liefergebiete">
          <Table
            headers={["PLZ", "Umsatz"]}
            rows={Object.entries(areas)
              .sort((a, b) => b[1] - a[1])
              .map(([p, v]) => [p, euro(v)])}
          />
        </Panel>
        <Panel title="Fahrer im Vergleich">
          <Table
            headers={["Fahrer", "Lieferungen", "Umsatz", "Ø Min."]}
            rows={data.employees
              .filter((e) => e.role === "driver")
              .map((e) => {
                const os = a.os.filter((o) => o.employeeId === e.id),
                  del = os.filter((o) => o.deliveredAt && o.completionSource !== "clockOut");
                return [
                  e.name,
                  os.length,
                  euro(sum(os, (o) => o.amount)),
                  del.length
                    ? (
                        sum(
                          del,
                          (o) =>
                            (new Date(o.deliveredAt) - new Date(o.createdAt)) /
                            60000,
                        ) / del.length
                      ).toFixed(0)
                    : "—",
                ];
              })}
          />
        </Panel>
      </div>
      <Panel
        title="Umsatz nach Wochentag"
        subtitle="Alle erfassten Bestellungen im gewählten Zeitraum"
      >
        <Table
          headers={["Tag", "Umsatz"]}
          rows={["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"].map((name, i) => [
            name,
            euro(
              sum(
                a.os.filter((o) => new Date(o.createdAt).getDay() === i),
                (o) => o.amount,
              ),
            ),
          ])}
        />
      </Panel>
      <Panel
        title="Dein KI-Umsatz-Coach"
        subtitle="Empfehlungen nur auf Basis vorhandener Daten. Dünne Daten bleiben dünne Daten."
        action={<Sparkles size={21} />}
      >
        <p className="muted">
          Serverseitiger KI-Zugang erforderlich. Beispielzahlen werden als Demo
          behandelt.
        </p>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setCoach(
                await api("ai/coach", {
                  start: start.toISOString(),
                  end: end.toISOString(),
                }),
              );
            } catch (e) {
              notify(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Sparkles size={17} />
          {busy ? "Analysiert …" : "Empfehlungen erstellen"}
        </button>
        {coach && (
          <pre className="coach-result">
            {typeof coach === "string" ? coach : JSON.stringify(coach, null, 2)}
          </pre>
        )}
      </Panel>
    </>
  );
}
