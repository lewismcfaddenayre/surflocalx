# PGL go-live Gantt

Interactive swimlane Gantt for the Production-Go-Live board.

Live: **https://surflocalx.vercel.app** (password protected)

Clock: **Mon 7 Sep – Sun 27 Sep 2026**.

- Live Jira: https://surflokal.atlassian.net/jira/software/c/projects/PGL
- Confluence plan: https://surflokal.atlassian.net/wiki/spaces/~7120202f293e75b7044d2ea459a0ee035ecc92/pages/281608197/PGL+3-week+go-live+plan+sprints+Gantt+dependencies

## Site login

HTTP Basic Auth.

- Username: `pgl`
- Password: `GoLive2026`

Override with `SITE_USER` / `SITE_PASSWORD` on Vercel if you want to change it.

## Jira writes

The serverless `/api/jira` proxy uses `JIRA_EMAIL` + `JIRA_API_TOKEN` on the server. On load and Refresh, the Gantt replaces its board with the live PGL issue list from Jira (new tickets appear, deleted tickets drop off). The bundled snapshot is only the fallback if Jira is unreachable. Drag a pill to move it (keeps duration). Drag the left or right edge across days to set Start and Due. Click a date header for that day’s tickets; **In progress** and **Done** (also in the drawer) transition Jira. People-view drops and Assign buttons update assignee.

**Add task** opens a chat that scopes an idea against the live PGL board. Cursor suggests the outcome; **Create in Jira** writes a PGL Task only after you confirm. That path needs `CURSOR_API_KEY` on the server (Cursor Dashboard → API Keys). Do not commit the key. Scoping uses a fast Cursor model and `/api/idea` is allowed 60s on Vercel so the browser is not left hanging on a dead SSL connection.

## Local

```bash
cp .env.example .env.local
# set JIRA_API_TOKEN in .env.local
npm install
npm run dev
```

## Vercel

Root directory: repo root. Framework: Vite. Output: `dist`.

Set production env vars:

- `JIRA_EMAIL` — `lewis@surflocalexchange.com`
- `JIRA_API_TOKEN` — Atlassian API token
- `CURSOR_API_KEY` — Cursor API key for **Add task** scoping (never commit it)
