import type { Editor } from "@fossil/editor";
import { Button, Input } from "@fossil/ui";
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ChatContext,
  ObjectMeta,
  ProviderId,
  ProviderInfo,
  RequestId,
  RouteRule,
  TaskKind,
  Usage,
} from "./bindings";
import { commands, events } from "./bindings";
import { formatObjectTitle } from "./sidebar";
import { errorLabel } from "./vault-screen";

const MODEL_INFO: Record<ProviderId, [string, number | null]> = {
  Agy: ["gemini-2.5-pro", null],
  Claude: ["claude-sonnet-4-20250514", null],
  Codex: ["gpt-4o", null],
  Anthropic: ["claude-sonnet-4-20250514", 3.0],
  OpenAi: ["gpt-4o", 2.5],
  Gemini: ["gemini-2.5-pro", 1.25],
  Ollama: ["llama3.2", 0.0],
};
const ALL_PROVIDERS = Object.keys(MODEL_INFO) as ProviderId[];
const ROUTES: readonly (ProviderId | null)[] = [null, ...ALL_PROVIDERS];
const ACTIONS = ["actionRewrite", "actionSummarize", "actionTranslate", "actionTone"] as const;

type TurnRange = { from: number; to: number } | null;
type TurnStatus = "chat" | "streaming" | "ready" | "confirmed" | "rejected" | "cancelled" | "error";
type ChatTurn = [RequestId, string, string, string, Usage | null, string, TurnRange, TurnStatus];

const HEADING_CLS = "text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-muted)]";
const CARD_CLS = "rounded border border-[color:var(--border)] bg-[color:var(--bg-elevated)]";
const CHIP_CLS = `${CARD_CLS} inline-flex items-center gap-1.5 px-2 py-1 text-xs text-[color:var(--fg)]`;
const PRE_CLS = `${CARD_CLS} m-0 whitespace-pre-wrap break-words p-2.5 font-mono text-xs text-[color:var(--fg)]`;
const ITEM_CLS =
  "rounded px-2 py-1 text-left text-xs text-[color:var(--fg)] hover:bg-[color:var(--bg)]";
const META_CLS = "font-mono text-[11px] text-[color:var(--fg-muted)]";
const BTN_SM = "h-6 px-2 text-xs";

const redactSecrets = (s: string) =>
  s.replace(/\b(sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,})/g, "[redactado]");
const formatUsd = (u: number) => `$${u < 0.01 && u > 0 ? u.toFixed(4) : u.toFixed(2)} USD`;
const patchTurn = (r: ChatTurn, p: Record<number, unknown>): ChatTurn =>
  Object.assign([...r] as ChatTurn, p);
/** The editor of the page this panel belongs to: with split panes there are two (#166). */
export const getEditor = (panel: Element | null): Editor | null =>
  (
    (panel?.closest("[data-pane]") ?? document).querySelector(".fossil-editor") as {
      editor?: Editor;
    } | null
  )?.editor ?? null;
const readEditorSel = (panel: Element | null) => {
  const ed = getEditor(panel);
  if (!ed) return null;
  const { from, to } = ed.state.selection;
  return from < to ? { from, to, text: ed.state.doc.textBetween(from, to, "\n").trim() } : null;
};

/** Right-side AI panel (#14, #80): context preview, provider/model/usage visibility and proposal confirmation. */
export function AiChatPanel({ object }: { object: ObjectMeta }) {
  const { t, i18n } = useTranslation();
  const [attached, setAttached] = useState<ObjectMeta[]>([object]);
  const [selection, setSelection] = useState("");
  const rangeRef = useRef<TurnRange>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const [pages, setPages] = useState<ObjectMeta[]>([]);
  const [routes, setRoutes] = useState<RouteRule[]>([]);
  const [providersInfo, setProvidersInfo] = useState<ProviderInfo[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(true);
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
    void commands.aiRoutesGet?.()?.then((res) => setRoutes(res.status === "ok" ? res.data : []));
    void commands
      .aiProviders?.()
      ?.then((res) => setProvidersInfo(res.status === "ok" ? res.data : []));
    const onSel = () => {
      const es = readEditorSel(panelRef.current);
      const text = es?.text || (window.getSelection?.()?.toString().trim() ?? "");
      if (text !== "") {
        rangeRef.current = es ? { from: es.from, to: es.to } : null;
        setSelection(text);
      }
    };
    onSel();
    document.addEventListener("selectionchange", onSel);
    let off = Promise.resolve<() => void>(() => {});
    try {
      off = events.aiEvent.listen(({ payload: { request_id, event } }) => {
        const upd = (fn: (r: ChatTurn) => ChatTurn) =>
          setTurns((p) => p.map((r) => (r[0] === request_id ? fn(r) : r)));
        if ("Started" in event) {
          const b = `${event.Started.provider} · ${event.Started.model}`;
          upd((r) => patchTurn(r, { 3: b }));
        } else if ("Delta" in event) {
          const d = event.Delta.text;
          upd((r) => patchTurn(r, { 2: redactSecrets(r[2] + d) }));
        } else if ("Usage" in event) {
          upd((r) => patchTurn(r, { 4: event.Usage ?? null }));
        } else if ("Done" in event) {
          const s = event.Done.summary;
          const m = `${s.provider} · ${s.model}`;
          upd((r) => patchTurn(r, { 3: m, 4: s.usage, 7: r[7] === "streaming" ? "ready" : r[7] }));
          setActiveId((cur) => (cur === request_id ? null : cur));
        } else if ("Error" in event) {
          upd((r) => patchTurn(r, { 7: "error" }));
          setError(redactSecrets(event.Error.message));
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

  const resolveProvider = (task: TaskKind): ProviderId => {
    if (provider !== null) return provider;
    const def =
      task === "Inline" ? (["Anthropic", ...ALL_PROVIDERS] as ProviderId[]) : ALL_PROVIDERS;
    const chain = routes.find((r) => r.task === task)?.prefer ?? def;
    const ready = chain.find(
      (id) => providersInfo.find((p) => p.id === id)?.health.status === "Ready",
    );
    return ready ?? chain[0] ?? "Agy";
  };
  const chatTarget = resolveProvider("Chat");
  const inlineTarget = resolveProvider("Inline");
  const badgeFor = (id: ProviderId) => `${id} · ${MODEL_INFO[id][0]}`;

  const sendChat = async (text: string, task: TaskKind, selOverride?: string) => {
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
        redactSecrets(
          res.error === "NotImplemented"
            ? t("error.notImplemented")
            : t("error.generic", { error: errorLabel(res.error) }),
        ),
      );
      return;
    }
    const m = badgeFor(resolveProvider(task));
    const st: TurnStatus = task === "Inline" ? "streaming" : "chat";
    setActiveId(res.data);
    setTurns((p) => [...p, [res.data, cleanPrompt, "", m, null, cleanSel, rangeRef.current, st]]);
  };

  const onAction = (k: string) => {
    const es = readEditorSel(panelRef.current);
    if (es && es.text !== "") rangeRef.current = { from: es.from, to: es.to };
    const sel = (es?.text || window.getSelection?.()?.toString().trim() || selection).trim();
    if (sel !== "" && sel !== selection) setSelection(sel);
    const label = t(`ai.${k}`);
    void sendChat(sel !== "" ? `${label}: ${sel}` : label, "Inline", sel);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const next = prompt;
    setPrompt("");
    void sendChat(next, "Chat");
  };
  const onPrompt = (e: ChangeEvent<HTMLInputElement>) => {
    setPrompt(e.target.value);
    if (e.target.value.endsWith("@")) setMentionOpen(true);
  };
  const onSelInput = (e: ChangeEvent<HTMLInputElement>) => {
    rangeRef.current = null;
    setSelection(e.target.value);
  };
  const setTurnStatus = (id: RequestId, st: TurnStatus) =>
    setTurns((p) => p.map((r) => (r[0] === id ? patchTurn(r, { 7: st }) : r)));
  const onCancel = () => {
    if (activeId) {
      void commands.aiCancel?.(activeId);
      setTurnStatus(activeId, "cancelled");
    }
    setActiveId(null);
  };
  const confirmTurn = ([id, , a, , , sel, range]: ChatTurn) => {
    const ed = getEditor(panelRef.current);
    if (ed) {
      let target = range;
      if (!target && sel !== "") {
        ed.state.doc.descendants((node, pos) => {
          if (target || !node.isText || !node.text) return !target;
          const idx = node.text.indexOf(sel);
          if (idx >= 0) target = { from: pos + idx, to: pos + idx + sel.length };
          return !target;
        });
      }
      ed.chain()
        .focus()
        .insertContentAt(target ?? ed.state.selection.to, a)
        .run();
    }
    setSelection(a);
    setTurnStatus(id, "confirmed");
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
  const estTokens = previewText.length === 0 ? 0 : Math.max(1, Math.ceil(previewText.length / 4));
  const estTarget = selection.trim() !== "" && prompt.trim() === "" ? inlineTarget : chatTarget;
  const estRate = MODEL_INFO[estTarget][1];
  const estCost = estRate !== null ? formatUsd((estTokens * estRate) / 1e6) : null;
  const estLabel = estCost
    ? t("ai.estimatedTokensCost", { tokens: estTokens, cost: estCost })
    : t("ai.estimatedTokens", { tokens: estTokens });
  const formatUsage = ({ input_tokens: input, output_tokens: output, cost_usd }: Usage) => {
    const base = { total: input + output, input, output };
    return cost_usd !== null
      ? t("ai.actualUsageCost", { ...base, cost: formatUsd(cost_usd) })
      : t("ai.actualUsage", base);
  };

  return (
    <aside
      ref={panelRef}
      aria-label={t("ai.panelLabel")}
      className="flex h-full w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-[color:var(--border)] px-4 py-6 in-data-[density=compact]:gap-3 in-data-[density=compact]:py-4"
    >
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className={HEADING_CLS}>{t("ai.panelLabel")}</h2>
          <span data-testid="ai-chat-route" className={META_CLS}>
            {badgeFor(chatTarget)}
          </span>
        </div>
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
        <span data-testid="ai-estimated-usage" className={META_CLS}>
          {estLabel}
        </span>
        {previewOpen && (
          <pre data-testid="ai-context-preview" className={PRE_CLS}>
            {previewText}
          </pre>
        )}
      </section>

      <section aria-label={t("ai.selectionActions")} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className={HEADING_CLS}>{t("ai.selectionActions")}</span>
          <span data-testid="ai-selection-route" className={META_CLS}>
            {badgeFor(inlineTarget)}
          </span>
        </div>
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
        {turns.map((turn) => {
          const [id, q, a, m, u, , , st] = turn;
          return (
            <div key={id} className={`${CARD_CLS} flex flex-col gap-1.5 p-2.5 text-xs`}>
              <div className="flex items-center justify-between gap-2">
                <p className="m-0 min-w-0 truncate font-medium text-[color:var(--fg)]">{q}</p>
                {st !== "chat" && (
                  <span className={`shrink-0 ${META_CLS}`}>{t("ai.proposalBadge")}</span>
                )}
              </div>
              <span data-testid="ai-turn-route" className={META_CLS}>
                {m}
              </span>
              {u !== null && (
                <span data-testid="ai-actual-usage" className={META_CLS}>
                  {formatUsage(u)}
                </span>
              )}
              <p className="m-0 whitespace-pre-wrap text-[color:var(--fg)]">{a}</p>
              {a !== "" && st === "ready" && (
                <div className="flex gap-1.5 pt-0.5">
                  <Button variant="primary" className={BTN_SM} onClick={() => confirmTurn(turn)}>
                    {t("ai.confirmInsert")}
                  </Button>
                  <Button
                    variant="secondary"
                    className={BTN_SM}
                    onClick={() => setTurnStatus(id, "rejected")}
                  >
                    {t("ai.rejectProposal")}
                  </Button>
                </div>
              )}
              {st === "confirmed" && <span className={META_CLS}>{t("ai.proposalConfirmed")}</span>}
              {st === "rejected" && <span className={META_CLS}>{t("ai.proposalRejected")}</span>}
            </div>
          );
        })}
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
