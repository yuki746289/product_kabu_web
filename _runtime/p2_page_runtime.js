/**
 * 更新日時: 2026/11/23
 * 処理概要: [S004] release.3.0.0固定テンプレートの許可slotだけを階層JSONから更新する。
 * 前回バージョンとの違い:
 * - [MOD]: release.2表示モデルを廃止し、release.3固定DOM用の構造化node slotへ変更する。
 * - [ADD]: tag・属性・内部URLのallowlist検証を追加する。
 * - [ADD]: [S003] 事前計算済み5D・10D・20D最大保有数を対象表へ追加する。
 * - [ADD]: 共通page描画完了時にローカル表示補正へ完了eventを通知する。
 * - [ADD]: [S036] 11物理pageへクリック可能な共通パンくずリストを追加する。
 * - [MOD]: [S036] 階層移動と重複するbuttonを整理し、戻る操作を共通化する。
 * - [ADD]: [S4001] dataset画面の戻るbuttonを履歴またはホームへ接続する。
 * - [MOD]: 初期配布catalogでは静的release.3テンプレートを保持する。
 * - [MOD]: [F4509] 非日足profileでは5D・10D・20Dを5本・10本・20本へ切り替える。
 * - [MOD]: [F5232] Graph画面にもElectron月次runのdata sourceを明示する。
 * - [MOD]: [F5233] 比較画面の説明を最小IPC payloadの現在件数へ揃える。
 * - [MOD]: [F5605] 要求した分析セットと応答・計算結果のID不一致を拒否する。
 */
(function () {
  "use strict";

  const allowedQueryKeys = new Set([
    "page", "dataset", "condition", "condition_type", "type", "view", "ranking",
    "subject_type", "subject", "chart", "analysis", "report", "part", "run",
    "analysis_set",
  ]);
  const allowedValuePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
  const allowedPageTypes = new Set([
    "index", "dataset", "conditions", "condition", "or-condition", "ranking", "graph",
    "comparison", "validation", "signal", "analysis",
  ]);
  const allowedNodeTags = new Set(["tr", "td", "th", "a"]);
  const allowedNodeAttributes = new Set(["class", "href", "id", "rel", "target"]);
  const allowedSlotNamePattern = /^tbody-[0-9]{3}$/;
  const allowedLinkPattern = /^(?:[a-z-]+\.html(?:\?[A-Za-z0-9_.%=&-]+)?|#[A-Za-z0-9_.-]+)$/;
  const datasetLabelByKey = Object.freeze({
    "01_nikkei_index": "日経平均（全期間）",
    "02_nikkei_225_all": "主要225株（全期間）",
    "03_nikkei_225_technology": "技術（全期間）",
    "04_nikkei_225_financials": "金融（全期間）",
    "05_nikkei_225_consumer_goods": "消費（全期間）",
    "06_nikkei_225_materials": "素材（全期間）",
    "07_nikkei_225_capital_goods_others": "資本財・その他（全期間）",
    "08_nikkei_225_transportation_utilities": "運輸・公益（全期間）",
    "09_nikkei_225_all_without_transportation_utilities": "主要225株（運輸・公益除外）",
    "10_nikkei_225_all_without_capital_goods_transportation_utilities": "主要225株（資本財・その他＋運輸・公益除外）",
    "03_technology": "技術（全期間）",
    "04_financials": "金融（全期間）",
    "05_consumer_goods": "消費（全期間）",
    "06_materials": "素材（全期間）",
    "07_capital_goods_others": "資本財・その他（全期間）",
    "08_transportation_utilities": "運輸・公益（全期間）",
    "09_exclude_transportation_utilities": "主要225株（運輸・公益除外）",
    "10_exclude_capital_goods_transportation_utilities": "主要225株（資本財・その他＋運輸・公益除外）",
  });
  const deferredSlotByElement = new WeakMap();
  const renderChunkSize = 250;
  const largeTablePageSize = 50;
  const calculationContractVersion = "p2-display-calculation-v2";
  let holdingStatisticsBySubject = {};

  // [F5302] 動的slot反映が完了するまで旧template本文を表示しない。
  function finishRuntimeLoading() {
    document.documentElement.classList.remove("p2-runtime-loading");
  }

  // [F420] [L404] 固定物理ページをrelease.3表示payloadで初期化する。
  async function registCommonPage() {
    const startedAt = performance.now();
    const pageType = document.documentElement.dataset.p2Page || "index";
    const query = new URLSearchParams(window.location.search);

    if (!allowedPageTypes.has(pageType)) {
      throw new Error(`unsupported page: ${pageType}`);
    }

    const analysisContext = await selectPageAnalysisContext(query);
    registBreadcrumb(pageType, query, analysisContext);
    registPageBackLink(pageType, query);
    registDatasetNavigation(pageType, query);
    registAnalysisSetNavigation(query);
    registHorizonLabels(query, { calculatedData: analysisContext });
    registAnalysisContextLabels(analysisContext);

    //グラフpayloadの場合
    if (pageType === "graph") {
      document.documentElement.dataset.p2DataSource = (
        window.productKabuLocal
        && typeof window.productKabuLocal.selectAnalysisSet === "function"
      ) ? "local-run" : "static-data";
      document.documentElement.dataset.p2RuntimeReady = "true";
      document.documentElement.dataset.p2RuntimeMs = String(Math.round(performance.now() - startedAt));
      finishRuntimeLoading();
      return;
    }

    const request = selectPageRequest(query, pageType);
    const viewModel = await selectPageViewModel(request);

    //初期配布の静的templateの場合
    if (viewModel === null) {
      document.documentElement.dataset.p2RuntimeReady = "static-template";
      document.documentElement.dataset.p2RuntimeMs = String(Math.round(performance.now() - startedAt));
      finishRuntimeLoading();
      return;
    }

    //初期配布のrelease.3静的画面の場合
    //月次計算payloadがないtemplateは埋込済み正本scriptへ描画を委ねる。
    if (!viewModel.calculatedData && viewModel.renderMode === "template") {
      document.documentElement.dataset.p2RuntimeReady = "static-template";
      document.documentElement.dataset.p2RuntimeMs = String(Math.round(performance.now() - startedAt));
      finishRuntimeLoading();
      return;
    }

    const calculatedContext = viewModel.calculatedData || analysisContext;
    registAnalysisContextLabels(calculatedContext);
    registCalculatedContextLabels(calculatedContext, pageType);

    //シグナル明細画面の場合
    if (pageType === "signal") {
      await registSignalView(viewModel, request);
      registAnalysisSetNavigation(query);
      registHorizonLabels(query, viewModel);
      document.documentElement.dataset.p2RuntimeReady = "true";
      document.documentElement.dataset.p2RuntimeMs = String(Math.round(performance.now() - startedAt));
      finishRuntimeLoading();
      return;
    }

    //分析詳細のquery別専用画面の場合
    if (registAnalysisView(pageType, request, viewModel)) {
      registAnalysisSetNavigation(query);
      registHorizonLabels(query, viewModel);
      document.documentElement.dataset.p2RuntimeReady = "true";
      document.documentElement.dataset.p2RuntimeMs = String(Math.round(performance.now() - startedAt));
      finishRuntimeLoading();
      return;
    }

    holdingStatisticsBySubject = createCalculatedHoldingStatistics(
      viewModel.calculatedData,
    );
    if (Object.keys(holdingStatisticsBySubject).length === 0) {
      holdingStatisticsBySubject = viewModel.holdingStatistics || {};
    }
    registCalculatedTableHeaders(pageType);
    const conditionIndexController = createConditionIndexController(pageType, viewModel);
    if (conditionIndexController) {
      await conditionIndexController.render();
      conditionIndexController.registEvents();
    } else {
      await registTemplateSlots(viewModel);
    }
    registCalculatedTableHeaders(pageType);
    registHoldingStatistics();
    registLargeTableControllers();
    registDeferredSlotEvents();
    registAnalysisSetNavigation(query);
    registHorizonLabels(query, viewModel);
    document.documentElement.dataset.p2RuntimeReady = "true";
    document.documentElement.dataset.p2RuntimeMs = String(Math.round(performance.now() - startedAt));
    finishRuntimeLoading();
  }

  // [F4509] [L4518] analysis setの評価単位に合わせて期間表示を切り替える。
  function registHorizonLabels(query, viewModel = null) {
    const analysisSetId = selectBreadcrumbValue(query.get("analysis_set"));
    const calculatedData = viewModel?.calculatedData;
    const isCalculatedBarProfile = calculatedData?.horizonUnit === "bar";
    const isAnalysisSetBarProfile = Boolean(analysisSetId)
      && !analysisSetId.startsWith("01_");
    const isBarProfile = isCalculatedBarProfile || isAnalysisSetBarProfile;
    if (!isBarProfile) return;

    const labelByDay = new Map([
      ["5D", "5\u672c"],
      ["10D", "10\u672c"],
      ["20D", "20\u672c"],
    ]);
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((node) => {
      let textValue = node.nodeValue || "";
      labelByDay.forEach((barLabel, dayLabel) => {
        textValue = textValue.replaceAll(dayLabel, barLabel);
      });
      textValue = textValue
        .replaceAll("5/10/20\u65e5", "5/10/20\u672c")
        .replaceAll("5\u65e5", "5\u672c")
        .replaceAll("10\u65e5", "10\u672c")
        .replaceAll("20\u65e5", "20\u672c");
      const targetTimeframeLabel = selectTimeframeLabel(
        calculatedData?.targetTimeframe,
      );
      const higherTimeframeLabel = selectTimeframeLabel(
        calculatedData?.higherTimeframe,
      );
      if (targetTimeframeLabel) {
        textValue = textValue.replace(
          /\u65e5\u8db3\s*/g,
          `${targetTimeframeLabel} `,
        );
      }
      if (higherTimeframeLabel) {
        textValue = textValue.replace(
          /\u9031\u8db3\s*/g,
          `${higherTimeframeLabel} `,
        );
      }
      const rowCount = Number(calculatedData?.rowCount);
      if (Number.isInteger(rowCount) && rowCount >= 0) {
        const rowCountLabel = rowCount.toLocaleString("ja-JP");
        textValue = textValue
          .replace(
            /\u56fa\u5b9a\u6bcd\u96c6\u56e3\s*[0-9,]+\u4ef6/g,
            `\u56fa\u5b9a\u6bcd\u96c6\u56e3 ${rowCountLabel}\u4ef6`,
          )
          .replace(
            /\u5168[0-9,]+\u4ef6\u6bd4/g,
            `\u5168${rowCountLabel}\u4ef6\u6bd4`,
          );
      }
      node.nodeValue = textValue;
    });

    //値設定 : 画面本文と同じ時間足表記へブラウザtitle変換
    let titleValue = document.title;
    labelByDay.forEach((barLabel, dayLabel) => {
      titleValue = titleValue.replaceAll(dayLabel, barLabel);
    });
    titleValue = titleValue
      .replaceAll("5/10/20\u65e5", "5/10/20\u672c")
      .replaceAll("5\u65e5", "5\u672c")
      .replaceAll("10\u65e5", "10\u672c")
      .replaceAll("20\u65e5", "20\u672c");
    const targetTimeframeLabel = selectTimeframeLabel(
      calculatedData?.targetTimeframe,
    );
    const higherTimeframeLabel = selectTimeframeLabel(
      calculatedData?.higherTimeframe,
    );
    if (targetTimeframeLabel) {
      titleValue = titleValue.replace(/\u65e5\u8db3\s*/g, `${targetTimeframeLabel} `);
    }
    if (higherTimeframeLabel) {
      titleValue = titleValue.replace(/\u9031\u8db3\s*/g, `${higherTimeframeLabel} `);
    }
    document.title = titleValue;

    const baseline = calculatedData?.baseline;
    if (baseline && Number.isInteger(Number(calculatedData?.rowCount))) {
      const summaryValueByLabel = new Map([
        [
          "\u57fa\u6e96\u30b7\u30b0\u30ca\u30eb",
          Number(calculatedData.rowCount).toLocaleString("ja-JP"),
        ],
        ["5\u672c\u6b63\u89e3\u7387", formatSummaryPercentage(baseline.win5dPct)],
        ["10\u672c\u6b63\u89e3\u7387", formatSummaryPercentage(baseline.win10dPct)],
        ["20\u672c\u6b63\u89e3\u7387", formatSummaryPercentage(baseline.win20dPct)],
      ]);
      document.querySelectorAll(".card").forEach((card) => {
        const label = card.querySelector(".label")?.textContent?.trim();
        const metric = card.querySelector(".metric");
        const summaryValue = summaryValueByLabel.get(label);
        if (metric && summaryValue) metric.textContent = summaryValue;
      });
    }
    document.documentElement.dataset.p2HorizonUnit = "bar";
  }

  // [F4510] \u672c\u6570\u8a55\u4fa1profile\u306e\u57fa\u6e96\u6b63\u89e3\u7387\u3092\u5c0f\u6570\u7b2c2\u4f4d\u3067\u6574\u5f62\u3059\u308b\u3002
  function formatSummaryPercentage(value) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? `${numberValue.toFixed(2)}%` : "-";
  }

  // [F4511] provider\u975e\u4f9d\u5b58\u306e\u6642\u9593\u8db3ID\u3092\u753b\u9762\u8868\u793a\u540d\u3078\u5909\u63db\u3059\u308b\u3002
  function selectTimeframeLabel(value) {
    return typeof value === "string" && /^tf_[A-Za-z0-9]+$/.test(value)
      ? value.slice(3)
      : "";
  }

  // [F3716] active analysis setを同一originの全内部HTML遷移へ継承する。
  // Case37 traceability: [S016] [I3707] [O3706] [V3713] [V3714]
  function registAnalysisSetNavigation(query) {
    const analysisSetId = selectBreadcrumbValue(query.get("analysis_set"));
    if (!analysisSetId) return;

    document.querySelectorAll('a[href]').forEach((link) => {
      const hrefValue = link.getAttribute("href");
      if (!hrefValue || hrefValue.startsWith("#")) return;
      try {
        const targetUrl = new URL(hrefValue, window.location.href);
        const targetPage = targetUrl.pathname.split("/").pop() || "";
        if (targetUrl.origin !== window.location.origin || !targetPage.endsWith(".html")) return;
        targetUrl.searchParams.set("analysis_set", analysisSetId);
        const queryIndex = hrefValue.search(/[?#]/);
        const targetPath = queryIndex >= 0
          ? hrefValue.slice(0, queryIndex)
          : hrefValue;
        link.setAttribute(
          "href",
          `${targetPath}${targetUrl.search}${targetUrl.hash}`
        );
      } catch (_error) {
        //不正URLは既存allowlist検証へ委譲する。
      }
    });
  }

  // [F3601] [L3601-L3604] 現在pageとqueryから安全な共通パンくずリストを登録する。
  function registBreadcrumb(pageType, query, analysisContext = null) {
    if (document.querySelector("[data-p2-breadcrumb]")) return;

    registBreadcrumbStyle();
    const datasetKey = selectBreadcrumbValue(query.get("dataset"));
    const subjectKey = selectBreadcrumbValue(query.get("subject"));
    const analysisKey = selectBreadcrumbValue(query.get("analysis"));
    const typeCondition = selectBreadcrumbValue(query.get("type"));
    const items = selectBreadcrumbItems(
      pageType,
      datasetKey,
      subjectKey,
      analysisKey,
      typeCondition,
      analysisContext,
    );
    const navigation = document.createElement("nav");
    const list = document.createElement("ol");
    navigation.className = "p2-breadcrumb";
    navigation.dataset.p2Breadcrumb = "true";
    navigation.setAttribute("aria-label", "パンくずリスト");
    list.className = "p2-breadcrumb-list";

    items.forEach((item, index) => {
      const listItem = document.createElement("li");
      const isCurrent = index === items.length - 1;
      listItem.className = "p2-breadcrumb-item";

      //現在pageの場合
      if (isCurrent) {
        const current = document.createElement("span");
        current.textContent = item.label;
        current.setAttribute("aria-current", "page");
        listItem.appendChild(current);
      } else {
        const link = document.createElement("a");
        link.href = item.href;
        link.textContent = item.label;
        listItem.appendChild(link);
      }
      list.appendChild(listItem);
    });

    navigation.appendChild(list);
    const container = document.querySelector(".wrap") || document.body;
    container.insertBefore(navigation, container.firstChild);
  }

  // [F3602] パンくず専用stylesheetを一度だけ読み込む。
  function registBreadcrumbStyle() {
    if (document.querySelector('link[data-p2-breadcrumb-style="true"]')) return;

    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = "_runtime/p2_breadcrumb.css";
    style.dataset.p2BreadcrumbStyle = "true";
    document.head.appendChild(style);
  }

  // [F3603] page種別に対応する親pageと現在pageを取得する。
  function selectBreadcrumbItems(
    pageType,
    datasetKey,
    subjectKey,
    analysisKey = "",
    typeCondition = "",
    analysisContext = null,
  ) {
    const items = [{ label: "ホーム", href: "index.html" }];
    const datasetLabel = selectDatasetLabel(datasetKey, analysisContext);
    const datasetHref = createBreadcrumbUrl("dataset.html", { dataset: datasetKey });
    const hasDataset = Boolean(datasetKey) && pageType !== "index" && pageType !== "comparison";

    //データセット配下の場合
    if (hasDataset) {
      items.push({ label: datasetLabel, href: datasetHref });
    }

    //page種別ごとの場合
    if (pageType === "index") {
      items[0].href = "";
    } else if (pageType === "dataset") {
      items[items.length - 1].href = "";
    } else if (pageType === "conditions") {
      const label = typeCondition === "or" ? "複数条件組み合わせ" : "条件一覧";
      items.push({ label, href: "" });
    } else if (pageType === "condition") {
      items.push({
        label: "条件一覧",
        href: createBreadcrumbUrl("conditions.html", { dataset: datasetKey }),
      });
      items.push({ label: "条件詳細", href: "" });
    } else if (pageType === "or-condition") {
      items.push({
        label: "複数条件組み合わせ",
        href: createBreadcrumbUrl("conditions.html", { dataset: datasetKey, type: "or" }),
      });
      items.push({ label: "組み合わせ詳細", href: "" });
    } else if (pageType === "ranking") {
      items.push({ label: "注目条件", href: "" });
    } else if (pageType === "graph") {
      registGraphBreadcrumbItems(items, datasetKey, subjectKey);
    } else if (pageType === "comparison") {
      items.push({ label: "比較分析", href: "" });
    } else if (pageType === "validation") {
      items.push({ label: "検証結果", href: "" });
    } else if (pageType === "signal") {
      items.push({ label: "シグナル分析", href: "" });
    } else if (pageType === "analysis") {
      const analysisLabels = Object.freeze({
        monthly: "月別基準成績",
        monthly_candidate_stability: "候補の月次安定性",
      });
      items.push({ label: analysisLabels[analysisKey] || "分析詳細", href: "" });
    }

    return items;
  }

  // [T5211] active analysis contextを優先してdataset表示名を取得する。
  function selectDatasetLabel(datasetKey, analysisContext) {
    const assetClass = analysisContext?.assetClass || "";
    const instrumentDisplayName = analysisContext?.instrumentDisplayName || "";
    if (instrumentDisplayName && assetClass !== "equity_universe") {
      return instrumentDisplayName;
    }
    return datasetLabelByKey[datasetKey] || instrumentDisplayName || "データセット";
  }

  // [T5212] Electronまたは生成済みcatalogからURL指定analysis contextを取得する。
  async function selectPageAnalysisContext(query) {
    const requestedAnalysisSetId = selectBreadcrumbValue(
      query?.get("analysis_set"),
    );
    const bridge = window.productKabuLocal;
    if (bridge && typeof bridge.selectAnalysisSet === "function") {
      const response = await bridge.selectAnalysisSet();
      if (response?.ok && requestedAnalysisSetId) {
        const requestedContext = response.result?.options?.find(
          (item) => item.analysisSetId === requestedAnalysisSetId,
        );
        if (requestedContext) return requestedContext;
        throw new Error(`分析セットが登録されていません: ${requestedAnalysisSetId}`);
      }
      if (response?.ok && response.result?.active) return response.result.active;
    }
    try {
      const catalog = await selectJson("data/catalog.json");
      return catalog?.analysisContext || null;
    } catch (_error) {
      return null;
    }
  }

  // [T5213] 主要225株固定文言をactive銘柄名へ置換する。
  function registAnalysisContextLabels(analysisContext) {
    const assetClass = analysisContext?.assetClass || "";
    const instrumentDisplayName = analysisContext?.instrumentDisplayName || "";
    if (!instrumentDisplayName || assetClass === "equity_universe") return;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((node) => {
      node.nodeValue = (node.nodeValue || "")
        .replaceAll("主要225株", instrumentDisplayName)
        .replaceAll("225株", instrumentDisplayName);
    });
    document.title = document.title
      .replaceAll("主要225株", instrumentDisplayName)
      .replaceAll("225株", instrumentDisplayName);
  }

  // [T5214] 月次計算dataに合わせて旧固定母集団の期間・件数・銘柄数表記を更新する。
  function registCalculatedContextLabels(calculatedData, pageType) {
    if (!calculatedData || typeof calculatedData !== "object") return;

    const rowCount = Number(calculatedData.rowCount);
    const tickerCount = Number(calculatedData.tickerCount);
    const months = Array.isArray(calculatedData.months) ? calculatedData.months : [];
    const firstMonth = String(months[0] || "");
    const lastMonth = String(months.at(-1) || "");
    const firstYear = firstMonth.slice(0, 4);
    const lastYear = lastMonth.slice(0, 4);
    const rowCountLabel = Number.isInteger(rowCount)
      ? rowCount.toLocaleString("ja-JP")
      : "";
    const tickerCountLabel = Number.isInteger(tickerCount)
      ? tickerCount.toLocaleString("ja-JP")
      : "";
    const monthCountLabel = months.length.toLocaleString("ja-JP");
    const isNonEquityUniverse = calculatedData.assetClass
      && calculatedData.assetClass !== "equity_universe";
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((node) => {
      const parent = node.parentElement;
      if (parent?.closest("table")) return;

      let textValue = node.nodeValue || "";
      if (firstYear && lastYear) {
        textValue = textValue
          .replace(/2008\s*-\s*2026/g, `${firstYear} - ${lastYear}`)
          .replace(/2008\s*～\s*2026/g, `${firstYear}～${lastYear}`);
      }
      if (rowCountLabel) {
        textValue = textValue
          .replaceAll("181,318", rowCountLabel)
          .replace(/\b52,938(?=件baseline)/g, rowCountLabel);
      }
      if (tickerCountLabel) {
        textValue = textValue
          .replace(/全225銘柄/g, `全${tickerCountLabel}銘柄`)
          .replace(/225銘柄/g, `${tickerCountLabel}銘柄`);
      }
      if (months.length) {
        textValue = textValue
          .replace(/224\s*か月/g, `${monthCountLabel}か月`)
          .replace(/224\s*行/g, `${monthCountLabel} 行`);
      }
      if (isNonEquityUniverse) textValue = textValue.replaceAll("P2 Long", "P2");
      node.nodeValue = textValue;
    });

    let titleValue = document.title;
    if (firstYear && lastYear) {
      titleValue = titleValue.replace(/2008\s*-\s*2026/g, `${firstYear} - ${lastYear}`);
    }
    if (rowCountLabel) titleValue = titleValue.replaceAll("181,318", rowCountLabel);
    if (tickerCountLabel) titleValue = titleValue.replace(/225銘柄/g, `${tickerCountLabel}銘柄`);
    document.title = titleValue;

    //比較画面の場合
    if (pageType === "comparison") {
      registComparisonSummary(calculatedData);
    }
  }

  // [T5215] 比較画面の基準正解率と母集団件数を現在の月次計算dataへ揃える。
  function registComparisonSummary(calculatedData) {
    const baseline = calculatedData.baseline || {};
    const rowCount = Number(calculatedData.rowCount);
    const note = document.querySelector(".links[data-p2-page-navigation] + .note")
      || document.querySelector(".links + .note");
    if (!note || !Number.isInteger(rowCount)) return;

    const labels = [5, 10, 20].map((horizon) => {
      const value = formatSummaryPercentage(baseline[`win${horizon}dPct`]);
      return `${horizon}${calculatedData.horizonUnit === "bar" ? "本" : "日"} ${value}`;
    });
    note.textContent = `baseline: ${labels.join(" / ")}。差はこの${rowCount.toLocaleString("ja-JP")}件baselineに対するpercentage point差です。状態名をクリックすると月別エントリー本数・勝率グラフを開きます。`;

    //値設定 : 現在の月次計算dataに対応する比較説明
    const comparison = calculatedData.comparison || {};
    const conditionCount = Number.isInteger(Number(comparison.conditionCount))
      ? Number(comparison.conditionCount)
      : (Array.isArray(comparison.conditions) ? comparison.conditions.length : 0);
    const priorityRowCount = Number.isInteger(Number(comparison.priorityRowCount))
      ? Number(comparison.priorityRowCount)
      : (Array.isArray(comparison.priorityRows) ? comparison.priorityRows.length : 0);
    const conclusion = document.querySelector(".conclusion");
    if (!conclusion) return;

    conclusion.replaceChildren();
    const summary = document.createElement("p");
    summary.textContent = `${conditionCount.toLocaleString("ja-JP")}状態を同一基準で比較しています。件数、5本・10本・20本の正解率、baseline差および平均リターンを確認できます。`;
    const priority = document.createElement("p");
    priority.textContent = `優先確認候補は20本のbaseline差を優先し、同値の場合は件数順で上位${priorityRowCount.toLocaleString("ja-JP")}状態を表示します。これはresearch上の比較であり、production採用条件ではありません。`;
    conclusion.append(summary, priority);

    //旧release固定条件の説明が残る場合
    document.querySelectorAll(".note").forEach((element) => {
      const textValue = element.textContent || "";
      if (!textValue.includes("件数500件以上")
        && !textValue.includes("すべてbaseline超え")) return;
      element.textContent = `${conditionCount.toLocaleString("ja-JP")}状態を現在の月次計算結果で比較しています。小標本の突出値は件数・月次安定性と併せて確認してください。`;
    });
  }

  // [F3604] graph subject種別に対応する一覧・詳細pageを追加する。
  function registGraphBreadcrumbItems(items, datasetKey, subjectKey) {
    if (/^h-/.test(subjectKey)) {
      items.push({
        label: "注目条件",
        href: createBreadcrumbUrl("ranking.html", { dataset: datasetKey }),
      });
    } else if (/^or-/.test(subjectKey)) {
      items.push({
        label: "複数条件組み合わせ",
        href: createBreadcrumbUrl("conditions.html", { dataset: datasetKey, type: "or" }),
      });
      items.push({
        label: "複数条件組み合わせ詳細",
        href: createBreadcrumbUrl("or-condition.html", {
          dataset: datasetKey,
          condition_type: "single",
          condition: subjectKey,
        }),
      });
    } else {
      items.push({
        label: "条件一覧",
        href: createBreadcrumbUrl("conditions.html", { dataset: datasetKey }),
      });
      items.push({
        label: "条件詳細",
        href: createBreadcrumbUrl("condition.html", {
          dataset: datasetKey,
          condition_type: "single",
          condition: subjectKey,
        }),
      });
    }
    items.push({ label: "グラフ", href: "" });
  }

  // [T3601] URLへ使用するquery値を既存allowlist形式に制限する。
  function selectBreadcrumbValue(value) {
    return typeof value === "string" && allowedValuePattern.test(value) ? value : "";
  }

  // [T3602] 空値を除外して同一originの相対URLを作成する。
  function createBreadcrumbUrl(pageName, values) {
    const query = new URLSearchParams();
    Object.entries(values).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const queryText = query.toString();
    return queryText ? `${pageName}?${queryText}` : pageName;
  }

  // [F3605] [L3605] 戻るlinkへ安全な履歴移動とpage別fallbackを設定する。
  function registPageBackLink(pageType, query) {
    const backLink = document.getElementById("p2BackLink");
    if (!backLink) return;

    //値設定 : page別fallback
    backLink.href = selectBackFallbackUrl(pageType, query);

    //戻るlink選択の場合
    backLink.addEventListener("click", (event) => {
      if (!hasSameApplicationReferrer()) return;

      //履歴移動
      event.preventDefault();
      window.history.back();
    });
  }

  // [T3606] 現在pageとqueryに対応する戻るfallback URLを取得する。
  function selectBackFallbackUrl(pageType, query) {
    const datasetKey = selectBreadcrumbValue(query.get("dataset"));
    const fallbackPageByType = {
      dataset: "index.html",
      conditions: "dataset.html",
      condition: "conditions.html",
      "or-condition": "conditions.html",
      ranking: "dataset.html",
      comparison: "index.html",
      validation: "dataset.html",
      signal: "analysis.html",
      analysis: "dataset.html",
    };
    const fallbackPage = fallbackPageByType[pageType] || "index.html";

    //datasetを保持するpageの場合
    if (fallbackPage !== "index.html") {
      return createBreadcrumbUrl(fallbackPage, { dataset: datasetKey });
    }
    return fallbackPage;
  }

  // [T3607] 直前URLが同一application内の別pageであることを確認する。
  function hasSameApplicationReferrer() {
    if (!document.referrer) return false;

    try {
      const currentUrl = new URL(window.location.href);
      const referrerUrl = new URL(document.referrer, currentUrl);
      const isAllowedPage = /\/(?:index|dataset|conditions|condition|or-condition|ranking|graph|comparison|validation|signal|analysis)\.html$/.test(
        referrerUrl.pathname,
      );
      const currentRoot = currentUrl.pathname.replace(/[^/]+$/, "");
      return referrerUrl.origin === currentUrl.origin
        && referrerUrl.pathname.startsWith(currentRoot)
        && referrerUrl.href !== currentUrl.href
        && isAllowedPage;
    } catch (_error) {
      return false;
    }
  }

  // [F3606] dataset配下の既存navigationを現在datasetと共通pageへ統一する。
  function registDatasetNavigation(pageType, query) {
    const datasetKey = selectBreadcrumbValue(query.get("dataset"));
    if (!datasetKey || pageType === "index") return;

    const allowedPagePattern = /^(?:dataset|conditions|condition|or-condition|ranking|graph|validation|signal|analysis)\.html$/;
    document.querySelectorAll('a[href]').forEach((link) => {
      const hrefValue = link.getAttribute("href");
      if (!hrefValue || hrefValue.startsWith("#")) return;

      try {
        const targetUrl = new URL(hrefValue, window.location.href);
        const targetPage = targetUrl.pathname.split("/").pop() || "";
        if (targetUrl.origin !== window.location.origin
          || !allowedPagePattern.test(targetPage)) return;
        targetUrl.searchParams.set("dataset", datasetKey);
        link.href = `${targetPage}${targetUrl.search}`;
      } catch (_error) {
        //不正URLは既存allowlist検証へ委譲する。
      }
    });

    //dataset概要以外の場合
    if (pageType !== "dataset") return;

    //複数条件組み合わせの表示名と説明をOR計算dataの用途へ一致させる。
    registMultipleConditionNavigation();

    //独立情報を持たない詳細ナビゲーションcardは表示しない。
    Array.from(document.querySelectorAll(".card h3"))
      .find((heading) => heading.textContent.trim() === "詳細ナビゲーション")
      ?.closest(".card")
      ?.remove();

    const navigationByHeading = Object.freeze({
      "単独指標": ["conditions.html", "type", "single"],
      "2因子組み合わせ": ["conditions.html", "type", "pair"],
      "3因子組み合わせ": ["conditions.html", "type", "triple"],
      "条件別結果": ["conditions.html", "", ""],
      "複数条件組み合わせ": ["conditions.html", "type", "or"],
      "月別（YYYY-MM）基準成績": ["analysis.html", "analysis", "monthly"],
      "候補の月次安定性": ["analysis.html", "analysis", "monthly_candidate_stability"],
    });
    document.querySelectorAll(".card h3").forEach((heading) => {
      const target = navigationByHeading[heading.textContent.trim()];
      const link = heading.closest(".card")?.querySelector("a.btn");
      if (!target || !link) return;

      const parameters = new URLSearchParams({ dataset: datasetKey });
      if (target[1]) parameters.set(target[1], target[2]);
      link.href = `${target[0]}?${parameters.toString()}`;
    });

    registDatasetNavigationLayout();
  }

  // [T3815] OR計算dataの利用者向け名称と説明を複数条件組み合わせへ統一する。
  function registMultipleConditionNavigation() {
    const sectionHeading = Array.from(document.querySelectorAll(".wrap > h2"))
      .find((element) => element.textContent.trim() === "OR条件分析");
    const cardHeading = Array.from(document.querySelectorAll(".card h3"))
      .find((element) => element.textContent.trim() === "OR組み合わせ検証");
    if (sectionHeading) sectionHeading.textContent = "複数条件組み合わせ";
    if (!cardHeading) return;

    const card = cardHeading.closest(".card");
    const description = card?.querySelector("p");
    const link = card?.querySelector("a.btn");
    cardHeading.textContent = "複数条件組み合わせ";
    if (description) {
      description.textContent = "2つまたは3つの条件をORで結合し、いずれかが成立した場合の件数・正解率・増加率を比較します。";
    }
    if (link) link.textContent = "複数条件組み合わせを確認 →";
  }

  // [T3817] 分析navigationと月次・安定性を説明付き2列cardへ整える。
  function registDatasetNavigationLayout() {
    registDatasetNavigationStyle();
    const descriptions = Object.freeze({
      "単独指標": "1つの条件だけで抽出した結果を確認します。",
      "2因子組み合わせ": "2つの条件が同時に成立する結果を確認します。",
      "3因子組み合わせ": "3つの条件が同時に成立する結果を確認します。",
      "条件別結果": "単独・2因子・3因子の全条件を同じ表で確認します。",
      "月別（YYYY-MM）基準成績": "基準シグナルの件数・正解率を月単位で確認します。",
      "候補の月次安定性": "注目候補の月次中央値とばらつきを比較します。",
    });
    const sectionNames = new Set(["分析ナビゲーション", "月次・安定性"]);
    Array.from(document.querySelectorAll(".wrap > h2"))
      .filter((heading) => sectionNames.has(heading.textContent.trim()))
      .forEach((heading) => {
        const grid = heading.nextElementSibling;
        if (!grid?.classList.contains("grid")) return;
        grid.classList.add("p2-navigation-grid");
        Array.from(grid.querySelectorAll(":scope > .card")).forEach((card) => {
          const cardHeading = card.querySelector("h3");
          const label = cardHeading?.textContent.trim() || "";
          const link = card.querySelector("a.btn");
          let description = card.querySelector("p");
          card.classList.add("p2-navigation-card");
          if (!description && descriptions[label]) {
            description = document.createElement("p");
            if (link) card.insertBefore(description, link);
            else card.appendChild(description);
          }
          if (description && descriptions[label]) {
            description.textContent = descriptions[label];
          }
        });
      });
  }

  // [T3818] dataset navigation専用styleを重複なしで登録する。
  function registDatasetNavigationStyle() {
    if (document.getElementById("p2-dataset-navigation-style")) return;

    const style = document.createElement("style");
    style.id = "p2-dataset-navigation-style";
    style.textContent = `
      .p2-navigation-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
      }
      .p2-navigation-card {
        display: flex;
        min-height: 156px;
        flex-direction: column;
        padding: 20px;
        border-top: 4px solid #2f5f9f;
      }
      .p2-navigation-card h3 {
        margin: 0 0 10px;
        color: #172b4d;
      }
      .p2-navigation-card p {
        margin: 0 0 18px;
        color: #526277;
        line-height: 1.7;
      }
      .p2-navigation-card .btn {
        align-self: flex-start;
        margin-top: auto;
      }
      @media (max-width: 800px) {
        .p2-navigation-grid {
          grid-template-columns: minmax(0, 1fr);
        }
      }
    `;
    document.head.appendChild(style);
  }

  // [F5216] 現在の分析runに属するシグナル明細を50件単位で表示する。
  async function registSignalView(viewModel, request) {
    let signalDetail = viewModel.signalDetailData || null;
    if (!signalDetail && viewModel.signalDetailPath) {
      if (!isAllowedSignalDetailPath(viewModel.signalDetailPath)) {
        throw new Error(`シグナル明細JSONが不正です: ${viewModel.dataset}`);
      }
      signalDetail = await selectJson(`data/${viewModel.signalDetailPath}`);
    }
    if (!signalDetail || typeof signalDetail !== "object") {
      throw new Error("シグナル明細データがありません。");
    }

    const pageSize = 50;
    const requestedPage = Number(request.part || 1);
    const totalRowCount = Number(signalDetail.totalRowCount ?? signalDetail.rowCount);
    if (!Number.isInteger(requestedPage) || requestedPage < 1
      || !Number.isInteger(totalRowCount) || totalRowCount < 0) {
      throw new Error("シグナル明細のページ指定が不正です。");
    }

    const totalPages = Math.max(1, Math.ceil(totalRowCount / pageSize));
    if (requestedPage > totalPages) {
      throw new Error("シグナル明細のページが範囲外です。");
    }
    const pageData = selectSignalPageData(signalDetail, requestedPage, pageSize);
    const wrap = document.querySelector(".wrap");
    const hero = wrap?.querySelector(":scope > .hero");
    const navigation = wrap?.querySelector(":scope > .links[data-p2-page-navigation]")
      || wrap?.querySelector(":scope > .links");
    if (!wrap || !hero || !navigation) {
      throw new Error("シグナル明細templateがありません。");
    }

    Array.from(wrap.children).forEach((element) => {
      if (element !== hero && element !== navigation) element.remove();
    });
    const instrumentName = viewModel.calculatedData?.instrumentDisplayName || "分析対象";
    const heading = hero.querySelector("h1");
    const description = hero.querySelector("p");
    if (heading) heading.textContent = `P2 ${instrumentName} シグナル明細`;
    if (description) {
      description.textContent = `${instrumentName} P2 / ${totalRowCount.toLocaleString("ja-JP")}件`;
    }
    document.title = `P2 ${instrumentName} シグナル明細`;

    const section = document.createElement("section");
    const sectionHeading = document.createElement("h2");
    const summary = document.createElement("p");
    const toolbar = createSignalPager(
      viewModel.dataset,
      requestedPage,
      totalPages,
      pageData.startRow,
      pageData.endRow,
      totalRowCount,
    );
    const tableWrap = document.createElement("div");
    const table = document.createElement("table");
    section.className = "card";
    section.dataset.p2SignalView = "true";
    sectionHeading.textContent = "シグナル明細";
    summary.textContent = "現在の月次計算runと同じ母集団から、判定日時の新しい順に表示します。";
    tableWrap.className = "table-wrap";
    table.className = "focus-table p2-signal-table";
    table.dataset.p2SignalTable = "true";
    table.appendChild(createSignalPageHead(viewModel.calculatedData?.horizonUnit));
    table.appendChild(createSignalPageBody(pageData.rows));
    tableWrap.appendChild(table);
    section.append(sectionHeading, summary, toolbar, tableWrap);
    wrap.appendChild(section);
  }

  // [T5216] 全signalまたはElectron抽出済みsignalから指定pageの行indexを取得する。
  function selectSignalPageData(signalDetail, requestedPage, pageSize) {
    const isPageSubset = signalDetail.pageSubset === true;
    const rowCount = Number(signalDetail.rowCount);
    const dateCodes = signalDetail.codes?.dates || [];
    let indexes = Array.from({ length: rowCount }, (_value, index) => index);
    if (!isPageSubset) {
      indexes.sort((left, right) => Number(dateCodes[right]) - Number(dateCodes[left]));
      const startIndex = (requestedPage - 1) * pageSize;
      indexes = indexes.slice(startIndex, startIndex + pageSize);
    }

    const totalRowCount = Number(signalDetail.totalRowCount ?? rowCount);
    const startRow = totalRowCount === 0 ? 0 : ((requestedPage - 1) * pageSize) + 1;
    const endRow = Math.min(totalRowCount, startRow + indexes.length - 1);
    return {
      rows: indexes.map((index) => createSignalPageRow(signalDetail, index)),
      startRow,
      endRow,
    };
  }

  // [T5217] signal辞書codeを画面表示用の9列へ変換する。
  function createSignalPageRow(signalDetail, index) {
    const dictionaries = signalDetail.dictionaries || {};
    const codes = signalDetail.codes || {};
    const selectText = (name) => dictionaries[name]?.[codes[name]?.[index]] ?? "-";
    return [
      selectText("dates"),
      selectText("tickers"),
      selectText("patterns"),
      selectText("regimes"),
      ...[5, 10, 20].map((horizon) => signalDetail.wins?.[horizon]?.[index] ?? "-"),
      ...[5, 10, 20].map(
        (horizon) => formatCalculatedNumber(signalDetail.returns?.[horizon]?.[index], 2),
      ),
    ];
  }

  // [T5218] シグナル明細の正解・リターンを含む10列headerを作成する。
  function createSignalPageHead(horizonUnit) {
    const head = document.createElement("thead");
    const groupRow = document.createElement("tr");
    const detailRow = document.createElement("tr");
    ["判定日時", "銘柄", "パターン", "相場状態"].forEach((label) => {
      groupRow.appendChild(createAnalysisHeaderCell(label, 1, 2));
    });
    groupRow.appendChild(createAnalysisHeaderCell("正解", 3, 1, "group-start"));
    groupRow.appendChild(createAnalysisHeaderCell("リターン", 3, 1, "group-start"));
    const suffix = horizonUnit === "bar" ? "本" : "日";
    [5, 10, 20, 5, 10, 20].forEach((horizon, index) => {
      const className = [0, 3].includes(index) ? "group-start" : "";
      detailRow.appendChild(createAnalysisHeaderCell(`${horizon}${suffix}`, 1, 1, className));
    });
    head.append(groupRow, detailRow);
    return head;
  }

  // [T5219] シグナル明細の表示行を安全なDOMへ変換する。
  function createSignalPageBody(rows) {
    const body = document.createElement("tbody");
    rows.forEach((values) => {
      const row = document.createElement("tr");
      values.forEach((value, index) => {
        const className = [4, 7].includes(index) ? "group-start" : "";
        row.appendChild(createAnalysisDataCell(value, className));
      });
      body.appendChild(row);
    });
    return body;
  }

  // [T5220] シグナル明細の前後page導線と表示範囲を作成する。
  function createSignalPager(dataset, page, totalPages, startRow, endRow, totalRowCount) {
    const toolbar = document.createElement("div");
    const status = document.createElement("strong");
    toolbar.className = "toolbar";
    status.textContent = `${totalRowCount.toLocaleString("ja-JP")}件中 ${startRow.toLocaleString("ja-JP")}～${endRow.toLocaleString("ja-JP")}件 / ${page} / ${totalPages}`;
    toolbar.appendChild(status);
    [["前へ", page - 1], ["次へ", page + 1]].forEach(([label, targetPage]) => {
      const link = document.createElement("a");
      link.className = "btn";
      link.textContent = label;
      if (targetPage >= 1 && targetPage <= totalPages) {
        link.href = createBreadcrumbUrl("signal.html", {
          dataset: selectBreadcrumbValue(dataset),
          part: String(targetPage),
        });
      } else {
        link.setAttribute("aria-disabled", "true");
      }
      toolbar.appendChild(link);
    });
    return toolbar;
  }

  // [F3610] 分析詳細物理pageをquery別の独立した画面へ切り替える。
  function registAnalysisView(pageType, request, viewModel) {
    if (pageType !== "analysis") return false;

    const analysisKey = request.analysis || "monthly";
    if (analysisKey === "monthly") return false;
    if (analysisKey === "monthly_candidate_stability") {
      registMonthlyCandidateStabilityView(viewModel, request.dataset);
      return true;
    }
    if (analysisKey === "navigation") {
      window.location.replace(createBreadcrumbUrl("dataset.html", {
        dataset: selectBreadcrumbValue(request.dataset || viewModel.dataset),
      }));
      return true;
    }
    throw new Error(`許可されていない分析画面です: ${analysisKey}`);
  }

  // [T3610] 分析詳細templateの月別基準表だけを専用画面用に取り除く。
  function clearAnalysisTemplateContent() {
    const wrap = document.querySelector(".wrap");
    if (!wrap) throw new Error("分析画面templateがありません。");

    wrap.querySelectorAll(":scope > .toolbar, :scope > .table-wrap, :scope > .pager, :scope > .footer, :scope > .p2-accuracy-legend")
      .forEach((element) => element.remove());
    wrap.querySelectorAll(":scope > [data-p2-analysis-view]")
      .forEach((element) => element.remove());
    return wrap;
  }

  // [T3611] 分析詳細画面のtitleと説明をqueryの用途へ一致させる。
  function registAnalysisHeading(title, description) {
    const heading = document.querySelector(".hero h1");
    const paragraph = document.querySelector(".hero p");
    if (heading) heading.textContent = title;
    if (paragraph) paragraph.textContent = description;
    document.title = title;
  }

  // [F3611] 現行候補の月次件数・正解率分布を独立した安定性表へ登録する。
  function registMonthlyCandidateStabilityView(viewModel, datasetValue) {
    const calculatedData = viewModel.calculatedData;
    const conditions = selectMonthlyStabilityConditions(calculatedData);
    if (!conditions.length) {
      throw new Error("候補の月次安定性データがありません。");
    }

    const dataset = selectBreadcrumbValue(datasetValue || viewModel.dataset);
    const wrap = clearAnalysisTemplateContent();
    registAnalysisHeading(
      "候補の月次安定性",
      `${conditions.length.toLocaleString("ja-JP")}候補について、月ごとの件数と5D・10D・20D正解率のばらつきを確認します。`,
    );

    const section = document.createElement("section");
    const note = document.createElement("p");
    const tableWrap = document.createElement("div");
    const table = document.createElement("table");
    section.className = "card";
    section.dataset.p2AnalysisView = "monthly-candidate-stability";
    note.className = "note";
    note.textContent = "月3件以上の指標は、該当月だけを対象にしています。標準偏差が小さいほど、月ごとの正解率のばらつきが小さいことを示します。";
    tableWrap.className = "table-wrap";
    table.className = "focus-table p2-monthly-stability-table";
    table.dataset.p2MonthlyStabilityTable = "true";
    table.appendChild(createMonthlyStabilityHead());
    table.appendChild(createMonthlyStabilityBody(conditions, dataset));
    tableWrap.appendChild(table);
    section.appendChild(note);
    section.appendChild(tableWrap);
    selectAnalysisInsertionPoint(wrap).insertAdjacentElement("afterend", section);
    registLargeTableControllers(section);
  }

  // [T3612] balance順を優先し、現行ranking候補を安定性画面の表示順へ揃える。
  function selectMonthlyStabilityConditions(calculatedData) {
    const conditions = Array.isArray(calculatedData?.rankingConditions)
      ? calculatedData.rankingConditions
      : [];
    const conditionById = new Map(conditions.map((condition) => [condition.id, condition]));
    const orderedIds = Array.isArray(calculatedData?.rankingViews?.balance)
      ? calculatedData.rankingViews.balance
      : [];
    const ordered = orderedIds.map((id) => conditionById.get(id)).filter(Boolean);
    const includedIds = new Set(ordered.map((condition) => condition.id));
    return [
      ...ordered,
      ...conditions.filter((condition) => !includedIds.has(condition.id)),
    ];
  }

  // [T3613] 候補月次安定性表の21論理列headerを作成する。
  function createMonthlyStabilityHead() {
    const head = document.createElement("thead");
    const groupRow = document.createElement("tr");
    const detailRow = document.createElement("tr");
    groupRow.className = "table-group-row";
    detailRow.className = "table-detail-row";

    ["ID", "条件", "種別"].forEach((label) => {
      groupRow.appendChild(createAnalysisHeaderCell(label, 1, 2));
    });
    [
      ["件数・頻度", 6],
      ["全期間正解率", 3],
      ["月次正解率中央値", 3],
      ["月3件以上 正解率中央値", 3],
      ["月3件以上 正解率標準偏差", 3],
    ].forEach(([label, span]) => {
      groupRow.appendChild(createAnalysisHeaderCell(label, span, 1, "group-start"));
    });
    [
      "件数", "稼働月", "稼働率", "全月平均", "月中央値", "稼働月平均",
      "5D", "10D", "20D",
      "5D", "10D", "20D",
      "5D", "10D", "20D",
      "5D", "10D", "20D",
    ].forEach((label, index) => {
      const className = [0, 6, 9, 12, 15].includes(index) ? "group-start" : "";
      detailRow.appendChild(createAnalysisHeaderCell(label, 1, 1, className));
    });
    head.appendChild(groupRow);
    head.appendChild(detailRow);
    return head;
  }

  // [T3614] colspan・rowspanを指定した安全なtable headerを作成する。
  function createAnalysisHeaderCell(label, columnSpan, rowSpan, className = "") {
    const cell = document.createElement("th");
    cell.textContent = label;
    cell.colSpan = columnSpan;
    cell.rowSpan = rowSpan;
    if (className) cell.className = className;
    return cell;
  }

  // [T3615] 現行候補を月次安定性表の本文へ登録する。
  function createMonthlyStabilityBody(conditions, dataset) {
    const body = document.createElement("tbody");
    conditions.forEach((condition) => {
      const row = document.createElement("tr");
      row.appendChild(createAnalysisDataCell(condition.id));
      row.appendChild(createMonthlyStabilityConditionCell(condition, dataset));
      row.appendChild(createAnalysisDataCell(selectConditionTypeLabel(condition)));

      const values = [
        formatCalculatedNumber(condition.count, 0),
        formatCalculatedNumber(condition.activeMonths, 0),
        formatMonthlyStabilityPercent(condition.activeMonthRatePct),
        formatCalculatedNumber(condition.averageEntriesAllMonths, 2),
        formatCalculatedNumber(condition.medianEntriesAllMonths, 2),
        formatCalculatedNumber(condition.averageEntriesActiveMonths, 2),
        ...[5, 10, 20].map((horizon) => (
          formatMonthlyStabilityPercent(condition[`win${horizon}dPct`])
        )),
        ...[5, 10, 20].map((horizon) => (
          formatMonthlyStabilityPercent(condition[`monthlyWinRateMedian${horizon}dPct`])
        )),
        ...[5, 10, 20].map((horizon) => (
          formatMonthlyStabilityPercent(condition[`monthlyWinRateMedianMinimum3_${horizon}dPct`])
        )),
        ...[5, 10, 20].map((horizon) => formatMonthlyStabilityDeviation(
          selectMonthlyWinRateDeviation(condition, horizon, 3),
        )),
      ];
      values.forEach((value, index) => {
        const className = [0, 6, 9, 12, 15].includes(index) ? "group-start" : "";
        row.appendChild(createAnalysisDataCell(value, className));
      });
      body.appendChild(row);
    });
    return body;
  }

  // [T3616] 条件名を省略表示し、同じ条件のグラフ画面へ接続する。
  function createMonthlyStabilityConditionCell(condition, dataset) {
    const cell = createAnalysisDataCell("");
    const inner = document.createElement("div");
    const link = document.createElement("a");
    const label = String(condition.label || condition.id || "-");
    cell.className = "p2-condition-col";
    cell.title = label;
    inner.className = "p2-condition-inner";
    link.textContent = label;
    link.href = createBreadcrumbUrl("graph.html", {
      dataset,
      subject_type: "condition",
      subject: selectBreadcrumbValue(condition.slug),
    });
    inner.appendChild(link);
    cell.appendChild(inner);
    return cell;
  }

  // [T3617] class付きの安全な実DOM table cellを作成する。
  function createAnalysisDataCell(value, className = "") {
    const cell = document.createElement("td");
    cell.textContent = String(value ?? "-");
    if (className) cell.className = className;
    return cell;
  }

  // [T3618] 月3件以上の月別正解率から母標準偏差を取得する。
  function selectMonthlyWinRateDeviation(condition, horizon, minimumEntries) {
    const precomputed = condition[
      `monthlyWinRateStdMinimum${minimumEntries}_${horizon}dPct`
    ];
    if (precomputed !== null && precomputed !== ""
      && Number.isFinite(Number(precomputed))) {
      return Number(precomputed);
    }

    const monthly = condition.monthly || {};
    const entries = Array.isArray(monthly.entries) ? monthly.entries : [];
    const evaluable = Array.isArray(monthly[`e${horizon}`]) ? monthly[`e${horizon}`] : [];
    const wins = Array.isArray(monthly[`w${horizon}`]) ? monthly[`w${horizon}`] : [];
    const rates = [];
    entries.forEach((entryCount, index) => {
      const evaluableCount = Number(evaluable[index]);
      const winCount = Number(wins[index]);
      if (Number(entryCount) < minimumEntries
        || !Number.isFinite(evaluableCount)
        || evaluableCount <= 0
        || !Number.isFinite(winCount)) return;
      rates.push(winCount * 100 / evaluableCount);
    });
    if (!rates.length) return null;
    const mean = rates.reduce((sum, value) => sum + value, 0) / rates.length;
    const variance = rates.reduce(
      (sum, value) => sum + ((value - mean) ** 2),
      0,
    ) / rates.length;
    return Math.sqrt(variance);
  }

  // [T3619] 標準偏差を百分率表示へ整形する。
  function formatMonthlyStabilityDeviation(value) {
    return Number.isFinite(value) ? `${formatCalculatedNumber(value, 1)}pt` : "-";
  }

  // [T3621] 欠損値を百分率記号だけの表示にせず月次指標を整形する。
  function formatMonthlyStabilityPercent(value) {
    return Number.isFinite(Number(value))
      ? `${formatCalculatedNumber(value, 1)}%`
      : "-";
  }

  // [T3620] 戻るlinkの直後へ分析専用内容を登録する。
  function selectAnalysisInsertionPoint(wrap) {
    return wrap.querySelector(":scope > .links[data-p2-page-navigation]")
      || wrap.querySelector(":scope > .links")
      || wrap.querySelector(":scope > .hero")
      || wrap.firstElementChild;
  }

  // [T420] [L404] query keyと値をallowlistで検証する。
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

  // [T421] [L404] latest・catalog・page pathを検証して表示payloadを取得する。
  async function selectPageViewModel(request) {
    const localViewModel = await selectLocalPageViewModel(request);
    if (localViewModel) {
      document.documentElement.dataset.p2DataSource = "local-run";
      registCalculatedSlotFilter(localViewModel, request);
      await registCalculatedDetailSlots(localViewModel, request);
      return localViewModel;
    }

    const latest = await selectJson("data/latest.json");
    const catalog = await selectJson("data/catalog.json");
    document.documentElement.dataset.p2DataSource = "static-data";

    //初期配布catalogの場合
    if (!catalog.defaultDataset || !catalog.pagePaths) {
      return null;
    }

    const dataset = request.dataset || catalog.defaultDataset;
    const pageKey = `${request.page}::${dataset}`;
    const fallbackKey = `${request.page}::common`;
    const pagePath = catalog.pagePaths[pageKey] || catalog.pagePaths[fallbackKey];

    if (latest.catalog !== "catalog.json" || latest.runId !== catalog.runId) {
      throw new Error("公開runが一致しません。");
    }
    if (request.run && request.run !== latest.runId) {
      throw new Error("指定runは公開最新版ではありません。");
    }
    if (!isAllowedDataPath(pagePath)) {
      throw new Error(`画面payloadがcatalogにありません: ${pageKey}`);
    }

    const viewModel = await selectJson(`data/${pagePath}`);
    const isValid = viewModel.pageType === request.page
      && viewModel.templateVersion === "release.3.0.0"
      && ["template", "nodes"].includes(viewModel.renderMode)
      && viewModel.slots
      && typeof viewModel.slots === "object"
      && !Array.isArray(viewModel.slots);

    if (!isValid) {
      throw new Error(`release.3画面表示JSONが不正です: ${request.page}`);
    }

    const calculatedPath = viewModel.calculatedDataPath
      || catalog.calculatedPaths?.[dataset];
    if (calculatedPath) {
      if (!isAllowedCalculatedDataPath(calculatedPath)) {
        throw new Error(`月次計算JSONが不正です: ${dataset}`);
      }
      const calculatedData = await selectJson(`data/${calculatedPath}`);
      if (calculatedData.dataset !== dataset
        || calculatedData.calculationContractVersion !== calculationContractVersion
        || !Array.isArray(calculatedData.conditions)
        || !Array.isArray(calculatedData.orConditions)
        || calculatedData.orConditionCount !== 60
        || !Array.isArray(calculatedData.months)
        || typeof calculatedData.views !== "object") {
        throw new Error(`月次計算JSON契約が不正です: ${dataset}`);
      }
      viewModel.calculatedData = calculatedData;
    }

    //node描画modeの場合
    if (viewModel.renderMode === "nodes") {
      if (!isAllowedDataPath(viewModel.slotDataPath)) {
        throw new Error(`slot payloadが不正です: ${request.page}`);
      }
      const slotModel = await selectJson(`data/${viewModel.slotDataPath}`);
      const isSlotValid = slotModel.pageType === request.page
        && slotModel.templateVersion === "release.3.0.0"
        && slotModel.runId === viewModel.runId
        && slotModel.slots
        && typeof slotModel.slots === "object"
        && !Array.isArray(slotModel.slots);
      if (!isSlotValid) {
        throw new Error(`release.3 slot JSONが不正です: ${request.page}`);
      }
      viewModel.slots = slotModel.slots;
    }

    registCalculatedSlotFilter(viewModel, request);
    await registCalculatedDetailSlots(viewModel, request);

    return viewModel;
  }

  // [T451] Electronでは最新合格runの最小表示payloadをIPCから取得する。
  async function selectLocalPageViewModel(request) {
    const bridge = window.productKabuLocal;
    if (!bridge || typeof bridge.selectPageData !== "function") return null;

    const response = await bridge.selectPageData(request);
    if (!response?.ok) {
      throw new Error(response?.error || "選択した分析データセットを表示できません。");
    }
    const viewModel = response.result;
    if (request.analysis_set
      && viewModel?.requestedAnalysisSetId !== request.analysis_set) {
      throw new Error(`ローカル分析セットが一致しません: ${request.analysis_set}`);
    }
    const isValid = viewModel?.pageType === request.page
      && viewModel?.templateVersion === "release.3.0.0"
      && ["template", "nodes"].includes(viewModel?.renderMode)
      && viewModel?.slots
      && typeof viewModel.slots === "object"
      && !Array.isArray(viewModel.slots);
    if (!isValid) {
      throw new Error(`ローカル画面データが不正です: ${request.page}`);
    }
    if (request.dataset && viewModel.dataset !== request.dataset) {
      throw new Error(`ローカル画面データセットが一致しません: ${request.dataset}`);
    }

    const calculatedData = viewModel.calculatedData;
    if (request.analysis_set && calculatedData
      && calculatedData.analysisSetId !== request.analysis_set) {
      throw new Error(`ローカル計算分析セットが一致しません: ${request.analysis_set}`);
    }
    if (calculatedData && (
      calculatedData.dataset !== viewModel.dataset
      || calculatedData.calculationContractVersion !== calculationContractVersion
      || !Array.isArray(calculatedData.conditions)
      || !Array.isArray(calculatedData.orConditions)
      || calculatedData.orConditionCount !== 60
      || !Array.isArray(calculatedData.months)
      || typeof calculatedData.views !== "object"
    )) {
      throw new Error(`ローカル月次計算JSON契約が不正です: ${viewModel.dataset}`);
    }
    return viewModel;
  }

  // [T430] [L3810] [L3816] 条件一覧の条件種別queryを月次計算JSONと同じ順序で適用する。
  function registCalculatedSlotFilter(viewModel, request) {
    if (request.page !== "conditions") return;
    if (!viewModel.calculatedData) return;

    const typeCondition = request.type || "all";
    if (!["all", "single", "pair", "triple", "or"].includes(typeCondition)) {
      throw new Error(`許可されていない条件種別です: ${request.type}`);
    }

    const conditions = viewModel.calculatedData?.conditions;
    const orConditions = viewModel.calculatedData?.orConditions;
    if (!Array.isArray(conditions) || !Array.isArray(orConditions)) {
      throw new Error("条件一覧と月次計算JSONの件数が一致しません。");
    }
    const selectedConditions = typeCondition === "or"
      ? orConditions
      : conditions.filter((condition) => (
        typeCondition === "all" || condition.conditionType === typeCondition
      ));
    viewModel.slots["tbody-001"] = selectedConditions.map(
      (condition) => createStandardConditionRow(condition, viewModel.dataset),
    );

    const labelByType = Object.freeze({
      all: "条件別結果一覧",
      single: "単独条件一覧",
      pair: "2因子条件一覧",
      triple: "3因子条件一覧",
      or: "複数条件組み合わせ",
    });
    const heading = document.querySelector(".hero h1");
    if (heading) heading.textContent = labelByType[typeCondition];
    document.title = labelByType[typeCondition];
  }

  // [T431] queryで選択した条件の月次・年次・rolling表を計算JSONから作成する。
  async function registCalculatedDetailSlots(viewModel, request) {
    if (!["condition", "or-condition"].includes(request.page)) return;

    const conditions = [
      ...(request.page === "or-condition"
        && Array.isArray(viewModel.calculatedData?.orConditions)
        ? viewModel.calculatedData.orConditions : []),
      ...(request.page === "condition"
        && Array.isArray(viewModel.calculatedData?.conditions)
        ? viewModel.calculatedData.conditions : []),
      ...(request.page === "condition"
        && Array.isArray(viewModel.calculatedData?.rankingConditions)
        ? viewModel.calculatedData.rankingConditions : []),
    ];
    const months = viewModel.calculatedData?.months;
    const baseline = viewModel.calculatedData?.baseline;
    if (!conditions.length || !Array.isArray(months)
      || !baseline || typeof baseline !== "object") return;

    const conditionKey = request.condition || request.subject || conditions[0]?.slug || "";
    const condition = conditions.find(
      (item) => item.slug === conditionKey || item.id === conditionKey,
    );
    if (!condition) {
      throw new Error(`指定条件が月次計算JSONにありません: ${conditionKey}`);
    }

    const title = document.querySelector(".hero h1");
    if (title) title.textContent = condition.label || condition.id;
    const description = document.querySelector(".hero p");
    if (description) {
      description.textContent = `${selectConditionTypeLabel(condition)} / 件数 ${Number(condition.count || 0).toLocaleString("ja-JP")} / 全体比率 ${formatCalculatedNumber(condition.overallSharePct, 2)}% / 月稼働率 ${formatCalculatedNumber(condition.activeMonthRatePct, 2)}%`;
    }
    document.title = condition.label || condition.id;
    let signalDetail = viewModel.signalDetailData || null;
    if (!signalDetail && viewModel.signalDetailPath) {
      if (!isAllowedSignalDetailPath(viewModel.signalDetailPath)) {
        throw new Error(`シグナル明細JSONが不正です: ${viewModel.dataset}`);
      }
      signalDetail = await selectJson(`data/${viewModel.signalDetailPath}`);
      if (signalDetail.dataset !== viewModel.dataset
        || !Number.isInteger(signalDetail.rowCount)
        || typeof signalDetail.featureCodes !== "object") {
        throw new Error(`シグナル明細JSON契約が不正です: ${viewModel.dataset}`);
      }
    }
    //OR条件の場合
    if (request.page === "or-condition") {
      if (viewModel.calculatedData?.orConditionCount !== 60) {
        throw new Error(`有効OR条件件数が不正です: ${viewModel.calculatedData?.orConditionCount}`);
      }
      viewModel.slots = createOrConditionDetailSlots(
        condition,
        months,
        baseline,
        signalDetail,
        viewModel.dataset,
      );
      registOrConditionSummary(condition, months.length, viewModel.dataset);
    } else {
      viewModel.slots = createConditionDetailSlots(
        condition,
        months,
        baseline,
        signalDetail,
        viewModel.dataset,
      );
    }
    //旧release.3 HTMLは表本文を保持しているため、現行runから作成した全slotで必ず置換する。
    viewModel.renderMode = "nodes";
  }

  // [T432] 単独・組合せ条件の詳細8表を作成する。
  function createConditionDetailSlots(condition, months, baseline, signalDetail, dataset) {
    const summary = createStandardConditionRow(condition, dataset);
    const monthlyRows = createCalculatedPeriodRows(
      condition,
      months,
      baseline,
      1,
      false,
      true,
    );
    const yearlyRows = createCalculatedPeriodRows(
      condition,
      months,
      baseline,
      12,
      false,
      true,
    );
    const rollingThreeRows = createCalculatedPeriodRows(
      condition,
      months,
      baseline,
      36,
      true,
      true,
    );
    const rollingFiveRows = createCalculatedPeriodRows(
      condition,
      months,
      baseline,
      60,
      true,
      true,
    );
    const regimeRows = createRegimeRows(condition.regimeRows);
    const signalRows = createSignalDetailRows(condition, signalDetail);

    return {
      "tbody-001": [summary],
      "tbody-002": [],
      "tbody-003": monthlyRows,
      "tbody-004": yearlyRows,
      "tbody-005": rollingThreeRows,
      "tbody-006": rollingFiveRows,
      "tbody-007": regimeRows,
      "tbody-008": signalRows,
    };
  }

  // [T2440] OR条件詳細5表を共通表ファミリーと同じ指標で作成する。
  function createOrConditionDetailSlots(
    condition,
    months,
    baseline,
    signalDetail,
    dataset,
  ) {
    const componentRows = [condition, ...(condition.components || [])].map(
      (item) => createStandardConditionRow(item, dataset),
    );
    const overviewRows = [
      ["複数構成に該当", condition.multiMatchCount, "重複率", condition.multiMatchSharePct],
      ["全構成に該当", condition.allMatchCount, "全構成重複率", condition.allMatchSharePct],
      ["最大単独件数", condition.maximumComponentCount, "OR追加件数", condition.incrementalCount],
      ["OR増加率", condition.entryExpansionPct, "OR構成数", condition.componentCount],
      ...[5, 10, 20].map((horizon) => [
        `${horizon}日 baseline差`,
        condition[`baselineUplift${horizon}dPct`],
        `${horizon}日 best単独差`,
        condition[`bestComponentDelta${horizon}dPct`],
      ]),
    ].map((values) => createNodeRow(values.map((value, index) => (
      index % 2 === 1 ? formatCalculatedNumber(value, 2) : value
    ))));

    return {
      "tbody-001": componentRows,
      "tbody-002": overviewRows,
      "tbody-003": createCalculatedPeriodRows(
        condition,
        months,
        baseline,
        1,
        false,
        true,
      ),
      "tbody-004": createCalculatedPeriodRows(
        condition,
        months,
        baseline,
        12,
        false,
        true,
      ),
      "tbody-005": createSignalDetailRows(condition, signalDetail),
    };
  }

  // [T2441] [T3806] [L3803] 条件payloadを基準36実列の共通行へ変換する。
  function createStandardConditionRow(condition, dataset) {
    const winRates = [5, 10, 20]
      .map((horizon) => Number(condition[`win${horizon}dPct`]))
      .filter(Number.isFinite);
    const averageWinRate = winRates.length
      ? winRates.reduce((sum, value) => sum + value, 0) / winRates.length
      : null;
    const graphLink = [
      "a",
      {
        href: `graph.html?dataset=${encodeURIComponent(dataset)}&subject_type=condition&subject=${encodeURIComponent(condition.slug || "")}`,
        rel: "noopener",
        target: "_blank",
      },
      [String(condition.label || condition.id || "-")],
    ];
    const values = [
      createNodeCell(String(condition.id || "-")),
      ["td", {}, [graphLink]],
      createNodeCell(selectConditionTypeLabel(condition)),
      createNodeCell(formatCalculatedNumber(condition.count, 0), "group-start"),
      createNodeCell(formatCalculatedNumber(condition.overallSharePct, 2)),
      createNodeCell(formatCalculatedNumber(condition.activeMonthRatePct, 2)),
      createNodeCell(formatCalculatedNumber(condition.averageEntriesAllMonths, 2)),
      createNodeCell(formatCalculatedNumber(condition.medianEntriesAllMonths, 2)),
      createNodeCell(formatCalculatedNumber(condition.averageEntriesActiveMonths, 2)),
      ...[5, 10, 20].map((horizon, index) => createNodeCell(
        formatCalculatedNumber(condition[`win${horizon}dPct`], 2),
        index === 0 ? "group-start" : "",
      )),
      createNodeCell(formatCalculatedNumber(averageWinRate, 2)),
      createNodeCell(formatCalculatedNumber(condition.recentFiveYearCount10d, 0), "group-start"),
      createNodeCell(formatSignedCalculatedPercent(condition.operationalWin20dPct, 2), "group-start"),
      createNodeCell(formatSignedCalculatedPercent(condition.medianFiveYearCagrPct, 2), "group-start"),
      createNodeCell(formatSignedCalculatedPercent(condition.allPeriodCagrPct, 2), "group-start"),
      createNodeCell(formatSignedCalculatedPercent(condition.minimumFiveYearCagrPct, 2), "group-start"),
      createNodeCell(formatSignedCalculatedPercent(condition.operationalMaximumDrawdownPct, 1), "group-start"),
      createNodeCell(
        Number.isFinite(Number(condition.maximumRequiredAmountYen))
          ? `${Number(condition.maximumRequiredAmountYen).toLocaleString("ja-JP")}円`
          : "-",
        "group-start",
      ),
      createNodeCell(formatCalculatedNumber(condition.attentionScore, 2), "group-start"),
    ];
    [5, 10, 20].forEach((horizon) => {
      ["growth", "firstHalfGrowth", "secondHalfGrowth", "maximumDrawdown"]
        .forEach((key, index) => {
          const value = condition[`${key}${horizon}dPct`];
          const classNames = [];
          if (index === 0) {
            classNames.push("group-start");
            if (Number(value) >= 1000) classNames.push("p2-growth-1000");
            else if (Number(value) >= 500) classNames.push("p2-growth-500");
          }
          values.push(createNodeCell(
            formatSignedCalculatedPercent(value, 1),
            classNames.join(" "),
          ));
        });
      values.push(createNodeCell(
        formatCalculatedNumber(condition[`maximumHolding${horizon}d`], 0),
      ));
    });
    return ["tr", {}, values];
  }

  // [T2442] OR画面上部の4指標とgraph linkを選択OR条件へ更新する。
  function registOrConditionSummary(condition, totalMonths, dataset) {
    const cards = Array.from(document.querySelectorAll(".grid .card"));
    const values = [
      [
        "OR件数",
        formatCalculatedNumber(condition.count, 0),
        `全体比 ${formatCalculatedNumber(condition.overallSharePct, 2)}%`,
      ],
      [
        "追加件数（最大単独比）",
        formatCalculatedNumber(condition.incrementalCount, 0),
        `+${formatCalculatedNumber(condition.entryExpansionPct, 2)}%`,
      ],
      [
        "5 / 10 / 20日正解率",
        [5, 10, 20].map((horizon) => (
          formatCalculatedNumber(condition[`win${horizon}dPct`], 2)
        )).join(" / ") + "%",
        "",
      ],
      [
        "月稼働",
        `${formatCalculatedNumber(condition.activeMonths, 0)} / ${totalMonths}`,
        `全月平均 ${formatCalculatedNumber(condition.averageEntriesAllMonths, 2)}件、稼働月平均 ${formatCalculatedNumber(condition.averageEntriesActiveMonths, 2)}件`,
      ],
    ];
    values.forEach(([label, metric, muted], index) => {
      const card = cards[index];
      if (!card) return;
      const labelElement = card.querySelector(".label");
      const metricElement = card.querySelector(".metric");
      const mutedElement = card.querySelector(".muted");
      if (labelElement) labelElement.textContent = label;
      if (metricElement) metricElement.textContent = metric;
      if (mutedElement) mutedElement.textContent = muted;
    });
    const graphLink = Array.from(document.querySelectorAll("a[href]"))
      .find((link) => link.textContent.includes("月別グラフ"));
    if (graphLink) {
      graphLink.href = `graph.html?dataset=${encodeURIComponent(dataset)}&subject_type=condition&subject=${encodeURIComponent(condition.slug)}`;
    }
  }

  // [T2443] 条件種別を共通表示名へ変換する。
  function selectConditionTypeLabel(condition) {
    const labels = {
      single: "単独",
      pair: "2因子",
      triple: "3因子",
      or2: "OR2",
      or3: "OR3",
    };
    return labels[condition.conditionType] || String(condition.conditionType || "-");
  }

  // [T2444] class付きの安全なtable cell nodeを作成する。
  function createNodeCell(value, className = "") {
    return ["td", className ? { class: className } : {}, [String(value ?? "-")]];
  }

  // [T2445] 資産指標を符号付き百分率へ整形する。
  function formatSignedCalculatedPercent(value, digits) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return "-";
    const sign = numberValue >= 0 ? "+" : "";
    return `${sign}${formatCalculatedNumber(numberValue, digits)}%`;
  }

  // [T440] 相場状態別の件数・正解率・基準差・return行を作成する。
  function createRegimeRows(regimeRows) {
    if (!Array.isArray(regimeRows)) return [];
    return regimeRows.map((row) => createNodeRow([
      row.regime || "UNKNOWN",
      formatCalculatedNumber(row.count, 0),
      ...[5, 10, 20].map((horizon) => formatCalculatedNumber(row[`win${horizon}dPct`], 2)),
      ...[5, 10, 20].map((horizon) => formatCalculatedNumber(row[`baselineWin${horizon}dPct`], 2)),
      ...[5, 10, 20].map((horizon) => formatCalculatedNumber(row[`uplift${horizon}dPct`], 2)),
      ...[5, 10, 20].map((horizon) => formatCalculatedNumber(row[`return${horizon}dPct`], 2)),
    ]));
  }

  // [T441] 辞書code形式のsignal明細から選択条件に該当する直近5000件を作成する。
  function createSignalDetailRows(condition, signalDetail) {
    if (!signalDetail || typeof signalDetail !== "object") {
      return [createSignalUnavailableRow("シグナル明細データ未生成")];
    }
    const requirementGroups = selectConditionRequirementGroups(condition.conditionKey);
    if (!requirementGroups.length) {
      return [createSignalUnavailableRow("条件定義を解決できません")];
    }
    const featureCodes = signalDetail.featureCodes || {};
    const featureDictionaries = signalDetail.featureDictionaries || {};
    const expectedCodeGroups = requirementGroups.map((requirements) => (
      requirements.map(({ feature, category }) => ({
        feature,
        code: Array.isArray(featureDictionaries[feature])
          ? featureDictionaries[feature].indexOf(category)
          : -1,
      }))
    ));
    if (expectedCodeGroups.some(
      (group) => group.some((item) => item.code < 0),
    )) {
      return [createSignalUnavailableRow("条件カテゴリに対応するシグナルなし")];
    }

    const dateCodes = signalDetail.codes?.dates || [];
    const matchedIndexes = [];
    for (let index = 0; index < signalDetail.rowCount; index += 1) {
      const isMatched = expectedCodeGroups.some(
        (group) => group.every(
          (item) => featureCodes[item.feature]?.[index] === item.code,
        ),
      );
      if (isMatched) matchedIndexes.push(index);
    }
    matchedIndexes.sort((left, right) => dateCodes[right] - dateCodes[left]);

    const dictionaries = signalDetail.dictionaries || {};
    const codes = signalDetail.codes || {};
    const selectText = (name, index) => (
      dictionaries[name]?.[codes[name]?.[index]] ?? "-"
    );
    const result = matchedIndexes.slice(0, 5000).map((index) => createNodeRow([
      selectText("dates", index),
      `${selectText("tickers", index)} / ${selectText("patterns", index)}`,
      selectText("regimes", index),
      ...[5, 10, 20].map((horizon) => signalDetail.wins?.[horizon]?.[index] ?? "-"),
      ...[5, 10, 20].map(
        (horizon) => formatCalculatedNumber(signalDetail.returns?.[horizon]?.[index], 2),
      ),
    ]));
    return result.length
      ? result
      : [createSignalUnavailableRow("該当シグナル0件")];
  }

  // [T449] signal明細0件理由を9実列へ合わせて作成する。
  function createSignalUnavailableRow(reason) {
    return createNodeRow([reason, "-", "-", "-", "-", "-", "-", "-", "-"]);
  }

  // [T442] S/P/TのANDまたはOR2/OR3のunionを条件要件groupへ変換する。
  function selectConditionRequirementGroups(conditionKey) {
    const value = String(conditionKey || "");
    const definitions = value.startsWith("OR2:") || value.startsWith("OR3:")
      ? value.split(":", 2)[1].split("||")
      : [value];
    return definitions.map((definition) => (
      definition.replace(/^[SPT]:/, "").split("&").map((part) => {
        const separator = part.indexOf("=");
        return {
          feature: separator >= 0 ? part.slice(0, separator) : "",
          category: separator >= 0 ? part.slice(separator + 1) : "",
        };
      }).filter((item) => item.feature && item.category)
    )).filter((group) => group.length > 0);
  }

  // [T448] 月次計算条件からslug別5D・10D・20D最大保有を作成する。
  function createCalculatedHoldingStatistics(calculatedData) {
    const conditions = [
      ...(Array.isArray(calculatedData?.conditions) ? calculatedData.conditions : []),
      ...(Array.isArray(calculatedData?.rankingConditions)
        ? calculatedData.rankingConditions : []),
      ...(Array.isArray(calculatedData?.orConditions)
        ? calculatedData.orConditions : []),
    ];
    const result = {};
    conditions.forEach((condition) => {
      if (!condition.slug) return;
      result[condition.slug] = {
        maximum: Object.fromEntries([5, 10, 20].map((horizon) => [
          `${horizon}d`,
          Number.isInteger(condition[`maximumHolding${horizon}d`])
            ? condition[`maximumHolding${horizon}d`]
            : null,
        ])),
      };
    });
    return result;
  }

  // [T434] 月次・年次・rolling期間行を作成する。
  function createCalculatedPeriodRows(
    condition,
    months,
    baseline,
    windowMonths,
    isRolling,
    includesReturns,
  ) {
    const rows = [];
    const step = isRolling ? 12 : windowMonths;
    for (let start = 0; start < months.length; start += step) {
      const end = Math.min(months.length, start + windowMonths);
      if (isRolling && end - start < windowMonths) break;
      const aggregate = createCalculatedAggregate(condition, baseline, start, end);
      const periodValues = windowMonths === 1
        ? [months[start]]
        : isRolling
          ? [months[start]?.slice(0, 4), months[end - 1]?.slice(0, 4)]
          : [months[start]?.slice(0, 4)];
      const values = [
        ...periodValues,
        formatCalculatedNumber(aggregate.entries, 0),
        ...aggregate.winRates.map((value) => formatCalculatedNumber(value, 2)),
        ...aggregate.baselineRates.map((value) => formatCalculatedNumber(value, 2)),
        ...aggregate.uplifts.map((value) => formatCalculatedNumber(value, 2)),
      ];
      if (includesReturns) {
        values.push(
          ...aggregate.returns.map((value) => formatCalculatedNumber(value, 2)),
        );
      }
      rows.push(createNodeRow(values));
    }
    return rows;
  }

  // [T435] 指定月範囲を件数加重で集計する。
  function createCalculatedAggregate(condition, baseline, start, end) {
    const monthly = condition.monthly || {};
    const horizons = [5, 10, 20];
    const entries = selectCalculatedSum(monthly.entries, start, end);
    const winRates = [];
    const baselineRates = [];
    const uplifts = [];
    const returns = [];
    horizons.forEach((horizon) => {
      const evaluable = selectCalculatedSum(monthly[`e${horizon}`], start, end);
      const wins = selectCalculatedSum(monthly[`w${horizon}`], start, end);
      const baselineEvaluable = selectCalculatedSum(baseline[`e${horizon}`], start, end);
      const baselineWins = selectCalculatedSum(baseline[`w${horizon}`], start, end);
      const winRate = evaluable > 0 ? wins * 100 / evaluable : null;
      const baselineRate = baselineEvaluable > 0
        ? baselineWins * 100 / baselineEvaluable
        : null;
      const returnRate = selectCalculatedWeightedMean(
        monthly[`r${horizon}`],
        monthly[`e${horizon}`],
        start,
        end,
      );
      winRates.push(winRate);
      baselineRates.push(baselineRate);
      uplifts.push(
        winRate !== null && baselineRate !== null ? winRate - baselineRate : null,
      );
      returns.push(returnRate);
    });
    return { entries, winRates, baselineRates, uplifts, returns };
  }

  // [T436] 配列の指定範囲を合計する。
  function selectCalculatedSum(values, start, end) {
    if (!Array.isArray(values)) return 0;
    return values.slice(start, end).reduce(
      (sum, value) => sum + (Number(value) || 0),
      0,
    );
  }

  // [T437] 月次平均returnを評価可能件数で加重平均する。
  function selectCalculatedWeightedMean(values, weights, start, end) {
    if (!Array.isArray(values) || !Array.isArray(weights)) return null;
    let total = 0;
    let totalWeight = 0;
    for (let index = start; index < end; index += 1) {
      const value = Number(values[index]);
      const weight = Number(weights[index]);
      if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) continue;
      total += value * weight;
      totalWeight += weight;
    }
    return totalWeight > 0 ? total / totalWeight : null;
  }

  // [T438] 安全なtbody node行を作成する。
  function createNodeRow(values) {
    return [
      "tr",
      {},
      values.map((value) => ["td", {}, [String(value ?? "-")]]),
    ];
  }

  // [T439] 計算値を表示桁へ整形する。
  function formatCalculatedNumber(value, digits) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return "-";
    return numberValue.toLocaleString("ja-JP", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  // [T422] [L404] catalogが返したpage payload pathを公開data配下へ制限する。
  function isAllowedDataPath(value) {
    return typeof value === "string"
      && /^(?:pages|datasets\/[A-Za-z0-9_.-]+\/pages)\/[a-z-]+\.json$/.test(value);
  }

  // [T429] 月次処理が生成したdataset計算JSON pathを公開data配下へ制限する。
  function isAllowedCalculatedDataPath(value) {
    return typeof value === "string"
      && /^calculated\/datasets\/[A-Za-z0-9_.-]+\/calculated\.json$/.test(value);
  }

  // [T444] dataset別signal明細JSON pathを公開計算data配下へ制限する。
  function isAllowedSignalDetailPath(value) {
    return typeof value === "string"
      && /^calculated\/datasets\/[A-Za-z0-9_.-]+\/signal_details\.json$/.test(value);
  }

  // [T445] [T3806] [L3803] 基準条件表と専用期間表のheaderを更新する。
  function registCalculatedTableHeaders(pageType) {
    const standardSlots = {
      dataset: ["tbody-001"],
      conditions: ["tbody-001"],
      condition: ["tbody-001"],
      "or-condition": ["tbody-001"],
      ranking: ["tbody-001", "tbody-002", "tbody-003", "tbody-004", "tbody-005"],
      comparison: [
        "tbody-001", "tbody-002", "tbody-003", "tbody-004", "tbody-005",
        "tbody-006", "tbody-007", "tbody-008", "tbody-009", "tbody-010",
      ],
    };
    (standardSlots[pageType] || []).forEach(registStandardConditionHeader);

    if (pageType === "condition") {
      const obsoleteBody = document.querySelector('tbody[data-p2-slot="tbody-002"]');
      const obsoleteWrap = obsoleteBody?.closest(".table-wrap");
      if (obsoleteWrap) {
        obsoleteWrap.hidden = true;
        const previousElement = obsoleteWrap.previousElementSibling;
        if (previousElement && /^H[23]$/.test(previousElement.tagName)) {
          previousElement.hidden = true;
        }
      }
      ["tbody-005", "tbody-006"].forEach(registRollingReturnHeader);
      registSignalDetailHeader("tbody-008");
    } else if (pageType === "or-condition") {
      registRollingReturnHeader("tbody-004");
      registSignalDetailHeader("tbody-005");
    }
  }

  // [T3806] [L3803] 「今回の注目条件」の36実列headerを共通登録する。
  function registStandardConditionHeader(slotName = "tbody-001") {
    const body = document.querySelector(`tbody[data-p2-slot="${slotName}"]`);
    const table = body?.closest("table");
    if (!table?.tHead || table.dataset.p2CalculatedHeader === "true") return;

    const groupRow = document.createElement("tr");
    const detailRow = document.createElement("tr");
    groupRow.className = "table-group-row";
    detailRow.className = "table-detail-row";
    const addHeader = (
      row,
      text,
      colSpan = 1,
      rowSpan = 1,
      className = "",
      columnIndex = null,
    ) => {
      const header = document.createElement("th");
      header.textContent = text;
      header.colSpan = colSpan;
      header.rowSpan = rowSpan;
      if (className) header.className = className;
      if (Number.isInteger(columnIndex)) {
        header.dataset.p2ColumnIndex = String(columnIndex);
        header.tabIndex = 0;
      }
      row.appendChild(header);
    };
    addHeader(groupRow, "ID", 1, 2, "", 0);
    addHeader(groupRow, "条件", 1, 2, "group-start", 1);
    addHeader(groupRow, "種別", 1, 2, "group-start", 2);
    addHeader(groupRow, "件数・頻度", 6, 1, "group-start");
    addHeader(groupRow, "正解率", 4, 1, "group-start");
    addHeader(groupRow, "運用指標", 8, 1, "group-start");
    [5, 10, 20].forEach((horizon) => {
      addHeader(groupRow, `${horizon}D`, 5, 1, "group-start");
    });
    ["件数", "全体比", "稼働率", "月平均", "月中央値", "稼働月平均"]
      .forEach((text, index) => addHeader(
        detailRow,
        text,
        1,
        1,
        index === 0 ? "group-start" : "",
        index + 3,
      ));
    ["5D", "10D", "20D", "平均"].forEach((text, index) => addHeader(
      detailRow,
      text,
      1,
      1,
      index === 0 ? "group-start" : "",
      index + 9,
    ));
    [
      "直近5年件数", "運用正解率", "5年CAGR中央値", "全期間CAGR",
      "5年CAGR最低値", "運用最大DD", "最大必要金額", "注目スコア",
    ].forEach((text, index) => addHeader(
      detailRow,
      text,
      1,
      1,
      "group-start",
      index + 13,
    ));
    [5, 10, 20].forEach((_horizon, horizonIndex) => {
      ["増加率", "前半", "後半", "最大DD", "最大保有"].forEach((text, index) => addHeader(
        detailRow,
        text,
        1,
        1,
        index === 0 ? "group-start" : "",
        21 + horizonIndex * 5 + index,
      ));
    });
    table.tHead.replaceChildren(groupRow, detailRow);
    table.classList.add("focus-table", "p2-standard-condition-table");
    table.dataset.p2StandardConditionTable = "true";
    table.dataset.p2StandardDataset = selectBreadcrumbValue(
      new URLSearchParams(window.location.search).get("dataset"),
    );
    table.dataset.p2CalculatedHeader = "true";
  }

  // [T2446] ORシグナル明細を条件シグナル表と同じ9実列へ揃える。
  function registSignalDetailHeader(slotName) {
    const body = document.querySelector(`tbody[data-p2-slot="${slotName}"]`);
    const table = body?.closest("table");
    if (!table?.tHead || table.dataset.p2SignalHeader === "true") return;
    const groupRow = document.createElement("tr");
    const detailRow = document.createElement("tr");
    groupRow.className = "table-group-row";
    detailRow.className = "table-detail-row";
    const addHeader = (row, text, colSpan = 1, rowSpan = 1, className = "") => {
      const header = document.createElement("th");
      header.textContent = text;
      header.colSpan = colSpan;
      header.rowSpan = rowSpan;
      if (className) header.className = className;
      row.appendChild(header);
    };
    addHeader(groupRow, "判定日", 1, 2);
    addHeader(groupRow, "銘柄・パターン", 1, 2, "group-start");
    addHeader(groupRow, "相場状態", 1, 2, "group-start");
    addHeader(groupRow, "正解", 3, 1, "group-start");
    addHeader(groupRow, "平均リターン", 3, 1, "group-start");
    ["5D", "10D", "20D", "5D", "10D", "20D"].forEach((text, index) => {
      addHeader(detailRow, text, 1, 1, index === 0 || index === 3 ? "group-start" : "");
    });
    table.tHead.replaceChildren(groupRow, detailRow);
    table.dataset.p2SignalHeader = "true";
  }

  // [T448] 条件一覧の検索・並べ替え・ページングを月次計算nodeだけで制御する。
  function createConditionIndexController(pageType, viewModel) {
    if (pageType !== "conditions" || viewModel.renderMode !== "nodes") return null;

    const element = document.querySelector('tbody[data-p2-slot="tbody-001"]');
    const rows = viewModel.slots?.["tbody-001"];
    if (!element || !Array.isArray(rows)) {
      throw new Error("条件一覧の月次計算nodeがありません。");
    }

    const inputSearch = document.getElementById("q");
    const selectPageSize = document.getElementById("ps");
    const buttonPrevious = document.getElementById("pv");
    const buttonNext = document.getElementById("nx");
    const textSummary = document.getElementById("sm");
    const textPage = document.getElementById("pg");
    if (!inputSearch || !selectPageSize || !buttonPrevious || !buttonNext
      || !textSummary || !textPage) {
      throw new Error("条件一覧の操作部品が不足しています。");
    }

    const sourceRows = rows.map((row) => ({
      node: row,
      cells: Array.isArray(row?.[2])
        ? row[2].map((cell) => selectNodeText(cell).trim())
        : [],
    }));
    let filteredRows = sourceRows.slice();
    let pageIndex = 0;
    let sortColumn = 11;
    let sortAscending = false;
    const toolbar = inputSearch.closest(".toolbar") || inputSearch.parentElement;
    const sortGuide = document.createElement("span");
    const sortSummary = document.createElement("span");
    sortGuide.className = "p2-table-sort-guide";
    sortGuide.textContent = "列名の ⇅ を選択すると並べ替え";
    sortSummary.className = "p2-table-sort-summary";
    sortSummary.dataset.p2SortSummary = "true";
    if (toolbar && !toolbar.querySelector("[data-p2-sort-summary]")) {
      toolbar.append(sortGuide, sortSummary);
    }

    const updateSortState = () => {
      document.querySelectorAll("th[data-p2-column-index]").forEach((header) => {
        const columnIndex = Number(header.dataset.p2ColumnIndex);
        const selected = columnIndex === sortColumn;
        header.setAttribute("aria-sort", selected
          ? (sortAscending ? "ascending" : "descending")
          : "none");
        header.classList.toggle("p2-sort-ascending", selected && sortAscending);
        header.classList.toggle("p2-sort-descending", selected && !sortAscending);
      });
      const selectedHeader = document.querySelector(
        `th[data-p2-column-index="${sortColumn}"]`,
      );
      sortSummary.textContent = selectedHeader
        ? `並び順：${selectedHeader.textContent.trim()}（${sortAscending ? "昇順" : "降順"}）`
        : "並び順：元の順";
    };

    const sortRows = () => {
      filteredRows.sort((leftRow, rightRow) => {
        const result = compareConditionCell(
          leftRow.cells[sortColumn] || "",
          rightRow.cells[sortColumn] || "",
        );
        return sortAscending ? result : -result;
      });
    };
    const render = async () => {
      const pageSize = Math.max(1, Number(selectPageSize.value || 50));
      const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
      pageIndex = Math.min(pageIndex, pageCount - 1);
      const startIndex = pageIndex * pageSize;
      const endIndex = Math.min(filteredRows.length, startIndex + pageSize);
      await registNodeChunks(
        element,
        filteredRows.slice(startIndex, endIndex).map((row) => row.node),
      );
      textSummary.textContent = `${filteredRows.length.toLocaleString()}件中 ${
        filteredRows.length ? startIndex + 1 : 0
      }〜${endIndex}件`;
      textPage.textContent = `${pageIndex + 1} / ${pageCount}`;
      buttonPrevious.disabled = pageIndex <= 0;
      buttonNext.disabled = pageIndex >= pageCount - 1;
      registHoldingStatistics();
    };
    const filterRows = () => {
      const searchText = inputSearch.value.trim().toLocaleLowerCase("ja");
      filteredRows = searchText
        ? sourceRows.filter((row) => row.cells.some(
          (cell) => cell.toLocaleLowerCase("ja").includes(searchText),
        ))
        : sourceRows.slice();
      pageIndex = 0;
      sortRows();
      updateSortState();
      void render().catch(registRuntimeError);
    };
    const sortByColumn = (columnIndex) => {
      if (sortColumn === columnIndex) {
        sortAscending = !sortAscending;
      } else {
        sortColumn = columnIndex;
        sortAscending = true;
      }
      pageIndex = 0;
      sortRows();
      void render().catch(registRuntimeError);
    };
    const registEvents = () => {
      inputSearch.oninput = filterRows;
      selectPageSize.onchange = () => {
        pageIndex = 0;
        void render().catch(registRuntimeError);
      };
      buttonPrevious.onclick = () => {
        pageIndex = Math.max(0, pageIndex - 1);
        void render().catch(registRuntimeError);
      };
      buttonNext.onclick = () => {
        pageIndex += 1;
        void render().catch(registRuntimeError);
      };
      document.querySelectorAll("th[data-p2-column-index]").forEach((header) => {
        const columnIndex = Number(header.dataset.p2ColumnIndex);
        header.tabIndex = 0;
        header.setAttribute("role", "button");
        header.title = `${header.textContent.trim()}で並べ替え`;
        header.onclick = () => sortByColumn(columnIndex);
        header.onkeydown = (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            sortByColumn(columnIndex);
          }
        };
      });
      updateSortState();
    };

    sortRows();
    viewModel.slots["tbody-001"] = [];
    return { render, registEvents };
  }

  // [T449] 構造化nodeから検索・並べ替え用の表示文字列を取得する。
  function selectNodeText(nodeValue) {
    if (typeof nodeValue === "string") return nodeValue;
    if (!Array.isArray(nodeValue) || nodeValue.length !== 3 || !Array.isArray(nodeValue[2])) {
      return "";
    }
    return nodeValue[2].map(selectNodeText).join(" ");
  }

  // [T450] 数値列と文字列列を同じ操作で安定して比較する。
  function compareConditionCell(leftValue, rightValue) {
    const toNumber = (value) => {
      const numberValue = Number(String(value).replace(/[,+%]/g, ""));
      return Number.isFinite(numberValue) && String(value).trim() !== "-"
        ? numberValue
        : null;
    };
    const leftNumber = toNumber(leftValue);
    const rightNumber = toNumber(rightValue);
    if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
    if (leftNumber !== null) return 1;
    if (rightNumber !== null) return -1;
    return leftValue.localeCompare(rightValue, "ja");
  }

  // [T3819] 50件を超える専用表へ共通の並べ替えと50件単位のページングを登録する。
  function registLargeTableControllers(root = document) {
    registLargeTableControllerStyle();
    root.querySelectorAll("table").forEach((table) => {
      if (table.dataset.p2LargeTableReady === "true"
        || table.dataset.p2StandardConditionTable === "true"
        || table.classList.contains("p2-favorites-table")
        || table.tBodies.length !== 1
        || table.tBodies[0].rows.length <= largeTablePageSize) return;
      registLargeTableController(table);
    });
  }

  // [T3820] 大規模表の全行を保持したまま選択pageだけを表示する。
  function registLargeTableController(table) {
    const body = table.tBodies[0];
    const sourceRows = Array.from(body.rows);
    const toolbar = createLargeTableToolbar();
    const inputSearch = toolbar.querySelector("input");
    const selectPageSize = toolbar.querySelector("select");
    const textSummary = toolbar.querySelector("[data-p2-large-summary]");
    const textPage = toolbar.querySelector("[data-p2-large-page]");
    const textSortSummary = toolbar.querySelector("[data-p2-sort-summary]");
    const buttonPrevious = toolbar.querySelector("[data-p2-large-previous]");
    const buttonNext = toolbar.querySelector("[data-p2-large-next]");
    let orderedRows = sourceRows.slice();
    let pageIndex = 0;
    let sortHeader = null;
    let sortAscending = true;

    const selectPageSizeValue = () => {
      const selected = Number(selectPageSize.value);
      return selected > 0 ? selected : Math.max(1, orderedRows.length);
    };
    const sortOrderedRows = () => {
      if (!sortHeader) return;
      const columnIndex = selectLargeTableHeaderColumn(table, sortHeader);
      if (columnIndex < 0) return;
      orderedRows.sort((leftRow, rightRow) => {
        const result = compareConditionCell(
          leftRow.cells[columnIndex]?.textContent.trim() || "",
          rightRow.cells[columnIndex]?.textContent.trim() || "",
        );
        return sortAscending ? result : -result;
      });
    };
    const render = () => {
      const pageSize = selectPageSizeValue();
      const pageCount = Math.max(1, Math.ceil(orderedRows.length / pageSize));
      pageIndex = Math.min(pageIndex, pageCount - 1);
      const startIndex = pageIndex * pageSize;
      const endIndex = Math.min(orderedRows.length, startIndex + pageSize);
      const fragment = document.createDocumentFragment();
      const orderedSet = new Set(orderedRows);
      orderedRows.forEach((row, index) => {
        row.hidden = index < startIndex || index >= endIndex;
        fragment.appendChild(row);
      });
      sourceRows.forEach((row) => {
        if (orderedSet.has(row)) return;
        row.hidden = true;
        fragment.appendChild(row);
      });
      body.appendChild(fragment);
      textSummary.textContent = `${orderedRows.length.toLocaleString("ja-JP")}件中 ${
        orderedRows.length ? startIndex + 1 : 0
      }〜${endIndex}件`;
      textPage.textContent = `${pageIndex + 1} / ${pageCount}`;
      buttonPrevious.disabled = pageIndex <= 0;
      buttonNext.disabled = pageIndex >= pageCount - 1;
    };
    const sortRows = (header) => {
      const columnIndex = selectLargeTableHeaderColumn(table, header);
      if (columnIndex < 0) return;
      if (sortHeader === header) {
        sortAscending = !sortAscending;
      } else {
        sortHeader = header;
        sortAscending = true;
      }
      sortOrderedRows();
      table.tHead.querySelectorAll("th[data-p2-large-sort]").forEach((target) => {
        target.setAttribute("aria-sort", target === header
          ? (sortAscending ? "ascending" : "descending")
          : "none");
        target.classList.toggle("p2-sort-ascending", target === header && sortAscending);
        target.classList.toggle("p2-sort-descending", target === header && !sortAscending);
      });
      textSortSummary.textContent = `並び順：${header.textContent.trim()}（${
        sortAscending ? "昇順" : "降順"
      }）`;
      pageIndex = 0;
      render();
    };
    const filterRows = () => {
      const searchText = inputSearch.value.trim().toLocaleLowerCase("ja");
      orderedRows = searchText
        ? sourceRows.filter((row) => row.textContent.toLocaleLowerCase("ja").includes(searchText))
        : sourceRows.slice();
      sortOrderedRows();
      pageIndex = 0;
      render();
    };

    table.tHead?.querySelectorAll("th").forEach((header) => {
      if (header.colSpan !== 1) return;
      header.dataset.p2LargeSort = "true";
      header.tabIndex = 0;
      header.setAttribute("role", "button");
      header.setAttribute("aria-sort", "none");
      header.title = `${header.textContent.trim()}で並べ替え`;
      header.addEventListener("click", () => sortRows(header));
      header.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        sortRows(header);
      });
    });
    inputSearch.addEventListener("input", filterRows);
    selectPageSize.addEventListener("change", () => {
      pageIndex = 0;
      render();
    });
    buttonPrevious.addEventListener("click", () => {
      pageIndex = Math.max(0, pageIndex - 1);
      render();
    });
    buttonNext.addEventListener("click", () => {
      pageIndex += 1;
      render();
    });

    const tableWrap = table.closest(".table-wrap");
    const legacyToolbar = tableWrap?.previousElementSibling;
    const legacyPager = tableWrap?.nextElementSibling;
    if (legacyToolbar?.classList.contains("toolbar")) legacyToolbar.remove();
    if (legacyPager?.classList.contains("pager")) legacyPager.remove();
    (tableWrap || table).insertAdjacentElement("beforebegin", toolbar);
    table.dataset.p2LargeTableReady = "true";
    render();
  }

  // [T3821] 大規模表の表示件数・現在範囲・page移動操作を作成する。
  function createLargeTableToolbar() {
    const toolbar = document.createElement("div");
    const search = document.createElement("input");
    const label = document.createElement("label");
    const select = document.createElement("select");
    const summary = document.createElement("span");
    const sortGuide = document.createElement("span");
    const sortSummary = document.createElement("span");
    const previous = document.createElement("button");
    const page = document.createElement("span");
    const next = document.createElement("button");
    toolbar.className = "p2-large-table-toolbar";
    search.type = "search";
    search.placeholder = "表を検索";
    search.setAttribute("aria-label", "表を検索");
    label.textContent = "表示件数 ";
    select.setAttribute("aria-label", "表示件数");
    [["50", "50件"], ["100", "100件"], ["250", "250件"], ["0", "全件"]]
      .forEach(([value, text]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
      });
    select.value = String(largeTablePageSize);
    summary.dataset.p2LargeSummary = "true";
    sortGuide.className = "p2-table-sort-guide";
    sortGuide.textContent = "列名の ⇅ を選択すると並べ替え";
    sortSummary.className = "p2-table-sort-summary";
    sortSummary.dataset.p2SortSummary = "true";
    sortSummary.textContent = "並び順：元の順";
    previous.type = "button";
    previous.textContent = "前へ";
    previous.dataset.p2LargePrevious = "true";
    page.dataset.p2LargePage = "true";
    next.type = "button";
    next.textContent = "次へ";
    next.dataset.p2LargeNext = "true";
    label.appendChild(select);
    toolbar.append(search, label, summary, previous, page, next, sortGuide, sortSummary);
    return toolbar;
  }

  // [T3822] 複数段headerの対象cellが表本文の何列目に対応するかを取得する。
  function selectLargeTableHeaderColumn(table, targetHeader) {
    if (!table.tHead || targetHeader.colSpan !== 1) return -1;
    const headerRows = Array.from(table.tHead.rows);
    const grid = [];
    for (let rowIndex = 0; rowIndex < headerRows.length; rowIndex += 1) {
      grid[rowIndex] ||= [];
      let columnIndex = 0;
      for (const header of headerRows[rowIndex].cells) {
        while (grid[rowIndex][columnIndex]) columnIndex += 1;
        const rowSpan = Math.max(1, header.rowSpan);
        const columnSpan = Math.max(1, header.colSpan);
        for (let offsetRow = 0; offsetRow < rowSpan; offsetRow += 1) {
          grid[rowIndex + offsetRow] ||= [];
          for (let offsetColumn = 0; offsetColumn < columnSpan; offsetColumn += 1) {
            grid[rowIndex + offsetRow][columnIndex + offsetColumn] = header;
          }
        }
        if (header === targetHeader) return columnIndex;
        columnIndex += columnSpan;
      }
    }
    return -1;
  }

  // [T3823] 大規模表の操作部品と並べ替え状態を共通表示する。
  function registLargeTableControllerStyle() {
    if (document.getElementById("p2-large-table-style")) return;
    const style = document.createElement("style");
    style.id = "p2-large-table-style";
    style.textContent = `
      .p2-large-table-toolbar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        margin: 12px 0;
      }
      .p2-large-table-toolbar input,
      .p2-large-table-toolbar select,
      .p2-large-table-toolbar button {
        min-height: 36px;
        padding: 6px 12px;
        border: 1px solid #b8c7da;
        border-radius: 7px;
        background: #fff;
        color: #17365f;
      }
      .p2-large-table-toolbar input { min-width: 220px; }
      .p2-large-table-toolbar button:not(:disabled) { cursor: pointer; }
      .p2-large-table-toolbar button:disabled { opacity: .45; }
      .p2-table-sort-guide,
      .p2-table-sort-summary {
        color: #52667f;
        font-size: .9rem;
        white-space: nowrap;
      }
      .p2-table-sort-summary { font-weight: 700; color: #17365f; }
      th[data-p2-large-sort="true"],
      th[data-p2-column-index] {
        cursor: pointer;
        user-select: none;
        transition: background-color .15s ease;
      }
      th[data-p2-large-sort="true"]::after,
      th[data-p2-column-index]::after { content: " ⇅"; color: #6c7f96; }
      th[data-p2-large-sort="true"]:hover,
      th[data-p2-large-sort="true"]:focus-visible,
      th[data-p2-column-index]:hover,
      th[data-p2-column-index]:focus-visible { background: #e8f1fb; outline: 2px solid #0b5cab; outline-offset: -2px; }
      th.p2-sort-ascending::after { content: " ▲"; color: #0b5cab; }
      th.p2-sort-descending::after { content: " ▼"; color: #0b5cab; }
    `;
    document.head.appendChild(style);
  }

  // [T447] [L3813] Rolling表のbody列数に不足する場合だけ平均return headerを追加する。
  function registRollingReturnHeader(slotName) {
    const body = document.querySelector(`tbody[data-p2-slot="${slotName}"]`);
    const table = body?.closest("table");
    if (!table?.tHead || table.dataset.p2ReturnHeader === "true") return;
    const rows = table.tHead.rows;
    if (rows.length < 2) return;

    const headerWidth = Array.from(rows[0].cells).reduce(
      (sum, cell) => sum + Number(cell.colSpan || 1),
      0,
    );
    const bodyWidth = body.rows[0]?.cells.length || 0;
    if (bodyWidth === 0 || bodyWidth === headerWidth) {
      return;
    }
    if (bodyWidth !== headerWidth + 3) {
      throw new Error(
        `Rolling表の列数が不正です: ${slotName} header=${headerWidth} body=${bodyWidth}`,
      );
    }

    const groupHeader = document.createElement("th");
    groupHeader.textContent = "平均リターン";
    groupHeader.colSpan = 3;
    groupHeader.className = "group-start";
    rows[0].appendChild(groupHeader);
    ["5D", "10D", "20D"].forEach((text, index) => {
      const header = document.createElement("th");
      header.textContent = text;
      if (index === 0) header.className = "group-start";
      rows[1].appendChild(header);
    });
    table.dataset.p2ReturnHeader = "true";
  }

  // [F421] [L405] 宣言済みtbody slotだけを構造化nodeで更新する。
  async function registTemplateSlots(viewModel) {
    const slotEntries = Object.entries(viewModel.slots);
    const slotElements = document.querySelectorAll("tbody[data-p2-slot]");
    const elementBySlot = new Map(
      Array.from(slotElements, (element) => [element.dataset.p2Slot, element]),
    );

    if (elementBySlot.size !== slotEntries.length) {
      throw new Error("固定テンプレートのtbody slot件数が一致しません。");
    }

    for (const [slotName, slotValue] of slotEntries) {
      if (!allowedSlotNamePattern.test(slotName)) {
        throw new Error(`動的slot名が不正です: ${slotName}`);
      }
      const element = elementBySlot.get(slotName);
      if (!element || element.tagName !== "TBODY" || element.dataset.p2SlotType !== "nodes") {
        throw new Error(`固定テンプレートのtbody slotが不正です: ${slotName}`);
      }
      if (!Array.isArray(slotValue)) {
        throw new Error(`tbody nodeが配列ではありません: ${slotName}`);
      }

      //正本templateを保持する場合
      if (viewModel.renderMode === "template") {
        element.dataset.p2Deferred = "false";
        continue;
      }

      const detailView = element.closest(".detail-view");
      if (detailView && !detailView.classList.contains("active")) {
        //遅延描画前に旧release表を除去し、別runの本文が残ることを防止する。
        element.replaceChildren();
        deferredSlotByElement.set(element, slotValue);
        element.dataset.p2Deferred = "true";
      } else {
        await registNodeChunks(element, slotValue);
      }
    }
  }

  // [T426] [L405] 大規模tbodyを固定件数ずつ描画して長時間のUI占有を避ける。
  async function registNodeChunks(element, slotValue) {
    element.replaceChildren();
    for (let startIndex = 0; startIndex < slotValue.length; startIndex += renderChunkSize) {
      const fragment = document.createDocumentFragment();
      const chunkValues = slotValue.slice(startIndex, startIndex + renderChunkSize);
      for (const nodeValue of chunkValues) {
        fragment.appendChild(createSafeNode(nodeValue));
      }
      element.appendChild(fragment);
      if (startIndex + renderChunkSize < slotValue.length) {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }
    element.dataset.p2Deferred = "false";
  }

  // [T427] [L405] tab切替後に表示対象となったtbodyだけを遅延描画する。
  async function registVisibleDeferredSlots() {
    const deferredElements = document.querySelectorAll('tbody[data-p2-deferred="true"]');
    for (const element of deferredElements) {
      const detailView = element.closest(".detail-view");
      if (detailView && detailView.classList.contains("active")
        && element.dataset.p2Rendering !== "true") {
        const slotValue = deferredSlotByElement.get(element);
        if (slotValue) {
          element.dataset.p2Rendering = "true";
          await registNodeChunks(element, slotValue);
          deferredSlotByElement.delete(element);
          element.dataset.p2Rendering = "false";
          registHoldingStatistics();
          registLargeTableControllers(detailView);
        }
      }
    }
  }

  // [F429] [L503] 最大DDを3列持つ既存表へ5D・10D・20D最大保有数を登録する。
  function registHoldingStatistics() {
    if (!holdingStatisticsBySubject
      || typeof holdingStatisticsBySubject !== "object"
      || Array.isArray(holdingStatisticsBySubject)
      || Object.keys(holdingStatisticsBySubject).length === 0) {
      return;
    }

    const targetTables = selectHoldingTargetTable();
    for (const table of targetTables) {
      let columnIndexes;
      if (table.dataset.p2HoldingColumns) {
        columnIndexes = JSON.parse(table.dataset.p2HoldingColumns);
      } else {
        columnIndexes = registHoldingHeader(table);
        table.dataset.p2HoldingColumns = JSON.stringify(columnIndexes);
      }
      for (const row of table.tBodies[0]?.rows || []) {
        if (row.dataset.p2HoldingReady === "true") {
          continue;
        }
        registHoldingRow(row, columnIndexes);
        row.dataset.p2HoldingReady = "true";
      }
    }
  }

  // [T430] [L503] 最大保有列の追加対象となる表を取得する。
  function selectHoldingTargetTable() {
    const targetTables = [];
    for (const table of document.querySelectorAll("table")) {
      if (table.dataset.p2StandardConditionTable === "true") {
        continue;
      }
      const maximumDrawdownHeaders = Array.from(table.tHead?.querySelectorAll("th") || [])
        .filter((header) => header.textContent.trim() === "最大DD");
      if (maximumDrawdownHeaders.length === 3 && table.tBodies.length > 0) {
        targetTables.push(table);
      }
    }

    return targetTables;
  }

  // [T432] [L503] 既存group幅を更新し最大DDの直後へ最大保有headerを登録する。
  function registHoldingHeader(table) {
    const headerRows = Array.from(table.tHead.rows);
    const occupiedColumns = [];
    const positionByHeader = new Map();

    for (let rowIndex = 0; rowIndex < headerRows.length; rowIndex += 1) {
      occupiedColumns[rowIndex] ||= [];
      let columnIndex = 0;
      for (const header of headerRows[rowIndex].cells) {
        while (occupiedColumns[rowIndex][columnIndex]) {
          columnIndex += 1;
        }
        const columnSpan = Number(header.colSpan || 1);
        const rowSpan = Number(header.rowSpan || 1);
        positionByHeader.set(header, { columnIndex, columnSpan, rowIndex });
        for (let targetRow = rowIndex; targetRow < rowIndex + rowSpan; targetRow += 1) {
          occupiedColumns[targetRow] ||= [];
          for (let targetColumn = columnIndex; targetColumn < columnIndex + columnSpan; targetColumn += 1) {
            occupiedColumns[targetRow][targetColumn] = true;
          }
        }
        columnIndex += columnSpan;
      }
    }

    const maximumDrawdownHeaders = Array.from(table.tHead.querySelectorAll("th"))
      .filter((header) => header.textContent.trim() === "最大DD");
    const columnIndexes = maximumDrawdownHeaders
      .map((header) => positionByHeader.get(header).columnIndex)
      .sort((leftValue, rightValue) => leftValue - rightValue);
    const groupHeaders = new Set();

    for (const maximumDrawdownHeader of maximumDrawdownHeaders) {
      const maximumPosition = positionByHeader.get(maximumDrawdownHeader);
      for (const [header, headerPosition] of positionByHeader.entries()) {
        const containsColumn = headerPosition.rowIndex < maximumPosition.rowIndex
          && headerPosition.columnSpan > 1
          && headerPosition.columnIndex <= maximumPosition.columnIndex
          && maximumPosition.columnIndex < headerPosition.columnIndex + headerPosition.columnSpan;
        if (containsColumn) {
          groupHeaders.add(header);
        }
      }
      const holdingHeader = document.createElement("th");
      holdingHeader.className = maximumDrawdownHeader.className;
      holdingHeader.textContent = "最大保有";
      maximumDrawdownHeader.after(holdingHeader);
    }
    for (const groupHeader of groupHeaders) {
      groupHeader.colSpan += 1;
    }

    return columnIndexes;
  }

  // [T431] [L503] 条件行のgraph URLからsubjectを取得する。
  function selectHoldingSubject(row) {
    const graphLink = Array.from(row.querySelectorAll("a[href]"))
      .find((link) => link.getAttribute("href").startsWith("graph.html?"));
    if (!graphLink) {
      return null;
    }

    const graphUrl = new URL(graphLink.getAttribute("href"), window.location.href);
    const subject = graphUrl.searchParams.get("subject");

    return subject;
  }

  // [T433] [L503] 条件行の各最大DD直後へ事前計算済み最大保有数を登録する。
  function registHoldingRow(row, columnIndexes) {
    const subject = selectHoldingSubject(row);
    const statistics = subject ? holdingStatisticsBySubject[subject] : null;
    const horizons = [5, 10, 20];

    for (let holdingIndex = 0; holdingIndex < columnIndexes.length; holdingIndex += 1) {
      const sourceCell = row.cells[columnIndexes[holdingIndex] + holdingIndex];
      if (!sourceCell) {
        continue;
      }
      const holdingCell = document.createElement("td");
      const holdingValue = statistics?.maximum?.[`${horizons[holdingIndex]}d`];
      holdingCell.className = sourceCell.className;
      holdingCell.textContent = Number.isInteger(holdingValue)
        ? holdingValue.toLocaleString()
        : "-";
      sourceCell.after(holdingCell);
    }
  }

  // [T428] [L405] 既存tab操作を変更せず遅延slotの表示契機だけを監視する。
  function registDeferredSlotEvents() {
    const refreshDeferredSlots = () => {
      window.setTimeout(() => {
        registVisibleDeferredSlots().catch(registRuntimeError);
      }, 0);
    };
    document.addEventListener("click", refreshDeferredSlots);
    document.addEventListener("change", refreshDeferredSlots);
    window.addEventListener("hashchange", refreshDeferredSlots);
  }

  // [T423] [L405] allowlist済み構造化値からDOM nodeを再帰作成する。
  function createSafeNode(nodeValue) {
    if (typeof nodeValue === "string") {
      return document.createTextNode(nodeValue);
    }
    if (!Array.isArray(nodeValue) || nodeValue.length !== 3) {
      throw new Error("構造化nodeが3要素の配列ではありません。");
    }

    const [tagName, attributes, children] = nodeValue;
    if (!allowedNodeTags.has(tagName) || !Array.isArray(children)
      || !attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
      throw new Error(`許可されていないnode tagです: ${tagName}`);
    }

    const element = document.createElement(tagName);
    for (const [attributeName, attributeValue] of Object.entries(attributes)) {
      if (!allowedNodeAttributes.has(attributeName) || typeof attributeValue !== "string") {
        throw new Error(`許可されていないnode属性です: ${attributeName}`);
      }
      if (attributeName === "href" && !allowedLinkPattern.test(attributeValue)) {
        throw new Error(`許可されていない内部linkです: ${attributeValue}`);
      }
      element.setAttribute(attributeName, attributeValue);
    }
    for (const childValue of children) {
      element.appendChild(createSafeNode(childValue));
    }

    return element;
  }

  // [T424] [L404] 同一originの公開JSONを取得する。
  async function selectJson(relativePath) {
    const response = await fetch(relativePath, { cache: "no-cache", credentials: "same-origin" });
    if (!response.ok) {
      throw new Error(`JSONを取得できません: ${response.status}`);
    }

    return response.json();
  }

  // [T425] [L404] runtime失敗時は旧template本文を破棄してエラーだけを表示する。
  function registRuntimeError(error) {
    document.documentElement.dataset.p2RuntimeError = "true";
    const wrap = document.querySelector(".wrap");
    if (!wrap) {
      console.error(error);
      return;
    }

    const message = document.createElement("div");
    message.className = "note p2-runtime-error";
    message.textContent = `画面データを取得できません: ${error.message}`;
    Array.from(wrap.children).forEach((child) => {
      child.hidden = true;
    });
    wrap.insertBefore(message, wrap.firstChild);
    finishRuntimeLoading();
    console.error(error);
  }

  window.addEventListener("DOMContentLoaded", () => {
    registCommonPage()
      .then(() => window.dispatchEvent(new Event("p2:page-ready")))
      .catch(registRuntimeError);
  });
})();
