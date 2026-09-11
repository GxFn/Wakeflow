import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {statusLabel,statusClass,fileNodePaths} from '../src/document-state.ts';
test('unknown and historical document states never become current',()=>{
 assert.equal(statusLabel('current-code'),'当前');assert.equal(statusLabel('target-design'),'目标设计');assert.equal(statusLabel('historical'),'历史');assert.equal(statusLabel('in-progress-worktree'),'进行中');assert.equal(statusLabel('invalid'),'未核验');assert.notEqual(statusClass('invalid'),'status-current');
});
test('file inspector keeps repeated basenames separate through the canonical node table',()=>{
 assert.deepEqual(fileNodePaths('| f1 | `src/capabilities/pod/service.ts` | Pod |\n| f2 | `src/capabilities/demand/service.ts#executeDemandCreationRequest` | Demand |'),{f1:'src/capabilities/pod/service.ts',f2:'src/capabilities/demand/service.ts'});
});
