// 应用内更新横幅：prod 启动后静默检查一次，原生菜单「检查更新…」可随时手动触发
// （广播 check-update-requested 事件）。检查/下载/minisign 验签/替换 .app 全在
// Rust 侧（tauri-plugin-updater）完成，端点与公钥见 tauri.conf.json 的 plugins.updater；
// 下载不经浏览器，更新后的 App 不带 quarantine 属性，无需重跑 xattr。
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useTranslation } from "react-i18next";
import { getSettings } from "../settings";
import { CloseIcon } from "./icons";

type Phase =
  | { kind: "hidden" }
  | { kind: "checking" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; pct: number | null }
  | { kind: "installing" }
  | { kind: "upToDate" }
  | { kind: "error"; stage: "check" | "install"; msg: string };

export default function UpdateBanner() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ kind: "hidden" });
  // check() 返回的 Update 实例要留到用户点「立即更新」时调 downloadAndInstall
  const updateRef = useRef<Update | null>(null);
  // 检查与下载都是长任务：忙时忽略重复触发（菜单连点、自动+手动撞车）
  const busyRef = useRef(false);
  // 本轮任务是否要把结果显示出来。手动触发为 true；自动检查为 false（无更新时静默收场）。
  // 手动触发撞上正在跑的自动检查时会把它翻成 true「接管」结果显示——否则菜单点了
  // 毫无反应，看起来像坏了。下载期间也是 true：进度条本身就是反馈，别被覆盖掉。
  const reportRef = useRef(false);

  const runCheck = useCallback(async (manual: boolean) => {
    if (busyRef.current) {
      if (manual && !reportRef.current) {
        reportRef.current = true;
        setPhase({ kind: "checking" });
      }
      return;
    }
    busyRef.current = true;
    reportRef.current = manual;
    if (manual) setPhase({ kind: "checking" });
    try {
      const update = await check();
      if (update) {
        updateRef.current = update;
        setPhase({ kind: "available", version: update.version });
      } else if (reportRef.current) {
        setPhase({ kind: "upToDate" });
      }
    } catch (e) {
      // 自动检查失败保持安静：离线是常态，不值得打扰
      if (reportRef.current) setPhase({ kind: "error", stage: "check", msg: String(e) });
    } finally {
      busyRef.current = false;
      reportRef.current = false;
    }
  }, []);

  useEffect(() => {
    // 启动 3 秒后静默检查，避开首屏加载；dev 构建不自动查（endpoint 是线上库）；
    // 设置里关掉「自动检查更新」则跳过（菜单手动检查不受影响）
    let timer: number | undefined;
    if (import.meta.env.PROD && getSettings().autoCheckUpdate) {
      timer = window.setTimeout(() => void runCheck(false), 3000);
    }
    const un = listen("check-update-requested", () => void runCheck(true));
    return () => {
      window.clearTimeout(timer);
      void un.then((f) => f());
    };
  }, [runCheck]);

  const install = async () => {
    const update = updateRef.current;
    if (!update || busyRef.current) return;
    busyRef.current = true;
    reportRef.current = true;
    setPhase({ kind: "downloading", pct: null });
    try {
      let total: number | undefined;
      let received = 0;
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") {
          total = ev.data.contentLength;
        } else if (ev.event === "Progress") {
          received += ev.data.chunkLength;
          if (total) {
            const pct = Math.min(100, Math.round((received / total) * 100));
            setPhase({ kind: "downloading", pct });
          }
        } else {
          setPhase({ kind: "installing" });
        }
      });
      // 成功路径不重置 busyRef/reportRef：relaunch 会立刻换掉整个进程，
      // 重置反而给了「安装完成到进程消失」这段空隙再次触发下载的机会。
      await relaunch();
    } catch (e) {
      setPhase({ kind: "error", stage: "install", msg: String(e) });
      busyRef.current = false;
      reportRef.current = false;
    }
  };

  if (phase.kind === "hidden") return null;

  const text = (() => {
    switch (phase.kind) {
      case "checking":
        return t("update.checking");
      case "available":
        return t("update.available", { version: phase.version });
      case "downloading":
        return phase.pct === null
          ? t("update.downloading")
          : t("update.downloadingPct", { pct: phase.pct });
      case "installing":
        return t("update.installing");
      case "upToDate":
        return t("update.upToDate");
      case "error":
        return phase.stage === "check"
          ? t("update.checkFailed", { msg: phase.msg })
          : t("update.installFailed", { msg: phase.msg });
    }
  })();

  const dismissable =
    phase.kind === "available" || phase.kind === "upToDate" || phase.kind === "error";
  const tone = phase.kind === "error" ? "error" : "info";

  return (
    <div className={`banner banner--${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span className="banner__text">{text}</span>
      {phase.kind === "available" && (
        <button className="btn btn--sm btn--primary" onClick={() => void install()}>
          {t("update.install")}
        </button>
      )}
      {dismissable && (
        <button
          className="banner__close"
          onClick={() => setPhase({ kind: "hidden" })}
          aria-label={t("banner.close")}
        >
          <CloseIcon size={13} />
        </button>
      )}
    </div>
  );
}
