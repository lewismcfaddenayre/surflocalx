export async function updateJiraIssue(payload: {
  key: string;
  start?: string;
  due?: string;
  owner?: "lewis" | "alok";
  action?: "done" | "progress";
}) {
  const res = await fetch("/api/jira", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json()) as {
    error?: string;
    detail?: string;
    key?: string;
    start?: string;
    due?: string;
    sprint?: string;
    owner?: string;
    assignee?: string;
    status?: string;
  };
  if (!res.ok) {
    throw new Error(json.error || `Jira ${res.status}`);
  }
  return json;
}

export type LiveIssue = {
  key: string;
  summary: string;
  type: string;
  parent: string | null;
  start: string | null;
  due: string | null;
  owner: "lewis" | "alok" | "other";
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

export async function loadJiraIssues() {
  const res = await fetch("/api/jira");
  const json = (await res.json()) as { error?: string; issues?: LiveIssue[] };
  if (!res.ok) {
    throw new Error(json.error || `Jira ${res.status}`);
  }
  return json.issues ?? [];
}
