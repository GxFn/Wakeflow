import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformSync } from '@swc/core';

// Current reviewed modules are transformed in memory; dependencies and disposable
// fixture builders use the existing .build tree. This script never builds source.
// All credential-like values are synthetic and outputs contain only categories.
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const currentPaths = new Set([
  'src/kernel/privacy-scan.ts',
  'src/capabilities/requirement/decide.ts',
  'src/capabilities/requirement/service.ts',
  'src/governance/evidence/managed-evidence-capture-planning-service.ts',
]);
const transformed = new Map();
async function moduleUrl(relativePath) {
  if (transformed.has(relativePath)) return transformed.get(relativePath);
  const source = readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
  let code = transformSync(source, { jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'es6' } }).code;
  for (const match of [...code.matchAll(/from (["'])([^"']+)\1/g)]) {
    const [full, quote, specifier] = match;
    let url = specifier;
    if (specifier.startsWith('.')) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), specifier)).replace(/\.js$/, '.ts');
      url = currentPaths.has(target) ? await moduleUrl(target) : pathToFileURL(path.join(repositoryRoot, '.build', target.replace(/\.ts$/, '.js'))).href;
    } else if (!specifier.startsWith('node:')) {
      url = pathToFileURL(require.resolve(specifier)).href;
    }
    code = code.replace(full, `from ${quote}${url}${quote}`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  transformed.set(relativePath, url);
  return url;
}
const sha = (file) => createHash('sha256').update(readFileSync(path.join(repositoryRoot, file))).digest('hex');
const privacy = await import(await moduleUrl('src/kernel/privacy-scan.ts'));
const decide = await import(await moduleUrl('src/capabilities/requirement/decide.ts'));
const requirement = await import(await moduleUrl('src/capabilities/requirement/service.ts'));
const evidence = await import(await moduleUrl('src/governance/evidence/managed-evidence-capture-planning-service.ts'));
const fixtureModule = await import(pathToFileURL(path.join(repositoryRoot, '.build/tests/governance/evidence/managed-evidence-capture-planning-service.fixture.js')).href);
const prose = await import(pathToFileURL(path.join(repositoryRoot, '.build/tests/governance/ledger/requirement-package.fixture.js')).href);
const policy = { allowedPathRoots: ['/allowed/work', String.raw`C:\Allowed\Work`, String.raw`\\server\share\Work`], allowedIdPrefixes: privacy.DEFAULT_ALLOWED_ID_PREFIXES };
const synthetic = 'synthetic'.repeat(3);
const syntheticUuid = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const samples = [
  ['plain-credential', `PASSWORD=${synthetic}`],
  ['CSI-split-credential', `first\n\u001b[31mDATABASE_PASS\u001b[0mWORD=${synthetic}\n`],
  ['unknown-control-credential', `\u0000PASSWORD=${synthetic}`],
  ['safe-regex', String.raw`value.replace(/\s+/g, ' ')`],
  ['safe-unicode-slash-list', 'BigInt/Symbol/函数/数组/Number'],
  ['safe-https-route', 'https://host.invalid/api/orders'],
  ['allowed-file-uri', 'file:///allowed/work/readme.md'],
  ['file-uri-escape', 'file:///allowed/work/%2e%2e/private/key'],
  ['allowed-windows', 'C:/Allowed/Work/readme.md'],
  ['windows-prefix-escape', String.raw`C:\Allowed\Work-other\private.txt`],
  ['allowed-UNC', String.raw`\\server\share\Work\readme.md`],
  ['bare-uuid', syntheticUuid],
  ['known-prefix-uuid', 'demand_' + syntheticUuid],
  ['unknown-prefix-uuid', 'unknown_' + syntheticUuid],
  ['hyphen-prefix-uuid', 'custom-' + syntheticUuid],
];
const scanResults = samples.map(([label, sample]) => ({label, ...privacy.scanPrivacyText(sample, policy)}));
const duplicates = Array.from({length: 64}, (_, i) => `## custom${i}\n\na\n\n## custom${i}\n\nb\n`).join('\n');
const analysis = decide.analyzePackageDocuments('requirement', 'clean', [{role:'requirement',path:'requirement.md',text:prose.FIXTURE_REQUIREMENT_MARKDOWN+'\n'+duplicates,digest:'sha256:'+'a'.repeat(64)}]);
const assessment = decide.derivePublishAssessment({analysis,demandType:'requirement',testingDecisionMode:'controller-only',confirmedAt:null,supersedes:null,headerTexts:[{label:'testingDecision.summary',text:'PASSWORD='+synthetic}]});
const blockers = assessment.blockers;
const result = {
  kind: 'WakeflowPrivacyEvidencePostFixSyntheticProbe',
  baselineSourceVersion: '1.1.0-rc.4',
  finalSourceVersion: JSON.parse(readFileSync(path.join(repositoryRoot,'assets/release/version.json'),'utf8')).version,
  execution: 'Node current modules transformed in memory with SWC; existing .build dependencies and dedicated disposable fixture; no production edits or build',
  node: process.version,
  sourceSha256: Object.fromEntries([...currentPaths].map(f=>[f,sha(f)])),
  buildSha256: Object.fromEntries(['.build/src/kernel/privacy-scan.js','.build/src/capabilities/requirement/service.js','.build/src/governance/evidence/managed-evidence-capture-planning-service.js'].map(f=>[f,sha(f)])),
  scanResults,
  blockerTruncation: {blockerCount:blockers.length, hasPrivacyBlocker:blockers.some(x=>x.startsWith('privacy-violation:')), independentPrivacyHit:assessment.privacyHit},
};
const fixture = await fixtureModule.createManagedEvidenceCapturePlanningWorkspaceFixture();
try {
  const config = JSON.parse(readFileSync(path.join(fixture.publication.workspacePath,'wakeflow.config.json'),'utf8'));
  const surface = config.topology.supportSurfaces.find(x=>x.capability==='design');
  const window = config.topology.windows.find(x=>x.role==='design');
  writeFileSync(path.join(fixture.designRoot,'reports/overflow-requirement.md'),prose.FIXTURE_REQUIREMENT_MARKDOWN+'\n'+duplicates);
  writeFileSync(path.join(fixture.designRoot,'reports/overflow-landing.md'),prose.FIXTURE_LANDING_MARKDOWN);
  const preview = await requirement.executeRequirementPublicationRequest({root:fixture.publication.workspacePath,mode:'preview',action:'publish',package:{designSurfaceId:surface.surfaceId,originWindowId:window.windowId,title:'synthetic privacy overflow probe',demandType:'requirement',priority:'P1',testingDecision:{mode:'controller-only',summary:'PASSWORD='+synthetic},requirementPath:'reports/overflow-requirement.md',landingPath:'reports/overflow-landing.md'}});
  result.requirementPreview = {kind:preview.kind,status:preview.status,blockerCount:preview.blockers.length,hasPrivacyBlocker:preview.blockers.some(x=>x.startsWith('privacy-violation:')),summaryNull:preview.summary===null,publicSummaryContainsSynthetic:JSON.stringify(preview.summary).includes(synthetic)};
  const sourceRef = 'artifacts/test-run/logs/synthetic-probe.bin';
  const sourcePath = path.join(fixture.repositoryRoot,sourceRef);
  const service = new evidence.ManagedEvidenceCapturePlanningService(fixture.publication.workspaceRoot);
  result.evidenceClassification = [];
  for (const [label, bytes] of [['valid-utf8-control',Buffer.from('\u0000PASSWORD='+synthetic)],['invalid-utf8',Buffer.concat([Buffer.from([0xff]),Buffer.from('PASSWORD='+synthetic)])]]) {
    writeFileSync(sourcePath, bytes);
    for (const contentReview of ['reject','controller-confirmed']) {
      const preview = await service.preview(fixture.demandId,fixtureModule.fileSelection(sourceRef,contentReview),{clock:()=>fixtureModule.EVIDENCE_CAPTURED_AT});
      result.evidenceClassification.push({label,contentReview,status:preview.status,opaqueCount:preview.review.opaqueFileRefs.length,credentialCount:preview.review.credentialFindings.length,blockers:preview.status==='blocked'?preview.blockers:[]});
    }
  }
} finally { await fixtureModule.cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture); }
writeFileSync(new URL('./privacy-evidence-probe-after-fix.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({scanCount:scanResults.length,blockerTruncation:result.blockerTruncation,requirementPreview:result.requirementPreview,evidenceClassification:result.evidenceClassification},null,2));
