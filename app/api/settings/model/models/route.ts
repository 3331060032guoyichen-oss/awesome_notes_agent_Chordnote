import { NextResponse } from "next/server";
import { readModelSettings, resolveModelSettings, toProviderConfig } from "../../../../../lib/ai/config";
import { createChatProvider } from "../../../../../lib/ai/provider";
import { unreachableDetail } from "../../../../../lib/ai/diagnostics";
export const runtime = "nodejs";

/**
 * 模型发现。
 *
 * 失败文案与「测试连接」共用 `unreachableDetail`：同一件事（连不上端点）
 * 不该在同一个面板上出现两种说法。配置本身读不出来时单独报 500，不伪装成网络问题。
 */
export async function GET() {
  let settings: Awaited<ReturnType<typeof resolveModelSettings>>["settings"];

  try {
    settings = resolveModelSettings(await readModelSettings()).settings;
  } catch {
    return NextResponse.json({ error: { code: "SETTINGS_READ_FAILED", message: "模型配置暂时读不出来，请关掉设置重新打开。" } }, { status: 500 });
  }

  if (settings.agentBackend === "acp") return NextResponse.json({ models: [settings.model], selected: settings.model, discovery: "ACP 模型由会话协商；可在自定义模型中指定 model id。" });

  try {
    return NextResponse.json({ models: await createChatProvider(toProviderConfig(settings)).listModels(), selected: settings.model });
  } catch {
    return NextResponse.json({ error: { code: "MODEL_LIST_FAILED", message: unreachableDetail(settings) } }, { status: 502 });
  }
}
