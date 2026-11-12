import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { useRef, useState } from "react";
import Select from "./Select";
import { useModalFocus } from "../hooks/useModalFocus";

const options = [
  { value: "time", label: "Date taken" },
  { value: "name", label: "File name" },
  { value: "size", label: "File size" },
];

function Field({ onChange = () => {} }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState("time");
  return <Select label="Sort" value={value} options={options} onChange={(next) => { setValue(next); onChange(next); }} />;
}

describe("themed select", () => {
  it("explores with arrows, cancels without changing the value, and commits once", () => {
    const change = vi.fn();
    render(<Field onChange={change} />);
    const trigger = screen.getByRole("combobox");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "End" });
    expect(trigger.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "File size" }).id);
    expect(change).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger.textContent).toBe("Date taken");
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(change).toHaveBeenCalledExactlyOnceWith("name");
    expect(trigger.textContent).toBe("File name");
    expect(document.activeElement).toBe(trigger);
  });

  it("supports typeahead, Tab commit, pointer selection, and outside dismissal", () => {
    const change = vi.fn();
    render(<><Field onChange={change} /><button>Outside</button></>);
    const trigger = screen.getByRole("combobox");
    fireEvent.keyDown(trigger, { key: "f" });
    fireEvent.keyDown(trigger, { key: "f" });
    expect(trigger.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "File size" }).id);
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    fireEvent(trigger, tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(change).toHaveBeenLastCalledWith("size");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "File name" }));
    expect(change).toHaveBeenLastCalledWith("name");
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByText("Outside"));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(change).toHaveBeenCalledTimes(2);
  });
});

function Dialog({ close }: { close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(ref, close);
  return <div ref={ref} role="dialog" tabIndex={-1}><button>First</button><Field /><button>Last</button></div>;
}

it("closes the menu before the dialog, traps Tab, and restores background and focus", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Open</button>{open && <Dialog close={() => setOpen(false)} />}</>;
  }
  render(<Harness />);
  const opener = screen.getByText("Open");
  opener.focus();
  fireEvent.click(opener);
  expect(opener.getAttribute("aria-hidden")).toBe("true");
  const trigger = screen.getByRole("combobox");
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(screen.getByRole("dialog")).toBeTruthy();
  screen.getByText("Last").focus();
  fireEvent.keyDown(document.activeElement!, { key: "Tab" });
  expect(document.activeElement).toBe(screen.getByText("First"));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
  expect(opener.getAttribute("aria-hidden")).toBeNull();
  expect((opener as HTMLElement).inert).toBeFalsy();
});

it("keeps dialog focus through rerenders and uses the latest close callback", () => {
  const previous = vi.fn();
  const latest = vi.fn();
  const { rerender } = render(<Dialog close={previous} />);
  const trigger = screen.getByRole("combobox");
  trigger.focus();
  rerender(<Dialog close={latest} />);
  expect(document.activeElement).toBe(trigger);
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(previous).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledOnce();
});
