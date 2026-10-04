import fs,{globSync} from 'node:fs';
import {documentParts,fingerprintInputs,sourceIndex,testIndex,validateReferences,validateEdges,diagramBlocks,validateImports,validateTestEvidence,validateLinks} from '../../scripts/atlas-validation.mjs';
import path from 'node:path';
// Read-only source/doc checks; report writes stay in this review directory. Never refresh fingerprints here.
const groups=['11-kernel','12-endpoint','13-requirement','14-evidence','15-pod','16-observation'];
const root=process.cwd(), mods=sourceIndex(root), tests=testIndex(root);let results=[];
for(const group of groups)for(const file of globSync(`wakeflow-architecture-atlas/maps/${group}/*.md`)){
 const raw=fs.readFileSync(file,'utf8');
 const {metadata,body}=documentParts(raw),current={metadata,body},fp=fingerprintInputs(metadata,root);
 const fingerprintErrors=metadata.sourceFingerprint===fp.digest?[]:['source fingerprint drift; re-review changed source before changing metadata'];
 const blocks=diagramBlocks(current.body),refsCheck=validateReferences(raw,root,mods,tests),importCheck=metadata.viewType==='file-dependency'?validateImports(body,mods):{errors:[]};
 const testEvidence=validateTestEvidence(current.body,true);
 const errors=[...fingerprintErrors,...fp.missing,...refsCheck.errors,...blocks.flatMap(b=>validateEdges(b).errors),...importCheck.errors,...testEvidence.errors,...validateLinks(raw,path.dirname(file)).errors];
 results.push({file,diagrams:blocks.length,inputs:fp.files.length,fingerprint:fp.digest,sourceAndTestSymbols:refsCheck.symbols,testSymbols:refsCheck.testSymbols,testEvidence:testEvidence.counts,errors});
}
const result={reviewedAt:'2026-10-03',scope:'Selected maps static references, imports, numeric edges, tests, source digests and local links; not Mermaid browser rendering or root tests',ok:results.every(x=>x.errors.length===0),files:results};
fs.writeFileSync('wakeflow-architecture-atlas/plans/review-2026-10-03/coordination-map-check.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({files:results.length,diagrams:results.reduce((n,x)=>n+x.diagrams,0),errors:results.flatMap(x=>x.errors.map(e=>x.file+': '+e))},null,2));
