/**
 * Documents for AI agents, generated from the same Zod schemas the server validates with:
 * llms.txt (Markdown guide), the poll JSON Schema and an OpenAPI 3.1 description.
 */
import { z } from "zod";
import type { Ctx } from "../app/usecases";
import { LIMITS, PollInput } from "../domain/input";
import { PatchInput, ResponseInput } from "../domain/service";
import LLMS from "./llms.md";

export function guide(ctx: Pick<Ctx, "links" | "settings">): string {
  const anyone = ctx.settings.creation_mode === "anyone";
  return LLMS.replaceAll("{{BASE}}", ctx.links.url())
    .replaceAll("{{TZ}}", ctx.settings.default_timezone)
    .replaceAll("{{MAX_CANDIDATES}}", String(LIMITS.maxCandidates))
    .replaceAll("{{MAX_PARTICIPANTS}}", String(LIMITS.maxPreregistered))
    .replaceAll("{{CREATION}}", anyone
      ? "anyone can create polls without an account (rate limited); the returned manage_url is the organizer's key"
      : "only administrators can create polls (API token or OAuth); anyone can answer")
    .replaceAll("{{MCP_CREATE}}", anyone ? " or for creating polls (the returned manage_url is the key)" : "");
}

function schema(s: z.ZodType) {
  const j = z.toJSONSchema(s, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete j.$schema;
  return j;
}

export function pollJsonSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "time-of-eve poll",
    description: "Body of POST /api/v1/polls and arguments of the MCP tool create_poll. Times: local \"YYYY-MM-DDTHH:MM\" in `timezone` (or ISO 8601 with the correct offset).",
    ...schema(PollInput.extend({ publish: z.boolean().optional(), dry_run: z.boolean().optional() })),
    required: ["title"],
  };
}

export function openApi(base: string) {
  const err = { $ref: "#/components/schemas/Error" };
  const json = (s: unknown) => ({ content: { "application/json": { schema: s } } });
  const errors = { "4XX": { description: "Error", ...json(err) } };
  const obj = { type: "object", additionalProperties: true };
  const pollId = { name: "poll_id", in: "path", required: true, schema: { type: "string" }, description: "poll_id (26 characters) from create" };
  const publicId = { name: "public_id", in: "path", required: true, schema: { type: "string" } };
  const manage = [{ manageToken: [] }, { bearer: [] }];
  const op = (operationId: string, summary: string, extra: Record<string, unknown> = {}) => ({ operationId, summary, responses: { 200: { description: "OK", ...json(obj) }, ...errors }, ...extra });
  return {
    openapi: "3.1.0",
    info: {
      title: "time-of-eve API", version: "1.0.0",
      description: `Scheduling polls for humans and AI agents. Guide: ${base}/llms.txt. Organizer endpoints: X-Manage-Token (from manage_url) or administrator bearer token. Participant endpoints need no auth.`,
    },
    servers: [{ url: `${base}/api/v1` }],
    components: {
      securitySchemes: {
        manageToken: { type: "apiKey", in: "header", name: "X-Manage-Token", description: "Last path segment of manage_url" },
        bearer: { type: "http", scheme: "bearer", description: "Administrator API token (sch_…) or OAuth access token" },
        editToken: { type: "apiKey", in: "header", name: "X-Edit-Token" },
      },
      schemas: {
        Poll: pollJsonSchema(),
        Patch: schema(PatchInput),
        Response: schema(ResponseInput),
        Error: {
          type: "object",
          properties: {
            error: { type: "object", properties: { code: { type: "string" }, field: { type: "string" }, message: { type: "string" }, hint: { type: "string" } } },
            errors: { type: "array", items: { type: "object" } }, warnings: { type: "array", items: { type: "object" } }, docs: { type: "string" },
          },
        },
      },
    },
    paths: {
      "/polls": {
        post: op("createPoll", "Create a poll (publish: true to open it; dry_run: true to validate only). Returns public_url and manage_url.", {
          security: [{}, { bearer: [] }], requestBody: { required: true, ...json({ $ref: "#/components/schemas/Poll" }) },
          responses: { 201: { description: "Created", ...json(obj) }, 200: { description: "Idempotent replay or dry run", ...json(obj) }, ...errors },
        }),
        get: op("listPolls", "List polls (administrators)", { security: [{ bearer: [] }] }),
      },
      "/polls/{poll_id}": {
        get: op("getPoll", "Poll details and results summary", { parameters: [pollId], security: manage }),
        patch: op("updatePoll", "Edit a poll", { parameters: [pollId], security: manage, requestBody: { required: true, ...json({ $ref: "#/components/schemas/Patch" }) } }),
        delete: op("deletePoll", "Delete a poll permanently", { parameters: [pollId], security: manage }),
      },
      "/polls/{poll_id}/results": {
        get: op("getResults", "Tally and ranking", { parameters: [pollId, { name: "view", in: "query", schema: { enum: ["summary", "full"] } }], security: manage }),
      },
      ...Object.fromEntries(["publish", "close", "reopen", "finalize", "unfinalize", "cancel", "rotate-manage-link"].map((a) => [`/polls/{poll_id}/${a}`, {
        post: op(`${a.replace(/-(\w)/g, (_, x) => x.toUpperCase())}Poll`, a === "finalize" ? "Fix the date: {candidate_id, version?}" : a === "reopen" ? "Reopen: {response_deadline?}" : `${a} the poll`, {
          parameters: [pollId], security: manage,
          requestBody: { required: false, ...json(a === "finalize" ? { type: "object", required: ["candidate_id"], properties: { candidate_id: { type: "string" }, version: { type: "integer" } } } : a === "reopen" ? { type: "object", properties: { response_deadline: { type: "string" } } } : obj) },
        }),
      }])),
      "/polls/{poll_id}/participants/{participant_id}/reissue-edit-link": {
        post: op("reissueEditLink", "New edit_url for a participant (old one stops working)", {
          parameters: [pollId, { name: "participant_id", in: "path", required: true, schema: { type: "string" } }], security: manage,
        }),
      },
      "/public/{public_id}": { get: op("getPublicPoll", "Public view of a poll (no auth)", { parameters: [publicId], security: [{}] }) },
      "/public/{public_id}/responses": {
        post: op("submitResponse", "Answer a poll (no auth). Returns edit_url (secret).", {
          parameters: [publicId], security: [{}], requestBody: { required: true, ...json({ $ref: "#/components/schemas/Response" }) },
          responses: { 201: { description: "Created", ...json(obj) }, ...errors },
        }),
      },
      "/public/{public_id}/responses/{response_id}": {
        get: op("getMyResponse", "Read own answer", { parameters: [publicId, { name: "response_id", in: "path", required: true, schema: { type: "string" } }], security: [{ editToken: [] }] }),
        patch: op("updateMyResponse", "Change own answer (answers merge; null clears; replace_all)", {
          parameters: [publicId, { name: "response_id", in: "path", required: true, schema: { type: "string" } }], security: [{ editToken: [] }],
          requestBody: { required: true, ...json({ $ref: "#/components/schemas/Response" }) },
        }),
      },
    },
  };
}
