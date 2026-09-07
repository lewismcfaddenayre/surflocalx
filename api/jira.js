import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const JIRA = "https://surflokal.atlassian.net";
const START_FIELD = "customfield_10015";
const KEY_RE = /^PGL-\d+$/;
const LEWIS = "712020:2f293e75-b704-4d2e-a459-a0ee035ecc92";
const ALOK = "712020:87fcff65-f8a7-4c99-a7c8-7b06fc2ccdc7";

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

export function sprintLabel(iso) {
  if (!iso) return null;
  if (iso <= "2026-09-13") return "pgl-sprint-1";
  if (iso <= "2026-09-20") return "pgl-sprint-2";
  if (iso <= "2026-09-27") return "pgl-sprint-3";
  return null;
}

function sprintId(iso) {
  const label = sprintLabel(iso);
  return label ? label.slice(-1) : "";
}

function jiraHeaders() {
  const email = process.env.JIRA_EMAIL || "lewis@surflocalexchange.com";
  const token = process.env.JIRA_API_TOKEN || "";
  if (!token) return null;
  return {
    Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function listStatuses(headers) {
  const issues = [];
  let nextPageToken;
  do {
    const body = { jql: "project = PGL ORDER BY key", fields: ["status"], maxResults: 100 };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const res = await fetch(`${JIRA}/rest/api/3/search/jql`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      return { errorStatus: res.status, detail: text.slice(0, 400) };
    }
    const data = await res.json();
    for (const issue of data.issues || []) {
      issues.push({ key: issue.key, status: issue.fields?.status?.name || "Unknown" });
    }
    nextPageToken = data.isLast ? null : data.nextPageToken;
  } while (nextPageToken);
  return { issues };
}

function isDoneStatus(name, category) {
  return /^done$/i.test(String(name || "")) || category === "done";
}

function isProgressStatus(name) {
  return /^in progress$/i.test(String(name || ""));
}

function pickTransition(transitions, action) {
  const list = (transitions || []).filter((t) => t.isAvailable !== false);
  if (action === "done") {
    return list.find(
      (t) => /^done$/i.test(t.to?.name || "") || t.to?.statusCategory?.key === "done" || /^done$/i.test(t.name || ""),
    );
  }
  return list.find((t) => /^in progress$/i.test(t.to?.name || "") || /^in progress$/i.test(t.name || ""));
}

async function transitionIssue(headers, key, action) {
  const wantDone = action === "done";
  const label = wantDone ? "Done" : "In Progress";
  const got = await fetch(`${JIRA}/rest/api/3/issue/${key}?fields=status`, { headers });
  if (!got.ok) {
    const text = await got.text();
    return { status: got.status, json: { error: `Jira read failed (${got.status})`, detail: text.slice(0, 400) } };
  }
  const issue = await got.json();
  const current = issue.fields?.status?.name || "";
  const category = issue.fields?.status?.statusCategory?.key;
  if (wantDone ? isDoneStatus(current, category) : isProgressStatus(current)) {
    return { status: 200, json: { key, status: current || label } };
  }

  const listed = await fetch(`${JIRA}/rest/api/3/issue/${key}/transitions`, { headers });
  if (!listed.ok) {
    const text = await listed.text();
    return { status: listed.status, json: { error: `Jira transitions failed (${listed.status})`, detail: text.slice(0, 400) } };
  }
  const data = await listed.json();
  const picked = pickTransition(data.transitions, action);
  if (!picked) {
    return { status: 409, json: { error: `No ${label} transition is available for this issue` } };
  }

  const posted = await fetch(`${JIRA}/rest/api/3/issue/${key}/transitions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ transition: { id: picked.id } }),
  });
  if (!posted.ok) {
    const text = await posted.text();
    return { status: posted.status, json: { error: `Jira ${label} update failed (${posted.status})`, detail: text.slice(0, 400) } };
  }

  return { status: 200, json: { key, status: picked.to?.name || label } };
}

export async function handleJiraRequest({ method, body }) {
  if (method === "OPTIONS") return { status: 204, json: {} };

  const headers = jiraHeaders();
  if (!headers) return { status: 503, json: { error: "Jira token is not configured on the server" } };

  if (method === "GET") {
    const listed = await listStatuses(headers);
    if (listed.errorStatus) {
      return {
        status: listed.errorStatus,
        json: { error: `Jira read failed (${listed.errorStatus})`, detail: listed.detail },
      };
    }
    return { status: 200, json: { issues: listed.issues } };
  }

  if (method !== "POST") return { status: 405, json: { error: "GET or POST only" } };

  let payload = body;
  if (typeof payload === "string") {
    try {
      payload = payload ? JSON.parse(payload) : {};
    } catch {
      return { status: 400, json: { error: "Invalid JSON" } };
    }
  }
  payload = payload || {};

  const key = String(payload.key || "").toUpperCase();
  if (!KEY_RE.test(key)) return { status: 400, json: { error: "Only PGL issues can be moved" } };

  if (payload.action === "done" || payload.action === "progress") {
    return transitionIssue(headers, key, payload.action);
  }
  if (payload.action) {
    return { status: 400, json: { error: "Unknown action" } };
  }

  const start = payload.start ? String(payload.start) : null;
  const due = payload.due ? String(payload.due) : start;
  const owner = payload.owner === "lewis" || payload.owner === "alok" ? payload.owner : null;

  if (!start && !due && !owner) {
    return { status: 400, json: { error: "Nothing to update" } };
  }

  const got = await fetch(`${JIRA}/rest/api/3/issue/${key}?fields=labels,assignee,${START_FIELD},duedate,status`, {
    headers,
  });
  if (!got.ok) {
    const text = await got.text();
    return { status: got.status, json: { error: `Jira read failed (${got.status})`, detail: text.slice(0, 400) } };
  }
  const issue = await got.json();
  const labels = [...(issue.fields?.labels || [])].filter((l) => !/^pgl-sprint-[123]$/.test(l));
  const nextSprint = sprintLabel(start || due);
  if (nextSprint) labels.push(nextSprint);

  const fields = {};
  if (start) fields[START_FIELD] = start;
  if (due) fields.duedate = due;
  if (start || due) fields.labels = labels;
  if (owner === "lewis") fields.assignee = { accountId: LEWIS };
  if (owner === "alok") fields.assignee = { accountId: ALOK };

  const put = await fetch(`${JIRA}/rest/api/3/issue/${key}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ fields }),
  });
  if (!put.ok) {
    const text = await put.text();
    return { status: put.status, json: { error: `Jira update failed (${put.status})`, detail: text.slice(0, 400) } };
  }

  return {
    status: 200,
    json: {
      key,
      start: start || due,
      due: due || start,
      sprint: sprintId(start || due),
      owner,
      assignee: owner === "lewis" ? "Lewis McFadden" : owner === "alok" ? "Alok Ranjan" : undefined,
      status: issue.fields?.status?.name,
    },
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  let body = req.body;
  if (body == null && req.method !== "GET" && req.method !== "OPTIONS") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks).toString("utf8");
  }

  const result = await handleJiraRequest({
    method: req.method || "POST",
    body,
  });
  res.status(result.status).json(result.json);
}
