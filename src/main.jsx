import React, { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  CalendarDays,
  Wallet,
  ChartNoAxesCombined,
  Users,
  MapPin,
  ClipboardList,
  Settings,
  LogOut,
  ArrowUpRight,
  Plus,
  Menu,
  Clock,
  Truck,
  Receipt,
  Database,
  ChefHat,
  ChevronRight,
  X,
  Check,
  Activity,
} from "lucide-react";
import { euro, day, sum, hours } from "./finance";
import { Management, Driver, Schedule, Analytics } from "./pages";
import "./style.css";
import { InstallApp } from "./install-app";
import { useDriverLocation } from "./location-sharing";
const DailyStatistics = lazy(() => import("./daily-statistics"));
const LiveDriverMap = lazy(() => import("./driver-map"));

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', {updateViaCache:'none'})
      .catch(error => console.error('App installation support unavailable:', error));
  }, {once:true});
}
export async function api(path, body, options = {}) {
  const r = await fetch("/api/" + path, {
    credentials: "same-origin",
    signal: options.signal,
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(Error(data.error || data.message || "Verbindung fehlgeschlagen"), {status:r.status});
  return data;
}
export const roleName = { chef: "Chef", kitchen: "Küche", driver: "Fahrer" };
export function Badge({ children, tone = "" }) {
  return <span className={"badge " + tone}>{children}</span>;
}
export function Empty({ children = "Hier ist noch nichts eingetragen." }) {
  return <div className="empty">{children}</div>;
}
export function Panel({ title, subtitle, action, children, className = "" }) {
  return (
    <section className={"panel " + className}>
      <header className="panel-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
export function Form({ fields, onSubmit, submit = "Speichern", initial = {}, children }) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = e.currentTarget;
        const values = Object.fromEntries(new FormData(f));
        setBusy(true);
        try {
          await onSubmit(values);
        } finally {
          setBusy(false);
        }
      }}
    >
      {fields.map((f) => (
        <label key={f.name}>
          {f.label}
          {f.options ? (
            <select
              name={f.name}
              aria-label={f.label}
              defaultValue={initial[f.name] ?? f.value ?? ""}
            >
              {f.options.map((o) => (
                <option key={o.value ?? o} value={o.value ?? o}>
                  {o.label ?? o}
                </option>
              ))}
            </select>
          ) : (
            <input
              name={f.name}
              type={f.type || "text"}
              defaultValue={initial[f.name] ?? f.value ?? ""}
              required={f.required !== false}
              min={f.min}
              max={f.max}
              step={f.step}
              inputMode={f.inputMode}
              minLength={f.minLength}
              maxLength={f.maxLength}
              pattern={f.pattern}
              placeholder={f.placeholder}
            />
          )}
        </label>
      ))}
      {children}
      <button className="primary" disabled={busy}>
        {busy ? "Wird gespeichert …" : submit}
      </button>
    </form>
  );
}
function Login({ onLogin, notify }) {
  const [people, setPeople] = useState([]),
    [demoMode, setDemoMode] = useState(false),
    [selected, setSelected] = useState(null),
    [pin, setPin] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api("people")
      .then((d) => {
        setPeople(d.people);
        setDemoMode(d.demo === true);
      })
      .catch((e) => notify(e.message));
  }, []);
  return (
    <div className="login">
      <div className="login-brand">
        <div className="brand large">
          jeffreyys<span>®</span>
        </div>
        <div className="login-copy">
          <span className="eyebrow">BURGER. TEAM. ZUSAMMEN.</span>
          <h1>
            Guter Service
            <br />
            beginnt hier.
          </h1>
          <p>
            Dein Arbeitsplatz für alles,
            <br />
            was hinter dem Tresen passiert.
          </p>
        </div>
        <div className="login-footer">
          MÜNCHEN <span>EST. FOR GOOD TIMES</span>
        </div>
      </div>
      <main className="login-main">
        <Badge tone="orange">TEAM WORKSPACE</Badge>
        <h2>
          {selected ? "Hi, " + selected.name + "." : "Schön, dass du da bist."}
        </h2>
        <p>
          {selected
            ? demoMode
              ? "Deine Demo-PIN, dann geht’s los."
              : "Deine 8–12-stellige PIN, dann geht’s los."
            : "Wähle deinen Namen, um loszulegen."}
        </p>
        {!selected ? (
          <div className="people">
            {people.map((p) => (
              <button key={p.id} onClick={() => setSelected(p)}>
                <span className="avatar">{p.name.slice(0, 2)}</span>
                <span>
                  <strong>{p.name}</strong>
                  <small>{roleName[p.role]}</small>
                </span>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api("login", { id: selected.id, pin });
                await onLogin();
              } catch (e) {
                notify(e.message);
                setPin("");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="pin-label">
              PIN
              <input
                autoFocus
                type="password"
                inputMode="numeric"
                pattern="[0-9]{4,12}"
                maxLength={12}
                minLength={4}
                required
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                autoComplete="off"
              />
            </label>
            <button className="primary full" disabled={busy}>
              Anmelden <ArrowUpRight size={18} />
            </button>
            <button
              type="button"
              className="text-button full"
              onClick={() => {
                setSelected(null);
                setPin("");
              }}
            >
              Anderen Namen wählen
            </button>
          </form>
        )}
        <div className="login-note">
          {demoMode ? (
            <>
              Lokale Entwicklung · Demokonten
              <br />
              Alex 1234 · Samira 2345 · Leo 3456 · Mia 4567
              <br />
              Niemals mit echten Daten im Demo-Modus arbeiten.
            </>
          ) : (
            <>Geschützter Teamzugang · Zugangsdaten bei der Leitung erfragen.</>
          )}
        </div>
        <InstallApp />
      </main>
    </div>
  );
}
const chefNav = [
  ["Heute", LayoutDashboard],
  ["Plan", CalendarDays],
  ["Geld", Wallet],
  ["Analyse", ChartNoAxesCombined],
  ["Statistik", ChartNoAxesCombined],
  ["Kasse", Receipt],
  ["Kunden", Users],
  ["Zeiten", Clock],
  ["Team", Users],
  ["Gebiete", MapPin],
  ["Aufgaben", ClipboardList],
  ["Finanzen", Settings],
  ["Einstellungen", Settings],
  ["Daten", Database],
];
function App() {
  const [user, setUser] = useState(null),
    [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState("Heute"),
    [toast, setToast] = useState(""),
    [mobile, setMobile] = useState(false),
    [connected, setConnected] = useState(false);
  const notify = useCallback((s) => {
    setToast(s);
    setTimeout(() => setToast(""), 6500);
  }, []);
  const locationSharing = useDriverLocation({user, data, send:api, ready:!loading});
  const refresh = useCallback(async () => {
    const s = await api("session");
    setUser(s.user);
    if (s.user) setData(await api("state"));
    else setData(null);
    setLoading(false);
  }, []);
  useEffect(() => {
    refresh().catch((e) => {
      notify(e.message);
      setLoading(false);
    });
  }, []);
  useEffect(() => {
    if (!user) return;
    const es = new EventSource("/api/events");
    es.onopen = () => setConnected(true);
    es.addEventListener("invalidate", () => refresh().catch((e) => notify(e.message)));
    es.onerror = () => setConnected(false);
    const timer = setInterval(
      () =>
        api("state")
          .then(setData)
          .catch(() => setConnected(false)),
      20000,
    );
    return () => {
      es.close();
      clearInterval(timer);
    };
  }, [user?.id]);
  const act = async (type, payload = {}) => {
    try {
      const response = await api("action", { type, ...payload });
      if (type === "reset") {
        setUser(null); setData(null); setPage("Heute");
        return true;
      }
      setData(response.state);
      notify("Gespeichert.");
      return true;
    } catch (e) {
      notify(e.message);
      throw e;
    }
  };
  const go = (p) => {
    setPage(p);
    setMobile(false);
  };
  if (loading)
    return (
      <div className="loading">
        jeffreyys<span>Workspace wird geladen …</span>
      </div>
    );
  if (!user)
    return (
      <>
        <Login
          onLogin={async () => {
            await refresh();
            setPage("Heute");
          }}
          notify={notify}
        />
        {toast && (
          <div className="toast" role="alert">
            {toast}
          </div>
        )}
      </>
    );
  if (!data) return <div className="loading">Daten werden geladen …</div>;
  const nav =
    user.role === "chef"
      ? chefNav
      : user.role === "kitchen"
        ? [
            ["Tafel", LayoutDashboard],
            ["Statistik", ChartNoAxesCombined],
            ["Plan", CalendarDays],
            ["Mein Verdienst", Wallet],
            ["Aufgaben", ClipboardList],
          ]
        : [
            ["Schicht", Clock],
            ["Tour", Truck],
            ["Belege", Receipt],
            ["Plan", CalendarDays],
            ["Verdienst", Wallet],
            ["Statistik", ChartNoAxesCombined],
          ];
  const current = nav.some((n) => n[0] === page) ? page : nav[0][0];
  const pendingCorrections = (data.shiftRequests || []).filter(r => r.status === "pending").length;
  const demo =
    data.orders.some((o) => o.demo) || data.employees.some((e) => e.demo);
  return (
    <div className="app">
      <aside className={mobile ? "sidebar open" : "sidebar"}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go(nav[0][0]);
          }}
        >
          jeffreyys<span>®</span>
        </a>
        <div className="workspace-label">
          TEAM WORKSPACE <span>MÜNCHEN</span>
        </div>
        <nav>
          {nav.map(([label, Icon], i) => (
            <React.Fragment key={label}>
              {user.role === "chef" && i === 3 && (
                <div className="nav-caption">BETRIEB & VERWALTUNG</div>
              )}
              <button
                className={current === label ? "nav-item active" : "nav-item"}
                onClick={() => go(label)}
              >
                <Icon size={19} />
                {label}
                {label === "Zeiten" && user.role === "chef" && pendingCorrections > 0 && <span className="nav-count">{pendingCorrections}</span>}
                {label === "Aufgaben" && (
                  <span className="nav-count">
                    {data.tasks.filter((t) => !t.done).length}
                  </span>
                )}
              </button>
            </React.Fragment>
          ))}
        </nav>
        <InstallApp />
        <div className="sidebar-bottom">
          <span className="avatar orange">{user.name.slice(0, 2)}</span>
          <div>
            <strong>{user.name}</strong>
            <small>{roleName[user.role]}</small>
          </div>
          <button
            aria-label="Abmelden"
            className="icon-button"
            onClick={async () => {
              await api("logout", {});
              setUser(null);
              setData(null);
            }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="row">
            <button
              className="icon-button mobile-menu"
              aria-label="Menü"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={22} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{current}</strong>
          </div>
          <div className="row">
            <span className={"connection " + (connected ? "" : "offline")}>
              <i />
              {connected ? "Live verbunden" : "Verbindung wird aufgebaut"}
            </span>
            <span className="top-date">
              {new Date().toLocaleDateString("de-DE", {
                day: "numeric",
                month: "long",
                timeZone: "Europe/Berlin",
              })}
            </span>
          </div>
        </header>
        <main className="content">
          {user.role === "chef" && pendingCorrections > 0 && <div className="notice location-sharing" role="status">
            <strong>{pendingCorrections} Zeitkorrektur-Anfrage(n) warten auf deine Entscheidung.</strong>
            <button className="secondary" onClick={() => go("Zeiten")}>Anfragen prüfen</button>
          </div>}
          {user.role === "driver" && data.shifts.some(s => s.employeeId === user.id && !s.end) && <div className="notice location-sharing">
            <div><strong>{locationSharing.tracking ? "Standortfreigabe aktiv" : "Standortfreigabe"}</strong><p role="status">{locationSharing.status}</p><small>Für laufende Updates die App geöffnet lassen. Geräte können GPS im Hintergrund pausieren.</small></div>
            <button className="secondary" onClick={locationSharing.toggle}>{locationSharing.tracking ? "Standortfreigabe stoppen" : "Standortfreigabe aktivieren"}</button>
          </div>}
          {demo && (
            <div className="demo-strip">
              <span>
                <b>DEMO</b> Zum Ausprobieren. Alle Beispieldaten sind markiert.
              </span>
              <span>Kein Live-Betrieb</span>
            </div>
          )}
          {current === "Statistik" ? (
            <Suspense fallback={<p>Statistik wird geladen …</p>}><DailyStatistics user={user} data={data} /></Suspense>
          ) : current === "Heute" ? (
            <Dashboard data={data} go={go} act={act} />
          ) : current === "Tafel" ? (
            <>
              <Title
                title="Alles im Blick."
                subtitle="Küche & Fahrer · Dein Live-Überblick"
              />
              <Driver
                user={user}
                data={data}
                act={act}
                page="Schicht"
                notify={notify}
              />
              <Drivers data={data} />
              <Tasks data={data} act={act} />
            </>
          ) : current === "Plan" ? (
            <Schedule user={user} data={data} act={act} />
          ) : current === "Analyse" ? (
            <Analytics data={data} notify={notify} act={act} />
          ) : current === "Aufgaben" ? (
            <>
              <Title
                title="Was noch ansteht."
                subtitle="Gemeinsamer Merkzettel für Chef & Küche"
              />
              <Tasks data={data} act={act} />
            </>
          ) : current === "Mein Verdienst" ? (
            <Driver user={user} data={data} page="Verdienst" act={act} notify={notify} />
          ) : user.role === "driver" ? (
            <Driver
              user={user}
              data={data}
              page={current}
              act={act}
              notify={notify}
            />
          ) : (
            <Management
              key={current}
              user={user}
              data={data}
              page={current}
              act={act}
              notify={notify}
            />
          )}
          <footer className="page-footer">
            <span>JEFFREYYS / TEAM WORKSPACE</span>
            <span>Mit Liebe gemacht. Für deinen Betrieb.</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button aria-label="Schließen" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
export function Title({ title, subtitle, children }) {
  return (
    <div className="title-row">
      <div>
        <p className="eyebrow">JEFFREY’S BURGER · MÜNCHEN</p>
        <h1>{title}</h1>
        <p className="subtitle">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}
export function Tasks({ data, act }) {
  const [text, setText] = useState("");
  const tasks = [...data.tasks].sort((a, b) => Number(a.done) - Number(b.done));
  return (
    <Panel
      title="Gemeinsam erledigen"
      subtitle={`${tasks.filter((t) => !t.done).length} offene Aufgaben`}
    >
      <div className="task-list">
        {tasks.slice(0, 12).map((t) => (
          <button
            className={"task " + (t.done ? "done" : "")}
            key={t.id}
            onClick={() => act("toggleTask", { id: t.id }).catch(() => {})}
          >
            <span className="checkbox">{t.done && <Check size={14} />}</span>
            <span>{t.text}</span>
            {t.done ? <Badge>Erledigt</Badge> : <span className="task-dot" />}
          </button>
        ))}
        {!tasks.length && <Empty>Alles erledigt. Starkes Team!</Empty>}
      </div>
      <form
        className="task-add"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await act("addTask", { text });
            setText("");
          } catch {}
        }}
      >
        <Plus size={18} />
        <input
          aria-label="Neue Aufgabe"
          placeholder="Neue Aufgabe für das Team …"
          value={text}
          onChange={(e) => setText(e.target.value)}
          required
          maxLength={250}
        />
        <button type="submit" className="text-button">
          Hinzufügen
        </button>
      </form>
    </Panel>
  );
}
export function Drivers({ data }) {
  const drivers = data.employees.filter(e => e.role === "driver" && e.active !== false);
  return (
    <Panel
      title="Dein Team unterwegs"
      subtitle="Fahrerstatus in Echtzeit"
      action={<Badge tone="green">LIVE</Badge>}
    >
      <div className="driver-list">
        {drivers
          .map((e) => {
            const active = data.shifts.find(
                (s) => s.employeeId === e.id && !s.end,
              ),
              orders = data.orders.filter(
                (o) => o.employeeId === e.id && o.status === "open",
              );
            const delivered = data.orders.filter(o => o.employeeId === e.id && o.deliveredAt && o.completionSource !== "clockOut" && day(o.createdAt) === day(Date.now()));
            const minutes = delivered.length ? sum(delivered, o => Math.max(0, (Date.parse(o.deliveredAt) - Date.parse(o.createdAt)) / 60000)) / delivered.length : null;
            return (
              <div className="driver-row" key={e.id}>
                <span className="avatar">{e.name.slice(0, 2)}</span>
                <div className="grow">
                  <strong>{e.name}</strong>
                  <small>
                    {active
                      ? orders.length + " offene Lieferungen"
                      : "Nächste Pause? Verdient."}
                  </small>
                  <small>{minutes === null ? "Noch keine Lieferzeit heute" : `Ø ${minutes.toFixed(1)} Min. je Bestellung · ${delivered.length} zugestellt heute`}</small>
                </div>
                <Badge tone={active ? "green" : ""}>
                  {active ? "Im Dienst" : "Nicht im Dienst"}
                </Badge>
              </div>
            );
          })}
      </div>
      <div className="driver-map">
        <Suspense fallback={<p>Karte wird geladen …</p>}><LiveDriverMap drivers={drivers.filter(e => data.shifts.some(s => s.employeeId === e.id && !s.end))} store={data.settings.store} /></Suspense>
      </div>
      <div className="panel-foot">
        Lieferzeit: von Erfassung bis bestätigter Zustellung, inklusive Wartezeit. Automatisch beim Ausstempeln geschlossene Lieferungen sind ausgenommen. Die Karte zeigt freiwillig geteilte GPS-Standorte und geschätzte Rückfahrten. Rückfahrten sind keine Live-Ortung.
      </div>
    </Panel>
  );
}
function Dashboard({ data, go, act }) {
  const today = day(Date.now()),
    orders = data.orders.filter((o) => day(o.createdAt) === today),
    revenue = sum(orders, (o) => o.amount),
    cash = sum(
      orders.filter((o) => o.payment === "cash"),
      (o) => o.amount,
    ),
    wages =
      sum(
        data.shifts.filter((s) => day(s.start) === today),
        (s) => hours(s) * s.hourlyRate,
      ) + sum(orders, (o) => o.deliveryFee),
    food = (revenue * (Number(data.settings.foodCostPercent) || 0)) / 100,
    fixed = Number(data.settings.fixedCosts) || 0,
    days = new Date(
      new Date().getFullYear(),
      new Date().getMonth() + 1,
      0,
    ).getDate(),
    profit = revenue - wages - food - fixed / days,
    ratio = revenue ? (wages / revenue) * 100 : 0;
  const buckets = Array.from({ length: 12 }, (_, i) => ({
    h: i + 11,
    total: sum(
      orders.filter(
        (o) =>
          Number(
            new Intl.DateTimeFormat("en-GB", {
              hour: "numeric",
              hourCycle: "h23",
              timeZone: "Europe/Berlin",
            }).format(new Date(o.createdAt)),
          ) ===
          i + 11,
      ),
      (o) => o.amount,
    ),
  }));
  const max = Math.max(...buckets.map((b) => b.total), 1);
  return (
    <>
      <Title
        title="Ein guter Tag für gute Burger."
        subtitle={new Date().toLocaleDateString("de-DE", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "Europe/Berlin",
        })}
      >
        <button className="secondary" onClick={() => go("Analyse")}>
          Zur Analyse <ArrowUpRight size={17} />
        </button>
      </Title>
      <div className="metrics">
        <div className="metric featured">
          <span>
            Umsatz heute <Activity size={17} />
          </span>
          <strong>{euro(revenue)}</strong>
          <small>Aus {orders.length} erfassten Bestellungen</small>
        </div>
        <div className="metric">
          <span>
            Bestellungen <Receipt size={17} />
          </span>
          <strong>
            {orders.length}
            <em>Bestellungen</em>
          </strong>
          <small>
            {orders.filter((o) => o.status === "open").length} noch unterwegs
          </small>
        </div>
        <div className="metric">
          <span>
            Ø Bestellwert <Wallet size={17} />
          </span>
          <strong>{euro(orders.length ? revenue / orders.length : 0)}</strong>
          <small>Pro erfasstem Beleg</small>
        </div>
        <div className="metric">
          <span>
            {fixed ? "Geschätzter Gewinn" : "Deckungsbeitrag"}{" "}
            <ChartNoAxesCombined size={17} />
          </span>
          <strong>{euro(profit)}</strong>
          <small>
            {fixed ? "Nach hinterlegten Kosten" : "Noch ohne Fixkosten"}
          </small>
        </div>
      </div>
      <div className="dashboard-grid">
        <Panel
          title="So läuft dein Tag"
          subtitle="Umsatz nach Uhrzeit · heute"
          action={<Badge>Heute</Badge>}
        >
          <div className="chart-head">
            <strong>{euro(revenue)}</strong>
            <span>
              <i className="legend-dot" /> Umsatz in €
            </span>
          </div>
          <div className="bar-chart">
            {buckets.map((b) => (
              <div className="bar-slot" key={b.h}>
                <span className="bar-value">
                  {b.total ? euro(b.total) : ""}
                </span>
                <div
                  title={`${b.h} Uhr: ${euro(b.total)}`}
                  className="bar"
                  style={{ height: Math.max(2, (b.total / max) * 145) }}
                />
                <span className="bar-label">{b.h}</span>
              </div>
            ))}
          </div>
          <div className="payment-split">
            <div>
              <span>
                Bar <b>{euro(cash)}</b>
              </span>
              <span>
                Online <b>{euro(revenue - cash)}</b>
              </span>
            </div>
            <div className="split-track">
              <i
                style={{ width: (revenue ? (cash / revenue) * 100 : 0) + "%" }}
              />
            </div>
          </div>
        </Panel>
        <Panel
          title="Was heute übrig bleibt"
          subtitle="Deine Kosten, transparent aufgeschlüsselt"
        >
          <div className="cost-lines">
            <div>
              <span>Umsatz</span>
              <b>{euro(revenue)}</b>
            </div>
            <div>
              <span>Personal & Liefergeld</span>
              <span>− {euro(wages)}</span>
            </div>
            <div>
              <span>
                Wareneinsatz{" "}
                <small>{data.settings.foodCostPercent || 0} %</small>
              </span>
              <span>− {euro(food)}</span>
            </div>
            <div>
              <span>Fixkosten anteilig</span>
              <span>− {euro(fixed / days)}</span>
            </div>
            <div className="cost-total">
              <b>{fixed ? "Gewinn (geschätzt)" : "Deckungsbeitrag"}</b>
              <strong>{euro(profit)}</strong>
            </div>
          </div>
          <div className={"insight " + (ratio > 35 ? "warning" : "")}>
            <span className="eyebrow">PERSONALQUOTE</span>
            <strong>{ratio.toFixed(1)} %</strong>
            <p>
              {ratio > 35
                ? "Über 35 %. Prüfe die Besetzung für ruhigere Zeiten."
                : "Löhne und Liefergeld im Verhältnis zum Umsatz."}
            </p>
          </div>
        </Panel>
        <Drivers data={data} />
        <Tasks data={data} act={act} />
      </div>
      <div className="notice">
        <span>Gut zu wissen</span> Die Auswertung basiert auf erfassten Belegen,
        nicht auf einer angebundenen Kasse. Keine Steuer- oder
        Lohnabrechnungssoftware.
      </div>
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
