import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { CRITICAL_KEYS, EPIC_TRACK, SPRINT_EPICS, TRACK_BY_KEY } from "./pgl-hints.js";

const JIRA = "https://surflokal.atlassian.net";
const START_FIELD = "customfield_10015";
const KEY_RE = /^PGL-\d+$/;
const LEWIS = "712020:2f293e75-b704-4d2e-a459-a0ee035ecc92";
const ALOK = "712020:87fcff65-f8a7-4c99-a7c8-7b06fc2ccdc7";
const TRACK_IDS = new Set(["mls", "funnel", "email", "ai", "vault", "launch", "product"]);
const SPRINT_EPIC_SET = new Set(SPRINT_EPICS);
const CRITICAL_SET = new Set(CRITICAL_KEYS);
const ISSUE_FIELDS = [
  "summary",
  "issuetype",
  "parent",
  START_FIELD,
  "duedate",
  "assignee",
  "labels",
  "priority",
  "status",
  "issuelinks",
];
const TRACK_KEYWORDS = [
  [/\b(mls|idx|stellar|co-list|listing feed)\b/i, "mls"],
  [/\b(email|sms|10dlc|right to send|suppression)\b/i, "email"],
  [/\b(cynthia|model isolation|profiling)\b/i, "ai"],
  [/\b(vault|surfscore|surf score)\b/i, "vault"],
  [/\b(funnel|fusion|partnerresolver|deal room|optimal blue|marketplace|loan.?officer)\b/i, "funnel"],
  [/\b(aws|app store|legal web|nmls|dmca|enumeration)\b/i, "launch"],
  [/\b(agent app|consumer app|property details)\b/i, "product"],
];

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

function sprintFromLabels(labels, iso) {
  const found = (labels || []).map((l) => String(l).match(/^pgl-sprint-([123])$/)).find(Boolean);
  if (found) return found[1];
  return sprintId(iso);
}

function ownerFromAssignee(assignee) {
  const accountId = assignee?.accountId || "";
  if (accountId === LEWIS) return { owner: "lewis", assignee: assignee.displayName || "Lewis McFadden" };
  if (accountId === ALOK) return { owner: "alok", assignee: assignee.displayName || "Alok Ranjan" };
  return { owner: "other", assignee: assignee?.displayName || "Unassigned" };
}

function trackFromText(summary, labels) {
  for (const label of labels || []) {
    const id = String(label).replace(/^pgl-track-/, "");
    if (TRACK_IDS.has(id)) return id;
  }
  const hay = String(summary || "");
  for (const [re, id] of TRACK_KEYWORDS) {
    if (re.test(hay)) return id;
  }
  return null;
}

function inferTrack(key, parent, summary, labels) {
  if (TRACK_BY_KEY[key]) return TRACK_BY_KEY[key];
  if (parent && (TRACK_BY_KEY[parent] || EPIC_TRACK[parent])) return TRACK_BY_KEY[parent] || EPIC_TRACK[parent];
  return trackFromText(summary, labels) || EPIC_TRACK[key] || "other";
}

function linkKeys(links, side) {
  const out = [];
  for (const link of links || []) {
    const name = String(link.type?.name || "");
    const inward = String(link.type?.inward || "");
    const outward = String(link.type?.outward || "");
    if (!/block/i.test(`${name} ${inward} ${outward}`)) continue;
    const key = side === "blocks" ? link.outwardIssue?.key : link.inwardIssue?.key;
    if (key) out.push(key);
  }
  return out;
}

export function mapJiraIssue(issue) {
  const fields = issue.fields || {};
  const key = issue.key;
  const labels = fields.labels || [];
  const start = fields[START_FIELD] || null;
  const due = fields.duedate || null;
  const parent = fields.parent?.key || null;
  const people = ownerFromAssignee(fields.assignee);
  const sprintEpic = SPRINT_EPIC_SET.has(key);
  const known = Object.prototype.hasOwnProperty.call(TRACK_BY_KEY, key);
  return {
    key,
    summary: fields.summary || key,
    type: String(fields.issuetype?.name || "story").toLowerCase(),
    parent,
    start,
    due,
    owner: people.owner,
    assignee: people.assignee,
    sprint: sprintFromLabels(labels, start || due),
    track: inferTrack(key, parent, fields.summary, labels),
    priority: fields.priority?.name || "Medium",
    status: fields.status?.name || "Unknown",
    blocks: linkKeys(fields.issuelinks, "blocks"),
    blockedBy: linkKeys(fields.issuelinks, "blockedBy"),
    critical: known ? CRITICAL_SET.has(key) : !sprintEpic && /^highest$/i.test(fields.priority?.name || ""),
    sprintEpic,
    url: `${JIRA}/browse/${key}`,
  };
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

async function listIssues(headers) {
  const issues = [];
  let nextPageToken;
  do {
    const body = { jql: "project = PGL ORDER BY key", fields: ISSUE_FIELDS, maxResults: 100 };
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
    for (const issue of data.issues || []) issues.push(mapJiraIssue(issue));
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
    const listed = await listIssues(headers);
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
