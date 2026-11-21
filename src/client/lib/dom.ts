/** Small DOM helpers shared by the page scripts. */

/** Element by id that the page always renders; throws if it is missing (a template / script mismatch). */
export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

/** Element by id that only some states of the page render. */
export function $opt<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function button(cls: string, text: string, onClick?: () => void): HTMLButtonElement {
  const b = el("button", cls, text);
  b.type = "button";
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

export function option(value: string | number, text: string): HTMLOptionElement {
  const o = el("option", "", text);
  o.value = String(value);
  return o;
}

export const pad = (n: number): string => String(n).padStart(2, "0");

/** JSON embedded by the server as <script type="application/json" id="…">. */
export function readJson<T>(id: string, fallback: T): T {
  try {
    const e = document.getElementById(id);
    return e && e.textContent ? (JSON.parse(e.textContent) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Closest ancestor (or self) of an event target matching a selector. */
export function closest<T extends Element = HTMLElement>(target: EventTarget | null, selector: string): T | null {
  return target instanceof Element ? (target.closest(selector) as T | null) : null;
}

/** Element matching `selector` under the pointer (pointer capture keeps e.target on the grid while dragging). */
export function elementAt<T extends Element = HTMLElement>(x: number, y: number, selector: string): T | null {
  return closest<T>(document.elementFromPoint(x, y), selector);
}

/** Roving tabindex: make `cell` the only tabbable one of `cells` and focus it. */
export function focusOnly(cells: Iterable<HTMLElement>, cell: HTMLElement): void {
  for (const c of cells) c.tabIndex = -1;
  cell.tabIndex = 0;
  cell.focus({ preventScroll: true });
}

/** Pointer capture for the drag-painting grids (fails harmlessly if the pointer is already gone). */
export function capturePointer(host: Element, id: number): void {
  try {
    host.setPointerCapture(id);
  } catch {
    /* pointer already gone */
  }
}

export function releasePointer(host: Element, id: number): void {
  try {
    host.releasePointerCapture(id);
  } catch {
    /* not captured */
  }
}
