function configuredTransportValue(hosts, hostId) {
    if (typeof hosts !== "object" || hosts === null)
        return undefined;
    const entry = hosts[hostId];
    if (typeof entry !== "object" || entry === null)
        return undefined;
    const value = entry.windowTransport;
    return typeof value === "string" ? value : undefined;
}
export class WakeflowWorkspaceHostTransportError extends Error {
    name = "WakeflowWorkspaceHostTransportError";
    code = "wakeflow-workspace-host-transport";
    reason;
    transport;
    constructor(reason, transport) {
        super("Wakeflow workspace host transport is not provided by this host.");
        this.reason = reason;
        this.transport = transport;
    }
}
/** 配置选了的传输键；配置未声明时是宿主的缺省键；没有传输表的宿主返回 null。 */
export function configuredWakeflowWorkspaceHostTransport(host, model) {
    if (host.transports === undefined)
        return null;
    return configuredTransportValue(model.hosts, host.hostId) ?? host.transports.defaultTransport;
}
/** 按配置选出当前工作区该宿主的资源 profile；传输键不在表里即抛错（配置 Schema 已限定枚举，这是合同违背）。 */
export function selectWakeflowWorkspaceHostResourceProfile(host, model) {
    const transport = configuredWakeflowWorkspaceHostTransport(host, model);
    if (transport === null || host.transports === undefined)
        return host.resourceProfile;
    const profile = Object.hasOwn(host.transports.profiles, transport)
        ? host.transports.profiles[transport]
        : undefined;
    if (profile === undefined)
        throw new WakeflowWorkspaceHostTransportError("unknown-transport", transport);
    return profile;
}
/**
 * 按配置选出当前工作区该宿主的窗口传输端口：有传输表的宿主取表里与所选 profile 同键的那一份，没有表的
 * 宿主取它直接给出的那一份；都没有即 null，由调用方决定这算不算合同违背。
 */
export function selectWakeflowWindowTransportPort(host, model) {
    const transport = configuredWakeflowWorkspaceHostTransport(host, model);
    if (transport === null || host.transports === undefined)
        return host.windowTransport ?? null;
    const ports = host.transports.ports;
    if (ports === undefined || !Object.hasOwn(ports, transport))
        return null;
    return ports[transport] ?? null;
}
