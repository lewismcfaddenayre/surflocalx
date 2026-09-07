const STORAGE = "pgl-jira-auth";

export type JiraAuth = { email: string; token: string };

export function loadAuth(): JiraAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as JiraAuth;
    if (parsed.email && parsed.token) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveAuth(auth: JiraAuth | null) {
  if (!auth) localStorage.removeItem(STORAGE);
  else localStorage.setItem(STORAGE, JSON.stringify(auth));
}

function basic(auth: JiraAuth) {
  return `Basic ${btoa(`${auth.email}:${auth.token}`)}`;
}

export async function updateJiraIssue(
  auth: JiraAuth,
  payload: { key: string; start?: string; due?: string; owner?: "lewis" | "alok" },
) {
  const res = await fetch("/api/jira", {
    method: "POST",
    headers: {
      Authorization: basic(auth),
      "Content-Type": "application/json",
    },
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
  };
  if (!res.ok) {
    throw new Error(json.error || `Jira ${res.status}`);
  }
  return json;
}
