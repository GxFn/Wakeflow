import cytoscape from "cytoscape";
import elk from "cytoscape-elk";

cytoscape.use(elk);

type ExplorerTheme = "light" | "dark";
type FocusMode = "overview" | "all" | "neighborhood" | "upstream" | "downstream";
type RelationKind = "import" | "contract";
type NodeKind = "root" | "shared" | "host-entry" | "domain" | "host-impl" | "generated";

interface DependencyGroup {
  readonly id: string;
  readonly label: string;
  readonly parentId?: string;
  readonly kind: NodeKind;
}

interface DependencyNode {
  readonly id: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly path: string;
  readonly evidenceId?: string;
  readonly sourceKind: string;
  readonly groupId?: string;
  readonly groupLabel: string;
  readonly kind: NodeKind;
}

interface DependencyEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly relation: string;
  readonly evidenceId?: string;
  readonly kind: RelationKind;
}

interface DependencyGraphModel {
  readonly groups: readonly DependencyGroup[];
  readonly nodes: readonly DependencyNode[];
  readonly edges: readonly DependencyEdge[];
}

export interface DependencyExplorerSelection {
  readonly kind: "节点" | "关系";
  readonly title: string;
  readonly summary: string;
  readonly evidenceToken?: string;
}

export interface DependencyExplorerOptions {
  readonly source: string;
  readonly theme: ExplorerTheme;
  readonly onSelection: (selection: DependencyExplorerSelection | null) => void;
  readonly onLocateEvidence: (token: string) => void;
}

export interface DependencyExplorerHandle {
  readonly root: HTMLElement;
  destroy(): void;
}

export async function mountDependencyExplorer(
  host: HTMLElement,
  options: DependencyExplorerOptions,
): Promise<DependencyExplorerHandle> {
  const model = parseMermaidDependencyGraph(options.source);
  if (model.nodes.length === 0) throw new Error("未从 Mermaid 源图中解析出文件节点。");

  host.className = "dependency-explorer";
  host.innerHTML = `
    <header class="dependency-explorer-header">
      <div>
        <p class="dependency-eyebrow">文件级依赖探索 · P0/P1</p>
        <h3>交互式文件依赖图</h3>
        <p>默认隐藏证据编号；选择节点后聚焦关系，选择连线后再显示边语义与证据。</p>
      </div>
      <div class="dependency-count" aria-live="polite"></div>
    </header>
    <div class="dependency-toolbar" aria-label="文件依赖图控制栏">
      <label class="dependency-search">
        <span>查找文件</span>
        <input type="search" placeholder="文件名、路径或 F-编号" autocomplete="off" />
      </label>
      <label class="dependency-filter">
        <span>关系</span>
        <select>
          <option value="all">全部关系</option>
          <option value="import">普通导入</option>
          <option value="contract">合同与生成边</option>
        </select>
      </label>
      <fieldset class="dependency-focus-controls">
        <legend>聚焦范围</legend>
        <button type="button" data-focus-mode="overview" class="active">入口概览</button>
        <button type="button" data-focus-mode="all">全图</button>
        <button type="button" data-focus-mode="neighborhood" disabled>1-hop</button>
        <button type="button" data-focus-mode="upstream" disabled>上游</button>
        <button type="button" data-focus-mode="downstream" disabled>下游</button>
      </fieldset>
      <div class="dependency-view-controls">
        <button type="button" data-graph-action="layout">重新布局</button>
        <button type="button" data-graph-action="fit">适配视图</button>
        <button type="button" data-graph-action="fullscreen">全屏</button>
      </div>
    </div>
    <div class="dependency-workspace">
      <div class="dependency-canvas-wrap">
        <div class="dependency-loading" role="status">ELK 正在计算正交布局…</div>
        <div class="dependency-canvas" role="application" tabindex="0" aria-label="交互式 TypeScript 文件依赖图"></div>
        <p class="dependency-canvas-hint">滚轮缩放 · 拖动画布 · 单击文件聚焦 · 单击空白恢复入口概览</p>
      </div>
      <aside class="dependency-inspector" aria-label="所选文件或关系的审阅信息">
        <p class="dependency-inspector-kind">尚未选择</p>
        <h4>选择一个文件开始 Review</h4>
        <p class="dependency-inspector-summary">你将看到所属边界、入站/出站关系以及可定位的证据编号。</p>
        <dl></dl>
        <button type="button" class="dependency-evidence-button" disabled>定位边级证据</button>
      </aside>
    </div>
    <footer class="dependency-legend">
      <div class="dependency-legend-items" aria-label="节点分组图例"></div>
      <dl class="dependency-terms">
        <div><dt>1-hop</dt><dd>当前文件及与它直接相连的一层文件。</dd></div>
        <div><dt>上游/下游</dt><dd>分别表示依赖当前文件、以及被当前文件依赖的方向。</dd></div>
        <div><dt>ELK</dt><dd>Eclipse Layout Kernel；用于分层、正交布局并减少交叉线。</dd></div>
        <div><dt>证据编号</dt><dd>F- 表示文件，E- 表示关系；默认不常驻画布。</dd></div>
      </dl>
    </footer>
  `;

  const canvas = requiredChild<HTMLElement>(host, ".dependency-canvas");
  const loading = requiredChild<HTMLElement>(host, ".dependency-loading");
  const count = requiredChild<HTMLElement>(host, ".dependency-count");
  const search = requiredChild<HTMLInputElement>(host, ".dependency-search input");
  const relationFilter = requiredChild<HTMLSelectElement>(host, ".dependency-filter select");
  const inspectorKind = requiredChild<HTMLElement>(host, ".dependency-inspector-kind");
  const inspectorTitle = requiredChild<HTMLElement>(host, ".dependency-inspector h4");
  const inspectorSummary = requiredChild<HTMLElement>(host, ".dependency-inspector-summary");
  const inspectorList = requiredChild<HTMLDListElement>(host, ".dependency-inspector dl");
  const evidenceButton = requiredChild<HTMLButtonElement>(host, ".dependency-evidence-button");
  const fullscreenButton = requiredChild<HTMLButtonElement>(host, "[data-graph-action='fullscreen']");
  const focusButtons = [...host.querySelectorAll<HTMLButtonElement>("[data-focus-mode]")];
  renderLegend(requiredChild<HTMLElement>(host, ".dependency-legend-items"), model);
  search.value = "";
  relationFilter.value = "all";

  const cy = cytoscape({
    container: canvas,
    elements: createElements(model),
    style: createStyles(options.theme),
    minZoom: 0.22,
    maxZoom: 3.5,
    selectionType: "single",
    boxSelectionEnabled: false,
  });

  let destroyed = false;
  let focusMode: FocusMode = "overview";
  let activeNodeId: string | null = null;
  let selectedEvidenceToken: string | null = null;
  let fullscreenFitTimer: number | null = null;
  let resizeFitTimer: number | null = null;
  let layoutReady = false;
  const fullPositions = new Map<string, cytoscape.Position>();

  const resizeObserver = new ResizeObserver(() => {
    cy.resize();
    if (!layoutReady || destroyed) return;
    if (resizeFitTimer !== null) window.clearTimeout(resizeFitTimer);
    resizeFitTimer = window.setTimeout(() => {
      if (destroyed) return;
      fitElements(cy, cy.elements().not(".is-filtered, .is-context-muted"));
    }, 120);
  });
  resizeObserver.observe(canvas);

  function updateCount(): void {
    const visibleEdges = cy.edges().not(".is-filtered").length;
    const fileNodes = cy.nodes().filter((node) => !Boolean(node.data("isGroup")));
    const mutedNodes = fileNodes.filter(".is-context-muted, .is-search-muted").length;
    const focusDescription = mutedNodes > 0 ? ` · 聚焦 ${model.nodes.length - mutedNodes} 个文件` : "";
    count.textContent = `${model.nodes.length} 个文件 · ${visibleEdges} 条可见关系${focusDescription}`;
  }

  function updateFocusButtons(): void {
    for (const button of focusButtons) {
      const mode = button.dataset.focusMode as FocusMode;
      button.classList.toggle("active", mode === focusMode);
      button.disabled = mode !== "overview" && mode !== "all" && activeNodeId === null;
    }
  }

  function setInspector(
    selection: DependencyExplorerSelection | null,
    rows: readonly [string, string][] = [],
  ): void {
    inspectorList.replaceChildren();
    if (selection === null) {
      host.classList.remove("has-selection");
      inspectorKind.textContent = "尚未选择";
      inspectorTitle.textContent = "选择一个文件开始 Review";
      inspectorSummary.textContent = "你将看到所属边界、入站/出站关系以及可定位的证据编号。";
      selectedEvidenceToken = null;
      evidenceButton.disabled = true;
      evidenceButton.textContent = "定位证据";
      options.onSelection(null);
      return;
    }
    host.classList.add("has-selection");
    inspectorKind.textContent = selection.kind;
    inspectorTitle.textContent = selection.title;
    inspectorSummary.textContent = selection.summary;
    for (const [termValue, descriptionValue] of rows) {
      const term = document.createElement("dt");
      term.textContent = termValue;
      const description = document.createElement("dd");
      description.textContent = descriptionValue;
      inspectorList.append(term, description);
    }
    selectedEvidenceToken = selection.evidenceToken ?? null;
    evidenceButton.disabled = selectedEvidenceToken === null;
    evidenceButton.textContent = selection.kind === "节点" ? "定位文件证据" : "定位边级证据";
    options.onSelection(selection);
  }

  function setFocusMode(nextMode: FocusMode, fit = true): void {
    const needsActiveNode = nextMode === "neighborhood" || nextMode === "upstream" || nextMode === "downstream";
    focusMode = needsActiveNode && activeNodeId === null ? "overview" : nextMode;
    if (focusMode === "overview") applyOverviewPositions(cy);
    else restoreFullPositions(cy, fullPositions);
    cy.elements().removeClass("is-context-muted");
    if (focusMode === "overview" || (focusMode !== "all" && activeNodeId !== null)) {
      const keep = focusMode === "overview"
        ? collectOverviewIds(cy)
        : collectFocusIds(cy, activeNodeId as string, focusMode);
      cy.elements().forEach((element) => {
        element.toggleClass("is-context-muted", !keep.has(element.id()));
      });
      if (fit) fitElements(cy, cy.elements().not(".is-context-muted, .is-filtered"));
    } else if (fit) {
      fitElements(cy, cy.elements().not(".is-filtered"));
    }
    if (fit && activeNodeId !== null && cy.width() < 700) cy.panBy({x: -120, y: 0});
    updateFocusButtons();
    updateCount();
  }

  function clearSelection(fit = true): void {
    activeNodeId = null;
    cy.elements().unselect();
    setInspector(null);
    setFocusMode("overview", fit);
  }

  function selectNode(node: cytoscape.NodeSingular): void {
    activeNodeId = node.id();
    const incoming = node.incomers("edge").not(".is-filtered").length;
    const outgoing = node.outgoers("edge").not(".is-filtered").length;
    const selection: DependencyExplorerSelection = {
      kind: "节点",
      title: String(node.data("label")),
      summary: `${String(node.data("groupLabel"))} · ${incoming} 条入站 / ${outgoing} 条出站`,
      evidenceToken: optionalString(node.data("evidenceId")),
    };
    setInspector(selection, [
      ["路径", String(node.data("path"))],
      ["来源", String(node.data("sourceKind"))],
      ["边界", String(node.data("groupLabel"))],
      ["文件证据", optionalString(node.data("evidenceId")) ?? "未标注"],
    ]);
    setFocusMode(focusMode === "all" ? "neighborhood" : focusMode);
  }

  function selectEdge(edge: cytoscape.EdgeSingular): void {
    activeNodeId = null;
    focusMode = "all";
    restoreFullPositions(cy, fullPositions);
    cy.elements().removeClass("is-context-muted");
    const source = edge.source();
    const target = edge.target();
    const selection: DependencyExplorerSelection = {
      kind: "关系",
      title: String(edge.data("relation")),
      summary: `${String(source.data("label"))} → ${String(target.data("label"))}`,
      evidenceToken: optionalString(edge.data("evidenceId")),
    };
    setInspector(selection, [
      ["起点", String(source.data("path"))],
      ["终点", String(target.data("path"))],
      ["关系", String(edge.data("relation"))],
      ["边证据", optionalString(edge.data("evidenceId")) ?? "未标注"],
    ]);
    updateFocusButtons();
    updateCount();
  }

  function applyRelationFilter(): void {
    const value = relationFilter.value;
    cy.edges().forEach((edge) => {
      edge.toggleClass("is-filtered", value !== "all" && edge.data("kind") !== value);
    });
    if (activeNodeId !== null) setFocusMode(focusMode, false);
    updateCount();
  }

  function applySearch(): void {
    const query = search.value.trim().toLocaleLowerCase("zh-CN");
    if (query.length > 0 && focusMode === "overview") setFocusMode("all", false);
    cy.elements().removeClass("is-search-muted search-match");
    if (query.length === 0) {
      updateCount();
      return;
    }
    const fileNodes = cy.nodes().filter((node) => !Boolean(node.data("isGroup")));
    const matches = fileNodes.filter((node) => String(node.data("searchText")).includes(query));
    fileNodes.forEach((node) => {
      node.toggleClass("is-search-muted", !matches.contains(node));
    });
    matches.addClass("search-match");
    cy.edges().forEach((edge) => {
      edge.toggleClass("is-search-muted", !matches.contains(edge.source()) && !matches.contains(edge.target()));
    });
    cy.nodes().filter((node) => Boolean(node.data("isGroup"))).forEach((group) => {
      const hasMatch = group.descendants().some((node) => matches.contains(node));
      group.toggleClass("is-search-muted", !hasMatch);
    });
    if (matches.length > 0) fitElements(cy, matches.union(matches.parents()), 110);
    count.textContent = `${matches.length} 个匹配文件 · ${cy.edges().not(".is-filtered").length} 条可见关系`;
  }

  async function runLayout(): Promise<void> {
    layoutReady = false;
    loading.hidden = false;
    cy.elements().removeClass("is-context-muted");
    await runElkLayout(cy);
    if (destroyed) return;
    captureFullPositions(cy, fullPositions);
    layoutReady = true;
    loading.hidden = true;
    setFocusMode(focusMode, true);
  }

  cy.on("tap", "node", (event) => {
    const node = event.target as cytoscape.NodeSingular;
    if (Boolean(node.data("isGroup"))) return;
    selectNode(node);
  });
  cy.on("tap", "edge", (event) => selectEdge(event.target as cytoscape.EdgeSingular));
  cy.on("mouseover", "edge", (event) => (event.target as cytoscape.EdgeSingular).addClass("is-hovered"));
  cy.on("mouseout", "edge", (event) => (event.target as cytoscape.EdgeSingular).removeClass("is-hovered"));
  cy.on("tap", (event) => {
    if (event.target === cy) clearSelection(false);
  });

  for (const button of focusButtons) {
    button.addEventListener("click", () => {
      const mode = button.dataset.focusMode as FocusMode;
      if (mode === "overview" || mode === "all") {
        activeNodeId = null;
        cy.elements().unselect();
        setInspector(null);
      }
      setFocusMode(mode);
    });
  }
  relationFilter.addEventListener("change", applyRelationFilter);
  search.addEventListener("input", applySearch);
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    search.value = "";
    applySearch();
    search.blur();
  });
  evidenceButton.addEventListener("click", () => {
    if (selectedEvidenceToken !== null) options.onLocateEvidence(selectedEvidenceToken);
  });
  requiredChild<HTMLButtonElement>(host, "[data-graph-action='layout']")
    .addEventListener("click", () => void runLayout());
  requiredChild<HTMLButtonElement>(host, "[data-graph-action='fit']")
    .addEventListener("click", () => fitElements(cy, cy.elements().not(".is-filtered, .is-context-muted")));
  fullscreenButton.addEventListener("click", () => {
    if (document.fullscreenElement === host) void document.exitFullscreen();
    else void host.requestFullscreen();
  });
  canvas.addEventListener("keydown", (event) => {
    if (event.key === "Escape") clearSelection();
    if (event.key === "0") fitElements(cy, cy.elements().not(".is-filtered, .is-context-muted"));
  });

  const fullscreenListener = () => {
    fullscreenButton.textContent = document.fullscreenElement === host ? "退出全屏" : "全屏";
    const resizeAndFit = () => {
      if (destroyed) return;
      cy.resize();
      fitElements(cy, cy.elements().not(".is-filtered, .is-context-muted"));
    };
    requestAnimationFrame(() => requestAnimationFrame(resizeAndFit));
    if (fullscreenFitTimer !== null) window.clearTimeout(fullscreenFitTimer);
    fullscreenFitTimer = window.setTimeout(resizeAndFit, 180);
  };
  document.addEventListener("fullscreenchange", fullscreenListener);

  updateCount();
  updateFocusButtons();
  await runLayout();

  return {
    root: host,
    destroy: () => {
      destroyed = true;
      if (fullscreenFitTimer !== null) window.clearTimeout(fullscreenFitTimer);
      if (resizeFitTimer !== null) window.clearTimeout(resizeFitTimer);
      resizeObserver.disconnect();
      document.removeEventListener("fullscreenchange", fullscreenListener);
      cy.destroy();
    },
  };
}

function parseMermaidDependencyGraph(source: string): DependencyGraphModel {
  const groups = new Map<string, DependencyGroup>();
  const nodes = new Map<string, DependencyNode>();
  const edges: DependencyEdge[] = [];
  const groupStack: string[] = [];

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    const groupMatch = line.match(/^subgraph\s+([A-Za-z0-9_]+)\["([^"]+)"\]$/u);
    if (groupMatch !== null) {
      const [, id, label] = groupMatch;
      if (id === undefined || label === undefined) continue;
      const parentId = groupStack.at(-1);
      groups.set(id, {id, label, parentId, kind: groupKind(id)});
      groupStack.push(id);
      continue;
    }
    if (line === "end") {
      groupStack.pop();
      continue;
    }
    const edgeMatch = line.match(/^([A-Za-z0-9_]+)\s+-->\|"([^"]+)"\|\s+([A-Za-z0-9_]+)$/u);
    if (edgeMatch !== null) {
      const [, sourceId, rawRelation, targetId] = edgeMatch;
      if (sourceId === undefined || rawRelation === undefined || targetId === undefined) continue;
      const evidenceId = rawRelation.match(/E-[A-Z0-9]+-[0-9]{2}/u)?.[0];
      const relation = rawRelation.replace(/^E-[A-Z0-9]+-[0-9]{2}\s*/u, "").trim();
      edges.push({
        id: evidenceId ?? `edge:${edges.length + 1}`,
        source: sourceId,
        target: targetId,
        relation,
        evidenceId,
        kind: /合同|Schema|生成/u.test(relation) ? "contract" : "import",
      });
      continue;
    }
    const nodeMatch = line.match(/^([A-Za-z0-9_]+)\["([^"]+)"\]$/u);
    if (nodeMatch === null) continue;
    const [, id, rawLabel] = nodeMatch;
    if (id === undefined || rawLabel === undefined) continue;
    const label = rawLabel.replaceAll("\\n", "\n");
    const path = label.split("\n").at(-1)?.trim() ?? label;
    const evidenceId = label.match(/\[(F-[A-Z0-9-]+)\]/u)?.[1];
    const sourceKind = label.match(/^\[([^\]]+)\]/u)?.[1] ?? "源码";
    const groupId = groupStack.at(-1);
    const group = groupId === undefined ? undefined : groups.get(groupId);
    const kind = sourceKind === "生成" ? "generated" : group?.kind ?? "shared";
    nodes.set(id, {
      id,
      label,
      shortLabel: shortenPath(path),
      path,
      evidenceId,
      sourceKind,
      groupId,
      groupLabel: group?.label ?? "未分组",
      kind,
    });
  }

  return {
    groups: [...groups.values()],
    nodes: [...nodes.values()],
    edges: edges.filter((edge) => nodes.has(edge.source) && nodes.has(edge.target)),
  };
}

function groupKind(groupId: string): NodeKind {
  switch (groupId) {
    case "ROOTS": return "root";
    case "HOST_ENTRY": return "host-entry";
    case "DOMAIN": return "domain";
    case "HOST_IMPL": return "host-impl";
    default: return "shared";
  }
}

function shortenPath(path: string): string {
  const normalized = path.replace(/^src\//u, "");
  const segments = normalized.split("/");
  if (segments.at(-1) === "*") return segments.slice(-2).join("/");
  return segments.at(-1) ?? normalized;
}

function createElements(model: DependencyGraphModel): cytoscape.ElementDefinition[] {
  const nodeElements: cytoscape.ElementDefinition[] = model.nodes.map((node) => ({
    data: {
      id: node.id,
      label: node.shortLabel,
      fullLabel: node.label,
      path: node.path,
      evidenceId: node.evidenceId ?? "",
      sourceKind: node.sourceKind,
      groupLabel: node.groupLabel,
      searchText: `${node.label}\n${node.path}\n${node.evidenceId ?? ""}`.toLocaleLowerCase("zh-CN"),
      isGroup: false,
    },
    classes: `dependency-node kind-${node.kind}`,
  }));
  const edgeElements: cytoscape.ElementDefinition[] = model.edges.map((edge) => ({
    data: {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      relation: edge.relation,
      evidenceId: edge.evidenceId ?? "",
      kind: edge.kind,
    },
    classes: `dependency-edge relation-${edge.kind}`,
  }));
  return [...nodeElements, ...edgeElements];
}

function renderLegend(container: HTMLElement, model: DependencyGraphModel): void {
  container.replaceChildren();
  const entries = new Map<string, {label: string; kind: NodeKind}>();
  for (const node of model.nodes) {
    const key = node.groupId ?? `kind:${node.kind}`;
    if (!entries.has(key)) {
      entries.set(key, {
        label: node.groupId === undefined && node.kind === "generated" ? "生成合同" : node.groupLabel,
        kind: node.kind,
      });
    }
  }
  for (const entry of entries.values()) {
    const item = document.createElement("span");
    const swatch = document.createElement("i");
    swatch.className = `legend-${legendKind(entry.kind)}`;
    item.append(swatch, document.createTextNode(entry.label));
    container.append(item);
  }
}

function legendKind(kind: NodeKind): "root" | "shared" | "host" | "domain" | "generated" {
  if (kind === "root") return "root";
  if (kind === "shared") return "shared";
  if (kind === "domain") return "domain";
  if (kind === "generated") return "generated";
  return "host";
}

function createStyles(theme: ExplorerTheme): cytoscape.StylesheetJson {
  const dark = theme === "dark";
  const foreground = dark ? "#e8eef9" : "#172238";
  const muted = dark ? "#aab7ca" : "#5b687d";
  const surface = dark ? "#172235" : "#ffffff";
  const groupBackground = dark ? "#202e45" : "#edf2fa";
  return [
    {
      selector: "node.dependency-node",
      style: {
        label: "data(label)",
        shape: "round-rectangle",
        width: 190,
        height: 64,
        padding: "10px",
        "background-color": surface,
        "border-color": "#93b7ff",
        "border-width": 2,
        color: foreground,
        "font-family": "Inter, ui-sans-serif, system-ui, sans-serif",
        "font-size": 15,
        "font-weight": 600,
        "text-wrap": "wrap",
        "text-overflow-wrap": "anywhere",
        "text-max-width": "166px",
        "text-valign": "center",
        "text-halign": "center",
        "overlay-opacity": 0,
        "transition-property": "opacity, border-width, border-color, background-color",
        "transition-duration": 160,
      },
    },
    {
      selector: "node.dependency-group",
      style: {
        label: "data(label)",
        shape: "round-rectangle",
        "background-color": groupBackground,
        "background-opacity": dark ? 0.42 : 0.7,
        "border-color": dark ? "#405575" : "#c8d5e8",
        "border-width": 1.5,
        "border-style": "dashed",
        color: muted,
        "font-family": "Inter, ui-sans-serif, system-ui, sans-serif",
        "font-size": 14,
        "font-weight": 700,
        "text-valign": "top",
        "text-halign": "center",
        "text-margin-y": -12,
        padding: "34px",
        "compound-sizing-wrt-labels": "include",
      },
    },
    {selector: "node.kind-root", style: {"background-color": dark ? "#263a60" : "#e5edfc", "border-color": "#5f8fe7"}},
    {selector: "node.kind-shared", style: {"background-color": dark ? "#173c3b" : "#e2f8f4", "border-color": "#32a88f"}},
    {selector: "node.kind-host-entry", style: {"background-color": dark ? "#352852" : "#f0e7fc", "border-color": "#9364d6"}},
    {selector: "node.kind-domain", style: {"background-color": dark ? "#173c31" : "#e4f5eb", "border-color": "#3e9b65"}},
    {selector: "node.kind-host-impl", style: {"background-color": dark ? "#49331f" : "#fff0dd", "border-color": "#d4872e"}},
    {selector: "node.kind-generated", style: {"background-color": dark ? "#44391a" : "#fff4c9", "border-color": "#c79721"}},
    {
      selector: "edge",
      style: {
        width: 2,
        "line-color": dark ? "#7286a5" : "#8291a8",
        "target-arrow-color": dark ? "#7286a5" : "#8291a8",
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.9,
        "curve-style": "taxi",
        "taxi-direction": "rightward",
        "taxi-turn": 24,
        "taxi-turn-min-distance": 12,
        label: "",
        color: foreground,
        "font-size": 13,
        "font-weight": 700,
        "text-rotation": "autorotate",
        "text-background-color": surface,
        "text-background-opacity": 0,
        "text-background-padding": "4px",
        "transition-property": "opacity, width, line-color, target-arrow-color",
        "transition-duration": 140,
      },
    },
    {
      selector: "edge.relation-contract",
      style: {
        "line-color": "#9364d6",
        "target-arrow-color": "#9364d6",
        "line-style": "dashed",
      },
    },
    {
      selector: "edge:selected, edge.is-hovered",
      style: {
        label: "data(relation)",
        width: 4,
        "line-color": "#315ca8",
        "target-arrow-color": "#315ca8",
        "text-background-opacity": 1,
        "z-index": 30,
      },
    },
    {
      selector: "node:selected",
      style: {"border-width": 5, "border-color": "#315ca8", "z-index": 25},
    },
    {
      selector: ".search-match",
      style: {"border-width": 5, "border-color": "#d18b10", "z-index": 24},
    },
    {
      selector: ".is-context-muted, .is-search-muted",
      style: {opacity: 0.035, "events": "no"},
    },
    {
      selector: ".is-filtered",
      style: {display: "none"},
    },
  ];
}

async function runElkLayout(cy: cytoscape.Core): Promise<void> {
  const completed = new Promise<void>((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    cy.one("layoutstop", finish);
    window.setTimeout(finish, 3500);
  });
  const layout = cy.layout({
    name: "elk",
    fit: false,
    animate: false,
    nodeDimensionsIncludeLabels: true,
    elk: {
      algorithm: "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": 54,
      "elk.layered.spacing.nodeNodeBetweenLayers": 92,
    },
  } as unknown as cytoscape.LayoutOptions);
  layout.run();
  await completed;

  const positions = new Set(
    cy.nodes().filter((node) => !Boolean(node.data("isGroup")))
      .map((node) => {
        const fileNode = node as cytoscape.NodeSingular;
        return `${Math.round(fileNode.position("x"))}:${Math.round(fileNode.position("y"))}`;
      }),
  );
  if (positions.size > 1) return;
  cy.layout({name: "breadthfirst", directed: true, spacingFactor: 1.4, fit: false}).run();
}

function captureFullPositions(
  cy: cytoscape.Core,
  positions: Map<string, cytoscape.Position>,
): void {
  positions.clear();
  cy.nodes().filter((node) => !Boolean(node.data("isGroup"))).forEach((node) => {
    const position = (node as cytoscape.NodeSingular).position();
    positions.set(node.id(), {x: position.x, y: position.y});
  });
}

function restoreFullPositions(
  cy: cytoscape.Core,
  positions: ReadonlyMap<string, cytoscape.Position>,
): void {
  for (const [id, position] of positions) {
    const node = cy.getElementById(id);
    if (!node.isNode()) continue;
    (node as cytoscape.NodeSingular).position(position);
  }
}

function applyOverviewPositions(cy: cytoscape.Core): void {
  const overviewIds = selectOverviewNodeIds(cy);
  const overviewSet = new Set(overviewIds);
  let sourceIds = overviewIds.filter((id) => {
    const node = cy.getElementById(id);
    return node.isNode() && node.incomers("edge").length === 0;
  });
  let targetIds = overviewIds.filter((id) => !sourceIds.includes(id));
  if (sourceIds.length === 0 || targetIds.length === 0) {
    const split = Math.max(1, Math.ceil(overviewIds.length / 2));
    sourceIds = overviewIds.slice(0, split);
    targetIds = overviewIds.slice(split);
  }
  const sourceStart = 250 - Math.max(0, sourceIds.length - 1) * 85;
  const targetStart = 250 - Math.max(0, targetIds.length - 1) * 85;
  for (const [index, id] of sourceIds.entries()) {
    const node = cy.getElementById(id);
    if (!node.isNode()) continue;
    (node as cytoscape.NodeSingular).position({x: 160, y: sourceStart + index * 170});
  }
  for (const [index, id] of targetIds.entries()) {
    const node = cy.getElementById(id);
    if (!node.isNode()) continue;
    (node as cytoscape.NodeSingular).position({x: 650, y: targetStart + index * 170});
  }
  cy.nodes().filter((node) => !overviewSet.has(node.id())).unselect();
}

function collectFocusIds(cy: cytoscape.Core, nodeId: string, mode: FocusMode): Set<string> {
  const keep = new Set<string>([nodeId]);
  if (mode === "all") {
    cy.elements().forEach((element) => {
      keep.add(element.id());
    });
    return keep;
  }
  const visibleEdges = cy.edges().not(".is-filtered");
  if (mode === "neighborhood") {
    visibleEdges.forEach((edge) => {
      if (edge.source().id() !== nodeId && edge.target().id() !== nodeId) return;
      keep.add(edge.id());
      keep.add(edge.source().id());
      keep.add(edge.target().id());
    });
  } else {
    const frontier = [nodeId];
    const traversed = new Set<string>();
    while (frontier.length > 0) {
      const current = frontier.shift();
      if (current === undefined || traversed.has(current)) continue;
      traversed.add(current);
      visibleEdges.forEach((edge) => {
        const followsDirection = mode === "upstream"
          ? edge.target().id() === current
          : edge.source().id() === current;
        if (!followsDirection) return;
        const next = mode === "upstream" ? edge.source().id() : edge.target().id();
        keep.add(edge.id());
        keep.add(next);
        frontier.push(next);
      });
    }
  }
  for (const id of [...keep]) {
    const element = cy.getElementById(id);
    if (!element.isNode()) continue;
    let parents = element.parents();
    parents.forEach((parent) => {
      keep.add(parent.id());
    });
    while (parents.length > 0) {
      parents = parents.parents();
      parents.forEach((parent) => {
        keep.add(parent.id());
      });
    }
  }
  return keep;
}

function collectOverviewIds(cy: cytoscape.Core): Set<string> {
  const overviewIds = selectOverviewNodeIds(cy);
  const overviewNodes = cy.nodes().filter((node) => overviewIds.includes(node.id()));
  const keep = new Set<string>();
  overviewNodes.forEach((node) => {
    keep.add(node.id());
  });
  cy.edges().not(".is-filtered").forEach((edge) => {
    if (!overviewNodes.contains(edge.source()) || !overviewNodes.contains(edge.target())) return;
    keep.add(edge.id());
  });
  for (const id of [...keep]) {
    const element = cy.getElementById(id);
    if (!element.isNode()) continue;
    let parents = element.parents();
    parents.forEach((parent) => {
      keep.add(parent.id());
    });
    while (parents.length > 0) {
      parents = parents.parents();
      parents.forEach((parent) => {
        keep.add(parent.id());
      });
    }
  }
  return keep;
}

function selectOverviewNodeIds(cy: cytoscape.Core): string[] {
  const fileNodes: cytoscape.NodeSingular[] = [];
  cy.nodes().filter((node) => !Boolean(node.data("isGroup"))).forEach((node) => {
    fileNodes.push(node as cytoscape.NodeSingular);
  });
  const sourceIds = new Set(
    fileNodes.filter((node) => node.incomers("edge").length === 0).map((node) => node.id()),
  );
  const commonTargets = fileNodes.filter((node) => {
    const incomingSources = new Set<string>();
    node.incomers("edge").forEach((edge) => {
      const sourceId = (edge as cytoscape.EdgeSingular).source().id();
      if (sourceIds.has(sourceId)) incomingSources.add(sourceId);
    });
    return incomingSources.size >= 2;
  });
  const ranked = [...fileNodes].sort((left, right) => {
    const rightDegree = right.incomers("edge").length + right.outgoers("edge").length;
    const leftDegree = left.incomers("edge").length + left.outgoers("edge").length;
    return rightDegree - leftDegree || left.id().localeCompare(right.id());
  });
  const selected: string[] = [];
  const add = (id: string) => {
    if (!selected.includes(id) && selected.length < 8) selected.push(id);
  };
  ranked.filter((node) => sourceIds.has(node.id())).slice(0, 4).forEach((node) => add(node.id()));
  commonTargets.sort((left, right) => right.incomers("edge").length - left.incomers("edge").length)
    .forEach((node) => add(node.id()));
  ranked.forEach((node) => add(node.id()));
  return selected;
}

function fitElements(
  cy: cytoscape.Core,
  elements: cytoscape.CollectionReturnValue,
  padding = 80,
): void {
  if (elements.length === 0) return;
  const fitTarget = elements.nodes().filter((node) => !Boolean(node.data("isGroup")));
  if (fitTarget.length === 0) return;
  cy.stop();
  cy.fit(fitTarget, padding);
  const minimumReadableZoom = cy.width() > 1200 ? 0.48 : cy.width() < 700 ? 0.72 : 0.58;
  const fittedZoom = cy.zoom();
  const targetZoom = Math.max(fittedZoom, minimumReadableZoom);
  cy.zoom(targetZoom);
  const fileNodes = fitTarget;
  const rootNodes = fileNodes.filter(".kind-root");
  const materiallyClamped = targetZoom > fittedZoom * 1.2;
  const centerTarget = materiallyClamped && rootNodes.length > 0 ? rootNodes : fileNodes;
  const centered = centerTarget.length > 0 ? centerTarget : fitTarget;
  const bounds = centered.boundingBox({includeEdges: false, includeLabels: true, includeNodes: true});
  cy.pan({
    x: cy.width() / 2 - (bounds.x1 + bounds.w / 2) * targetZoom,
    y: cy.height() / 2 - (bounds.y1 + bounds.h / 2) * targetZoom,
  });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredChild<ElementType extends HTMLElement>(root: ParentNode, selector: string): ElementType {
  const element = root.querySelector(selector);
  if (element === null) throw new Error(`Missing dependency explorer element ${selector}.`);
  return element as ElementType;
}
