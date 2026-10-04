import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {statusLabel,statusClass,fileNodePaths,reviewPresentation} from '../src/document-state.ts';
test('unknown and historical document states never become current',()=>{
 assert.equal(statusLabel('current-code'),'当前');assert.equal(statusLabel('target-design'),'目标设计');assert.equal(statusLabel('historical'),'历史');assert.equal(statusLabel('in-progress-worktree'),'工作树快照');assert.equal(statusLabel('invalid'),'未核验');assert.notEqual(statusClass('invalid'),'status-current');
});
test('同一天不同审阅快照按明确选择分组，旧记录不能以当前标签出现',()=>{
 const current='plans/review-2026-10-03-rc4';
 assert.deepEqual(reviewPresentation(current+'/handoff',undefined,current),{group:'review-records',truthKind:undefined});
 assert.deepEqual(reviewPresentation('plans/review-2026-10-03/handoff','current-code',current),{group:'review-history',truthKind:'historical'});
 assert.deepEqual(reviewPresentation(current+'-draft/handoff','in-progress-worktree',current),{group:'review-history',truthKind:'historical'});
 assert.deepEqual(reviewPresentation('11-kernel/README','in-progress-worktree',current),{group:'11-kernel',truthKind:'in-progress-worktree'});
 assert.deepEqual(reviewPresentation('plans/review-2026-10-02/handoff',undefined,undefined),{group:'review-records',truthKind:undefined});
});
test('file inspector keeps repeated basenames separate through the canonical node table',()=>{
 assert.deepEqual(fileNodePaths('| f1 | `src/capabilities/pod/service.ts` | Pod |\n| f2 | `src/capabilities/demand/service.ts#executeDemandCreationRequest` | Demand |'),{f1:'src/capabilities/pod/service.ts',f2:'src/capabilities/demand/service.ts'});
 assert.deepEqual(fileNodePaths('| build | `tooling/artifacts/build-plugin-artifacts.ts#buildWakeflowPluginArtifacts` | 构建 |'),{build:'tooling/artifacts/build-plugin-artifacts.ts'});
});
