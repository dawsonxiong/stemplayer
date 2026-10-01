// Local dev with the full upload → separate → webhook loop working.
//
// Modal runs in the cloud and reports progress to the Worker's /api/webhook,
// which it can't reach at localhost. This opens a Cloudflare quick tunnel to
// the dev server first and hands its public URL to the app as
// VITE_WEBHOOK_ORIGIN, so separation jobs call back through it.
//
// The Worker's secrets are read from 1Password (the op:// references in
// .env.op) and passed as environment variables, so they never touch disk.
// Each is read on its own rather than through `op run`, which aborts the whole
// server if any one reference is missing.
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const PORT = 5173;
const TUNNEL_TIMEOUT_MS = 20_000;
const OP_ACCOUNT = "my.1password.com";

function loadSecrets() {
  const secrets = {};
  const missing = [];
  for (const line of readFileSync(new URL("../.env.op", import.meta.url), "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(op:\/\/.+)$/);
    if (!match) continue;
    const [, name, ref] = match;
    try {
      secrets[name] = execFileSync("op", ["read", "--account", OP_ACCOUNT, ref], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    console.warn(
      `\n  Couldn't read ${missing.join(", ")} from 1Password (see .env.op).` +
        "\n  The site runs, but anything needing them will fail.\n",
    );
  }
  return secrets;
}

const secrets = loadSecrets();

function startTunnel() {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        "cloudflared",
        ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
    } catch {
      resolve({ child: null, url: null });
      return;
    }

    const timer = setTimeout(() => resolve({ child, url: null }), TUNNEL_TIMEOUT_MS);
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ child: null, url: null });
    });
    // cloudflared prints the assigned hostname on stderr.
    child.stderr.on("data", (chunk) => {
      const match = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timer);
        resolve({ child, url: match[0] });
      }
    });
  });
}

const { child: tunnel, url } = await startTunnel();

if (url) {
  console.warn(`\n  Webhook tunnel: ${url}\n`);
} else {
  console.warn(
    "\n  No tunnel (is cloudflared installed?). Uploads work, but separation jobs" +
      "\n  can't report back, so they'll sit on 'Separating stems'.\n",
  );
}

const app = spawn("vite", ["dev", "--port", String(PORT), "--strictPort"], {
  stdio: "inherit",
  env: { ...process.env, ...secrets, ...(url ? { VITE_WEBHOOK_ORIGIN: url } : {}) },
});

function shutdown(code = 0) {
  tunnel?.kill();
  app.kill();
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
app.on("exit", (code) => {
  tunnel?.kill();
  process.exit(code ?? 0);
});
