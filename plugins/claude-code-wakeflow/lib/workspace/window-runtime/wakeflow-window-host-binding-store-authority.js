import { admitWakeflowResourceOperation, WakeflowResourceProcessingContractError, } from "../../foundation/resource/resource-processing-contract.js";
import { parseWakeflowWorkspaceHostResourceProfile, WakeflowWorkspaceHostResourceProfileError, } from "../workspace-host-resource-profile.js";
import { createWakeflowWindowHostBindingResourceCatalog } from "./wakeflow-window-host-binding-resource-catalog.js";
import { parseWakeflowWindowHostIdentityProfile, WakeflowWindowHostIdentityProfileError, } from "./wakeflow-window-host-identity-profile.js";
import { compileWakeflowWindowRuntimeDesiredTopology, WakeflowWindowRuntimeDesiredTopologyError, } from "./wakeflow-window-runtime-desired-topology.js";
import { wakeflowWindowHostBindingMutationLockRef, wakeflowWindowHostBindingRootRef, } from "./wakeflow-window-runtime-paths.js";
const ERROR_MESSAGES = {
    profile: "Window Host Binding Store authority profiles are inconsistent.",
    topology: "Window Host Binding Store authority topology is invalid.",
    resource: "Window Host Binding Store authority resource catalog is invalid.",
};
/** Binding Store读取权威无法从当前静态来源闭合时的稳定错误。 */
export class WakeflowWindowHostBindingStoreAuthorityError extends Error {
    name = "WakeflowWindowHostBindingStoreAuthorityError";
    code = "wakeflow-window-host-binding-store-authority";
    reason;
    path;
    constructor(reason, path, options) {
        super(ERROR_MESSAGES[reason], options);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path, cause) {
    throw new WakeflowWindowHostBindingStoreAuthorityError(reason, path, cause === undefined ? undefined : { cause });
}
/** 从当前Config与Host profiles编译完整、零I/O的Binding Store读取权威。 */
export function compileWakeflowWindowHostBindingStoreAuthority(configValue, resourceProfileValue, identityProfileValue) {
    let resourceProfile;
    let identityProfile;
    try {
        resourceProfile = parseWakeflowWorkspaceHostResourceProfile(resourceProfileValue);
        identityProfile = parseWakeflowWindowHostIdentityProfile(identityProfileValue);
    }
    catch (error) {
        if (error instanceof WakeflowWorkspaceHostResourceProfileError ||
            error instanceof WakeflowWindowHostIdentityProfileError) {
            fail("profile", error.path, error);
        }
        throw error;
    }
    if (!resourceProfile.surfaces.windowIdentity ||
        resourceProfile.hostId !== identityProfile.hostId) {
        fail("profile", "$profiles");
    }
    let topology;
    try {
        topology = compileWakeflowWindowRuntimeDesiredTopology(configValue, resourceProfile);
    }
    catch (error) {
        if (error instanceof WakeflowWindowRuntimeDesiredTopologyError) {
            fail("topology", error.path, error);
        }
        throw error;
    }
    let bindingRefs;
    try {
        bindingRefs = Object.freeze(createWakeflowWindowHostBindingResourceCatalog(configValue, resourceProfile).map((declaration) => {
            admitWakeflowResourceOperation(declaration.processing, "exclusive-create");
            const ref = declaration.placement.relativePath;
            if (ref === null)
                fail("resource", "$bindingCatalog");
            return ref;
        }));
    }
    catch (error) {
        if (error instanceof WakeflowResourceProcessingContractError ||
            error instanceof WakeflowWindowHostBindingStoreAuthorityError) {
            fail("resource", "$bindingCatalog", error);
        }
        throw error;
    }
    if (bindingRefs.length !== topology.windows.length ||
        new Set(bindingRefs).size !== bindingRefs.length) {
        fail("resource", "$bindingCatalog");
    }
    return Object.freeze({
        programId: topology.programId,
        resourceProfile,
        identityProfile,
        bindingRefs,
        bindingRootRef: wakeflowWindowHostBindingRootRef(resourceProfile),
        lockRef: wakeflowWindowHostBindingMutationLockRef(resourceProfile),
    });
}
