// 设置弹窗：主题换肤 / 缩略图大小 / 悬停信息 / 语言 / 自动检查更新。
// 设置项读写走 settings.ts（localStorage 持久化，改动即时生效）；
// 语言单独走 i18next（localStorage "lang"），并同步后端原生菜单。
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { setLocale } from "../api";
import { THEMES, THUMB_MAX, THUMB_MIN, updateSettings, useSettings } from "../settings";
import { CloseIcon } from "./icons";

type LangChoice = "system" | "zh" | "en";

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const boxRef = useRef<HTMLDivElement>(null);

  // 语言选项：localStorage 有 "lang" 即手动指定过，否则视为跟随系统
  const [lang, setLang] = useState<LangChoice>(() =>
    localStorage.getItem("lang") === null
      ? "system"
      : i18n.language.startsWith("zh")
        ? "zh"
        : "en"
  );

  // Esc 关闭：捕获阶段拦截，避免同时触发 Lightbox 的窗口级 Esc（会连带关大图）
  useEffect(() => {
    boxRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const changeLang = async (choice: LangChoice) => {
    setLang(choice);
    const target =
      choice === "system"
        ? (navigator.language || "zh").toLowerCase().startsWith("zh")
          ? "zh"
          : "en"
        : choice;
    await i18n.changeLanguage(target);
    // 跟随系统 = 清掉手动记忆（changeLanguage 会写缓存，须在其后清除）
    if (choice === "system") localStorage.removeItem("lang");
    setLocale(target).catch(() => {});
  };

  return (
    <div className="settings-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={boxRef}
        className="settings"
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        tabIndex={-1}
      >
        <div className="settings__head">
          <h2 className="settings__title">{t("settings.title")}</h2>
          <button className="btn btn--icon" onClick={onClose} title={t("settings.close")}>
            <CloseIcon />
          </button>
        </div>

        <section className="settings__section">
          <h3 className="settings__section-title">{t("settings.appearance")}</h3>
          <div className="theme-cards" role="radiogroup" aria-label={t("settings.appearance")}>
            {THEMES.map((th) => (
              <button
                key={th.id}
                role="radio"
                aria-checked={settings.theme === th.id}
                className={`theme-card ${settings.theme === th.id ? "theme-card--on" : ""}`}
                data-theme={th.id}
                onClick={() => updateSettings({ theme: th.id })}
              >
                <span className="tp" aria-hidden>
                  <span className="tp__side" />
                  <span className="tp__main">
                    <span className="tp__dot" />
                    <span className="tp__line" />
                    <span className="tp__line tp__line--short" />
                  </span>
                </span>
                <span className="theme-card__name">{t(`settings.theme.${th.id}`)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="settings__section">
          <h3 className="settings__section-title">{t("settings.display")}</h3>
          <div className="settings__row">
            <label className="settings__label" htmlFor="set-thumb">
              {t("settings.thumbSize")}
            </label>
            <input
              id="set-thumb"
              className="slider"
              type="range"
              min={THUMB_MIN}
              max={THUMB_MAX}
              step={8}
              value={settings.thumbSize}
              onChange={(e) => updateSettings({ thumbSize: Number(e.target.value) })}
            />
            <span className="settings__value">{settings.thumbSize}px</span>
          </div>
          <div className="settings__row">
            <div className="settings__label">
              <div>{t("settings.hoverInfo")}</div>
              <div className="settings__hint">{t("settings.hoverInfoHint")}</div>
            </div>
            <Switch
              checked={settings.hoverInfo}
              label={t("settings.hoverInfo")}
              onChange={(v) => updateSettings({ hoverInfo: v })}
            />
          </div>
        </section>

        <section className="settings__section">
          <h3 className="settings__section-title">{t("settings.general")}</h3>
          <div className="settings__row">
            <label className="settings__label" htmlFor="set-lang">
              {t("settings.language")}
            </label>
            <select
              id="set-lang"
              className="select"
              value={lang}
              onChange={(e) => void changeLang(e.target.value as LangChoice)}
            >
              <option value="system">{t("settings.langSystem")}</option>
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="settings__row">
            <div className="settings__label">
              <div>{t("settings.autoUpdate")}</div>
              <div className="settings__hint">{t("settings.autoUpdateHint")}</div>
            </div>
            <Switch
              checked={settings.autoCheckUpdate}
              label={t("settings.autoUpdate")}
              onChange={(v) => updateSettings({ autoCheckUpdate: v })}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function Switch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <span className="switch">
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch__track" aria-hidden />
    </span>
  );
}
