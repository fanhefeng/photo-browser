import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

interface Option<T extends string> {
  value: T;
  label: string;
}

/** Select-only combobox: focus stays on the trigger while exploring the list. */
export default function Select<T extends string>({
  id, label, value, options, onChange,
}: {
  id?: string;
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const query = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false);
  const selected = Math.max(0, options.findIndex((option) => option.value === value));
  const [active, setActive] = useState(selected);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 160, maxHeight: 264 });

  const show = (index = selected) => {
    setActive(index);
    setOpen(true);
    query.current = { text: "", time: 0 };
  };
  const commit = (index: number) => {
    if (options[index] && options[index].value !== value) onChange(options[index].value);
    setOpen(false);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const trigger = triggerRef.current;
    if (!list || !trigger) return;
    // Top layer prevents clipping by a scrolling settings dialog. Older WebViews
    // use the same fixed-position menu without the popover enhancement.
    if (typeof list.showPopover === "function" && !list.matches(":popover-open")) list.showPopover();
    const place = () => {
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 160), window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 14;
      const above = rect.top - 14;
      const upward = below < Math.min(list.scrollHeight, 200) && above > below;
      const maxHeight = Math.max(32, Math.min(264, upward ? above : below));
      const height = Math.min(list.scrollHeight, maxHeight);
      const next = {
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: upward ? rect.top - height - 6 : rect.bottom + 6,
        width, maxHeight,
      };
      setPosition((previous) => Object.keys(next).every((key) =>
        previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(trigger);
    observer.observe(list);
    window.addEventListener("resize", place);
    const onScroll = (event: Event) => {
      if (event.target !== list) setOpen(false);
    };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const blur = () => setOpen(false);
    document.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("blur", blur);
    };
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey) return;
    const last = options.length - 1;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        if (!open) show();
        else if (event.altKey && event.key === "ArrowUp") commit(active);
        else setActive((index) => Math.max(0, Math.min(last, index + (event.key === "ArrowDown" ? 1 : -1))));
        return;
      case "Home":
      case "End":
        event.preventDefault();
        if (!open) show(event.key === "Home" ? 0 : last);
        else setActive(event.key === "Home" ? 0 : last);
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open) commit(active);
        else show();
        return;
      case "Escape":
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
        return;
      case "Tab":
        if (open) commit(active);
        return;
    }
    if (event.key.length !== 1 || event.altKey) return;
    event.preventDefault();
    const now = Date.now();
    const text = (now - query.current.time < 600 ? query.current.text : "") + event.key.toLocaleLowerCase();
    query.current = { text, time: now };
    const repeated = text.split("").every((char) => char === text[0]);
    const needle = repeated ? text[0] : text;
    const start = open ? active : selected;
    const match = options.findIndex((_, offset) => {
      const index = (start + offset + (repeated ? 1 : 0)) % options.length;
      return options[index].label.toLocaleLowerCase().startsWith(needle);
    });
    if (match >= 0) {
      setActive((start + match + (repeated ? 1 : 0)) % options.length);
      setOpen(true);
    }
  };

  return (
    <div className="select-control" ref={rootRef}>
      <span className="select-control__sizer" aria-hidden="true">
        {options.map((option) => <span key={option.value}>{option.label}</span>)}
      </span>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        className="select-control__trigger"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={() => { triggerRef.current?.focus(); if (open) setOpen(false); else show(); }}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      >
        <span>{options[selected]?.label}</span>
      </button>
      {open && (
        <div ref={listRef} id={listId} role="listbox" aria-label={label}
          popover={typeof HTMLElement.prototype.showPopover === "function" ? "manual" : undefined} className="select-menu" style={position}>
          {options.map((option, index) => (
            <div key={option.value} id={`${listId}-${index}`} role="option"
              aria-selected={option.value === value}
              data-active={index === active}
              className="select-menu__option"
              onPointerMove={() => setActive(index)}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => commit(index)}>
              <span>{option.label}</span>
              {option.value === value && (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="m3 7 2.5 2.5L11 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
