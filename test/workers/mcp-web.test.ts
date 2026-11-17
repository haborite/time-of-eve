import { describe, expect, it } from "vitest";
import { E, ORIGIN, POLL, admin, mcp, req, setSettings, tool } from "./helpers";

describe("MCP server", () => {
  it("initializes and lists tools by role", async () => {
    const init = await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe("time-of-eve");
    expect(init.body.result.instructions).toContain("administrator");

    const anon = await mcp("tools/list");
    const names = anon.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("submit_response");
    expect(names).not.toContain("create_poll"); // admin_only by default
    expect(names).not.toContain("list_polls");

    const a = await admin();
    const adm = await mcp("tools/list", {}, { Authorization: `Bearer ${a.token}` });
    const an = adm.body.result.tools.map((t: { name: string }) => t.name);
    expect(an).toEqual(expect.arrayContaining(["create_poll", "list_polls", "finalize_poll"]));
    const create = adm.body.result.tools.find((t: { name: string }) => t.name === "create_poll");
    expect(create.inputSchema.properties.candidate_ranges).toBeTruthy();

    expect((await mcp("tools/list", {}, { Authorization: "Bearer sch_invalid" })).status).toBe(401);
  });

  it("anonymous organizer + participant agents complete a poll", async () => {
    await setSettings({ creation_mode: "anyone" });
    const created = await tool("create_poll", { ...POLL, publish: true });
    expect(created.isError).toBe(false);
    const { manage_url, public_url } = created.data;

    const view = await tool("get_public_poll", { poll: public_url });
    expect(view.data.candidates).toHaveLength(3);
    expect(JSON.stringify(view.data)).not.toContain(manage_url.split("/").pop());

    const ans = await tool("submit_response", { poll: public_url, participant_id: "p2", answers: { c1: "yes", c2: "no" } });
    expect(ans.data.unanswered_candidate_ids).toEqual(["c3"]);
    const upd = await tool("update_my_response", { edit_url: ans.data.edit_url, answers: { c3: "yes" } });
    expect(upd.data.answers).toEqual({ c1: "yes", c2: "no", c3: "yes" });

    let res = await tool("get_results", { poll: manage_url });
    expect(res.data.best_candidate_ids).toEqual([]); // required Aさん has not answered yet
    await tool("submit_response", { poll: public_url, participant_id: "p1", answers: { c1: "yes", c2: "yes", c3: "yes" } });
    res = await tool("get_results", { poll: manage_url });
    expect(res.data.best_candidate_ids).toEqual(["c1", "c3"]);
    const fin = await tool("finalize_poll", { poll: manage_url, candidate_id: "c3", version: res.data.version });
    expect(fin.data.finalized_candidate.start).toBe("2030-01-09T10:00:00+09:00");
    const mine = await tool("get_my_response", { edit_url: ans.data.edit_url });
    expect(mine.data.finalized_candidate.id).toBe("c3");

    const byId = await tool("get_poll", { poll: created.data.poll_id });
    expect(byId.isError).toBe(true);
    expect(byId.data.error.code).toBe("invalid_manage_token");
  });

  it("returns validation errors as tool errors with hints", async () => {
    await setSettings({ creation_mode: "anyone" });
    const r = await tool("create_poll", { title: "x", timezone: "America/New_York", duration_minutes: 60, candidates: [{ start: "2030-03-10T02:30" }] });
    expect(r.isError).toBe(true);
    expect(r.data.errors[0]).toMatchObject({ code: "nonexistent_local_time", field: "candidates[0].start" });
  });

  it("protects /mcp/admin with OAuth metadata and rejects foreign browser origins", async () => {
    const r = await mcp("tools/list", {}, {}, "/mcp/admin");
    expect(r.status).toBe(401);
    expect(r.headers.get("WWW-Authenticate")).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp/admin"`);
    const meta = await (await req("/.well-known/oauth-protected-resource/mcp/admin")).json() as Record<string, unknown>;
    expect(meta).toMatchObject({ resource: `${ORIGIN}/mcp/admin`, authorization_servers: [`${ORIGIN}/oauth`] });
    // RFC 8414 path insertion for the issuer <origin>/oauth
    const as = await req("/.well-known/oauth-authorization-server/oauth");
    expect(as.status).toBe(200);
    const asm = await as.json() as Record<string, string>;
    expect(asm.issuer).toBe(`${ORIGIN}/oauth`);
    expect(asm.authorization_endpoint).toBe(`${ORIGIN}/oauth/authorize`);
    expect(asm.token_endpoint).toBe(`${ORIGIN}/oauth/token`);
    const evil = await mcp("tools/list", {}, { Origin: "https://evil.example" });
    expect(evil.status).toBe(403);
  });

  it("advertises no OAuth for /mcp, so clients that probe for it connect anonymously", async () => {
    for (const p of [
      "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/mcp", "/.well-known/openid-configuration",
    ]) expect((await req(p)).status, p).toBe(404);
    const r = await mcp("tools/list");
    expect(r.status).toBe(200);
  });

  it("runs the OAuth flow for an administrator", async () => {
    const a = await admin();
    const reg = await req("/oauth/register", { method: "POST", json: { client_name: "Test Client", redirect_uris: ["http://localhost:9999/cb"], token_endpoint_auth_method: "none" } });
    expect(reg.status).toBe(201);
    const client = await reg.json() as { client_id: string };
    const verifier = "v".repeat(64);
    const challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const q = new URLSearchParams({
      response_type: "code", client_id: client.client_id, redirect_uri: "http://localhost:9999/cb", state: "st",
      code_challenge: challenge, code_challenge_method: "S256", scope: "mcp", resource: `${ORIGIN}/mcp/admin`,
    });
    const page = await req(`/oauth/authorize?${q}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Test Client");
    const state = /name="state" value="([^"]+)"/.exec(html)![1];
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1];
    const wrongPw = await req("/oauth/authorize", { method: "POST", headers: { Origin: ORIGIN }, body: new URLSearchParams({ state, csrf, username: a.username, password: "nope", decision: "allow" }) });
    expect(wrongPw.status).toBe(401);
    const ok = await req("/oauth/authorize", { method: "POST", headers: { Origin: ORIGIN }, body: new URLSearchParams({ state, csrf, username: a.username, password: a.password, decision: "allow" }) });
    expect(ok.status).toBe(302);
    const cb = new URL(ok.headers.get("Location")!);
    expect(cb.searchParams.get("state")).toBe("st");
    expect(cb.searchParams.get("iss")).toBe(`${ORIGIN}/oauth`);
    const tok = await req("/oauth/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code", code: cb.searchParams.get("code")!, redirect_uri: "http://localhost:9999/cb", client_id: client.client_id, code_verifier: verifier }),
    });
    expect(tok.status).toBe(200);
    const { access_token } = await tok.json() as { access_token: string };
    const tools = await mcp("tools/list", {}, { Authorization: `Bearer ${access_token}` }, "/mcp/admin");
    expect(tools.status).toBe(200);
    expect(tools.body.result.tools.map((t: { name: string }) => t.name)).toContain("list_polls");
    // the OAuth token is only for /mcp/admin
    expect((await req("/api/v1/polls", { headers: { Authorization: `Bearer ${access_token}` } })).status).toBe(401);
  });
});

describe("web pages", () => {
  it("renders the public site and switches by creation mode", async () => {
    for (const p of ["/", "/about", "/terms", "/privacy", "/docs", "/llms.txt", "/openapi.json", "/schema/poll.json", "/admin/login"]) {
      expect((await req(p)).status, p).toBe(200);
    }
    expect(await (await req("/")).text()).toContain('data-testid="home-closed"');
    expect((await req("/new")).status).toBe(403);
    await setSettings({ creation_mode: "anyone" });
    expect(await (await req("/")).text()).toContain('data-testid="home-cta"');
    expect((await req("/new")).status).toBe(200);
    const llms = await (await req("/llms.txt")).text();
    expect(llms).toContain("anyone can create polls");
    expect(llms).toContain(`${ORIGIN}/mcp`);
    const oa = await (await req("/openapi.json")).json() as { paths: Record<string, unknown> };
    expect(Object.keys(oa.paths)).toContain("/polls/{poll_id}/finalize");
  });

  it("creates a poll from the web form without login (bot check) and opens the manage page", async () => {
    await setSettings({ creation_mode: "anyone" });
    const json = JSON.stringify(POLL);
    const form = (o: Record<string, string>) => req("/new/confirm", { method: "POST", headers: { Origin: ORIGIN }, body: new URLSearchParams(o) });
    const preview = await form({ json_text: json, action: "validate" });
    expect(await preview.text()).toContain('data-testid="import-preview"');
    const noBot = await form({ json_text: json, action: "publish", confirm_publish: "1" });
    expect(noBot.status).toBe(400);
    const ok = await form({ json_text: json, action: "publish", confirm_publish: "1", "cf-turnstile-response": "XXXX.DUMMY.TOKEN.XXXX" });
    expect(ok.status).toBe(303);
    const loc = ok.headers.get("Location")!;
    expect(loc).toMatch(/^\/m\/[0-9A-Z]{26}\/[A-Za-z0-9_-]+\?done=created$/);
    const page = await req(loc);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('data-testid="manage-url"');
    expect(page.headers.get("Referrer-Policy")).toBe("no-referrer");
    const publicUrl = /id="public-url" value="([^"]+)"|value="([^"]+)" id="public-url"/.exec(html);
    expect(html).toContain("/p/");
    void publicUrl;
    const close = await req(`${loc.split("?")[0]}/action`, { method: "POST", headers: { Origin: ORIGIN }, body: new URLSearchParams({ action: "close", version: "1" }) });
    expect(close.status).toBe(303);
    const cross = await req(`${loc.split("?")[0]}/action`, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/x-www-form-urlencoded" }, body: "action=cancel" });
    expect(cross.status).toBe(403);
  });

  it("serves the answer page as HTML, Markdown for AI agents and JSON on request", async () => {
    const a = await admin();
    const r = await req("/api/v1/polls", { method: "POST", json: { ...POLL, publish: true }, headers: { Authorization: `Bearer ${a.token}` } });
    const { public_url } = await r.json() as { public_url: string };
    const path = new URL(public_url).pathname;
    const html = await req(path);
    expect(html.headers.get("Content-Type")).toContain("text/html");
    expect(html.headers.get("Link")).toContain('rel="alternate"; type="text/markdown"');
    const body = await html.text();
    expect(body).toContain('id="boot"');
    expect(body).toContain('property="og:image"');
    const ai = await req(path, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Claude-User/1.0)" } });
    expect(ai.headers.get("Content-Type")).toContain("text/markdown");
    const js = await req(path, { headers: { Accept: "application/json" } });
    expect(((await js.json()) as { candidates: unknown[] }).candidates).toHaveLength(3);
    const slack = await req(path, { headers: { "User-Agent": "Slackbot-LinkExpanding 1.0" } });
    expect(slack.headers.get("Content-Type")).toContain("text/html");
  });

  it("uses the static share image by default and per-poll images only when enabled", async () => {
    const a = await admin();
    const r = await req("/api/v1/polls", { method: "POST", json: { ...POLL, publish: true }, headers: { Authorization: `Bearer ${a.token}` } });
    const path = new URL(((await r.json()) as { public_url: string }).public_url).pathname;
    const ogImage = async (p: string) => /property="og:image" content="([^"]+)"/.exec(await (await req(p)).text())![1];
    expect(await ogImage(path)).toBe(`${ORIGIN}/static/og-default.png`);
    expect(await ogImage("/")).toBe(`${ORIGIN}/static/og-default.png`);
    const old = await req(`/og/p/${path.split("/").pop()}.png?v=x`);
    expect(old.status).toBe(302);
    expect(old.headers.get("Location")).toBe("/static/og-default.png");
    await setSettings({ og_dynamic: true });
    expect(await ogImage(path)).toContain(`/og/p/${path.split("/").pop()}.png?v=`);
    expect(await ogImage("/")).toContain("/og/default.png?v=");
  });

  it("logs in, throttles failures, and protects admin forms with CSRF", async () => {
    const a = await admin();
    const login = (pw: string) => req("/admin/login", { method: "POST", headers: { Origin: ORIGIN, "CF-Connecting-IP": "203.0.113.9" }, body: new URLSearchParams({ username: a.username, password: pw, next: "/admin" }) });
    const ok = await login(a.password);
    expect(ok.status).toBe(303);
    const cookie = ok.headers.get("Set-Cookie")!.split(";")[0];
    const dash = await req("/admin", { headers: { Cookie: cookie } });
    expect(dash.status).toBe(200);
    const settings = await (await req("/admin/settings", { headers: { Cookie: cookie } })).text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(settings)![1];
    const noCsrf = await req("/admin/settings", { method: "POST", headers: { Cookie: cookie, Origin: ORIGIN }, body: new URLSearchParams({ action: "save", creation_mode: "anyone" }) });
    expect(noCsrf.status).toBe(403);
    const saved = await req("/admin/settings", { method: "POST", headers: { Cookie: cookie, Origin: ORIGIN }, body: new URLSearchParams({ csrf, action: "save", creation_mode: "anyone", retention_days: "30", default_timezone: "Europe/Paris" }) });
    expect(saved.status).toBe(200);
    expect(await (await req("/llms.txt")).text()).toContain("Europe/Paris");
    expect(await (await req("/")).text()).toContain('content="https://toe.test/static/og-default.png"');
    const on = await req("/admin/settings", { method: "POST", headers: { Cookie: cookie, Origin: ORIGIN }, body: new URLSearchParams({ csrf, action: "save", creation_mode: "anyone", retention_days: "30", default_timezone: "Europe/Paris", og_dynamic: "on" }) });
    expect(on.status).toBe(200);
    expect(await on.text()).toMatch(/name="og_dynamic" checked/);
    expect(await (await req("/")).text()).toContain("/og/default.png?v=");
    for (let i = 0; i < 10; i++) expect((await login("wrong")).status).toBe(401);
    expect((await login(a.password)).status).toBe(429);
    expect(E.SECRET_KEY.length).toBeGreaterThan(31);
  });
});
