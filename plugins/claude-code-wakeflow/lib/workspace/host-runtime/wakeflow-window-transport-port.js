/**
 * 什么也证明不了的那一种结论：观察的种类不是本传输的，或者没有可对照的绑定与定位。没有观察时就是
 * `unobserved`；别的种类报 `no-locator`。
 */
export function wakeflowWindowLivenessWithoutEvidence(observation) {
    if (observation.kind === "unobserved") {
        return Object.freeze({ kind: "unobserved", presence: "unknown" });
    }
    return Object.freeze({
        kind: observation.kind,
        status: "no-locator",
        presence: "unknown",
    });
}
