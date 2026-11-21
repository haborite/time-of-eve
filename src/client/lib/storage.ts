/**
 * Web Storage that never throws: storage can be disabled, full, or blocked (private mode, site data off).
 * Reads fall back to the given value; writes are best effort.
 */

type Area = "local" | "session";

function area(a: Area): Storage | null {
  try {
    return a === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadString(a: Area, key: string): string | null {
  try {
    return area(a)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function saveString(a: Area, key: string, value: string): void {
  try {
    area(a)?.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function loadJson<T>(a: Area, key: string, fallback: T): T {
  const s = loadString(a, key);
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function saveJson(a: Area, key: string, value: unknown): void {
  saveString(a, key, JSON.stringify(value));
}

export function remove(a: Area, key: string): void {
  try {
    area(a)?.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}
