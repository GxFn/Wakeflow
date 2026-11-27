# ADR-0013 目标架构、切片解剖与 L1 切片顺序

> 状态：`accepted`
> 裁决日期：2026-09-04，用户按建议接受 A 到 G
> 提出日期：2026-09-04
> 基线提交：`c0098e2`
> 分析：[reviews/2026-09-04-architecture-and-slice-design.md](../reviews/2026-09-04-architecture-and-slice-design.md)
> 相关：[ADR-0004](./0004-mcp-tool-catalog-size.md)、[ADR-0005](./0005-demand-event-stream-read-path.md)、[ADR-0007](./0007-rebuild-mandate-and-bottom-up-flow.md)、[ADR-0009](./0009-execution-endpoint-and-host-effect-handshake.md)、[ADR-0012](./0012-flow-convergence-callback-calls-testing-redesign.md)

## 背景

P0 结束，能力卡与总览已确认。进入 L0 与 L1 前需要固定代码形状，否则每个切片会重复节点评估里的样板密度。

## 决定

- A 六层：foundation、contracts、kernel、capabilities、hosts、entrypoints；依赖只向下；切片互不引用；dependency-cruiser 规则改为六条方向规则加一条切片隔离。
- B 切片解剖固定：contract、decide、service、projection、tool、decide.test、scenario.test；Demand 单聚合，事件与前沿词汇表在 contracts 作为数据表，never 守卫。
- C 三种调用形状由内核各一份实现：读、`AppendCommand`（幂等键加 CAS 加 `next`）、`PublicationTransaction`（preview、apply、recover）；22 个协调器删除。
- D 一个错误类型 `WakeflowError{code, reason, path, retryable, details?}` 加封闭错误码表；301 个错误类删除。`details` 是可选的少量短标识（键 camelCase 不超过 32 字符，值限于 `[A-Za-z0-9_.:-]` 不超过 128 字符，至多 8 项），用于恢复所需的 operationId 一类句柄，写不进路径与自由文本（2026-09-04 用户选定，见进度日志 13.72）。
- E foundation 收敛到 14 个原语；kernel 新建 13 个模块（清单见分析第 3 节）。
- F 公共工具 20 个（清单见分析第 4 节）：现有 23 个删 8、改名 4、新增 5。
- G L1 切片顺序：workspace、endpoint、requirement、demand、tasking、delivery、result-review、evidence、pod、observation；每片退出门为 decide 测试加一条场景验收通过并删除被替代物。

## 后果

- 计划 §8.1：L0 行的对象与退出门按分析第 3.3 节改写；L1 行改为十个切片的顺序与退出门；§11 测试规则按分析第 6 节。
- 能力映射矩阵：新工具列按 16 个工具重写。
- 现有 TS：保留 foundation 持久化语义、事件溯源提交批与 CAS、配置 codec、ledger 摘要链、隐私规则集；其余按切片逐个删除重写。

## 未决问题

两项已由实现固定（2026-09-20 记录，gate-log §13.101 F8）：`kernel/` 与 `capabilities/` 是新目录，`governance/`、`workspace/`、`configuration/` 保留为既有领域的目录，六层方向由架构门强制；幂等由追加命令的请求键与既有事件流承担，没有独立的 `idempotency-store`。

## 补记一：决定 D 读作"一个形状"（2026-11-27，用户裁决）

决定 D 写的是"一个错误类型 `WakeflowError`……301 个错误类删除"。实现走到 1.4.5 时仍有 201 个错误类，对外由边界按家族表翻译（gate-log §13.166）。2026-11-26 到 27 的调研（错误类清点与联网调研，计划见 [reviews/2026-11-27-1.4.5-layering-plan.md](../reviews/2026-11-27-1.4.5-layering-plan.md)）之后，用户按建议裁决：

- **对外仍是一个类型。** `WakeflowError` 与封闭的错误码表不变。
- **内部是一个形状，不是零个类。** 机械部分（构造、消息、`fail`）只写在一个基类里；各模块的错误类是一行声明，相当于一个域标签加一个有类型的原因联合。消息由 `<code>: <reason> at <path>` 推出，不再有消息表。
- **翻译要有所添加。** 外来的系统错误在基础层原语里归一次类，到公开边界映射一次；中间的 `catch` 只在添上资源、含义变了、或有真实区分时才翻译，只换名字的删掉。
- **不照字面删类的理由。** 下层不知道请求的形状，决定不了公开的码与路径；原因的名字只在各自的域里唯一，按"类 + 原因"分支的恢复与自愈代码需要这个域。

登记项 G2 按这个目标重写后关闭；"技术债第 7 批：错误体系按目录收敛"由上述计划的主题 B 取代。

## 补记二：九层与内核的内容（2026-11-27，用户裁决）

决定 A 写的是六层：foundation、contracts、kernel、capabilities、hosts、entrypoints。`governance`、`workspace`、`configuration` 后来作为既有领域的目录保留，它们彼此之间、与 capabilities 之间的次序没有写下来，19 个切片连成一个环，靠四条 `transitional-*` 规则里的 22 条放行路径维持；规则注释“共享内容下沉到 kernel”让内核里约四成成了领域代码。2026-11-27 的分层研究量了每一条跨层、跨切片的导入，并在副本里把搬家做完、编译、跑架构检查（计划见 [reviews/2026-11-27-1.4.5-layering-plan.md](../reviews/2026-11-27-1.4.5-layering-plan.md) 第 7、8 节）。用户接受该计划并要求“优先做正确的判断与设计”，据此定下：

- **九层，自下而上**：foundation → contracts → kernel → configuration → governance → workspace → application → capabilities | hosts → entrypoints。每层一条“只引用这些层”的规则。capabilities 与 hosts 并列；宿主只取得 foundation、contracts、kernel、configuration 与 workspace：它实现 workspace 定义的端口，与 Demand 账本无关。entrypoints 是组合根。
- **共用的代码放在它的依赖允许的最低一层**，取代“共享内容下沉到 kernel”。内核只放机制（错误、命令外壳、追加命令与发布事务的协议、锁、操作作用域、工具登记、钩子观察记录、制品身份）和各层都读的数据表（路径目录、`next` 表、旧错误家族表）。名字里带领域概念的内核模块只因两种理由留下：它是数据表，或钩子观察器的闭包要它；观察器在每个宿主钩子事件上运行，闭包限于 foundation、contracts 与 kernel，由架构规则检查。七个领域存储离开内核：需求板与验收进 governance/ledger，pod 回执与 pod 锁进 governance/pod，窗口工作认领进 governance/delivery，事件流索引进 governance/demand。活动投影拆开：两级容器留在 kernel/active-layout；页面的渲染与发布进 workspace/active-projection，因为维护事务初始化时要写空工作区的投影。标识与词表放回它们该在的最低处：资源声明进内核，窗口绑定标识与事件流修订号进 contracts/identity，宿主标识只有 contracts 一份。
- **application 层**在 governance 与 workspace 之上、capabilities 之下：读遍整个工作区（配置、Demand、看板、pod、窗口）的状态视图放在这里，`wakeflow_status` 与投影刷新共用它。它不是一个能力，也不属于工作区的安装与运行。把刷新、错误表与 `next` 绑在一起的命令外壳以后也放在这里；内核里的命令外壳、追加命令与发布事务的协议仍是机制。
- **层内有层级。** governance 依据实际导入定次序：Demand 事件携带的记录种类在 demand 之下，读写 Demand 根的在 demand 里，发布证据这个操作在 demand 之上，读整个 Demand 状态的读模型在最上，即 ledger、pod < tasking、lifecycle、evidence < testing < delivery < result < review < demand < evidence-publication < controller、observation。证据的记录格式留在 evidence；发布事务的日志与记录集清点嵌着一条 Demand 命令、由 Demand 根的清点读回，所以在 demand 里；发布操作单独成片。contracts、foundation、workspace、application 同样有层级表。一个切片只引用更低层级的切片，同一层级互不引用。层表与层级表在 `tooling/architecture/layer-map.cjs`，架构检查核对表与 `src/` 下的目录一致。

结果（门日志 §13.306）：放行路径从 22 条归零，每一条跨切片依赖都有规则管方向；内核从 28 个模块、9,342 行变为 23 个、5,967 行。

后果：`CLAUDE.md` 与 `AGENTS.md` 描述层次的一句要改为九层（那是用户的文件，改之前给用户看，写下本补记时尚未改）；测试目录镜像九层；登记项 L17、L18、L20 关闭。
