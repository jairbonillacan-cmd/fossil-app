import { useState } from "react";
import type { VaultInfo } from "./bindings";
import { PageEditor } from "./page-editor";
import { ShellTabs, useWorkspaceTabs } from "./shell-tabs";
import { Sidebar } from "./sidebar";
import { VaultScreen } from "./vault-screen";

export function App() {
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const tabs = useWorkspaceTabs();

  if (vault === null) {
    return <VaultScreen onVaultOpen={setVault} />;
  }

  return (
    <main className="flex h-dvh print:block print:h-auto">
      <Sidebar
        vaultName={vault.name}
        selectedId={tabs.selectedObject?.id ?? null}
        onSelect={tabs.selectObject}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <ShellTabs {...tabs} />
        <div className="min-h-0 min-w-0 flex-1">
          <PageEditor
            object={tabs.selectedObject}
            onSelect={tabs.selectObject}
            onObjectUpdated={tabs.updateObject}
          />
        </div>
      </div>
    </main>
  );
}
