/** Public answer page: the public API and the edit tokens kept in this browser. */
import type { Answer, SlotKey } from "../../shared/public-boot";
import { LANG } from "../lib/i18n";
import { loadJson, saveJson } from "../lib/storage";

export interface ApiError {
  error?: { code?: string; message?: string };
}

export interface ResponseBody {
  display_name: string;
  comment?: string | null;
  slots?: Record<SlotKey, Answer>;
}

export interface CreatedBody {
  response_id: string;
  edit_token: string;
  edit_url: string;
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  /** The JSON body ({} when there is none); on errors it carries `error`. */
  body: Partial<T> & ApiError;
}

export interface AnswerBody {
  slots: Record<SlotKey, Answer>;
  comment: string;
  participant_id?: string;
  display_name?: string;
}

export function createApi(base: string) {
  function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { "Content-Type": "application/json", "X-UI-Lang": LANG };
    if (token) headers["X-Edit-Token"] = token;
    return fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" })
      .then((r) => r.json().catch(() => ({})).then((j: Partial<T> & ApiError) => ({ ok: r.ok, status: r.status, body: j })));
  }
  const res = (id: string) => "/responses/" + encodeURIComponent(id);
  return {
    getResponse: (id: string, token: string) => call<ResponseBody>("GET", res(id), undefined, token),
    createResponse: (body: AnswerBody) => call<CreatedBody>("POST", "/responses", body),
    updateResponse: (id: string, token: string, body: AnswerBody) => call<ResponseBody>("PATCH", res(id), body, token),
  };
}

/** An answer made from this browser, so it can be edited again without the edit link. */
export interface MyAnswer {
  id: string;
  token: string;
  name: string;
}

export function myAnswers(publicId: string) {
  const key = "toe-edit-" + publicId;
  const list = (): MyAnswer[] => {
    const v = loadJson<unknown>("local", key, []);
    return Array.isArray(v) ? (v as MyAnswer[]).filter((x) => x && typeof x.id === "string" && typeof x.token === "string") : [];
  };
  return {
    list,
    remember(a: MyAnswer): void {
      saveJson("local", key, [...list().filter((x) => x.id !== a.id), a]);
    },
  };
}
