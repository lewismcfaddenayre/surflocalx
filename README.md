# PGL go-live Gantt

Interactive swimlane Gantt for the Production-Go-Live board. Vite app on Vercel: https://surflocaltest.vercel.app

Clock: **Mon 7 Sep – Sun 27 Sep 2026**.

- Live Jira: https://surflokal.atlassian.net/jira/software/c/projects/PGL
- Confluence plan: https://surflokal.atlassian.net/wiki/spaces/~7120202f293e75b7044d2ea459a0ee035ecc92/pages/281608197/PGL+3-week+go-live+plan+sprints+Gantt+dependencies

## What writes Jira

Connect first (**Connect Jira** → Atlassian email + [API token](https://id.atlassian.com/manage-profile/security/api-tokens)). The token stays in this browser and is sent only to `/api/jira`.

| Action | Jira fields |
| --- | --- |
| Drag a chip onto a day | Start (`customfield_10015`), Due, sprint label `pgl-sprint-1/2/3` |
| People view: drop onto Lewis or Alok | Same dates **and** assignee |
| Drawer date picker | Start + Due + sprint label |
| Assign Lewis / Assign Alok | Assignee (keeps the current day) |

Filters, search, sprint week buttons, and view tabs do **not** write Jira. Track swimlanes are display-only; dropping on another track still only changes the day.

Only `PGL-*` issues can be updated. Failed writes revert the chip.

## Local

```bash
npm install
npm run dev
```

`/api/jira` is served by Vite in development and by a Vercel serverless function in production.

## Vercel

Root directory: repo root. Framework: Vite. Output: `dist`.
