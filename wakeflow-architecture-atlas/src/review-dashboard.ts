type ReviewFilter = "all" | "runtime" | "contracts" | "tests" | "docs";

interface ReviewDashboardOptions {
  readonly truthKind?: string;
  readonly verifiedAt?: string;
  readonly snapshotObservedAt?: string;
}

interface ImpactRow {
  readonly label: string;
  readonly count: number;
  readonly impact: string;
  readonly filter: Exclude<ReviewFilter, "all">;
  readonly sourceRow: HTMLTableRowElement;
}

interface EvidenceRow {
  readonly label: string;
  readonly result: string;
  readonly explanation: string;
  readonly sourceRow: HTMLTableRowElement;
}

export function mountReviewDashboard(
  article: HTMLElement,
  options: ReviewDashboardOptions,
): boolean {
  if (article.querySelector(".review-dashboard") !== null) return true;
  const impactTable = tableAfterHeading(article, "工作树路径分布");
  const evidenceTable = tableAfterHeading(article, "最近关闭证据与活跃快照");
  const riskList = listAfterHeading(article, "当前风险");
  const anchor = [...article.querySelectorAll<HTMLHeadingElement>("h2")]
    .find((heading) => heading.textContent?.includes("D0：当前变更影响"));
  if (impactTable === null || evidenceTable === null || riskList === null || anchor === undefined) return false;

  const impacts = parseImpactRows(impactTable);
  const evidence = parseEvidenceRows(evidenceTable);
  const risks = [...riskList.querySelectorAll<HTMLLIElement>(":scope > li")]
    .map((item) => item.textContent?.trim() ?? "")
    .filter((value) => value.length > 0);
  if (impacts.length === 0) return false;

  const total = impacts.reduce((sum, row) => sum + row.count, 0);
  const runtimeCount = countForFilter(impacts, "runtime");
  const contractCount = countForFilter(impacts, "contracts");
  const testCount = countForFilter(impacts, "tests");
  const docsCount = countForFilter(impacts, "docs");
  const closedTests = article.textContent?.match(/(\d+)项聚焦测试/u)?.[1] ?? "—";
  const releaseGateOpen = evidence.some((row) => /未运行|未验证/u.test(row.result));

  const root = document.createElement("section");
  root.className = "review-dashboard";
  root.setAttribute("aria-label", "变更影响与审阅控制台");
  root.innerHTML = `
    <header class="review-dashboard-header">
      <div>
        <p class="review-dashboard-eyebrow">P2 · Review 控制台</p>
        <h2>变更集、风险与验证证据</h2>
        <p>从本文快照自动提取路径分布、关闭证据和风险；筛选只改变阅读视图，不改变代码或权威状态。</p>
      </div>
      <span class="review-decision ${releaseGateOpen ? "review-decision-blocked" : "review-decision-ready"}">
        ${releaseGateOpen ? "可继续审阅 · 不可声明发布就绪" : "审阅门已闭合"}
      </span>
    </header>
    <div class="review-metrics" aria-label="审阅摘要">
      <div><span>快照路径</span><strong>${total}</strong><small>源码、合同、测试与文档</small></div>
      <div><span>运行时源码</span><strong>${runtimeCount}</strong><small>治理、工作区与 Foundation</small></div>
      <div><span>合同变化</span><strong>${contractCount}</strong><small>Schema 与生成合同</small></div>
      <div><span>最近关闭测试</span><strong>${closedTests}</strong><small>不覆盖关闭后的活跃增量</small></div>
    </div>
    <nav class="review-filters" aria-label="变更集筛选">
      <button type="button" class="active" data-review-filter="all">全部 ${total}</button>
      <button type="button" data-review-filter="runtime">运行时 ${runtimeCount}</button>
      <button type="button" data-review-filter="contracts">合同 ${contractCount}</button>
      <button type="button" data-review-filter="tests">测试 ${testCount}</button>
      <button type="button" data-review-filter="docs">文档 ${docsCount}</button>
    </nav>
    <div class="review-dashboard-grid">
      <section class="review-impact-panel">
        <div class="review-panel-heading">
          <div><p>变更影响</p><h3>路径分布</h3></div>
          <span class="review-filter-summary" aria-live="polite">显示 ${impacts.length} 类 · ${total} 条路径</span>
        </div>
        <div class="review-impact-list"></div>
      </section>
      <section class="review-evidence-panel">
        <div class="review-panel-heading"><div><p>验证证据</p><h3>关闭点与当前门</h3></div></div>
        <div class="review-evidence-list"></div>
      </section>
      <section class="review-risk-panel">
        <div class="review-panel-heading"><div><p>风险</p><h3>当前不可省略的判断</h3></div></div>
        <ol class="review-risk-list"></ol>
      </section>
    </div>
    <footer class="review-dashboard-footer">
      <dl>
        <div><dt>变更集</dt><dd>相对基线的源码、合同、测试和文档路径集合。</dd></div>
        <div><dt>影响范围</dt><dd>某类变化可能触达的生产者、消费者、状态或验证边界。</dd></div>
        <div><dt>关闭证据</dt><dd>某一审阅单元完成时保存的测试与结构结果，不自动覆盖后续增量。</dd></div>
        <div><dt>发布门</dt><dd>完整测试、双宿主验证、smoke 与发布一致性检查。</dd></div>
      </dl>
      <p>${snapshotLabel(options)}</p>
    </footer>
  `;

  const impactList = requiredChild<HTMLElement>(root, ".review-impact-list");
  const evidenceList = requiredChild<HTMLElement>(root, ".review-evidence-list");
  const dashboardRiskList = requiredChild<HTMLOListElement>(root, ".review-risk-list");
  const filterSummary = requiredChild<HTMLElement>(root, ".review-filter-summary");
  const maxCount = Math.max(...impacts.map((row) => row.count));

  const impactItems = impacts.map((row) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "review-impact-row";
    button.dataset.reviewCategory = row.filter;
    button.innerHTML = `
      <span class="review-impact-label"></span>
      <span class="review-impact-bar"><i></i></span>
      <strong>${row.count}</strong>
      <small class="review-impact-description"></small>
    `;
    requiredChild<HTMLElement>(button, ".review-impact-label").textContent = row.label;
    requiredChild<HTMLElement>(button, ".review-impact-description").textContent = row.impact;
    requiredChild<HTMLElement>(button, ".review-impact-bar i").style.width = `${Math.max(5, row.count / maxCount * 100)}%`;
    button.addEventListener("click", () => highlightSourceRow(row.sourceRow));
    impactList.append(button);
    return {button, row};
  });

  for (const row of evidence) {
    const card = document.createElement("button");
    card.type = "button";
    const blocked = /未运行|未验证/u.test(row.result);
    const passed = /通过|0违规/u.test(row.result);
    card.className = `review-evidence-card ${blocked ? "is-blocked" : passed ? "is-passed" : "is-info"}`;
    const label = document.createElement("strong");
    label.textContent = row.label;
    const result = document.createElement("span");
    result.textContent = row.result;
    const explanation = document.createElement("small");
    explanation.textContent = row.explanation;
    card.append(label, result, explanation);
    card.addEventListener("click", () => highlightSourceRow(row.sourceRow));
    evidenceList.append(card);
  }

  for (const risk of risks) {
    const item = document.createElement("li");
    item.textContent = risk;
    dashboardRiskList.append(item);
  }

  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-review-filter]")) {
    button.addEventListener("click", () => {
      const filter = button.dataset.reviewFilter as ReviewFilter;
      for (const candidate of root.querySelectorAll<HTMLButtonElement>("[data-review-filter]")) {
        candidate.classList.toggle("active", candidate === button);
      }
      let visibleCount = 0;
      let visibleCategories = 0;
      for (const item of impactItems) {
        const visible = filter === "all" || item.row.filter === filter;
        item.button.hidden = !visible;
        if (!visible) continue;
        visibleCount += item.row.count;
        visibleCategories += 1;
      }
      filterSummary.textContent = `显示 ${visibleCategories} 类 · ${visibleCount} 条路径`;
    });
  }

  anchor.before(root);
  return true;
}

function parseImpactRows(table: HTMLTableElement): ImpactRow[] {
  return [...table.querySelectorAll<HTMLTableRowElement>("tbody tr")].flatMap((row) => {
    const cells = [...row.querySelectorAll<HTMLTableCellElement>("td")]
      .map((cell) => cell.textContent?.trim() ?? "");
    const count = Number.parseInt(cells[1] ?? "", 10);
    if (cells.length < 3 || !Number.isFinite(count)) return [];
    return [{
      label: cells[0] ?? "未命名",
      count,
      impact: cells[2] ?? "",
      filter: classifyImpact(cells[0] ?? ""),
      sourceRow: row,
    }];
  });
}

function parseEvidenceRows(table: HTMLTableElement): EvidenceRow[] {
  return [...table.querySelectorAll<HTMLTableRowElement>("tbody tr")].flatMap((row) => {
    const cells = [...row.querySelectorAll<HTMLTableCellElement>("td")]
      .map((cell) => cell.textContent?.trim() ?? "");
    if (cells.length < 4) return [];
    return [{
      label: `${cells[0] ?? "证据"} · ${cells[1] ?? ""}`,
      result: cells[2] ?? "",
      explanation: cells[3] ?? "",
      sourceRow: row,
    }];
  });
}

function classifyImpact(label: string): Exclude<ReviewFilter, "all"> {
  if (/测试/u.test(label)) return "tests";
  if (/Schema|生成合同/u.test(label)) return "contracts";
  if (/文档/u.test(label)) return "docs";
  return "runtime";
}

function countForFilter(impacts: readonly ImpactRow[], filter: Exclude<ReviewFilter, "all">): number {
  return impacts.filter((row) => row.filter === filter).reduce((sum, row) => sum + row.count, 0);
}

function highlightSourceRow(row: HTMLTableRowElement): void {
  row.scrollIntoView({behavior: "smooth", block: "center"});
  row.classList.add("evidence-highlight");
  window.setTimeout(() => row.classList.remove("evidence-highlight"), 1800);
}

function tableAfterHeading(article: HTMLElement, title: string): HTMLTableElement | null {
  return siblingAfterHeading<HTMLTableElement>(article, title, "TABLE");
}

function listAfterHeading(article: HTMLElement, title: string): HTMLUListElement | null {
  return siblingAfterHeading<HTMLUListElement>(article, title, "UL");
}

function siblingAfterHeading<ElementType extends Element>(
  article: HTMLElement,
  title: string,
  tagName: string,
): ElementType | null {
  const heading = [...article.querySelectorAll<HTMLHeadingElement>("h2, h3")]
    .find((candidate) => candidate.textContent?.trim() === title);
  if (heading === undefined) return null;
  let sibling = heading.nextElementSibling;
  while (sibling !== null && !/^H[1-4]$/u.test(sibling.tagName)) {
    if (sibling.tagName === tagName) return sibling as ElementType;
    sibling = sibling.nextElementSibling;
  }
  return null;
}

function snapshotLabel(options: ReviewDashboardOptions): string {
  const state = options.truthKind === "stale" ? "待复核快照" : "当前快照";
  const observed = options.snapshotObservedAt ?? options.verifiedAt ?? "时间未记录";
  return `${state} · 观测于 ${observed} · 本控制台不替代 Git diff、测试或权威记录。`;
}

function requiredChild<ElementType extends HTMLElement>(root: ParentNode, selector: string): ElementType {
  const element = root.querySelector(selector);
  if (element === null) throw new Error(`Missing review dashboard element ${selector}.`);
  return element as ElementType;
}
