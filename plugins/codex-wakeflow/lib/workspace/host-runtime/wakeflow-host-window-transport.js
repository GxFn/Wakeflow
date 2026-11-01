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
