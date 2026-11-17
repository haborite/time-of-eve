/**
 * URLs and capability tokens.
 *  - public page   /p/<public_id>                      anyone with the link can read and answer
 *  - manage page   /m/<poll_id>/<manage_token>         organizer capability (no login): edit, results, finalize
 *  - edit link     /p/<public_id>#edit=p3.<edit_token> one participant's own answer (fragment: not sent to servers)
 *  - admin page    /admin/polls/<poll_id>              administrators (login)
 * Tokens are HMAC(SECRET_KEY, purpose:id:nonce) — see lib/crypto.ts.
 */
import { deriveToken, timingSafeEqual } from "../lib/crypto";
import { pKey, type Participant, type Poll } from "./model";

export class Links {
  /** dynamicOg: share images are drawn per poll (site setting); otherwise the static image is used. */
  constructor(public origin: string, private secret: string, public dynamicOg = false) {}

  url(path = "") {
    return `${this.origin}${path}`;
  }

  publicUrl(poll: Pick<Poll, "publicId">) {
    return this.url(`/p/${poll.publicId}`);
  }

  adminUrl(poll: Pick<Poll, "id">) {
    return this.url(`/admin/polls/${poll.id}`);
  }

  manageToken(poll: Pick<Poll, "id" | "manageNonce">) {
    return deriveToken(this.secret, "manage", poll.id, poll.manageNonce);
  }

  async manageUrl(poll: Pick<Poll, "id" | "manageNonce">) {
    return this.url(`/m/${poll.id}/${await this.manageToken(poll)}`);
  }

  async checkManageToken(poll: Pick<Poll, "id" | "manageNonce">, token: string | null | undefined) {
    return !!token && timingSafeEqual(await this.manageToken(poll), token);
  }

  editToken(poll: Pick<Poll, "id">, p: Participant) {
    if (!p.editNonce) throw new Error("participant has no edit nonce");
    return deriveToken(this.secret, "edit", `${poll.id}:${pKey(p.no)}`, p.editNonce);
  }

  async editUrl(poll: Pick<Poll, "id" | "publicId">, p: Participant) {
    return `${this.publicUrl(poll)}#edit=${pKey(p.no)}.${await this.editToken(poll, p)}`;
  }

  async checkEditToken(poll: Pick<Poll, "id">, p: Participant, token: string | null | undefined) {
    return !!token && !!p.editNonce && timingSafeEqual(await this.editToken(poll, p), token);
  }

  agentUrls(poll: Pick<Poll, "publicId">) {
    const pid = poll.publicId;
    return {
      page: this.publicUrl(poll),
      json: this.url(`/api/v1/public/${pid}`),
      markdown: this.url(`/p/${pid}.md`),
      respond: this.url(`/api/v1/public/${pid}/responses`),
      docs: this.url("/llms.txt"),
      openapi: this.url("/openapi.json"),
      mcp: this.url("/mcp"),
    };
  }

  linkHeader(poll: Pick<Poll, "publicId">) {
    const u = this.agentUrls(poll);
    return [
      `<${u.markdown}>; rel="alternate"; type="text/markdown"`,
      `<${u.json}>; rel="alternate"; type="application/json"`,
      `<${u.docs}>; rel="help"; type="text/plain"`,
      `<${u.openapi}>; rel="service-desc"; type="application/json"`,
    ].join(", ");
  }
}

const PUBLIC_ID = /^[A-Za-z0-9_-]{8,64}$/;
const EDIT = /#edit=(p\d+)\.([A-Za-z0-9_-]+)/;
const MANAGE = /\/m\/([0-9A-Z]{26})\/([A-Za-z0-9_-]{20,})/;

/** Accept the share URL (…/p/<id>, .md/.json variants, query or #edit fragment) or the bare id. */
export function parsePublicRef(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  let s = v.trim();
  const m = /\/p\/([A-Za-z0-9_-]+)/.exec(s) ?? /\/api\/v1\/public\/([A-Za-z0-9_-]+)/.exec(s);
  if (m) s = m[1];
  return PUBLIC_ID.test(s) ? s : null;
}

export function parseEditUrl(v: unknown): { publicId: string; participantId: string; token: string } | null {
  if (typeof v !== "string") return null;
  const m = EDIT.exec(v);
  const pid = parsePublicRef(v);
  return m && pid ? { publicId: pid, participantId: m[1], token: m[2] } : null;
}

export function parseManageUrl(v: unknown): { pollId: string; token: string } | null {
  if (typeof v !== "string") return null;
  const m = MANAGE.exec(v.trim());
  return m ? { pollId: m[1], token: m[2] } : null;
}
