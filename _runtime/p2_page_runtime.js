/**
 * 更新日時: 2026/10/26
 * 処理概要: [S004-S010/S023] 11物理ページの動的領域を公開JSONから更新する。
 * 前回バージョンとの違い:
 * - [MOD]: 既存レイアウトを維持した安全なDOM描画とdataset階層表示を実装する。
 */
(function () {
  "use strict";

  const allowedQueryKeys = new Set(["page", "dataset", "condition", "type", "run"]);
  const allowedValuePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
  const conditionColumns = [
    ["condition_label", "条件"],
    ["condition_type", "種別"],
    ["count", "件数"],
    ["retention_pct", "全体比 (%)"],
    ["win_5d_pct", "5D (%)"],
    ["win_10d_pct", "10D (%)"],
    ["win_20d_pct", "20D (%)"],
    ["stability_label", "安定性"],
  ];

  // [F204] [L204] 共通物理ページをJSON payloadで初期化する。
  async function registCommonPage() {
    const pageType = document.documentElement.dataset.p2Page || "index";
    const request = selectPageRequest(new URLSearchParams(window.location.search), pageType);

    // ホーム画面の場合
    if (pageType === "index") return;

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
    appendHero(
      wrap,
      pageType === "ranking" ? `${title} 高勝率条件一覧` : `${title} P2 v12 分析結果`,
      `データセットID: ${payload.id} / 条件数: ${rows.length}`,
    );
    appendMetricGrid(wrap, [
      ["登録条件", rows.length],
      ["単独条件", rows.filter((item) => item.condition_type === "single").length],
      ["2因子条件", rows.filter((item) => item.condition_type === "pair").length],
      ["3因子条件", rows.filter((item) => item.condition_type === "triple").length],
    ]);
    appendHeading(wrap, pageType === "conditions" ? "条件別結果一覧" : "条件集計");
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

  // [T257] [L206-L210] 条件一覧tableを最大500件まで固定列で描画する。
  function appendConditionTable(wrap, rows, dataset) {
    const tableWrap = createElement("div", "table-wrap");
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    conditionColumns.forEach(([, label]) => headRow.appendChild(createElement("th", "", label)));
    head.appendChild(headRow);
    table.appendChild(head);
    const body = document.createElement("tbody");
    rows.slice(0, 500).forEach((item) => {
      const row = document.createElement("tr");
      conditionColumns.forEach(([column]) => {
        const cell = document.createElement("td");
        if (column === "condition_label" && allowedValuePattern.test(String(item.id || ""))) {
          const link = createElement("a", "", String(item[column] || item.id));
          link.href = createPageUrl("condition.html", { dataset, condition: item.id });
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
      body.appendChild(row);
    });
    table.appendChild(body);
    tableWrap.appendChild(table);
    wrap.appendChild(tableWrap);
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
