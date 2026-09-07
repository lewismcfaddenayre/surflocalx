const JIRA = "https://surflokal.atlassian.net";
const START_FIELD = "customfield_10015";
const KEY_RE = /^PGL-\d+$/;
const LEWIS = "712020:2f293e75-b704-4d2e-a459-a0ee035ecc92";
const ALOK = "712020:87fcff65-f8a7-4c99-a7c8-7b06fc2ccdc7";

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

export async function handleJiraRequest({ method, body, authorization }) {
  if (method === "OPTIONS") return { status: 204, json: {} };
  if (method !== "POST") return { status: 405, json: { error: "POST only" } };

  if (!authorization?.startsWith("Basic ")) {
    return { status: 401, json: { error: "Connect Jira: missing credentials" } };
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

  const key = String(payload.key || "").toUpperCase();
  if (!KEY_RE.test(key)) return { status: 400, json: { error: "Only PGL issues can be moved" } };

  const start = payload.start ? String(payload.start) : null;
  const due = payload.due ? String(payload.due) : start;
  const owner = payload.owner === "lewis" || payload.owner === "alok" ? payload.owner : null;

  if (!start && !due && !owner) {
    return { status: 400, json: { error: "Nothing to update" } };
  }

  const headers = {
    Authorization: authorization,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const got = await fetch(`${JIRA}/rest/api/3/issue/${key}?fields=labels,assignee,${START_FIELD},duedate`, {
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
    },
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  let body = req.body;
  if (body == null) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks).toString("utf8");
  }

  const result = await handleJiraRequest({
    method: req.method || "POST",
    body,
    authorization: req.headers.authorization || "",
  });
  res.status(result.status).json(result.json);
}
