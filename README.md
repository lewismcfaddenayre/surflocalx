# PGL go-live Gantt

Interactive swimlane Gantt for the Production-Go-Live board. Static Vite app; deploy on Vercel.

Clock: **Mon 7 Sep – Sun 27 Sep 2026**.

- Live Jira: https://surflokal.atlassian.net/jira/software/c/projects/PGL
- Confluence plan: https://surflokal.atlassian.net/wiki/spaces/~7120202f293e75b7044d2ea459a0ee035ecc92/pages/281608197/PGL+3-week+go-live+plan+sprints+Gantt+dependencies

## Why this view

Jira Timeline treats every ticket as a bar. Almost every PGL story is a **one-day pin**, so Timeline becomes 200 overlapping ticks. This page uses:

- **Tracks** as swimlanes (MLS, Funnel, Email/SMS, AI, Vault, Launch, Product)
- **Days** as columns across the three Monday–Sunday sprints
- **Lewis / Alok** colour (teal / sand)
- **Critical path** gold rings from Blocks links
- Click-through to Jira

## Local

```bash
npm install
npm run dev
```

## Vercel

Root directory: repo root. Framework: Vite. Output: `dist`.
