import { Button, Input } from "@fossil/ui";
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatContext, ObjectMeta, ProviderId, RequestId } from "./bindings";
import { commands, events } from "./bindings";
import { formatObjectTitle } from "./sidebar";
import { errorLabel } from "./vault-screen";

const ROUTES: readonly (ProviderId | null)[] = [null, "Agy", "Claude", "Codex", "Ollama"];
const ACTIONS = ["actionRewrite", "actionSummarize", "actionTranslate", "actionTone"] as const;
type ChatTurn = [RequestId, string, string, string | null];

const HEADING_CLS = "text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-muted)]";
const CARD_CLS = "rounded border border-[color:var(--border)] bg-[color:var(--bg-elevated)]";
const CHIP_CLS = `${CARD_CLS} inline-flex items-center gap-1.5 px-2 py-1 text-xs text-[color:var(--fg)]`;
const PRE_CLS = `${CARD_CLS} m-0 whitespace-pre-wrap break-words p-2.5 font-mono text-xs text-[color:var(--fg)]`;
const ITEM_CLS =
  "rounded px-2 py-1 text-left text-xs text-[color:var(--fg)] hover:bg-[color:var(--bg)]";
const BTN_SM = "h-6 px-2 text-xs";

/** Right-side AI panel (#14): context chips, outgoing preview, selection actions and streaming chat. */
export function AiChatPanel({ object }: { object: ObjectMeta }) {
  const { t, i18n } = useTranslation();
  const [attached, setAttached] = useState<ObjectMeta[]>([object]);
  const [selection, setSelection] = useState("");
  const [pages, setPages] = useState<ObjectMeta[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [prompt, setPrompt] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [activeId, setActiveId] = useState<RequestId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const titleOf = (it: ObjectMeta) => formatObjectTitle(it, i18n.language, t("editor.untitled"));

  useEffect(() => {
    void commands
      .objectList?.({ include_archived: false, type_key: null, parent: null, query: null })
      ?.then((res) => setPages(res.status === "ok" ? res.data : []));
    const onSel = () => {
      const text = window.getSelection?.()?.toString().trim() ?? "";
      if (text !== "") setSelection(text);
    };
    document.addEventListener("selectionchange", onSel);
    let off = Promise.resolve<() => void>(() => {});
    try {
      off = events.aiEvent.listen(({ payload: { request_id, event } }) => {
        if ("Started" in event) {
          const b = `${event.Started.provider} · ${event.Started.model}`;
          setTurns((p) => p.map((r) => (r[0] === request_id ? [r[0], r[1], r[2], b] : r)));
        } else if ("Delta" in event) {
          const d = event.Delta.text;
          setTurns((p) => p.map((r) => (r[0] === request_id ? [r[0], r[1], r[2] + d, r[3]] : r)));
        } else if ("Done" in event) {
          setActiveId((cur) => (cur === request_id ? null : cur));
        } else if ("Error" in event) {
          setError(event.Error.message);
          setActiveId((cur) => (cur === request_id ? null : cur));
        }
      });
    } catch {
      // Partial ./bindings mock without `events.aiEvent`.
    }
    return () => {
      document.removeEventListener("selectionchange", onSel);
      void off.then((fn) => fn());
    };
  }, []);

  const sendChat = async (text: string, selOverride?: string) => {
    const cleanPrompt = text.trim();
    if (cleanPrompt === "") return;
    const cleanSel = (selOverride ?? selection).trim();
    const context: ChatContext[] = attached.map((it) =>
      it.id === object.id ? { Page: { object_id: it.id } } : { Object: { object_id: it.id } },
    );
    if (cleanSel !== "") context.push({ Selection: { text: cleanSel } });
    setError(null);
    const res = await commands.aiChat?.({
      prompt: cleanPrompt,
      context,
      options: { provider, model: null, timeout_ms: null },
    });
    if (!res) return;
    if (res.status === "error") {
      setError(
        res.error === "NotImplemented"
          ? t("error.notImplemented")
          : t("error.generic", { error: errorLabel(res.error) }),
      );
      return;
    }
    setActiveId(res.data);
    setTurns((p) => [...p, [res.data, cleanPrompt, "", null]]);
  };

  const onAction = (k: string) => {
    const sel = (window.getSelection?.()?.toString().trim() || selection).trim();
    if (sel !== "" && sel !== selection) setSelection(sel);
    const label = t(`ai.${k}`);
    void sendChat(sel !== "" ? `${label}: ${sel}` : label, sel);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const next = prompt;
    setPrompt("");
    void sendChat(next);
  };
  const onPrompt = (e: ChangeEvent<HTMLInputElement>) => {
    setPrompt(e.target.value);
    if (e.target.value.endsWith("@")) setMentionOpen(true);
  };
  const onSelInput = (e: ChangeEvent<HTMLInputElement>) => setSelection(e.target.value);
  const onCancel = () => {
    if (activeId) void commands.aiCancel?.(activeId);
    setActiveId(null);
  };
  const addMention = (p: ObjectMeta) => {
    setAttached((prev) => [...prev, p]);
    setMentionOpen(false);
  };
  const pickRoute = (id: ProviderId | null) => () => setProvider(id);
  const routeVar = (id: ProviderId | null) => (provider === id ? "primary" : "secondary");

  const chips: Array<[string, string, () => void]> = attached.map((it) => [
    it.id,
    it.id === object.id ? titleOf(it) : `@${titleOf(it)}`,
    () => setAttached((p) => p.filter((x) => x.id !== it.id)),
  ]);
  if (selection.trim() !== "") chips.push(["sel", selection.trim(), () => setSelection("")]);
  const available = pages.filter((p) => !attached.some((a) => a.id === p.id));
  const previewText = [
    ...attached.map((it) => `${it.id === object.id ? "[Page]" : "[@Page]"} ${titleOf(it)}`),
    ...(selection.trim() !== "" ? [`[Selection] ${selection.trim()}`] : []),
    ...(prompt.trim() !== "" ? [`[Prompt] ${prompt.trim()}`] : []),
  ].join("\n");

  return (
    <aside
      aria-label={t("ai.panelLabel")}
      className="flex h-full w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-[color:var(--border)] px-4 py-6 in-data-[density=compact]:gap-3 in-data-[density=compact]:py-4"
    >
      <header className="flex flex-col gap-2">
        <h2 className={HEADING_CLS}>{t("ai.panelLabel")}</h2>
        <fieldset aria-label={t("ai.routeLabel")} className="m-0 flex flex-wrap gap-1 border-0 p-0">
          {ROUTES.map((id) => (
            <Button
              key={id ?? "auto"}
              variant={routeVar(id)}
              className={BTN_SM}
              onClick={pickRoute(id)}
            >
              {id ?? t("ai.routeAuto")}
            </Button>
          ))}
        </fieldset>
      </header>

      <section aria-label={t("ai.contextTitle")} className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className={HEADING_CLS}>{t("ai.contextTitle")}</span>
          <Button variant="secondary" className={BTN_SM} onClick={() => setMentionOpen((o) => !o)}>
            {t("ai.addMention")}
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {chips.map(([id, label, onRemove]) => (
            <button key={id} type="button" onClick={onRemove} className={CHIP_CLS}>
              <span className="max-w-44 truncate">{label}</span> ×
            </button>
          ))}
        </div>

        {mentionOpen && available.length > 0 && (
          <div className={`${CARD_CLS} flex flex-col gap-1 p-2`}>
            {available.map((p) => (
              <button key={p.id} type="button" onClick={() => addMention(p)} className={ITEM_CLS}>
                @{titleOf(p)}
              </button>
            ))}
          </div>
        )}

        <Button variant="secondary" className={BTN_SM} onClick={() => setPreviewOpen((o) => !o)}>
          {t("ai.previewToggle")}
        </Button>
        {previewOpen && (
          <pre data-testid="ai-context-preview" className={PRE_CLS}>
            {previewText}
          </pre>
        )}
      </section>

      <section aria-label={t("ai.selectionActions")} className="flex flex-col gap-2">
        <span className={HEADING_CLS}>{t("ai.selectionActions")}</span>
        <Input value={selection} aria-label={t("ai.selectionActions")} onChange={onSelInput} />
        <div className="grid grid-cols-2 gap-1.5">
          {ACTIONS.map((k) => (
            <Button key={k} variant="secondary" className={BTN_SM} onClick={() => onAction(k)}>
              {t(`ai.${k}`)}
            </Button>
          ))}
        </div>
      </section>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {turns.map(([id, q, a, m]) => (
          <div key={id} className={`${CARD_CLS} flex flex-col gap-1.5 p-2.5 text-xs`}>
            <p className="m-0 font-medium text-[color:var(--fg)]">{q}</p>
            {m !== null && (
              <span className="font-mono text-[11px] text-[color:var(--fg-muted)]">{m}</span>
            )}
            <p className="m-0 whitespace-pre-wrap text-[color:var(--fg)]">{a}</p>
          </div>
        ))}
      </div>

      {error !== null && (
        <p role="alert" className="text-xs text-[color:var(--danger)]">
          {error}
        </p>
      )}

      <form className="flex gap-1.5" onSubmit={onSubmit}>
        <Input
          value={prompt}
          aria-label={t("ai.promptLabel")}
          onChange={onPrompt}
          className="min-w-0 flex-1"
        />
        {activeId !== null ? (
          <Button variant="secondary" onClick={onCancel}>
            {t("ai.cancel")}
          </Button>
        ) : (
          <Button type="submit">{t("ai.send")}</Button>
        )}
      </form>
    </aside>
  );
}
