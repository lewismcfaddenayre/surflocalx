import { handleIdeaRequest, parseTicket, pickCatalog, stripTicket } from "../api/idea.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

delete process.env.IDEA_MOCK;

const sample = `Suggested outcome: provision the Acme sending domain this week.

\`\`\`ticket
{
  "summary": "CYN-EMAIL Provision Acme sending domain",
  "description": "Done when SPF/DKIM/DMARC pass.",
  "owner": "lewis",
  "start": "2026-09-08",
  "due": "2026-09-10",
  "parent": "PGL-7",
  "priority": "High",
  "labels": ["cynthia-email"],
  "related": ["PGL-205", "nope"]
}
\`\`\`
`;

const ticket = parseTicket(sample);
assert(ticket.summary.startsWith("CYN-EMAIL"), "summary");
assert(ticket.owner === "lewis", "owner");
assert(ticket.parent === "PGL-7", "parent epic");
assert(ticket.start === "2026-09-08" && ticket.due === "2026-09-10", "dates");
assert(ticket.related.join(",") === "PGL-205", "related keys only");
assert(!stripTicket(sample).includes("```"), "ticket fence stripped");
assert(stripTicket(sample).includes("Suggested outcome"), "human reply kept");

const sprintParent = parseTicket(`\`\`\`ticket
{"summary":"Do not parent on a week epic","parent":"PGL-202","owner":"alok"}
\`\`\``);
assert(sprintParent.parent === null, "week epics are not parents");
assert(sprintParent.owner === "alok", "alok owner");
assert(sprintParent.priority === "Medium", "default priority");

assert(parseTicket("just chatting") === null, "no ticket yet");
assert(parseTicket(`\`\`\`ticket\n{"summary":"too"}\n\`\`\``) === null, "short summary rejected");

const ranked = pickCatalog("SMS campaign", [
  { key: "PGL-1", summary: "Agent app property details", type: "epic" },
  { key: "PGL-209", summary: "Customer campaign SMS", type: "task", track: "email", parent: "PGL-7" },
  { key: "PGL-90", summary: "Deal Room", type: "story", track: "funnel" },
]);
assert(ranked[0].key === "PGL-209", "keyword matches rank first");
assert(ranked.length === 3, "small catalogs stay intact");

const savedKey = process.env.CURSOR_API_KEY;
delete process.env.CURSOR_API_KEY;
const missing = await handleIdeaRequest({ method: "POST", body: '{"text":"add a vault waitlist"}' });
assert(missing.status === 503, "cursor key required");
if (savedKey) process.env.CURSOR_API_KEY = savedKey;

process.env.CURSOR_API_KEY = "crsr_test_key";

const method = await handleIdeaRequest({ method: "PUT", body: "{}" });
assert(method.status === 405, "GET or POST only");

const short = await handleIdeaRequest({
  method: "POST",
  body: JSON.stringify({ text: "hi" }),
});
assert(short.status === 400, "idea too short");

const noSession = await handleIdeaRequest({
  method: "POST",
  body: JSON.stringify({ action: "followup", text: "make it Alok instead" }),
});
assert(noSession.status === 400, "followup needs agent");

const noRun = await handleIdeaRequest({
  method: "POST",
  body: JSON.stringify({ action: "status", agentId: "bc-1", runId: "nope" }),
});
assert(noRun.status === 400, "status needs run id");

let createBody;
globalThis.fetch = async (url, init) => {
  assert(String(url) === "https://api.cursor.com/v1/agents", "create agent url");
  assert(init.method === "POST", "create agent post");
  createBody = JSON.parse(init.body);
  return {
    ok: true,
    status: 201,
    text: async () =>
      JSON.stringify({
        agent: { id: "bc-00000000-0000-0000-0000-000000000001" },
        run: { id: "run-00000000-0000-0000-0000-000000000001", status: "CREATING" },
      }),
  };
};

const started = await handleIdeaRequest({
  method: "POST",
  body: JSON.stringify({
    text: "Add customer SMS opt-out audit before campaigns go out",
    catalog: [{ key: "PGL-209", summary: "Campaign SMS", parent: "PGL-7", track: "email" }],
  }),
});
assert(started.status === 200, "start ok");
assert(started.json.agentId.startsWith("bc-"), "agent id");
assert(started.json.runId.startsWith("run-"), "run id");
assert(createBody.mode === "plan", "plan mode");
assert(createBody.model.params.some((p) => p.id === "fast"), "fast model");
assert(!createBody.repos && !createBody.env, "no-repo agent");
assert(createBody.prompt.text.includes("Human idea"), "idea in prompt");
assert(createBody.prompt.text.includes("PGL-209"), "catalog in prompt");
assert(createBody.prompt.text.includes("do not create a Jira issue yourself"), "no jira write");

globalThis.fetch = async (url, init) => {
  assert(String(url).includes("/v1/agents/bc-00000000-0000-0000-0000-000000000001/runs"), "followup url");
  assert(init.method === "POST", "followup post");
  assert(JSON.parse(init.body).mode === "plan", "followup stays in plan");
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        run: { id: "run-00000000-0000-0000-0000-000000000002", status: "CREATING" },
      }),
  };
};
const follow = await handleIdeaRequest({
  method: "POST",
  body: JSON.stringify({
    action: "followup",
    agentId: "bc-00000000-0000-0000-0000-000000000001",
    text: "Assign Alok and start 16 Sep",
  }),
});
assert(follow.status === 200 && follow.json.runId.endsWith("2"), "followup run");

process.env.IDEA_CURSOR_TIMEOUT_MS = "40";
globalThis.fetch = (_url, init) =>
  new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => {
      const err = new Error("Aborted");
      err.name = "AbortError";
      reject(err);
    });
  });
const hung = await handleIdeaRequest({
  method: "POST",
  body: JSON.stringify({ text: "Add customer SMS opt-out audit before campaigns" }),
});
assert(hung.status === 504, "cursor timeout becomes json");
delete process.env.IDEA_CURSOR_TIMEOUT_MS;

globalThis.fetch = async (url) => {
  assert(String(url).includes("/runs/run-00000000-0000-0000-0000-000000000001"), "status url");
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        id: "run-00000000-0000-0000-0000-000000000001",
        status: "FINISHED",
        result: sample,
      }),
  };
};
const status = await handleIdeaRequest({
  method: "POST",
  body: JSON.stringify({
    action: "status",
    agentId: "bc-00000000-0000-0000-0000-000000000001",
    runId: "run-00000000-0000-0000-0000-000000000001",
  }),
});
assert(status.status === 200, "status ok");
assert(status.json.done === true, "finished is done");
assert(status.json.suggestion.summary.startsWith("CYN-EMAIL"), "parsed suggestion");
assert(!status.json.reply.includes("```"), "reply hides ticket fence");

if (savedKey) process.env.CURSOR_API_KEY = savedKey;
else delete process.env.CURSOR_API_KEY;

delete process.env.VERCEL;
process.env.IDEA_MOCK = "1";
delete process.env.CURSOR_API_KEY;
const mocked = await handleIdeaRequest({
  method: "POST",
  body: JSON.stringify({ text: "Customer SMS opt-out audit before campaigns" }),
});
assert(mocked.status === 200 && mocked.json.agentId.startsWith("bc-"), "mock start");
const mockedStatus = await handleIdeaRequest({
  method: "POST",
  body: JSON.stringify({
    action: "status",
    agentId: mocked.json.agentId,
    runId: mocked.json.runId,
  }),
});
assert(mockedStatus.json.done === true, "mock finishes");
assert(mockedStatus.json.suggestion.summary.includes("SMS"), "mock suggestion");
assert(!mockedStatus.json.reply.includes("```"), "mock reply is human");

process.env.VERCEL = "1";
const blocked = await handleIdeaRequest({
  method: "POST",
  body: JSON.stringify({ text: "Customer SMS opt-out audit before campaigns" }),
});
assert(blocked.status === 503, "mock disabled on Vercel");
delete process.env.VERCEL;
delete process.env.IDEA_MOCK;
if (savedKey) process.env.CURSOR_API_KEY = savedKey;

console.log("idea proxy tests ok");
