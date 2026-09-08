import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export const maxDuration = 60;

const CURSOR = "https://api.cursor.com";
const AGENT_RE = /^bc-[a-z0-9-]+$/i;
const RUN_RE = /^run-[a-z0-9-]+$/i;
const KEY_RE = /^PGL-\d+$/i;
const SPRINT_EPICS = new Set(["PGL-202", "PGL-203", "PGL-204"]);
const CLOCK = { start: "2026-09-07", end: "2026-09-27" };
const DONE = new Set(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]);
const FAST_MODEL = {
  id: process.env.CURSOR_IDEA_MODEL || "composer-2.5",
  params: [{ id: "fast", value: "true" }],
};

function loadDotEnv() {
  for (const name of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] == null) process.env[key] = val;
    }
  }
}

loadDotEnv();

function useIdeaMock() {
  return process.env.IDEA_MOCK === "1" && process.env.VERCEL !== "1";
}

function mockIdea() {
  const agentId = "bc-00000000-0000-0000-0000-000000000099";
  const runId = "run-00000000-0000-0000-0000-000000000099";
  const result = `Suggested outcome: a Task under Email to audit SMS opt-out before campaigns go out.

Parent PGL-7, Lewis, 14–16 Sep, related to PGL-209. Nothing has been written to Jira.

\`\`\`ticket
{
  "summary": "MSG Audit customer SMS opt-out before campaigns",
  "description": "Done when suppression is checked before PGL-209 sends. Relates to the campaign SMS work.",
  "owner": "lewis",
  "start": "2026-09-14",
  "due": "2026-09-16",
  "parent": "PGL-7",
  "priority": "High",
  "labels": ["go-live","three-week-plan"],
  "related": ["PGL-209"]
}
\`\`\``;
  return { agentId, runId, result };
}

function cursorHeaders() {
  const key = process.env.CURSOR_API_KEY || "";
  if (!key) return null;
  return {
    Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

export function pickCatalog(idea, raw) {
  const list = Array.isArray(raw) ? raw : [];
  const words = String(idea || "").toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  function score(i) {
    const hay = `${i.key || ""} ${i.summary || ""} ${i.track || ""} ${i.parent || ""}`.toLowerCase();
    let s = String(i.type || "") === "epic" ? 1 : 0;
    for (const w of words) if (hay.includes(w)) s += 2;
    return s;
  }
  return [...list].sort((a, b) => score(b) - score(a)).slice(0, 80);
}

function compactCatalog(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((i) => {
      const key = String(i.key || "").slice(0, 12);
      const summary = String(i.summary || "").replace(/\s+/g, " ").slice(0, 70);
      const parent = i.parent ? ` ${i.parent}` : "";
      const track = i.track ? ` [${i.track}]` : "";
      const when = i.start || i.due ? ` ${i.start || i.due}${i.due && i.due !== i.start ? "→" + i.due : ""}` : "";
      return `${key}${parent}${track}${when} ${summary}`.trim();
    })
    .join("\n");
}

function isoDate(value) {
  const s = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export function stripTicket(text) {
  return String(text || "")
    .replace(/```(?:ticket|json)\s*[\s\S]*?```/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseTicket(text) {
  const src = String(text || "");
  const fenced = src.match(/```(?:ticket|json)\s*([\s\S]*?)```/i);
  const blob = fenced ? fenced[1] : src.match(/\{[\s\S]*"summary"[\s\S]*\}/)?.[0];
  if (!blob) return null;
  try {
    const json = JSON.parse(blob);
    const summary = String(json.summary || "").trim();
    if (summary.length < 8) return null;
    const owner = json.owner === "lewis" || json.owner === "alok" ? json.owner : null;
    const parentRaw = String(json.parent || "").toUpperCase();
    const parent = KEY_RE.test(parentRaw) && !SPRINT_EPICS.has(parentRaw) ? parentRaw : null;
    const related = Array.isArray(json.related)
      ? json.related.map((k) => String(k).toUpperCase()).filter((k) => KEY_RE.test(k)).slice(0, 12)
      : [];
    const priority = /^(Highest|High|Medium|Low|Lowest)$/.test(String(json.priority || ""))
      ? String(json.priority)
      : "Medium";
    return {
      summary: summary.slice(0, 255),
      description: String(json.description || summary).slice(0, 8000),
      owner,
      start: isoDate(json.start),
      due: isoDate(json.due) || isoDate(json.start),
      parent,
      priority,
      labels: Array.isArray(json.labels) ? json.labels.map(String).slice(0, 12) : [],
      related,
    };
  } catch {
    return null;
  }
}

function scopingPrompt({ idea, catalog }) {
  const board = compactCatalog(pickCatalog(idea, catalog));
  return `You are scoping an idea for the SurfLocal (SLX) Production-Go-Live board (Jira project PGL).

This is a planning conversation only. Do not write application code, do not edit files, and do not create a Jira issue yourself. The dashboard will create the ticket only after the human confirms your suggested outcome.

Clock: ${CLOCK.start} to ${CLOCK.end} (Sprint 1 7–13 Sep, Sprint 2 14–20 Sep, Sprint 3 21–27 Sep 2026).
People: Lewis McFadden (lewis), Alok Ranjan (alok).
Epics include PGL-1..PGL-25 (tracks), PGL-202/203/204 (week epics — do not parent new work on those).

Closest existing PGL work (do not duplicate; relate if overlapping):
${board || "(catalog empty)"}

Human idea:
${String(idea || "").slice(0, 4000)}

Process:
1. Ingest the idea. If it is too vague, ask at most 2–3 follow-up questions (who, when, which surface, overlap with an existing key).
2. When you can scope it, SUGGEST THE OUTCOME before any Jira write: a concrete PGL Task preview.
3. End that message with a fenced ticket block the dashboard can parse. Use this exact fence:

\`\`\`ticket
{
  "summary": "short action-oriented title",
  "description": "markdown: context, done-when, related keys",
  "owner": "lewis" or "alok" or null,
  "start": "YYYY-MM-DD" or null,
  "due": "YYYY-MM-DD" or null,
  "parent": "PGL-n" or null,
  "priority": "High" or "Medium",
  "labels": ["go-live","three-week-plan"],
  "related": ["PGL-123"]
}
\`\`\`

Keep the chat reply human: first the suggested outcome in plain language, then the ticket block. If they ask to change dates or owner, revise the suggestion and emit a new ticket block. Never claim the Jira issue already exists. Be concise.`;
}

async function cursorFetch(path, { method = "GET", body, timeoutMs } = {}) {
  const headers = cursorHeaders();
  if (!headers) return { status: 503, json: { error: "Cursor API key is not configured on the server" } };
  const ms = timeoutMs ?? (Number(process.env.IDEA_CURSOR_TIMEOUT_MS) || 8000);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(`${CURSOR}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    const text = await res.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { error: text.slice(0, 400) };
    }
    if (!res.ok) {
      return {
        status: res.status,
        json: { error: json.message || json.error || `Cursor ${res.status}`, detail: text.slice(0, 400) },
      };
    }
    return { status: res.status, json };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { status: 504, json: { error: "Cursor timed out. Try scoping again." } };
    }
    return { status: 502, json: { error: "Could not reach Cursor" } };
  } finally {
    clearTimeout(timer);
  }
}

export async function handleIdeaRequest({ method, body }) {
  if (method === "OPTIONS") return { status: 204, json: {} };
  if (method !== "GET" && method !== "POST") return { status: 405, json: { error: "GET or POST only" } };

  if (!cursorHeaders() && !useIdeaMock()) {
    return { status: 503, json: { error: "Cursor API key is not configured on the server" } };
  }

  let payload = body;
  if (typeof payload === "string") {
    try {
      payload = payload ? JSON.parse(payload) : {};
    } catch {
      return { status: 400, json: { error: "Invalid JSON" } };
    }
  }
  payload = payload || {};

  if (useIdeaMock()) {
    const mock = mockIdea();
    if (method === "GET" || payload.action === "status") {
      return {
        status: 200,
        json: {
          agentId: mock.agentId,
          runId: mock.runId,
          status: "FINISHED",
          done: true,
          reply: stripTicket(mock.result),
          suggestion: parseTicket(mock.result),
        },
      };
    }
    const mockText = String(payload.text || "").trim();
    if (mockText.length < 3) return { status: 400, json: { error: "Say what you want to add to SLX" } };
    return { status: 200, json: { agentId: mock.agentId, runId: mock.runId, status: "CREATING" } };
  }

  if (method === "GET" || payload.action === "status") {
    const agentId = String(payload.agentId || "").trim();
    const runId = String(payload.runId || "").trim();
    if (!AGENT_RE.test(agentId) || !RUN_RE.test(runId)) {
      return { status: 400, json: { error: "Missing agent or run" } };
    }
    const got = await cursorFetch(`/v1/agents/${agentId}/runs/${runId}`);
    if (got.status >= 400) return got;
    const result = got.json.result || got.json.text || "";
    const runStatus = String(got.json.status || "UNKNOWN").toUpperCase();
    return {
      status: 200,
      json: {
        agentId,
        runId,
        status: runStatus,
        done: DONE.has(runStatus),
        reply: stripTicket(result),
        suggestion: parseTicket(result),
      },
    };
  }

  const action = payload.action || "start";
  const text = String(payload.text || "").trim();
  if (text.length < 3) return { status: 400, json: { error: "Say what you want to add to SLX" } };

  if (action === "followup") {
    const agentId = String(payload.agentId || "").trim();
    if (!AGENT_RE.test(agentId)) return { status: 400, json: { error: "Missing chat session" } };
    const run = await cursorFetch(`/v1/agents/${agentId}/runs`, {
      method: "POST",
      body: { prompt: { text: text.slice(0, 4000) }, mode: "plan", model: FAST_MODEL },
    });
    if (run.status >= 400) return run;
    const runId = run.json.run?.id || run.json.id;
    if (!runId) return { status: 502, json: { error: "Cursor did not start a follow-up" } };
    return { status: 200, json: { agentId, runId, status: run.json.run?.status || run.json.status || "CREATING" } };
  }

  const started = await cursorFetch("/v1/agents", {
    method: "POST",
    body: {
      name: `PGL idea ${new Date().toISOString().slice(0, 16)}`,
      mode: "plan",
      model: FAST_MODEL,
      prompt: { text: scopingPrompt({ idea: text, catalog: pickCatalog(text, payload.catalog) }) },
    },
  });
  if (started.status >= 400) return started;
  const agentId = started.json.agent?.id || started.json.id;
  const runId = started.json.run?.id || started.json.latestRunId || started.json.agent?.latestRunId;
  if (!agentId || !runId) {
    return { status: 502, json: { error: "Cursor did not start a chat session" } };
  }
  return { status: 200, json: { agentId, runId, status: started.json.run?.status || "CREATING" } };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  let body = req.body;
  if (body == null && req.method !== "GET" && req.method !== "OPTIONS") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks).toString("utf8");
  } else if (req.method === "GET") {
    const url = new URL(req.url || "/", "http://localhost");
    body = JSON.stringify({
      action: "status",
      agentId: url.searchParams.get("agentId"),
      runId: url.searchParams.get("runId"),
    });
  }

  const result = await handleIdeaRequest({
    method: req.method || "POST",
    body,
  });
  res.setHeader("Cache-Control", "no-store");
  res.status(result.status).json(result.json);
}
