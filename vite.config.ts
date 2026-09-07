import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { handleJiraRequest } from "./api/jira.js";

function jiraDevApi(): Plugin {
  return {
    name: "jira-dev-api",
    configureServer(server) {
      server.middlewares.use("/api/jira", (req, res) => {
        const chunks: Uint8Array[] = [];
        req.on("data", (c) => chunks.push(c as Uint8Array));
        req.on("end", async () => {
          const result = await handleJiraRequest({
            method: req.method || "GET",
            body: Buffer.concat(chunks).toString("utf8"),
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
  plugins: [react(), jiraDevApi()],
});
