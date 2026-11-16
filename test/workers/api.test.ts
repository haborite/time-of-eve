import { describe, expect, it } from "vitest";
import { db, PollStore } from "../../src/repo/polls";
import { E, POLL, admin, api, req, setSettings } from "./helpers";

describe("REST API: creation policy", () => {
  it("admin_only: anonymous creation is refused, admin token works", async () => {
    const a = await admin();
    const anon = await api("POST", "/polls", POLL);
    expect(anon.status).toBe(403);
    expect(anon.body.error.code).toBe("creation_disabled");
    const bad = await api("POST", "/polls", POLL, { Authorization: "Bearer sch_wrong" });
    expect(bad.status).toBe(401);
    const ok = await api("POST", "/polls", { ...POLL, publish: true }, { Authorization: `Bearer ${a.token}` });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe("open");
    expect(ok.body.public_url).toMatch(/^https:\/\/toe\.test\/p\/[A-Za-z0-9_-]+$/);
    expect(ok.body.manage_url).toMatch(/^https:\/\/toe\.test\/m\/[0-9A-Z]{26}\/[A-Za-z0-9_-]{40,}$/);
  });

  it("anyone: anonymous creation works and is idempotent per client_request_id", async () => {
    await setSettings({ creation_mode: "anyone" });
    const body = { ...POLL, client_request_id: "agent-1" };
    const first = await api("POST", "/polls", body);
    expect(first.status).toBe(201);
    const again = await api("POST", "/polls", body);
    expect(again.status).toBe(200);
    expect(again.body.idempotent_replay).toBe(true);
    expect(again.body.manage_url).toBe(first.body.manage_url);
    const conflict = await api("POST", "/polls", { ...body, title: "other" });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("idempotency_conflict");
  });

  it("dry_run validates without saving and returns rendered issues", async () => {
    await setSettings({ creation_mode: "anyone" });
    const r = await api("POST", "/polls", { ...POLL, dry_run: true, candidates: [{ start: "2030-01-08T13:00:00+01:00" }] });
    expect(r.status).toBe(200);
    expect(r.body.valid).toBe(false);
    expect(r.body.errors[0]).toMatchObject({ code: "timezone_mismatch", field: "candidates[0].start" });
    expect(r.body.errors[0].hint).toBeTruthy();
    expect(await new PollStore(db(E)).list()).toHaveLength(0);
  });

  it("reports JSON errors with docs link", async () => {
    const r = await req("/api/v1/polls", { method: "POST", body: "{nope", headers: { "Content-Type": "application/json" } });
    expect(r.status).toBe(400);
    const j = (await r.json()) as Record<string, any>;
    expect(j.error.code).toBe("invalid_json");
    expect(j.docs).toBe("https://toe.test/llms.txt");
  });
});

describe("REST API: organizer and participant flow", () => {
  async function created() {
    await setSettings({ creation_mode: "anyone" });
    const r = await api("POST", "/polls", { ...POLL, publish: true });
    const token = r.body.manage_url.split("/").pop();
    const publicId = r.body.public_url.split("/p/")[1];
    return { id: r.body.poll_id as string, token: token as string, publicId: publicId as string, m: { "X-Manage-Token": token } };
  }

  it("runs the whole flow", async () => {
    const p = await created();
    const pub = await api("GET", `/public/${p.publicId}`);
    expect(pub.body.candidates.map((c: { id: string; start: string }) => [c.id, c.start])).toEqual([
      ["c1", "2030-01-08T13:00:00+09:00"], ["c2", "2030-01-08T14:00:00+09:00"], ["c3", "2030-01-09T10:00:00+09:00"],
    ]);
    expect(pub.body.preregistered_pending).toHaveLength(2);

    const twin = await api("POST", `/public/${p.publicId}/responses`, { display_name: "Aさん", answers: { c1: "yes" } });
    expect(twin.body.error.code).toBe("use_participant_id");
    const a = await api("POST", `/public/${p.publicId}/responses`, { participant_id: "p1", answers: { c1: "yes", c2: "yes" } });
    expect(a.status).toBe(201);
    expect(a.body.edit_url).toContain("#edit=p1.");
    const dup = await api("POST", `/public/${p.publicId}/responses`, { participant_id: "p1", answers: { c1: "yes" } });
    expect(dup.status).toBe(409);
    const c = await api("POST", `/public/${p.publicId}/responses`, { display_name: "Cさん", answers: { c2: "yes", c3: "no" }, comment: "hi" });
    expect(c.body.response_id).toBe("p3");

    const mine = await api("GET", `/public/${p.publicId}/responses/p1`, undefined, { "X-Edit-Token": a.body.edit_token });
    expect(mine.body.answers).toEqual({ c1: "yes", c2: "yes" });
    const forged = await api("GET", `/public/${p.publicId}/responses/p3`, undefined, { "X-Edit-Token": a.body.edit_token });
    expect(forged.status).toBe(403);
    const upd = await api("PATCH", `/public/${p.publicId}/responses/p1`, { answers: { c1: null, c3: "maybe" } }, { "X-Edit-Token": a.body.edit_token });
    expect(upd.body.answers).toEqual({ c2: "yes", c3: "maybe" });

    const res = await api("GET", `/polls/${p.id}/results?view=full`, undefined, p.m);
    expect(res.body.best_candidate_ids).toEqual(["c2"]);
    expect(res.body.participants.map((x: { id: string }) => x.id)).toEqual(["p1", "p2", "p3"]);
    const noAuth = await api("GET", `/polls/${p.id}/results`);
    expect(noAuth.status).toBe(401);
    const wrong = await api("GET", `/polls/${p.id}`, undefined, { "X-Manage-Token": "x".repeat(43) });
    expect(wrong.status).toBe(403);

    const stale = await api("POST", `/polls/${p.id}/finalize`, { candidate_id: "c2", version: 1 }, p.m);
    expect(stale.status).toBe(200); // version 1 is current: publish happened at creation
    const after = await api("POST", `/public/${p.publicId}/responses`, { display_name: "late", answers: {} });
    expect(after.body.error.code).toBe("not_accepting");
    const md = await req(`/p/${p.publicId}.md`);
    expect(await md.text()).toContain("**Finalized: c2");

    const re = await api("POST", `/polls/${p.id}/participants/p1/reissue-edit-link`, undefined, p.m);
    expect(re.body.edit_url).not.toBe(a.body.edit_url);
    const old = await api("GET", `/public/${p.publicId}/responses/p1`, undefined, { "X-Edit-Token": a.body.edit_token });
    expect(old.status).toBe(403);

    const csv = await req(`/api/v1/polls/${p.id}/export.csv`, { headers: p.m });
    expect(await csv.text()).toContain("Cさん");

    const rot = await api("POST", `/polls/${p.id}/rotate-manage-link`, undefined, p.m);
    expect(rot.body.manage_url).not.toContain(p.token);
    expect((await api("GET", `/polls/${p.id}`, undefined, p.m)).status).toBe(403);
    const t2 = { "X-Manage-Token": rot.body.manage_url.split("/").pop() };
    expect((await api("DELETE", `/polls/${p.id}`, undefined, t2)).body.deleted).toBe(true);
    expect((await api("GET", `/public/${p.publicId}`)).status).toBe(404);
  });

  it("detects concurrent edits (optimistic lock) and keeps concurrent answers", async () => {
    const p = await created();
    const [x, y] = await Promise.all([
      api("PATCH", `/polls/${p.id}`, { title: "one", version: 1 }, p.m),
      api("PATCH", `/polls/${p.id}`, { title: "two", version: 1 }, p.m),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const answers = await Promise.all(Array.from({ length: 5 }, (_, i) =>
      api("POST", `/public/${p.publicId}/responses`, { display_name: `n${i}`, answers: { c1: "yes" } })));
    expect(answers.every((r) => r.status === 201)).toBe(true);
    expect(new Set(answers.map((r) => r.body.response_id)).size).toBe(5);
    const res = await api("GET", `/polls/${p.id}/results`, undefined, p.m);
    expect(res.body.candidates[0].yes).toBe(5);
  });

  it("patch adds ranges, removes candidates, keeps answers", async () => {
    const p = await created();
    await api("POST", `/public/${p.publicId}/responses`, { display_name: "z", answers: { c1: "yes", c3: "yes" } });
    const r = await api("PATCH", `/polls/${p.id}`, {
      add_candidate_ranges: [{ date: "2030-01-10", start_time: "09:00", end_time: "11:00" }], remove_candidate_ids: ["c3"], version: 1,
    }, p.m);
    expect(r.status).toBe(200);
    expect(r.body.candidates.map((c: { id: string }) => c.id)).toEqual(["c1", "c2", "c4", "c5"]);
    expect(r.body.results.candidates.find((c: { id: string }) => c.id === "c1").yes).toBe(1);
  });

  it("hidden polls disappear for participants", async () => {
    const p = await created();
    await new PollStore(db(E)).d.update((await import("../../src/db/schema")).polls).set({ hidden: true });
    expect((await api("GET", `/public/${p.publicId}`)).status).toBe(404);
    expect((await req(`/p/${p.publicId}`)).status).toBe(404);
  });
});

describe("retention", () => {
  it("purges old anonymous polls only", async () => {
    const a = await admin();
    await setSettings({ creation_mode: "anyone" });
    const old = { ...POLL, candidates: [{ start: "2030-01-08T13:00" }] };
    await api("POST", "/polls", old);
    await api("POST", "/polls", old, { Authorization: `Bearer ${a.token}` });
    const store = new PollStore(db(E));
    expect(await store.purgeAnonymous(30, Date.UTC(2030, 0, 20))).toBe(0); // last candidate only 12 days ago
    expect(await store.purgeAnonymous(30, Date.UTC(2030, 5, 1))).toBe(1);
    const left = await store.list();
    expect(left).toHaveLength(1);
    expect(left[0].ownerUserId).toBe(a.id);
  });
});
