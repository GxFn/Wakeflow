import DOMPurify from "dompurify";
import {marked} from "marked";
import mermaid from "mermaid";
import {parse as parseYaml} from "yaml";

import type {
  DependencyExplorerHandle,
  DependencyExplorerSelection,
} from "./dependency-explorer";
import "./styles.css";
import {statusLabel, statusClass, fileNodePaths, GROUP_LABELS, type TruthKind} from "./document-state";

interface FlowFrontmatter {
  readonly diagramId?: string;
  readonly viewType?: string;
  readonly truthKind?: TruthKind;
  readonly reviewDepth?: string;
  readonly verifiedAt?: string;
  readonly snapshotObservedAt?: string;
  readonly baselineCommit?: string;
  readonly sourceFingerprint?: string;
  readonly audience?: readonly string[];
}

interface FlowDocument {
  readonly id: string;
  readonly relativePath: string;
  readonly title: string;
  readonly body: string;
  readonly frontmatter: FlowFrontmatter;
  readonly group: string;
  readonly searchText: string;
}

interface ParsedDocument {
  readonly body: string;
  readonly frontmatter: FlowFrontmatter;
}

interface DiagramTransform {
  scale: number;
  x: number;
  y: number;
}

interface DragState {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startX: number;
  readonly startY: number;
}

interface DiagramEvidenceBinding {
  readonly element: Element;
  readonly textNode: Text;
  readonly fullText: string;
  readonly compactText: string;
  readonly token: string;
}

type DiagramFitMode = "read" | "all" | "actual";

const rawModules = {
  ...import.meta.glob("../maps/**/*.md", {eager: true, import: "default", query: "?raw"}),
  ...import.meta.glob("../plans/*.md", {eager: true, import: "default", query: "?raw"}),
} as Record<string, string>;
const evidenceAssets = import.meta.glob("../plans/evidence/*.json", {
  eager: true, import: "default", query: "?url",
}) as Record<string, string>;

const article = requiredElement<HTMLElement>("article");
const mainContent = requiredElement<HTMLElement>("main-content");
const navigation = requiredElement<HTMLElement>("doc-navigation");
const sidebar = requiredElement<HTMLElement>("sidebar");
const menuToggle = requiredElement<HTMLButtonElement>("menu-toggle");
const themeToggle = requiredElement<HTMLButtonElement>("theme-toggle");
const searchInput = requiredElement<HTMLInputElement>("doc-search");
const searchResults = requiredElement<HTMLElement>("search-results");
const metadataPanel = requiredElement<HTMLElement>("metadata-panel");
const tableOfContents = requiredElement<HTMLElement>("table-of-contents");
const selectionKind = requiredElement<HTMLElement>("selection-kind");
const selectionText = requiredElement<HTMLElement>("selection-text");
const locateEvidenceButton = requiredElement<HTMLButtonElement>("locate-evidence");

const documents = Object.entries(rawModules)
  .map(([modulePath, raw]) => createDocument(modulePath, raw))
  .sort(compareDocuments);
const documentById = new Map(documents.map((document) => [document.id, document]));

let currentDocument: FlowDocument | null = null;
let selectedEvidenceToken: string | null = null;
let renderGeneration = 0;
let articleLinksBound = false;
let activeDependencyExplorer: DependencyExplorerHandle | null = null;

marked.setOptions({gfm: true, breaks: false});

function requiredElement<ElementType extends HTMLElement>(id: string): ElementType {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing required element #${id}.`);
  return element as ElementType;
}

function parseDocument(raw: string): ParsedDocument {
  if (!raw.startsWith("---\n")) return {body: raw, frontmatter: {}};
  const closing = raw.indexOf("\n---\n", 4);
  if (closing < 0) return {body: raw, frontmatter: {}};
  const frontmatterValue = parseYaml(raw.slice(4, closing));
  const frontmatter =
    typeof frontmatterValue === "object" && frontmatterValue !== null
      ? frontmatterValue as FlowFrontmatter
      : {};
  return {
    frontmatter,
    body: raw.slice(closing + 5),
  };
}

function createDocument(modulePath: string, raw: string): FlowDocument {
  const marker = modulePath.includes("/plans/") ? "/plans/" : "/maps/";
  const markerIndex = modulePath.lastIndexOf(marker);
  if (markerIndex < 0) throw new Error(`Unexpected documentation path: ${modulePath}`);
  const relativePath = (marker === "/plans/" ? "plans/" : "") + modulePath.slice(markerIndex + marker.length);
  const id = relativePath.replace(/\.md$/u, "");
  const parsed = parseDocument(raw);
  const title = parsed.body.match(/^#\s+(.+)$/mu)?.[1]?.trim() ?? id;
  const group = id.includes("/") ? id.split("/")[0] ?? "其他" : "根目录";
  return {
    id,
    relativePath,
    title,
    body: parsed.body,
    frontmatter: parsed.frontmatter,
    group,
    searchText: `${title}\n${parsed.body}`.toLocaleLowerCase("zh-CN"),
  };
}

function compareDocuments(left: FlowDocument, right: FlowDocument): number {
  const rank = (document: FlowDocument) => {
    if (document.id === "README") return 0;
    if (document.id.startsWith("00-")) return 1;
    return 2;
  };
  return rank(left) - rank(right)
    || left.id.localeCompare(right.id, "zh-CN", {numeric: true});
}

function documentRoute(id: string): string {
  return `#/doc/${id}`;
}

function renderNavigation(): void {
  navigation.replaceChildren();
  const home = document.createElement("a");
  home.href = "#/home";
  home.className = "navigation-home";
  home.textContent = "阅读入口";
  navigation.append(home);

  const groups = new Map<string, FlowDocument[]>();
  for (const item of documents) {
    const group = groups.get(item.group) ?? [];
    group.push(item);
    groups.set(item.group, group);
  }

  for (const [groupName, groupDocuments] of groups) {
    const section = document.createElement("section");
    section.className = "navigation-group";
    const heading = document.createElement("h2");
    heading.textContent = GROUP_LABELS[groupName] ?? groupName;
    section.append(heading);
    for (const item of groupDocuments) {
      const link = document.createElement("a");
      link.href = documentRoute(item.id);
      link.dataset.documentId = item.id;
      link.className = "navigation-item";
      const title = document.createElement("span");
      title.textContent = item.title;
      const status = document.createElement("span");
      status.className = `status-mark ${statusClass(item.frontmatter.truthKind)}`;
      status.textContent = statusLabel(item.frontmatter.truthKind);
      link.append(title, status);
      section.append(link);
    }
    navigation.append(section);
  }
}

function setActiveNavigation(id: string | null): void {
  for (const link of navigation.querySelectorAll<HTMLElement>("[data-document-id]")) {
    link.classList.toggle("active", link.dataset.documentId === id);
  }
}

function initializeTheme(): void {
  const saved = localStorage.getItem("flow-atlas-theme");
  const preferred = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  setTheme(saved === "dark" || saved === "light" ? saved : preferred, false);
}

function setTheme(theme: "light" | "dark", rerender = true): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("flow-atlas-theme", theme);
  themeToggle.textContent = theme === "dark" ? "☀" : "◐";
  themeToggle.setAttribute("aria-label", theme === "dark" ? "切换到浅色主题" : "切换到深色主题");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: theme === "dark" ? "neo-dark" : "neo",
    look: "neo",
    htmlLabels: false,
    maxTextSize: 100000,
    elk: {
      mergeEdges: false,
      nodePlacementStrategy: "BRANDES_KOEPF",
      nodePlacementAlignment: "BALANCED",
      cycleBreakingStrategy: "GREEDY_MODEL_ORDER",
      considerModelOrder: "PREFER_NODES",
      keepEntryNodeOnTop: true,
    },
    flowchart: {
      curve: "linear",
      defaultRenderer: "elk",
      inheritDir: false,
      nodeSpacing: 64,
      rankSpacing: 96,
      padding: 20,
      wrappingWidth: 260,
    },
    sequence: {
      actorMargin: 80,
      boxMargin: 14,
      boxTextMargin: 8,
      diagramMarginX: 36,
      diagramMarginY: 28,
      hideUnusedParticipants: true,
      messageAlign: "left",
      messageMargin: 42,
      mirrorActors: false,
      noteMargin: 14,
      rightAngles: true,
      wrap: true,
      wrapPadding: 12,
    },
  });
  if (rerender) void renderRoute();
}

function renderHome(): void {
  destroyDependencyExplorer();
  currentDocument = null;
  setActiveNavigation(null);
  metadataPanel.replaceChildren();
  tableOfContents.replaceChildren();
  resetSelection();
  article.innerHTML = DOMPurify.sanitize(`
    <section class="home-intro">
      <p class="eyebrow">本地可重建阅读层</p>
      <h1>Wakeflow TypeScript 流程图集</h1>
      <p class="home-lead">从总体架构下钻到文件、符号、状态与证据。Markdown和Mermaid是唯一文档正典；本页面只负责导航、缩放与阅读。</p>
      <div class="home-notice" role="note">核验基线 ${documentById.get("01-overall-architecture/README")?.frontmatter.baselineCommit?.slice(0, 7) ?? "未记录"}。各页标签表示其来源快照；observation、真实宿主联合和新制品切换仍是后续范围。</div>
    </section>
    <section class="home-grid" aria-label="流程图入口">
      ${homeCard("业务主线", "从需求包到归档、继续与 Pod 关闭。", "10-end-to-end-business-flow/README")}
      ${homeCard("总体架构", "六层职责、九个切片及尚未接通的 observation。", "01-overall-architecture/README")}
      ${homeCard("公共 MCP 调用", "登记表、固定宿主装配与真实能力执行器。", "01-overall-architecture/runtime-call-flow")}
      ${homeCard("核验快照", "代码、场景、图谱和未运行验证各有范围。", "01-overall-architecture/review-evidence")}
      ${homeCard("需求包与看板", "确认摘要、不可变记录、认领状态与恢复。", "13-requirement/README")}
      ${homeCard("配置与工作区", "Config、资源矩阵与维护事务。", "03-configuration-workspace/README")}
      ${homeCard("执行端点", "宿主观察、绑定代际和 worktree 回执。", "12-endpoint/README")}
      ${homeCard("任务规划", "锚点、谱系、用户审阅门和测试合同。", "05-tasking-slice/README")}
      ${homeCard("投递与回调", "许可、围栏、落地证据和固定 Controller 回调。", "06-implementation-delivery-review/README")}
      ${homeCard("评审与归档", "独立检查、升级、完成即归档和继续。", "07-review-rework-completion/README")}
      ${homeCard("测试合同", "逐步记录、失败分类和基线对比。", "08-real-environment-testing/README")}
      ${homeCard("受管证据", "文件、观察、链接、提交和不可变发布。", "14-evidence/README")}
      ${homeCard("Pod 执行环境", "完整窗口组、worktree 准入和两段关闭。", "15-pod/README")}
      ${homeCard("应用内核", "调用形状、工作声明、观察和共享边界。", "11-kernel/README")}
      ${homeCard("事件流", "提交批、快照加尾部和首次发布。", "04-governance-event-sourcing/README")}
      ${homeCard("基础原语", "根约束、稳定读取、原子写入和恢复。", "02-foundation/README")}
      ${homeCard("文件依赖", "完整路径区分同名文件；导入不等于运行调用。", "01-overall-architecture/file-dependencies")}
    </section>
    <section class="home-steps">
      <h2>阅读方式</h2>
      <ol>
        <li>先看总体架构，确认边界与当前停止点。</li>
        <li>进入文件依赖图，核对静态导入和折叠闭包。</li>
        <li>切换到符号调用时序，确认真实调用和副作用边界。</li>
        <li>最后查看边级证据、测试与待复核状态。</li>
      </ol>
    </section>
  `, {USE_PROFILES: {html: true}});
  article.querySelectorAll<HTMLElement>("[data-home-document]").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.dataset.homeDocument;
      if (id !== undefined) location.hash = documentRoute(id);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      card.click();
    });
  });
  mainContent.focus({preventScroll: true});
  window.scrollTo({top: 0, behavior: "instant"});
}

function homeCard(title: string, description: string, id: string): string {
  const truth = documentById.get(id)?.frontmatter.truthKind;
  return `
    <article class="home-card" role="link" tabindex="0" data-home-document="${id}">
      <div class="home-card-heading"><h2>${title}</h2><span class="status-mark ${statusClass(truth)}">${statusLabel(truth)}</span></div>
      <p>${description}</p>
      <strong>打开图与证据 →</strong>
    </article>
  `;
}

async function renderDocument(item: FlowDocument): Promise<void> {
  const resetScroll = currentDocument?.id !== item.id;
  const previousScroll = window.scrollY;
  destroyDependencyExplorer();
  currentDocument = item;
  setActiveNavigation(item.id);
  resetSelection();
  const generation = ++renderGeneration;
  const rendered = await marked.parse(item.body);
  if (generation !== renderGeneration) return;
  article.innerHTML = DOMPurify.sanitize(rendered, {USE_PROFILES: {html: true}});
  if (item.id === "01-overall-architecture/review-evidence" && item.frontmatter.viewType === "evidence") {
    const {mountReviewDashboard} = await import("./review-dashboard");
    if (generation !== renderGeneration) return;
    mountReviewDashboard(article, {
      truthKind: item.frontmatter.truthKind,
      verifiedAt: item.frontmatter.verifiedAt,
      snapshotObservedAt: item.frontmatter.snapshotObservedAt,
    });
  }
  assignHeadingIds();
  renderMetadata(item);
  renderTableOfContents();
  rewriteArticleLinks(item);
  bindArticleLinks();
  await renderMermaidDiagrams(generation);
  mainContent.focus({preventScroll: true});
  window.scrollTo({top: resetScroll ? 0 : previousScroll, behavior: "instant"});
  closeMobileSidebar();
}

function renderMetadata(item: FlowDocument): void {
  metadataPanel.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = "核验状态";
  const status = document.createElement("span");
  status.className = `metadata-status ${statusClass(item.frontmatter.truthKind)}`;
  status.textContent = statusLabel(item.frontmatter.truthKind);
  const list = document.createElement("dl");
  const values: readonly [string, string | undefined][] = [
    ["深度", item.frontmatter.reviewDepth],
    ["核验日期", item.frontmatter.verifiedAt],
    ["提交", item.frontmatter.baselineCommit?.slice(0, 12)],
    ["来源指纹", item.frontmatter.sourceFingerprint?.replace(/^sha256:/u, "").slice(0, 12)],
  ];
  for (const [label, value] of values) {
    if (value === undefined) continue;
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    list.append(term, description);
  }
  metadataPanel.append(heading, status, list);
}

function slugify(value: string): string {
  const normalized = value
    .normalize("NFC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .trim()
    .replace(/[\s-]+/gu, "-");
  return normalized.length > 0 ? normalized : "section";
}

function assignHeadingIds(): void {
  const used = new Map<string, number>();
  for (const heading of article.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4")) {
    const base = slugify(heading.textContent ?? "section");
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    heading.id = count === 0 ? base : `${base}-${count + 1}`;
  }
}

function renderTableOfContents(): void {
  tableOfContents.replaceChildren();
  for (const heading of article.querySelectorAll<HTMLHeadingElement>("h2, h3, h4")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `toc-level-${heading.tagName.slice(1)}`;
    button.textContent = heading.textContent;
    button.addEventListener("click", () => heading.scrollIntoView({behavior: "smooth", block: "start"}));
    tableOfContents.append(button);
  }
}

function rewriteArticleLinks(item: FlowDocument): void {
  for (const anchor of article.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = anchor.getAttribute("href") ?? "";
    if (/^[a-z]+:/iu.test(href) || href.startsWith("#")) continue;
    const [file, fragment] = href.split("#", 2);
    if (file?.endsWith(".md")) {
      const id = resolveDocumentLink(item.id, file);
      if (id !== null) anchor.href = documentRoute(id) + (fragment ? `?anchor=${encodeURIComponent(fragment)}` : "");
    } else if (file?.endsWith(".json")) {
      const base = item.id.startsWith("plans/") ? `/${item.id}` : `/maps/${item.id}`;
      const resolved = new URL(file, `http://atlas.invalid${base}`).pathname;
      const asset = evidenceAssets[`..${resolved}`];
      if (asset) anchor.href = asset;
    }
  }
}

function bindArticleLinks(): void {
  if (articleLinksBound) return;
  articleLinksBound = true;
  article.addEventListener("click", (event) => {
    const item = currentDocument;
    if (item === null) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (anchor === null) return;
    const href = anchor.getAttribute("href");
    if (href === null) return;
    if (href.startsWith("#/")) return;
    if (href.startsWith("#")) {
      event.preventDefault();
      document.getElementById(href.slice(1))?.scrollIntoView({behavior: "smooth"});
      return;
    }
    if (!href.endsWith(".md") && !href.includes(".md#")) return;
    const [pathPart, anchorPart] = href.split("#", 2);
    const resolved = resolveDocumentLink(item.id, pathPart ?? "");
    if (resolved !== null) {
      event.preventDefault();
      location.hash = documentRoute(resolved);
      if (anchorPart !== undefined) {
        setTimeout(() => document.getElementById(anchorPart)?.scrollIntoView(), 0);
      }
    }
  });
}

function resolveDocumentLink(currentId: string, href: string): string | null {
  const base = (currentId.startsWith("plans/") ? currentId : `maps/${currentId}`).split("/");
  base.pop();
  for (const segment of href.replace(/\.md$/u, "").split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") base.pop();
    else base.push(segment);
  }
  const physicalPath = base.join("/");
  const id = physicalPath.startsWith("maps/") ? physicalPath.slice(5)
    : physicalPath.startsWith("plans/") ? physicalPath : null;
  return id !== null && documentById.has(id) ? id : null;
}

async function renderMermaidDiagrams(generation: number): Promise<void> {
  const blocks = [...article.querySelectorAll<HTMLElement>("pre > code.language-mermaid")];
  for (const [index, block] of blocks.entries()) {
    if (generation !== renderGeneration) return;
    const source = block.textContent ?? "";
    const pre = block.parentElement;
    if (pre === null) continue;
    if (currentDocument?.frontmatter.viewType === "file-dependency") {
      const host = document.createElement("section");
      pre.replaceWith(host);
      try {
        const {mountDependencyExplorer} = await import("./dependency-explorer");
        const handle = await mountDependencyExplorer(host, {
          source,
          filePaths: fileNodePaths(currentDocument?.body ?? ""),
          theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
          onSelection: setDependencySelection,
          onLocateEvidence: (token) => {
            selectedEvidenceToken = token;
            locateEvidence();
          },
        });
        if (generation !== renderGeneration) {
          handle.destroy();
          return;
        }
        activeDependencyExplorer = handle;
        continue;
      } catch {
        host.replaceWith(pre);
      }
    }
    const shell = createDiagramShell(source);
    pre.replaceWith(shell.root);
    try {
      const result = await mermaid.render(`flow-atlas-${generation}-${index}`, source);
      shell.canvas.innerHTML = result.svg;
      decorateDiagramSemantics(shell.canvas, source);
      bindEvidenceVisibility(shell);
      bindDiagramSelection(shell.canvas);
      shell.fit("read");
    } catch {
      shell.canvas.textContent = "流程图渲染失败。请在Markdown源文件中检查Mermaid语法。";
      shell.canvas.classList.add("diagram-error");
    }
  }
}

function destroyDependencyExplorer(): void {
  activeDependencyExplorer?.destroy();
  activeDependencyExplorer = null;
}

function setDependencySelection(selection: DependencyExplorerSelection | null): void {
  if (selection === null) {
    resetSelection();
    return;
  }
  selectionKind.textContent = selection.kind;
  selectionText.textContent = `${selection.title} · ${selection.summary}`;
  selectedEvidenceToken = selection.evidenceToken ?? null;
  locateEvidenceButton.disabled = selectedEvidenceToken === null;
}

function createDiagramShell(source: string): {
  readonly root: HTMLElement;
  readonly canvas: HTMLElement;
  readonly controls: HTMLElement;
  readonly evidenceCount: number;
  readonly fit: (mode: DiagramFitMode) => void;
} {
  const root = document.createElement("section");
  const kind = diagramKind(source);
  const flowDirection = source.match(/^\s*flowchart\s+(TB|TD|BT|LR|RL)\b/mu)?.[1] ?? null;
  const entryNodeId = kind === "flow" ? firstFlowchartNodeId(source) : null;
  const evidenceCount = source.match(/\bE-[A-Z0-9]+-[0-9]{2}\b/gu)?.length ?? 0;
  root.className = `diagram-shell diagram-kind-${kind}`;
  if (evidenceCount >= 16) root.classList.add("diagram-dense");
  const toolbar = document.createElement("div");
  toolbar.className = "diagram-toolbar";
  const instructions = document.createElement("span");
  instructions.textContent = `${diagramKindLabel(kind)} · ${evidenceCount} 条证据关系 · 点击节点或边查看详情`;
  const controls = document.createElement("div");
  controls.className = "diagram-controls";
  const viewport = document.createElement("div");
  viewport.className = "diagram-viewport";
  viewport.setAttribute("role", "region");
  viewport.setAttribute("aria-label", "可缩放和拖动的流程图画布");
  const canvas = document.createElement("div");
  canvas.className = "diagram-canvas";
  viewport.append(canvas);
  toolbar.append(instructions, controls);
  root.append(toolbar, viewport);

  const transform: DiagramTransform = {scale: 1, x: 0, y: 0};
  let drag: DragState | null = null;
  const applyTransform = () => {
    canvas.style.transform = `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`;
  };
  const fit = (mode: DiagramFitMode) => {
    const svg = canvas.querySelector<SVGSVGElement>("svg");
    if (svg === null) return;
    const viewBox = svg.viewBox.baseVal;
    const diagramWidth = Math.max(1, viewBox.width);
    const diagramHeight = Math.max(1, viewBox.height);
    const canvasPadding = 56;
    svg.style.width = `${diagramWidth}px`;
    svg.style.height = `${diagramHeight}px`;
    canvas.style.width = `${diagramWidth + canvasPadding}px`;
    canvas.style.minHeight = `${diagramHeight + canvasPadding}px`;
    const availableWidth = Math.max(1, viewport.clientWidth - 40);
    const availableHeight = Math.max(1, viewport.clientHeight - 40);
    const fullScale = Math.min(1, availableWidth / (diagramWidth + canvasPadding), availableHeight / (diagramHeight + canvasPadding));
    const widthScale = Math.min(1, availableWidth / (diagramWidth + canvasPadding));
    transform.scale = mode === "actual"
      ? 1
      : mode === "all"
        ? Math.max(0.12, fullScale)
        : Math.max(0.8, widthScale);
    const centeredX = (viewport.clientWidth - (diagramWidth + canvasPadding) * transform.scale) / 2;
    const centeredY = (viewport.clientHeight - (diagramHeight + canvasPadding) * transform.scale) / 2;
    const entryNode = entryNodeId === null
      ? null
      : canvas.querySelector<SVGGraphicsElement>(`[id*="flowchart-${entryNodeId}-"]`);
    const entryBox = entryNode?.getBBox();
    const entryMatrix = entryNode?.transform.baseVal.consolidate()?.matrix;
    if (mode === "read" && entryBox !== undefined && entryMatrix !== undefined) {
      const entryX = entryMatrix.e + entryBox.x;
      const entryY = entryMatrix.f + entryBox.y;
      if (flowDirection === "LR" || flowDirection === "RL") {
        transform.x = 24 - (28 + entryX) * transform.scale;
        transform.y = viewport.clientHeight / 2 - (28 + entryY + entryBox.height / 2) * transform.scale;
      } else {
        transform.x = viewport.clientWidth / 2 - (28 + entryX + entryBox.width / 2) * transform.scale;
        transform.y = 24 - (28 + entryY) * transform.scale;
      }
    } else {
      transform.x = mode === "read"
        ? kind === "sequence" ? 20 : Math.min(20, centeredX)
        : Math.max(20, centeredX);
      transform.y = mode === "read" ? 20 : Math.max(20, centeredY);
    }
    applyTransform();
  };
  const zoomAt = (factor: number, pointX = viewport.clientWidth / 2, pointY = viewport.clientHeight / 2) => {
    const scale = Math.min(5, Math.max(0.35, transform.scale * factor));
    const ratio = scale / transform.scale;
    transform.x = pointX - (pointX - transform.x) * ratio;
    transform.y = pointY - (pointY - transform.y) * ratio;
    transform.scale = scale;
    applyTransform();
  };
  controls.append(
    diagramButton("放大", () => zoomAt(1.2)),
    diagramButton("缩小", () => zoomAt(1 / 1.2)),
    diagramButton("阅读", () => fit("read")),
    diagramButton("全图", () => fit("all")),
    diagramButton("1:1", () => fit("actual")),
    diagramButton("全屏", () => {
      if (document.fullscreenElement === root) void document.exitFullscreen();
      else void root.requestFullscreen();
    }),
  );
  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    const bounds = viewport.getBoundingClientRect();
    zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX - bounds.left, event.clientY - bounds.top);
  }, {passive: false});
  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    viewport.setPointerCapture(event.pointerId);
    drag = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: transform.x,
      startY: transform.y,
    };
    viewport.classList.add("dragging");
  });
  viewport.addEventListener("pointermove", (event) => {
    if (drag === null || drag.pointerId !== event.pointerId) return;
    transform.x = drag.startX + event.clientX - drag.startClientX;
    transform.y = drag.startY + event.clientY - drag.startClientY;
    applyTransform();
  });
  const finish = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) return;
    drag = null;
    viewport.classList.remove("dragging");
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  };
  viewport.addEventListener("pointerup", finish);
  viewport.addEventListener("pointercancel", finish);
  viewport.addEventListener("dblclick", () => fit("read"));
  return {root, canvas, controls, evidenceCount, fit};
}

function diagramKind(source: string): "flow" | "sequence" | "state" | "other" {
  if (/^\s*flowchart\b/mu.test(source)) return "flow";
  if (/^\s*sequenceDiagram\b/mu.test(source)) return "sequence";
  if (/^\s*stateDiagram(?:-v2)?\b/mu.test(source)) return "state";
  return "other";
}

function firstFlowchartNodeId(source: string): string | null {
  const match = source.match(/^\s*([A-Z][A-Z0-9_]*)\s*(?:\[|\(|\{)/mu);
  return match?.[1] ?? null;
}

function diagramKindLabel(kind: ReturnType<typeof diagramKind>): string {
  switch (kind) {
    case "flow": return "架构 / 流程图";
    case "sequence": return "运行时序图";
    case "state": return "状态与恢复图";
    default: return "审阅图";
  }
}

function decorateDiagramSemantics(canvas: HTMLElement, source: string): void {
  const rules: readonly [string, RegExp][] = [
    ["semantic-gap", /\[(?:未实现|未验证)\]/u],
    ["semantic-progress", /\[(?:进行中|待复核|已实现\/进行中)\]/u],
    ["semantic-authority", /\[(?:事件权威|外部权威|权威闭合|权威)\]/u],
    ["semantic-external", /\[(?:外部|输入|执行平面|执行者|瞬时)\]/u],
    ["semantic-view", /\[(?:读模型|投影|视图|消费者|公开结果)\]/u],
    ["semantic-contract", /\[(?:Schema|生成|合同|计划)\]/u],
    ["semantic-public", /\[(?:当前公共MCP|公共|公开3工具)\]/u],
    ["semantic-current", /\[(?:已实现|已提交|已关闭证据)\]/u],
  ];
  for (const node of canvas.querySelectorAll("g.node")) {
    const label = normalizeDiagramText(node.textContent ?? "");
    const match = rules.find(([, pattern]) => pattern.test(label));
    if (match !== undefined) {
      node.classList.add(match[0]);
    } else if (/(?:归档未实现|rejected|blocked|cancelled)/iu.test(label)) {
      node.classList.add("semantic-gap");
    } else if (/(?:indeterminate|返工|redesign|待决定|Testing)/iu.test(label)) {
      node.classList.add("semantic-progress");
    } else if (/(?:accepted|completed|已记录|已规划|已准备|已Claim|Active Demand|已claim)/iu.test(label)) {
      node.classList.add("semantic-current");
    }
  }
  for (const actor of canvas.querySelectorAll("g.actor")) {
    const label = normalizeDiagramText(actor.textContent ?? "");
    if (/(?:Controller|Authority|Repository|Store|权威)/u.test(label)) actor.classList.add("semantic-authority");
    else if (/(?:Agent|宿主|客户端|用户)/u.test(label)) actor.classList.add("semantic-external");
  }
  const participantLabels = [...source.matchAll(/^\s*(?:participant|actor)\s+[A-Za-z0-9_]+\s+as\s+(.+)$/gmu)]
    .map((match) => normalizeDiagramText(match[1] ?? ""));
  const actorRects = [...canvas.querySelectorAll<SVGRectElement>("rect.actor.actor-top")];
  for (const [index, actorRect] of actorRects.entries()) {
    const label = participantLabels[index] ?? "";
    if (/(?:Controller|Authority|Repository|Store|权威|Decider|Handler)/u.test(label)) {
      actorRect.classList.add("semantic-authority");
    } else if (/(?:Agent|宿主|客户端|用户|调用方)/u.test(label)) {
      actorRect.classList.add("semantic-external");
    } else {
      actorRect.classList.add("semantic-contract");
    }
  }
}

function bindEvidenceVisibility(shell: {
  readonly canvas: HTMLElement;
  readonly controls: HTMLElement;
  readonly evidenceCount: number;
}): void {
  if (shell.evidenceCount === 0) return;
  const bindings = collectEvidenceBindings(shell.canvas);
  if (bindings.length === 0) return;
  let visible = false;
  const button = diagramButton("显示证据编号", () => {
    visible = !visible;
    for (const binding of bindings) {
      binding.textNode.data = visible ? binding.fullText : binding.compactText;
    }
    shell.canvas.classList.toggle("evidence-identifiers-visible", visible);
    button.textContent = visible ? "隐藏证据编号" : "显示证据编号";
    button.setAttribute("aria-pressed", String(visible));
  });
  button.classList.add("evidence-toggle");
  button.setAttribute("aria-pressed", "false");
  shell.controls.prepend(button);
  for (const binding of bindings) binding.textNode.data = binding.compactText;
}

function collectEvidenceBindings(canvas: HTMLElement): DiagramEvidenceBinding[] {
  const bindings: DiagramEvidenceBinding[] = [];
  const labels = canvas.querySelectorAll(".edgeLabel, .messageText, .labelText");
  for (const element of labels) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode !== null) {
      const fullText = textNode.nodeValue ?? "";
      const match = fullText.match(/\b(E-[A-Z0-9]+-[0-9]{2})\s*/u);
      if (match !== null) {
        const token = match[1] ?? "";
        const compactText = fullText.replace(match[0], "").trimStart();
        (element as SVGElement).dataset.evidenceToken = token;
        bindings.push({element, textNode: textNode as Text, fullText, compactText, token});
        break;
      }
      textNode = walker.nextNode();
    }
  }
  return bindings;
}

function normalizeDiagramText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function diagramButton(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.setAttribute("aria-label", `${label}流程图`);
  button.addEventListener("click", action);
  return button;
}

function bindDiagramSelection(canvas: HTMLElement): void {
  canvas.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const element = target.closest("g.node, g.actor, .edgeLabel, .messageText, .labelText");
    if (element === null) return;
    const text = normalizeDiagramText(element.textContent ?? "");
    if (text.length === 0) return;
    const token = element.closest<SVGElement>("[data-evidence-token]")?.dataset.evidenceToken
      ?? text.match(/E-[A-Z0-9]+-[0-9]{2}|F-[A-Z0-9-]+/u)?.[0]
      ?? null;
    selectionKind.textContent = element.matches(".edgeLabel, .messageText, .labelText") ? "连线/消息" : "节点/参与者";
    selectionText.textContent = text;
    selectedEvidenceToken = token;
    locateEvidenceButton.disabled = token === null;
  });
}

function resetSelection(): void {
  selectedEvidenceToken = null;
  selectionKind.textContent = "未选择";
  selectionText.textContent = "点击图中的节点或带编号连线查看信息。";
  locateEvidenceButton.disabled = true;
}

function locateEvidence(): void {
  if (selectedEvidenceToken === null) return;
  if (document.fullscreenElement !== null) {
    void document.exitFullscreen().then(locateEvidence);
    return;
  }
  const candidates = article.querySelectorAll<HTMLElement>("td, code, li");
  for (const candidate of candidates) {
    if (candidate.closest(".diagram-shell") !== null) continue;
    if (!candidate.textContent?.includes(selectedEvidenceToken)) continue;
    candidate.scrollIntoView({behavior: "smooth", block: "center"});
    candidate.classList.add("evidence-highlight");
    setTimeout(() => candidate.classList.remove("evidence-highlight"), 1800);
    return;
  }
}

function renderSearch(queryValue: string): void {
  const query = queryValue.trim().toLocaleLowerCase("zh-CN");
  searchResults.replaceChildren();
  if (query.length === 0) {
    searchResults.hidden = true;
    return;
  }
  const matches = documents
    .filter((item) => item.searchText.includes(query))
    .slice(0, 10);
  if (matches.length === 0) {
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = "没有匹配的文档";
    searchResults.append(empty);
  } else {
    for (const item of matches) {
      const link = document.createElement("a");
      link.href = documentRoute(item.id);
      const title = document.createElement("strong");
      title.textContent = item.title;
      const path = document.createElement("small");
      path.textContent = item.relativePath;
      link.append(title, path);
      link.addEventListener("click", () => {
        searchResults.hidden = true;
        searchInput.value = "";
      });
      searchResults.append(link);
    }
  }
  searchResults.hidden = false;
}

function closeMobileSidebar(): void {
  sidebar.classList.remove("open");
  menuToggle.setAttribute("aria-label", "打开图集导航");
}

async function renderRoute(): Promise<void> {
  const route = location.hash || "#/home";
  if (route === "#/home" || route === "#/") {
    renderHome();
    return;
  }
  const prefix = "#/doc/";
  if (!route.startsWith(prefix)) {
    renderHome();
    return;
  }
  const [pathPart, anchorPart] = route.slice(prefix.length).split("?anchor=", 2);
  const id = decodeURIComponent(pathPart ?? "");
  const item = documentById.get(id);
  if (item === undefined) {
    article.innerHTML = "<h1>未找到文档</h1><p>该文档可能已移动或尚未生成。</p>";
    return;
  }
  await renderDocument(item);
  if (anchorPart) document.getElementById(decodeURIComponent(anchorPart))?.scrollIntoView();
}

menuToggle.addEventListener("click", () => {
  const open = sidebar.classList.toggle("open");
  menuToggle.setAttribute("aria-label", open ? "关闭图集导航" : "打开图集导航");
});
themeToggle.addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});
searchInput.addEventListener("input", () => renderSearch(searchInput.value));
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    searchInput.value = "";
    searchResults.hidden = true;
  }
});
document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (!searchResults.contains(target) && target !== searchInput) searchResults.hidden = true;
});
locateEvidenceButton.addEventListener("click", locateEvidence);
window.addEventListener("hashchange", () => void renderRoute());

initializeTheme();
renderNavigation();
void renderRoute();
