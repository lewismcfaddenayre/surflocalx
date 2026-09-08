import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { handleIdeaRequest } from "./api/idea.js";
import { handleJiraRequest } from "./api/jira.js";

function jsonApi(
  route: string,
  handler: (input: { method: string; body: string }) => Promise<{ status: number; json: unknown }>,
): Plugin {
  return {
    name: `${route.slice(1).replace(/\W+/g, "-")}-dev-api`,
    configureServer(server) {
      server.middlewares.use(route, (req, res) => {
        const chunks: Uint8Array[] = [];
        req.on("data", (c) => chunks.push(c as Uint8Array));
        req.on("end", async () => {
          let body = Buffer.concat(chunks).toString("utf8");
          if ((req.method || "GET") === "GET") {
            const url = new URL(req.url || "/", "http://localhost");
            body = JSON.stringify({
              action: "status",
              agentId: url.searchParams.get("agentId"),
              runId: url.searchParams.get("runId"),
            });
          }
          const result = await handler({
            method: req.method || "GET",
            body,
          });
          res.statusCode = result.status;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(result.json));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), jsonApi("/api/jira", handleJiraRequest), jsonApi("/api/idea", handleIdeaRequest)],
});
