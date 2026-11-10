/**
 * Wakeflow Host / Claude Code：助手源文件共用的类型（只给 `checkJs` 看，不进发布字节）。
 */

/**
 * 从磁盘或 stdin 读入、还没有逐字段核对的 JSON 对象。助手不带 Schema 校验器：每个字段都在使用处核对
 * 类型，所以这里不假装知道它的形状。
 */
// biome-ignore lint/suspicious/noExplicitAny: unvalidated JSON whose fields are checked where they are used
type JsonRecord = Record<string, any>;

/** 一次宿主命令（tmux、git、ps、claude、script）的结果；超时不走这里，直接拒绝为 host-command-timeout。 */
interface RunResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number | null;
}

/** `run` 的可选项：`stdin: "ignore"` 把子进程的 stdin 接到 /dev/null（伪终端包装需要，现场 L18）。 */
interface RunOptions {
  env?: NodeJS.ProcessEnv;
  input?: string;
  cwd?: string;
  stdin?: "ignore";
}

/** 落地记录的查询结果：摘要相符（文本完整）或只按许可标识相符（文本被宿主改动），ADR-0027。 */
interface LandingMatch {
  record: JsonRecord;
  match: "digest" | "identity";
}

/** `prepareWorktree` 的结果：检出是新建的还是复用的，以及 `.git/info/exclude` 那一行做了什么。 */
interface PreparedWorktree {
  readonly prepared: "created" | "reused";
  readonly branch: string;
  readonly checkout: string;
  readonly root: string;
  readonly exclude: "present" | "appended";
}

/** 一个落点：绝对路径只在助手进程里用，进输出的只有相对工作区根的那一份。 */
interface Placement {
  readonly absolute: string;
  readonly relative: string;
}

/** 桌面助手的命令行选项。 */
interface DesktopHelperOptions {
  window: string | null;
  force: boolean;
  wait: number;
  waitSessionStart: number;
  waitLanding: number;
  promptDigest: string | null;
  promptRef: string | null;
  userAgreed: boolean;
  settle: number;
}

/** `claude agents --json` 的清单：读不到时 `available` 为 false，`detail` 是有界的诊断。 */
interface AgentListing {
  readonly available: boolean;
  readonly rows: JsonRecord[];
  readonly detail: string | undefined;
}

/**
 * 助手读入的配置：`readConfig` 只核对了下面这几项的形状（programId 是字符串，窗口与 pod 是数组），
 * 其余字段仍在使用处核对。
 */
interface HelperConfig extends JsonRecord {
  program: JsonRecord & { programId: string };
  topology: JsonRecord & { windows: JsonRecord[] };
  pods: JsonRecord[];
}

/** 启动意图的 execution 段，`assertExecution` 核对过 kind、command 与参数数组之后的形状。 */
type CheckedExecution = JsonRecord & { arguments: string[] };

/** tmux 助手的上下文：配置的 socket 与会话名，本工作区的 programId。 */
interface TmuxContext {
  readonly socketName: string | null;
  readonly sessionName: string;
  readonly programId: string;
}

/** tmux 助手的命令行选项。 */
interface TmuxHelperOptions {
  window: string | null;
  all: boolean;
  force: boolean;
  inPlace: boolean;
  wait: number;
  handleDigest: string | null;
  promptRef: string | null;
  promptDigest: string | null;
  waitLanding: number;
  text: string | null;
}

/** pane 行：`tmux list-panes -a` 的一行加上该窗口的五个 `@wakeflow_*` 选项。它原样进入 tmux-panes 观察。 */
interface PaneRow {
  readonly socketName: string | null;
  readonly sessionName: string;
  readonly windowId: string;
  readonly paneId: string;
  readonly paneWindowId: string;
  readonly paneDead: boolean;
  readonly currentCommand: string;
  readonly windowName: string | null;
  readonly options: Readonly<{
    programId: string | null;
    hostId: string | null;
    windowId: string | null;
    bindingId: string | null;
    locatorId: string | null;
  }>;
}

/** pane 清单：读不到时 `available` 为 false。`claudePids` 只留在助手内部，收养时用（§13.134）。 */
interface PaneListing {
  readonly available: boolean;
  readonly rows: PaneRow[];
  readonly claudePids: Map<string, number>;
}

/** 进程表的一行（`ps -axo pid=,ppid=,comm=`）。 */
interface ProcessRow {
  pid: number;
  ppid: number;
  executable: string;
}

/** 核对 pane 存活用的 tmux 坐标；带会话名时按它核对，否则按配置的会话。 */
interface TmuxCoordinates {
  readonly windowId: string;
  readonly paneId: string;
  readonly sessionName?: string | null;
}

/** 登记用 observation 里的 tmux 位置。 */
interface TmuxObservedLocation {
  socketName: string | null;
  sessionName: string;
  windowId: string;
  paneId: string;
}

/** 截屏的一行：原文（可带 SGR 属性）与去掉属性后的文字。 */
interface ScreenLine {
  raw: string;
  plain: string;
}

/** 状态栏脚本读入的配置：它只核对了窗口与 pod 是数组。 */
interface StatuslineConfig extends JsonRecord {
  topology: JsonRecord & { windows: JsonRecord[] };
  pods: JsonRecord[];
}
