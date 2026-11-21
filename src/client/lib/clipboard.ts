/** Copy buttons: <button data-copy="#selector"> copies that input's value (or element's text). */
import { closest } from "./dom";
import { T } from "./i18n";

function legacyCopy(target: Element): void {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) target.select();
  document.execCommand("copy");
}

function copyFrom(target: Element): Promise<void> {
  const isField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  const text = isField ? target.value : target.textContent ?? "";
  if (isField) target.select();
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).catch(() => legacyCopy(target));
  }
  legacyCopy(target);
  return Promise.resolve();
}

/** Show "コピーしました" on the button for a moment (repeated clicks keep the original label). */
function flash(btn: HTMLElement): void {
  const orig = btn.dataset.label ?? (btn.dataset.label = btn.textContent ?? "");
  btn.textContent = T("コピーしました");
  clearTimeout(Number(btn.dataset.timer));
  btn.dataset.timer = String(setTimeout(() => { btn.textContent = orig; }, 1500));
}

/** Handle every [data-copy] button on the page (event delegation). */
export function bindCopyButtons(): void {
  document.addEventListener("click", (e) => {
    const b = closest(e.target, "[data-copy]");
    if (!b) return;
    e.preventDefault();
    const target = document.querySelector(b.dataset.copy ?? "");
    if (!target) return;
    void copyFrom(target).then(() => flash(b));
  });
}
