import { useTranslation } from "react-i18next";
import { setLocale } from "../api";

/** 中/英语言切换：changeLanguage 会写回 localStorage，并同步通知 Rust 重建菜单 */
export default function LangSwitch() {
  const { i18n, t } = useTranslation();
  const isZh = i18n.language.startsWith("zh");
  const toggle = () => {
    const next = isZh ? "en" : "zh";
    i18n.changeLanguage(next);
    setLocale(next).catch(() => {});
  };
  return (
    <button className="btn btn--icon" onClick={toggle} title={t("toolbar.language")}>
      {isZh ? "EN" : "中"}
    </button>
  );
}
