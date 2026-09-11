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
export function validateReferences(raw, repositoryRoot, modules) {
  const errors = []; let symbols = 0;
  for (const m of raw.matchAll(/`((?:src|tests|tooling|docs)\/[A-Za-z0-9_./*-]+\.(?:ts|json|md))(?:#([A-Za-z_$][A-Za-z0-9_.$]*))?`/gu)) {
    const [_, file, symbol] = m;
    const matches = globSync(file, {cwd: repositoryRoot});
    if (!matches.length) {errors.push('missing reference ' + file);continue;}
    if (symbol) {symbols++; if (!modules.get(file)?.symbols.has(symbol)) errors.push('missing symbol ' + file + '#' + symbol);}
  }
  return {symbols, errors};
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
