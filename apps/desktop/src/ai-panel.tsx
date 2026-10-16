import { Button, Input } from "@fossil/ui";
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
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
const DEFAULT_PREFER: Record<TaskKind, ProviderId[]> = {
  Chat: ALL_PROVIDERS,
  Inline: ["Anthropic", "OpenAi", "Gemini", "Ollama", "Agy", "Claude", "Codex"],
  Embedding: ["OpenAi", "Gemini", "Ollama"],
};

type TurnStatus = "pending" | "confirmed" | "rejected" | "cancelled";
type ChatTurn = [RequestId, string, string, string, Usage | null, string, TurnStatus];

const HEADING_CLS =
  "shrink-0 text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-muted)]";
const CARD_CLS = "rounded border border-[color:var(--border)] bg-[color:var(--bg-elevated)]";
const CHIP_CLS = `${CARD_CLS} inline-flex items-center gap-1.5 px-2 py-0.5 text-xs text-[color:var(--fg)]`;
const PRE_CLS = `${CARD_CLS} m-0 whitespace-pre-wrap break-words p-2 font-mono text-[11px] text-[color:var(--fg)]`;
const ITEM_CLS =
  "rounded px-2 py-1 text-left text-xs text-[color:var(--fg)] hover:bg-[color:var(--bg)]";
const META_CLS = "font-mono text-[11px] text-[color:var(--fg-muted)]";
const BTN_SM = "h-6 shrink-0 px-1.5 text-xs";

const redactSecrets = (s: string) =>
  s.replace(/\b(sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,})/g, "[redactado]");
const formatUsd = (u: number) => `$${u < 0.01 && u > 0 ? u.toFixed(4) : u.toFixed(2)} USD`;
const mapTurn = (p: ChatTurn[], id: RequestId, fn: (r: ChatTurn) => ChatTurn) =>
  p.map((r) => (r[0] === id ? fn(r) : r));

/** Right-side AI panel (#14, #80): context preview, provider/model/usage visibility and proposal confirmation. */
export function AiChatPanel({ object }: { object: ObjectMeta }) {
  const { t, i18n } = useTranslation();
  const [attached, setAttached] = useState<ObjectMeta[]>([object]);
  const [selection, setSelection] = useState("");
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
      const text = window.getSelection?.()?.toString().trim() ?? "";
      if (text !== "") setSelection(text);
    };
    document.addEventListener("selectionchange", onSel);
    let off = Promise.resolve<() => void>(() => {});
    try {
      off = events.aiEvent.listen(({ payload: { request_id, event } }) => {
        const upd = (fn: (r: ChatTurn) => ChatTurn) => setTurns((p) => mapTurn(p, request_id, fn));
        if ("Started" in event) {
          const b = `${event.Started.provider} · ${event.Started.model}`;
          upd((r) => [r[0], r[1], r[2], b, r[4], r[5], r[6]]);
        } else if ("Delta" in event) {
          const d = redactSecrets(event.Delta.text);
          upd((r) => [r[0], r[1], r[2] + d, r[3], r[4], r[5], r[6]]);
        } else if ("Usage" in event) {
          upd((r) => [r[0], r[1], r[2], r[3], event.Usage ?? null, r[5], r[6]]);
        } else if ("Done" in event) {
          const s = event.Done.summary;
          upd((r) => [r[0], r[1], r[2], `${s.provider} · ${s.model}`, s.usage, r[5], r[6]]);
          setActiveId((cur) => (cur === request_id ? null : cur));
        } else if ("Error" in event) {
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
    const chain = routes.find((r) => r.task === task)?.prefer ?? DEFAULT_PREFER[task];
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
    const b = badgeFor(resolveProvider(task));
    setActiveId(res.data);
    setTurns((p) => [...p, [res.data, cleanPrompt, "", b, null, cleanSel, "pending"]]);
  };

  const onAction = (k: string) => {
    const sel = (window.getSelection?.()?.toString().trim() || selection).trim();
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
  const onSelInput = (e: ChangeEvent<HTMLInputElement>) => setSelection(e.target.value);
  const setTurnStatus = (id: RequestId, status: TurnStatus) =>
    setTurns((p) => mapTurn(p, id, (r) => [r[0], r[1], r[2], r[3], r[4], r[5], status]));
  const onCancel = () => {
    if (activeId) {
      void commands.aiCancel?.(activeId);
      setTurnStatus(activeId, "cancelled");
    }
    setActiveId(null);
  };
  const confirmTurn = ([id, , a, , , sel]: ChatTurn) => {
    const surface = document.querySelector('[contenteditable="true"], [data-testid="page-body"]');
    if (surface) {
      const cur = surface.textContent ?? "";
      surface.textContent =
        sel !== "" && cur.includes(sel) ? cur.replace(sel, a) : `${cur}${cur ? "\n" : ""}${a}`;
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
  const estRate = MODEL_INFO[chatTarget][1];
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
      aria-label={t("ai.panelLabel")}
      className="flex h-full w-96 shrink-0 flex-col gap-2 overflow-y-auto border-l border-[color:var(--border)] px-3.5 py-2.5"
    >
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
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

      <section aria-label={t("ai.contextTitle")} className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className={HEADING_CLS}>{t("ai.contextTitle")}</span>
          <Button variant="secondary" className={BTN_SM} onClick={() => setMentionOpen((o) => !o)}>
            {t("ai.addMention")}
          </Button>
        </div>

        <div className="flex flex-wrap gap-1">
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

        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
          <Button variant="secondary" className={BTN_SM} onClick={() => setPreviewOpen((o) => !o)}>
            {t("ai.previewToggle")}
          </Button>
          <span data-testid="ai-estimated-usage" className={META_CLS}>
            {estLabel}
          </span>
        </div>
        <pre
          data-testid="ai-context-preview"
          className={previewOpen ? PRE_CLS : `${PRE_CLS} max-h-12 overflow-hidden`}
        >
          {previewText}
        </pre>
      </section>

      <section aria-label={t("ai.selectionActions")} className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <span className={HEADING_CLS}>{t("ai.selectionActions")}</span>
          <span data-testid="ai-selection-route" className={META_CLS}>
            {badgeFor(inlineTarget)}
          </span>
        </div>
        <Input value={selection} aria-label={t("ai.selectionActions")} onChange={onSelInput} />
        <div className="grid grid-cols-2 gap-1">
          {ACTIONS.map((k) => (
            <Button key={k} variant="secondary" className={BTN_SM} onClick={() => onAction(k)}>
              {t(`ai.${k}`)}
            </Button>
          ))}
        </div>
      </section>

      <div className="flex flex-1 flex-col gap-1.5">
        {turns.map((turn) => {
          const [id, q, a, m, u, , st] = turn;
          return (
            <div key={id} className={`${CARD_CLS} flex flex-col gap-1 p-2 text-xs`}>
              <div className="flex items-center justify-between gap-2">
                <p className="m-0 min-w-0 truncate font-medium text-[color:var(--fg)]">{q}</p>
                <span className={`shrink-0 ${META_CLS}`}>{t("ai.proposalBadge")}</span>
              </div>
              <span className={META_CLS}>{m}</span>
              {u !== null && (
                <span data-testid="ai-actual-usage" className={META_CLS}>
                  {formatUsage(u)}
                </span>
              )}
              <p className="m-0 whitespace-pre-wrap text-[color:var(--fg)]">{a}</p>
              {a !== "" && st === "pending" && (
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
