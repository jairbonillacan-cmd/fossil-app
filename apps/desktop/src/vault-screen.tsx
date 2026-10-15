import { AppIcon, Button, Wordmark } from "@fossil/ui";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { VaultInfo } from "./bindings";
import { commands } from "./bindings";

/** New vaults take their name from the picked folder (spec r1-shell-ux). */
export function vaultNameFromPath(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments.at(-1) ?? path;
}

export function errorLabel(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "Storage" in error &&
    typeof error.Storage === "string"
  ) {
    return error.Storage;
  }
  return JSON.stringify(error);
}

type VaultScreenProps = {
  onVaultOpen: (vault: VaultInfo) => void;
};

/** First-run screen: create or open a vault, or pick a recent one (issue #26). */
export function VaultScreen({ onVaultOpen }: VaultScreenProps) {
  const { t } = useTranslation();
  // Recents are background data: a failed load falls back to the empty state.
  const [recents, setRecents] = useState<VaultInfo[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void commands.vaultRecent().then((result) => {
      if (alive) setRecents(result.status === "ok" ? result.data : []);
    });
    return () => {
      alive = false;
    };
  }, []);

  const settle = (result: Awaited<ReturnType<typeof commands.vaultOpen>>) => {
    if (result.status === "ok") {
      setActionError(null);
      onVaultOpen(result.data);
      return;
    }
    setActionError(
      result.error === "NotImplemented"
        ? t("error.notImplemented")
        : t("error.generic", { error: errorLabel(result.error) }),
    );
  };

  const reportError = (error: unknown) => {
    setActionError(t("error.generic", { error: errorLabel(error) }));
  };

  const openVaultPath = async (path: string) => {
    try {
      settle(await commands.vaultOpen(path));
    } catch (error) {
      reportError(error);
    }
  };

  const createVault = async () => {
    try {
      const path = await open({ directory: true, title: t("vault.create") });
      if (path === null) return;
      settle(await commands.vaultCreate(path, vaultNameFromPath(path)));
    } catch (error) {
      reportError(error);
    }
  };

  const openVaultFromPicker = async () => {
    try {
      const path = await open({ directory: true, title: t("vault.open") });
      if (path !== null) await openVaultPath(path);
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-10 px-6">
      <header className="flex flex-col items-center gap-2 text-center">
        <AppIcon />
        <h1>
          <Wordmark />
        </h1>
        <p className="text-sm text-[color:var(--fg-muted)]">{t("vault.subtitle")}</p>
      </header>

      <div className="flex w-full max-w-sm flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Button onClick={createVault}>{t("vault.create")}</Button>
          <p className="text-xs text-[color:var(--fg-muted)]">{t("vault.createHint")}</p>
        </div>
        <div className="flex flex-col gap-1">
          <Button variant="secondary" onClick={openVaultFromPicker}>
            {t("vault.open")}
          </Button>
          <p className="text-xs text-[color:var(--fg-muted)]">{t("vault.openHint")}</p>
        </div>
      </div>

      {actionError !== null && (
        <p role="alert" className="w-full max-w-sm text-sm text-[color:var(--danger)]">
          {actionError}
        </p>
      )}

      <section className="flex w-full max-w-sm flex-col gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-[color:var(--fg-muted)]">
          {t("vault.recents")}
        </h2>
        {recents === null ? (
          <p className="text-sm text-[color:var(--fg-muted)]">{t("vault.loading")}</p>
        ) : recents.length === 0 ? (
          <p className="text-sm text-[color:var(--fg-muted)]">{t("vault.recentsEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {recents.map((vault) => (
              <li key={vault.path}>
                <button
                  type="button"
                  onClick={() => openVaultPath(vault.path)}
                  className="flex w-full flex-col items-start gap-0.5 rounded px-3 py-2 text-left transition-colors duration-150 ease-out hover:bg-[color:var(--bg-elevated)] focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
                >
                  <span className="text-sm font-medium text-[color:var(--fg)]">{vault.name}</span>
                  <span className="font-mono text-xs text-[color:var(--fg-muted)]">
                    {vault.path}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
