/* Created: 2026-10-07T12:11:00+09:00
   Purpose: Apache-local UI normalization without writing generated HTML.
   Source: scripts/postprocess_p2_accuracy_highlight.py plus runtime chart override.
*/
(function(){
  "use strict";
  if(window.__P2_LOCAL_RUNTIME_V1__)return;
  window.__P2_LOCAL_RUNTIME_V1__=true;
(function(){
  "use strict";
  const FAVORITES_KEY="product_kabu_favorites_v1";
  const HORIZONS=[5,10,20];

  function norm(v){
    return String(v == null ? "" : v).replace(/\s+/g,"").replace(/％/g,"%").trim();
  }

  function buildHeaderGrid(table){
    const rows=table.tHead?Array.from(table.tHead.rows):[];
    if(!rows.length)return [];
    const grid=[];
    rows.forEach((row,y)=>{
      grid[y]=grid[y]||[];
      let x=0;
      Array.from(row.cells).forEach(cell=>{
        while(grid[y][x]!==undefined)x++;
        const rs=Math.max(1,Number(cell.rowSpan||1));
        const cs=Math.max(1,Number(cell.colSpan||1));
        const text=norm(cell.textContent);
        for(let dy=0;dy<rs;dy++){
          grid[y+dy]=grid[y+dy]||[];
          for(let dx=0;dx<cs;dx++)grid[y+dy][x+dx]=text;
        }
        x+=cs;
      });
    });
    const width=Math.max(...grid.map(r=>r.length),0),cols=[];
    for(let x=0;x<width;x++){
      const seen=[];
      for(let y=0;y<grid.length;y++){
        const t=grid[y][x];
        if(t&&!seen.includes(t))seen.push(t);
      }
      cols.push(seen.join(" / "));
    }
    return cols;
  }

  function isConditionHeader(text){
    const t=norm(text);
    return t==="条件"||t==="OR条件"||t==="条件名";
  }

  function compactConditionCell(cell){
    if(!cell)return;
    cell.classList.add("p2-condition-col");
    const full=String(cell.textContent||"").trim();
    if(full&&!cell.getAttribute("title"))cell.setAttribute("title",full);
    if(cell.tagName==="TH")return;
    const first=cell.firstElementChild;
    if(first&&first.classList&&first.classList.contains("p2-condition-inner"))return;
    const inner=document.createElement("div");
    inner.className="p2-condition-inner";
    while(cell.firstChild)inner.appendChild(cell.firstChild);
    cell.appendChild(inner);
  }

  function compactConditionColumns(table){
    const headers=buildHeaderGrid(table);
    if(!headers.length)return false;
    const cols=headers.map((h,i)=>isConditionHeader(h)?i:-1).filter(i=>i>=0);
    if(!cols.length)return false;
    Array.from(table.querySelectorAll("thead th")).forEach(th=>{
      if(isConditionHeader(th.textContent))compactConditionCell(th);
    });
    Array.from(table.tBodies||[]).forEach(body=>{
      Array.from(body.rows).forEach(row=>cols.forEach(i=>compactConditionCell(row.cells[i])));
    });
    return true;
  }

  const assetMetricCache=new Map();

  function assetMetricsFromData(data,horizon){
    if(!Array.isArray(data)||!data.length)return null;
    const half=Math.floor(data.length/2);
    function curve(baseIndex,endIndex){
      let asset=100,peak=100,maxDd=0;
      const end=endIndex==null?data.length:endIndex;
      for(let i=baseIndex+1;i<end;i++){
        const raw=data[i]?data[i]["r"+horizon]:null;
        const ret=(raw===null||raw===undefined||raw==="")?null:Number(raw);
        if(ret===null||!Number.isFinite(ret))continue;
        asset*=1+ret/100;
        peak=Math.max(peak,asset);
        if(peak>0)maxDd=Math.min(maxDd,(asset/peak-1)*100);
      }
      return {growth:asset-100,maxDd};
    }
    const full=curve(0,null),front=curve(0,half),back=curve(half,null);
    return {growth:full.growth,front:front.growth,back:back.growth,maxDd:full.maxDd};
  }

  function metricText(v){
    if(v===null||v===undefined||!Number.isFinite(v))return "-";
    return (v>=0?"+":"")+v.toFixed(1)+"%";
  }

  function loadAssetMetrics(href){
    const url=new URL(href,window.location.href).href;
    if(assetMetricCache.has(url))return assetMetricCache.get(url);
    const p=fetch(url)
      .then(r=>{if(!r.ok)throw new Error("chart fetch failed "+r.status);return r.text()})
      .then(t=>{
        const m=t.match(/const\s+DATA\s*=\s*(\[[\s\S]*?\]);\s*const\s+entryStyle/);
        if(!m)throw new Error("chart DATA not found");
        const data=JSON.parse(m[1]),out={};
        HORIZONS.forEach(h=>out[h]=assetMetricsFromData(data,h));
        return out;
      })
      .catch(()=>null);
    assetMetricCache.set(url,p);
    return p;
  }

  function hasTwelveAssetMetrics(headers){
    return HORIZONS.every(h=>
      ["増加率","前半","後半","最大DD"].every(m=>
        headers.some(x=>norm(x)===norm(h+"D / "+m))
      )
    );
  }

  function enhanceAssetMetricTable(table){
    if(table.dataset.p2AssetMetrics==="1")return false;
    if(!table.classList.contains("focus-table"))return false;
    const headers=buildHeaderGrid(table);
    const conditionIndex=headers.findIndex(isConditionHeader);
    const growthIndex=headers.findIndex(h=>norm(h)==="増加率");
    if(conditionIndex<0)return false;
    if(hasTwelveAssetMetrics(headers)){
      table.dataset.p2AssetMetrics="1";
      return false;
    }
    if(growthIndex<0)return false;

    const headRows=table.tHead?Array.from(table.tHead.rows):[];
    if(headRows.length<2)return false;
    const first=headRows[0],second=headRows[1];
    const metricNames=new Set(["増加率","1/2増加率","前半","後半","最大DD"]);
    Array.from(first.cells).forEach(th=>{
      if(metricNames.has(norm(th.textContent)))th.remove();
    });
    HORIZONS.forEach(h=>{
      const th=document.createElement("th");
      th.colSpan=4;
      th.className="group-start p2-asset-group";
      th.textContent=h+"D";
      first.appendChild(th);
      ["増加率","前半","後半","最大DD"].forEach((label,j)=>{
        const d=document.createElement("th");
        d.textContent=label;
        if(j===0)d.classList.add("group-start");
        second.appendChild(d);
      });
    });

    Array.from(table.tBodies||[]).forEach(body=>{
      Array.from(body.rows).forEach(row=>{
        const conditionCell=row.cells[conditionIndex];
        const link=conditionCell?conditionCell.querySelector('a[href*="high_entry_charts/"],a[href*="conditions/charts/"]'):null;
        while(row.cells.length>growthIndex)row.deleteCell(growthIndex);
        const cells=[];
        HORIZONS.forEach(h=>{
          for(let j=0;j<4;j++){
            const td=document.createElement("td");
            if(j===0)td.classList.add("group-start");
            td.textContent="-";
            row.appendChild(td);
            cells.push(td);
          }
        });
        if(!link)return;
        loadAssetMetrics(link.getAttribute("href")).then(all=>{
          if(!all)return;
          HORIZONS.forEach((h,hi)=>{
            const m=all[h];
            if(!m)return;
            const base=hi*4;
            cells[base].textContent=metricText(m.growth);
            cells[base+1].textContent=metricText(m.front);
            cells[base+2].textContent=metricText(m.back);
            cells[base+3].textContent=metricText(m.maxDd);
          });
        });
      });
    });
    table.dataset.p2AssetMetrics="1";
    return true;
  }

  function datasetInfo(){
    const p=decodeURIComponent(location.pathname);
    const defs=[
      ["exclude_capital_goods_transportation_utilities","225_excl_capital_transport","主要225株（資本財・その他＋運輸・公益除外）"],
      ["exclude_transportation_utilities","225_excl_transport","主要225株（運輸・公益除外）"],
      ["/225_group_all_period/technology/","225_group_technology","技術（全期間）"],
      ["/225_group_all_period/financials/","225_group_financials","金融（全期間）"],
      ["/225_group_all_period/consumer_goods/","225_group_consumer","消費（全期間）"],
      ["/225_group_all_period/materials/","225_group_materials","素材（全期間）"],
      ["/225_group_all_period/capital_goods_others/","225_group_capital","資本財・その他（全期間）"],
      ["/225_group_all_period/transportation_utilities/","225_group_transport","運輸・公益（全期間）"],
      ["/225_indicator_stageb/","225_all_period","主要225株（全期間）"]
    ];
    for(const [needle,key,name] of defs)if(p.includes(needle))return {key,name};
    if(p.includes("/kabu/analysis/"))return {key:"nikkei_all_period",name:"日経平均（全期間）"};
    return {key:"unknown",name:"分析データ"};
  }

  function loadFavorites(){
    try{
      const raw=JSON.parse(localStorage.getItem(FAVORITES_KEY)||"[]");
      if(!Array.isArray(raw))return [];
      const out=[],seen=new Set();
      raw.forEach(x=>{
        if(!x||typeof x!=="object")return;
        const item={
          datasetKey:String(x.datasetKey||"").trim(),
          datasetName:String(x.datasetName||"").trim(),
          conditionId:String(x.conditionId||"").trim(),
          conditionLabel:String(x.conditionLabel||"").trim(),
          chartPath:String(x.chartPath||x.chartUrl||"").trim(),
          savedAt:String(x.savedAt||"").trim()
        };
        if(!item.datasetKey||!item.datasetName||!item.conditionId||!item.conditionLabel||!item.chartPath.startsWith("/"))return;
        const key=item.datasetKey+"::"+item.conditionId;
        if(seen.has(key))return;
        seen.add(key);out.push(item);
      });
      return out;
    }catch(_e){return []}
  }

  function saveFavorites(items){
    localStorage.setItem(FAVORITES_KEY,JSON.stringify(items));
  }

  function favoriteKey(item){return item.datasetKey+"::"+item.conditionId}

  function isFavorite(item){
    const key=favoriteKey(item);
    return loadFavorites().some(x=>favoriteKey(x)===key);
  }

  function toggleFavorite(item){
    const list=loadFavorites(),key=favoriteKey(item);
    const pos=list.findIndex(x=>favoriteKey(x)===key);
    if(pos>=0)list.splice(pos,1);
    else{
      item.savedAt=new Date().toISOString();
      list.push(item);
    }
    saveFavorites(list);
    syncFavoriteButtons();
    renderFavoritesPanel();
  }

  function syncFavoriteButtons(){
    const keys=new Set(loadFavorites().map(favoriteKey));
    document.querySelectorAll(".p2-favorite-btn[data-favorite-key]").forEach(btn=>{
      const on=keys.has(btn.dataset.favoriteKey);
      btn.textContent=on?"★":"☆";
      btn.classList.toggle("is-favorite",on);
      btn.title=on?"お気に入りから解除":"お気に入りに追加";
      btn.setAttribute("aria-label",btn.title);
    });
  }

  function addFavoriteColumn(table){
    if(table.dataset.p2FavoritesReady==="1")return false;
    if(!table.classList.contains("focus-table"))return false;
    const headers=buildHeaderGrid(table);
    const idIndex=headers.findIndex(h=>norm(h)==="ID");
    const conditionIndex=headers.findIndex(isConditionHeader);
    if(idIndex<0||conditionIndex<0||!table.tHead)return false;
    const info=datasetInfo(),headRows=Array.from(table.tHead.rows);
    const favTh=document.createElement("th");
    favTh.textContent="★";
    favTh.rowSpan=headRows.length;
    favTh.className="p2-sticky-fav";
    headRows[0].insertBefore(favTh,headRows[0].firstChild);

    Array.from(table.tBodies||[]).forEach(body=>{
      Array.from(body.rows).forEach(row=>{
        const idCell=row.cells[idIndex],conditionCell=row.cells[conditionIndex];
        const conditionId=idCell?String(idCell.textContent||"").trim():"";
        const link=conditionCell?conditionCell.querySelector('a[href*="high_entry_charts/"],a[href*="conditions/charts/"]'):null;
        const conditionLabel=link?String(link.textContent||"").trim():(conditionCell?String(conditionCell.textContent||"").trim():"");
        const td=document.createElement("td");
        td.className="p2-sticky-fav";
        const btn=document.createElement("button");
        btn.type="button";btn.className="p2-favorite-btn";
        if(conditionId&&conditionLabel&&link){
          const u=new URL(link.getAttribute("href"),location.href);
          const item={
            datasetKey:info.key,datasetName:info.name,conditionId,conditionLabel,
            chartPath:u.pathname+u.search+u.hash,savedAt:""
          };
          btn.dataset.favoriteKey=favoriteKey(item);
          btn.addEventListener("click",()=>toggleFavorite(item));
        }else{
          btn.textContent="—";btn.disabled=true;btn.title="グラフなし";
        }
        td.appendChild(btn);
        row.insertBefore(td,row.firstChild);
      });
    });
    table.dataset.p2FavoritesReady="1";
    syncFavoriteButtons();
    return true;
  }

  function applyStickyColumns(table){
    if(!table.classList.contains("focus-table"))return;
    if(!table.tHead)return;
    const top=table.tHead.rows[0];
    if(top&&top.cells.length>=3){
      top.cells[0].classList.add("p2-sticky-fav");
      top.cells[1].classList.add("p2-sticky-id");
      top.cells[2].classList.add("p2-sticky-condition","p2-condition-col");
    }
    Array.from(table.tBodies||[]).forEach(body=>Array.from(body.rows).forEach(row=>{
      if(row.cells[0])row.cells[0].classList.add("p2-sticky-fav");
      if(row.cells[1])row.cells[1].classList.add("p2-sticky-id");
      if(row.cells[2])row.cells[2].classList.add("p2-sticky-condition","p2-condition-col");
    }));
  }

  function fixHeaderTops(table){
    if(!table.tHead)return;
    let top=0;
    Array.from(table.tHead.rows).forEach(row=>{
      Array.from(row.cells).forEach(th=>{th.style.top=top+"px";th.style.zIndex=th.classList.contains("p2-sticky-fav")||th.classList.contains("p2-sticky-id")||th.classList.contains("p2-sticky-condition")?"40":"12"});
      top+=row.getBoundingClientRect().height;
    });
  }

  function limitTo20Rows(table){
    if(!table.classList.contains("focus-table"))return;
    const body=table.tBodies&&table.tBodies[0],wrap=table.closest(".table-wrap");
    if(!body||!wrap)return;
    const rows=Array.from(body.rows);
    if(rows.length<=20){wrap.style.maxHeight="";return}
    let h=table.tHead?table.tHead.getBoundingClientRect().height:0;
    rows.slice(0,20).forEach(r=>h+=r.getBoundingClientRect().height);
    wrap.classList.add("p2-scroll-20");
    wrap.style.maxHeight=Math.ceil(h+3)+"px";
  }

  function validFavoriteItem(x){
    if(!x||typeof x!=="object")return null;
    const item={
      datasetKey:String(x.datasetKey||"").trim(),
      datasetName:String(x.datasetName||"").trim(),
      conditionId:String(x.conditionId||"").trim(),
      conditionLabel:String(x.conditionLabel||"").trim(),
      chartPath:String(x.chartPath||x.chartUrl||"").trim(),
      savedAt:String(x.savedAt||new Date().toISOString()).trim()
    };
    if(!item.datasetKey||!item.datasetName||!item.conditionId||!item.conditionLabel||!item.chartPath.startsWith("/"))return null;
    return item;
  }

  function currentDatasetFavorites(){
    const key=datasetInfo().key;
    return loadFavorites().filter(item=>item.datasetKey===key);
  }

  function sourceFavoriteRows(){
    const rows=new Map();
    document.querySelectorAll("table.focus-table:not(.p2-favorites-table) tbody tr").forEach(row=>{
      const idCell=row.querySelector(".p2-sticky-id")||row.cells[1]||row.cells[0];
      const id=idCell?String(idCell.textContent||"").trim():"";
      if(id&&!rows.has(id))rows.set(id,row);
    });
    return rows;
  }

  function wireFavoriteClone(row,item){
    const btn=row.querySelector(".p2-favorite-btn");
    if(!btn)return;
    btn.textContent="★";btn.disabled=false;btn.classList.add("is-favorite");
    btn.dataset.favoriteKey=favoriteKey(item);btn.title="お気に入りから解除";btn.setAttribute("aria-label",btn.title);
    btn.addEventListener("click",()=>toggleFavorite(item));
  }

  function fallbackFavoriteRow(item,source){
    const width=buildHeaderGrid(source).length;
    const row=document.createElement("tr");
    for(let i=0;i<width;i++)row.appendChild(document.createElement("td"));
    const cells=Array.from(row.cells);
    if(cells[0]){
      cells[0].className="p2-sticky-fav";
      const btn=document.createElement("button");
      btn.type="button";btn.className="p2-favorite-btn is-favorite";btn.textContent="★";
      btn.dataset.favoriteKey=favoriteKey(item);btn.title="お気に入りから解除";btn.setAttribute("aria-label",btn.title);
      btn.addEventListener("click",()=>toggleFavorite(item));cells[0].appendChild(btn);
    }
    if(cells[1]){cells[1].className="p2-sticky-id";cells[1].textContent=item.conditionId}
    if(cells[2]){
      cells[2].className="p2-sticky-condition p2-condition-col group-start";
      const a=document.createElement("a");a.href=item.chartPath;a.target="_blank";a.rel="noopener";a.textContent=item.conditionLabel;a.title=item.conditionLabel;
      cells[2].appendChild(a);
    }
    for(let i=3;i<cells.length;i++)cells[i].textContent="-";
    return row;
  }

  function renderFavoritesPanel(){
    const panel=document.querySelector(".p2-favorites-panel");
    if(!panel)return;
    const list=currentDatasetFavorites(),box=panel.querySelector(".p2-favorites-list"),count=panel.querySelector(".p2-favorites-count");
    count.textContent=list.length+"件";box.innerHTML="";
    if(!list.length){
      const empty=document.createElement("div");empty.className="p2-favorite-empty";empty.textContent="このデータセットのお気に入りはまだありません。";box.appendChild(empty);return;
    }
    const source=document.querySelector("table.focus-table:not(.p2-favorites-table)");
    if(!source||!source.tHead)return;
    const table=document.createElement("table");
    table.className="focus-table p2-favorites-table";
    table.dataset.p2FavoritesReady="1";table.dataset.p2AssetMetrics="1";
    table.appendChild(source.tHead.cloneNode(true));
    const body=document.createElement("tbody"),rowMap=sourceFavoriteRows();
    list.forEach(item=>{
      const src=rowMap.get(item.conditionId);
      const row=src?src.cloneNode(true):fallbackFavoriteRow(item,source);
      wireFavoriteClone(row,item);body.appendChild(row);
    });
    table.appendChild(body);
    const wrap=document.createElement("div");wrap.className="table-wrap p2-favorites-table-wrap";wrap.appendChild(table);box.appendChild(wrap);
    compactConditionColumns(table);applyStickyColumns(table);highlightTable(table);highlightGrowthColumns(table);fixHeaderTops(table);limitTo20Rows(table);
  }

  function ensureFavoritesPanel(){
    if(!document.querySelector("table.focus-table:not(.p2-favorites-table)")||document.querySelector(".p2-favorites-panel"))return;
    const panel=document.createElement("div");
    panel.className="card p2-favorites-panel";
    panel.innerHTML='<div class="p2-favorites-head"><strong>お気に入り条件</strong><span class="p2-favorites-count"></span></div><div class="p2-favorites-list"></div>';
    const hero=document.querySelector(".hero");
    if(hero)hero.insertAdjacentElement("afterend",panel);
    else(document.querySelector(".wrap")||document.body).prepend(panel);
    renderFavoritesPanel();
  }

  function isHome(){
    return /\/kabu\/?(?:index\.html)?$/.test(location.pathname);
  }

  function exportFavorites(){
    const payload={schema:"product_kabu_favorites",version:1,exportedAt:new Date().toISOString(),favorites:loadFavorites()};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json;charset=utf-8"});
    const a=document.createElement("a"),url=URL.createObjectURL(blob),d=new Date();
    const pad=n=>String(n).padStart(2,"0");
    a.href=url;a.download="product_kabu_favorites_"+d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+"_"+pad(d.getHours())+pad(d.getMinutes())+pad(d.getSeconds())+".json";
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
  }

  function ensureHomeImportExport(){
    if(!isHome()||document.querySelector(".p2-fav-io"))return;
    const card=document.createElement("div");card.className="card p2-fav-io";
    card.innerHTML='<strong>お気に入りデータ</strong><p class="muted">お気に入り一覧は各条件ページに表示します。ここではJSON形式でバックアップ・復元できます。</p><div class="p2-fav-io-actions"><button type="button" class="btn p2-fav-export">お気に入りをエクスポート</button><label class="btn" style="cursor:pointer">お気に入りをインポート<input class="p2-fav-import" type="file" accept="application/json,.json" hidden></label><span class="p2-fav-io-status"></span></div>';
    const selector=document.getElementById("reportSwitch");
    const anchor=selector?selector.closest(".card"):document.querySelector(".hero");
    if(anchor)anchor.insertAdjacentElement("afterend",card);else(document.querySelector(".wrap")||document.body).prepend(card);
    card.querySelector(".p2-fav-export").addEventListener("click",exportFavorites);
    const input=card.querySelector(".p2-fav-import"),status=card.querySelector(".p2-fav-io-status");
    input.addEventListener("change",()=>{
      const file=input.files&&input.files[0];if(!file)return;
      file.text().then(text=>{
        const parsed=JSON.parse(text),raw=Array.isArray(parsed)?parsed:parsed&&Array.isArray(parsed.favorites)?parsed.favorites:null;
        if(!raw)throw new Error("favorites array missing");
        const imported=raw.map(validFavoriteItem).filter(Boolean);
        if(!imported.length&&raw.length)throw new Error("valid favorite not found");
        const merged=new Map(loadFavorites().map(x=>[favoriteKey(x),x]));
        imported.forEach(x=>merged.set(favoriteKey(x),x));
        saveFavorites(Array.from(merged.values()));
        status.textContent=imported.length+"件をインポートしました。";
      }).catch(()=>{status.textContent="インポートできませんでした。JSON形式を確認してください。"}).finally(()=>{input.value=""});
    });
  }

  function isAccuracyHeader(text){
    const t=norm(text);
    if(!t)return false;
    // 5D/10D/20D asset groups are not accuracy columns.
    if(t.includes("増加率")||t.includes("前半")||t.includes("後半")||t.includes("最大DD"))return false;
    if(t.includes("正解率")||t.includes("勝率"))return true;
    if(/(^|\/)(5D|10D|20D)($|\/)/i.test(t))return true;
    if(/(^|\/)(5日|10日|20日)($|\/)/.test(t))return true;
    if(/win_(5|10|20)d_pct/i.test(t))return true;
    return false;
  }

  function numericValue(text){
    const s=String(text==null?"":text).replace(/,/g,"").replace(/%/g,"").trim();
    if(!/^[+-]?\d+(?:\.\d+)?$/.test(s))return null;
    const n=Number(s);return Number.isFinite(n)?n:null;
  }

  function highlightTable(table){
    const headers=buildHeaderGrid(table);
    if(!headers.length)return false;
    const accuracyCols=headers.map((h,i)=>isAccuracyHeader(h)?i:-1).filter(i=>i>=0);
    if(!accuracyCols.length)return false;
    Array.from(table.tBodies||[]).forEach(body=>Array.from(body.rows).forEach(row=>{
      accuracyCols.forEach(i=>{
        const cell=row.cells[i];if(!cell)return;
        const n=numericValue(cell.textContent);
        cell.classList.remove("p2-acc-60","p2-acc-70");
        if(n===null||n<0||n>100)return;
        if(n>=70)cell.classList.add("p2-acc-70");
        else if(n>=60)cell.classList.add("p2-acc-60");
      });
    }));
    return true;
  }

  function highlightGrowthColumns(table){
    const headers=buildHeaderGrid(table);
    if(!headers.length)return false;
    const growthCols=headers
      .map((h,i)=>/^(5D|10D|20D)\s*\/\s*増加率$/i.test(norm(h))?i:-1)
      .filter(i=>i>=0);
    if(!growthCols.length)return false;
    Array.from(table.tBodies||[]).forEach(body=>Array.from(body.rows).forEach(row=>{
      growthCols.forEach(i=>{
        const cell=row.cells[i];if(!cell)return;
        const n=numericValue(cell.textContent);
        cell.classList.remove("p2-growth-500","p2-growth-1000");
        if(n===null)return;
        if(n>=1000)cell.classList.add("p2-growth-1000");
        else if(n>=500)cell.classList.add("p2-growth-500");
      });
    }));
    return true;
  }

  function ensureLegend(){
    if(document.querySelector(".p2-accuracy-legend"))return;
    const legend=document.createElement("div");legend.className="p2-accuracy-legend";
    legend.innerHTML='<strong>正解率の強調</strong><span class="p2-acc-60">60%以上</span><span class="p2-acc-70">70%以上</span><span>（70%以上は緑を優先）</span>';
    const hero=document.querySelector(".hero");
    if(hero&&hero.parentNode)hero.insertAdjacentElement("afterend",legend);
    else{const wrap=document.querySelector(".wrap")||document.body;wrap.insertBefore(legend,wrap.firstChild)}
  }

  let scheduled=false;
  function applyAll(){
    scheduled=false;
    let found=false;
    document.querySelectorAll("table").forEach(t=>{
      enhanceAssetMetricTable(t);
      addFavoriteColumn(t);
      compactConditionColumns(t);
      applyStickyColumns(t);
      if(highlightTable(t))found=true;
      highlightGrowthColumns(t);
    });
    ensureFavoritesPanel();
    ensureHomeImportExport();
    requestAnimationFrame(()=>{
      document.querySelectorAll("table.focus-table").forEach(t=>{fixHeaderTops(t);limitTo20Rows(t)});
    });
    if(found)ensureLegend();
  }

  function schedule(){
    if(scheduled)return;
    scheduled=true;requestAnimationFrame(applyAll);
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",schedule,{once:true});
  else schedule();
  const observer=new MutationObserver(schedule);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener("resize",schedule);
})();

(function(){
  "use strict";
  if(typeof entryStyle==="undefined"||typeof winMode==="undefined"||typeof horizon==="undefined"||
     typeof displayRange==="undefined"||typeof baseMonth==="undefined"||typeof DATA==="undefined"||
     typeof canvas==="undefined"||typeof ctx==="undefined"||typeof scroll==="undefined") return;

  const chartLegend=scroll.previousElementSibling;
  if(chartLegend&&chartLegend.classList.contains("legend")){
    chartLegend.innerHTML='<span id="entryLegend">エントリ本数</span><span id="correctLegend" class="correct" style="display:none">正解</span><span id="incorrectLegend" class="incorrect" style="display:none">不正解</span><span class="win">勝率</span>';
  }
  const entryLegend=document.getElementById("entryLegend");
  const correctLegend=document.getElementById("correctLegend");
  const incorrectLegend=document.getElementById("incorrectLegend");

  document.querySelectorAll("h2").forEach(el=>{
    if(el.textContent.trim()==="参考資産指数") el.textContent="参考資産増加率";
  });
  document.querySelectorAll(".legend .asset").forEach(el=>{
    if(el.textContent.includes("参考資産指数")) el.textContent="参考資産増加率（基準月=0%）";
  });

  function p2DrawAssetRuntime(rows){
    currentAssetRows=rows;assetGeom=resizeAsset(rows);const g=assetGeom;
    assetCtx.clearRect(0,0,g.width,g.height);
    const growthVals=rows.map(r=>(r.assetIndex==null||!Number.isFinite(r.assetIndex))?null:r.assetIndex-100).filter(v=>v!=null&&Number.isFinite(v));
    document.getElementById("assetBase").textContent=baseMonth.value+" = 0%";
    const stats=assetStats(rows);
    const growthText=stats.growth==null?"-":(stats.growth>=0?"+":"")+stats.growth.toFixed(1)+"%";
    document.getElementById("assetCurrent").textContent=stats.last==null?"-":stats.last.toFixed(1);
    document.getElementById("assetGrowth").textContent=growthText;
    document.getElementById("assetDrawdown").textContent=stats.maxDd==null?"-":stats.maxDd.toFixed(1)+"%";
    if(!growthVals.length)return;

    const rawMin=Math.min(0,...growthVals),rawMax=Math.max(0,...growthVals);
    let minV=rawMin<0?Math.min(-100,Math.floor(rawMin/100)*100):0;
    let maxV=rawMax>0?Math.ceil(rawMax/100)*100:0;
    if(maxV<=minV)maxV=minV+100;
    const span=Math.max(1,maxV-minV),plotH=g.height-g.top-g.bottom,plotW=g.width-g.left-g.right;
    const x=i=>g.left+(i+.5)*g.step,y=v=>g.top+plotH-((v-minV)/span)*plotH;

    assetCtx.fillStyle="#667085";
    for(let v=minV;v<=maxV;v+=100){
      const yy=y(v),baseline=v===0,emphasized=v===100||(v>=200&&v%200===0);
      assetCtx.save();assetCtx.lineWidth=baseline?3:1;assetCtx.strokeStyle=baseline?"#667085":"#e5e7eb";
      assetCtx.beginPath();assetCtx.moveTo(g.left,yy);assetCtx.lineTo(g.left+plotW,yy);assetCtx.stroke();assetCtx.restore();
      assetCtx.font=(baseline?"800 ":emphasized?"700 ":"400 ")+"12px sans-serif";
      assetCtx.fillText((v>0?"+":"")+v+"%",8,yy+4);
    }
    assetCtx.strokeStyle="#166534";assetCtx.lineWidth=2.4;assetCtx.beginPath();let started=false;
    rows.forEach((r,i)=>{if(r.assetIndex==null||!Number.isFinite(r.assetIndex))return;const v=r.assetIndex-100,xx=x(i),yy=y(v);if(!started){assetCtx.moveTo(xx,yy);started=true}else assetCtx.lineTo(xx,yy)});
    assetCtx.stroke();
    assetCtx.fillStyle="#166534";
    rows.forEach((r,i)=>{if(r.assetIndex==null||!Number.isFinite(r.assetIndex))return;const v=r.assetIndex-100;assetCtx.beginPath();assetCtx.arc(x(i),y(v),2.3,0,Math.PI*2);assetCtx.fill()});

    const labelEvery=Math.max(1,Math.ceil(rows.length/14));assetCtx.fillStyle="#667085";assetCtx.textAlign="center";assetCtx.font="11px sans-serif";
    rows.forEach((r,i)=>{if(i%labelEvery===0||i===rows.length-1){assetCtx.save();assetCtx.translate(x(i),g.top+plotH+18);assetCtx.rotate(-.55);assetCtx.fillText(r.month,0,0);assetCtx.restore()}});
    assetCtx.textAlign="left";
  }

  function p2DrawRuntime(){
    const rows=visibleRows();currentRows=rows;geom=resize(rows);const g=geom;
    ctx.clearRect(0,0,g.width,g.height);
    const plotH=g.height-g.top-g.bottom,plotW=g.width-g.left-g.right;
    const maxEntries=Math.max(1,...rows.map(r=>Number(r.entries)||0));
    const mode=winMode.value;
    const rateValues=rows.map(r=>mode==="cumulative"?r.cumulative:r.monthly).filter(v=>v!=null&&Number.isFinite(v));
    let rateMin=50,rateMax=80;
    if(rateValues.length){
      const actualMin=Math.min(...rateValues),actualMax=Math.max(...rateValues);
      rateMin=Math.max(0,Math.min(50,Math.floor((actualMin-5)/5)*5));
      rateMax=Math.min(100,Math.max(80,Math.ceil((actualMax+5)/5)*5));
    }
    const rateSpan=Math.max(1,rateMax-rateMin),gridStep=rateSpan<=50?5:10,gridCount=Math.max(1,Math.round(rateSpan/gridStep));
    const x=i=>g.left+(i+.5)*g.step,yCount=v=>g.top+plotH-(v/maxEntries)*plotH,yRate=v=>g.top+plotH-((v-rateMin)/rateSpan)*plotH;
    ctx.font="12px sans-serif";ctx.lineWidth=1;ctx.strokeStyle="#e5e7eb";ctx.fillStyle="#667085";
    let lastCv=null;
    for(let k=0;k<=gridCount;k++){
      const yy=g.top+plotH*k/gridCount;ctx.beginPath();ctx.moveTo(g.left,yy);ctx.lineTo(g.left+plotW,yy);ctx.stroke();
      const cv=Math.round(maxEntries*(gridCount-k)/gridCount);
      if(cv!==lastCv){ctx.fillText(String(cv),8,yy+4);lastCv=cv}
      ctx.textAlign="right";const rv=rateMax-rateSpan*k/gridCount;ctx.fillText(String(rv.toFixed(0))+"%",g.width-8,yy+4);ctx.textAlign="left";
    }
    ctx.strokeStyle="#98a2b3";ctx.beginPath();ctx.moveTo(g.left,g.top);ctx.lineTo(g.left,g.top+plotH);ctx.lineTo(g.left+plotW,g.top+plotH);ctx.stroke();
    ctx.fillStyle="#344054";ctx.save();ctx.translate(15,g.top+plotH/2);ctx.rotate(-Math.PI/2);ctx.fillText("本数",0,0);ctx.restore();
    ctx.save();ctx.translate(g.width-12,g.top+plotH/2);ctx.rotate(Math.PI/2);ctx.fillText("勝率",0,0);ctx.restore();

    if(entryStyle.value==="bar"){
      const bw=Math.max(4,Math.min(18,g.step*.62)),baseY=g.top+plotH;
      rows.forEach((r,i)=>{
        const evaluable=Math.max(0,Number(r.e)||0);
        const wins=Math.max(0,Math.min(evaluable,Number(r.w)||0));
        const losses=Math.max(0,evaluable-wins);
        const xx=x(i)-bw/2,winTop=yCount(wins),totalTop=yCount(wins+losses);
        ctx.fillStyle="#2457a6";ctx.fillRect(xx,winTop,bw,baseY-winTop);
        ctx.fillStyle="#c2413b";ctx.fillRect(xx,totalTop,bw,winTop-totalTop);
      });
      if(entryLegend)entryLegend.style.display="none";
      if(correctLegend)correctLegend.style.display="inline";
      if(incorrectLegend)incorrectLegend.style.display="inline";
    }else{
      ctx.strokeStyle="#2457a6";ctx.lineWidth=2;ctx.beginPath();
      rows.forEach((r,i)=>{const xx=x(i),yy=yCount(r.entries);if(i===0)ctx.moveTo(xx,yy);else ctx.lineTo(xx,yy)});ctx.stroke();
      if(entryLegend)entryLegend.style.display="inline";
      if(correctLegend)correctLegend.style.display="none";
      if(incorrectLegend)incorrectLegend.style.display="none";
    }

    ctx.strokeStyle="#b45309";ctx.lineWidth=2.2;ctx.beginPath();let started=false;currentPoints=[];
    rows.forEach((r,i)=>{const v=mode==="cumulative"?r.cumulative:r.monthly;currentPoints.push(v);if(v==null)return;const xx=x(i),yy=yRate(v);if(!started){ctx.moveTo(xx,yy);started=true}else ctx.lineTo(xx,yy)});
    ctx.stroke();ctx.fillStyle="#b45309";
    rows.forEach((r,i)=>{const v=currentPoints[i];if(v==null)return;ctx.beginPath();ctx.arc(x(i),yRate(v),2.5,0,Math.PI*2);ctx.fill()});

    const labelEvery=Math.max(1,Math.ceil(rows.length/14));ctx.fillStyle="#667085";ctx.textAlign="center";ctx.font="11px sans-serif";
    rows.forEach((r,i)=>{if(i%labelEvery===0||i===rows.length-1){ctx.save();ctx.translate(x(i),g.top+plotH+18);ctx.rotate(-.55);ctx.fillText(r.month,0,0);ctx.restore()}});
    ctx.textAlign="left";
    const sum=rows.reduce((a,r)=>a+Number(r.entries||0),0);document.getElementById("sumEntries").textContent=sum.toLocaleString()+"本";
    let last=null;for(let i=rows.length-1;i>=0;i--){if(currentPoints[i]!=null){last={r:rows[i],v:currentPoints[i]};break}}
    if(last){const w=mode==="cumulative"?last.r.cumWins:last.r.w,e=mode==="cumulative"?last.r.cumEval:last.r.e;document.getElementById("rateSummary").textContent=rateText(last.v,w,e)}
    else document.getElementById("rateSummary").textContent="-";
    document.getElementById("baseSummary").textContent=horizon.value+"D / "+(mode==="cumulative"?baseMonth.value:"単月");
    baseMonth.disabled=mode!=="cumulative";
    p2DrawAssetRuntime(rows);
  }

  function p2ShowTipRuntime(ev){
    if(!geom||!currentRows.length)return;
    const rect=canvas.getBoundingClientRect(),mx=ev.clientX-rect.left;
    const i=Math.max(0,Math.min(currentRows.length-1,Math.floor((mx-geom.left)/geom.step)));
    const r=currentRows[i],v=currentPoints[i];if(!r)return;
    const mode=winMode.value,w=mode==="cumulative"?r.cumWins:r.w,e=mode==="cumulative"?r.cumEval:r.e;
    const evaluated=Math.max(0,Number(r.e)||0),correct=Math.max(0,Math.min(evaluated,Number(r.w)||0)),incorrect=Math.max(0,evaluated-correct);
    const split=entryStyle.value==="bar"?"<br>評価済み: "+evaluated+"本<br>正解: "+correct+"本<br>不正解: "+incorrect+"本":"";
    tip.innerHTML="<strong>"+r.month+"</strong><br>エントリ本数: "+r.entries+"本"+split+"<br>"+(mode==="cumulative"?"累積勝率: ":"単月勝率: ")+rateText(v,w,e)+"<br>評価期間: "+horizon.value+"D";
    tip.style.display="block";tip.style.left=Math.min(canvas.width-220,ev.offsetX+12)+"px";tip.style.top=Math.max(8,ev.offsetY-20)+"px";
  }

  function p2ShowAssetTipRuntime(ev){
    if(!assetGeom||!currentAssetRows.length)return;
    const rect=assetCanvas.getBoundingClientRect(),mx=ev.clientX-rect.left;
    const i=Math.max(0,Math.min(currentAssetRows.length-1,Math.floor((mx-assetGeom.left)/assetGeom.step)));
    const r=currentAssetRows[i];if(!r||r.assetIndex==null)return;
    const ret=r.monthlyReturn==null?"-":(r.monthlyReturn>=0?"+":"")+r.monthlyReturn.toFixed(3)+"%";
    const growth=r.assetIndex-100;
    assetTip.innerHTML="<strong>"+r.month+"</strong><br>累積増加率: "+(growth>=0?"+":"")+growth.toFixed(2)+"%<br>月平均リターン: "+ret+"<br>評価期間: "+horizon.value+"D";
    assetTip.style.display="block";assetTip.style.left=Math.min(assetCanvas.width-220,ev.offsetX+12)+"px";assetTip.style.top=Math.max(8,ev.offsetY-20)+"px";
  }

  for(const el of [entryStyle,winMode,horizon,displayRange,baseMonth])el.addEventListener("change",p2DrawRuntime);
  window.addEventListener("resize",p2DrawRuntime);
  canvas.addEventListener("mousemove",p2ShowTipRuntime);
  assetCanvas.addEventListener("mousemove",p2ShowAssetTipRuntime);
  p2DrawRuntime();
})();

})();
