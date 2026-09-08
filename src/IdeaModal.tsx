import { useEffect, useRef, useState } from "react";
import { createPglIssue, type LiveIssue } from "./jira";

export type IdeaCatalogItem = {
  key: string;
  summary: string;
  parent: string | null;
  track: string;
  start: string | null;
  due: string | null;
  owner: string;
  type: string;
};

type Suggestion = {
  summary: string;
  description: string;
  owner: "lewis" | "alok" | null;
  start: string | null;
  due: string | null;
  parent: string | null;
  priority: string;
  labels: string[];
  related: string[];
};

type ChatMsg = { role: "user" | "assistant"; text: string };

type IdeaJson = {
  error?: string;
  agentId?: string;
  runId?: string;
  status?: string;
  done?: boolean;
  reply?: string;
  suggestion?: Suggestion | null;
};

const SESSION_KEY = "pgl-idea-agent";

function compactForScope(idea: string, catalog: IdeaCatalogItem[]) {
  const words = idea.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  function score(item: IdeaCatalogItem) {
    const hay = `${item.key} ${item.summary} ${item.track} ${item.parent || ""}`.toLowerCase();
    let s = item.type === "epic" ? 1 : 0;
    for (const w of words) if (hay.includes(w)) s += 2;
    return s;
  }
  return [...catalog]
    .sort((a, b) => score(b) - score(a))
    .slice(0, 80)
    .map((item) => ({
      key: item.key,
      summary: item.summary.slice(0, 80),
      parent: item.parent,
      track: item.track,
      start: item.start,
      due: item.due,
      type: item.type,
    }));
}

async function postIdea(
  payload: Record<string, unknown>,
  { signal, timeoutMs = 12000 }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<IdeaJson> {
  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort(), timeoutMs);
  const onAbort = () => ac.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch("/api/idea", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    const json = (await res.json()) as IdeaJson;
    if (!res.ok) throw new Error(json.error || `Idea ${res.status}`);
    return json;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      if (signal?.aborted) throw err;
      throw new Error("Scoping timed out. Try again.");
    }
    if (err instanceof Error && err.message) throw err;
    throw new Error("Lost the connection while scoping. Try again.");
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function pollIdea(agentId: string, runId: string, signal: AbortSignal): Promise<IdeaJson> {
  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort(), 8000);
  const onAbort = () => ac.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(`/api/idea?agentId=${encodeURIComponent(agentId)}&runId=${encodeURIComponent(runId)}`, {
      signal: ac.signal,
    });
    const json = (await res.json()) as IdeaJson;
    if (!res.ok) throw new Error(json.error || `Idea ${res.status}`);
    return json;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      if (signal.aborted) throw err;
      throw new Error("Scoping timed out. Try again.");
    }
    if (err instanceof Error && err.message) throw err;
    throw new Error("Lost the connection while scoping. Try again.");
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

async function waitForRun(agentId: string, runId: string, signal: AbortSignal): Promise<IdeaJson> {
  let lastError: Error | null = null;
  let misses = 0;
  for (let i = 0; i < 120; i += 1) {
    if (i > 0) await sleep(500, signal);
    try {
      const json = await pollIdea(agentId, runId, signal);
      misses = 0;
      const status = String(json.status || "").toUpperCase();
      if (status === "FINISHED" || json.done) return json;
      if (status === "ERROR" || status === "CANCELLED" || status === "EXPIRED") {
        throw new Error(json.reply || `Cursor ${status.toLowerCase()}`);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      misses += 1;
      lastError = err instanceof Error ? err : new Error("Could not scope this idea");
      if (misses >= 6) throw lastError;
    }
  }
  throw lastError || new Error("Cursor took too long to scope this idea");
}

async function startOrFollow(text: string, catalog: IdeaCatalogItem[], agentId: string | null, signal: AbortSignal) {
  const payload = agentId
    ? { action: "followup", agentId, text }
    : { action: "start", text, catalog: compactForScope(text, catalog) };
  try {
    return await postIdea(payload, { signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    if (agentId) {
      return await postIdea({ action: "start", text, catalog: compactForScope(text, catalog) }, { signal });
    }
    await sleep(700, signal);
    return await postIdea(payload, { signal });
  }
}

function ownerLabel(owner: Suggestion["owner"]) {
  if (owner === "lewis") return "Lewis";
  if (owner === "alok") return "Alok";
  return "Unassigned";
}

function dateLabel(start: string | null, due: string | null) {
  if (!start && !due) return "No dates yet";
  if (start && due && start !== due) return `${start} → ${due}`;
  return start || due || "No dates yet";
}

const WELCOME =
  "What do you want to add to SLX? I’ll scope it against the live PGL board and the 3-week clock, then show a suggested ticket. Nothing is written to Jira until you confirm.";

export function IdeaModal({
  catalog,
  onClose,
  onCreated,
}: {
  catalog: IdeaCatalogItem[];
  onClose: () => void;
  onCreated: (issue: LiveIssue) => void;
}) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([{ role: "assistant", text: WELCOME }]);
  const [agentId, setAgentId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  });
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState<"chat" | "create" | null>(null);
  const [created, setCreated] = useState<{ key: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, suggestion, busy, error, created]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && busy !== "create") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      abortRef.current?.abort();
    };
  }, [busy, onClose]);

  async function send() {
    const text = draft.trim();
    if (text.length < 3 || busy || created) return;
    setDraft("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", text }]);
    setBusy("chat");
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const started = await startOrFollow(text, catalog, agentId, ac.signal);
      if (!started.agentId || !started.runId) throw new Error("Cursor did not start a chat session");
      setAgentId(started.agentId);
      try {
        sessionStorage.setItem(SESSION_KEY, started.agentId);
      } catch {
        /* ignore */
      }
      const done = await waitForRun(started.agentId, started.runId, ac.signal);
      const reply = done.reply?.trim() || (done.suggestion ? "Suggested outcome is ready to confirm." : "I need a bit more to scope a ticket.");
      setMessages((prev) => [...prev, { role: "assistant", text: reply }]);
      if (done.suggestion) setSuggestion(done.suggestion);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Could not scope this idea";
      setError(msg);
      setMessages((prev) => [...prev, { role: "assistant", text: msg }]);
    } finally {
      setBusy(null);
    }
  }

  async function confirmCreate() {
    if (!suggestion || busy || created) return;
    setBusy("create");
    setError(null);
    try {
      const json = await createPglIssue(suggestion);
      setCreated({ key: json.key, url: json.url || `https://surflokal.atlassian.net/browse/${json.key}` });
      if (json.issue) onCreated(json.issue);
      else onCreated({
        key: json.key,
        summary: suggestion.summary,
        type: "task",
        parent: suggestion.parent,
        start: suggestion.start,
        due: suggestion.due,
        owner: suggestion.owner || "other",
        assignee: ownerLabel(suggestion.owner),
        sprint: "",
        track: "other",
        priority: suggestion.priority,
        status: "To Do",
        blocks: [],
        blockedBy: [],
        critical: suggestion.priority === "Highest" || suggestion.priority === "High",
        sprintEpic: false,
        url: json.url || `https://surflokal.atlassian.net/browse/${json.key}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Jira create failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="idea-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget && busy !== "create") onClose();
      }}
    >
      <div className="idea-modal" role="dialog" aria-modal="true" aria-labelledby="idea-title">
        <button className="close" type="button" onClick={onClose} disabled={busy === "create"}>
          {created ? "Close" : "Cancel"}
        </button>
        <p className="kicker">Add task</p>
        <h2 id="idea-title">What do you want to add to SLX?</h2>
        <p className="sub">Cursor suggests the outcome. Create in Jira stays off until you confirm.</p>

        <div className="idea-log" ref={logRef}>
          {messages.map((msg, i) => (
            <p key={`${msg.role}-${i}`} className={`idea-bubble ${msg.role}`}>
              {msg.text}
            </p>
          ))}
          {busy === "chat" && (
            <p className="idea-bubble assistant thinking">Scoping against the live PGL board… this should only take a few seconds.</p>
          )}
        </div>

        {suggestion && (
          <section className="idea-card">
            <p className="kicker">Suggested outcome</p>
            <h3>{suggestion.summary}</h3>
            <p className="idea-desc">{suggestion.description}</p>
            <dl>
              <div>
                <dt>Parent</dt>
                <dd>{suggestion.parent || "None"}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{ownerLabel(suggestion.owner)}</dd>
              </div>
              <div>
                <dt>Dates</dt>
                <dd>{dateLabel(suggestion.start, suggestion.due)}</dd>
              </div>
              <div>
                <dt>Priority</dt>
                <dd>{suggestion.priority}</dd>
              </div>
              {suggestion.related.length > 0 && (
                <div>
                  <dt>Related</dt>
                  <dd>{suggestion.related.join(", ")}</dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {created ? (
          <p className="idea-created">
            Created{" "}
            <a href={created.url} target="_blank" rel="noreferrer">
              {created.key}
            </a>{" "}
            in Jira.
          </p>
        ) : (
          <form
            className="idea-compose"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              ref={inputRef}
              value={draft}
              disabled={busy === "chat"}
              placeholder="e.g. Customer SMS opt-out audit before we send campaigns"
              rows={3}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="idea-actions">
              <button type="submit" disabled={busy !== null || draft.trim().length < 3}>
                {agentId ? "Revise" : "Scope idea"}
              </button>
              <button
                type="button"
                className="create"
                disabled={!suggestion || busy !== null}
                onClick={() => void confirmCreate()}
              >
                {busy === "create" ? "Creating…" : "Create in Jira"}
              </button>
            </div>
          </form>
        )}
        {error && <p className="idea-error">{error}</p>}
      </div>
    </div>
  );
}
