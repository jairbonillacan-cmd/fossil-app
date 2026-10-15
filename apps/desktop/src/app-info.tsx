import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "./bindings";

type AppState =
  | { status: "loading" }
  | { status: "ready"; version: string; dataDir: string }
  | { status: "error"; error: string };

export function AppInfoPanel() {
  const { t } = useTranslation();
  const [state, setState] = useState<AppState>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    commands.appInfo().then((result) => {
      if (!alive) return;
      setState(
        result.status === "ok"
          ? {
              status: "ready",
              version: result.data.version,
              dataDir: result.data.data_dir,
            }
          : { status: "error", error: String(result.error) },
      );
    });
    return () => {
      alive = false;
    };
  }, []);

  if (state.status === "loading") {
    return <p className="text-sm text-[color:var(--fg-muted)]">{t("app.loading")}</p>;
  }
  if (state.status === "error") {
    return (
      <p className="text-sm text-[color:var(--fg-muted)]">
        {t("app.error", { error: state.error })}
      </p>
    );
  }
  return (
    <p className="text-sm text-[color:var(--fg-muted)]">
      {t("app.info", { version: state.version, dataDir: state.dataDir })}
    </p>
  );
}
