import { AppIcon, Button } from "@fossil/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ObjectId, ObjectMeta } from "./bindings";
import { commands, events } from "./bindings";
import { registerCommand } from "./shell-commands";
import { ShellPalette } from "./shell-palette";
import { ShellSearch } from "./shell-search";
import { ShellSettings } from "./shell-settings";
import { errorLabel } from "./vault-screen";

let workspaceOnSelect: ((object: ObjectMeta) => void) | null = null;
export const selectWorkspaceObject = (object: ObjectMeta) => workspaceOnSelect?.(object);

/** Formats ISO `YYYY-MM-DD` journal titles with the active locale. */
export function formatObjectTitle(object: ObjectMeta, language: string, untitled: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(object.title);
  if (object.types.includes("Journal") && iso !== null) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat(language, { dateStyle: "long", timeZone: "UTC" }).format(date);
    }
  }
  return object.title !== "" ? object.title : untitled;
}

/** Alpha sidebar (#26, #31): flat object list, "New page", "Today" and Settings dialog. */
export function Sidebar({
  vaultName,
  selectedId,
  onSelect,
}: {
  vaultName: string;
  selectedId: ObjectId | null;
  onSelect: (object: ObjectMeta) => void;
}) {
  const { t, i18n } = useTranslation();
  const [objects, setObjects] = useState<ObjectMeta[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  workspaceOnSelect = onSelect;

  const refresh = useCallback(() => {
    void commands
      .objectList({ include_archived: false, type_key: null, parent: null, query: null })
      .then((res) => setObjects(res.status === "ok" ? res.data : []));
  }, []);

  useEffect(() => {
    refresh();
    let alive = true;
    const onEvent = () => {
      if (alive) refresh();
    };
    const offs = Promise.all([
      events.objectChanged.listen(onEvent),
      events.indexUpdated.listen(onEvent),
    ]);
    return () => {
      alive = false;
      void offs.then((fns) => {
        for (const off of fns) off();
      });
    };
  }, [refresh]);

  const runAction = async (call: () => ReturnType<typeof commands.journalToday>) => {
    try {
      const res = await call();
      if (res.status === "ok") {
        setActionError(null);
        onSelect(res.data);
        refresh();
        return;
      }
      setActionError(
        res.error === "NotImplemented"
          ? t("error.notImplemented")
          : t("error.generic", { error: errorLabel(res.error) }),
      );
    } catch (error) {
      setActionError(t("error.generic", { error: errorLabel(error) }));
    }
  };

  const runRef = useRef(runAction);
  runRef.current = runAction;
  useEffect(() => {
    const newPage = { types: ["Page" as const], title: "", icon: null, parent: null };
    const offs = (
      [
        [
          "shell.newPage",
          t("sidebar.newPage"),
          () => runRef.current(() => commands.objectCreate(newPage)),
        ],
        ["shell.today", t("sidebar.today"), () => runRef.current(() => commands.journalToday())],
        ["shell.search", t("search.open"), () => setSearchOpen(true)],
        ["shell.settings", t("sidebar.settings"), () => setSettingsOpen(true)],
      ] as const
    ).map(([id, title, run]) => registerCommand({ id, title, run }));
    return () => {
      for (const off of offs) off();
    };
  }, [t]);

  return (
    <aside className="flex print:hidden h-dvh w-64 shrink-0 flex-col gap-4 border-r border-[color:var(--border)] px-3 py-4 in-data-[density=compact]:gap-2.5 in-data-[density=compact]:py-3">
      <header className="flex items-center gap-2 px-2">
        <AppIcon />
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold tracking-tight text-[color:var(--fg)]">
            Fossil
          </span>
          <span className="truncate text-xs text-[color:var(--fg-muted)]">{vaultName}</span>
        </div>
      </header>

      <div className="flex flex-col gap-1">
        <Button
          onClick={() =>
            void runAction(() =>
              commands.objectCreate({ types: ["Page"], title: "", icon: null, parent: null }),
            )
          }
        >
          {t("sidebar.newPage")}
        </Button>
        <Button variant="secondary" onClick={() => void runAction(() => commands.journalToday())}>
          {t("sidebar.today")}
        </Button>
        <Button variant="secondary" onClick={() => setSearchOpen(true)}>
          {t("search.open")}
        </Button>
      </div>

      {actionError !== null && (
        <p role="alert" className="text-sm text-[color:var(--danger)]">
          {actionError}
        </p>
      )}

      <nav aria-label={t("sidebar.label")} className="flex min-h-0 flex-1 flex-col gap-2">
        <h2 className="px-2 text-xs font-medium uppercase tracking-wide text-[color:var(--fg-muted)]">
          {t("sidebar.label")}
        </h2>
        {objects === null || objects.length === 0 ? (
          <p className="px-2 text-sm text-[color:var(--fg-muted)]">
            {t(objects === null ? "sidebar.loading" : "sidebar.empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1 overflow-y-auto in-data-[density=compact]:gap-0.5">
            {objects.map((object) => (
              <li
                key={object.id}
                className="[content-visibility:auto] [contain-intrinsic-size:0_2.25rem]"
              >
                <button
                  type="button"
                  onClick={() => onSelect(object)}
                  aria-current={object.id === selectedId ? "true" : undefined}
                  className="flex w-full items-center gap-2 rounded border border-transparent px-2.5 py-1.5 text-left text-sm transition-colors duration-150 ease-out hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] focus-visible:outline-2 focus-visible:outline-[color:var(--accent)] aria-current:border-[color:var(--border)] aria-current:bg-[color-mix(in_srgb,var(--accent)_10%,var(--bg-elevated))] aria-current:font-semibold aria-current:shadow-[inset_3px_0_0_var(--accent)] in-data-[density=compact]:py-1 in-data-[density=compact]:text-xs"
                >
                  {object.icon !== null && (
                    <span aria-hidden="true" className="text-sm">
                      {object.icon}
                    </span>
                  )}
                  <span className="truncate text-[color:var(--fg)]">
                    {formatObjectTitle(object, i18n.language, t("editor.untitled"))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
        {t("sidebar.settings")}
      </Button>
      <ShellSettings
        open={settingsOpen}
        vaultName={vaultName}
        onClose={() => setSettingsOpen(false)}
      />
      <ShellSearch open={searchOpen} onClose={() => setSearchOpen(false)} onSelect={onSelect} />
      <ShellPalette onSelect={onSelect} />
    </aside>
  );
}
