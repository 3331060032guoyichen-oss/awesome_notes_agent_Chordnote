/**
 * 面向用户的模型连接诊断文案。
 *
 * Provider 层只会回一句英文（`Model provider is unreachable.`），用户看不出是
 * Ollama 没启动、端口写错，还是网络问题。凡是"连不上"的场景都从这里取文案，
 * 避免「测试连接」和「获取模型」对同一件事有两种说法。
 */
export function unreachableDetail(settings: { provider: string; baseUrl: string }): string {
  const endpoint = settings.baseUrl?.trim() || "（地址为空）";

  if (settings.provider === "ollama") {
    return `连不上本地推理端点 ${endpoint}。请先启动 Ollama，并确认它的端口与这里一致（默认 11434）。`;
  }

  if (settings.provider === "custom") {
    return `连不上 ${endpoint}。请检查地址是否完整（兼容接口通常以 /v1 结尾）以及是否需要 API Key。`;
  }

  return `连不上 ${endpoint}。请检查网络连接或该服务的状态后重试。`;
}
