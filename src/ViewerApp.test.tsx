// 查看器的删除流程。这里每一条断言对应一个"错了不会崩、只会悄悄干坏事"的场景：
// 下标算错 = 删完跳到了别的照片；不按 path 重定位 = await 期间用户导航后删错文件；
// 漏了 e.repeat 守卫 = 按住退格键一次误按连删好几个文件（且都进了废纸篓）。
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SiblingItem } from "./api";

const close = vi.fn();
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "viewer",
    close,
    setFullscreen: vi.fn().mockResolvedValue(undefined),
    isFullscreen: vi.fn().mockResolvedValue(false),
    onResized: vi.fn().mockResolvedValue(() => {}),
    startDragging: vi.fn(),
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("./api", () => ({
  listSiblings: vi.fn(),
  viewerTrash: vi.fn(),
  viewerItem: vi.fn().mockResolvedValue(null),
  viewerPreview: vi.fn().mockResolvedValue("id"),
  takePendingOpen: vi.fn().mockResolvedValue(["/dir/b.jpg"]),
  setLocale: vi.fn().mockResolvedValue(undefined),
  originalSrc: (p: string) => p,
  videoSrc: (p: string) => p,
  vpreviewUrl: (id: string) => id,
  revealInFinder: vi.fn(),
  openExternal: vi.fn(),
}));

import { listSiblings, viewerTrash } from "./api";
import ViewerApp from "./ViewerApp";

const photo = (name: string): SiblingItem => ({
  path: `/dir/${name}`,
  filename: name,
  ext: "jpg",
  kind: "photo",
});

/** 渲染并等到兄弟列表就位；返回当前显示的文件名读取器 */
async function mountViewer(items: SiblingItem[], index: number) {
  vi.mocked(listSiblings).mockResolvedValue({ items, index });
  render(<ViewerApp />);
  // 顶栏显示 "当前/总数"，以此确认列表已载入
  await screen.findByText(`${index + 1} / ${items.length}`);
}

/** 顶栏里正在显示的文件名 */
const shownName = () => document.querySelector(".viewer__name")?.textContent;
/** 顶栏里的 "i / n" 计数 */
const shownCount = () => document.querySelector(".viewer__count")?.textContent;

const pressDelete = (opts: KeyboardEventInit = {}) =>
  fireEvent.keyDown(window, { key: "Backspace", ...opts });

describe("ViewerApp 删除", () => {
  beforeEach(() => {
    close.mockClear();
    vi.mocked(viewerTrash).mockReset().mockResolvedValue(undefined);
  });

  it("删掉中间一张后停在原位，也就是顺位的下一张", async () => {
    await mountViewer([photo("a.jpg"), photo("b.jpg"), photo("c.jpg")], 1);
    expect(shownName()).toBe("b.jpg");

    pressDelete();

    await waitFor(() => expect(shownCount()).toBe("2 / 2"));
    // 下标仍是 1，但列表少了 b，所以现在显示的是 c——符合"删完看下一张"的直觉
    expect(shownName()).toBe("c.jpg");
    expect(viewerTrash).toHaveBeenCalledWith("/dir/b.jpg");
  });

  it("删掉最后一张后回退到新的最后一张，下标不越界", async () => {
    await mountViewer([photo("a.jpg"), photo("b.jpg")], 1);
    expect(shownName()).toBe("b.jpg");

    pressDelete();

    await waitFor(() => expect(shownCount()).toBe("1 / 1"));
    expect(shownName()).toBe("a.jpg");
  });

  it("删掉唯一一张后关窗，而不是停在空白界面", async () => {
    await mountViewer([photo("only.jpg")], 0);

    pressDelete();

    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it("await 期间用户导航走了，删的仍是原来那张、下标不跳", async () => {
    await mountViewer([photo("a.jpg"), photo("b.jpg"), photo("c.jpg")], 0);
    expect(shownName()).toBe("a.jpg");

    // 让删除悬在半空，模拟慢速废纸篓操作
    let finish!: () => void;
    vi.mocked(viewerTrash).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );

    pressDelete();
    await waitFor(() => expect(viewerTrash).toHaveBeenCalledWith("/dir/a.jpg"));

    // 删除还没回来，用户已经按右键翻到了 c
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(shownName()).toBe("c.jpg");

    finish();

    // a 被移除后列表是 [b, c]，用户看的 c 必须还是 c——
    // 若按捕获时的下标 0 去改，用户会莫名其妙被弹回 b
    await waitFor(() => expect(shownCount()).toBe("2 / 2"));
    expect(shownName()).toBe("c.jpg");
  });

  it("按住退格键不放只删一张（重复事件被挡掉）", async () => {
    await mountViewer([photo("a.jpg"), photo("b.jpg"), photo("c.jpg")], 0);

    // 系统按住不放会以约 30/秒 的重复率连发 keydown，只有第一发 repeat=false。
    // 关键是后续几发要发生在**上一次删除已经完成之后**——否则挡住它们的是
    // trashing 这个在途守卫，而不是 e.repeat，这条用例也就测不到想测的东西。
    pressDelete();
    await waitFor(() => expect(shownCount()).toBe("1 / 2"));
    expect(shownName()).toBe("b.jpg");

    pressDelete({ repeat: true });
    pressDelete({ repeat: true });
    pressDelete({ repeat: true });
    await new Promise((r) => setTimeout(r, 30));

    // 一次误按住不该连着把 b、c 也送进废纸篓
    expect(viewerTrash).toHaveBeenCalledTimes(1);
    expect(shownCount()).toBe("1 / 2");
    expect(shownName()).toBe("b.jpg");
  });

  it("删除失败时报错并保留该文件，不把它从列表里抹掉", async () => {
    await mountViewer([photo("a.jpg"), photo("b.jpg")], 0);
    vi.mocked(viewerTrash).mockRejectedValue(new Error("权限不足"));

    pressDelete();

    await waitFor(() => expect(document.querySelector(".viewer__error")).not.toBeNull());
    expect(shownCount()).toBe("1 / 2");
    expect(shownName()).toBe("a.jpg");
  });
});
