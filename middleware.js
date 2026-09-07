const PASS_SHA256 = "bec1cb52deb007e890ee601f1a728292d9826ca1cadea014ea6272abf69a8b94";

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const config = {
  matcher: ["/((?!_vercel).*)"],
};

export default async function middleware(request) {
  const expectedUser = process.env.SITE_USER || "pgl";
  const expectedPass = process.env.SITE_PASSWORD || "";
  const header = request.headers.get("authorization") || "";
  let ok = false;
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const colon = decoded.indexOf(":");
      const user = decoded.slice(0, colon);
      const pass = decoded.slice(colon + 1);
      if (user === expectedUser) {
        if (expectedPass) ok = pass === expectedPass;
        else {
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pass));
          ok = hex(digest) === PASS_SHA256;
        }
      }
    } catch {
      ok = false;
    }
  }
  if (ok) return;
  return new Response("Password required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="PGL Gantt"',
      "Cache-Control": "no-store",
    },
  });
}
