# ADR-0021 发布模型与平台范围

> 状态：`accepted`
> 提出日期：2026-10-18
> 裁决日期：2026-10-18
> 基线提交：`6fc7d70a`
> 相关：ADR-0018（当前基线）、ADR-0020（威胁模型）、技术债务复审 §9 的 Q1/Q2/Q11、登记 B11/C1/E1、gate-log §13.179

## 背景

- 版本号从 `1.0.0` 起一直在 `main` 上原地推进：`1.1.0-rc.1` 到 `1.1.0-rc.5` 没有一个打过 tag，同一个版本号对应过多份不同的制品字节（登记 C1）。安装缓存按版本号键控，宿主看到的"同版本"可能是不同的构建。
- `release:check` 是提交后的严格门（要求 `main`、干净树、`v<version>` tag 指向 HEAD、`origin/main` 同一提交、Node 24），从未真正跑过一次（批次 4 余项）。
- 平台范围从未对用户声明：两份 README 写的是"macOS 与 Linux"，`package.json` 没有 `os` 字段，需求总览却声称已经声明（登记 B11）。运行时的锁与 hook 协议依赖 POSIX 的 pid、link 与权限语义，只在 macOS 上被完整验证过。
- Codex 版的原生项目创建入口从未在真实 Codex 会话里跑通（登记 E1），README 与 marketplace 对此没有任何说明。

## 问题

发布与范围三件事没有规则：用什么版本号、什么时候必须换号、支持什么平台与宿主。不定下来，缓存与现场测试就无法指向一个确定的构建。

## 决定

1. **正式版本号。** 停用 `rc.N`。当前候选以 `1.1.0` 作为第一个正式版本；之后按测试需要推进小版本（patch），功能面扩大时推进 minor。
2. **一版本一字节。** 一旦 `v<version>` tag 存在，`plugins/` 的任何字节变化都必须先 bump `assets/release/version.json`。`wf handoff` 以 `version-bytes` 检查强制：本地存在当前版本的 tag 时，比较两份 `artifact-manifest.json` 的文件摘要与 tag 上的记录，不同即失败；tag 不存在时只记录"未比较"。
3. **tag 打在 bump 提交上，`release:check` 在 tag 之后真跑一次。** bump、重建、提交、推送、tag、`release:check`、缓存刷新仍是各自独立的动作，每一步都要用户明确授权（CLAUDE.md）。远端 CI 不做发布动作（ci-workflow 测试禁止 `release:check` 进入工作流）。
4. **只支持 macOS 的本地文件系统。** Linux 与 Windows 不支持：两个制品的 `package.json` 声明 `os: ["darwin"]`，两份插件 README、仓库 README、插件描述与需求总览写明；运行时不加平台硬拒绝（Ubuntu 的 CI 门仍要跑同一套测试），B11 要求的非本地文件系统预检不在本决定内。
5. **Codex 版标为 preview。** 插件描述、仓库 README 的宿主表与 Codex 的宿主信任步骤开头都写明"原生项目创建入口尚未在真实 Codex 会话里跑通"，直到现场跑通一次再摘掉。

## 后果

- 代码：`tooling/artifacts/plugin-metadata.ts`（描述与 `os`）、`tooling/handoff/handoff.ts`（`version-bytes`）、`src/hosts/codex/codex-agent-text-profile.ts`（信任步骤开头）。
- 文本：`assets/agent-text/README.md`、`README.zh-CN.md`、仓库 README、`.claude-plugin/marketplace.json` 的描述、`docs/requirements/README.md` §4。
- 登记：C1 由规则 2 关闭的前提是 `v1.1.0` 打上；B11 的声明部分关闭、预检部分保留；E1 的标注部分关闭；Q1/Q2/Q11 从待裁决表移除。

## 未决问题

- 何时打 `v1.1.0`：等第一轮现场测试通过后由用户授权；打 tag 前所有制品字节都已在 `main`。
- 非本地文件系统的预检阻塞（B11 建议）是否要做，等现场测试后再议。
