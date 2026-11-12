const STORAGE_KEY = "photo-browser.recent-folders";
const MAX_FOLDERS = 5;

function clean(paths: unknown): string[] {
  if (!Array.isArray(paths)) return [];
  return [...new Set(paths.filter((path): path is string =>
    typeof path === "string" && path.length <= 4096 &&
    (path.startsWith("/") || /^[a-z]:[\\/]/i.test(path))
  ))].slice(0, MAX_FOLDERS);
}

export function readRecentFolders(): string[] {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return data?.version === 1 ? clean(data.paths) : [];
  } catch {
    return [];
  }
}

export function rememberFolder(path: string): string[] {
  const paths = clean([path, ...readRecentFolders()]);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, paths }));
  } catch { /* Storage restrictions do not block opening a folder. */ }
  return paths;
}

export function clearRecentFolders(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* The current UI can still clear. */ }
}
