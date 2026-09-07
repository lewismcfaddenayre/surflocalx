import { handleJiraRequest, sprintLabel } from "../api/jira.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(sprintLabel("2026-09-07") === "pgl-sprint-1", "week 1");
assert(sprintLabel("2026-09-14") === "pgl-sprint-2", "week 2");
assert(sprintLabel("2026-09-21") === "pgl-sprint-3", "week 3");

delete process.env.JIRA_API_TOKEN;
const missing = await handleJiraRequest({ method: "GET", body: "" });
assert(missing.status === 503, "token required");

process.env.JIRA_EMAIL = "lewis@surflocalexchange.com";
process.env.JIRA_API_TOKEN = "test-token";

const method = await handleJiraRequest({ method: "PUT", body: "{}" });
assert(method.status === 405, "GET or POST only");

const badKey = await handleJiraRequest({
  method: "POST",
  body: '{"key":"ABC-1","start":"2026-09-08"}',
});
assert(badKey.status === 400 && /PGL/.test(badKey.json.error), "PGL only");

const empty = await handleJiraRequest({
  method: "POST",
  body: '{"key":"PGL-1"}',
});
assert(empty.status === 400, "nothing to update");

let fetches = 0;
globalThis.fetch = async (url, init) => {
  fetches += 1;
  if (String(url).includes("search/jql")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        isLast: true,
        issues: [{ key: "PGL-109", fields: { status: { name: "In Progress" } } }],
      }),
      text: async () => "",
    };
  }
  if (String(url).includes("/transitions")) {
    if (init?.method === "POST") {
      assert(JSON.parse(init.body).transition.id === "41", "done transition id");
      return { ok: true, status: 204, json: async () => ({}), text: async () => "" };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        transitions: [{ id: "41", name: "Done", to: { name: "Done", statusCategory: { key: "done" } }, isAvailable: true }],
      }),
      text: async () => "",
    };
  }
  if (String(url).includes("fields=status") && !String(url).includes("labels")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        fields: { status: { name: "In Progress", statusCategory: { key: "indeterminate" } } },
      }),
      text: async () => "",
    };
  }
  if (String(url).includes("fields=")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ fields: { labels: ["keep-me", "pgl-sprint-1"], status: { name: "Backlog" } } }),
      text: async () => "",
    };
  }
  assert(init?.method === "PUT", "PUT update");
  const body = JSON.parse(init.body);
  assert(body.fields.customfield_10015 === "2026-09-16", "start field");
  assert(body.fields.duedate === "2026-09-16" || body.fields.duedate === "2026-09-18", "due field");
  assert(body.fields.labels.includes("pgl-sprint-2"), "sprint 2 label");
  assert(!body.fields.labels.includes("pgl-sprint-1"), "old sprint label removed");
  assert(body.fields.labels.includes("keep-me"), "other labels kept");
  assert(body.fields.assignee.accountId === "712020:2f293e75-b704-4d2e-a459-a0ee035ecc92", "Lewis");
  return { ok: true, status: 204, json: async () => ({}), text: async () => "" };
};

const listed = await handleJiraRequest({ method: "GET", body: "" });
assert(listed.status === 200, "status list");
assert(listed.json.issues[0].status === "In Progress", "live status");

const ok = await handleJiraRequest({
  method: "POST",
  body: JSON.stringify({ key: "PGL-109", start: "2026-09-16", due: "2026-09-16", owner: "lewis" }),
});
assert(ok.status === 200, "success");
assert(ok.json.sprint === "2", "sprint id");

const okSpan = await handleJiraRequest({
  method: "POST",
  body: JSON.stringify({ key: "PGL-109", start: "2026-09-16", due: "2026-09-18", owner: "lewis" }),
});
assert(okSpan.status === 200, "span success");
assert(okSpan.json.start === "2026-09-16", "span start");
assert(okSpan.json.due === "2026-09-18", "span due");

const marked = await handleJiraRequest({
  method: "POST",
  body: JSON.stringify({ key: "PGL-109", action: "done" }),
});
assert(marked.status === 200, "done success");
assert(marked.json.status === "Done", "done status");

let alreadyFetches = 0;
globalThis.fetch = async (url, init) => {
  alreadyFetches += 1;
  assert(!String(url).includes("/transitions") || init?.method !== "POST", "skip Done when already done");
  return {
    ok: true,
    status: 200,
    json: async () => ({ fields: { status: { name: "Done", statusCategory: { key: "done" } } } }),
    text: async () => "",
  };
};
const already = await handleJiraRequest({
  method: "POST",
  body: JSON.stringify({ key: "PGL-109", action: "done" }),
});
assert(already.status === 200 && already.json.status === "Done", "already done");
assert(alreadyFetches === 1, "already done reads once");

globalThis.fetch = async (url) => {
  if (String(url).includes("/transitions")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ transitions: [{ id: "21", name: "In Progress", to: { name: "In Progress" } }] }),
      text: async () => "",
    };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ fields: { status: { name: "Backlog", statusCategory: { key: "new" } } } }),
    text: async () => "",
  };
};
const blocked = await handleJiraRequest({
  method: "POST",
  body: JSON.stringify({ key: "PGL-1", action: "done" }),
});
assert(blocked.status === 409, "no Done transition");

console.log("jira proxy tests ok");
