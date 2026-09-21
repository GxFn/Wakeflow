import { types } from "node:util";
import { computeCanonicalJsonSha256Digest, } from "../../foundation/crypto/canonical-json-sha256.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { createDirectoryAtomically, DurableDirectoryMaterializationError, } from "../../foundation/filesystem/durable-directory-materialization.js";
import { parsePortableResourcePath, splitPortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { readStableResourceDirectory, StableDirectoryReadError, } from "../../foundation/filesystem/stable-directory-read.js";
import { wakeflowHostIdentityRootRef, wakeflowHostProjectionsRootRef, wakeflowHostRuntimeRootRef, } from "../workspace-host-runtime-paths.js";
import { parseWakeflowWorkspaceHostResourceProfile, WakeflowWorkspaceHostResourceProfileError, } from "../workspace-host-resource-profile.js";
import { compileWakeflowHostCapabilityLayoutAuthority, WakeflowHostCapabilityLayoutAuthorityError, } from "./wakeflow-host-capability-layout-authority.js";
const ERROR_MESSAGES = {
    input: "Host capability layout materialization input is invalid.",
    authority: "Host capability layout authority is invalid.",
    prerequisite: "Host capability layout prerequisite is unavailable.",
    "strict-absent": "Fresh host capability layout target already exists.",
    "prefix-conflict": "Host capability layout prefix is not exact.",
    "root-scope": "Host capability layout lost workspace scope.",
    aborted: "Host capability layout materialization was aborted.",
    "operation-failure": "Host capability layout materialization failed.",
};
/** Host capability layout 物化失败的稳定、脱敏错误。 */
export class WakeflowHostCapabilityLayoutMaterializationError extends Error {
    name = "WakeflowHostCapabilityLayoutMaterializationError";
    code = "wakeflow-host-capability-layout-materialization";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new WakeflowHostCapabilityLayoutMaterializationError(reason, path);
}
function parseOptions(value) {
    let record;
    try {
        record = parsePlainRecord(value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    if (!Object.hasOwn(record, "recoveringFreshLayout")
        || Object.keys(record).some((key) => (key !== "recoveringFreshLayout" && key !== "signal"))
        || typeof record.recoveringFreshLayout !== "boolean"
        || (record.signal !== undefined
            && (typeof record.signal !== "object"
                || record.signal === null
                || types.isProxy(record.signal)
                || !(record.signal instanceof AbortSignal)))) {
        fail("input", "$options");
    }
    return Object.freeze({
        recoveringFreshLayout: record.recoveringFreshLayout,
        signal: record.signal,
    });
}
function currentUserId() {
    return typeof process.geteuid === "function"
        ? BigInt(process.geteuid())
        : null;
}
function assertPrivateDirectory(node, path) {
    if (node.kind !== "directory"
        || node.permissionBits !== 0o700
        || (currentUserId() !== null && node.userId !== currentUserId())) {
        fail("prefix-conflict", path);
    }
}
function resourceParent(resourcePath) {
    const segments = splitPortableResourcePath(resourcePath);
    if (segments.length < 2)
        fail("authority", "$declarations");
    return parsePortableResourcePath(segments.slice(0, -1).join("/"));
}
function resourceName(resourcePath) {
    return splitPortableResourcePath(resourcePath).at(-1) ?? "";
}
function expectedChildren(authority, hostRoot) {
    const mutable = new Map();
    mutable.set(hostRoot, new Set(["identity", "projections"]));
    for (const declaration of authority.declarations) {
        const resourcePath = declaration.placement.relativePath;
        if (resourcePath === null)
            fail("authority", "$declarations");
        const parent = resourceParent(resourcePath);
        const name = resourceName(resourcePath);
        if (name.length === 0)
            fail("authority", "$declarations");
        const children = mutable.get(parent) ?? new Set();
        children.add(name);
        mutable.set(parent, children);
        if (!mutable.has(resourcePath))
            mutable.set(resourcePath, new Set());
    }
    return new Map([...mutable].map(([parent, children]) => [parent, new Set(children)]));
}
async function optionalDirectory(root, resourcePath) {
    try {
        const resource = await root.inspectExistingResource(resourcePath);
        assertPrivateDirectory(resource.node, `$layout/${resourcePath}`);
        return resource.node;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError
            && error.reason === "resource-not-found")
            return null;
        if (error instanceof WakeflowHostCapabilityLayoutMaterializationError) {
            throw error;
        }
        if (error instanceof RootedDirectoryError)
            fail("root-scope", "$root");
        throw error;
    }
}
async function readDirectory(root, resourcePath, maximumEntries, signal) {
    try {
        const read = await readStableResourceDirectory(root, resourcePath, {
            maximumEntries,
            ...(signal === undefined ? {} : { signal }),
        });
        assertPrivateDirectory(read.directoryNode, `$layout/${resourcePath}`);
        return read;
    }
    catch (error) {
        if (error instanceof WakeflowHostCapabilityLayoutMaterializationError) {
            throw error;
        }
        if (error instanceof StableDirectoryReadError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "root-scope")
                fail("root-scope", "$root");
            fail("prefix-conflict", `$layout/${resourcePath}`);
        }
        throw error;
    }
}
async function inspectPartialTree(root, expected, signal, requireComplete) {
    for (const [parent, childNames] of expected) {
        if (await optionalDirectory(root, parent) === null) {
            if (requireComplete)
                fail("prefix-conflict", `$layout/${parent}`);
            continue;
        }
        const directory = await readDirectory(root, parent, childNames.size + 1, signal);
        if (directory.entries.some((entry) => (!childNames.has(entry.name)
            || entry.node.kind !== "directory"
            || entry.node.permissionBits !== 0o700
            || (currentUserId() !== null && entry.node.userId !== currentUserId())))
            || (requireComplete && directory.entries.length !== childNames.size)) {
            fail("prefix-conflict", `$layout/${parent}`);
        }
    }
}
async function assertTargetsAbsent(root, authority) {
    for (const declaration of authority.declarations) {
        const resourcePath = declaration.placement.relativePath;
        if (resourcePath === null)
            fail("authority", "$declarations");
        if (await optionalDirectory(root, resourcePath) !== null) {
            fail("strict-absent", `$layout/${resourcePath}`);
        }
    }
}
async function ensureDirectory(root, resourcePath, recovering, signal) {
    const existing = await optionalDirectory(root, resourcePath);
    if (existing !== null) {
        if (!recovering)
            fail("strict-absent", `$layout/${resourcePath}`);
        return Object.freeze({
            resourcePath,
            disposition: "current",
            node: existing,
        });
    }
    try {
        const created = await createDirectoryAtomically(root, resourcePath, {
            mode: 0o700,
            ...(signal === undefined ? {} : { signal }),
        });
        assertPrivateDirectory(created.node, `$layout/${resourcePath}`);
        return Object.freeze({
            resourcePath,
            disposition: "created",
            node: created.node,
        });
    }
    catch (error) {
        if (error instanceof WakeflowHostCapabilityLayoutMaterializationError) {
            throw error;
        }
        if (error instanceof DurableDirectoryMaterializationError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("operation-failure", `$layout/${resourcePath}`);
        }
        throw error;
    }
}
/** 按当前 Host Profile 物化空 capability 父目录，或恢复同一 exact 前缀。 */
export async function materializeWakeflowHostCapabilityLayout(rootValue, profileValue, optionsValue) {
    if (typeof rootValue !== "object"
        || rootValue === null
        || types.isProxy(rootValue)
        || !(rootValue instanceof RootedDirectory)) {
        fail("input", "$root");
    }
    const options = parseOptions(optionsValue);
    if (options.signal?.aborted === true)
        fail("aborted", "$signal");
    let profile;
    let authority;
    try {
        profile = parseWakeflowWorkspaceHostResourceProfile(profileValue);
        authority = compileWakeflowHostCapabilityLayoutAuthority(profile);
    }
    catch (error) {
        if (error instanceof WakeflowWorkspaceHostResourceProfileError
            || error instanceof WakeflowHostCapabilityLayoutAuthorityError) {
            fail("authority", error.path);
        }
        throw error;
    }
    const hostRoot = wakeflowHostRuntimeRootRef(profile);
    if (await optionalDirectory(rootValue, hostRoot) === null) {
        fail("prerequisite", "$hostRoot");
    }
    if (await optionalDirectory(rootValue, wakeflowHostIdentityRootRef(profile))
        === null
        || await optionalDirectory(rootValue, wakeflowHostProjectionsRootRef(profile)) === null) {
        fail("prerequisite", "$hostLayout");
    }
    const expected = expectedChildren(authority, hostRoot);
    await inspectPartialTree(rootValue, expected, options.signal, false);
    if (!options.recoveringFreshLayout) {
        await assertTargetsAbsent(rootValue, authority);
    }
    const effects = [];
    for (const declaration of authority.declarations) {
        const resourcePath = declaration.placement.relativePath;
        if (resourcePath === null)
            fail("authority", "$declarations");
        effects.push(await ensureDirectory(rootValue, resourcePath, options.recoveringFreshLayout, options.signal));
    }
    await inspectPartialTree(rootValue, expected, options.signal, true);
    const createdDirectoryCount = effects.filter((entry) => (entry.disposition === "created")).length;
    const observationBasis = {
        kind: "WakeflowHostCapabilityLayoutObservation",
        authorityDigest: authority.authorityDigest,
        directories: effects.map((entry) => ({
            resourcePath: entry.resourcePath,
            deviceId: entry.node.deviceId.toString(),
            inodeId: entry.node.inodeId.toString(),
        })),
    };
    return Object.freeze({
        disposition: createdDirectoryCount === 0 ? "current" : "created",
        authorityDigest: authority.authorityDigest,
        createdDirectoryCount,
        observationDigest: computeCanonicalJsonSha256Digest(observationBasis),
    });
}
