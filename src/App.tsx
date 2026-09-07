import { useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import plan from "./data/pgl.json";
import { loadAuth, saveAuth, updateJiraIssue, type JiraAuth } from "./jira";

type Owner = "lewis" | "alok" | "other";
type Issue = {
  key: string;
  summary: string;
  type: string;
  parent: string | null;
  start: string | null;
  due: string | null;
  owner: Owner;
  assignee: string;
  sprint: string;
  track: string;
  priority: string;
  status: string;
  blocks: string[];
  blockedBy: string[];
  critical: boolean;
  sprintEpic: boolean;
  url: string;
};

type View = "tracks" | "people" | "epics" | "critical";

const DAY_MS = 86_400_000;
const LEWIS_NAME = "Lewis McFadden";
const ALOK_NAME = "Alok Ranjan";

function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${start}T00:00:00`); t <= Date.parse(`${end}T00:00:00`); t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function weekday(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

function dayNum(iso: string) {
  return new Date(`${iso}T00:00:00`).getDate();
}

function isWeekend(iso: string) {
  const d = new Date(`${iso}T00:00:00`).getDay();
  return d === 0 || d === 6;
}

function sprintFor(iso: string) {
  return plan.sprints.find((s) => iso >= s.start && iso <= s.end)?.id ?? "";
}

function matches(issue: Issue, q: string, owner: "all" | Owner, sprint: string) {
  if (issue.sprintEpic) return false;
  if (owner !== "all" && issue.owner !== owner) return false;
  if (sprint !== "all" && issue.sprint !== sprint) return false;
  if (!q) return true;
  const hay = `${issue.key} ${issue.summary} ${issue.assignee}`.toLowerCase();
  return hay.includes(q);
}

export default function App() {
  const days = useMemo(() => eachDay(plan.clockStart, plan.clockEnd), []);
  const [items, setItems] = useState<Issue[]>(() => structuredClone(plan.issues) as Issue[]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [view, setView] = useState<View>("tracks");
  const [owner, setOwner] = useState<"all" | Owner>("all");
  const [sprint, setSprint] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Issue | null>(null);
  const [expand, setExpand] = useState<Record<string, boolean>>({});
  const [auth, setAuth] = useState<JiraAuth | null>(() => (typeof localStorage === "undefined" ? null : loadAuth()));
  const [showAuth, setShowAuth] = useState(false);
  const [email, setEmail] = useState(auth?.email ?? "");
  const [token, setToken] = useState(auth?.token ?? "");
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const dragged = useRef(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = items.filter((i) => matches(i, q, owner, sprint));
    if (view === "critical") list = list.filter((i) => i.critical);
    if (view !== "epics") list = list.filter((i) => i.type !== "epic");
    return list;
  }, [items, owner, sprint, query, view]);

  const lanes = useMemo(() => {
    if (view === "people") {
      return [
        { id: "lewis", name: "Lewis", hint: "Drop on a day to assign" },
        { id: "alok", name: "Alok", hint: "Drop on a day to assign" },
      ];
    }
    if (view === "epics") {
      return items
        .filter((i) => i.type === "epic" && !i.sprintEpic)
        .map((e) => ({
          id: e.key,
          name: e.summary.replace(" — ", " · ").slice(0, 36),
          hint: e.key,
        }));
    }
    if (view === "critical") {
      return [{ id: "critical", name: "Critical path", hint: "Drag to another day to retarget" }];
    }
    return plan.tracks;
  }, [view, items]);

  const byLaneDay = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of visible) {
      const day = issue.start || issue.due;
      if (!day) continue;
      let lane = issue.track;
      if (view === "people") lane = issue.owner;
      if (view === "critical") lane = "critical";
      if (view === "epics") lane = issue.parent || issue.key;
      const key = `${lane}|${day}`;
      const arr = map.get(key) ?? [];
      arr.push(issue);
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => Number(b.critical) - Number(a.critical) || a.key.localeCompare(b.key));
    }
    return map;
  }, [visible, view]);

  const counts = useMemo(
    () => ({
      lewis: visible.filter((i) => i.owner === "lewis").length,
      alok: visible.filter((i) => i.owner === "alok").length,
      critical: visible.filter((i) => i.critical).length,
    }),
    [visible],
  );

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4200);
  }

  function applyLocal(key: string, patch: Partial<Issue>) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
    setSelected((cur) => (cur?.key === key ? { ...cur, ...patch } : cur));
  }

  async function commitMove(key: string, nextDay: string, nextOwner?: Owner) {
    const current = itemsRef.current.find((i) => i.key === key);
    if (!current || current.sprintEpic) return;
    const sameDay = (current.start || current.due) === nextDay;
    const sameOwner = !nextOwner || nextOwner === current.owner;
    if (sameDay && sameOwner) return;

    if (!auth) {
      setShowAuth(true);
      flash("Connect Jira to save moves");
      return;
    }

    const prev = {
      start: current.start,
      due: current.due,
      owner: current.owner,
      assignee: current.assignee,
      sprint: current.sprint,
    };
    const nextSprint = sprintFor(nextDay);
    const ownerPatch =
      nextOwner === "lewis" || nextOwner === "alok"
        ? { owner: nextOwner, assignee: nextOwner === "lewis" ? LEWIS_NAME : ALOK_NAME }
        : {};
    applyLocal(key, { start: nextDay, due: nextDay, sprint: nextSprint, ...ownerPatch });
    setBusy(key);
    try {
      await updateJiraIssue(auth, {
        key,
        start: nextDay,
        due: nextDay,
        owner: nextOwner === "lewis" || nextOwner === "alok" ? nextOwner : undefined,
      });
      const bits = [`${key} → ${nextDay.slice(8)} Sep`];
      if (nextOwner) bits.push(nextOwner === "lewis" ? "Lewis" : "Alok");
      flash(`${bits.join(" · ")} · Jira updated`);
    } catch (err) {
      applyLocal(key, prev);
      flash(err instanceof Error ? err.message : "Jira update failed");
    } finally {
      setBusy(null);
      setDropOn(null);
    }
  }

  function onDropCell(day: string, laneId: string) {
    return async (e: DragEvent) => {
      e.preventDefault();
      const key = e.dataTransfer.getData("text/pgl-key") || e.dataTransfer.getData("text/plain");
      setDropOn(null);
      if (!key) return;
      const nextOwner = view === "people" && (laneId === "lewis" || laneId === "alok") ? laneId : undefined;
      await commitMove(key, day, nextOwner);
    };
  }

  function connect(e: FormEvent) {
    e.preventDefault();
    const next = { email: email.trim(), token: token.trim() };
    if (!next.email || !next.token) return;
    saveAuth(next);
    setAuth(next);
    setShowAuth(false);
    flash("Jira connected · drag a chip to move it");
  }

  function disconnect() {
    saveAuth(null);
    setAuth(null);
    setToken("");
    flash("Jira disconnected");
  }

  return (
    <div className="page">
      <header className="top">
        <div>
          <p className="kicker">Surf Local · Production go-live</p>
          <h1>{plan.title}</h1>
          <p className="sub">
            Drag a chip onto a day to write Start + Due + sprint label in Jira. In People view, drop onto
            Lewis or Alok to reassign. Filters do not write Jira.
          </p>
        </div>
        <div className="links">
          <button type="button" className={auth ? "ok" : ""} onClick={() => setShowAuth((v) => !v)}>
            {auth ? "Jira connected" : "Connect Jira"}
          </button>
          <a href={plan.jira} target="_blank" rel="noreferrer">
            PGL board
          </a>
          <a href={plan.confluence} target="_blank" rel="noreferrer">
            Confluence plan
          </a>
        </div>
      </header>

      {showAuth && (
        <form className="connect" onSubmit={connect}>
          <p>
            Paste an Atlassian API token from{" "}
            <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer">
              id.atlassian.com
            </a>
            . It stays in this browser and is sent only to this app’s Jira proxy. Writes Start date, Due date,
            sprint labels, and assignee.
          </p>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Atlassian email" autoComplete="username" />
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="API token"
            type="password"
            autoComplete="current-password"
          />
          <div className="connect-actions">
            <button type="submit">Save & connect</button>
            {auth && (
              <button type="button" onClick={disconnect}>
                Disconnect
              </button>
            )}
            <button type="button" onClick={() => setShowAuth(false)}>
              Close
            </button>
          </div>
        </form>
      )}

      <section className="sprints">
        {plan.sprints.map((s) => (
          <button
            key={s.id}
            className={`sprint sprint-${s.id} ${sprint === s.id ? "on" : ""}`}
            onClick={() => setSprint(sprint === s.id ? "all" : s.id)}
          >
            <strong>{s.name}</strong>
            <span>
              {s.start.slice(8)}–{s.end.slice(8)} Sep
            </span>
            <em>{s.ships}</em>
          </button>
        ))}
      </section>

      <div className="toolbar">
        <div className="seg">
          {(
            [
              ["tracks", "Tracks"],
              ["people", "People"],
              ["epics", "Epics"],
              ["critical", "Critical path"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={view === id ? "on" : ""} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="seg">
          <button className={owner === "all" ? "on" : ""} onClick={() => setOwner("all")}>
            Both
          </button>
          <button className={owner === "lewis" ? "on" : ""} onClick={() => setOwner("lewis")}>
            Lewis {counts.lewis}
          </button>
          <button className={owner === "alok" ? "on" : ""} onClick={() => setOwner("alok")}>
            Alok {counts.alok}
          </button>
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search PGL-109, SMS, Vault…" />
        <p className="meta">
          {visible.length} items · {counts.critical} on the critical path
        </p>
      </div>

      <div className="legend">
        <span className="chip lewis tiny">Lewis</span>
        <span className="chip alok tiny">Alok</span>
        <span className="chip lewis tiny critical">Critical</span>
        <span>Drag to a day writes Jira. Gold ring = Blocks chain.</span>
      </div>

      <div className="scroller">
        <div className="chart" style={{ gridTemplateColumns: `168px repeat(${days.length}, minmax(52px, 1fr))` }}>
          <div className="corner sticky">Track</div>
          {days.map((d) => (
            <div
              key={d}
              className={`head sticky weekend-${isWeekend(d)} today-${d === plan.today} sprint-${sprintFor(d)}`}
            >
              <span>{weekday(d)}</span>
              <strong>{dayNum(d)}</strong>
              {d === plan.today && <em>today</em>}
            </div>
          ))}

          {lanes.map((lane) => (
            <Lane
              key={lane.id}
              lane={lane}
              days={days}
              byLaneDay={byLaneDay}
              expand={expand[lane.id] ?? false}
              dropOn={dropOn}
              busy={busy}
              onToggle={() => setExpand((e) => ({ ...e, [lane.id]: !e[lane.id] }))}
              onSelect={(issue) => {
                if (dragged.current) {
                  dragged.current = false;
                  return;
                }
                setSelected(issue);
              }}
              onDragFlag={() => {
                dragged.current = true;
              }}
              onDragOverCell={(id) => setDropOn(id)}
              onDropCell={onDropCell}
              selectedKey={selected?.key}
            />
          ))}
        </div>
      </div>

      {selected && (
        <aside className="drawer">
          <button className="close" onClick={() => setSelected(null)}>
            Close
          </button>
          <p className="kicker">
            {selected.type} · sprint {selected.sprint} · {selected.track}
          </p>
          <h2>{selected.key}</h2>
          <p>{selected.summary}</p>
          <dl>
            <div>
              <dt>Owner</dt>
              <dd>{selected.assignee}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>
                <input
                  type="date"
                  min={plan.clockStart}
                  max={plan.clockEnd}
                  value={selected.start || selected.due || ""}
                  onChange={(e) => {
                    if (e.target.value) void commitMove(selected.key, e.target.value);
                  }}
                />
              </dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>{selected.priority}</dd>
            </div>
          </dl>
          <div className="assign">
            <button
              type="button"
              disabled={busy === selected.key}
              onClick={() => void commitMove(selected.key, selected.start || selected.due || plan.clockStart, "lewis")}
            >
              Assign Lewis
            </button>
            <button
              type="button"
              disabled={busy === selected.key}
              onClick={() => void commitMove(selected.key, selected.start || selected.due || plan.clockStart, "alok")}
            >
              Assign Alok
            </button>
          </div>
          {selected.blockedBy.length > 0 && <p>Blocked by {selected.blockedBy.join(", ")}</p>}
          {selected.blocks.length > 0 && <p>Blocks {selected.blocks.join(", ")}</p>}
          <a className="jira" href={selected.url} target="_blank" rel="noreferrer">
            Open in Jira
          </a>
        </aside>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Lane({
  lane,
  days,
  byLaneDay,
  expand,
  dropOn,
  busy,
  onToggle,
  onSelect,
  onDragFlag,
  onDragOverCell,
  onDropCell,
  selectedKey,
}: {
  lane: { id: string; name: string; hint: string };
  days: string[];
  byLaneDay: Map<string, Issue[]>;
  expand: boolean;
  dropOn: string | null;
  busy: string | null;
  onToggle: () => void;
  onSelect: (issue: Issue) => void;
  onDragFlag: () => void;
  onDragOverCell: (id: string | null) => void;
  onDropCell: (day: string, laneId: string) => (e: DragEvent) => void;
  selectedKey?: string;
}) {
  const total = days.reduce((n, d) => n + (byLaneDay.get(`${lane.id}|${d}`)?.length ?? 0), 0);
  return (
    <>
      <div className="lane sticky">
        <strong>{lane.name}</strong>
        <span>
          {lane.hint} · {total}
        </span>
      </div>
      {days.map((d) => {
        const laneItems = byLaneDay.get(`${lane.id}|${d}`) ?? [];
        const cap = expand ? laneItems.length : 4;
        const shown = laneItems.slice(0, cap);
        const more = laneItems.length - shown.length;
        const dropId = `${lane.id}|${d}`;
        return (
          <div
            key={d}
            className={`cell weekend-${isWeekend(d)} sprint-${sprintFor(d)} ${dropOn === dropId ? "drop" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              onDragOverCell(dropId);
            }}
            onDragLeave={() => onDragOverCell(null)}
            onDrop={onDropCell(d, lane.id)}
          >
            {shown.map((issue) => (
              <button
                key={issue.key}
                draggable
                className={`chip ${issue.owner} ${issue.critical ? "critical" : ""} ${selectedKey === issue.key ? "sel" : ""} ${busy === issue.key ? "busy" : ""}`}
                title={`${issue.key} ${issue.summary} · drag to move`}
                onDragStart={(e) => {
                  onDragFlag();
                  e.dataTransfer.setData("text/pgl-key", issue.key);
                  e.dataTransfer.setData("text/plain", issue.key);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => onSelect(issue)}
              >
                {issue.key.replace("PGL-", "")}
              </button>
            ))}
            {more > 0 && (
              <button className="more" onClick={onToggle}>
                +{more}
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}
