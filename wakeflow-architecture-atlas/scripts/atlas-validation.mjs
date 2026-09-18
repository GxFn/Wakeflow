import crypto from 'node:crypto';
import fs, {globSync} from 'node:fs';
import path from 'node:path';
import {parseSync} from '@swc/core';
import {parse as parseYaml} from 'yaml';

export const truthKinds = new Set(['current-code', 'in-progress-worktree', 'stale', 'historical', 'target-design']);
export function parseSource(source, filename) {
  const ast = parseSync(source, {syntax: 'typescript', tsx: filename.endsWith('.tsx'), target: 'es2022'});
  const imports = new Set();
  const symbols = new Set();
  function visit(node, owner = '') {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const item of node) visit(item, owner); return; }
    if (['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration'].includes(node.type) && node.source) imports.add(node.source.value);
    const id = node.identifier?.value ?? node.id?.value;
    if (['FunctionDeclaration', 'ClassDeclaration', 'TsInterfaceDeclaration', 'TsTypeAliasDeclaration', 'TsEnumDeclaration'].includes(node.type) && id) symbols.add(id);
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') symbols.add(node.id.value);
    if (['ClassDeclaration', 'ClassExpression'].includes(node.type)) owner = id ?? owner;
    if (['ClassMethod', 'PrivateMethod'].includes(node.type) && node.key?.value) {
      symbols.add(node.key.value);
      if (owner) symbols.add(owner + '.' + node.key.value);
    }
    for (const [key, value] of Object.entries(node)) if (key !== 'span') visit(value, owner);
  }
  visit(ast);
  return {imports: [...imports].sort(), symbols};
}
/** Identifiers a file really uses: imports, calls, types and `Owner.method` pairs. Comments are not in the AST, so a symbol that only appears in prose does not count as coverage. */
export function referencedSymbols(source, filename) {
  const ast = parseSync(source, {syntax: 'typescript', tsx: filename.endsWith('.tsx'), target: 'es2022'});
  const symbols = new Set();
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const item of node) visit(item); return; }
    if (node.type === 'Identifier' && typeof node.value === 'string') symbols.add(node.value);
    for (const [left, right] of [[node.object, node.property], [node.left, node.right]]) {
      if (left?.type === 'Identifier' && right?.type === 'Identifier') symbols.add(left.value + '.' + right.value);
    }
    for (const [key, value] of Object.entries(node)) if (key !== 'span') visit(value);
  }
  visit(ast);
  return symbols;
}
/** Test files are indexed by used identifiers, not declarations: a test backs a symbol by exercising it. */
export function testIndex(repositoryRoot) {
  const modules = new Map();
  for (const file of globSync('tests/**/*.ts', {cwd: repositoryRoot}).sort()) {
    modules.set(file, {imports: new Set(), symbols: referencedSymbols(fs.readFileSync(path.join(repositoryRoot, file), 'utf8'), file)});
  }
  return modules;
}
export function sourceIndex(repositoryRoot) {
  const files = globSync('src/**/*.ts', {cwd: repositoryRoot}).sort();
  const set = new Set(files);
  const modules = new Map();
  for (const file of files) {
    const parsed = parseSource(fs.readFileSync(path.join(repositoryRoot, file), 'utf8'), file);
    const imports = parsed.imports.filter(s => s.startsWith('.')).map(s => path.posix.normalize(path.posix.join(path.posix.dirname(file), s)).replace(/\.(?:c|m)?js$/, '.ts')).filter(f => set.has(f));
    modules.set(file, {imports: new Set(imports), symbols: parsed.symbols});
  }
  return modules;
}
export function documentParts(raw) {
  if (!raw.startsWith('---\n')) return {metadata: {}, body: raw};
  const end = raw.indexOf('\n---\n', 4);
  if (end < 0) throw new Error('unterminated frontmatter');
  const metadata = parseYaml(raw.slice(4, end));
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('invalid frontmatter');
  return {metadata, body: raw.slice(end + 5)};
}
export function fingerprintInputs(metadata, repositoryRoot) {
  const patterns = [...(metadata.sourcePaths ?? []), ...(metadata.schemaPaths ?? []), ...(metadata.testPaths ?? []), ...(metadata.refreshTriggers ?? [])];
  const missing = []; const found = new Set();
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || path.isAbsolute(pattern) || pattern.split('/').includes('..')) { missing.push(String(pattern)); continue; }
    const matches = globSync(pattern, {cwd: repositoryRoot}).filter(f => fs.statSync(path.join(repositoryRoot, f)).isFile());
    if (!matches.length) missing.push(pattern);
    for (const file of matches) found.add(file);
  }
  const files = [...found].sort(); const hash = crypto.createHash('sha256');
  for (const file of files) {hash.update(file); hash.update('\0'); hash.update(fs.readFileSync(path.join(repositoryRoot, file))); hash.update('\0');}
  return {files, missing, digest: 'sha256:' + hash.digest('hex')};
}
export function diagramBlocks(body) {
  const found = [...body.matchAll(/```mermaid\n([\s\S]*?)```/gu)];
  return found.map((m, i) => ({source: m[1], after: body.slice(m.index + m[0].length, found[i+1]?.index ?? body.length), title: m[1].match(/accTitle:\s*([^\n]+)/u)?.[1] ?? '', index: i+1}));
}
export function validateEdges(block) {
  const errors = [];
  const edgeLines = block.source.split('\n').filter(line => /^\s*(?:[A-Za-z][\w]*|\[\*\])\s*(?:--?>[>]?|-->>|==>|-\.->)/u.test(line));
  const ids = [];
  for (const line of edgeLines) {
    const matches = [...line.matchAll(/\bE-[A-Z0-9]+-\d{2}\b/gu)];
    if (matches.length !== 1) errors.push('edge must have one numeric evidence id: ' + line.trim());
    else ids.push(matches[0][0]);
  }
  if (new Set(ids).size !== ids.length) errors.push('duplicate edge id');
  for (const id of ids) {
    const rows = block.after.split('\n').filter(line => new RegExp('^\\|\\s*`?' + id + '`?\\s*\\|').test(line));
    if (rows.length !== 1) errors.push(id + ': expected exactly one adjacent evidence row');
  }
  if (!/^\s*### 本图术语说明/u.test(block.after)) errors.push('terminology must immediately follow diagram');
  if (!/accTitle:.*[\u4e00-\u9fff]/u.test(block.source) || !/accDescr:.*[\u4e00-\u9fff]/u.test(block.source)) errors.push('Chinese accTitle/accDescr required');
  return {ids, errors};
}
export function dependencyNodes(body) {
  const nodes = new Map();
  for (const m of body.matchAll(/^\|\s*([A-Za-z][A-Za-z0-9_]*)\s*\|\s*`(src\/[^`#]+\.ts)(?:#[^`]+)?`\s*\|/gmu)) nodes.set(m[1], m[2]);
  return nodes;
}
export function validateImports(body, modules) {
  const nodes = dependencyNodes(body); const errors = []; let count = 0;
  for (const [id, file] of nodes) if (!modules.has(file)) errors.push(id + ': missing source ' + file);
  for (const block of diagramBlocks(body)) for (const m of block.source.matchAll(/^\s*([A-Za-z][\w]*)\s*-->\|"([^"]+)"\|\s*([A-Za-z][\w]*)\s*$/gmu)) {
    const from = nodes.get(m[1]); const to = nodes.get(m[3]);
    if (!from || !to) {errors.push(m[2] + ': unresolved file node'); continue;}
    count++;
    if (!modules.get(from)?.imports.has(to)) errors.push(m[2] + ': absent import ' + from + ' -> ' + to);
  }
  return {count, errors};
}
/** Source and test anchors are checked the same way: the file must exist and must really carry the symbol. */
export function validateReferences(raw, repositoryRoot, modules, tests = new Map()) {
  const errors = []; let symbols = 0, testSymbols = 0;
  for (const m of raw.matchAll(/`((?:src|tests|tooling|docs)\/[A-Za-z0-9_./*-]+\.(?:ts|json|md))(?:#([A-Za-z_$][A-Za-z0-9_.$]*))?`/gu)) {
    const [_, file, symbol] = m;
    const matches = globSync(file, {cwd: repositoryRoot});
    if (!matches.length) {errors.push('missing reference ' + file);continue;}
    if (!symbol) continue;
    const isTest = file.startsWith('tests/');
    symbols++; if (isTest) testSymbols++;
    if (!(isTest ? tests : modules).get(file)?.symbols.has(symbol)) errors.push('missing symbol ' + file + '#' + symbol);
  }
  return {symbols, testSymbols, errors};
}
export const evidenceCoverageMarkers = new Set(['未覆盖', '间接覆盖']);
/** Reads every `| 编号 | … | 测试 … |` table, keyed on the header cell, so four- and six-column evidence tables both resolve the right column. */
export function evidenceTestCells(body) {
  const cells = []; let testColumn = -1, idColumn = -1;
  for (const line of body.split('\n')) {
    const row = line.trim();
    if (!row.startsWith('|') || !row.endsWith('|')) {testColumn = -1; idColumn = -1; continue;}
    const values = row.slice(1, -1).split('|').map(value => value.trim());
    if (values.every(value => /^:?-{3,}:?$/u.test(value))) continue;
    const header = values.findIndex(value => /测试/u.test(value));
    if (header >= 0 && values.some(value => /编号/u.test(value))) {
      testColumn = header; idColumn = values.findIndex(value => /编号/u.test(value)); continue;
    }
    if (testColumn < 0 || idColumn < 0) continue;
    const id = values[idColumn]?.replace(/`/gu, '');
    if (id && /^E-[A-Z0-9]+-\d{2}$/u.test(id)) cells.push({id, cell: values[testColumn] ?? ''});
  }
  return cells;
}
export function classifyTestEvidence(cell) {
  const text = cell.trim();
  const anchors = [...text.matchAll(/`(tests\/[A-Za-z0-9_./-]+\.ts)#([A-Za-z_$][A-Za-z0-9_.$]*)`/gu)].map(m => m[1] + '#' + m[2]);
  const bare = [...text.matchAll(/`(tests\/[A-Za-z0-9_./-]+\.ts)`/gu)].map(m => m[1]);
  const marked = /^(未覆盖|间接覆盖)[：:]\s*(.*)$/su.exec(text);
  // A citation is not a reason: the prose left after removing every code span has to say something.
  const reason = (marked?.[2] ?? '').replace(/`[^`]*`/gu, '').replace(/[\s（）()，,。、；;：:]/gu, '');
  return {anchors, bare, marker: marked?.[1] ?? null, reason};
}
/** In a document that declares `testEvidence: anchored`, a row either anchors a real test symbol or says plainly that it is indirect or uncovered. */
export function validateTestEvidence(body, strict) {
  const errors = []; const counts = {rows: 0, anchored: 0, marked: 0, unanchored: 0};
  for (const {id, cell} of evidenceTestCells(body)) {
    const {anchors, bare, marker, reason} = classifyTestEvidence(cell);
    counts.rows++;
    if (marker) counts.marked++; else if (anchors.length) counts.anchored++; else counts.unanchored++;
    if (!strict) continue;
    if (marker === '未覆盖') {
      if (anchors.length || bare.length) errors.push(id + ': 未覆盖 row must not cite a test file');
      if (reason.length < 4) errors.push(id + ': 未覆盖 row needs a reason');
      continue;
    }
    if (bare.length) errors.push(id + ': test cited without a #symbol anchor: ' + bare.join(', '));
    if (!anchors.length) errors.push(id + ': test column needs an anchored test symbol or a 未覆盖/间接覆盖 marker');
    if (marker === '间接覆盖' && reason.length < 4) errors.push(id + ': 间接覆盖 row needs a reason');
  }
  return {counts, errors};
}
export function validateLinks(raw, directory) {
  const errors = []; let count = 0;
  for (const m of raw.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    const target = m[1].split('#')[0]; if (!target || /^[a-z]+:/iu.test(target)) continue;
    count++; if (!fs.existsSync(path.resolve(directory, target))) errors.push('missing link ' + target);
  }
  return {count, errors};
}

/** Verifies a receipt captured from the local browser page; never manufactures render results. */
export function validateRenderReceipt(receipt, expected, version) {
  const errors = [];
  if (!receipt || receipt.renderer !== 'mermaid' || receipt.rendererVersion !== version || receipt.ok !== true || !Array.isArray(receipt.results) || !Number.isFinite(Date.parse(receipt.verifiedAt))) {
    return ['invalid renderer receipt or version'];
  }
  if (!expected.length) errors.push('empty diagram coverage');
  for (const item of expected) {
    const matches = receipt.results.filter(r => r.file === item.file && r.diagram === item.diagram);
    if (matches.length !== 1 || matches[0].status !== 'pass' || matches[0].sourceDigest !== item.sourceDigest || !Number.isFinite(matches[0].width) || !Number.isFinite(matches[0].height) || matches[0].width <= 0 || matches[0].height <= 0) {
      errors.push(item.file + '#' + item.diagram + ': re-render required');
    }
  }
  if (receipt.results.length !== expected.length || receipt.diagrams !== expected.length || receipt.rendered !== expected.length) errors.push('browser receipt coverage differs');
  return errors;
}
