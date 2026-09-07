import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import plan from "./data/pgl.json";
import { loadJiraStatuses, updateJiraIssue } from "./jira";

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
type DragMode = "move" | "start" | "due";
type DragMeta = { key: string; mode: DragMode; start: string; due: string };
type DropRange = { laneId: string; from: string; to: string };

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

function addDays(iso: string, n: number) {
  return new Date(Date.parse(`${iso}T00:00:00`) + n * DAY_MS).toISOString().slice(0, 10);
}

function clampDay(iso: string) {
  if (iso < plan.clockStart) return plan.clockStart;
  if (iso > plan.clockEnd) return plan.clockEnd;
  return iso;
}

function extraDays(start: string, due: string) {
  return Math.max(0, Math.round((Date.parse(`${due}T00:00:00`) - Date.parse(`${start}T00:00:00`)) / DAY_MS));
}

function orderedRange(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

function calendarToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function statusClass(status: string) {
  return status.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function isDone(status: string) {
  return /^done$/i.test(status);
}

function issueLane(issue: Issue, view: View) {
  if (view === "people") return issue.owner;
  if (view === "critical") return "critical";
  if (view === "epics") return issue.parent || issue.key;
  return issue.track;
}

function issueRange(issue: Issue): [string, string] | null {
  const start = issue.start || issue.due;
  const due = issue.due || issue.start;
  if (!start || !due) return null;
  return orderedRange(start, due);
}

function matches(issue: Issue, q: string, owner: "all" | Owner, sprint: string) {
  if (issue.sprintEpic) return false;
  if (owner !== "all" && issue.owner !== owner) return false;
  if (sprint !== "all" && issue.sprint !== sprint) return false;
  if (!q) return true;
  const hay = `${issue.key} ${issue.summary} ${issue.assignee} ${issue.status}`.toLowerCase();
  return hay.includes(q);
}

function packRows(issues: Issue[]): Map<string, number> {
  const sorted = [...issues].sort((a, b) => {
    const [as, ae] = issueRange(a) ?? ["9999-99-99", "9999-99-99"];
    const [bs, be] = issueRange(b) ?? ["9999-99-99", "9999-99-99"];
    return as.localeCompare(bs) || be.localeCompare(ae) || Number(b.critical) - Number(a.critical) || a.key.localeCompare(b.key);
  });
  const rowEnd: string[] = [];
  const rows = new Map<string, number>();
  for (const issue of sorted) {
    const range = issueRange(issue);
    if (!range) continue;
    const [start, due] = range;
    let row = rowEnd.findIndex((end) => end < start);
    if (row < 0) {
      row = rowEnd.length;
      rowEnd.push(due);
    } else {
      rowEnd[row] = due;
    }
    rows.set(issue.key, row);
  }
  return rows;
}

function dayFromPointer(e: DragEvent, days: string[]) {
  const body = (e.currentTarget as HTMLElement).classList?.contains("lane-body")
    ? (e.currentTarget as HTMLElement)
    : ((e.currentTarget as HTMLElement).closest(".lane-body") as HTMLElement | null);
  if (!body || !days.length) return days[0];
  const rect = body.getBoundingClientRect();
  const ratio = rect.width <= 0 ? 0 : (e.clientX - rect.left) / rect.width;
  const i = Math.max(0, Math.min(days.length - 1, Math.floor(ratio * days.length)));
  return days[i];
}

function previewRange(meta: DragMeta, hover: string): [string, string] {
  if (meta.mode === "due") return orderedRange(meta.start, hover);
  if (meta.mode === "start") return orderedRange(hover, meta.due);
  const extra = extraDays(meta.start, meta.due);
  let start = hover;
  let due = addDays(hover, extra);
  if (due > plan.clockEnd) {
    due = plan.clockEnd;
    start = clampDay(addDays(due, -extra));
  }
  if (start < plan.clockStart) {
    start = plan.clockStart;
    due = clampDay(addDays(start, extra));
  }
  return [start, due];
}

export default function App() {
  const today = calendarToday();
  const days = useMemo(() => eachDay(plan.clockStart, plan.clockEnd), []);
  const dayIndex = useMemo(() => new Map(days.map((d, i) => [d, i])), [days]);
  const [items, setItems] = useState<Issue[]>(() => structuredClone(plan.issues) as Issue[]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [view, setView] = useState<View>("tracks");
  const [owner, setOwner] = useState<"all" | Owner>("all");
  const [sprint, setSprint] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Issue | null>(null);
  const [expand, setExpand] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dropRange, setDropRange] = useState<DropRange | null>(null);
  const [statusSync, setStatusSync] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const dragged = useRef(false);
  const dragMeta = useRef<DragMeta | null>(null);

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
      return [{ id: "critical", name: "Critical path", hint: "Drag across days to span" }];
    }
    return plan.tracks;
  }, [view, items]);

  const byLane = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of visible) {
      if (!issueRange(issue)) continue;
      const lane = issueLane(issue, view);
      const arr = map.get(lane) ?? [];
      arr.push(issue);
      map.set(lane, arr);
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

  async function refreshStatuses() {
    setStatusSync("loading");
    try {
      const live = await loadJiraStatuses();
      const byKey = new Map(live.map((row) => [row.key, row.status]));
      setItems((prev) => prev.map((issue) => (byKey.has(issue.key) ? { ...issue, status: byKey.get(issue.key) as string } : issue)));
      setSelected((cur) => (cur && byKey.has(cur.key) ? { ...cur, status: byKey.get(cur.key) as string } : cur));
      setStatusSync("ok");
    } catch (err) {
      setStatusSync("error");
      flash(err instanceof Error ? err.message : "Could not load Jira statuses");
    }
  }

  useEffect(() => {
    void refreshStatuses();
  }, []);

  async function commitRange(key: string, nextStart: string, nextDue: string, nextOwner?: Owner) {
    const current = itemsRef.current.find((i) => i.key === key);
    if (!current || current.sprintEpic) return;
    let start = clampDay(nextStart);
    let due = clampDay(nextDue);
    [start, due] = orderedRange(start, due);
    const sameDates = (current.start || current.due) === start && (current.due || current.start) === due;
    const sameOwner = !nextOwner || nextOwner === current.owner;
    if (sameDates && sameOwner) return;

    const prev = {
      start: current.start,
      due: current.due,
      owner: current.owner,
      assignee: current.assignee,
      sprint: current.sprint,
    };
    const nextSprint = sprintFor(start);
    const ownerPatch =
      nextOwner === "lewis" || nextOwner === "alok"
        ? { owner: nextOwner, assignee: nextOwner === "lewis" ? LEWIS_NAME : ALOK_NAME }
        : {};
    applyLocal(key, { start, due, sprint: nextSprint, ...ownerPatch });
    setBusy(key);
    try {
      await updateJiraIssue({
        key,
        start,
        due,
        owner: nextOwner === "lewis" || nextOwner === "alok" ? nextOwner : undefined,
      });
      const label = start === due ? `${start.slice(8)} Sep` : `${start.slice(8)}–${due.slice(8)} Sep`;
      const bits = [`${key} → ${label}`];
      if (nextOwner) bits.push(nextOwner === "lewis" ? "Lewis" : "Alok");
      flash(`${bits.join(" · ")} · Jira updated`);
    } catch (err) {
      applyLocal(key, prev);
      flash(err instanceof Error ? err.message : "Jira update failed");
    } finally {
      setBusy(null);
      setDropRange(null);
      dragMeta.current = null;
    }
  }

  async function commitDone(key: string) {
    const current = itemsRef.current.find((i) => i.key === key);
    if (!current || current.sprintEpic || isDone(current.status)) return;
    const prev = current.status;
    applyLocal(key, { status: "Done" });
    setBusy(key);
    try {
      const json = await updateJiraIssue({ key, action: "done" });
      applyLocal(key, { status: json.status || "Done" });
      flash(`${key} marked Done · Jira updated`);
    } catch (err) {
      applyLocal(key, { status: prev });
      flash(err instanceof Error ? err.message : "Jira Done update failed");
    } finally {
      setBusy(null);
    }
  }

  function onDragOverCell(day: string, laneId: string) {
    return (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const meta = dragMeta.current;
      if (!meta) {
        setDropRange({ laneId, from: day, to: day });
        return;
      }
      const [from, to] = previewRange(meta, day);
      setDropRange({ laneId, from, to });
    };
  }

  function onDropCell(day: string, laneId: string) {
    return async (e: DragEvent) => {
      e.preventDefault();
      const key = e.dataTransfer.getData("text/pgl-key") || e.dataTransfer.getData("text/plain");
      const mode = (e.dataTransfer.getData("text/pgl-mode") || "move") as DragMode;
      setDropRange(null);
      if (!key) return;
      const current = itemsRef.current.find((i) => i.key === key);
      if (!current) return;
      const origStart = current.start || current.due || day;
      const origDue = current.due || current.start || day;
      const [start, due] = previewRange({ key, mode, start: origStart, due: origDue }, day);
      const nextOwner = view === "people" && (laneId === "lewis" || laneId === "alok") ? laneId : undefined;
      await commitRange(key, start, due, nextOwner);
    };
  }

  return (
    <div className="page">
      <header className="top">
        <div>
          <p className="kicker">Surf Local · Production go-live</p>
          <h1>{plan.title}</h1>
          <p className="sub">
            Drag a pill to move it. Drag either edge across days to set Start and Due. In People view, drop onto
            Lewis or Alok to reassign. Filters do not write Jira.
          </p>
        </div>
        <div className="links">
          <span className={`ok ${statusSync === "ok" ? "on" : ""}`}>
            {statusSync === "loading" ? "Syncing Jira…" : statusSync === "ok" ? "Jira live" : statusSync === "error" ? "Jira sync failed" : "Jira"}
          </span>
          <button type="button" onClick={() => void refreshStatuses()} disabled={statusSync === "loading"}>
            Refresh statuses
          </button>
          <a href={plan.jira} target="_blank" rel="noreferrer">
            PGL board
          </a>
          <a href={plan.confluence} target="_blank" rel="noreferrer">
            Confluence plan
          </a>
        </div>
      </header>

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
        <span className="chip lewis tiny">
          <span className="chip-key">Lewis</span>
          <span className="chip-title">title</span>
          <span className="chip-st">status</span>
        </span>
        <span className="chip alok tiny">
          <span className="chip-key">Alok</span>
          <span className="chip-title">title</span>
          <span className="chip-st">status</span>
        </span>
        <span className="chip lewis tiny critical">
          <span className="chip-key">Critical</span>
          <span className="chip-st">gold ring</span>
        </span>
        <span>Drag the pill to move. Drag the left or right edge across days to span Start → Due.</span>
      </div>

      <div className="scroller">
        <div className="chart" style={{ gridTemplateColumns: `168px repeat(${days.length}, minmax(96px, 1fr))` }}>
          <div className="corner sticky">Track</div>
          {days.map((d) => (
            <div
              key={d}
              className={`head sticky weekend-${isWeekend(d)} today-${d === today} sprint-${sprintFor(d)}`}
            >
              <span>{weekday(d)}</span>
              <strong>{dayNum(d)}</strong>
              {d === today && <em>today</em>}
            </div>
          ))}

          {lanes.map((lane) => (
            <Lane
              key={lane.id}
              lane={lane}
              days={days}
              dayIndex={dayIndex}
              today={today}
              issues={byLane.get(lane.id) ?? []}
              expand={expand[lane.id] ?? false}
              dropRange={dropRange}
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
              onDragMeta={(meta) => {
                dragMeta.current = meta;
              }}
              onDragOverCell={onDragOverCell}
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
              <dt>Status</dt>
              <dd className={`st-${statusClass(selected.status)}`}>{selected.status}</dd>
            </div>
            <div>
              <dt>Start</dt>
              <dd>
                <input
                  type="date"
                  min={plan.clockStart}
                  max={plan.clockEnd}
                  value={selected.start || selected.due || ""}
                  onChange={(e) => {
                    if (e.target.value) {
                      void commitRange(selected.key, e.target.value, selected.due || e.target.value);
                    }
                  }}
                />
              </dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>
                <input
                  type="date"
                  min={plan.clockStart}
                  max={plan.clockEnd}
                  value={selected.due || selected.start || ""}
                  onChange={(e) => {
                    if (e.target.value) {
                      void commitRange(selected.key, selected.start || e.target.value, e.target.value);
                    }
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
              onClick={() =>
                void commitRange(
                  selected.key,
                  selected.start || selected.due || plan.clockStart,
                  selected.due || selected.start || plan.clockStart,
                  "lewis",
                )
              }
            >
              Assign Lewis
            </button>
            <button
              type="button"
              disabled={busy === selected.key}
              onClick={() =>
                void commitRange(
                  selected.key,
                  selected.start || selected.due || plan.clockStart,
                  selected.due || selected.start || plan.clockStart,
                  "alok",
                )
              }
            >
              Assign Alok
            </button>
            <button
              type="button"
              className="done"
              disabled={busy === selected.key || isDone(selected.status)}
              onClick={() => void commitDone(selected.key)}
            >
              {isDone(selected.status) ? "Done" : "Mark as done"}
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
  dayIndex,
  today,
  issues,
  expand,
  dropRange,
  busy,
  onToggle,
  onSelect,
  onDragFlag,
  onDragMeta,
  onDragOverCell,
  onDropCell,
  selectedKey,
}: {
  lane: { id: string; name: string; hint: string };
  days: string[];
  dayIndex: Map<string, number>;
  today: string;
  issues: Issue[];
  expand: boolean;
  dropRange: DropRange | null;
  busy: string | null;
  onToggle: () => void;
  onSelect: (issue: Issue) => void;
  onDragFlag: () => void;
  onDragMeta: (meta: DragMeta) => void;
  onDragOverCell: (day: string, laneId: string) => (e: DragEvent) => void;
  onDropCell: (day: string, laneId: string) => (e: DragEvent) => void;
  selectedKey?: string;
}) {
  const rows = useMemo(() => packRows(issues), [issues]);
  const rowCount = Math.max(1, ...[...rows.values()].map((n) => n + 1), 1);
  const cap = expand ? rowCount : Math.min(rowCount, 4);
  const more = rowCount - cap;

  function beginDrag(e: DragEvent, issue: Issue, mode: DragMode) {
    onDragFlag();
    const start = issue.start || issue.due || days[0];
    const due = issue.due || issue.start || days[0];
    onDragMeta({ key: issue.key, mode, start, due });
    e.dataTransfer.setData("text/pgl-key", issue.key);
    e.dataTransfer.setData("text/pgl-mode", mode);
    e.dataTransfer.setData("text/plain", issue.key);
    e.dataTransfer.effectAllowed = "move";
  }

  return (
    <>
      <div className="lane sticky">
        <strong>{lane.name}</strong>
        <span>
          {lane.hint} · {issues.length}
        </span>
      </div>
      <div
        className="lane-body"
        style={{
          gridColumn: "2 / -1",
          gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${cap + (more > 0 ? 1 : 0)}, minmax(76px, auto))`,
        }}
        onDragOverCapture={(e) => {
          const day = dayFromPointer(e, days);
          if (day) onDragOverCell(day, lane.id)(e);
        }}
        onDropCapture={(e) => {
          const day = dayFromPointer(e, days);
          if (day) void onDropCell(day, lane.id)(e);
        }}
      >
        {days.map((d, i) => {
          const inDrop =
            dropRange?.laneId === lane.id && dropRange.from <= d && d <= dropRange.to;
          return (
            <div
              key={d}
              className={`cell weekend-${isWeekend(d)} sprint-${sprintFor(d)} today-${d === today} ${inDrop ? "drop" : ""}`}
              style={{ gridColumn: i + 1, gridRow: "1 / -1" }}
              onDragOver={onDragOverCell(d, lane.id)}
              onDrop={onDropCell(d, lane.id)}
            />
          );
        })}
        {issues.map((issue) => {
          const range = issueRange(issue);
          if (!range) return null;
          const row = rows.get(issue.key) ?? 0;
          if (row >= cap) return null;
          const startIdx = dayIndex.get(range[0] < plan.clockStart ? plan.clockStart : range[0]);
          const dueIdx = dayIndex.get(range[1] > plan.clockEnd ? plan.clockEnd : range[1]);
          if (startIdx == null || dueIdx == null) return null;
          return (
            <div
              key={issue.key}
              className="chip-wrap"
              style={{ gridColumn: `${startIdx + 1} / ${dueIdx + 2}`, gridRow: row + 1 }}
            >
              <span
                className="chip-resize"
                draggable
                title="Drag to change start"
                onDragStart={(e) => {
                  e.stopPropagation();
                  beginDrag(e, issue, "start");
                }}
              />
              <button
                draggable
                className={`chip ${issue.owner} ${issue.critical ? "critical" : ""} ${selectedKey === issue.key ? "sel" : ""} ${busy === issue.key ? "busy" : ""} ${isDone(issue.status) ? "done" : ""}`}
                title={`${issue.key} ${issue.summary} · ${issue.status} · ${range[0]} → ${range[1]}`}
                onDragStart={(e) => beginDrag(e, issue, "move")}
                onClick={() => onSelect(issue)}
              >
                <span className="chip-key">{issue.key.replace("PGL-", "")}</span>
                <span className="chip-title">{issue.summary}</span>
                <span className={`chip-st st-${statusClass(issue.status)}`}>{issue.status}</span>
              </button>
              <span
                className="chip-resize"
                draggable
                title="Drag to change due"
                onDragStart={(e) => {
                  e.stopPropagation();
                  beginDrag(e, issue, "due");
                }}
              />
            </div>
          );
        })}
        {more > 0 && (
          <button className="more span" style={{ gridColumn: "1 / -1", gridRow: cap + 1 }} onClick={onToggle}>
            +{more} more rows
          </button>
        )}
      </div>
    </>
  );
}
