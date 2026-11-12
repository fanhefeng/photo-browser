import { useEffect, useRef } from "react";
import type { RefObject } from "react";

const modals: HTMLElement[] = [];

/** Own focus and background isolation for the lifetime of the topmost dialog. */
export function useModalFocus(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const opener = document.activeElement as HTMLElement | null;
    modals.push(box);
    box.focus();
    const background: { element: HTMLElement; inert: boolean; hidden: string | null }[] = [];
    let branch: HTMLElement = box;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        background.push({ element: sibling, inert: sibling.inert, hidden: sibling.getAttribute("aria-hidden") });
        sibling.inert = true;
        sibling.setAttribute("aria-hidden", "true");
      }
      branch = branch.parentElement;
      if (branch === document.body) break;
    }
    const onKey = (event: KeyboardEvent) => {
      if (modals[modals.length - 1] !== box) return;
      const target = event.target as HTMLElement;
      if (event.key === "Escape") {
        // Let the child menu consume its first Escape before closing the dialog.
        if (target.closest?.('[role="combobox"][aria-expanded="true"]')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      } else if (event.key === "Tab") {
        const items = Array.from(box.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, a[href], video[controls], [tabindex]'
        )).filter((item) => item.tabIndex >= 0 && !item.hasAttribute("disabled") &&
          !item.closest('[hidden], [inert], [aria-hidden="true"]') &&
          getComputedStyle(item).display !== "none" && getComputedStyle(item).visibility !== "hidden");
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (!first) { event.preventDefault(); box.focus(); }
        else if (!box.contains(active) || active === box || (event.shiftKey && active === first)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      modals.splice(modals.indexOf(box), 1);
      for (const { element, inert, hidden } of background) {
        element.inert = inert;
        if (hidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", hidden);
      }
      if (opener?.isConnected) opener.focus();
    };
  }, [ref]);
}
