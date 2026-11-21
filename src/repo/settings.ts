/** Site settings (admin dashboard), stored as JSON values in the `settings` table with defaults in code. */
import { inArray, sql } from "drizzle-orm";
import * as s from "../db/schema";
import { isValidTimeZone } from "../shared/time";
import type { DB } from "./polls";

export interface Settings {
  /** "admin_only": only logged-in administrators create polls. "anyone": visitors too (no login). */
  creation_mode: "admin_only" | "anyone";
  /** Delete polls created without login this many days after their last candidate (0 = keep forever). */
  retention_days: number;
  default_timezone: string;
  /** Shown on the legal pages / footer. */
  operator_name: string;
  contact: string;
  /** Draw a share image per poll (satori + resvg). Off: every page uses the static /static/og-default.png. */
  og_dynamic: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  creation_mode: "admin_only",
  retention_days: 180,
  default_timezone: "Asia/Tokyo",
  operator_name: "",
  contact: "",
  og_dynamic: false,
};

const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

export async function getSettings(d: DB): Promise<Settings> {
  const rows = await d.select().from(s.settings).where(inArray(s.settings.key, KEYS));
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      /* keep default */
    }
  }
  return sanitize(out);
}

export function sanitize(v: Record<string, unknown>): Settings {
  const o = { ...DEFAULT_SETTINGS };
  if (v.creation_mode === "anyone" || v.creation_mode === "admin_only") o.creation_mode = v.creation_mode;
  const days = Number(v.retention_days);
  if (Number.isInteger(days) && days >= 0 && days <= 3650) o.retention_days = days;
  if (isValidTimeZone(v.default_timezone)) o.default_timezone = v.default_timezone;
  if (typeof v.operator_name === "string") o.operator_name = v.operator_name.trim().slice(0, 200);
  if (typeof v.contact === "string") o.contact = v.contact.trim().slice(0, 500);
  if (typeof v.og_dynamic === "boolean") o.og_dynamic = v.og_dynamic;
  return o;
}

export async function saveSettings(d: DB, next: Settings): Promise<void> {
  const now = Date.now();
  await d.batch(KEYS.map((k) => d.insert(s.settings).values({ key: k, value: JSON.stringify(next[k]), updatedAt: now })
    .onConflictDoUpdate({ target: s.settings.key, set: { value: sql`excluded.value`, updatedAt: now } })) as never);
}
