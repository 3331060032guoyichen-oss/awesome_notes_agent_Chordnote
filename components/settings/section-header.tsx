/**
 * Settings 分区标题：eyebrow + 标题。
 *
 * 2026-10-22 与母项目对齐：上游把分区说明文字改成不渲染（`compact-heading` 里只保留标题），
 * 这里也不再显示 `body`。参数保留，是为了调用点仍能写清"这个分区是做什么的"——
 * 只是不再重复占一行。
 */
export function SectionHeader({ title }: { title: string; body?: string }) {
  return (
    <header className="workspace-heading compact-heading">
      <div>
        <p className="eyebrow">Settings</p>
        <h1>{title}</h1>
      </div>
    </header>
  );
}
