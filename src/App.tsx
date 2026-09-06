import { useMemo, useState } from "react";
import plan from "./data/pgl.json";

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

const issues = plan.issues as Issue[];
const DAY_MS = 86_400_000;

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
  const [view, setView] = useState<View>("tracks");
  const [owner, setOwner] = useState<"all" | Owner>("all");
  const [sprint, setSprint] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Issue | null>(null);
  const [expand, setExpand] = useState<Record<string, boolean>>({});

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = issues.filter((i) => matches(i, q, owner, sprint));
    if (view === "critical") list = list.filter((i) => i.critical);
    if (view !== "epics") list = list.filter((i) => i.type !== "epic");
    return list;
  }, [owner, sprint, query, view]);

  const lanes = useMemo(() => {
    if (view === "people") {
      return [
        { id: "lewis", name: "Lewis", hint: "AI, email, AWS, SMS" },
        { id: "alok", name: "Alok", hint: "Everything else" },
      ];
    }
    if (view === "epics") {
      return issues
        .filter((i) => i.type === "epic" && !i.sprintEpic)
        .map((e) => ({
          id: e.key,
          name: e.summary.replace(" — ", " · ").slice(0, 36),
          hint: e.key,
        }));
    }
    if (view === "critical") {
      return [{ id: "critical", name: "Critical path", hint: "Blocks links that gate go-live" }];
    }
    return plan.tracks;
  }, [view]);

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

  return (
    <div className="page">
      <header className="top">
        <div>
          <p className="kicker">Surf Local · Production go-live</p>
          <h1>{plan.title}</h1>
          <p className="sub">
            Mon 7 Sep – Sun 27 Sep 2026 · swimlanes, not a 204-bar Jira Timeline.
            Tickets are one-day pins; sprints are the week bands.
          </p>
        </div>
        <div className="links">
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
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search PGL-109, SMS, Vault…"
        />
        <p className="meta">
          {visible.length} items · {counts.critical} on the critical path
        </p>
      </div>

      <div className="legend">
        <span className="chip lewis tiny">Lewis</span>
        <span className="chip alok tiny">Alok</span>
        <span className="chip lewis tiny critical">Critical</span>
        <span>Gold ring = Blocks chain. Click a chip for Jira.</span>
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
              onToggle={() => setExpand((e) => ({ ...e, [lane.id]: !e[lane.id] }))}
              onSelect={setSelected}
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
                {selected.start}
                {selected.due && selected.due !== selected.start ? ` → ${selected.due}` : ""}
              </dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>{selected.priority}</dd>
            </div>
          </dl>
          {selected.blockedBy.length > 0 && (
            <p>
              Blocked by {selected.blockedBy.join(", ")}
            </p>
          )}
          {selected.blocks.length > 0 && <p>Blocks {selected.blocks.join(", ")}</p>}
          <a className="jira" href={selected.url} target="_blank" rel="noreferrer">
            Open in Jira
          </a>
        </aside>
      )}
    </div>
  );
}

function Lane({
  lane,
  days,
  byLaneDay,
  expand,
  onToggle,
  onSelect,
  selectedKey,
}: {
  lane: { id: string; name: string; hint: string };
  days: string[];
  byLaneDay: Map<string, Issue[]>;
  expand: boolean;
  onToggle: () => void;
  onSelect: (issue: Issue) => void;
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
        const items = byLaneDay.get(`${lane.id}|${d}`) ?? [];
        const cap = expand ? items.length : 4;
        const shown = items.slice(0, cap);
        const more = items.length - shown.length;
        return (
          <div key={d} className={`cell weekend-${isWeekend(d)} sprint-${sprintFor(d)}`}>
            {shown.map((issue) => (
              <button
                key={issue.key}
                className={`chip ${issue.owner} ${issue.critical ? "critical" : ""} ${selectedKey === issue.key ? "sel" : ""}`}
                title={`${issue.key} ${issue.summary}`}
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
