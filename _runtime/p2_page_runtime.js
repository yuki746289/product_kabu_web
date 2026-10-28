/**
 * 更新日時: 2026/10/28
 * 処理概要: [S004] release.3.0.0固定テンプレートの許可slotだけを階層JSONから更新する。
 * 前回バージョンとの違い:
 * - [MOD]: release.2表示モデルを廃止し、release.3固定DOM用の構造化node slotへ変更する。
 * - [ADD]: tag・属性・内部URLのallowlist検証を追加する。
 */
(function () {
  "use strict";

  const allowedQueryKeys = new Set([
    "page", "dataset", "condition", "condition_type", "type", "view", "ranking",
    "subject_type", "subject", "chart", "analysis", "report", "part", "run",
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
  const deferredSlotByElement = new WeakMap();
  const renderChunkSize = 250;

  // [F420] [L404] 固定物理ページをrelease.3表示payloadで初期化する。
  async function registCommonPage() {
    const startedAt = performance.now();
    const pageType = document.documentElement.dataset.p2Page || "index";
    const query = new URLSearchParams(window.location.search);

    if (!allowedPageTypes.has(pageType)) {
      throw new Error(`unsupported page: ${pageType}`);
    }

    const request = selectPageRequest(query, pageType);
    const viewModel = await selectPageViewModel(request);
    await registTemplateSlots(viewModel);
    registDeferredSlotEvents();
    document.documentElement.dataset.p2RuntimeReady = "true";
    document.documentElement.dataset.p2RuntimeMs = String(Math.round(performance.now() - startedAt));
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
    const latest = await selectJson("data/latest.json");
    const catalog = await selectJson("data/catalog.json");
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

    return viewModel;
  }

  // [T422] [L404] catalogが返したpage payload pathを公開data配下へ制限する。
  function isAllowedDataPath(value) {
    return typeof value === "string"
      && /^(?:pages|datasets\/[A-Za-z0-9_.-]+\/pages)\/[a-z-]+\.json$/.test(value);
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
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
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
        }
      }
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
    const response = await fetch(relativePath, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) {
      throw new Error(`JSONを取得できません: ${response.status}`);
    }

    return response.json();
  }

  // [T425] [L404] runtime失敗を固定テンプレートを保持したまま表示する。
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
    wrap.insertBefore(message, wrap.firstChild);
    console.error(error);
  }

  window.addEventListener("DOMContentLoaded", () => {
    registCommonPage().catch(registRuntimeError);
  });
})();
