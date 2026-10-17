import { Button, Input } from "@fossil/ui";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppInfoPanel } from "./app-info";
import { commands } from "./bindings";
import { applyDensity, applyLanguage, applyTheme, readShellPreferences } from "./shell-prefs";

const SHORTCUTS = [
  ["settings.shortcutPalette", "Ctrl+K"],
  ["settings.shortcutQuickOpen", "Ctrl+P"],
] as const;

function OptionRow<T extends string>(props: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onSelect: (next: T) => void;
}) {
  const labelId = useId();
  return (
    <section className="flex items-center justify-between gap-4 border-b border-[color:var(--border)] py-3">
      <span id={labelId} className="text-sm font-medium text-[color:var(--fg)]">
        {props.label}
      </span>
      <fieldset
        aria-labelledby={labelId}
        className="m-0 inline-flex min-w-0 gap-1 rounded-md border border-[color:var(--border)] bg-[color:var(--bg)] p-1"
        onKeyDown={(e) => {
          if (
            e.key !== "ArrowRight" &&
            e.key !== "ArrowLeft" &&
            e.key !== "ArrowDown" &&
            e.key !== "ArrowUp"
          )
            return;
          const btns = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
          const idx = btns.indexOf(document.activeElement as HTMLButtonElement);
          if (idx === -1 || btns.length === 0) return;
          e.preventDefault();
          const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
          const nextIdx = (idx + step + btns.length) % btns.length;
          btns[nextIdx]?.focus();
          const nextOpt = props.options[nextIdx]?.[0];
          if (nextOpt !== undefined) props.onSelect(nextOpt);
        }}
      >
        {props.options.map(([opt, text]) => (
          <Button
            key={opt}
            className="border-0 px-2.5 text-xs"
            variant={props.value === opt ? "primary" : "secondary"}
            aria-pressed={props.value === opt}
            onClick={() => props.onSelect(opt)}
          >
            {text}
          </Button>
        ))}
      </fieldset>
    </section>
  );
}

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
const toWin = (s: string) => s.replace(/^Super\+/i, "Win+");

/**
 * Settings dialog (#31): vault, theme, density, language, shortcuts and app
 * diagnostics. Modal: focus moves in on open, Tab stays inside, Escape or a
 * click on the backdrop closes it, and focus returns to the opener.
 */
export function ShellSettings(props: { open: boolean; vaultName: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState(readShellPreferences);
  const [captureKey, setCaptureKey] = useState("Win+Shift+F");
  const [shortcutErr, setShortcutErr] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const { open, onClose } = props;
  const titleId = useId();
  // The parent passes a new onClose each render; a ref keeps the focus effect
  // tied to "open" only, so a re-render never steals focus inside the dialog.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const syncShortcut = (r: Awaited<ReturnType<typeof commands.captureShortcutGet>>, fb = "") => {
    const busy =
      r.status === "error" && typeof r.error === "object" && "ShortcutConflict" in r.error
        ? r.error.ShortcutConflict
        : null;
    const k = toWin(r.status === "ok" ? r.data : fb || busy || "");
    if (k) setCaptureKey(k);
    const msg =
      busy !== null ? t("capture.shortcutConflict", { shortcut: k }) : t("capture.shortcutInvalid");
    setShortcutErr(r.status === "ok" ? null : msg);
  };
  const syncRef = useRef(syncShortcut);
  syncRef.current = syncShortcut;
  const saveKey = () =>
    void commands.captureShortcutSet(toWin(captureKey)).then((r) => syncShortcut(r, captureKey));

  useEffect(() => {
    if (!open) return undefined;
    // Partial vi.mock("./bindings") in app.test.tsx omits captureShortcutGet.
    void commands.captureShortcutGet?.()?.then((res) => syncRef.current(res));
    const opener =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || dialogRef.current === null) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus();
      else document.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click is a mouse shortcut; keyboard users close with Escape (handled above).
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--bg)]/75 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-lg flex-col rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-elevated)] p-5 text-[color:var(--fg)]"
      >
        <header className="flex items-center justify-between border-b border-[color:var(--border)] pb-3">
          <h2 id={titleId} className="text-base font-semibold">
            {t("settings.title")}
          </h2>
          <Button variant="secondary" onClick={onClose}>
            {t("settings.close")}
          </Button>
        </header>

        <section className="flex items-center justify-between gap-4 border-b border-[color:var(--border)] py-3 text-sm">
          <span className="font-medium text-[color:var(--fg)]">{t("settings.vault")}</span>
          <span className="font-mono text-xs text-[color:var(--fg-muted)]">{props.vaultName}</span>
        </section>

        <OptionRow
          label={t("settings.theme")}
          value={prefs.theme}
          options={[
            ["system", t("settings.themeSystem")],
            ["light", t("settings.themeLight")],
            ["dark", t("settings.themeDark")],
          ]}
          onSelect={(theme) => {
            applyTheme(theme);
            setPrefs((p) => ({ ...p, theme }));
          }}
        />
        <OptionRow
          label={t("settings.density")}
          value={prefs.density}
          options={[
            ["comfortable", t("settings.densityComfortable")],
            ["compact", t("settings.densityCompact")],
          ]}
          onSelect={(density) => {
            applyDensity(density);
            setPrefs((p) => ({ ...p, density }));
          }}
        />
        <OptionRow
          label={t("settings.language")}
          value={prefs.language}
          options={[
            ["es-MX", t("settings.languageEs")],
            ["en", t("settings.languageEn")],
          ]}
          onSelect={(language) => {
            applyLanguage(language);
            setPrefs((p) => ({ ...p, language }));
          }}
        />

        <section className="flex flex-col gap-1.5 border-b border-[color:var(--border)] py-3 text-xs">
          <span className="font-medium text-[color:var(--fg-muted)]">
            {t("settings.shortcuts")}
          </span>
          {SHORTCUTS.map(([key, combo]) => (
            <div key={combo} className="flex items-center justify-between py-0.5">
              <span className="text-[color:var(--fg)]">{t(key)}</span>
              <kbd className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-1.5 py-0.5 font-mono text-[color:var(--fg-muted)]">
                {combo}
              </kbd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2 py-0.5">
            <span className="text-[color:var(--fg)]">{t("settings.shortcutCapture")}</span>
            <div className="flex items-center gap-1.5">
              <Input
                value={captureKey}
                aria-label={t("settings.shortcutCapture")}
                invalid={shortcutErr !== null}
                onChange={(e) => setCaptureKey(e.target.value)}
                className="w-36 px-2 py-1 font-mono text-xs"
              />
              <Button variant="secondary" onClick={saveKey}>
                {t("capture.shortcutSave")}
              </Button>
            </div>
          </div>
          {shortcutErr && (
            <p role="alert" className="text-[color:var(--danger)]">
              {shortcutErr}
            </p>
          )}
        </section>

        <footer className="pt-3">
          <AppInfoPanel />
        </footer>
      </div>
    </div>
  );
}
