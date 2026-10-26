(function(){
  "use strict";

  const KEY_FAVORITES="product_kabu_favorites_v1";
  const KEY_ALLOCATION="product_kabu_allocation_v1";
  const DB_PORTFOLIO="product_kabu_portfolio_v1";
  const DB_VERSION=1;
  const QUANTITY_SCALE=1000000n;
  const PRICE_SCALE=100n;
  const BROKERS=[
    {name:"楽天証券 かぶピタッ",note:"100円から金額指定。最新の対象銘柄・手数料は公式で確認",url:"https://www.rakuten-sec.co.jp/web/domestic/fractional/"},
    {name:"楽天証券 かぶミニ",note:"単元未満株。取引条件は公式で確認",url:"https://www.rakuten-sec.co.jp/web/domestic/ols/"},
    {name:"SMBC日興証券 キンカブ",note:"金額・株数指定。最新の対象銘柄・コストは公式で確認",url:"https://www.smbcnikko.co.jp/products/stock/kinkabu/"}
  ];

  let objData=null;
  let listFavorites=[];
  let listEvents=[];
  let listValuations=[];
  let objPortfolio=null;

  // [T001] 表示JSON検証
  function _validateDashboardData(value){
    if(!value||typeof value!=="object"||value.schema_version!==1)throw new Error("表示データのschemaが不正です。");
    if(!["ready","pending","stale","error"].includes(value.status))throw new Error("表示データの状態が不正です。");
    if(!Array.isArray(value.datasets)||!Array.isArray(value.settlements))throw new Error("表示データの配列が不正です。");
    value.datasets.forEach(dataset=>{if(!dataset||typeof dataset!=="object"||!Array.isArray(dataset.records))throw new Error("データセットが不正です。");});
    return value;
  }

  // [F001] 表示JSON取得
  async function selectDashboardData(mount){
    const source=String(mount.dataset.source||"");
    if(!source)throw new Error("表示データの場所が未設定です。");
    const response=await fetch(source,{cache:"no-store",credentials:"same-origin"});
    if(!response.ok)throw new Error("表示データを取得できませんでした。");
    return _validateDashboardData(await response.json());
  }

  // [T002] お気に入りkey作成
  function _createFavoriteKey(item){return String(item.datasetKey||item.dataset_key||"")+"::"+String(item.conditionId||item.condition_id||"")}

  // [F002] お気に入り取得
  function selectFavorites(){
    try{
      const value=JSON.parse(localStorage.getItem(KEY_FAVORITES)||"[]");
      if(!Array.isArray(value))return [];
      return value.filter(item=>item&&typeof item==="object"&&item.datasetKey&&item.conditionId);
    }catch(_error){return []}
  }

  // [F003] 決済予定取得
  function selectSettlements(data){return data.settlements.filter(item=>item&&Number.isInteger(item.business_day_offset)&&item.business_day_offset>=-2&&item.business_day_offset<=2)}

  // [T003] 前後2営業日抽出
  function _selectSettlementWindow(items){return items.slice().sort((a,b)=>a.business_day_offset-b.business_day_offset||String(a.ticker||"").localeCompare(String(b.ticker||"")))}

  // [T004] JST状態取得
  function _selectJstStatus(data){
    if(!data.market_date)return {label:"未確定",className:"is-pending"};
    const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());
    const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));
    const date=`${map.year}-${map.month}-${map.day}`;
    const minute=Number(map.hour)*60+Number(map.minute);
    if(date<data.market_date||minute<540)return {label:"受付前",className:""};
    if(date===data.market_date&&minute<570)return {label:"受付中",className:""};
    return {label:"終了",className:""};
  }

  // [T005] 空状態登録
  function _registEmptyState(tbody,message,colspan){
    const row=document.createElement("tr");
    const cell=document.createElement("td");
    cell.colSpan=colspan;cell.className="p2hd-empty";cell.textContent=message;row.appendChild(cell);tbody.appendChild(row);
  }

  // [T006] 安全なlocal path取得
  function _selectSafeLocalPath(path){
    const value=String(path||"").trim();
    if(!value.startsWith("/kabu/")||value.includes("\\")||value.includes(".."))return "";
    return value;
  }

  // [T269] DOM elementを安全に生成する。
  function _createElement(name,className,text){
    const element=document.createElement(name);
    if(className)element.className=className;
    if(text!==undefined&&text!==null)element.textContent=String(text);
    return element;
  }

  // [T270] table cellを追加する。
  function _appendCell(row,label,value){const cell=_createElement("td","",value);cell.dataset.label=label;row.appendChild(cell);return cell}
  // [T271] 金額を日本語表記へ整形する。
  function _formatMoney(value){return new Intl.NumberFormat("ja-JP").format(Number(value||0))+"円"}
  // [T272] 数量表記を整形する。
  function _formatQuantity(value){return String(value||"0").replace(/\.0+$/,"")}
  // [T273] 日時を日本時間表記へ整形する。
  function _formatDateTime(value){if(!value)return "未設定";const date=new Date(value);return Number.isNaN(date.getTime())?String(value):new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",dateStyle:"short",timeStyle:"short"}).format(date)}
  // [T274] ローカル台帳用IDを生成する。
  function _newId(prefix){return prefix+"_"+(crypto.randomUUID?crypto.randomUUID():Date.now()+"_"+Math.random().toString(16).slice(2))}
  // [T275] 小数文字列を固定scale整数へ変換する。
  function _parseDecimal(value,scale){
    const text=String(value??"").trim();
    if(!/^\d+(?:\.\d+)?$/.test(text))throw new Error("数値の形式が不正です。");
    const [whole,fraction=""]=text.split(".");
    const digits=scale===QUANTITY_SCALE?6:2;
    if(fraction.length>digits)throw new Error(`小数は${digits}桁までです。`);
    return BigInt(whole)*scale+BigInt((fraction+"0".repeat(digits)).slice(0,digits));
  }
  // [T276] 固定scale整数を小数文字列へ変換する。
  function _decimalText(value,scale,digits){const whole=value/scale;const fraction=(value%scale).toString().padStart(digits,"0").replace(/0+$/,"");return fraction?`${whole}.${fraction}`:String(whole)}

  // [T011] 金額計算
  function _calculateMoney(quantityText,priceText){
    const quantity=_parseDecimal(quantityText,QUANTITY_SCALE);
    const price=_parseDecimal(priceText,PRICE_SCALE);
    return Number((quantity*price+QUANTITY_SCALE*PRICE_SCALE/2n)/(QUANTITY_SCALE*PRICE_SCALE));
  }

  // [F201] [L201] ダッシュボード骨格登録
  function registDashboard(mount){
    mount.textContent="";
    const stack=_createElement("div","p2hd-stack");
    stack.innerHTML=`
      <section class="p2hd-card" aria-labelledby="p2hd-work-title"><header class="p2hd-card-head"><div><h2 id="p2hd-work-title">本日の作業</h2><p id="p2hd-data-note"></p></div><span id="p2hd-data-status" class="p2hd-status"></span></header><div class="p2hd-card-body"><div id="p2hd-work" class="p2hd-work"></div></div></section>
      <section class="p2hd-card" aria-labelledby="p2hd-portfolio-title"><header class="p2hd-card-head"><div><h2 id="p2hd-portfolio-title">運用状況</h2><p>この端末内の手入力台帳から集計します。証券口座とは連携しません。</p></div><div class="p2hd-actions"><button type="button" class="p2hd-btn p2hd-btn-primary" data-action="open-ledger">取引・入出金を記録</button><button type="button" class="p2hd-btn" data-action="export-ledger">バックアップ</button><button type="button" class="p2hd-btn" data-action="import-ledger">復元</button><input type="file" accept="application/json" data-role="import-file" class="p2hd-hidden"></div></header><div class="p2hd-card-body"><div id="p2hd-summary" class="p2hd-summary"></div><h3>現在保有</h3><div class="p2hd-table-wrap"><table class="p2hd-table"><thead><tr><th>コード・銘柄</th><th>期間</th><th>数量</th><th>取得原価</th><th>評価額</th><th>含み損益</th><th>操作</th></tr></thead><tbody id="p2hd-holdings"></tbody></table></div></div></section>
      <section class="p2hd-card" aria-labelledby="p2hd-entry-title"><header class="p2hd-card-head"><div><h2 id="p2hd-entry-title">本日エントリー</h2><p>18:30確定後に確認し、次営業日8:30までに準備、9:00～9:30に手動で判断します。</p></div></header><div class="p2hd-card-body"><div class="p2hd-toolbar"><div class="p2hd-field"><label for="p2hd-dataset">データセット</label><select id="p2hd-dataset"></select></div><span id="p2hd-entry-count" class="p2hd-status"></span></div><div id="p2hd-entry-notice"></div><div class="p2hd-table-wrap"><table class="p2hd-table"><thead><tr><th>状態</th><th>コード・銘柄</th><th>判定</th><th>お気に入り条件</th><th>5D / 10D / 20D</th><th>操作</th></tr></thead><tbody id="p2hd-entry-body"></tbody></table></div></div></section>
      <section class="p2hd-card" aria-labelledby="p2hd-allocation-title"><header class="p2hd-card-head"><div><h2 id="p2hd-allocation-title">掛け金・資金配分</h2><p>全候補を同額にし、資金不足でも候補を自動選別しません。</p></div></header><div class="p2hd-card-body"><div class="p2hd-allocation"><div class="p2hd-grid-form" id="p2hd-allocation-form"></div><div id="p2hd-allocation-result" class="p2hd-allocation-result"></div></div></div></section>
      <section class="p2hd-card" aria-labelledby="p2hd-broker-title"><header class="p2hd-card-head"><div><h2 id="p2hd-broker-title">証券会社サービス</h2><p>特定サービスを推奨するものではありません。対象銘柄・手数料・注文条件は公式サイトで確認してください。</p></div></header><div class="p2hd-card-body"><div id="p2hd-brokers" class="p2hd-brokers"></div></div></section>
      <section class="p2hd-card" aria-labelledby="p2hd-settlement-title"><header class="p2hd-card-head"><div><h2 id="p2hd-settlement-title">決済予定</h2><p>既存P2 v12の5D・10D・20D終値評価日です。注文期限・約定・利益を保証しません。</p></div></header><div class="p2hd-card-body"><div class="p2hd-table-wrap"><table class="p2hd-table"><thead><tr><th>区分</th><th>予定日・基準時刻</th><th>コード・銘柄</th><th>データセット</th><th>期間</th><th>対象日</th><th>操作</th></tr></thead><tbody id="p2hd-settlement-body"></tbody></table></div></div></section>
      <section class="p2hd-card" aria-labelledby="p2hd-events-title"><header class="p2hd-card-head"><div><h2 id="p2hd-events-title">最近の売買・入出金</h2><p>訂正は元記録を削除せず、取消しeventとして保存します。</p></div></header><div class="p2hd-card-body"><div class="p2hd-table-wrap"><table class="p2hd-table"><thead><tr><th>日時</th><th>種別</th><th>コード・銘柄</th><th>数量</th><th>金額</th><th>費用・税</th><th>実現損益</th><th>操作</th></tr></thead><tbody id="p2hd-events-body"></tbody></table></div></div></section>`;
    mount.appendChild(stack);
    registLedgerDialog(mount);
  }

  // [T277] 本日の作業一覧を登録する。
  function _registWork(){
    const box=document.getElementById("p2hd-work");box.textContent="";
    const status=_selectJstStatus(objData);
    const favoriteKeys=new Set(listFavorites.map(_createFavoriteKey));
    const count=objData.datasets.reduce((sum,dataset)=>sum+dataset.records.filter(record=>(record.conditions||[]).some(condition=>favoriteKeys.has(dataset.dataset_key+"::"+(condition.condition_id||condition)))).length,0);
    [{no:"1",title:"本日エントリー",time:"9:00～9:30",count:`${count}件`,status},{no:"2",title:"本日決済（終値基準）",time:"15:30",count:`${selectSettlements(objData).filter(item=>item.business_day_offset===0).length}件`,status:{label:"予定確認",className:""}}].forEach(item=>{
      const row=_createElement("div","p2hd-work-item");row.appendChild(_createElement("span","p2hd-work-no",item.no));
      const detail=_createElement("div");detail.appendChild(_createElement("strong","",item.title));detail.appendChild(_createElement("div","p2hd-work-time",`${item.time} / ${item.count}`));row.appendChild(detail);
      row.appendChild(_createElement("span","p2hd-status "+item.status.className,item.status.label));box.appendChild(row);
    });
    const statusBox=document.getElementById("p2hd-data-status");statusBox.textContent=objData.status==="ready"?"確定":"未確定";statusBox.className="p2hd-status "+(objData.status==="ready"?"":"is-pending");
    document.getElementById("p2hd-data-note").textContent=objData.message||`対象日 ${objData.market_date||"未確定"} / 更新 ${objData.generated_at_jst||"未確定"}`;
  }

  // [F007] データセットselect登録
  function registDatasetSelector(){
    const select=document.getElementById("p2hd-dataset");select.textContent="";
    objData.datasets.slice().sort((a,b)=>Number(a.case_no)-Number(b.case_no)).forEach(dataset=>{const option=_createElement("option","",`${String(dataset.case_no).padStart(2,"0")} ${dataset.label}`);option.value=dataset.dataset_key;select.appendChild(option)});
    select.value=objData.datasets.some(item=>item.dataset_key==="all_225")?"all_225":String(objData.datasets[0]?.dataset_key||"");
    select.addEventListener("change",()=>{registEntryTable();registAllocation()});
  }

  // [T278] お気に入りに一致する条件を取得する。
  function _favoriteConditions(dataset,record){
    const keys=new Set(listFavorites.map(_createFavoriteKey));
    return (record.conditions||[]).map(condition=>typeof condition==="string"?{condition_id:condition,label:condition}:condition).filter(condition=>keys.has(dataset.dataset_key+"::"+condition.condition_id));
  }

  // [F008] エントリー表登録
  function registEntryTable(){
    const body=document.getElementById("p2hd-entry-body");body.textContent="";
    const key=document.getElementById("p2hd-dataset").value;
    const dataset=objData.datasets.find(item=>item.dataset_key===key);
    const records=(dataset?.records||[]).map(record=>({record,conditions:_favoriteConditions(dataset,record)})).filter(item=>item.conditions.length);
    document.getElementById("p2hd-entry-count").textContent=`${records.length}件`;
    const notice=document.getElementById("p2hd-entry-notice");notice.textContent="";
    if(objData.status!=="ready"){const item=_createElement("p","p2hd-notice",objData.message||"本日の確定データは未生成です。");notice.appendChild(item)}
    if(!records.length){_registEmptyState(body,objData.status==="ready"?"お気に入り条件に一致する候補はありません。":"確定データ生成後に候補を表示します。",6);return}
    records.forEach(item=>{
      const row=document.createElement("tr");
      _appendCell(row,"状態","候補");_appendCell(row,"コード・銘柄",`${item.record.ticker||""} ${item.record.name||""}`);_appendCell(row,"判定",`${item.record.direction||"long"} / ${item.record.pattern||"P2 v12"}`);_appendCell(row,"お気に入り条件",item.conditions.map(condition=>condition.label||condition.condition_id).join("、"));
      const dates=item.record.evaluation_dates||{};_appendCell(row,"評価日",`5D ${dates["5D"]||"-"} / 10D ${dates["10D"]||"-"} / 20D ${dates["20D"]||"-"}`);
      const action=_appendCell(row,"操作","");const recordButton=_createElement("button","p2hd-btn","購入記録");recordButton.type="button";recordButton.addEventListener("click",()=>_openLedgerDialog("BUY",item.record,dataset));action.appendChild(recordButton);
      const path=_selectSafeLocalPath(item.record.detail_path);if(path){const link=_createElement("a","p2hd-btn","詳細");link.href=path;action.appendChild(link)}body.appendChild(row);
    });
  }

  // [F006] 決済予定表登録
  function registSettlementTable(){
    const body=document.getElementById("p2hd-settlement-body");body.textContent="";
    const labels={"-2":"2営業日前","-1":"1営業日前","0":"本日","1":"翌営業日","2":"翌々営業日"};
    const groups=new Map([-2,-1,0,1,2].map(offset=>[offset,[]]));_selectSettlementWindow(selectSettlements(objData)).forEach(item=>groups.get(item.business_day_offset).push(item));
    groups.forEach((items,offset)=>{if(!items.length){const row=document.createElement("tr");if(offset===0)row.className="is-today";_appendCell(row,"区分",labels[offset]);const cell=_appendCell(row,"予定","対象なし");cell.colSpan=6;body.appendChild(row);return}items.forEach(item=>{const row=document.createElement("tr");if(offset===0)row.className="is-today";_appendCell(row,"区分",labels[offset]);_appendCell(row,"予定日・時刻",`${item.target_date||"-"} 15:30`);_appendCell(row,"コード・銘柄",`${item.ticker||""} ${item.name||""}`);_appendCell(row,"データセット",item.dataset_label||item.dataset_key||"");_appendCell(row,"期間",item.horizon||"");_appendCell(row,"対象日",item.entry_date||"");const action=_appendCell(row,"操作","");const button=_createElement("button","p2hd-btn","売却記録");button.type="button";button.addEventListener("click",()=>_openLedgerDialog("SELL",item,null));action.appendChild(button);body.appendChild(row)})});
  }

  // [F009] 証券会社link登録
  function registBrokerLinks(){const box=document.getElementById("p2hd-brokers");BROKERS.forEach(item=>{const link=_createElement("a","p2hd-broker",item.name);link.href=item.url;link.target="_blank";link.rel="noopener noreferrer";link.appendChild(_createElement("small","",item.note));box.appendChild(link)})}

  // [T279] 資金配分設定を取得する。
  function _loadAllocation(){
    const defaults={operatingAssets:1000000,reserveRate:20,safetyRate:120,maxConcurrent:20,roundingUnit:100};
    try{return Object.assign(defaults,JSON.parse(localStorage.getItem(KEY_ALLOCATION)||"{}"))}catch(_error){return defaults}
  }

  // [T008] 金額切下げ
  function _floorMoney(value,unit){return Math.floor(Number(value)/Number(unit))*Number(unit)}

  // [F010] 資金配分計算
  function calculateAllocation(settings,candidateCount,cash){
    const planSlots=Math.max(1,Math.ceil(Number(settings.maxConcurrent)*Number(settings.safetyRate)/100));
    const availableByPlan=Math.floor(Number(settings.operatingAssets)*(1-Number(settings.reserveRate)/100));
    const stake=_floorMoney(availableByPlan/planSlots,settings.roundingUnit);
    const required=stake*candidateCount;
    return {planSlots,stake,required,availableCash:Number(cash),shortage:Math.max(0,required-Number(cash))};
  }

  // [F011] 資金配分登録
  function registAllocation(){
    const form=document.getElementById("p2hd-allocation-form");form.textContent="";const settings=_loadAllocation();
    [{key:"operatingAssets",label:"現在運用資産（円）",min:0},{key:"reserveRate",label:"現金余力（%）",min:0,max:99},{key:"safetyRate",label:"安全率（%）",min:100},{key:"maxConcurrent",label:"過去最大同時保有",min:1},{key:"roundingUnit",label:"丸め単位（円）",min:1}].forEach(def=>{const field=_createElement("div","p2hd-field");const label=_createElement("label","",def.label);const input=document.createElement("input");input.type="number";input.name=def.key;input.value=settings[def.key];input.min=def.min;if(def.max!==undefined)input.max=def.max;input.addEventListener("change",()=>{const next=_loadAllocation();next[def.key]=Number(input.value);localStorage.setItem(KEY_ALLOCATION,JSON.stringify(next));registAllocation()});field.append(label,input);form.appendChild(field)});
    const dataset=objData.datasets.find(item=>item.dataset_key===document.getElementById("p2hd-dataset")?.value);const count=(dataset?.records||[]).filter(record=>_favoriteConditions(dataset,record).length).length;const result=calculateAllocation(settings,count,objPortfolio?.cash||0);const box=document.getElementById("p2hd-allocation-result");box.textContent="";box.appendChild(_createElement("span","p2hd-metric-label","1銘柄あたり参考掛け金"));box.appendChild(_createElement("strong","",_formatMoney(result.stake)));box.appendChild(_createElement("p","",`計画 ${result.planSlots}枠 / 本日 ${count}件・必要額 ${_formatMoney(result.required)} / 現金 ${_formatMoney(result.availableCash)}`));if(result.shortage>0)box.appendChild(_createElement("p","p2hd-notice p2hd-error",`資金が${_formatMoney(result.shortage)}不足します。候補の自動選別は行いません。`));
  }

  // [T010] IndexedDB接続
  function _openPortfolioDb(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_PORTFOLIO,DB_VERSION);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains("events")){const store=db.createObjectStore("events",{keyPath:"eventId"});store.createIndex("positionId","positionId",{unique:false});store.createIndex("executedAtJst","executedAtJst",{unique:false})}if(!db.objectStoreNames.contains("valuations"))db.createObjectStore("valuations",{keyPath:"positionId"});if(!db.objectStoreNames.contains("meta"))db.createObjectStore("meta",{keyPath:"key"})};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
  // [T280] IndexedDB storeの全件を取得する。
  async function _selectStoreAll(name){const db=await _openPortfolioDb();return new Promise((resolve,reject)=>{const request=db.transaction(name,"readonly").objectStore(name).getAll();request.onsuccess=()=>{db.close();resolve(request.result)};request.onerror=()=>{db.close();reject(request.error)}})}
  // [T281] IndexedDB storeへ1件を保存する。
  async function _putStore(name,value){const db=await _openPortfolioDb();return new Promise((resolve,reject)=>{const transaction=db.transaction(name,"readwrite");transaction.objectStore(name).put(value);transaction.oncomplete=()=>{db.close();resolve()};transaction.onerror=()=>{db.close();reject(transaction.error)}})}

  // [T009] 台帳event検証
  function _validateLedgerEvent(event){
    if(!event||typeof event!=="object"||!event.eventId||!["BUY","SELL","DIVIDEND","CASH_DEPOSIT","CASH_WITHDRAWAL","ADJUST","VOID"].includes(event.eventType))throw new Error("台帳eventが不正です。");
    if(!event.executedAtJst||Number.isNaN(new Date(event.executedAtJst).getTime()))throw new Error("実行日時が不正です。");
    if(["BUY","SELL"].includes(event.eventType)&&(!event.positionId||!event.ticker||_parseDecimal(event.quantity,QUANTITY_SCALE)<=0n||_parseDecimal(event.price,PRICE_SCALE)<=0n))throw new Error("売買内容が不正です。");
    if(["CASH_DEPOSIT","CASH_WITHDRAWAL","DIVIDEND"].includes(event.eventType)&&(!Number.isInteger(event.amountYen)||event.amountYen<=0))throw new Error("金額は1円以上の整数で入力してください。");
    if(event.eventType==="ADJUST"&&!Number.isInteger(event.amountYen))throw new Error("調整金額は整数で入力してください。");
    if(event.eventType==="VOID"&&!event.voidEventId)throw new Error("訂正対象eventが未設定です。");
    if(!Number.isInteger(Number(event.feeYen||0))||Number(event.feeYen||0)<0||!Number.isInteger(Number(event.taxYen||0))||Number(event.taxYen||0)<0)throw new Error("費用・税は0円以上の整数で入力してください。");
    return event;
  }

  // [F012] 台帳event登録
  async function registLedgerEvent(event){_validateLedgerEvent(event);calculatePortfolio([...listEvents,event],listValuations);await _putStore("events",event);await _refreshPortfolio()}

  // [F013] Portfolio計算
  function calculatePortfolio(events,valuations){
    const voidIds=new Set(events.filter(event=>event.eventType==="VOID").map(event=>event.voidEventId));const active=events.filter(event=>event.eventType!=="VOID"&&!voidIds.has(event.eventId)).slice().sort((a,b)=>String(a.executedAtJst).localeCompare(String(b.executedAtJst)));
    const positions=new Map();let cash=0;let realized=0;const eventResults=new Map();
    active.forEach(event=>{
      const fee=Number(event.feeYen||0),tax=Number(event.taxYen||0),amount=Number(event.amountYen||0);
      if(event.eventType==="CASH_DEPOSIT")cash+=amount;else if(event.eventType==="CASH_WITHDRAWAL")cash-=amount;else if(event.eventType==="ADJUST")cash+=amount;else if(event.eventType==="DIVIDEND"){cash+=amount-fee-tax;realized+=amount-fee-tax;eventResults.set(event.eventId,amount-fee-tax)}
      else if(event.eventType==="BUY"){
        const quantity=_parseDecimal(event.quantity,QUANTITY_SCALE),gross=_calculateMoney(event.quantity,event.price),cost=gross+fee+tax;cash-=cost;const item=positions.get(event.positionId)||{positionId:event.positionId,ticker:event.ticker,name:event.name||"",datasetKey:event.datasetKey||"",conditionIds:event.conditionIds||[],horizon:event.horizon||"",quantity:0n,costYen:0};item.quantity+=quantity;item.costYen+=cost;positions.set(event.positionId,item);
      }else if(event.eventType==="SELL"){
        const item=positions.get(event.positionId);const quantity=_parseDecimal(event.quantity,QUANTITY_SCALE);if(!item||quantity>item.quantity)throw new Error(`${event.ticker||"銘柄"}の売却数量が保有数量を超えています。`);const gross=_calculateMoney(event.quantity,event.price);const allocated=Number((BigInt(item.costYen)*quantity+item.quantity/2n)/item.quantity);const profit=gross-fee-tax-allocated;cash+=gross-fee-tax;realized+=profit;eventResults.set(event.eventId,profit);item.quantity-=quantity;item.costYen-=allocated;if(item.quantity===0n)positions.delete(event.positionId);
      }
    });
    const valuationMap=new Map(valuations.map(item=>[item.positionId,item]));let market=0,cost=0,unrealized=0;const holdings=[];positions.forEach(item=>{const valuation=valuationMap.get(item.positionId);const value=valuation?_calculateMoney(_decimalText(item.quantity,QUANTITY_SCALE,6),valuation.price):item.costYen;market+=value;cost+=item.costYen;unrealized+=value-item.costYen;holdings.push({...item,quantityText:_decimalText(item.quantity,QUANTITY_SCALE,6),marketYen:value,unrealizedYen:value-item.costYen,valuation})});
    return {cash,market,cost,realized,unrealized,total:cash+market,holdings,activeEvents:active,eventResults};
  }

  // [T282] 運用指標DOMを生成する。
  function _metric(label,value,className){const box=_createElement("div","p2hd-metric");box.appendChild(_createElement("span","p2hd-metric-label",label));box.appendChild(_createElement("strong","p2hd-metric-value "+(className||""),value));return box}
  // [T283] 運用状況と現在保有を登録する。
  function _registPortfolio(){
    const summary=document.getElementById("p2hd-summary");summary.textContent="";[["運用資金合計",objPortfolio.total],["現金",objPortfolio.cash],["投資元本",objPortfolio.cost],["時価評価",objPortfolio.market],["実現損益",objPortfolio.realized],["含み損益",objPortfolio.unrealized]].forEach(([label,value])=>summary.appendChild(_metric(label,_formatMoney(value),value>0?"p2hd-positive":value<0?"p2hd-negative":"")));
    const body=document.getElementById("p2hd-holdings");body.textContent="";if(!objPortfolio.holdings.length){_registEmptyState(body,"現在保有はありません。購入記録を追加すると表示します。",7);return}objPortfolio.holdings.forEach(item=>{const row=document.createElement("tr");_appendCell(row,"コード・銘柄",`${item.ticker} ${item.name}`);_appendCell(row,"期間",item.horizon||"-");_appendCell(row,"数量",_formatQuantity(item.quantityText));_appendCell(row,"取得原価",_formatMoney(item.costYen));_appendCell(row,"評価額",_formatMoney(item.marketYen)+(item.valuation?"":"（未評価）"));_appendCell(row,"含み損益",_formatMoney(item.unrealizedYen));const action=_appendCell(row,"操作","");const sell=_createElement("button","p2hd-btn","売却");sell.type="button";sell.addEventListener("click",()=>_openLedgerDialog("SELL",item,null));const valuation=_createElement("button","p2hd-btn","評価更新");valuation.type="button";valuation.addEventListener("click",()=>_updateValuation(item));action.append(sell,valuation);body.appendChild(row)})
  }

  // [T284] 保有銘柄の評価単価を更新する。
  async function _updateValuation(item){const price=prompt(`${item.ticker} ${item.name} の評価単価（円）`,item.valuation?.price||"");if(price===null)return;_parseDecimal(price,PRICE_SCALE);await _putStore("valuations",{positionId:item.positionId,price,evaluatedAtJst:new Date().toISOString(),basis:"manual"});await _refreshPortfolio()}

  // [F014] 台帳dialog登録
  function registLedgerDialog(mount){
    const dialog=_createElement("dialog","p2hd-dialog");dialog.id="p2hd-ledger-dialog";dialog.innerHTML=`<form method="dialog" id="p2hd-ledger-form"><h3>取引・入出金を記録</h3><div class="p2hd-dialog-grid"><div class="p2hd-field"><label>種別</label><select name="eventType"><option value="BUY">購入</option><option value="SELL">売却</option><option value="DIVIDEND">配当</option><option value="CASH_DEPOSIT">入金</option><option value="CASH_WITHDRAWAL">出金</option><option value="ADJUST">調整</option></select></div><div class="p2hd-field"><label>実行日時</label><input type="datetime-local" name="executedAt" required></div><div class="p2hd-field"><label>position ID</label><input name="positionId"></div><div class="p2hd-field"><label>コード</label><input name="ticker"></div><div class="p2hd-field"><label>銘柄名</label><input name="name"></div><div class="p2hd-field"><label>データセット</label><input name="datasetKey"></div><div class="p2hd-field"><label>条件ID（カンマ区切り）</label><input name="conditionIds"></div><div class="p2hd-field"><label>期間</label><select name="horizon"><option value="">未設定</option><option>5D</option><option>10D</option><option>20D</option></select></div><div class="p2hd-field"><label>数量</label><input name="quantity" inputmode="decimal"></div><div class="p2hd-field"><label>単価（円）</label><input name="price" inputmode="decimal"></div><div class="p2hd-field"><label>金額（入出金・配当・調整）</label><input name="amountYen" type="number"></div><div class="p2hd-field"><label>手数料（円）</label><input name="feeYen" type="number" min="0" value="0"></div><div class="p2hd-field"><label>税（円）</label><input name="taxYen" type="number" min="0" value="0"></div><div class="p2hd-field"><label>メモ</label><textarea name="note" rows="2"></textarea></div></div><p class="p2hd-caption">売買では数量・単価・position IDが必須です。数量は小数6桁、単価は小数2桁まで保存できます。</p><div class="p2hd-dialog-menu"><button type="button" class="p2hd-btn" data-action="close-dialog">キャンセル</button><button type="submit" value="save" class="p2hd-btn p2hd-btn-primary">保存</button></div></form>`;mount.appendChild(dialog);
    dialog.querySelector('[data-action="close-dialog"]').addEventListener("click",()=>dialog.close());dialog.querySelector("form").addEventListener("submit",async event=>{event.preventDefault();try{const form=new FormData(event.currentTarget);const type=String(form.get("eventType"));const ledgerEvent={eventId:_newId("evt"),eventType:type,executedAtJst:new Date(String(form.get("executedAt"))).toISOString(),positionId:String(form.get("positionId")||""),ticker:String(form.get("ticker")||"").trim(),name:String(form.get("name")||"").trim(),datasetKey:String(form.get("datasetKey")||"").trim(),conditionIds:String(form.get("conditionIds")||"").split(",").map(value=>value.trim()).filter(Boolean),horizon:String(form.get("horizon")||""),quantity:String(form.get("quantity")||"0"),price:String(form.get("price")||"0"),amountYen:Number(form.get("amountYen")||0),feeYen:Number(form.get("feeYen")||0),taxYen:Number(form.get("taxYen")||0),note:String(form.get("note")||"").trim(),createdAtJst:new Date().toISOString()};await registLedgerEvent(ledgerEvent);dialog.close()}catch(error){alert(error.message)}});
  }

  // [T285] 台帳入力dialogを開く。
  function _openLedgerDialog(type,source,dataset){
    const dialog=document.getElementById("p2hd-ledger-dialog"),form=dialog.querySelector("form");form.reset();form.elements.eventType.value=type;
    const now=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);form.elements.executedAt.value=now;
    const holding=type==="SELL"?objPortfolio?.holdings.find(item=>item.positionId===source?.positionId||(item.ticker===source?.ticker&&(!source?.horizon||item.horizon===source.horizon))):null;
    form.elements.positionId.value=holding?.positionId||source?.positionId||(type==="BUY"?_newId("pos"):"");form.elements.ticker.value=holding?.ticker||source?.ticker||"";form.elements.name.value=holding?.name||source?.name||"";form.elements.datasetKey.value=dataset?.dataset_key||holding?.datasetKey||source?.datasetKey||source?.dataset_key||"";form.elements.conditionIds.value=(holding?.conditionIds||source?.conditionIds||source?.conditions||[]).map(item=>typeof item==="string"?item:item.condition_id).join(",");form.elements.horizon.value=holding?.horizon||source?.horizon||"";form.elements.quantity.value=holding?.quantityText||source?.quantityText||"";dialog.showModal();
  }

  // [F015] 最近event登録
  function registRecentEvents(){
    const body=document.getElementById("p2hd-events-body");body.textContent="";const voidIds=new Set(listEvents.filter(event=>event.eventType==="VOID").map(event=>event.voidEventId));const items=listEvents.slice().sort((a,b)=>String(b.executedAtJst).localeCompare(String(a.executedAtJst))).slice(0,20);if(!items.length){_registEmptyState(body,"売買・入出金記録はありません。",8);return}items.forEach(item=>{const row=document.createElement("tr");const cancelled=voidIds.has(item.eventId);_appendCell(row,"日時",_formatDateTime(item.executedAtJst));_appendCell(row,"種別",cancelled?`${item.eventType}（取消済み）`:item.eventType);_appendCell(row,"コード・銘柄",`${item.ticker||"-"} ${item.name||""}`);_appendCell(row,"数量",item.quantity&&item.quantity!=="0"?item.quantity:"-");const gross=["BUY","SELL"].includes(item.eventType)?_calculateMoney(item.quantity,item.price):Number(item.amountYen||0);_appendCell(row,"金額",_formatMoney(gross));_appendCell(row,"費用・税",_formatMoney(Number(item.feeYen||0)+Number(item.taxYen||0)));_appendCell(row,"実現損益",objPortfolio.eventResults.has(item.eventId)?_formatMoney(objPortfolio.eventResults.get(item.eventId)):"-");const action=_appendCell(row,"操作","");if(item.eventType!=="VOID"&&!cancelled){const button=_createElement("button","p2hd-btn p2hd-btn-danger","訂正");button.type="button";button.addEventListener("click",async()=>{if(!confirm("この記録を取消しeventで訂正しますか？"))return;await registLedgerEvent({eventId:_newId("evt"),eventType:"VOID",voidEventId:item.eventId,executedAtJst:new Date().toISOString(),note:"利用者による訂正",createdAtJst:new Date().toISOString()})});action.appendChild(button)}body.appendChild(row)})
  }

  // [F016] 台帳backup出力
  async function exportLedger(){const payload={schema:"product_kabu_portfolio",version:1,exportedAt:new Date().toISOString(),events:await _selectStoreAll("events"),valuations:await _selectStoreAll("valuations")};const blob=new Blob([JSON.stringify(payload,null,2)+"\n"],{type:"application/json"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=`product_kabu_portfolio_${new Date().toISOString().slice(0,10).replaceAll("-","")}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),0)}

  // [T012] backup検証
  function _validateBackup(value){
    if(!value||value.schema!=="product_kabu_portfolio"||value.version!==1||!Array.isArray(value.events)||!Array.isArray(value.valuations))throw new Error("バックアップ形式が不正です。");
    value.events.forEach(_validateLedgerEvent);const eventIds=value.events.map(item=>item.eventId);if(new Set(eventIds).size!==eventIds.length)throw new Error("event IDが重複しています。");
    const eventIdSet=new Set(eventIds);value.events.filter(item=>item.eventType==="VOID").forEach(item=>{if(!eventIdSet.has(item.voidEventId))throw new Error("訂正対象eventが存在しません。")});
    const valuationIds=new Set();value.valuations.forEach(item=>{if(!item||!item.positionId||valuationIds.has(item.positionId)||_parseDecimal(item.price,PRICE_SCALE)<=0n)throw new Error("評価値が不正です。");valuationIds.add(item.positionId)});
    calculatePortfolio(value.events,value.valuations);return value;
  }

  // [T286] 台帳backup内容でローカルDBを置換する。
  async function _replaceLedger(value){const db=await _openPortfolioDb();return new Promise((resolve,reject)=>{const transaction=db.transaction(["events","valuations"],"readwrite");const eventStore=transaction.objectStore("events"),valuationStore=transaction.objectStore("valuations");eventStore.clear();valuationStore.clear();value.events.forEach(item=>eventStore.put(item));value.valuations.forEach(item=>valuationStore.put(item));transaction.oncomplete=()=>{db.close();resolve()};transaction.onerror=()=>{db.close();reject(transaction.error)}})}

  // [F017] 台帳backup復元
  async function importLedger(file){const value=_validateBackup(JSON.parse(await file.text()));if(!confirm(`台帳${value.events.length}件、評価${value.valuations.length}件で現在のローカル台帳を置き換えますか？`))return;await _replaceLedger(value);await _refreshPortfolio()}

  // [T287] 台帳状態を再取得して画面を更新する。
  async function _refreshPortfolio(){listEvents=await _selectStoreAll("events");listValuations=await _selectStoreAll("valuations");objPortfolio=calculatePortfolio(listEvents,listValuations);_registPortfolio();registRecentEvents();registAllocation()}

  // [T288] 台帳操作buttonを登録する。
  function _registActions(mount){mount.querySelector('[data-action="open-ledger"]').addEventListener("click",()=>_openLedgerDialog("BUY",null,null));mount.querySelector('[data-action="export-ledger"]').addEventListener("click",()=>exportLedger().catch(error=>alert(error.message)));const input=mount.querySelector('[data-role="import-file"]');mount.querySelector('[data-action="import-ledger"]').addEventListener("click",()=>input.click());input.addEventListener("change",()=>{const file=input.files?.[0];if(file)importLedger(file).catch(error=>alert(error.message));input.value=""})}

  // [T007] 致命状態登録
  function _registFatalState(mount,error){mount.textContent="";const box=_createElement("section","p2hd-card");const body=_createElement("div","p2hd-card-body");body.appendChild(_createElement("p","p2hd-notice p2hd-error",`今日のエントリー画面を初期化できませんでした: ${error.message}`));box.appendChild(body);mount.appendChild(box)}

  // [F021] 初期化メイン
  async function main(){
    const mount=document.getElementById("p2-home-dashboard");if(!mount)return;
    try{objData=await selectDashboardData(mount);listFavorites=selectFavorites();registDashboard(mount);_registWork();registDatasetSelector();registEntryTable();registSettlementTable();registBrokerLinks();_registActions(mount);await _refreshPortfolio()}catch(error){_registFatalState(mount,error)}
  }

  globalThis.P2HomeDashboardTestApi={_validateDashboardData,_selectSafeLocalPath,_parseDecimal,_calculateMoney,calculateAllocation,calculatePortfolio};
  if(typeof document!=="undefined")document.addEventListener("DOMContentLoaded",main);
})();
