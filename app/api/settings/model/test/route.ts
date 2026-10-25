import { NextResponse } from "next/server";

import {
  readModelSettings,
  resolveModelSettings,
  toProviderConfig,
} from "../../../../../lib/ai/config";
import {
  ProviderError,
  createChatProvider,
  type ChatProvider,
  type ChatToolDefinition,
} from "../../../../../lib/ai/provider";
import { unreachableDetail } from "../../../../../lib/ai/diagnostics";
import { isLocalJsonRequest } from "../../../../../lib/api/local-request";
import { runHarness } from "../../../../../lib/agent/runtime";

export const runtime = "nodejs";

/**
 * 真实连接测试。只读已保存的配置，不接受请求里带来的地址或密钥——
 * 否则这个接口会变成"让服务器替我访问任意地址"的入口。
 *
 * 四步分别报告：可访问 / 模型存在 / 普通对话 / 工具调用。
 * 工具调用失败不等于整条链路失败：先让它可见，是否换模型由用户决定。
 */

const MAX_TEST_TIMEOUT_MS = 60_000;

const PROBE_TOOL: ChatToolDefinition = {
  type: "function",
  function: {
    name: "chordnote_probe",
    description: "测试工具。调用时把 marker 设为 chordnote。",
    parameters: {
      type: "object",
      properties: {
        marker: { type: "string", description: "固定填 chordnote。" },
      },
      required: ["marker"],
    },
  },
};

type CheckStatus = "ok" | "failed" | "skipped";

type Check = { id: string; label: string; status: CheckStatus; detail: string };

function errorResponse(message: string, status: number, code: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  if (!isLocalJsonRequest(request)) {
    return errorResponse("只接受本页面的连接测试。", 403, "FORBIDDEN_ORIGIN");
  }

  let provider: ChatProvider;
  let settings: ReturnType<typeof resolveModelSettings>["settings"];

  try {
    const file = await readModelSettings();
    const resolved = resolveModelSettings(file);
    settings = resolved.settings;
    if(settings.agentBackend === "acp") {
      let called=false;
      const result=await runHarness({settings:{...settings,timeoutMs:Math.min(settings.timeoutMs,MAX_TEST_TIMEOUT_MS)},schema:"连接测试：调用 chordnote_probe，marker=chordnote，然后简短回答。",tools:[PROBE_TOOL],input:"请测试工具连接。",signal:request.signal,execute:async(name,args)=>{if(name!=="chordnote_probe"||args.marker!=="chordnote")throw Error("Invalid probe");called=true;return "ok";}});
      return NextResponse.json({checks:[{id:"reachable",label:"ACP 协议连接",status:"ok",detail:result.runtime.provider},{id:"model",label:"模型",status:"ok",detail:result.runtime.model},{id:"chat",label:"Agent 对话",status:result.message?"ok":"failed",detail:result.message?"已返回回答":"没有文本回答"},{id:"tools",label:"笔记工具桥",status:called?"ok":"failed",detail:called?"MCP 调用通过":"Agent 未调用测试工具"}]});
    }
    provider = createChatProvider({
      ...toProviderConfig(settings),
      // 连接测试要有人等得住的上限；本地小模型首次加载可能慢，给到 60 秒。
      timeoutMs: Math.min(settings.timeoutMs, MAX_TEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof ProviderError) {
      return errorResponse(error.message, error.code === "CONFIG_INVALID" ? 400 : 503, error.code);
    }

    return errorResponse("读取模型配置失败。", 500, "SETTINGS_READ_FAILED");
  }

  const checks: Check[] = [];
  let models: string[] = [];
  let reachable = false;

  try {
    models = await provider.listModels();
    reachable = true;
    checks.push({
      id: "reachable",
      label: "服务可访问",
      status: "ok",
      detail: `读回 ${models.length} 个模型。`,
    });
  } catch {
    checks.push({
      id: "reachable",
      label: "服务可访问",
      status: "failed",
      detail: unreachableDetail(settings),
    });
  }

  if (!reachable) {
    checks.push(
      { id: "model", label: "模型存在", status: "skipped", detail: "服务不可访问，未检查。" },
      { id: "chat", label: "普通对话", status: "skipped", detail: "服务不可访问，未检查。" },
      { id: "tools", label: "工具调用", status: "skipped", detail: "服务不可访问，未检查。" },
    );

    return NextResponse.json({ ok: false, checks });
  }

  const modelFound = models.includes(settings.model);
  checks.push({
    id: "model",
    label: "模型存在",
    status: modelFound ? "ok" : "failed",
    detail: modelFound
      ? `列表里有 ${settings.model}。`
      : `列表里没有 ${settings.model}。现有：${models.slice(0, 8).join("、") || "（空）"}。`,
  });

  let chatOk = false;

  try {
    const completion = await provider.chat({
      messages: [{ role: "user", content: "回复 ok 即可。" }],
    });
    chatOk = completion.content.length > 0;
    checks.push({
      id: "chat",
      label: "普通对话",
      status: chatOk ? "ok" : "failed",
      detail: chatOk ? "收到回复。" : "收到空回复。",
    });
  } catch (error) {
    checks.push({
      id: "chat",
      label: "普通对话",
      status: "failed",
      detail: error instanceof Error ? error.message : "对话请求失败。",
    });
  }

  if (!chatOk) {
    checks.push({ id: "tools", label: "工具调用", status: "skipped", detail: "对话未成功，未检查。" });
  } else {
    try {
      const completion = await provider.chat({
        tools: [PROBE_TOOL],
        messages: [
          { role: "system", content: "你是测试客户端。只调用工具，不要用文字回答。" },
          { role: "user", content: "请调用 chordnote_probe，marker 填 chordnote。" },
        ],
      });
      const called = completion.toolCalls.some(
        (call) => call.function.name === PROBE_TOOL.function.name,
      );

      checks.push({
        id: "tools",
        label: "工具调用",
        status: called ? "ok" : "failed",
        detail: called
          ? "模型返回了可解析的工具调用。"
          : "模型没有按约定调用工具。这个模型可能不适合 Agent 流程。",
      });
    } catch (error) {
      checks.push({
        id: "tools",
        label: "工具调用",
        status: "failed",
        detail: error instanceof Error ? error.message : "带工具的请求失败。",
      });
    }
  }

  const required = checks.filter((check) => check.id !== "tools");
  const ok = required.every((check) => check.status === "ok");

  return NextResponse.json({ ok, checks });
}
