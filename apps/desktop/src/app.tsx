import { useState } from "react";
import type { ObjectMeta, VaultInfo } from "./bindings";
import { PageEditor } from "./page-editor";
import { Sidebar } from "./sidebar";
import { VaultScreen } from "./vault-screen";

export function App() {
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [selected, setSelected] = useState<ObjectMeta | null>(null);

  if (vault === null) {
    return <VaultScreen onVaultOpen={setVault} />;
  }

  return (
    <main className="flex h-dvh">
      <Sidebar vaultName={vault.name} selectedId={selected?.id ?? null} onSelect={setSelected} />
      <div className="min-w-0 flex-1">
        <PageEditor object={selected} />
      </div>
    </main>
  );
}
