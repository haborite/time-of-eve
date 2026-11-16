import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { db } from "../../src/repo/polls";
import { saveSettings, DEFAULT_SETTINGS, type Settings } from "../../src/repo/settings";
import { createApiToken, createUser } from "../../src/repo/users";

export const ORIGIN = "https://toe.test";
export const E = env as unknown as Cloudflare.Env & { SECRET_KEY: string };

export async function admin(username = "admin", password = "correct-horse-battery") {
  const d = db(E);
  const id = await createUser(d, username, password);
  const token = await createApiToken(d, E.SECRET_KEY, id, "test");
  return { id, token, username, password };
}

export async function setSettings(s: Partial<Settings>) {
  await saveSettings(db(E), { ...DEFAULT_SETTINGS, ...s });
}

export function req(path: string, init: RequestInit & { json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers, body, redirect: "manual" });
}

export async function api<T = Record<string, any>>(method: string, path: string, json?: unknown, headers: Record<string, string> = {}) {
  const r = await req(`/api/v1${path}`, { method, json, headers });
  return { status: r.status, body: (await r.json()) as T };
}

let rpcId = 0;
export async function mcp(method: string, params: unknown = {}, headers: Record<string, string> = {}, path = "/mcp") {
  const r = await req(path, {
    method: "POST",
    headers: { Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18", ...headers },
    json: { jsonrpc: "2.0", id: ++rpcId, method, params },
  });
  const text = await r.text();
  return { status: r.status, headers: r.headers, body: text ? JSON.parse(text) : null };
}

export async function tool(name: string, args: Record<string, unknown>, headers: Record<string, string> = {}) {
  const r = await mcp("tools/call", { name, arguments: args }, headers);
  return { isError: !!r.body.result?.isError, data: r.body.result?.structuredContent as Record<string, any>, raw: r.body };
}

export const POLL = {
  title: "研究打合せ",
  timezone: "Asia/Tokyo",
  duration_minutes: 60,
  candidates: [{ start: "2030-01-08T13:00" }, { start: "2030-01-08T14:00" }, { start: "2030-01-09T10:00" }],
  participants: [{ display_name: "Aさん", required: true }, { display_name: "Bさん" }],
};
