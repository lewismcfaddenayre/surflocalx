import { handleJiraRequest, mapJiraIssue, sprintLabel } from "../api/jira.js";

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
let searchBody;
globalThis.fetch = async (url, init) => {
  fetches += 1;
  if (String(url).includes("search/jql")) {
    searchBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        isLast: true,
        issues: [
          {
            key: "PGL-109",
            fields: {
              summary: "UAT#118 Anon MLS feed strips PII",
              issuetype: { name: "Story" },
              parent: { key: "PGL-25" },
              status: { name: "In Progress" },
              customfield_10015: "2026-09-10",
              duedate: "2026-09-12",
              assignee: {
                accountId: "712020:2f293e75-b704-4d2e-a459-a0ee035ecc92",
                displayName: "Lewis McFadden",
              },
              labels: ["pgl-sprint-1", "go-live"],
              priority: { name: "High" },
              issuelinks: [
                {
                  type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
                  inwardIssue: { key: "PGL-90" },
                },
              ],
            },
          },
        ],
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
        transitions: [
          { id: "31", name: "In Progress", to: { name: "In Progress", statusCategory: { key: "indeterminate" } }, isAvailable: true },
          { id: "41", name: "Done", to: { name: "Done", statusCategory: { key: "done" } }, isAvailable: true },
        ],
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
assert(searchBody.fields.includes("summary"), "GET asks for full issue fields");
assert(searchBody.fields.includes("parent"), "GET asks for parent");
assert(searchBody.fields.includes("issuelinks"), "GET asks for links");
assert(listed.json.issues[0].status === "In Progress", "live status");
assert(listed.json.issues[0].start === "2026-09-10", "live start");
assert(listed.json.issues[0].due === "2026-09-12", "live due");
assert(listed.json.issues[0].summary.includes("Anon MLS"), "live summary");
assert(listed.json.issues[0].parent === "PGL-25", "live parent");
assert(listed.json.issues[0].owner === "lewis", "live owner");
assert(listed.json.issues[0].track === "email", "snapshot track kept");
assert(listed.json.issues[0].sprint === "1", "sprint from label");
assert(listed.json.issues[0].blockedBy.includes("PGL-90"), "blocked-by link");
assert(listed.json.issues[0].url.includes("PGL-109"), "browse url");
assert(listed.json.issues[0].sprintEpic === false, "not a sprint epic");
assert(listed.json.issues[0].critical === true, "snapshot critical kept");

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

globalThis.fetch = async (url, init) => {
  if (String(url).includes("/transitions")) {
    if (init?.method === "POST") {
      assert(JSON.parse(init.body).transition.id === "31", "progress transition id");
      return { ok: true, status: 204, json: async () => ({}), text: async () => "" };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        transitions: [
          { id: "31", name: "In Progress", to: { name: "In Progress", statusCategory: { key: "indeterminate" } }, isAvailable: true },
          { id: "41", name: "Done", to: { name: "Done", statusCategory: { key: "done" } }, isAvailable: true },
        ],
      }),
      text: async () => "",
    };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({
      fields: { status: { name: "Backlog", statusCategory: { key: "new" } } },
    }),
    text: async () => "",
  };
};
const progressed = await handleJiraRequest({
  method: "POST",
  body: JSON.stringify({ key: "PGL-109", action: "progress" }),
});
assert(progressed.status === 200, "progress success");
assert(progressed.json.status === "In Progress", "progress status");

const unknown = await handleJiraRequest({
  method: "POST",
  body: JSON.stringify({ key: "PGL-109", action: "explode" }),
});
assert(unknown.status === 400, "unknown action");

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

let progressFetches = 0;
globalThis.fetch = async (url, init) => {
  progressFetches += 1;
  assert(!String(url).includes("/transitions") || init?.method !== "POST", "skip In Progress when already there");
  return {
    ok: true,
    status: 200,
    json: async () => ({ fields: { status: { name: "In Progress", statusCategory: { key: "indeterminate" } } } }),
    text: async () => "",
  };
};
const alreadyProgress = await handleJiraRequest({
  method: "POST",
  body: JSON.stringify({ key: "PGL-109", action: "progress" }),
});
assert(alreadyProgress.status === 200 && alreadyProgress.json.status === "In Progress", "already in progress");
assert(progressFetches === 1, "already in progress reads once");

const mapped = mapJiraIssue({
  key: "PGL-298",
  fields: {
    summary: "New Deal Room follow-up",
    issuetype: { name: "Story" },
    parent: { key: "PGL-22" },
    status: { name: "Backlog" },
    customfield_10015: "2026-09-16",
    duedate: "2026-09-16",
    assignee: { accountId: "acct-someone", displayName: "Pat" },
    labels: ["pgl-sprint-2"],
    priority: { name: "Highest" },
    issuelinks: [
      {
        type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
        outwardIssue: { key: "PGL-90" },
      },
    ],
  },
});
assert(mapped.track === "funnel", "new ticket inherits parent epic track");
assert(mapped.owner === "other", "unknown assignee is other");
assert(mapped.assignee === "Pat", "display name kept");
assert(mapped.critical === true, "new Highest is critical");
assert(mapped.sprint === "2", "sprint from label");
assert(mapped.blocks.includes("PGL-90"), "blocks link");
assert(mapped.sprintEpic === false, "new story is not a sprint epic");

const sprintEpic = mapJiraIssue({
  key: "PGL-202",
  fields: {
    summary: "Sprint 1 — Foundations",
    issuetype: { name: "Epic" },
    status: { name: "Backlog" },
    customfield_10015: "2026-09-07",
    duedate: "2026-09-13",
    assignee: {
      accountId: "712020:87fcff65-f8a7-4c99-a7c8-7b06fc2ccdc7",
      displayName: "Alok Ranjan",
    },
    labels: ["pgl-sprint-1"],
    priority: { name: "Highest" },
    issuelinks: [],
  },
});
assert(sprintEpic.sprintEpic === true, "week epic hidden from tracks");
assert(sprintEpic.critical === false, "sprint epic is not critical-path");
assert(sprintEpic.track === "launch", "sprint epic track");
assert(sprintEpic.owner === "alok", "Alok from account id");
assert(sprintEpic.type === "epic", "epic type");

const keyworded = mapJiraIssue({
  key: "PGL-299",
  fields: {
    summary: "Stand up the Vault sealed-quotes waitlist",
    issuetype: { name: "Task" },
    status: { name: "To Do" },
    labels: [],
    priority: { name: "Medium" },
    issuelinks: [],
  },
});
assert(keyworded.track === "vault", "keyword track for unknown parent");
assert(keyworded.start === null && keyworded.due === null, "dates may be empty");
assert(keyworded.critical === false, "medium is not critical");

const cynthiaAi = mapJiraIssue({
  key: "PGL-212",
  fields: {
    summary: "CYNTHIA Agent enablement: briefing, HOT alerts, draft approval queue",
    issuetype: { name: "Task" },
    parent: { key: "PGL-24" },
    status: { name: "Backlog" },
    labels: ["surface-cynthia", "pgl-sprint-3"],
    priority: { name: "High" },
    issuelinks: [],
  },
});
assert(cynthiaAi.track === "ai", "Cynthia under New Build stays on AI, not product");

const customerEmail = mapJiraIssue({
  key: "PGL-205",
  fields: {
    summary: "CYN-EMAIL Provision customer sending domains",
    issuetype: { name: "Task" },
    parent: { key: "PGL-7" },
    status: { name: "Backlog" },
    labels: ["cynthia-email", "pgl-sprint-1"],
    priority: { name: "High" },
    issuelinks: [],
  },
});
assert(customerEmail.track === "email", "customer email stays on Email");

let createdBody;
let linked;
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith("/rest/api/3/issue") && init?.method === "POST") {
    createdBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 201,
      json: async () => ({ key: "PGL-300" }),
      text: async () => "",
    };
  }
  if (String(url).includes("/issueLink")) {
    linked = JSON.parse(init.body);
    return { ok: true, status: 201, json: async () => ({}), text: async () => "" };
  }
  if (String(url).includes("/issue/PGL-300")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        key: "PGL-300",
        fields: {
          summary: "Provision a second sending domain for Acme",
          issuetype: { name: "Task" },
          parent: { key: "PGL-7" },
          status: { name: "To Do" },
          customfield_10015: "2026-09-08",
          duedate: "2026-09-10",
          assignee: {
            accountId: "712020:2f293e75-b704-4d2e-a459-a0ee035ecc92",
            displayName: "Lewis McFadden",
          },
          labels: ["go-live", "three-week-plan", "pgl-sprint-1"],
          priority: { name: "High" },
          issuelinks: [],
        },
      }),
      text: async () => "",
    };
  }
  throw new Error(`unexpected fetch ${url}`);
};

const tooShort = await handleJiraRequest({
  method: "POST",
  body: JSON.stringify({ action: "create", summary: "short" }),
});
assert(tooShort.status === 400, "create summary too short");

const created = await handleJiraRequest({
  method: "POST",
  body: JSON.stringify({
    action: "create",
    summary: "Provision a second sending domain for Acme",
    description: "Done when SPF/DKIM/DMARC pass for the customer domain.",
    owner: "lewis",
    start: "2026-09-08",
    due: "2026-09-10",
    parent: "PGL-7",
    priority: "High",
    labels: ["cynthia-email"],
    related: ["PGL-205"],
  }),
});
assert(created.status === 200, "create success");
assert(created.json.key === "PGL-300", "created key");
assert(created.json.issue.summary.includes("sending domain"), "created issue mapped");
assert(created.json.issue.parent === "PGL-7", "created parent");
assert(created.json.issue.owner === "lewis", "created owner");
assert(createdBody.fields.issuetype.name === "Task", "creates a Task");
assert(createdBody.fields.project.key === "PGL", "PGL project");
assert(createdBody.fields.parent.key === "PGL-7", "parent epic");
assert(createdBody.fields.assignee.accountId.includes("2f293e75"), "Lewis assignee");
assert(createdBody.fields.labels.includes("go-live"), "go-live label");
assert(createdBody.fields.labels.includes("three-week-plan"), "three-week-plan label");
assert(createdBody.fields.labels.includes("pgl-sprint-1"), "sprint 1 from dates");
assert(createdBody.fields.labels.includes("cynthia-email"), "custom label kept");
assert(linked.outwardIssue.key === "PGL-205", "relates existing key");
assert(linked.inwardIssue.key === "PGL-300", "relates new key");

console.log("jira proxy tests ok");
