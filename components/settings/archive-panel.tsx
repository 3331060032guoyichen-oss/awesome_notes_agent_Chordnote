"use client";
import { useEffect, useState } from "react";
import { SectionHeader } from "./section-header";

type Item = { id: string; kind: "raw" | "knowledge" | "relation"; title: string | null; path: string; dependencies: { revisions: number; relations: number; proposals: number } };

const KIND_LABEL: Record<Item["kind"], string> = { raw: "原始记录", knowledge: "知识页", relation: "正式关系" };

export function ArchivePanel() {
  const [items, setItems] = useState<Item[]>([]), [chosen, setChosen] = useState<Item | null>(null), [reason, setReason] = useState(""), [consent, setConsent] = useState(false), [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() { const r = await fetch("/api/archive"); const p = await r.json(); if (!r.ok) throw new Error("归档读取失败"); setItems(p.items); }
  useEffect(() => { void load().catch(e => setStatus(e.message)); }, []);
  async function act(item: Item, purge: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/archive", { method: purge ? "DELETE" : "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...item, reason, confirmDependencies: consent }) }); const p = await r.json();
      if (!r.ok) { setStatus(p.error?.message ?? "操作失败"); return; } setChosen(null); setReason(""); setConsent(false); setStatus(purge ? "已永久删除" : item.kind === "relation" ? "关系已恢复" : "已恢复原路径"); await load(); window.dispatchEvent(new Event("chordnote-documents-changed"));
    } catch (e) { setStatus(e instanceof Error ? e.message : "操作失败"); } finally { setBusy(false); }
  }
  return <div className="archive-panel">
    <SectionHeader title="归档" body="已收起的原始记录、知识页与关系。这里恢复会回到原路径；永久清除只在这一处发生，并且必须写明理由。" />
    <section className="content-section settings-panel-body">
      {items.length ? <div className="archive-list">
        {items.map(item => <article className="archive-row" key={item.id}>
          <div className="archive-row-copy">
            <strong>{item.title || "未命名"}</strong>
            <p>{item.path}</p>
            <small>
              {KIND_LABEL[item.kind]}
              {item.kind === "relation" ? "" : ` · ${item.dependencies.revisions} 个修订 · ${item.dependencies.relations} 个正式关系 · ${item.dependencies.proposals} 个关联提议`}
            </small>
          </div>
          <div className="archive-row-actions">
            <button type="button" className="button-secondary" disabled={busy} onClick={() => void act(item, false)}>恢复</button>
            <button type="button" className="archive-danger" disabled={busy} onClick={() => { setChosen(item); setConsent(false); setReason(""); }}>永久删除</button>
          </div>
        </article>)}
      </div> : <div className="settings-empty"><b>归档为空</b><p>归档的内容会出现在这里。恢复不会改变正文，只是把它放回原来的位置。</p></div>}

      {chosen ? <form className="purge-confirm" onSubmit={e => { e.preventDefault(); void act(chosen, true); }}>
        <h2>永久删除「{chosen.title || "未命名"}」</h2>
        <p>{chosen.kind === "relation" ? "将永久清除这条正式关系，无法恢复。" : `将同时清除 ${chosen.dependencies.revisions} 个修订、${chosen.dependencies.relations} 个正式关系和 ${chosen.dependencies.proposals} 个关联提议。正文里指向它的引用会变成未解析链接。`}</p>
        <label className="field">
          <span className="field-label">删除原因</span>
          <input className="text-input" value={reason} required placeholder="例如：重复录入，已并入另一条记录" onChange={e => setReason(e.target.value)} />
        </label>
        <label className="purge-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>确认清除以上内容，无法恢复</span></label>
        <div className="purge-actions">
          <button type="submit" className="button-danger" disabled={busy || !consent || !reason.trim()}>确认永久删除</button>
          <button type="button" className="button-secondary" onClick={() => setChosen(null)}>取消</button>
        </div>
      </form> : null}

      {status ? <p className="settings-note" role="status">{status}</p> : null}
    </section>
  </div>;
}
