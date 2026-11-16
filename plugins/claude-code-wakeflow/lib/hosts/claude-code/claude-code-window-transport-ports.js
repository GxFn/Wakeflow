import { wakeflowWindowLivenessWithoutEvidence, } from "../../workspace/host-runtime/wakeflow-window-transport-port.js";
import { classifyDesktopSessions, } from "./claude-code-desktop-session-classification.js";
import { classifyTmuxPanes, } from "./claude-code-tmux-pane-classification.js";
import { claudeCodeWorkspaceHostTransportTable } from "./wakeflow-workspace-host-resource-profile.js";
/**
 * Wakeflow Host / Claude Code：两种窗口传输的端口（open-items L6；ADR-0025 D2、D3）。
 *
 * tmux 传输的定位是 socket、session、window、pane 四元组，存活由 `tmux list-panes` 的行证明；桌面传输的
 * 定位是桌面 app 的会话 id，存活由 app 的会话清单证明。两份端口同形，执行端点切片只调用。两种传输的定位
 * 载荷都交给两份端口：工作区换过传输之后，磁盘上留着的上一种记录仍然读得回，并且对当前传输只算"不是我的
 * 定位"。
 *
 * 别的传输或别的宿主的观察（桌面工作区里的 pane 清单、Claude 窗口上的 Codex 线程状态）在这里什么也证明
 * 不了：端口只认自己那一种。
 */
const TMUX_PROVIDER = "tmux";
const DESKTOP_PROVIDER = "desktop";
const HOST_CONFIG_KEY = "claude-code";
const LOCATOR_TEXT_MAXIMUM_LENGTH = 256;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value, path, invalid) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        value.length > LOCATOR_TEXT_MAXIMUM_LENGTH) {
        invalid(path);
    }
    return value;
}
/** tmux 定位的载荷：四个坐标；默认 socket 记成 null。 */
const tmuxLocatorCodec = Object.freeze({
    provider: TMUX_PROVIDER,
    parsePayload(value, invalid) {
        if (!isRecord(value))
            invalid("$locator");
        return Object.freeze({
            socketName: value.socketName === null
                ? null
                : text(value.socketName, "$locator.tmux.socketName", invalid),
            sessionName: text(value.sessionName, "$locator.tmux.sessionName", invalid),
            windowId: text(value.windowId, "$locator.tmux.windowId", invalid),
            paneId: text(value.paneId, "$locator.tmux.paneId", invalid),
        });
    },
    identitySeed(payload) {
        return Object.freeze({
            namespace: "wakeflow-window-locator",
            parts: Object.freeze([
                typeof payload.socketName === "string" ? payload.socketName : "",
                String(payload.sessionName),
                String(payload.windowId),
                String(payload.paneId),
            ]),
        });
    },
});
/** 桌面定位的载荷：桌面会话 id（`local_<uuid>`），由 Agent 的观察显式给出，不从句柄派生。 */
const desktopLocatorCodec = Object.freeze({
    provider: DESKTOP_PROVIDER,
    parsePayload(value, invalid) {
        if (!isRecord(value))
            invalid("$locator");
        return Object.freeze({
            sessionId: text(value.sessionId, "$locator.desktop.sessionId", invalid),
        });
    },
    identitySeed(payload) {
        return Object.freeze({
            namespace: "wakeflow-window-locator-desktop",
            parts: Object.freeze([String(payload.sessionId)]),
        });
    },
});
const CLAUDE_CODE_LOCATOR_CODECS = Object.freeze([tmuxLocatorCodec, desktopLocatorCodec]);
/** 一条 tmux 定位记录变成 pane 分类器要的形状。 */
function toTmuxLocator(locator) {
    const payload = locator.payload;
    return Object.freeze({
        socketName: typeof payload.socketName === "string" ? payload.socketName : null,
        sessionName: String(payload.sessionName),
        windowId: String(payload.windowId),
        paneId: String(payload.paneId),
        identity: Object.freeze({
            programId: locator.programId,
            hostId: locator.hostId,
            windowId: locator.windowId,
            bindingId: locator.bindingId,
            locatorId: locator.locatorId,
        }),
    });
}
/** 配置里的 tmux socket（`hosts.claude-code.tmux.socketName`）；没有声明即默认 socket，记成 null。 */
function configuredTmuxSocketName(hosts) {
    if (!isRecord(hosts))
        return null;
    const host = hosts[HOST_CONFIG_KEY];
    if (!isRecord(host) || !isRecord(host.tmux))
        return null;
    return typeof host.tmux.socketName === "string" ? host.tmux.socketName : null;
}
function classifyTmuxLiveness(input) {
    const { binding, locator, observation } = input;
    if (observation.kind !== "tmux-panes")
        return wakeflowWindowLivenessWithoutEvidence(observation);
    if (locator === null || binding === null || locator.provider !== TMUX_PROVIDER) {
        return wakeflowWindowLivenessWithoutEvidence(observation);
    }
    const status = classifyTmuxPanes(toTmuxLocator(locator), { bindingId: binding.bindingId, socketName: configuredTmuxSocketName(input.hosts) }, observation.panes);
    // pane 没了或已死是确定不在；只有 live 是确定还在；其余状态说明对不上，什么也证明不了。
    const presence = status === "live"
        ? "alive"
        : status === "missing" || status === "pane-dead"
            ? "absent"
            : "unknown";
    return Object.freeze({ kind: "tmux-panes", status, presence });
}
function classifyDesktopLiveness(input) {
    const { binding, locator, observation } = input;
    if (observation.kind !== "desktop-sessions") {
        return wakeflowWindowLivenessWithoutEvidence(observation);
    }
    if (locator === null || binding === null || locator.provider !== DESKTOP_PROVIDER) {
        return wakeflowWindowLivenessWithoutEvidence(observation);
    }
    // 句柄是 Claude 会话 id，定位器里是桌面 id；`list_sessions` 的行按两者之一匹配（ADR-0025 D3，X17）。
    const status = classifyDesktopSessions({ sessionId: binding.handleValue, desktopSessionId: String(locator.payload.sessionId) }, observation.sessions);
    return Object.freeze({
        kind: "desktop-sessions",
        status,
        presence: status === "absent" ? "absent" : "alive",
    });
}
/** tmux 传输：创建观察必须带 tmux 坐标，不能带桌面会话；同一会话换 pane 可以 relocate。 */
export const claudeCodeTmuxWindowTransportPort = Object.freeze({
    provider: TMUX_PROVIDER,
    hasLocator: true,
    relocation: "supported",
    locatorCodecs: CLAUDE_CODE_LOCATOR_CODECS,
    admitCreationLocator(observation) {
        if (observation.desktop !== undefined) {
            return Object.freeze({
                reason: "locator-kind-mismatch",
                path: "$request.observation.desktop",
            });
        }
        if (observation.tmux === undefined) {
            return Object.freeze({
                reason: "tmux-coordinates-required",
                path: "$request.observation.tmux",
            });
        }
        return null;
    },
    locatorOf(observation) {
        if (observation.tmux === undefined)
            return null;
        return Object.freeze({
            provider: TMUX_PROVIDER,
            payload: Object.freeze({
                socketName: observation.tmux.socketName,
                sessionName: observation.tmux.sessionName,
                windowId: observation.tmux.windowId,
                paneId: observation.tmux.paneId,
            }),
        });
    },
    classifyLiveness: classifyTmuxLiveness,
});
/**
 * 桌面会话传输：创建观察必须带桌面会话 id，不能带 tmux 坐标；会话发消息即续，没有可换的位置，所以
 * relocate 不成立。
 */
export const claudeCodeDesktopWindowTransportPort = Object.freeze({
    provider: DESKTOP_PROVIDER,
    hasLocator: true,
    relocation: "not-applicable",
    locatorCodecs: CLAUDE_CODE_LOCATOR_CODECS,
    admitCreationLocator(observation) {
        if (observation.tmux !== undefined) {
            return Object.freeze({
                reason: "locator-kind-mismatch",
                path: "$request.observation.tmux",
            });
        }
        if (observation.desktop === undefined) {
            return Object.freeze({
                reason: "desktop-session-required",
                path: "$request.observation.desktop",
            });
        }
        return null;
    },
    locatorOf(observation) {
        if (observation.desktop === undefined)
            return null;
        return Object.freeze({
            provider: DESKTOP_PROVIDER,
            payload: Object.freeze({ sessionId: observation.desktop.sessionId }),
        });
    },
    classifyLiveness: classifyDesktopLiveness,
});
/**
 * 带端口的传输表：profile 表原样，加上与它同键的两份端口。profile 表是纯数据，对端制品也读它，所以端口
 * 不放进那个模块——只有本宿主的组合根用这一份（对端制品的闭包不得含本宿主的执行模块）。
 */
export const claudeCodeWindowTransportTable = Object.freeze({
    ...claudeCodeWorkspaceHostTransportTable,
    ports: Object.freeze({
        tmux: claudeCodeTmuxWindowTransportPort,
        desktop: claudeCodeDesktopWindowTransportPort,
    }),
});
/**
 * 一条定位记录里的桌面会话 id；记录属于另一种传输时为 null。投递的回传段用它给出 Controller 窗口的桌面
 * 会话（open-items X15）。
 */
export function claudeCodeDesktopSessionIdOf(locator) {
    if (locator === null || locator.provider !== DESKTOP_PROVIDER)
        return null;
    const sessionId = locator.payload.sessionId;
    return typeof sessionId === "string" ? sessionId : null;
}
