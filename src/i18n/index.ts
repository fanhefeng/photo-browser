import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import zh from "./locales/zh.json";
import en from "./locales/en.json";

// 语言优先级：localStorage（手动切换记忆）> navigator（跟随系统），结果写回 localStorage
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
    },
    fallbackLng: "zh",
    supportedLngs: ["zh", "en"],
    load: "languageOnly", // zh-CN / en-US → zh / en
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "lang",
      caches: ["localStorage"],
    },
  });

/** 后端命令 reject 的值可能是 i18n key（如 backend.notDirectory）：
 *  仅当确为已知 key 时才翻译，否则原样返回（真实错误文案不能丢）。 */
export function translateBackendError(e: unknown): string {
  const raw = String(e);
  return i18n.exists(raw) ? i18n.t(raw) : raw;
}

export default i18n;
