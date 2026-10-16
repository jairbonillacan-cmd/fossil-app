import { AppIcon, Button } from "@fossil/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, events, type ObjectId } from "./bindings";
import { applyStoredShellPreferences } from "./shell-prefs";
import { formatObjectTitle } from "./sidebar";
import { errorLabel } from "./vault-screen";

/** Floating quick-capture mini-window (`index.html#capture`, #9). */
export function ShellCapture() {
  const { t, i18n } = useTranslation();
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null);
  const targetRef = useRef<ObjectId | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fail = (e: unknown) =>
    setNotice({ ok: false, msg: t("error.generic", { error: errorLabel(e) }) });
  const hide = () => void commands.captureWindowHide();

  useEffect(() => {
    inputRef.current?.focus();
    const off = events.captureRequested.listen((ev) => {
      applyStoredShellPreferences();
      targetRef.current = ev.payload.target_id;
      setNotice(null);
      inputRef.current?.focus();
    });
    return () => void off.then((fn) => fn());
  }, []);

  const submit = async () => {
    if (!text.trim()) return;
    const res = await commands.captureAppend({ text, target_id: targetRef.current }).catch(fail);
    if (res?.status === "ok") {
      const title = formatObjectTitle(res.data, i18n.language, t("editor.untitled"));
      setText("");
      setNotice({ ok: true, msg: t("capture.savedIn", { title }) });
    } else if (res?.status === "error") fail(res.error);
    inputRef.current?.focus();
  };
  const paste = async () => {
    const clip = await navigator.clipboard.readText().catch(fail);
    if (clip) {
      setText((prev) => (prev ? `${prev}\n${clip}` : clip));
      setNotice(null);
    }
    inputRef.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") hide();
    else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };
  const chipCls =
    "rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-1.5 py-0.5 text-xs font-medium text-[color:var(--fg-muted)]";
  const msgCls = `min-w-0 flex-1 truncate text-xs ${notice?.ok ? "font-medium text-[color:var(--success)]" : "text-[color:var(--danger)]"}`;
  const btnCls = "px-2.5 py-1 text-xs";
  return (
    <main className="flex h-dvh w-full flex-col justify-between rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-elevated)] p-3.5 text-[color:var(--fg)]">
      <header className="flex items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
          <AppIcon />
          <span className="text-sm font-semibold">{t("settings.shortcutCapture")}</span>
          <span className={chipCls}>{t("search.Journal")}</span>
        </div>
        <Button variant="secondary" className={btnCls} onClick={hide}>
          {t("settings.close")}
        </Button>
      </header>
      <textarea
        ref={inputRef}
        value={text}
        aria-label={t("settings.shortcutCapture")}
        placeholder={t("capture.placeholder")}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        className="fui-input !h-auto min-h-0 flex-1 resize-none !p-3 text-sm !leading-normal"
      />
      <footer className="flex items-center justify-between gap-2 pt-2.5">
        {notice && (
          <p role={notice.ok ? "status" : "alert"} className={msgCls}>
            {notice.msg}
          </p>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button variant="secondary" className={btnCls} onClick={() => void paste()}>
            {t("capture.paste")}
          </Button>
          <Button className={btnCls} onClick={() => void submit()}>
            {t("capture.save")}
          </Button>
        </div>
      </footer>
    </main>
  );
}
