#!/usr/bin/env node
/**
 * Create (or reset the password of) an administrator in D1.
 *
 *   npm run admin:create -- <username>                      # local D1 (wrangler dev)
 *   npm run admin:create -- <username> --env staging        # remote staging D1
 *   npm run admin:create -- <username> --env production     # remote production D1
 *
 * The password is read from the terminal (hidden) or from ADMIN_PASSWORD. It is hashed here by the Worker's own
 * hashPassword (src/lib/crypto.ts), so the plain password never leaves this machine.
 * Runs on Node's built-in TypeScript support (Node 22.18+ / 24).
 * More administrators can then be added from the dashboard (/admin/settings).
 */
import { spawnSync } from "node:child_process";
import { hashPassword } from "../src/lib/crypto.ts";

const args = process.argv.slice(2);
const envIdx = args.indexOf("--env");
const env = envIdx >= 0 ? args[envIdx + 1] : "";
const username = args.filter((a, i) => envIdx < 0 || (i !== envIdx && i !== envIdx + 1))[0];
if (!username || !/^[A-Za-z0-9._-]{2,64}$/.test(username)) {
  console.error("usage: npm run admin:create -- <username> [--env staging|production]   (username: 2-64 of A-Z a-z 0-9 . _ -)");
  process.exit(1);
}

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    let buf = "";
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (ch: string) => {
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.off("data", onData);
        process.stdout.write("\n");
        resolve(buf);
      } else if (ch === "\u0003") process.exit(130);
      else if (ch === "\u007f") buf = buf.slice(0, -1);
      else buf += ch;
    };
    stdin.on("data", onData);
  });
}

let password = process.env.ADMIN_PASSWORD;
if (!password) {
  password = await readHidden("Password (12+ characters): ");
  const again = await readHidden("Again: ");
  if (password !== again) {
    console.error("Passwords do not match.");
    process.exit(1);
  }
}
if (password.length < 12) {
  console.error("Password must be at least 12 characters.");
  process.exit(1);
}
const hash = await hashPassword(password);
const sql = `INSERT INTO users (username, password_hash) VALUES ('${username}', '${hash}') ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, disabled = 0;`;
const wranglerArgs = ["wrangler", "d1", "execute", "DB", env ? "--remote" : "--local", "--command", sql];
if (env) wranglerArgs.push("--env", env);
const r = spawnSync("npx", wranglerArgs, { stdio: ["ignore", "inherit", "inherit"] });
if (r.status === 0) console.log(`Administrator "${username}" is ready (${env || "local"}).`);
process.exit(r.status ?? 1);
