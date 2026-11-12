// 设置弹窗：主题换肤 / 缩略图大小 / 悬停信息 / 语言 / 自动检查更新。
// 设置项读写走 settings.ts（localStorage 持久化，改动即时生效）；
// 语言单独走 i18next（localStorage "lang"），并同步后端原生菜单。
import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useModalFocus } from "../hooks/useModalFocus";
import Select from "./Select";
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

  useModalFocus(boxRef, onClose);

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
          <button
            className="btn btn--icon"
            onClick={onClose}
            title={t("settings.close")}
            aria-label={t("settings.close")}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="settings__body">
          <section className="settings__section">
            <h3 className="settings__section-title">{t("settings.appearance")}</h3>
            <div className="theme-cards" role="group" aria-label={t("settings.appearance")}>
              {THEMES.map((th) => (
                <label
                  key={th.id}
                  className={`theme-card ${settings.theme === th.id ? "theme-card--on" : ""}`}
                  data-theme={th.id}
                >
                  <input
                    className="theme-card__input"
                    type="radio"
                    name="theme"
                    value={th.id}
                    checked={settings.theme === th.id}
                    onChange={() => updateSettings({ theme: th.id })}
                  />
                  <span className="tp" aria-hidden>
                    <span className="tp__side">
                      <span /><span /><span />
                    </span>
                    <span className="tp__main">
                      <span /><span /><span /><span />
                    </span>
                  </span>
                  <span className="theme-card__name">
                    {t(`settings.theme.${th.id}`)}
                    <span className="theme-card__mark" aria-hidden>
                      {settings.theme === th.id && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path
                            d="m2.5 6 2.3 2.3 4.7-4.6"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                  </span>
                </label>
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
                style={{ "--slider-progress": `${((settings.thumbSize - THUMB_MIN) / (THUMB_MAX - THUMB_MIN)) * 100}%` } as CSSProperties}
                onChange={(e) => updateSettings({ thumbSize: Number(e.target.value) })}
              />
              <span className="settings__value">{settings.thumbSize}px</span>
            </div>
            <label className="settings__row settings__row--toggle">
              <span className="settings__label">{t("settings.hoverInfo")}</span>
              <Switch
                checked={settings.hoverInfo}
                label={t("settings.hoverInfo")}
                onChange={(v) => updateSettings({ hoverInfo: v })}
              />
            </label>
          </section>

          <section className="settings__section">
            <h3 className="settings__section-title">{t("settings.general")}</h3>
            <div className="settings__row">
              <label className="settings__label" htmlFor="set-lang">
                {t("settings.language")}
              </label>
              <Select
                id="set-lang"
                label={t("settings.language")}
                value={lang}
                onChange={(choice) => void changeLang(choice)}
                options={[
                  { value: "system", label: t("settings.langSystem") },
                  { value: "zh", label: "中文" },
                  { value: "en", label: "English" },
                ]}
              />
            </div>
            <label className="settings__row settings__row--toggle">
              <span className="settings__label">{t("settings.autoUpdate")}</span>
              <Switch
                checked={settings.autoCheckUpdate}
                label={t("settings.autoUpdate")}
                onChange={(v) => updateSettings({ autoCheckUpdate: v })}
              />
            </label>
          </section>
        </div>
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
