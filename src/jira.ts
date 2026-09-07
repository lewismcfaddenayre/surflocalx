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

export async function loadJiraStatuses() {
  const res = await fetch("/api/jira");
  const json = (await res.json()) as { error?: string; issues?: { key: string; status: string }[] };
  if (!res.ok) {
    throw new Error(json.error || `Jira ${res.status}`);
  }
  return json.issues ?? [];
}
