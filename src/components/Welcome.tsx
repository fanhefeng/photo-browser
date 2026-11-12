import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import appIcon from "../../src-tauri/icons/128x128@2x.png";
import { FolderIcon } from "./icons";

export default function Welcome({ recentFolders, onOpen, onOpenRecent, onClearRecent, restoreFocus }: {
  recentFolders: string[];
  onOpen: () => void;
  onOpenRecent: (path: string) => void;
  onClearRecent: () => void;
  restoreFocus: boolean;
}) {
  const { t } = useTranslation();
  const openRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (restoreFocus) openRef.current?.focus(); }, [restoreFocus]);
  return (
    <main className="welcome">
      <div className="welcome__workspace">
        <section className="welcome__intro" aria-labelledby="welcome-title">
          <img className="welcome__app-icon" src={appIcon} width="96" height="96" alt="" draggable={false} />
          <h1 id="welcome-title" className="welcome__title">{t("welcome.title")}</h1>
          <p className="welcome__subtitle">{t("welcome.subtitle")}</p>
          <button ref={openRef} className="btn btn--primary welcome__open" onClick={onOpen}>
            <FolderIcon size={16} />
            {t("welcome.open")}
          </button>
        </section>

        <section className="welcome__recent" aria-labelledby="recent-title">
          <div className="welcome__recent-head">
            <h2 id="recent-title">{t("welcome.recent")}</h2>
            {recentFolders.length > 0 && (
              <button className="welcome__clear" onClick={() => { onClearRecent(); openRef.current?.focus(); }}>{t("welcome.clearRecent")}</button>
            )}
          </div>
          {recentFolders.length > 0 ? (
            <ul className="welcome__folders">
              {recentFolders.map((path) => {
                const displayPath = path.replace(/[\\/]+$/, "") || path;
                const name = displayPath.split(/[\\/]/).filter(Boolean).pop() || displayPath;
                const parent = displayPath.slice(0, -name.length) || displayPath;
                return (
                  <li key={path}>
                    <button className="welcome__folder" onClick={() => onOpenRecent(path)} title={path}>
                      <FolderIcon size={20} />
                      <span className="welcome__folder-text">
                        <span className="welcome__folder-name" dir="auto">{name}</span>
                        <span className="welcome__folder-path" dir="auto">{parent}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="welcome__recent-empty">
              <p>{t("welcome.noRecent")}</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
