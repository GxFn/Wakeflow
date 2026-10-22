# Wakeflow 测试开发标准

> 状态：`active`
> 基线提交：`3fcc3246`（`main`；门的组成与耗时取自 run-9xr332，gate-log §13.206）
> 建立日期：2026-10-22
> 上位文档：[docs/README.md](../README.md)、根目录 `CLAUDE.md` / `AGENTS.md` 的 Verification 一节
> 适用对象：在本仓库写测试或改测试的人和 Agent（Claude Code、Codex 都读同一份），以及 `tooling/testing` 的维护者

本标准回答四个问题：测试门里到底有什么；一个测试属于哪一级、放在哪、叫什么；它可以依赖什么、不可以依赖什么；改了什么要补哪一级的测试。它不改变任何一条验证规则——分级验证、门、锁、交接检查仍以 `CLAUDE.md` / `AGENTS.md` 为准，本标准只把"测试本身该怎么写"写下来。运行时行为的权威仍是代码、Schema 与测试（[docs/README.md §1](../README.md#1-权威顺序)）。

## 1. 测试门的组成

`npm test`（第 2 级，完整门）依次运行：`typecheck`、`check:architecture`（六层依赖方向）、`lint` 与 `format:check`（Biome）、`check:unused`（knip）、`test:typescript`（下表全部文件）、`schema:check`（生成合同无漂移）、`build:check`（已提交制品与新构建字节一致）。静态阶段合计约 16 秒，测试阶段是全部时间。`smoke:artifacts`（把制品搬到仓库外启动的五幕冒烟，加上 lab 的 dual-product 与 worktree 四个实验，`tests/tooling/lab/workflow-matrix.manual.ts`）与现场 L 系列核对不在门里，分别由第 1 级与现场计划触发；门里的 lab 矩阵只剩每宿主一个 single-product 实验。

测试阶段按行为分成六级（第 2 节），run-9xr332 的构成（317 个文件、1527 个用例，`wf test levels` 按第 2 节的规则算出）：

| 级 | 文件 | 用例 | 门内耗时之和 | 典型目录 |
| --- | --- | --- | --- | --- |
| 0 纯逻辑 | 85 | 353 | 5 秒 | `foundation/{data,time,crypto,text,numeric,identity,schema,event-sourcing}`、`contracts`、各层的 `decide`/`contract` 测试 |
| 1 组件 | 103 | 509 | 669 秒 | `foundation/filesystem`、`kernel`、`governance/*` 的存储与发布 |
| 2 能力 | 76 | 386 | 2259 秒 | `capabilities/*`、`workspace/*`、`hosts/*`、`configuration` |
| 3 公共工具 | 13 | 98 | 1158 秒 | `entrypoints`（单工具协议）、`scenarios`（两条场景链） |
| 4 维护者工具 | 31 | 127 | 611 秒 | `tooling/*` |
| 5 制品与发布 | 9 | 54 | 19 秒 | `artifacts`、`codegen`、`release` |

1 级与 2 级的分界按第 2 节的定义判断，不按目录机械划分（`wf test levels` 给每个文件的归级依据）；`wf timings apply` 刷新的 `tooling/testing/test-durations.json` 是每个文件的权威耗时。

## 2. 测试级别

级别由测试**依赖什么、穿过哪条边界**决定，目录给出缺省预期；一个文件的级别与所在目录的缺省不同时，在文件头注释里写明原因。

| 级 | 名称 | 定义 | 允许的依赖 | 不允许 | 单文件预算 |
| --- | --- | --- | --- | --- | --- |
| 0 | 纯逻辑（pure） | 只调用纯函数：解析、渲染、判定（`decide`）、摘要、词汇、Schema 形状 | 内存值、固定时钟值、读取仓库内的 Schema/夹具文本 | 写文件系统、子进程、真实时间、网络 | 1 秒 |
| 1 | 组件（component） | 一个模块或存储在**一次性根目录**上的真实读写：原子写、锁、事件流、账本、投影 | `disposableRoot`、`DISPOSABLE_ROOT_OPTIONS`、注入时钟 | 子进程、公共工具、宿主 CLI | 20 秒 |
| 2 | 能力（capability） | 一个能力服务（`execute…Request`）或维护事务在**预备工作区**上的完整效果，含它的阻塞项与恢复 | 预备基线复制、`fake-cli` 替身、隔离 git、`loadSensitive` | 真实宿主会话、网络、读开发者环境 | 90 秒 |
| 3 | 公共工具（public-tool） | 经 MCP 客户端调用公共工具：单工具协议测试在 `entrypoints`，端到端在 `scenarios`（每宿主一条链，25 个场景顺序跑在同一个一次性工作区上） | 组合根、内存 Transport、合成 hook 记录 | 真实 tmux/Claude/Codex 进程 | 单工具 30 秒；链每宿主 10 分钟 |
| 4 | 维护者工具（tooling） | `wf` 子命令、运行器、lab 实验、capture/live/diagnostics 的真实子进程行为 | 真实子进程、已构建制品、墙钟等待（带标签） | 本机账号登录、网络 | 6 分钟 |
| 5 | 制品与发布（artifact） | 已提交制品的字节、依赖闭包、agent-text 诚实预算与现场指引钉子、Schema 代码生成、发布一致性 | 读 `plugins/`、`assets/`、`src/contracts/generated` | 重建制品、改写任何已提交字节 | 30 秒 |

预算是**门内分道负载下**的单文件墙钟，不是硬门槛：超预算的文件进 open-items D9 的清理清单（拆分、改用预备基线、去掉 fsync、改注入时钟），不靠放宽超时掩盖。一个用例的超时只描述它自己的工作量；因并发高而超时的用例加 `loadSensitive` 标签（第 5 节），不加时间。

**分级与验证级别的关系**（`CLAUDE.md` Verification）：第 0 级验证跑变更集沿静态导入与资源边选中的任意级别的文件；第 1 级再加所属切片的 2 级测试、一条宿主链（能力或治理改动）和 5 级制品测试（触及制品时）；第 2 级跑全部。链（3 级）和带标签的 4 级文件由运行器放进自己的"道"（§13.204）。

## 3. 放置与命名

- `tests/` 镜像 `src/` 的六层与切片：`tests/<layer>/<slice>/<module>.test.ts` 测 `src/<layer>/<slice>/<module>.ts`。跨模块的切片效果测试以切片命名（`service.test.ts`、`decide.test.ts`），端到端在 `tests/scenarios/`，制品在 `tests/artifacts/`，工具链在 `tests/tooling/`。
- 夹具 `*.fixture.ts` 放在它的消费者旁边；被三个以上目录共用的进 `tests/support/`。夹具不含 `test()`。
- 一个测试文件只属于一级。混合时拆成两个文件：慢的或负载敏感的部分用 `.load.test.ts` 后缀（例如 `hook-observations.load.test.ts`），这样级别从文件名可见，`--focused` 也能只跑快的那一半。
- 用例名用一句现在时的话说出合同：条件、动作、可观察的结果与错误码，`§13.x` 的出处可以带在末尾。一个文件内只用一种语言（中文或英文）；现有混用的文件不为此改写，新加的用例跟随该文件的多数。
- 文件头的 `/** … */` 注释写这组测试覆盖的切片效果与出处（能力卡、gate-log 节、open-items 项）。新文件必填；现有 232 个没有头注释的文件在被改到时补。

## 4. 夹具与资源纪律

- **一次性根目录。** 所有写盘都在 `tests/support/temp-root.ts` 的 `disposableRoot(t, prefix)` 之下，`t.after` 删除；绝不写仓库目录、`$HOME` 或 `/tmp` 之外的位置。路径比较用 realpath。
- **预备基线。** 2 级测试的工作区用 `tests/support/prepared-workspace.ts` 的 `createPreparedWorkspaceStore`：同一进程里同 key 的初始化链只跑一次，每个用例 `fs.cp` 复制一份隔离副本（权限位复验、基线不得含自身绝对路径）。新的 2 级夹具一律建在它上面，不再逐用例跑 fresh-initialize。
- **耐久性。** 1–3 级测试文件在顶部调用一次 `useDisposableDurability()`（`tests/support/disposable-durability.ts`）：本进程里省略 `durability` 打开的根一律按 `none`（只跳过 `fsync` 系统调用，暂存、原子重命名、权限位、CAS 与错误分类不变），显式 `fsync` 仍生效；直接开根的夹具用 `DISPOSABLE_ROOT_OPTIONS`。测试耐久性本身的文件（`command-shell`、发布存储与发布服务、`operation-scope`）不调用。单个进程里 fsync 只占一成（Codex 链单独跑 319 对 289 秒，§13.205），但门里多个进程同时 fsync 会互相排队，每个都慢一到两倍（两条链同跑 668/662 秒）——一次性工作区去掉 fsync，既省自己的时间，也不再让别人排队。只有 Foundation 的崩溃语义测试显式保持 `fsync`，并在用例名里说出来。生产组合根永远是 `fsync`，测试不得改生产缺省。
- **git。** 运行器给每个测试子进程隔离的 git 环境（无全局/系统配置、`init.defaultBranch=main`、夹具身份）；测试里起 git 用 `tests/support/git-fixture.ts` 的 `runGit`。
- **外部命令。** tmux、claude、codex、ps 等一律用 `tests/support/fake-cli.ts` 写替身放到 `PATH` 前面；子进程 pid 经 `child-process.ts` 读取（空文件不是 pid 0）。门里不启动真实宿主会话，不依赖登录状态。
- **时钟。** 业务时序用注入时钟（`clock: () => parseUtcInstant(...)`）与常量（如 `DELIVERY_LANDING_SILENCE_MILLISECONDS`）推进，不 `setTimeout` 等待业务时间；只有 4 级的真实子进程测试允许墙钟等待，且带标签。
- **数据。** 夹具里的 id、路径、密钥都是明显的假值（`example.invalid`、固定 UUID）；断言不含本机绝对路径；结果里出现的临时根只在失败证据里出现。

## 5. 负载敏感与道

- 真实子进程、墙钟等待、外部 CLI、上万条目的真实目录树，或曾在 8 worker 下超时的用例，在用例开头调用 `loadSensitive(t, reason)`（`tests/support/load-sensitive.ts`），返回 `true` 时直接 `return`。原因写清楚是什么负载。
- 运行器按静态导入闭包找到带标签的文件（夹具带标签则经它的测试文件也算），把它们放进 2 worker 的隔离道，与两条场景链同时开始；其余文件等隔离道结束后再开始（§13.204）。标签不改变断言，`WAKEFLOW_TEST_SKIP_LOAD_SENSITIVE=1` 只给开发机，门与 CI 从不设置。
- 把标签当成"这段测试占机器"的声明，而不是"这段测试不稳定"的借口：偶发失败先用 `wf test flaky` 复现，再修根因。

## 6. 门里的禁止项

- `skip`、`todo`、`only`、重试洗绿：记录器把任何 skip/todo/取消都判为非绿（`inspectTestRecording`），`only` 会让其它用例静默消失。
- 依赖用例顺序或共享可变状态：每个文件一个进程，文件内用例应能单独 `--test-name-pattern` 运行；场景链是唯一的例外，它在文件头声明"前序场景即前提"。
- 读开发者环境：`HOME`、全局 git 配置、本机 tmux 服务器、已登录账号。需要环境时自己造。
- 网络与真实宿主：门不访问网络，不启动 Claude Code / Codex 会话；这类核对走现场 L 系列并在 gate-log 登记。
- 把断言写进夹具：夹具只准备与清理，断言留在用例里，否则失败点名的是夹具而不是合同。

## 7. 运行方式

| 场景 | 命令 |
| --- | --- |
| 改完一处 | `npm run wf -- verify quick --changed`（静态检查 + 变更集选中的测试，含资源边） |
| 看该跑哪一级 | `npm run wf -- impact report` |
| 跑一个目录或文件 | `npm run test:typescript:focused -- tests/kernel tests/capabilities/tasking/decide.test.ts` |
| 跑一条宿主链 | `npm run test:typescript:focused -- tests/scenarios/wakeflow-scenario-acceptance-codex.test.ts` |
| 完整门 | `npm run locked -- npm test`（或 `npm run wf -- verify gate`，回执在 `.build/verification/run-*/`） |
| 偶发失败分诊 | `npm run wf -- test flaky --files <file> --runs 5` |
| 刷新耗时表 | 第 2 级绿门后 `npm run wf -- timings apply --receipt <receipt.json>` |

门在跑时不要再起编译、扫描或测试；并发缺省一 CPU 一 worker，运行器自己分道。

## 8. 改了什么要补什么

| 改动 | 必补的测试 | 一般还要 |
| --- | --- | --- |
| 公共工具的请求/结果 Schema | 0 级 Schema 形状；`tests/entrypoints` 的目录预算（102 KiB）与自包含检查；相关场景链断言 | `schema:build`、能力卡/工具描述 |
| 能力服务的效果或阻塞项 | 该切片的 2 级 `service`/`decide` 测试（正反两面、幂等重放、恢复） | 控制器技能文本、场景链 |
| 内核/治理的存储格式 | 1 级读写与崩溃语义；旧记录的读回（兼容或明确拒绝） | 管理文本历史登记（若是托管正文） |
| 宿主适配（tmux 助手、设置、状态行） | `tests/hosts/<host>` 的 2 级测试用替身覆盖每条拒绝码；助手资产的 ASCII/可打印检查 | 现场核对一次 |
| agent-text（技能、命令、README） | `tests/artifacts` 的诚实预算与现场指引钉子（资源边会自动选中） | 重建制品、`smoke:artifacts` |
| 运行器、记录器、影响选择 | `tests/tooling/testing` 的纯函数与真实进程回归 | 第 2 级完整门 |
| 新增一个测试文件 | 文件头注释、级别、所在道；第 2 级绿门后刷新耗时表（`wf handoff` 检查覆盖） | — |

## 9. 维护

本标准随 `tooling/testing` 的能力变化修订；每次修订在 gate-log 留一节，并保持 `CLAUDE.md` 与 `AGENTS.md` 的 Verification 指向它（`wf handoff` 的 `instructions-parity` 要求两份一致）。清理与优化的进度记在 open-items D9。
