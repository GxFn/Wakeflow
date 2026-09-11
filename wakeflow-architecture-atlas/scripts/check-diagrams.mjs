import fs, {globSync} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {diagramBlocks, validateRenderReceipt} from './atlas-validation.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const receiptFile = path.join(root, 'plans/evidence/l1-nine-slices-render.json');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies.mermaid;
const expected = [];
for (const file of globSync('maps/**/*.md', {cwd: root}).sort()) {
  for (const block of diagramBlocks(fs.readFileSync(path.join(root, file), 'utf8'))) {
    expected.push({file, diagram: block.index, sourceDigest: 'sha256:' + crypto.createHash('sha256').update(block.source).digest('hex')});
  }
}
let receipt;
try {receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));} catch {}
const errors = validateRenderReceipt(receipt, expected, version);
const result = {ok: errors.length === 0, mode: 'verified-browser-receipt', rendererVersion: version, verifiedAt: receipt?.verifiedAt ?? null, diagrams: expected.length, errors};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (errors.length) process.exitCode = 1;
