// 主窗口的查询编排。这里三条逻辑都属于"坏了也不报错、只是显示错东西"：
// 在途请求乱序覆盖、列表被换掉后大图指向别的照片、结果被上限截断而无提示。
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Facets, MediaItem, QueryResult } from "./types";

// 事件监听器留个登记簿，测试才能把 scan-done 这类后端事件真的送达前端。
// 不送的话 App 会一直卡在扫描态，工具栏显示进度条而非搜索框。
const { listeners } = vi.hoisted(() => ({
  listeners: new Map<string, (e: { payload: unknown }) => void>(),
}));
const emit = (name: string, payload: unknown = {}) =>
  act(() => {
    listeners.get(name)?.({ payload });
  });

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main", startDragging: vi.fn() }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, cb: (e: { payload: unknown }) => void) => {
    listeners.set(name, cb);
    return Promise.resolve(() => listeners.delete(name));
  }),
}));
vi.mock("./api", () => ({
  queryPhotos: vi.fn(),
  getFacets: vi.fn(),
  pickDirectory: vi.fn(),
  scanDirectory: vi.fn().mockResolvedValue(0),
  cancelScan: vi.fn().mockResolvedValue(undefined),
  videoSupport: vi.fn().mockResolvedValue(true),
  appInfo: vi.fn().mockResolvedValue({}),
  setLocale: vi.fn().mockResolvedValue(undefined),
  dragWindow: vi.fn(),
  ensurePreview: vi.fn().mockResolvedValue(false),
  revealInFinder: vi.fn(),
  openExternal: vi.fn(),
  thumbUrl: (id: string) => id,
  previewUrl: (id: string) => id,
  originalSrc: (p: string) => p,
  videoSrc: (p: string) => p,
}));
// 虚拟滚动在 jsdom 里量不到尺寸、会渲染 0 个格子，换成直白的按钮列表。
// 保留真实 PhotoGrid 对外的两点契约：aria-label 文案与 onSelect(下标)。
vi.mock("./components/PhotoGrid", () => ({
  default: ({ photos, onSelect }: { photos: MediaItem[]; onSelect: (i: number) => void }) => (
    <div data-testid="grid">
      {photos.map((p, i) => (
        <button key={p.id} aria-label={`查看 ${p.filename}`} onClick={() => onSelect(i)}>
          {p.filename}
        </button>
      ))}
    </div>
  ),
}));

import { getFacets, pickDirectory, queryPhotos } from "./api";
import App from "./App";

const item = (id: string): MediaItem => ({
  id,
  path: `/lib/${id}.jpg`,
  filename: `${id}.jpg`,
  dir: "/lib",
  ext: "jpg",
  kind: "photo",
  file_size: 1,
  mtime: 1,
  width: null,
  height: null,
  duration: null,
  taken_at: null,
  camera_make: null,
  camera_model: null,
  lens: null,
  iso: null,
  aperture: null,
  shutter: null,
  focal_length: null,
  gps_lat: null,
  gps_lon: null,
  orientation: null,
});

const result = (ids: string[], truncated = false): QueryResult => ({
  items: ids.map(item),
  truncated,
});

const emptyFacets: Facets = { total: 0, groups: [] };

const grid = () =>
  Array.from(screen.getByTestId("grid").querySelectorAll("button"))
    .map((b) => b.textContent)
    .join(",");

/** 走一遍"选目录 → 扫描结束"，让 App 进入可搜索的常态并完成首次查询 */
async function openFolder(first: QueryResult) {
  vi.mocked(pickDirectory).mockResolvedValue("/lib");
  vi.mocked(queryPhotos).mockResolvedValue(first);
  render(<App />);
  fireEvent.click(screen.getByText("打开文件夹"));
  // 后端扫完才会退出扫描态，工具栏这时才从进度条切回搜索框
  await waitFor(() => expect(listeners.has("scan-done")).toBe(true));
  emit("scan-done", { processed: first.items.length, cancelled: false, failed: 0, walk_errors: 0 });
  await screen.findByTestId("grid");
  await waitFor(() => expect(grid()).toBe(first.items.map((p) => p.filename).join(",")));
  await screen.findByPlaceholderText("按文件名搜索…");
  vi.mocked(queryPhotos).mockClear();
}

describe("App 查询编排", () => {
  beforeEach(() => {
    vi.mocked(getFacets).mockResolvedValue(emptyFacets);
    vi.mocked(queryPhotos).mockReset();
    vi.mocked(pickDirectory).mockReset();
  });

  it("慢的旧响应后到时不覆盖新结果", async () => {
    await openFolder(result(["a"]));

    // 两次查询：先发的慢、后发的快，回来的顺序与发出的顺序相反
    let releaseSlow!: (v: QueryResult) => void;
    vi.mocked(queryPhotos)
      .mockImplementationOnce(
        () =>
          new Promise<QueryResult>((resolve) => {
            releaseSlow = resolve;
          })
      )
      .mockResolvedValueOnce(result(["new"]));

    // 分两拍触发，否则 120ms 防抖会把两次合并成一次查询
    const search = screen.getByPlaceholderText("按文件名搜索…");
    fireEvent.change(search, { target: { value: "x" } });
    await waitFor(() => expect(queryPhotos).toHaveBeenCalledTimes(1));
    fireEvent.change(search, { target: { value: "xy" } });
    await waitFor(() => expect(grid()).toBe("new.jpg"));

    // 迟到的旧响应现在才回来，必须被丢弃
    releaseSlow(result(["stale"]));
    await new Promise((r) => setTimeout(r, 20));
    expect(grid()).toBe("new.jpg");
  });

  it("列表被换掉后大图按 id 重定位，不指向另一张照片", async () => {
    await openFolder(result(["a", "b", "c"]));

    // 打开第 2 张（b）的大图
    fireEvent.click(screen.getByLabelText("查看 b.jpg"));
    expect(await screen.findByRole("dialog", { name: "b.jpg" })).toBeTruthy();

    // 重扫后 a 没了，b 从下标 1 挪到了 0
    vi.mocked(queryPhotos).mockResolvedValue(result(["b", "c"]));
    fireEvent.change(screen.getByPlaceholderText("按文件名搜索…"), {
      target: { value: "b" },
    });

    await waitFor(() => expect(grid()).toBe("b.jpg,c.jpg"));
    // 仍然是 b：若按旧下标 1 硬取，用户会莫名其妙被切到 c
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("b.jpg");
  });

  it("大图那张照片没了就关掉大图，而不是滑到别的照片上", async () => {
    await openFolder(result(["a", "b"]));

    fireEvent.click(screen.getByLabelText("查看 b.jpg"));
    expect(await screen.findByRole("dialog", { name: "b.jpg" })).toBeTruthy();

    vi.mocked(queryPhotos).mockResolvedValue(result(["a"]));
    fireEvent.change(screen.getByPlaceholderText("按文件名搜索…"), {
      target: { value: "a" },
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("结果被上限截断时给出提示，不让用户以为看到了全部", async () => {
    await openFolder(result(["a", "b"], true));

    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("2");
    expect(banner.textContent).toContain("缩小范围");
  });

  it("没截断就不打扰用户", async () => {
    await openFolder(result(["a", "b"], false));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
