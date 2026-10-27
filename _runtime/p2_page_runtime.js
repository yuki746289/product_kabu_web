/**
 * 更新日時: 2026/10/27
 * 処理概要: [S004-S010/S023] 11物理ページの動的領域を公開JSONから更新する。
 * 前回バージョンとの違い:
 * - [MOD]: 識別queryがない既存画面を保持し、一覧をページングして表示欠落とフリーズを解消する。
 */
(function () {
  "use strict";

  const allowedQueryKeys = new Set([
    "page", "dataset", "condition", "condition_type", "type", "view", "ranking",
    "subject_type", "subject", "chart", "analysis", "report", "part", "run",
  ]);
  const allowedValuePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
  const conditionColumnGroups = [
    { label: "条件", columns: [["condition_label", "条件"]] },
    { label: "種別", columns: [["condition_type", "種別"]] },
    { label: "件数・頻度", columns: [["count", "件数"], ["retention_pct", "全体比"]] },
    { label: "5D", columns: [["win_5d_pct", "正解率"], ["return_5d_pct", "平均増加率"]] },
    { label: "10D", columns: [["win_10d_pct", "正解率"], ["return_10d_pct", "平均増加率"]] },
    { label: "20D", columns: [["win_20d_pct", "正解率"], ["return_20d_pct", "平均増加率"]] },
    { label: "安定性評価", columns: [["stability_label", "安定性評価"]] },
  ];
  const conditionColumns = conditionColumnGroups.flatMap((group) => group.columns);
  const tablePageSizes = [25, 50, 100, 250];

  // [F204] [L204] 共通物理ページをJSON payloadで初期化する。
  async function registCommonPage() {
    const startedAt = performance.now();
    const pageType = document.documentElement.dataset.p2Page || "index";
    const query = new URLSearchParams(window.location.search);

    // ホーム画面の場合
    if (pageType === "index") return;

    registRuntimeStyle();

    // 識別queryがなく既存HTMLを表示する場合
    if (![...query.keys()].length) return;

    const request = selectPageRequest(query, pageType);

    const payload = await selectPageData(request);

    // dataset・条件一覧画面の場合
    if (["dataset", "conditions", "ranking"].includes(pageType)) {
      registDatasetPage(payload, request, pageType);
    // 条件詳細・graph画面の場合
    } else if (["condition", "or-condition", "graph"].includes(pageType)) {
      registConditionDetail(payload, request, pageType);
    // 補助画面の場合
    } else {
      registAuxiliaryPage(payload, request, pageType);
    }
    document.documentElement.dataset.p2RuntimeReady = "true";
    document.documentElement.dataset.p2RuntimeMs = String(Math.round(performance.now() - startedAt));
  }

  // [F205] [L205] query keyと値を完全一致allowlistで検証する。
  function selectPageRequest(query, defaultPage) {
    const request = { page: defaultPage };
    for (const [key, value] of query.entries()) {
      if (!allowedQueryKeys.has(key) || !allowedValuePattern.test(value)) {
        throw new Error(`許可されていない画面指定です: ${key}`);
      }
      if (key === "page" && value !== defaultPage) {
        throw new Error("物理ページとpage指定が一致しません。");
      }
      request[key] = value;
    }
    return request;
  }

  // [T295] [L223] latest、catalog、payloadのrun整合を確認して取得する。
  async function selectPageData(request) {
    const localBridge = window.productKabuLocal;

    // Electronローカル画面の場合
    if (localBridge && typeof localBridge.selectPageData === "function") {
      const localResponse = await localBridge.selectPageData(request);
      if (!localResponse || localResponse.ok !== true) {
        throw new Error(localResponse?.error || "ローカル画面データを取得できません。");
      }
      return localResponse.result;
    }

    const latest = await selectJson("data/latest.json");
    if (latest.catalog !== "catalog.json" || !allowedValuePattern.test(String(latest.runId))) {
      throw new Error("latestの参照が不正です。");
    }
    const catalog = await selectJson("data/catalog.json");
    if (latest.runId !== catalog.runId) throw new Error("公開runが一致しません。");
    if (request.run && request.run !== latest.runId) throw new Error("指定runは公開最新版ではありません。");

    if (request.condition) {
      if (!request.dataset) throw new Error("condition画面にはdataset指定が必要です。");
      const conditionKey = `${request.dataset}::${request.condition}`;
      const conditionPath = catalog.conditionPaths[conditionKey];
      if (!catalog.conditions.includes(conditionKey) || !isAllowedDataPath(conditionPath)) {
        throw new Error("conditionがcatalogにありません。");
      }
      return selectJson(`data/${conditionPath}`);
    }
    if (request.dataset) {
      if (!catalog.datasets.includes(request.dataset)) throw new Error("datasetがcatalogにありません。");
      return selectJson(`data/datasets/${encodeURIComponent(request.dataset)}/dataset.json`);
    }
    return catalog;
  }

  // [T296] [L223] catalogが返したcondition pathを公開data階層へ制限する。
  function isAllowedDataPath(value) {
    return typeof value === "string"
      && /^datasets\/[A-Za-z0-9_.-]+\/conditions\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.json$/.test(value);
  }

  // [F206-F207] [L206-L207] datasetと条件一覧を共通レイアウトへ描画する。
  function registDatasetPage(payload, request, pageType) {
    const wrap = selectWrap();
    wrap.replaceChildren();

    // catalog一覧の場合
    if (!Array.isArray(payload.rows)) {
      appendHero(wrap, "データセット一覧", "分析対象を選択してください。");
      appendDatasetCatalog(wrap, payload.datasetItems || []);
      appendHomeLink(wrap);
      return;
    }

    const title = String(payload.title || payload.id || "分析結果");
    const rows = payload.rows;
    const countByType = { single: 0, pair: 0, triple: 0 };
    rows.forEach((item) => {
      if (Object.hasOwn(countByType, item.condition_type)) countByType[item.condition_type] += 1;
    });

    // ranking画面の場合
    if (pageType === "ranking") {
      const population = formatValue(payload.population_rows || rows[0]?.population_rows);
      appendHero(
        wrap,
        "エントリー数・正解率 注目条件",
        `固定母集団 ${population}件から、件数・全体比率・5/10/20日正解率と平均増加率を横断して確認します。`,
      );
      appendRankingLinks(wrap, String(payload.id));
    } else {
      appendHero(
        wrap,
        `${title} P2 v12 分析結果`,
        `データセットID: ${payload.id} / 条件数: ${rows.length}`,
      );
    }
    appendMetricGrid(wrap, [
      ["登録条件", rows.length],
      ["単独条件", countByType.single],
      ["2因子条件", countByType.pair],
      ["3因子条件", countByType.triple],
    ]);
    appendHeading(wrap, pageType === "ranking" ? "注目条件一覧" : "条件別結果一覧");
    appendConditionTable(wrap, rows, String(payload.id));
    appendHomeLink(wrap);
  }

  // [F208] [L208] 条件詳細を共通レイアウトへ描画する。
  function registConditionDetail(payload, request, pageType) {
    const wrap = selectWrap();
    wrap.replaceChildren();
    const title = String(payload.condition_label || payload.title || payload.id || "条件詳細");
    const suffix = pageType === "graph" ? " グラフ指標" : "";
    appendHero(
      wrap,
      `${title}${suffix}`,
      `条件ID: ${payload.id || "-"} / 種別: ${payload.condition_type || "-"}`,
    );
    appendMetricGrid(wrap, [
      ["件数", formatValue(payload.count)],
      ["全体比", formatPercent(payload.retention_pct)],
      ["5D 正解率", formatPercent(payload.win_5d_pct)],
      ["10D 正解率", formatPercent(payload.win_10d_pct)],
      ["20D 正解率", formatPercent(payload.win_20d_pct)],
    ]);
    appendHeading(wrap, "条件情報");
    appendPropertyTable(wrap, payload);
    const dataset = String(payload.datasetId || request.dataset || "");
    if (allowedValuePattern.test(dataset)) {
      appendLink(wrap, "← 条件一覧へ", createPageUrl("conditions.html", { dataset }));
    }
    appendHomeLink(wrap);
  }

  // [F210] [L210] 補助画面をdatasetまたはcatalogの共通情報で描画する。
  function registAuxiliaryPage(payload, request, pageType) {
    const wrap = selectWrap();
    wrap.replaceChildren();
    const titleByPage = {
      comparison: "比較分析",
      validation: "検証結果",
      signal: "シグナル明細",
      analysis: "月次分析",
    };
    const title = String(titleByPage[pageType] || "分析結果");
    appendHero(wrap, title, `公開run: ${payload.runId || request.run || "latest"}`);
    if (Array.isArray(payload.rows)) {
      appendConditionTable(wrap, payload.rows, String(payload.id));
    } else {
      appendDatasetCatalog(wrap, payload.datasetItems || []);
    }
    appendHomeLink(wrap);
  }

  // [T254] [L204] 既存CSSを利用する描画rootを取得する。
  function selectWrap() {
    let wrap = document.querySelector(".wrap");
    if (!wrap) {
      wrap = document.createElement("main");
      wrap.className = "wrap";
      document.body.appendChild(wrap);
    }
    return wrap;
  }

  // [T302] [L206-L210] 動的一覧の省略表示と操作部品のstyleを一度だけ登録する。
  function registRuntimeStyle() {
    if (document.getElementById("p2-page-runtime-style")) return;
    const style = document.createElement("style");
    style.id = "p2-page-runtime-style";
    style.textContent = [
      ".p2-runtime-condition-cell{width:280px;min-width:280px;max-width:280px;text-align:left}",
      ".p2-runtime-condition-link{display:block;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".table-wrap table td:first-child{width:280px;min-width:280px;max-width:280px;overflow:hidden;text-overflow:ellipsis}",
      ".table-wrap table td:first-child>a:first-child{display:inline-block;max-width:220px;overflow:hidden;text-overflow:ellipsis;vertical-align:middle}",
      ".p2-runtime-table-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:14px 0}",
      ".p2-runtime-table-toolbar input,.p2-runtime-table-toolbar select{padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff}",
      ".p2-runtime-pager{display:flex;gap:8px;align-items:center;margin-top:12px}",
      ".p2-runtime-group-start{border-left:3px solid #64748b!important}",
      "@media(max-width:760px){.p2-runtime-condition-cell{width:240px;min-width:240px;max-width:240px}.p2-runtime-condition-link{max-width:240px}}",
    ].join("");
    document.head.appendChild(style);
  }

  // [T255] [L206-L210] heroを安全なtext nodeだけで作成する。
  function appendHero(wrap, title, description) {
    const hero = createElement("section", "hero");
    hero.appendChild(createElement("h1", "", title));
    hero.appendChild(createElement("p", "", description));
    wrap.appendChild(hero);
    document.title = title;
  }

  // [T256] [L206-L210] 指標cardを既存gridへ描画する。
  function appendMetricGrid(wrap, metrics) {
    const grid = createElement("section", "grid");
    metrics.forEach(([label, value]) => {
      const card = createElement("div", "card");
      card.appendChild(createElement("div", "label", String(label)));
      card.appendChild(createElement("div", "metric", String(value ?? "-")));
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
  }

  // [T257] [L206-L210] 条件一覧tableを検索・ページング付き固定列で描画する。
  function appendConditionTable(wrap, rows, dataset) {
    const toolbar = createElement("div", "p2-runtime-table-toolbar");
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "表を検索";
    search.size = 38;
    search.dataset.p2Bind = "condition-search";
    const pageSizeLabel = createElement("label", "", "表示件数 ");
    const pageSize = document.createElement("select");
    tablePageSizes.forEach((value) => {
      const option = createElement("option", "", value);
      option.value = String(value);
      option.selected = value === 50;
      pageSize.appendChild(option);
    });
    pageSizeLabel.appendChild(pageSize);
    const summary = createElement("span", "muted");
    summary.dataset.p2Bind = "condition-summary";
    toolbar.append(search, pageSizeLabel, summary);
    wrap.appendChild(toolbar);

    const tableWrap = createElement("div", "table-wrap");
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const groupRow = createElement("tr", "table-group-row");
    const detailRow = createElement("tr", "table-detail-row");
    conditionColumnGroups.forEach((group, groupIndex) => {
      const groupCell = createElement("th", groupIndex ? "p2-runtime-group-start" : "", group.label);
      if (group.columns.length === 1) {
        groupCell.rowSpan = 2;
      } else {
        groupCell.colSpan = group.columns.length;
        group.columns.forEach(([, label], columnIndex) => {
          const className = columnIndex === 0 ? "p2-runtime-group-start" : "";
          detailRow.appendChild(createElement("th", className, label));
        });
      }
      groupRow.appendChild(groupCell);
    });
    head.append(groupRow, detailRow);
    table.appendChild(head);
    const body = document.createElement("tbody");
    body.dataset.p2Rows = "conditions";
    table.appendChild(body);
    tableWrap.appendChild(table);
    wrap.appendChild(tableWrap);

    const pager = createElement("div", "p2-runtime-pager");
    const previous = createElement("button", "", "前へ");
    const page = createElement("span", "");
    const next = createElement("button", "", "次へ");
    previous.type = "button";
    next.type = "button";
    page.dataset.p2Bind = "condition-page";
    pager.append(previous, page, next);
    wrap.appendChild(pager);

    let filteredRows = rows;
    let pageIndex = 0;

    const render = () => {
      const countPageSize = Number(pageSize.value);
      const countPage = Math.max(1, Math.ceil(filteredRows.length / countPageSize));
      pageIndex = Math.min(pageIndex, countPage - 1);
      const indexStart = pageIndex * countPageSize;
      const indexEnd = Math.min(filteredRows.length, indexStart + countPageSize);
      const fragment = document.createDocumentFragment();
      filteredRows.slice(indexStart, indexEnd).forEach((item) => {
        fragment.appendChild(createConditionRow(item, dataset));
      });
      body.replaceChildren(fragment);
      summary.textContent = `${filteredRows.length.toLocaleString()}件中 ${filteredRows.length ? indexStart + 1 : 0}〜${indexEnd}件`;
      page.textContent = `${pageIndex + 1} / ${countPage}`;
      previous.disabled = pageIndex <= 0;
      next.disabled = pageIndex >= countPage - 1;
    };

    search.addEventListener("input", () => {
      const query = search.value.trim().toLocaleLowerCase("ja");
      filteredRows = query
        ? rows.filter((item) => conditionColumns.some(([column]) => (
          formatValue(item[column]).toLocaleLowerCase("ja").includes(query)
        )))
        : rows;
      pageIndex = 0;
      render();
    });
    pageSize.addEventListener("change", () => {
      pageIndex = 0;
      render();
    });
    previous.addEventListener("click", () => {
      pageIndex -= 1;
      render();
    });
    next.addEventListener("click", () => {
      pageIndex += 1;
      render();
    });
    render();
  }

  // [T303] [L206-L210] 条件1件を省略表示対応のtable rowへ変換する。
  function createConditionRow(item, dataset) {
    const row = document.createElement("tr");
    conditionColumns.forEach(([column], columnIndex) => {
      const groupStart = [1, 2, 4, 6, 8, 10].includes(columnIndex);
      const className = ["condition_label"].includes(column)
        ? "p2-runtime-condition-cell"
        : groupStart ? "p2-runtime-group-start" : "";
      const cell = createElement("td", className);
      if (column === "condition_label" && allowedValuePattern.test(String(item.id || ""))) {
        const label = String(item[column] || item.id);
        const link = createElement("a", "p2-runtime-condition-link", label);
        link.href = createPageUrl("condition.html", { dataset, condition: item.id });
        link.title = label;
        cell.title = label;
        cell.appendChild(link);
      } else if (column.endsWith("_pct")) {
        cell.textContent = formatPercent(item[column]);
      } else if (column === "condition_type") {
        cell.textContent = formatConditionType(item[column]);
      } else {
        cell.textContent = formatValue(item[column]);
      }
      row.appendChild(cell);
    });
    return row;
  }

  // [T258] [L206-L210] dataset catalogを既存card形式で描画する。
  function appendDatasetCatalog(wrap, items) {
    const grid = createElement("section", "grid");
    items.forEach((item) => {
      const card = createElement("div", "card");
      card.appendChild(createElement("h3", "", String(item.title || item.id)));
      card.appendChild(createElement("p", "muted", `条件数: ${formatValue(item.conditionCount)}`));
      const link = createElement("a", "btn", "分析結果を表示 →");
      link.href = createPageUrl("dataset.html", { dataset: item.id });
      card.appendChild(link);
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
  }

  // [T259] [L208] condition payloadの公開項目を縦型tableへ描画する。
  function appendPropertyTable(wrap, payload) {
    const excluded = new Set(["rows", "datasetId", "id"]);
    const tableWrap = createElement("div", "table-wrap");
    const table = document.createElement("table");
    const body = document.createElement("tbody");
    Object.keys(payload).sort().forEach((key) => {
      if (excluded.has(key) || !["string", "number", "boolean"].includes(typeof payload[key])) return;
      const row = document.createElement("tr");
      row.appendChild(createElement("th", "", key));
      row.appendChild(createElement("td", "", formatValue(payload[key])));
      body.appendChild(row);
    });
    table.appendChild(body);
    tableWrap.appendChild(table);
    wrap.appendChild(tableWrap);
  }

  // [T260] [L206-L210] 見出しを追加する。
  function appendHeading(wrap, text) {
    wrap.appendChild(createElement("h2", "", text));
  }

  // [T304] [L207] ranking画面の既存ナビゲーションを共通URLで追加する。
  function appendRankingLinks(wrap, dataset) {
    const links = createElement("div", "links");
    [
      ["← 全期間概要", createPageUrl("dataset.html", { dataset, view: "all-period" })],
      ["Stage B概要", createPageUrl("dataset.html", { dataset, view: "stage-b" })],
      ["条件別結果一覧", createPageUrl("conditions.html", { dataset })],
    ].forEach(([label, href]) => {
      const link = createElement("a", "btn", label);
      link.href = href;
      links.appendChild(link);
    });
    wrap.appendChild(links);
  }

  // [T261] [L209] 共通linkを追加する。
  function appendLink(wrap, label, href) {
    const links = createElement("div", "links");
    const link = createElement("a", "btn", label);
    link.href = href;
    links.appendChild(link);
    wrap.appendChild(links);
  }

  // [T262] [L209] ホームlinkを追加する。
  function appendHomeLink(wrap) {
    appendLink(wrap, "トップへ", "index.html");
  }

  // [T263] [L206-L210] HTML elementを安全な属性とtextだけで作成する。
  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }

  // [T264] [L206-L210] 表示値を有限値へ制限する。
  function formatValue(value) {
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "number" && !Number.isFinite(value)) return "-";
    return String(value);
  }

  // [T265] [L206-L210] 百分率を小数2桁以内で表示する。
  function formatPercent(value) {
    if (value === null || value === undefined || value === "") return "-";
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return "-";
    return `${Math.round(numberValue * 100) / 100}%`;
  }

  // [T266] [L206-L210] 条件種別を日本語表示へ変換する。
  function formatConditionType(value) {
    const labelByType = {
      single: "単独",
      pair: "2因子",
      triple: "3因子",
      or2: "OR 2条件",
      or3: "OR 3条件",
    };
    return labelByType[value] || formatValue(value);
  }

  // [F209] [L209] 物理ページとqueryから安全な相対URLを作成する。
  function createPageUrl(pageFile, values) {
    if (!/^[a-z-]+\.html$/.test(pageFile)) throw new Error("page file is not allowed");
    const query = new URLSearchParams();
    Object.entries(values).forEach(([key, value]) => {
      if (!allowedQueryKeys.has(key) || !allowedValuePattern.test(String(value))) {
        throw new Error("query value is not allowed");
      }
      query.set(key, String(value));
    });
    return `${pageFile}?${query.toString()}`;
  }

  // [T267] [L223] 同一originの公開JSONを取得する。
  async function selectJson(relativePath) {
    const response = await fetch(relativePath, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error(`JSONを取得できません: ${response.status}`);
    return response.json();
  }

  // [T268] [L204] runtime失敗を画面上へ表示する。
  function registRuntimeError(error) {
    document.documentElement.dataset.p2RuntimeError = "true";
    const message = createElement("div", "note", `画面データを取得できません: ${error.message}`);
    const wrap = selectWrap();
    wrap.insertBefore(message, wrap.firstChild);
    console.error(error);
  }

  window.productKabuPage = Object.freeze({ createPageUrl });
  window.addEventListener("DOMContentLoaded", () => {
    registCommonPage().catch(registRuntimeError);
  });
})();
