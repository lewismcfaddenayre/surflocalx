import { handleJiraRequest, sprintLabel } from "../api/jira.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(sprintLabel("2026-09-07") === "pgl-sprint-1", "week 1");
assert(sprintLabel("2026-09-14") === "pgl-sprint-2", "week 2");
assert(sprintLabel("2026-09-21") === "pgl-sprint-3", "week 3");

const method = await handleJiraRequest({ method: "GET", body: "{}", authorization: "Basic abc" });
assert(method.status === 405, "POST only");

const unauth = await handleJiraRequest({ method: "POST", body: '{"key":"PGL-1"}', authorization: "" });
assert(unauth.status === 401, "needs Basic auth");

const badKey = await handleJiraRequest({
  method: "POST",
  body: '{"key":"ABC-1","start":"2026-09-08"}',
  authorization: "Basic dGVzdDp0b2tlbg==",
});
assert(badKey.status === 400 && /PGL/.test(badKey.json.error), "PGL only");

const empty = await handleJiraRequest({
  method: "POST",
  body: '{"key":"PGL-1"}',
  authorization: "Basic dGVzdDp0b2tlbg==",
});
assert(empty.status === 400, "nothing to update");

let fetches = 0;
globalThis.fetch = async (url, init) => {
  fetches += 1;
  if (String(url).includes("fields=")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ fields: { labels: ["keep-me", "pgl-sprint-1"] } }),
      text: async () => "",
    };
  }
  assert(init?.method === "PUT", "PUT update");
  const body = JSON.parse(init.body);
  assert(body.fields.customfield_10015 === "2026-09-16", "start field");
  assert(body.fields.duedate === "2026-09-16", "due field");
  assert(body.fields.labels.includes("pgl-sprint-2"), "sprint 2 label");
  assert(!body.fields.labels.includes("pgl-sprint-1"), "old sprint label removed");
  assert(body.fields.labels.includes("keep-me"), "other labels kept");
  assert(body.fields.assignee.accountId === "712020:2f293e75-b704-4d2e-a459-a0ee035ecc92", "Lewis");
  return { ok: true, status: 204, json: async () => ({}), text: async () => "" };
};

const ok = await handleJiraRequest({
  method: "POST",
  body: JSON.stringify({ key: "PGL-109", start: "2026-09-16", due: "2026-09-16", owner: "lewis" }),
  authorization: "Basic dGVzdDp0b2tlbg==",
});
assert(ok.status === 200, "success");
assert(ok.json.sprint === "2", "sprint id");
assert(fetches === 2, "read then write");

console.log("jira proxy tests ok");
