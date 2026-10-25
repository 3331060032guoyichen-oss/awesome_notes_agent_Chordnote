# 四个 LLM Wiki 实现的 Agent 工作流对比

> 日期：2026-10-22　范围：`iwtown/dsh-llm-wiki`、`guanyang/llm-wiki`、`nvk/llm-wiki` 三个参考实现，与本仓库（Chordnote / ai-notes）的 Agent 链路。
> 本文只写能取证的部分；取证不到的一律标注「未找到」。

## 0. 取证边界

- 本机 `github.com` 与 `raw.githubusercontent.com` 的 DNS 不可达，三份材料经 `api.github.com`、`cdn.jsdelivr.net`、`gh-proxy.com` 镜像取得。镜像不返回行号，因此三个参考实现用「文件 + 小节 / 函数名」定位，**没有编造行号**。
- 本仓库的证据全部来自工作区源码，行号可复核。
- 正在运行的 dev server（`127.0.0.1:3210`）来自 `awesome_notes_agent_Chordnote-0.2.1`，比本工作区（`-main`）旧：例如它仍把新 Raw 写进 `raw/inbox/`，`-main` 已不再使用 inbox。UI 测试结论按运行中的 0.2.1 记录，**受影响组件在 -main 里是同一份代码**。

## 1. 形态一览

| | iwtown/dsh-llm-wiki | guanyang/llm-wiki | nvk/llm-wiki | 本项目 |
|---|---|---|---|---|
| 形态 | DSH 插件 + 2 个 SKILL + 零依赖管线 | Obsidian Vault 模板 + 一个 Agent Skill | Claude Code / Codex 插件（命令 + skill + CLI） | Next.js 应用，内置 Agent |
| 多轮循环由谁跑 | DSH 宿主 | 宿主（Claude Code 等） | 宿主 | dsh（`@deepseek-ai/dsh-sdk-client`，宿主侧只提供工具与权限） |
| 工具面 | grep / read / write / edit / shell / 记忆召回 | 宿主全套 Read/Write/Edit/Grep + python 脚本 | 按命令白名单（query 只有 Read/Glob/Grep） | 15 个受控工具，blocked 的不下发 |
| 权限模型 | 无（模型可写 vault 任意路径） | 无（"不写 raw"只在提示词里） | 命令级 `allowed-tools` | **三档：只读 / 可提议 / 完全允许，宿主强制** |
| 持久化 | Markdown vault + 记忆体 | Markdown vault | Markdown vault | PGlite + Markdown 双向映射 |
| 索引 | `index.md` 代码重建 | `index.md` 模型手写 | `_index.md` 派生缓存，读时校验 | **无实体索引文件**，动态目录快照注入 |
| 日志 | `log.md` 代码追加 | `log.md` 模型手写 | `log.md` 追加 | `audit_log`（只取最近 5 条进上下文） |

## 2. 逐项对比

### 2.1 谁负责「多轮」这件事

- **iwtown**：仓库里**没有 loop**。`plugin/dsh-llm-wiki.mjs` 只做两件注入（`llm-wiki:preview` order 138 注入 `wiki/index.md`，`llm-wiki:rules` order 139 注入 vault 根 `schema.md`，60s 文件缓存），再在 `session/disposed` 事件里 `spawn` 确定性管线（`--all`，detached + unref，60s 冷却 + running 防重入）。摄入时的多轮工具调用完全由 DSH 宿主驱动。
- **guanyang**：一个 Skill（`skills/llm-wiki/SKILL.md` + 7 份 reference + 3 个 Python 脚本），10 步流程写在提示词里，轮次不设上限，只规定 4 项完成校验。
- **nvk**：命令（`/wiki:ingest`、`/wiki:compile`、`/wiki:lint`、`/wiki:query`）+ 一个 243KB 的确定性 CLI。命令 = 一个 agent 回合 + 多次工具调用，顺序写在 markdown 里；ingest 与 compile 是**两个独立命令**（未编译源 ≥5 才建议 compile）。
- **本项目**：`lib/agent/loop.ts` 负责"模型提议 → 宿主执行 → 结果回传"，但对模型的多轮调度交给 dsh（`runtime.ts` 起 `DeepSeekHarness`）。宿主侧硬上限：单次运行 **64 次工具调用**（`runtime.ts:63`），单条工具结果 **8000 字节**（`context.ts:6`）。

> 结论：四家都把「循环」外包给宿主，差别在**宿主之外那层能看见什么**。参考实现把流程写死在 markdown 步骤里；我们把流程写进 Schema.md，但只有一小部分被代码消费（见 2.6）。

### 2.2 工具与写入门禁

- **iwtown**：工具是宿主原生 grep/read/write/edit/shell。SKILL 要求"写入流程必须按序"：查重 → 定分类 → 写 `wiki/<分类>/<标题>.md` → 正文 ≥2 条 wikilink → 汇报。**没有代码门禁**，模型可写 vault 任意路径（含 raw/）。lint 里 `wikilink < 2` 只 `console.log`，不阻断。
- **guanyang**：工具全部继承宿主，连"建链接"都没有工具，手写 `[[...]]` 事后由脚本校验。危险操作要求先 `--dry-run`。
- **nvk**：按命令收窄 `allowed-tools`：query 只有 `Read, Glob, Grep`，lint 只有 `Write/Edit + Bash(mv/mkdir/date/wc/ls)`。这是三者里唯一"运行时白名单"的做法，但**只到工具类别，不到数据行**。
- **本项目**：`manual.ts` 是唯一真相——15 个工具分 `auto` / `proposal` / `blocked` 三档，`blocked` 的工具**根本不进 `tools` 数组**（`manual.ts:248-259`），循环里再拦一次（`loop.ts:238`）。写入一律落提议，`full` 模式下由宿主 `approve + apply` 并保留版本检查（`loop.ts:211-225`）。

> 结论：**权限层是我们独有的强项**，三个参考实现都没有"提议状态机 + 版本校验 + 审计"。

### 2.3 一个来源到底产出几张页

这是四家差异最大、也最容易被误读的一点。

| | 摄入阶段 | 最终页数 |
|---|---|---|
| iwtown | 1 个来源 → 1 页（`skills/wiki-write/SKILL.md`：已有相同/相似页则**更新**，不新建） | 1 页（`docsSync` 另有"一个文档 1 页"的自动通道，分类靠正则） |
| guanyang | 1 个来源 → **1 张 summary** + N 个实体/概念页 | "A single ingest may update 10–15 pages — this is normal"；Concept 页有晋升门槛（被 2+ 素材提及） |
| nvk | ingest 阶段只写 **1 个 raw 文件、0 个 wiki 页** | 由 `compile` 决定：已存在→UPDATE、Major concept→CREATE、Minor mention→融进别的文章；日志样例 `compile | 2 sources → 3 new articles, 1 updated` |
| 本项目 | 1 条 Raw → `draft_knowledge` → **1 张知识页** | **恒为 1 张**（`notes.raw_id` notNull + `promoteFromSource` 按 rawId 幂等，`notes.ts:185-250`） |

**我们的 1:1 不是模型偷懒，是数据模型不允许拆分。** `notes.raw_id` 是 NOT NULL（`lib/db/schema.ts:77`），提升服务按 rawId 幂等（重复调用返回 `created: false`）。模型能做的只有"把整篇塞进一张 concept 页"或"什么都不做"——这正是用户感觉到的「全整理在一起」。

次生问题：所有页都往 `concept` 跑。`wikiCategory` 只是枚举，没有分类分布检查；旧库的来源全在 `articles`。

### 2.4 索引、日志、体检

| | index | log | lint |
|---|---|---|---|
| iwtown | `rebuildIndex()` 代码生成（分类计数 + 最近 10 条），写 `wiki/index.md` | `appendLog()` 前插一行；pattern 编译另写 `logs.md` | 纯代码 `lint(pages)`：frontmatter / wikilink<2 / 孤立页（7 天宽限）/ stale>90d，**只打印不落盘** |
| guanyang | `index.md` 模型手写 | 模型手写，只留 30 天，`log-archive.py` 归档 | 3 个脚本算结构（孤儿/断链/frontmatter/单向链）+ 模型判语义；**lint 会改正文** |
| nvk | `_index.md` 是**派生缓存**，读时 stale-check，`lint --fix` 可重建 | append-only，agent 每个命令末尾写 | C1–C19 固定顺序，`--fix` 逐条白名单，"Never auto-delete" |
| 本项目 | 无 index 文件：`GET /api/knowledge` + `/api/graph` 动态提供，另把 4KB 目录快照塞进系统提示词 | 无 log 文件：`audit_log`，只取最近 5 条 | **没有**：Schema 写"用户说检查一下 wiki 时执行"，但没有入口、没有确定性检查 |

**这里有一处口径冲突，值得单独记一笔。** `AGENTS.md §12` 说 index 由接口动态提供、log 对应 `audit_log`；但 `lib/agent/Schema.md`（204–212 行）仍在描述 `Wiki/index/`、`## index 与 log` 的文件式流程。模型同时读到"要维护 index/log"和"不要建 index/log"，结果只能各自发挥。

### 2.5 摄入链路：先检索还是先写

- **nvk**：`compile` 的 Step 3 强制先判断"已存在 → UPDATE"，页边界受 `concept = 一个可解释的 bounded idea` 约束；`schema.md` 里有 `## Compile Guidance`（cardinality / keep-separate）。
- **guanyang**：10 步里第 2 步抽实体、第 3 步与用户确认重点，第 7 步才有置信度与晋升判断；**ingest 没有要求先读 `index.md`**（只有 query/publish 强制），去重靠模型自觉。
- **iwtown**：查重是第一步，且"不确定 → 先问用户，不猜分类"。
- **本项目**：`AGENT_INSTRUCTION` 写了"整理先调用 `manual_load`，搜索并通读相关知识"（`manual.ts:273`），但**代码不校验**：`full` 模式下 `draft_knowledge` 只要求读过这条 Raw（`loop.ts:277`），`propose` 模式什么都不要求。

### 2.6 哪些规则真的被代码消费

把 `Schema.md` 的要求逐条对照 `loop.ts` / `tasks.ts`：

| Schema 要求 | 是否强制 |
|---|---|
| `rawCategory` / `wikiCategory` 必填且合法 | ✅ `parseOrganizeDraft`（`tasks.ts:38-58`） |
| 标题、摘要、正文非空 | ✅ 同上 + `promoteFromSource` |
| 草稿正文以 `#` 开头、不重复写 YAML | ❌ 无检查 |
| 交叉引用尽量双向 | ❌ 无检查 |
| 至少 2 条 wikilink | ❌ 无检查（Schema 自己也没写这条） |
| 先检索再整理 | ❌ `propose` 模式不检查 |
| 矛盾并列保留 | ❌ 无结构 |
| ingest 的 6 个步骤 | ❌ 无阶段机 |
| index / log 格式 | ❌ 数据库无对应字段 |

对照参考实现：nvk 把可判定项（frontmatter、断链、孤立、覆盖率、新鲜度）全部沉到 CLI，模型只做"写哪几页、怎么合成"；guanyang 也是"脚本算结构、模型判语义"。**我们的可判定项一条都没沉到代码**。

## 3. 本项目的实际链路（可复核）

```
POST /api/agent/organize
  → runOrganizeAgent(loop.ts:573)
      loadContext：服务端按 contextType+contextId 重读材料（不信前端）
      agentContext：listNotes + listSources → 目录快照(4KB) + 关键词命中 5 条
      readAgentSchema → Schema.md
      ｜ 系统提示词 = AGENT_INSTRUCTION
      ｜            + 本轮权限一句话
      ｜            + Schema.md(12KB 截断) + 用户偏好(5KB)
      ｜            + 最近 5 条审计(2KB) + 目录索引(4KB) + 命中片段(6KB)
      ｜            + 当前材料(8KB 截断)
  → runHarness(runtime.ts) 起 DeepSeekHarness
      dsh-policy.mjs 把上面整段注册为 systemPrompt section(order 10)
      把 15 个工具注册成桥，execute 反打回宿主 /tool
      宿主侧：64 次调用上限、8KB 单条结果、blocked 直接 403
  → 模型每调一次工具：宿主执行 → 返回文本 → 继续
  → full 模式：宿主自动 approve+apply，仍是同一套服务层与版本检查
```

两个容易忽略的细节：

1. **材料被塞进系统提示词**，用户那句话才是 user message。这意味着"当前材料"和"规则"在模型眼里同一优先级，长材料还会被 8KB 截断。
2. **`read_note` 只回 4000 字符**（`loop.ts:38`），`search_notes` 只回 8 条（`:35`）。"通读相关知识"在长文档场景下其实读不完。

## 4. 差距清单（按严重度）

1. **一源一页**（结构性）：`notes.raw_id` NOT NULL + 幂等提升，source/entity/concept/synthesis 分层没有落点。参考实现里"一次摄入 10–15 页"在我们这里不可能发生。
2. **Schema 承诺 ≠ 代码事实**：index/log 两套说法并存（`AGENTS.md §12` vs `Schema.md` 154–174），模型收到互相矛盾的指令。
3. **流程只有提示词**：ingest 六步没有阶段机，跳步不会被发现；"先检索"在可提议模式下完全不校验。
4. **上下文装不下"通读"**：单条工具结果 8KB、`read_note` 4KB、目录 4KB，长资料实际只能读到片段。
5. **没有体检入口**：Schema 描述的确定性检查（孤立页、断链、近似重复、来源过期）一条都没实现，也没有 `/api/lint`。
6. **索引是目录不是知识**：注入的是"标题 + 路径 + 状态"清单，不是参考实现那种带摘要的 `index.md`，模型仍需自己 grep。

## 5. 可落地的改动（按性价比排序）

1. ✅ **统一口径（半天）**：把 `Schema.md` 里 index/log 的"文件式"描述改成"动态索引 + 审计日志"，与 `AGENTS.md §12` 一致。**已做**：目录树删掉 `Wiki/index/`、`Wiki/overview/`，页面类型表里 meta 改为"不落文件"，并写明"不要尝试创建这两个目录"。
2. **把"先检索"变成可检查的弱约束（1 天）**：`draft_knowledge` 在 `propose` 模式下也要求先调过 `search_notes`，否则返回"请先检索已有知识页，或明确说明库中没有相关页"。**未做**（会改变 Agent 行为，需要能跑测试再动）。
3. ✅ **给 `read_note` 加分页（1 天）**：参数加 `offset`，结果返回 `offset / total / truncated / nextOffset`，让模型能接着读，而不是拿 4KB 当全文。**已做**。
4. **加 `/api/lint`（2–3 天）**：孤立页、断链、未链接提及、来源过期。输出报告，不自动修。**未做**。
5. **评估放宽 1:1（需要决策）**：要么 `notes.raw_id` 可空 + `note_sources` 关联表，要么引入 `page_type` 并允许一次摄入产多页。**未做，等你拍板**——这会动数据模型和归属校验。

## 6. 一句话总结

三个参考实现的共同点是**把可判定的东西交给代码、把需要判断的交给模型**；我们的优势是**把"谁能写、写到什么程度"做成了运行时权限**，劣势是把"整理成什么样"几乎全押在提示词上，而数据模型又只允许一页——三者叠加，就是"一篇文章被压成一张 concept 页"的观感。

---

## 附录 A：证据索引

**本项目**
- 工具与权限：`lib/agent/manual.ts:94-207`（清单）、`:235-240`（过滤）、`:248-259`（blocked 不下发）、`:268-277`（系统提示词）
- 循环与权限执行：`lib/agent/loop.ts:211-225`（full 自动应用）、`:238`（越权拦截）、`:268-288`（draft_knowledge）、`:573-665`（runOrganizeAgent）
- 预算：`lib/agent/context.ts:6-11`；`lib/agent/runtime.ts:63`（64 次上限）
- 提示词注入：`lib/agent/dsh-policy.mjs:43-44`
- 上下文：`lib/services/agent-context.ts:11-37`
- 一源一页：`lib/db/schema.ts:77`、`lib/services/notes.ts:185-250`
- 草稿校验：`lib/ai/tasks.ts:38-58`

**iwtown/dsh-llm-wiki**：`plugin/dsh-llm-wiki.mjs`（systemPrompt 两段注入 + session/disposed 触发管线）、`skills/wiki-write/SKILL.md`（写入流程）、`skills/wiki-search/SKILL.md`（查询流程）、管线 `rebuildIndex/appendLog/lint/docsSync`。

**guanyang/llm-wiki**：`skills/llm-wiki/SKILL.md`、`references/ingestion.md`、`references/wiki-page-spec.md`（one file per digested material）、`references/query-lite.md`、`scripts/lint-check.py`、`lifecycle-check.py`、`log-archive.py`。

**nvk/llm-wiki**：`claude-plugin/commands/{ingest,compile,lint,query}.md`、`claude-plugin/skills/wiki-manager/SKILL.md`、`references/compilation.md`、`wiki-structure.md`、`scripts/llm-wiki`（`run_lint` 固定顺序、`regenerate_directory_index`、`check_canonical_placement`）。

## 附录 B：设置与归档的实测记录（2026-10-22）

环境：运行中的 dev server `127.0.0.1:3210`（来自 `-0.2.1`），库为空。

### B1. 本地模型（Ollama）链路

- 本机 **11434 没有任何进程监听**，`GET http://127.0.0.1:11434/api/tags` 连接失败。
- 按 UI 的顺序走了一遍（先保存再测）：`PATCH /api/settings/model`（provider=ollama、`http://127.0.0.1:11434/v1`、qwen3:4b、120s）→ 200。
- `POST /api/settings/model/test` → `{"ok":false}`，四项检查：服务可访问 **failed**（detail 是英文 `Model provider is unreachable.`）、其余三项 skipped。
- `GET /api/settings/model/models` → 502 `{"error":{"message":"获取模型失败，请检查端点与凭据。"}}`。
- 测完已把配置恢复成原来的 DeepSeek（该目录原本没有 `data/settings.json`，现在有了一个，内容就是恢复后的 DeepSeek 配置）。

**问题**

1. **测试连接会先保存**：`run("test")` 第一行就是 `await save()`（`model-panel.tsx:74-77`）。测试失败后，应用已经指向一个连不上的端点，下次 Agent 调用直接失败。建议测试只用表单值、不改已保存配置。
2. **错误信息中英混杂**：面板显示 `服务可访问：failed Model provider is unreachable.`，后半句是 Provider 层英文原文，前半句是中文状态。用户看不出"是不是 Ollama 没启动"。
3. **没有"本地未运行"的引导**：11434 连不上时，最该提示的是"请先启动 Ollama / 或把端点改成实际端口"，现在只给一句泛泛的失败。
4. **"获取模型"和"测试连接"对本地模型是两套错误文案**（一个 502 中文、一个 200 + 英文 detail），同一件事两种说法。

> 第 1、2 条已在 `-main` 修掉，见 B4；第 3、4 条保留（属于文案打磨，改动更小，可以随时做）。

### B2. 归档

接口层面**功能是通的**（用一条临时 Raw 跑完整链路后已彻底清掉）：

```
POST /api/raw（建）→ 201
DELETE /api/raw（归档）→ 200 {archived:true}
GET /api/archive → 200 {items:[{kind:"raw", dependencies:{revisions:0,relations:0,proposals:0}}]}
PATCH /api/archive（恢复）→ 200 {restored:true}
DELETE /api/raw（再归档）→ 200
DELETE /api/archive（永久清除，带 reason + confirmDependencies）→ 200 {purged:true}
```

**问题出在 UI 结构与样式对不上**，这正是"灰色大方框太突兀"的根因：

1. **`.archive-row` 是两列网格，组件却塞了三个子元素**（`globals.css:6277-6286` 为 `minmax(0,1fr) auto`；`archive-panel.tsx:17` 是 `<div>` + 两个 `<button>`）。第三个按钮被挤到第二行第 1 列，于是拉成一条**整行宽的灰条**——就是截图里那个"永久删除"。
2. **`.archive-row-copy` 整套样式没人用**：组件用的是裸 `<div>`，标题、路径、字号全部退回浏览器默认（所以标题才那么大）。
3. **恢复/永久删除都没有类名**：`button-secondary`、`is-danger` 都没加，拿的是 UA 默认按钮样式，和设置里其它面板（模型面板的 `.model-actions`）完全不是一套视觉。
4. **`.purge-confirm` 在 globals.css 里根本不存在**（全文件搜不到 `purge`）：点"永久删除"后弹出的确认表单是裸表单。
5. **归档没有走其它设置面板的框架**：别的分区是 `SectionHeader` + `content-section settings-panel-body`，归档是裸 `<section class="archive-panel">` + 自己的 `<h1>`，所以标题样式、内边距、卡片边框都缺失。

**建议的修法**（改动小、不动业务逻辑）：把行结构改成 `archive-row-copy` + `archive-row-actions`，恢复用 `.button-secondary`、永久删除用低强调的危险文字按钮；列表外面补 `.archive-list`；确认表单补 `.purge-confirm` 样式；面板头部复用 `SectionHeader`，与其它分区对齐。

### B3. 已落地的归档修复（本工作区 `-main`）

| 文件 | 改动 |
|---|---|
| `components/settings/section-header.tsx` | 新建：把 `SectionHeader` 从 `settings-space.tsx` 抽成共享组件 |
| `components/settings/settings-space.tsx` | 改为从新文件导入，删掉本地副本 |
| `components/settings/archive-panel.tsx` | 行结构改为 `archive-row-copy` + `archive-row-actions`；恢复按钮用 `.button-secondary`，永久删除改成低强调的 `.archive-danger` 文字按钮；列表包进 `.archive-list`；空态用 `.settings-empty`；确认表单加 `.purge-confirm` 结构（原因输入框 + 勾选 + 危险按钮）；状态行改用 `.settings-note` |
| `app/globals.css` | 新增 `.archive-panel` / `.archive-row-actions` / `.archive-danger` / `.purge-confirm` / `.purge-consent` / `.purge-actions` / `.button-danger`，移动端断点改为 `.archive-row-actions { justify-self: start }` |

效果：一行 = 标题 + 路径 + 依赖摘要（左），恢复/永久删除（右，均为 32px 小按钮）；「永久删除」不再横贯整行，只在点击后才在下方展开确认卡片。

> 注意：这次改的是 `-main`，正在运行的 `-0.2.1` 没有变。要立刻看到效果，需要把上面 4 个文件同步过去（或直接在 `-0.2.1` 里 `pnpm dev`）；`-main` 当前没有 `node_modules`，无法本地起服务验证。

### B4. 已落地的本地模型修复（本工作区 `-main`）

**1. 测试连接不再偷偷保存**（`components/settings/model-panel.tsx`）

- 新增 `saved` 快照：加载成功后、每次保存成功后都记录一份「当前已保存的配置」。
- `isDirty()` 判断表单是否有未保存的改动（改过地址/模型/超时/来源类型，或填了新 Key 都算）。
- 「获取模型」「测试连接」在表单有改动时**直接提示"先保存再执行"，不发请求、不改配置**。这样测的一定是服务端真正在用的那份配置。
- 「保存」单独走一条分支，不再被"测试"顺带触发；保存成功后状态显示"已保存"。

理由：`POST /api/settings/model/test` 只读已保存配置（`test/route.ts` 注释写明"不接受请求里带来的地址或密钥"，防 SSRF），所以旧行为只能是"先保存再测"——但用户看到的是"我只是测一下，怎么配置变了"。现在把这个隐含动作显式化。

**2. 连不上的提示改成可执行的下一步**（`app/api/settings/model/test/route.ts`）

新增 `unreachableDetail(settings)`，按 provider 分支：

- `ollama` → 「连不上本地推理端点 `http://127.0.0.1:11434/v1`。请先启动 Ollama，并确认它的端口与这里一致（默认 11434）。」
- `custom` → 「连不上 …。请检查地址是否完整（兼容接口通常以 /v1 结尾）以及是否需要 API Key。」
- 其它 → 「连不上 …。请检查网络连接或该服务的状态后重试。」

不再把 Provider 层的 `Model provider is unreachable.` 原样透给界面。

**验证方式**（`-main` 没有 node_modules，用 `-0.2.1` 的依赖做类型检查）：

- 写了一个临时 `tsconfig.check.json`，把 `react` / `react-dom` 指向 `@types`，其余包回落到 `../awesome_notes_agent_Chordnote-0.2.1/node_modules`，`files` 只列改过的 5 个文件。
- `tsc -p tsconfig.check.json --noEmit` → **exit 0**（0 error）。
- `globals.css` 花括号配平 1523/1523，新增选择器各出现预期次数。
- 没有做视觉验证：`-main` 起不了服务，`-0.2.1` 是旧代码且不在本工作区内。

> 附带产物：`tsconfig.check.json` 留在工作区根目录（沙箱不允许删除）。它只用于"借用相邻目录依赖做类型检查"，不影响构建；不需要的话 `git rm` 或手动删掉即可。

### B5. 第二轮追加改动（`-main`）

| 文件 | 改动 | 为什么 |
|---|---|---|
| `lib/ai/diagnostics.ts` | 新建：`unreachableDetail(settings)` 按 provider 给中文可执行提示 | 让「测试连接」和「获取模型」共用一套说法 |
| `app/api/settings/model/models/route.ts` | 配置读不出来 → 500；连不上 → 502 且用 `unreachableDetail`；补 `code` 字段 | 原来所有异常都压成「获取模型失败，请检查端点与凭据」，配置读失败也会被说成网络问题 |
| `app/api/settings/model/test/route.ts` | 改用共享的 `unreachableDetail` | 去掉本地副本 |
| `lib/agent/manual.ts` | `read_note` 增加可选 `offset` 参数，描述里写明 4000 字符上限与续读方式 | 让"通读"真的可持续 |
| `lib/agent/loop.ts` | `read_note` 按 `offset` 切片，返回 `offset / total / truncated / nextOffset`；步骤文案写清"第 X–Y 字符，还没读完" | 之前 4000 字符之后的内容模型根本拿不到，却不知道被截断 |
| `lib/agent/Schema.md` | 目录树删掉 `Wiki/index/`、`Wiki/overview/`；页面类型表 meta 改为"不落文件"；补一句"不要尝试创建这两个目录" | 与 `AGENTS.md §12` 对齐，消除"要维护 index"和"不要建 index"并存的矛盾 |
| `components/settings/model-panel.tsx` | 本地模型与 ACP 下不再显示「清除密钥」 | 那里根本没有密钥可清，按钮只会误导 |

`read_note` 的返回是**新增字段**（`offset/total/truncated/nextOffset`），旧字段不变，属于向后兼容改动；`manual.ts` 里 `blocked` 的两个工具仍然不提供给模型。

验证：`tsc -p tsconfig.check.json --noEmit` 覆盖上述 9 个文件 → exit 0。仍未做视觉验证与运行时验证（`-main` 无依赖，`-0.2.1` 不在工作区内且是旧代码）。

### B6. 同步到运行实例（`-0.2.1`，127.0.0.1:3210）

因为 `-main` 起不了服务，界面修复在 `-main` 里等于看不见。2026-10-22 把下面 6 个文件同步进正在运行的 `-0.2.1`，并在 `app/globals.css` 末尾追加了归档样式（**追加**而非替换，旧规则仍在，靠后出现的同优先级规则覆盖）：

| 文件 | 说明 |
|---|---|
| `lib/ai/diagnostics.ts` | 新增 |
| `app/api/settings/model/test/route.ts` | 连带 `unreachableDetail` |
| `app/api/settings/model/models/route.ts` | 同上 |
| `components/settings/section-header.tsx` | 新增 |
| `components/settings/archive-panel.tsx` | 新结构 |
| `components/settings/model-panel.tsx` | 表单脏检查 + 隐藏无意义按钮 |

被覆盖的原文件都留了 `*.dsh-backup`（同目录）。没有同步 `settings-space.tsx`（那份旧代码没有 LaTeX 偏好，直接覆盖会引用不存在的模块），也没有同步 `loop.ts` / `manual.ts` / `Schema.md`（旧数据模型与本次改动无关）。

**验证**

- `tsc -p tsconfig.json --noEmit --incremental false`（在 `-0.2.1` 里跑整个项目）→ **exit 0**
- `GET /` → 200；`GET /api/archive` → 200；`GET /api/settings/model` → 200
- 实测新文案（把配置临时切到本地再恢复）：
  - `POST /api/settings/model/test` → `{"ok":false, checks[0].detail: "连不上本地推理端点 http://127.0.0.1:11434/v1。请先启动 Ollama，并确认它的端口与这里一致（默认 11434）。"}`
  - `GET /api/settings/model/models` → 502 `{"error":{"code":"MODEL_LIST_FAILED","message":"连不上本地推理端点 …"}}`
- **仍然没有视觉验证**：没有浏览器可以截图，归档行样式只能靠"结构对得上两列网格"来保证。归档当前是空库，要看到新卡片需要先归档一条内容。
