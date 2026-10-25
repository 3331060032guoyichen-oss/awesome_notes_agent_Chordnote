"use client";

import { ModelPanel } from "./model-panel";
import { ArchivePanel } from "./archive-panel";
import { SectionHeader } from "./section-header";
import { useEffect, useState } from "react";

import { AGENT_MANUAL, MANUAL_VERSION } from "../../lib/agent/manual";
import type { Knowledge } from "../../types/knowledge";
import { useInterfaceSound } from "../interface-sound";
import { setLatexEnabled, useLatexEnabled } from "../latex-preference";
import type { SettingsSection } from "./sections";

/**
 * 设置窗口的内容区。外层窗口与分类导航由 `settings-dialog.tsx` 提供。
 * 八个入口的能力状态见 `sections.ts`；未实现的能力只显示空态，不伪造记录。
 */

export type Studio = "darkroom" | "editorial" | "tactile";

const STUDIO_KEY = "chordnote:studio";

const STUDIOS: { id: Studio; name: string; en: string; desc: string; swatches: string[] }[] = [
  {
    id: "darkroom",
    name: "暗室星图",
    en: "夜间专注模式",
    desc: "安静的深色底与星图，适合夜间专注、推导和思考。",
    swatches: ["#030712", "#7c3aed", "#e8edf7"],
  },
  {
    id: "editorial",
    name: "暖纸批注",
    en: "书页深读模式",
    desc: "温润纸色与书页排版，适合慢慢阅读、批注与写作。",
    swatches: ["#f7f4ed", "#c8321e", "#161513"],
  },
  {
    id: "tactile",
    name: "实验工坊",
    en: "高效整理模式",
    desc: "利落网格与清晰的重点，适合集中整理、复盘与归纳。",
    swatches: ["#141619", "#ff5722", "#f3f4f6"],
  },
];

const ACCESS_LABEL: Record<string, string> = {
  auto: "自动执行",
  proposal: "先提议 · 用户确认",
  blocked: "未授权 · 不交给模型",
};

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 隐私模式等场景下 localStorage 不可用，静默降级 */
  }
}

type SettingsSpaceProps = {
  section: SettingsSection;
  archivedNotes: Knowledge[];
  onRestoreNote: (note: Knowledge) => void;
};

export function SettingsSpace({ section }: SettingsSpaceProps) {
  const { enabled: soundEnabled, preference: soundPreference, toggle: toggleSound } = useInterfaceSound();
  const latexEnabled = useLatexEnabled();
  const [bundleNote, setBundleNote] = useState("");
  const [studio, setStudio] = useState<Studio | null>(null);
  useEffect(() => {
    const saved = readStorage(STUDIO_KEY);
    const current = document.documentElement.getAttribute("data-studio");
    const selected = saved ?? current;
    setStudio(selected === "darkroom" || selected === "tactile" ? selected : "editorial");
  }, []);

  function selectStudio(selected: Studio) {
    setStudio(selected);
    document.documentElement.setAttribute("data-studio", selected);
    writeStorage(STUDIO_KEY, selected);
  }

  return (
    <div className="settings-space">
      {section === "models" ? <ModelPanel /> : null}

      {section === "tools" ? (
        <>
          <SectionHeader title="Agent 工具授权" body={`来自工作手册 ${MANUAL_VERSION}。这里只展示真实存在的工具与权限，不能在这里修改。`} />
          <section className="content-section settings-panel-body">
            <div className="tool-list">
              <b>工具清单</b>
              {AGENT_MANUAL.map((tool) => (
                <div className="tool-row" key={tool.name}>
                  <span>
                    {tool.label}
                    <small className="settings-note"> {tool.name}</small>
                  </span>
                  <em className={tool.access === "blocked" ? "no" : tool.access === "proposal" ? "mid" : "ok"}>
                    {ACCESS_LABEL[tool.access] ?? tool.access}
                  </em>
                </div>
              ))}
            </div>
            <p className="settings-note">
              标记为「未授权」的工具不会出现在模型的 tools 列表里——这不是提示词约束，而是宿主根本不提供。
            </p>
            <p className="settings-note">编辑、启用或禁用工具需要改工作手册与授权表；本轮不提供界面开关。</p>
          </section>
        </>
      ) : null}

      {section === "schedules" ? (
        <>
          <SectionHeader title="定时任务" body="定时整理与知识库体检暂未开放。" />
          <section className="content-section settings-panel-body">
            <div className="settings-empty">
              <b>没有可用的定时任务</b>
              <p>目前可以在与知音的对话中，手动发起一次整理。</p>
            </div>
          </section>
        </>
      ) : null}

      {section === "voice" ? (
        <>
          <SectionHeader title="声音与公式" body="设置轻柔的操作反馈，以及笔记中的数学公式显示。" />
          <section className="content-section settings-panel-body">
            <div className="toggle-row">
              <span>操作音效</span>
              <button
                type="button"
                className={`sw${soundEnabled ? " on" : ""}`}
                role="switch"
                aria-checked={soundEnabled}
                aria-label="界面声音"
                disabled={soundPreference === "unsupported"}
                onClick={toggleSound}
              >
                <i />
              </button>
            </div>
            <p className="settings-note">
              {soundPreference === "unsupported"
                ? "这台设备的浏览器不支持 Web Audio，声音不可用。"
                : "为点击、保存和归档添加轻柔音效。选择会保存在当前设备。"}
            </p>
            <p className="settings-note">语音输入与朗读尚未实现；这里只有界面音效。</p>
            <div className="settings-section">
              <div className="settings-section-title">数学公式</div>
              <div className="toggle-row">
                <span>LaTeX 渲染</span>
                <button
                  type="button"
                  className={`sw${latexEnabled ? " on" : ""}`}
                  role="switch"
                  aria-checked={latexEnabled}
                  aria-label="LaTeX 渲染"
                  onClick={() => setLatexEnabled(!latexEnabled)}
                >
                  <i />
                </button>
              </div>
              <p className="settings-note">
                打开后，正文里的 $...$（行内）与 $$...$$（独立成行）会按 LaTeX 渲染。
                把光标放进公式即可回到原始写法修改。
              </p>
            </div>
          </section>
        </>
      ) : null}

      {section === "themes" ? (
        <>
          <SectionHeader title="阅读主题" body="三套主题按学习场景切换，立即生效并记住选择。" />
          <section className="content-section settings-panel-body">
            <div className="theme-grid">
              {STUDIOS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`theme-card${studio === item.id ? " is-active" : ""}`}
                  aria-pressed={studio === item.id}
                  onClick={() => selectStudio(item.id)}
                >
                  <span className="theme-preview" data-preview={item.id} aria-hidden="true"><i className="theme-preview-rail" /><i className="theme-preview-sidebar" /><span className="theme-preview-page"><b /><i /><i /><i /><em /></span></span>
                  <span className="theme-name">{item.name}<span className="theme-selected" aria-hidden="true">{studio === item.id ? "✓" : ""}</span></span>
                  <span className="theme-en">{item.en}</span>
                </button>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {section === "archive" ? <ArchivePanel /> : null}

      {section === "data" ? (
        <>
          <SectionHeader title="数据与备份" body="把知识带走，也让每一次记录都有备份。" />
          <section className="content-section settings-panel-body">
            <div className="settings-section">
              <div className="settings-section-title">知识包</div>
              <p className="settings-hint">
                导出会把原始记录、知识页、关联与修订历史打成一个 JSON 文件。它不依赖本应用就能读懂，
                换台机器、换个部署都可以再导入回来。
              </p>
              <button type="button" className="button-secondary settings-test-btn" onClick={() => { window.location.href = "/api/export"; }}>
                导出知识包（.json）
              </button>
              <button type="button" className="button-secondary settings-test-btn" onClick={() => { window.location.href = "/api/export?format=markdown"; }}>
                导出 markdown 知识包（.zip）
              </button>
              <label className="field">
                <span className="field-label">导入知识包</span>
                <input
                  className="text-input"
                  type="file"
                  accept="application/json,.json"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setBundleNote("正在导入…");
                    try {
                      const payload = JSON.parse(await file.text());
                      const response = await fetch("/api/import", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload),
                      });
                      const body = (await response.json()) as {
                        result?: {
                          sources: { created: number; skipped: number };
                          notes: { created: number; skipped: number };
                          links: { created: number; skipped: number };
                          problems: string[];
                        };
                        error?: { message?: string };
                      };
                      if (!response.ok || !body.result) throw new Error(body.error?.message ?? "导入没有完成。");
                      const result = body.result;
                      const skipped = result.sources.skipped + result.notes.skipped + result.links.skipped;
                      setBundleNote(
                        `导入完成：原始记录 +${result.sources.created}、知识页 +${result.notes.created}、关联 +${result.links.created}；` +
                          `跳过同名 ${skipped} 条` +
                          (result.problems.length > 0 ? `；提示：${result.problems[0]}` : "。") +
                          " 同名内容一律保留已有、不覆盖。",
                      );
                    } catch (error) {
                      setBundleNote(error instanceof Error ? error.message : "导入没有完成，请确认文件来自 Chordnote。");
                    } finally {
                      event.target.value = "";
                    }
                  }}
                />
                <span className="settings-note">同名原始记录与知识页会保留已有、跳过导入，不会覆盖你现在的内容。</span>
              </label>
              {bundleNote ? <p className="settings-note" role="status">{bundleNote}</p> : null}
            </div>

            <div className="settings-section">
              <div className="settings-section-title">本地存储</div>
              <p className="settings-note">
                记录与模型配置保存在当前设备。导出知识包即可备份笔记；换一台设备时，导入知识包就能继续使用。
              </p>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
