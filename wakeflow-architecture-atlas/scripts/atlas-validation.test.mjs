import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {parseSource,validateEdges,validateImports,validateReferences,fingerprintInputs,truthKinds} from './atlas-validation.mjs';

test('AST ignores fake imports in text and comments, preserves real imports and symbols',()=>{
 const r=parseSource('// from "./fake.js"\nconst text="from fake"; import {f} from "./real.js"; export function start() {} class Store { async apply() {} }','sample.ts');
 assert.deepEqual(r.imports,['./real.js']);assert(r.symbols.has('start'));assert(r.symbols.has('Store.apply'));assert(!r.symbols.has('absent'));
});
test('dependency edges require exact paths even for repeated service.ts basenames',()=>{
 const body='```mermaid\nflowchart LR\n a["甲"]\n b["乙"]\n a -->|"E-TST-01 导入"| b\n```\n| a | `src/a/service.ts` | 甲 |\n| b | `src/b/service.ts` | 乙 |';
 const modules=new Map([['src/a/service.ts',{imports:new Set(['src/b/service.ts'])}],['src/b/service.ts',{imports:new Set()}]]);
 assert.equal(validateImports(body,modules).errors.length,0);
 modules.get('src/a/service.ts').imports.clear();assert.equal(validateImports(body,modules).errors.length,1);
 assert(validateImports(body.replace('| b |','| c |'),modules).errors.some(x=>x.includes('unresolved')));
});
test('evidence requires one row per numbered edge and adjacent terms',()=>{
 const source='flowchart LR\n accTitle: 测试\n accDescr: 测试关系\n a -->|"E-TST-01 调用"| b';
 const after='\n\n### 本图术语说明\n\n| E-TST-01 | source | test |';
 assert.equal(validateEdges({source,after}).errors.length,0);
 assert(validateEdges({source,after:after+'\n| E-TST-01 | duplicate | test |'}).errors.some(x=>x.includes('exactly one')));
 assert(validateEdges({source:source+'\n b --> c',after}).errors.some(x=>x.includes('one numeric')));
 assert(validateEdges({source,after:'other section'+after}).errors.some(x=>x.includes('immediately')));
});
test('missing explicit source and refresh trigger changes cannot pass fingerprinting',()=>{
 const base=path.resolve('.validation-fixture');fs.mkdirSync(base,{recursive:true});
 try {fs.writeFileSync(path.join(base,'source.ts'),'export const a=1;');fs.writeFileSync(path.join(base,'decision.md'),'accepted');
 const m={sourcePaths:['source.ts'],refreshTriggers:['decision.md']};const a=fingerprintInputs(m,base);fs.writeFileSync(path.join(base,'decision.md'),'revised');const b=fingerprintInputs(m,base);assert.notEqual(a.digest,b.digest);assert.deepEqual(fingerprintInputs({sourcePaths:['missing.ts']},base).missing,['missing.ts']);
 assert(validateReferences('`src/a.ts#missing`',base,new Map()).errors.length);
 }finally{fs.rmSync(base,{recursive:true,force:true});}
});
test('target design is distinct from code and history',()=>{assert(truthKinds.has('target-design'));assert(!truthKinds.has('ready'));});

test('browser receipt rejects source drift, version drift, duplicates and unrendered diagrams', async () => {
 const {validateRenderReceipt}=await import('./atlas-validation.mjs');
 const expected=[{file:'maps/a.md',diagram:1,sourceDigest:'sha256:fixture'}];
 const row={...expected[0],status:'pass',width:100,height:100};
 const receipt={renderer:'mermaid',rendererVersion:'11.17.2',verifiedAt:'2026-09-11T00:00:00Z',ok:true,diagrams:1,rendered:1,results:[row]};
 assert.deepEqual(validateRenderReceipt(receipt,expected,'11.17.2'),[]);
 assert(validateRenderReceipt(receipt,[{...expected[0],sourceDigest:'changed'}],'11.17.2').length);
 assert(validateRenderReceipt(receipt,expected,'another-version').length);
 assert(validateRenderReceipt({...receipt,results:[row,row]},expected,'11.17.2').length);
 assert(validateRenderReceipt({...receipt,results:[{...row,status:'fail'}]},expected,'11.17.2').length);
 assert(validateRenderReceipt({...receipt,results:[{...row,width:0}]},expected,'11.17.2').length);
});
