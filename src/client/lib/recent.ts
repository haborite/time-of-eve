/**
 * Polls opened in this browser, listed on the top page ("この端末で開いた日程調整").
 * Kept only in localStorage; written by the public page and the organizer page, read by the top page.
 */
import { loadJson, remove, saveJson } from "./storage";

const KEY = "toe-recent";
const MAX = 20;

export interface RecentPoll {
  /** Public id for a public page, the manage path for an organizer page. One entry per id. */
  id: string;
  title: string;
  /** Same-origin path to open. */
  url: string;
  organizer?: boolean;
  /** When it was last opened (epoch ms). */
  at: number;
}

function isRecent(x: unknown): x is RecentPoll {
  const r = x as RecentPoll;
  return !!r && typeof r.id === "string" && typeof r.url === "string" && r.url.startsWith("/") && !r.url.startsWith("//");
}

export function recentPolls(): RecentPoll[] {
  const list = loadJson<unknown>("local", KEY, []);
  return Array.isArray(list) ? list.filter(isRecent) : [];
}

/** Move (or add) a poll to the top of the list. */
export function rememberPoll(p: Omit<RecentPoll, "at">): void {
  const list = recentPolls().filter((x) => x.id !== p.id);
  list.unshift({ ...p, at: Date.now() });
  saveJson("local", KEY, list.slice(0, MAX));
}

export function clearRecent(): void {
  remove("local", KEY);
}
