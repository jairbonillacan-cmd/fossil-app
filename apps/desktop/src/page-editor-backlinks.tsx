import { Button } from "@fossil/ui";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as Y from "yjs";
import type { Link, Mention, ObjectId, ObjectMeta } from "./bindings";
import { commands, events } from "./bindings";
import { formatObjectTitle, selectWorkspaceObject } from "./sidebar";

const isWord = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** Finds the first whole-word occurrence of `targetTitle` outside `[[...]]` spans. */
export function findUnlinkedMentionRange(text: string, targetTitle: string) {
  const clean = targetTitle.trim();
  if (clean === "") return null;
  const masked = text.replace(/\[\[[^\][\n]+?\]\]/g, (m) => "\0".repeat(m.length));
  const re = new RegExp(clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  for (const m of masked.matchAll(re)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const before = start > 0 ? Array.from(masked.slice(0, start)).pop() : undefined;
    const after = end < masked.length ? Array.from(masked.slice(end))[0] : undefined;
    if (!isWord(before) && !isWord(after)) return { index: start, length: m[0].length };
  }
  return null;
}

/** Replaces the first unlinked mention of `targetTitle` inside `Y.XmlFragment("body")` with `[[<targetTitle>]]`. */
export function replaceFirstUnlinkedMentionInDoc(doc: Y.Doc, targetTitle: string): boolean {
  const clean = targetTitle.trim();
  const safeTitle = clean
    .replace(/[[\]|#\r\n]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean === "" || safeTitle === "") return false;
  const walk = (container: Y.XmlFragment | Y.XmlElement): boolean => {
    for (const node of container.toArray()) {
      if (node instanceof Y.XmlText) {
        const text = Y.Text.prototype.toString.call(node);
        const hit =
          findUnlinkedMentionRange(text, clean) ?? findUnlinkedMentionRange(text, safeTitle);
        if (hit !== null) {
          doc.transact(() => {
            node.delete(hit.index, hit.length);
            node.insert(hit.index, `[[${safeTitle}]]`);
          });
          return true;
        }
      } else if ((node instanceof Y.XmlElement || node instanceof Y.XmlFragment) && walk(node)) {
        return true;
      }
    }
    return false;
  };
  return walk(doc.getXmlFragment("body"));
}

/** Loads `mentionObjectId`'s Yjs doc, links the first unlinked occurrence of `targetTitle` and saves the update. */
export async function linkUnlinkedMention(mentionObjectId: ObjectId, targetTitle: string) {
  const loaded = await commands.objectLoadDoc?.(mentionObjectId);
  if (loaded?.status !== "ok") return false;
  const doc = new Y.Doc();
  try {
    if (loaded.data.length > 0) Y.applyUpdate(doc, Uint8Array.from(loaded.data));
    if (!replaceFirstUnlinkedMentionInDoc(doc, targetTitle)) return false;
    const update = Array.from(Y.encodeStateAsUpdate(doc));
    return (await commands.objectApplyUpdate?.(mentionObjectId, update))?.status === "ok";
  } finally {
    doc.destroy();
  }
}

export interface PageBacklinksProps {
  object: ObjectMeta;
  onSelect?: ((object: ObjectMeta) => void) | undefined;
}

const HEADING_CLS = "text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-muted)]";
const CARD_CLS = "rounded border border-[color:var(--border)] bg-[color:var(--bg-elevated)]";

/** Right-side panel (#28): Backlinks and Unlinked Mentions for the open object. */
export function PageBacklinksPanel({ object, onSelect }: PageBacklinksProps) {
  const { t, i18n } = useTranslation();
  const [backlinks, setBacklinks] = useState<Link[]>([]);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [byId, setById] = useState<Record<ObjectId, ObjectMeta>>({});

  const refresh = useCallback(async () => {
    const [bl, mn, ls] = await Promise.all([
      commands.linksBacklinks?.(object.id),
      commands.linksUnlinkedMentions?.(object.id),
      commands.objectList?.({ include_archived: false, type_key: null, parent: null, query: null }),
    ]);
    setBacklinks(bl?.status === "ok" ? bl.data : []);
    setMentions(mn?.status === "ok" ? mn.data : []);
    if (ls?.status === "ok") setById(Object.fromEntries(ls.data.map((it) => [it.id, it])));
  }, [object.id]);

  useEffect(() => {
    void refresh();
    let alive = true;
    const onEvent = () => {
      if (alive) void refresh();
    };
    let offs = Promise.resolve<Array<() => void>>([]);
    try {
      offs = Promise.all([
        events.objectChanged.listen(onEvent),
        events.indexUpdated.listen(onEvent),
      ]);
    } catch {
      // Partial ./bindings mock without `events`.
    }
    return () => {
      alive = false;
      void offs.then((fns) => {
        for (const off of fns) off();
      });
    };
  }, [refresh]);

  const openId = (id: ObjectId) => {
    const meta = byId[id] ?? { ...object, id, title: id };
    onSelect?.(meta);
    selectWorkspaceObject(meta);
  };
  const titleOf = (id: ObjectId) =>
    byId[id] ? formatObjectTitle(byId[id], i18n.language, t("editor.untitled")) : id;
  const onLink = (id: ObjectId) =>
    void linkUnlinkedMention(id, object.title).then((ok) => (ok ? refresh() : undefined));

  return (
    <aside
      aria-label={t("backlinks.panelLabel")}
      className="flex h-full w-72 shrink-0 flex-col gap-5 overflow-y-auto border-l border-[color:var(--border)] px-4 py-6 in-data-[density=compact]:gap-3 in-data-[density=compact]:py-4"
    >
      <section aria-label={t("backlinks.title")} className="flex flex-col gap-2">
        <h2 className={HEADING_CLS}>{t("backlinks.title")}</h2>
        {backlinks.length === 0 ? (
          <p className="text-xs text-[color:var(--fg-muted)]">{t("backlinks.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {backlinks.map((l, idx) => (
              <li key={`${l.from_object}-${l.from_block ?? idx}`}>
                <button
                  type="button"
                  onClick={() => openId(l.from_object)}
                  className={`${CARD_CLS} flex w-full flex-col gap-0.5 px-2.5 py-2 text-left transition-colors duration-150 ease-out motion-reduce:transition-none hover:bg-[color-mix(in_srgb,var(--accent)_6%,var(--bg-elevated))] focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]`}
                >
                  <span className="truncate text-sm font-medium text-[color:var(--fg)]">
                    {titleOf(l.from_object)}
                  </span>
                  <span className="truncate font-mono text-xs text-[color:var(--fg-muted)]">
                    {l.from_block !== null ? `${l.kind} · #${l.from_block}` : l.kind}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label={t("backlinks.mentionsTitle")} className="flex flex-col gap-2">
        <h2 className={HEADING_CLS}>{t("backlinks.mentionsTitle")}</h2>
        {mentions.length === 0 ? (
          <p className="text-xs text-[color:var(--fg-muted)]">{t("backlinks.mentionsEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {mentions.map((m) => (
              <li key={m.object_id} className={`${CARD_CLS} flex flex-col gap-1.5 p-2.5`}>
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => openId(m.object_id)}
                    className="min-w-0 truncate rounded text-left text-sm font-medium text-[color:var(--fg)] hover:underline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
                  >
                    {titleOf(m.object_id)}
                  </button>
                  <Button
                    variant="secondary"
                    className="shrink-0 px-2 py-0.5 text-xs"
                    onClick={() => onLink(m.object_id)}
                  >
                    {t("backlinks.linkAction")}
                  </Button>
                </div>
                <p className="text-xs text-[color:var(--fg-muted)]">{m.snippet}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
