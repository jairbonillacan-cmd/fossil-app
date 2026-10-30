import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { VaultInfo } from "./bindings";
import { PageEditor } from "./page-editor";
import { ShellTabs, useWorkspaceTabs, type WorkspacePane } from "./shell-tabs";
import { Sidebar } from "./sidebar";
import { VaultScreen } from "./vault-screen";

const paneCls =
  "relative flex min-h-0 min-w-0 flex-1 basis-0 flex-col data-[focused=true]:shadow-[inset_0_2px_0_var(--accent)]";

export function App() {
  const { t } = useTranslation();
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const tabs = useWorkspaceTabs([], vault?.name ?? null);

  if (vault === null) {
    return <VaultScreen onVaultOpen={setVault} />;
  }

  const split = tabs.splitOpen;
  // Focus follows the pane last clicked or tabbed into (#166).
  const paneProps = (pane: WorkspacePane, label: string) => ({
    "aria-label": label,
    "data-pane": pane,
    "data-focused": String(split && tabs.focusedPane === pane),
    onMouseDownCapture: () => tabs.onFocusPane(pane),
    onFocusCapture: () => tabs.onFocusPane(pane),
  });

  return (
    <main className="flex h-dvh print:block print:h-auto">
      <Sidebar
        vaultName={vault.name}
        selectedId={
          (tabs.focusedPane === "split" ? tabs.splitObject : tabs.selectedObject)?.id ?? null
        }
        onSelect={tabs.selectObject}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <ShellTabs {...tabs} />
        <div className="flex min-h-0 min-w-0 flex-1">
          <section {...paneProps("main", t("tabs.mainPane"))} className={paneCls}>
            <PageEditor
              object={tabs.selectedObject}
              onSelect={tabs.selectObject}
              onObjectUpdated={tabs.updateObject}
              focused={!split || tabs.focusedPane === "main"}
            />
          </section>
          {split && (
            <section
              {...paneProps("split", t("tabs.splitPane"))}
              className={`${paneCls} border-l border-[color:var(--border)] print:hidden`}
            >
              <button
                type="button"
                aria-label={t("tabs.closeSplit")}
                title={t("tabs.closeSplit")}
                onClick={tabs.onCloseSplit}
                className="fui-button fui-button--secondary absolute top-2 right-2 z-10 px-2 py-0.5 text-xs"
              >
                ×
              </button>
              <PageEditor
                object={tabs.splitObject}
                onSelect={tabs.selectObject}
                onObjectUpdated={tabs.updateObject}
                focused={tabs.focusedPane === "split"}
              />
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
