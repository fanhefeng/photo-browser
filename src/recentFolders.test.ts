import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { clearRecentFolders, readRecentFolders, rememberFolder } from "./recentFolders";

const key = "photo-browser.recent-folders";
beforeEach(clearRecentFolders);
afterEach(() => { vi.restoreAllMocks(); clearRecentFolders(); });

describe("recent folders", () => {
  it("keeps the five most recent unique paths and moves a reopened folder first", () => {
    for (let i = 0; i < 7; i++) rememberFolder(`/Photos/${i}`);
    expect(readRecentFolders()).toEqual(["/Photos/6", "/Photos/5", "/Photos/4", "/Photos/3", "/Photos/2"]);
    rememberFolder("/Photos/4");
    expect(readRecentFolders()).toEqual(["/Photos/4", "/Photos/6", "/Photos/5", "/Photos/3", "/Photos/2"]);
    clearRecentFolders();
    expect(readRecentFolders()).toEqual([]);
  });

  it("rejects corrupt or unknown data and preserves valid Unicode paths", () => {
    localStorage.setItem(key, "not json");
    expect(readRecentFolders()).toEqual([]);
    localStorage.setItem(key, JSON.stringify({ version: 2, paths: ["/Photos"] }));
    expect(readRecentFolders()).toEqual([]);
    localStorage.setItem(key, JSON.stringify({ version: 1, paths: [null, "relative", "/照片/旅行", "/照片/旅行", "C:\\Photos", 12] }));
    expect(readRecentFolders()).toEqual(["/照片/旅行", "C:\\Photos"]);
  });

  it("does not block opening when persistent storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("unavailable"); });
    expect(rememberFolder("/Photos")).toEqual(["/Photos"]);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("unavailable"); });
    expect(readRecentFolders()).toEqual([]);
  });
});
