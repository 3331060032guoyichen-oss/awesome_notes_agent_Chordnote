"use client";

import { useEffect, useState } from "react";

const VENDORS = {
  deepseek: { name: "DeepSeek", endpoint: "https://api.deepseek.com", model: "deepseek-chat" },
  qwen: { name: "通义千问", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  glm: { name: "智谱 GLM", endpoint: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.5" },
  moonshot: { name: "Moonshot", endpoint: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  siliconflow: { name: "硅基流动", endpoint: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V3" },
};

type Category = "local" | "vendor" | "custom";

/** 已保存配置的快照，只用于判断表单是否有未保存的改动。 */
type SavedForm = { backend: "api" | "acp"; category: Category; vendor: keyof typeof VENDORS; endpoint: string; model: string; timeout: number };
type SettingsPayload = {
  settings?: {
    agentBackend?: "api" | "acp";
    acp?: { label: string; command: string; args: string[] };
    category?: Category;
    provider: string;
    vendor?: keyof typeof VENDORS;
    baseUrl: string;
    model: string;
    timeoutMs: number;
    apiKeyConfigured: boolean;
    locked: string[];
  };
};

export function ModelPanel() {
  const [backend, setBackend] = useState<"api" | "acp">("api");
  const [acpLabel, setAcpLabel] = useState("外部 Agent"), [command, setCommand] = useState(""), [args, setArgs] = useState("[]");
  const [category, setCategory] = useState<Category>("vendor"), [vendor, setVendor] = useState<keyof typeof VENDORS>("deepseek");
  const [endpoint, setEndpoint] = useState("https://api.deepseek.com"), [model, setModel] = useState("deepseek-chat"), [key, setKey] = useState("");
  const [configured, setConfigured] = useState(false), [timeout, setTimeoutValue] = useState(30_000), [locked, setLocked] = useState<string[]>([]);
  const [status, setStatus] = useState(""), [models, setModels] = useState<string[]>([]), [busy, setBusy] = useState(false);
  // 已保存配置的快照。「获取模型」「测试连接」只对已保存的配置生效（服务端不接受请求里带来的地址与密钥），
  // 所以表单有改动时必须先保存，否则测的其实是另一份配置。
  const [saved, setSaved] = useState<SavedForm | null>(null);

  useEffect(() => {
    void fetch("/api/settings/model").then(response => response.json()).then((payload: SettingsPayload) => {
      if (!payload.settings) return;
      const settings = payload.settings;
      const nextBackend = settings.agentBackend ?? "api";
      const nextCategory = settings.category ?? (settings.provider === "ollama" ? "local" : settings.provider === "deepseek" ? "vendor" : "custom");
      const nextVendor: keyof typeof VENDORS = settings.vendor && settings.vendor in VENDORS ? settings.vendor as keyof typeof VENDORS : "deepseek";
      setBackend(nextBackend);
      if (settings.acp) { setAcpLabel(settings.acp.label); setCommand(settings.acp.command); setArgs(JSON.stringify(settings.acp.args)); }
      setCategory(nextCategory);
      setVendor(nextVendor);
      setEndpoint(settings.baseUrl); setModel(settings.model); setTimeoutValue(settings.timeoutMs);
      setConfigured(settings.apiKeyConfigured); setLocked(settings.locked);
      setSaved({ backend: nextBackend, category: nextCategory, vendor: nextVendor, endpoint: settings.baseUrl, model: settings.model, timeout: settings.timeoutMs });
    }).catch(() => setStatus("模型设置读取失败"));
  }, []);

  function choose(next: Category) {
    setBackend("api"); setCategory(next); setModels([]); setKey("");
    if (next === "local") { setEndpoint("http://127.0.0.1:11434/v1"); setModel("qwen3:4b"); setTimeoutValue(120_000); }
    else if (next === "vendor") { setEndpoint(VENDORS[vendor].endpoint); setModel(VENDORS[vendor].model); setTimeoutValue(30_000); }
    else { setEndpoint(""); setModel(""); setTimeoutValue(30_000); }
  }

  async function save() {
    const patch: Record<string, unknown> = { category, vendor, agentBackend: backend };
    if (backend === "acp") {
      const parsed: unknown = JSON.parse(args);
      if (!Array.isArray(parsed) || parsed.some(value => typeof value !== "string")) throw new Error("参数必须是 JSON 字符串数组");
      patch.acp = { label: acpLabel, command, args: parsed };
    }
    const provider = category === "local" ? "ollama" : category === "vendor" && vendor === "deepseek" ? "deepseek" : "custom";
    const values = { provider, baseUrl: endpoint, model: backend === "acp" ? (model || "agent-default") : (model || "pending-selection"), timeoutMs: timeout, ...(key ? { apiKey: key } : {}) };
    for (const [name, value] of Object.entries(values)) if (!locked.includes(name)) patch[name] = value;
    const response = await fetch("/api/settings/model", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message ?? "保存失败");
    setConfigured(payload.settings.apiKeyConfigured); setKey("");
    setSaved({ backend, category, vendor, endpoint, model, timeout });
    window.dispatchEvent(new Event("chordnote-model-changed"));
  }

  function isDirty() {
    if (!saved) return true;
    if (key.trim()) return true;
    if (backend !== saved.backend || category !== saved.category || timeout !== saved.timeout) return true;
    if (backend === "acp") return false;
    if (category === "vendor" && vendor !== saved.vendor) return true;
    return endpoint !== saved.endpoint || model !== saved.model;
  }

  async function run(action: "save" | "models" | "test") {
    if (action === "save") {
      setBusy(true); setStatus("");
      try { await save(); setStatus("已保存"); }
      catch (error) { setStatus(error instanceof Error ? error.message : "保存失败"); }
      finally { setBusy(false); }
      return;
    }

    // 「获取模型」「测试连接」读的是服务端已保存的配置。表单改过就必须先保存，
    // 否则测的是另一份配置——以前这里会顺手保存，测试失败后应用已经指向一个连不上的端点。
    if (isDirty()) {
      setModels([]);
      setStatus(`表单里有未保存的修改。先点「保存」，再${action === "models" ? "获取模型" : "测试连接"}。`);
      return;
    }

    setBusy(true); setStatus("");
    try {
      if (action === "models") {
        const response = await fetch("/api/settings/model/models"), payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "获取模型失败");
        setModels(payload.models); setStatus(`已获取 ${payload.models.length} 个模型，可在 Agent 输入框中选择。`);
      } else {
        const response = await fetch("/api/settings/model/test", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "测试连接失败");
        setStatus(payload.checks.map((check: { label: string; status: string; detail: string }) => `${check.label}：${check.status} ${check.detail}`).join("\n"));
      }
    } catch (error) { setStatus(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  }

  async function clearKey() {
    setBusy(true); setStatus("");
    try {
      const response = await fetch("/api/settings/model", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "密钥清除失败");
      setConfigured(false); setKey(""); setStatus("密钥已清除");
    } catch (error) { setStatus(error instanceof Error ? error.message : "密钥清除失败"); }
    finally { setBusy(false); }
  }

  return <section className="model-settings">
    <h1>模型与服务</h1>
    <div className="model-categories" role="tablist" aria-label="模型来源">
      {([[
        "local", "本地模型",
      ], ["vendor", "模型厂商"], ["custom", "自定义模型"]] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={category === id} disabled={locked.includes("provider")} onClick={() => choose(id)}>{label}</button>)}
    </div>

    <div className="model-fields">
      {category === "vendor" ? <label><span>厂商类型</span><select value={vendor} disabled={locked.includes("provider")} onChange={event => { const next = event.target.value as keyof typeof VENDORS; setVendor(next); setEndpoint(VENDORS[next].endpoint); setModel(VENDORS[next].model); setTimeoutValue(30_000); setModels([]); setKey(""); }}>{Object.entries(VENDORS).map(([id, item]) => <option key={id} value={id}>{item.name}</option>)}</select></label> : null}
      {category === "custom" ? <label><span>Agent 接入</span><select aria-label="Agent 接入" value={backend} disabled={locked.includes("provider")} onChange={event => { const next = event.target.value as "api" | "acp"; setBackend(next); setModel(next === "acp" ? "agent-default" : ""); }}><option value="api">兼容模型 API</option><option value="acp">ACP 外部 Agent</option></select></label> : null}

      {backend === "acp" ? <>
        <label><span>Agent 名称</span><input value={acpLabel} onChange={event => setAcpLabel(event.target.value)} /></label>
        <label><span>ACP 程序绝对路径</span><input value={command} onChange={event => setCommand(event.target.value)} spellCheck={false} /></label>
        <label><span>参数（JSON 数组）</span><textarea value={args} onChange={event => setArgs(event.target.value)} /></label>
        <p className="model-help">外部 Agent 由用户安装并登录。Chordnote 只开放读取与待确认提议工具，额外权限请求会被拒绝。</p>
      </> : <>
        <label><span>{category === "local" ? "本地推理端点" : "API 接口地址 (Endpoint)"}</span><input value={endpoint} disabled={locked.includes("baseUrl")} onChange={event => setEndpoint(event.target.value)} spellCheck={false} placeholder="https://api.deepseek.com" /></label>
        {category !== "local" ? <label><span>API 密钥 (API Key)</span><input type="password" autoComplete="off" value={key} disabled={locked.includes("apiKey")} placeholder={configured ? "已配置，如需更换请输入新的 Key" : "请输入 API Key"} onChange={event => setKey(event.target.value)} /></label> : null}
      </>}
      {category === "custom" ? <label><span>模型 ID (Model ID)</span><input value={model} disabled={locked.includes("model")} onChange={event => setModel(event.target.value)} /></label> : null}
      <label><span>请求超时 (毫秒)</span><input type="number" value={timeout} min={1000} max={600000} disabled={locked.includes("timeoutMs")} onChange={event => setTimeoutValue(Number(event.target.value))} /></label>
    </div>

    <div className="model-actions">
      <button className="is-primary" type="button" disabled={busy} onClick={() => void run("save")}>保存</button>
      <button type="button" disabled={busy || backend === "acp"} title="读取已保存配置里的模型列表" onClick={() => void run("models")}>获取模型</button>
      <button type="button" disabled={busy} title="测试已保存的配置；改了表单请先保存" onClick={() => void run("test")}>测试连接</button>
      {/* 本地模型与 ACP 都没有可清除的密钥；按钮留着只会让人以为这里有东西可清。 */}
      {backend === "api" && category !== "local" ? <button className="is-danger" type="button" disabled={busy || locked.includes("apiKey")} onClick={() => void clearKey()}>清除密钥</button> : null}
    </div>
    {models.length ? <div className="model-results"><span>可用模型</span><ul>{models.map(id => <li key={id}>{id}</li>)}</ul></div> : null}
    <p className="model-status" role="status">{status}</p>
  </section>;
}
