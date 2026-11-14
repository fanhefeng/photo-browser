import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import "../i18n";
import { DetailPanel } from "./media";
import { revealInFinder } from "../api";
import type { MediaItem } from "../types";
vi.mock("../api", () => ({ revealInFinder: vi.fn(), openExternal: vi.fn() }));
const photo = {
  id: "1",
  path: "/photos/test.jpg",
  filename: "test.jpg",
  kind: "photo",
  ext: "jpg",
  file_size: 1,
  mtime: 0,
} as MediaItem;
beforeEach(() => vi.clearAllMocks());
it("keeps reveal failure visible and lets the user retry", async () => {
  vi.mocked(revealInFinder)
    .mockRejectedValueOnce(new Error("missing"))
    .mockResolvedValueOnce(undefined);
  render(<DetailPanel photo={photo} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /访达/ }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(revealInFinder).toHaveBeenCalledTimes(2);
});
it("ignores a previous photo's late error", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(revealInFinder).mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const { rerender } = render(<DetailPanel photo={photo} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /访达/ }));
  rerender(<DetailPanel photo={{ ...photo, id: "2", path: "/other.jpg" }} onClose={() => {}} />);
  await act(async () => reject(new Error("late")));
  expect(screen.queryByRole("alert")).toBeNull();
});
