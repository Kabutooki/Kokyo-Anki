/* 公共一問一答 v26 - Center exam gap-fill cards */
'use strict';
const APP_VERSION='26';
const DATA_VERSION_EXPECTED='2026.09.18.4';
const SCHEMA_VERSION=3;
const LEGACY_STORAGE_KEY='kokyo_flashcards_progress_v2';
const SESSION_FALLBACK_KEY='kokyo_flashcards_session_v21';
const UPDATE_READY_KEY='kokyo_flashcards_update_ready_v26';
const CONFUSION_FALLBACK_KEY='kokyo_flashcards_confusions_v21';
const RETENTION_INTERVAL_DAYS=[1,3,7,21,45];
const SEMANTIC_REVIEW_LIMIT=60;
const SEMANTIC_NEIGHBOR_FLOOR=0.55;
const SEMANTIC_HOT_AREA_RATIO=0.28;
const DAY=86400000;
const DEFAULT_SESSION_SIZE=20;
let DATA=null, CARDS=[], META={};
let progress={};
let confusionMap=new Map();
let cardById=new Map(), answerIndex=new Map();
let semanticHeatCache=null, semanticHeatDirty=true;
let deck=[], candidateDeck=[];
let state={mode:'importance',importance:'S',part:'第V部',section:'ALL',query:'',unseenOnly:false,shuffle:false,index:0,revealed:false,selectedChoice:null,selectedAnswer:null,feedback:null,sessionSeed:'',pendingAdvance:null,sessionPhase:'setup',sessionSize:DEFAULT_SESSION_SIZE,sessionStats:null};
let advanceTimer=null;
let updateRegistration=null;
let updateReady=false;
let sessionStartedAt=Date.now();
let restoredDeckIds=null;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const impLabel={S:'S 最重要',A:'A 重要',B:'B 標準',C:'C 補充',R:'参考外'};
const statusLabel={new:'未学習',review:'要復習',streak1:'連続正答 1/2',mastered:'習熟',due:'定着確認'};

function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function newSeed(){return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9)}
function norm(s){return String(s||'').toLowerCase().normalize('NFKC').replace(/\s+/g,'')}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function displayAnswer(s){return String(s||'').trim().split(/\s+/).filter(Boolean).join(' ／ ')}
function cardPart(c){return c.taxonomy.partCode} function cardPartTitle(c){return c.taxonomy.partTitle}
function cardSection(c){return c.taxonomy.sectionCode} function cardSectionTitle(c){return c.taxonomy.sectionTitle}
function promptOf(c){return c.prompt.text} function answerOf(c){return c.answer.text}
function impOf(c){return c.importance.level}
function sourceLabel(c){const s=c.source||{};if(s.kind==='center-reference'){const pages=(s.pages&&s.pages.length?s.pages:[s.page]).filter(Boolean).join('・');const codes=(s.questionCodes&&s.questionCodes.length?s.questionCodes:[s.number]).filter(Boolean).join('・');return `センター政経 p.${pages} / ${codes}`}return `一問一答 p.${s.page} / #${s.number}`}
function cardKey(c){return c.id+'|'+promptOf(c)+'|'+answerOf(c)}
function seededShuffle(arr,seed=state.sessionSeed){return arr.slice().sort((a,b)=>hash(seed+'|'+cardKey(a))-hash(seed+'|'+cardKey(b)))}
function now(){return Date.now()}
function clampInt(v,min,max){v=Number(v)||0;return Math.max(min,Math.min(max,Math.floor(v)))}
function validSessionPhase(v){return v==='setup'||v==='active'||v==='completed'}
function clampSessionSize(v){return clampInt(v||DEFAULT_SESSION_SIZE,1,Math.max(1,CARDS.length||1972))}
function normalizeSessionStats(x){
  if(!x||typeof x!=='object')return null;const target=Math.max(0,Number(x.targetCount)||0),answered=clampInt(x.answered,0,Math.max(target,Number(x.answered)||0,1)),correct=clampInt(x.correct,0,answered),wrong=Math.max(0,answered-correct);return {requestedCount:Math.max(1,Number(x.requestedCount)||target||DEFAULT_SESSION_SIZE),targetCount:target,answered,correct,wrong,startedAt:Number(x.startedAt)||null,endedAt:Number(x.endedAt)||null,endReason:x.endReason||null};
}

/* ---------- IndexedDB: feature 8 ---------- */
const StudyDB={
  db:null,
  async open(){
    if(!('indexedDB' in window)) throw new Error('IndexedDB unsupported');
    this.db=await new Promise((resolve,reject)=>{
      const req=indexedDB.open('koukyou_flashcards_v21',SCHEMA_VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains('cardState')) db.createObjectStore('cardState',{keyPath:'cardId'});
        if(!db.objectStoreNames.contains('attemptEvents')){const s=db.createObjectStore('attemptEvents',{keyPath:'id',autoIncrement:true});s.createIndex('cardId','cardId');s.createIndex('timestamp','timestamp');s.createIndex('sessionId','sessionId')}
        if(!db.objectStoreNames.contains('sessionState')) db.createObjectStore('sessionState',{keyPath:'key'});
        if(!db.objectStoreNames.contains('appMeta')) db.createObjectStore('appMeta',{keyPath:'key'});
        if(!db.objectStoreNames.contains('confusionStats')) db.createObjectStore('confusionStats',{keyPath:'pairKey'});
      };
      req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
    });
    return this.db;
  },
  tx(store,mode='readonly'){return this.db.transaction(store,mode).objectStore(store)},
  getAll(store){return new Promise((res,rej)=>{const r=this.tx(store).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})},
  get(store,key){return new Promise((res,rej)=>{const r=this.tx(store).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})},
  put(store,value){return new Promise((res,rej)=>{const r=this.tx(store,'readwrite').put(value);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})},
  add(store,value){return new Promise((res,rej)=>{const r=this.tx(store,'readwrite').add(value);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})},
  clear(store){return new Promise((res,rej)=>{const r=this.tx(store,'readwrite').clear();r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
};
let dbAvailable=false;

function normalizeEntry(e){
  if(!e||typeof e!=='object') return {};
  let streak=clampInt(e.correctStreak,0,2), mastered=!!e.mastered||streak>=2;
  if(mastered)streak=2;
  const updatedAt=Number(e.updatedAt)||now(), masteredAt=Number(e.masteredAt)||null, retained=!!e.retained;
  let dueAt=Number(e.dueAt)||null;
  if(mastered&&!retained&&!dueAt)dueAt=(masteredAt||updatedAt)+DAY;
  const lastWrongAt=Number(e.lastWrongAt)||(e.lastResult==='wrong'?updatedAt:null);
  return {cardId:e.cardId,attempts:Math.max(0,Number(e.attempts)||0),correct:Math.max(0,Number(e.correct)||0),wrong:Math.max(0,Number(e.wrong)||0),correctStreak:streak,mastered,lastResult:e.lastResult||null,updatedAt,masteredAt,retentionStage:clampInt(e.retentionStage,0,5),dueAt,retained,lastWrongAnswer:e.lastWrongAnswer||null,lastWrongAt,distractorCounts:(e.distractorCounts&&typeof e.distractorCounts==='object')?e.distractorCounts:{}};
}
function normalizeLegacy(raw){const out={};if(!raw||typeof raw!=='object'||Array.isArray(raw))return out;for(const [id,e] of Object.entries(raw)){if(!e||typeof e!=='object')continue;let streak=clampInt(e.correctStreak,0,2);let mastered=!!e.mastered||streak>=2;if(mastered)streak=2;out[id]=normalizeEntry({cardId:id,attempts:e.attempts||0,correct:e.correct||0,wrong:e.wrong||0,correctStreak:streak,mastered,lastResult:e.lastResult,updatedAt:e.updatedAt,masteredAt:mastered?(e.updatedAt||now()):null,retentionStage:0,dueAt:mastered?(e.updatedAt||now())+DAY:null,retained:false,distractorCounts:{}})}return out}
async function loadStudyData(){
  try{await StudyDB.open();dbAvailable=true}catch(e){console.warn('IndexedDBを利用できません。localStorageへフォールバックします。',e)}
  if(dbAvailable){
    const rows=await StudyDB.getAll('cardState');
    for(const r of rows){const n=normalizeEntry(r);if(n.cardId)progress[n.cardId]=n}
    const conf=await StudyDB.getAll('confusionStats');for(const x of conf)confusionMap.set(x.pairKey,x);
    if(!rows.length){
      try{const legacy=localStorage.getItem(LEGACY_STORAGE_KEY);if(legacy){progress=normalizeLegacy(JSON.parse(legacy));for(const p of Object.values(progress))await StudyDB.put('cardState',p);await StudyDB.put('appMeta',{key:'legacyMigration',at:now(),from:LEGACY_STORAGE_KEY})}}catch(e){console.warn('旧履歴移行に失敗',e)}
    }
  }else{
    try{progress=normalizeLegacy(JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY)||'{}'))}catch(e){progress={}}
  }
  try{const shadow=JSON.parse(localStorage.getItem(CONFUSION_FALLBACK_KEY)||'[]');for(const x of shadow){if(x&&x.pairKey&&!confusionMap.has(x.pairKey))confusionMap.set(x.pairKey,x)}}catch(e){}
}
function saveProgressShadow(){try{localStorage.setItem(LEGACY_STORAGE_KEY,JSON.stringify(progress))}catch(e){}}
async function persistCard(p){
  progress[p.cardId]=p;
  if(dbAvailable){try{await StudyDB.put('cardState',p)}catch(e){console.warn('cardState保存失敗',e);saveProgressShadow()}}
  else saveProgressShadow();
}
async function addAttempt(ev){if(dbAvailable){try{return await StudyDB.add('attemptEvents',ev)}catch(e){console.warn('attempt保存失敗',e)}}}
async function saveSession(){
  const keepDeck=state.sessionPhase==='active'||state.sessionPhase==='completed';
  const payload={key:'active',appVersion:APP_VERSION,dataVersion:DATA?.dataVersion,state:{...state,sessionStats:normalizeSessionStats(state.sessionStats),feedback:state.feedback?{...state.feedback}:null},deckIds:keepDeck?deck.map(c=>c.id):[],currentCardId:keepDeck?(deck[state.index]?.id||null):null,sessionStartedAt:state.sessionStats?.startedAt||sessionStartedAt,updatedAt:now()};
  try{localStorage.setItem(SESSION_FALLBACK_KEY,JSON.stringify(payload))}catch(e){}
  if(dbAvailable){try{await StudyDB.put('sessionState',payload)}catch(e){console.warn('session保存失敗',e)}}
}
async function loadSession(){
  let s=null;if(dbAvailable){try{s=await StudyDB.get('sessionState','active')}catch(e){}}
  if(!s){try{s=JSON.parse(localStorage.getItem(SESSION_FALLBACK_KEY)||'null')}catch(e){}}
  if(!s||!s.state||s.dataVersion!==DATA.dataVersion)return false;
  const old=s.state,phase=validSessionPhase(old.sessionPhase)?old.sessionPhase:'setup';
  Object.assign(state,{mode:old.mode||state.mode,importance:old.importance||state.importance,part:old.part||state.part,section:old.section||'ALL',query:old.query||'',unseenOnly:!!old.unseenOnly,shuffle:!!old.shuffle,index:Math.max(0,Number(old.index)||0),revealed:phase==='active'&&!!old.revealed,selectedChoice:phase==='active'&&Number.isInteger(old.selectedChoice)?old.selectedChoice:null,selectedAnswer:phase==='active'?(old.selectedAnswer||null):null,feedback:phase==='active'?(old.feedback||null):null,sessionSeed:old.sessionSeed||newSeed(),pendingAdvance:phase==='active'?(old.pendingAdvance||null):null,sessionPhase:phase,sessionSize:clampSessionSize(old.sessionSize||DEFAULT_SESSION_SIZE),sessionStats:normalizeSessionStats(old.sessionStats)});
  if(phase==='setup'){state.index=0;state.revealed=false;state.selectedChoice=null;state.selectedAnswer=null;state.feedback=null;state.pendingAdvance=null;state.sessionStats=null}
  sessionStartedAt=state.sessionStats?.startedAt||s.sessionStartedAt||now();restoredDeckIds=(phase==='active'||phase==='completed')&&Array.isArray(s.deckIds)?s.deckIds:null;state.restoreCardId=phase==='active'?(s.currentCardId||null):null;return true;
}

/* ---------- feature 4: retention scheduling ---------- */
function isDueEntry(p,t=now()){return !!(p&&p.mastered&&p.dueAt&&p.dueAt<=t&&!p.retained)}
function statusOf(c){const p=progress[c.id];if(!p||!p.attempts)return 'new';if(isDueEntry(p))return 'due';if(p.mastered||p.correctStreak>=2)return 'mastered';if(p.correctStreak===1)return 'streak1';return 'review'}
function dueCards(t=now()){return CARDS.filter(c=>isDueEntry(progress[c.id],t)).sort((a,b)=>{const pa=progress[a.id],pb=progress[b.id];const rank={S:0,A:1,B:2,C:3,R:4};return (rank[impOf(a)]-rank[impOf(b)])||((pa.dueAt||0)-(pb.dueAt||0))})}
function scheduleAfterMastery(p,t){p.retentionStage=0;p.retained=false;p.masteredAt=p.masteredAt||t;p.dueAt=t+RETENTION_INTERVAL_DAYS[0]*DAY}
function advanceRetention(p,t){const current=clampInt(p.retentionStage,0,5);if(current>=RETENTION_INTERVAL_DAYS.length-1){p.retentionStage=5;p.retained=true;p.dueAt=null;return}p.retentionStage=current+1;p.retained=false;p.dueAt=t+RETENTION_INTERVAL_DAYS[current+1]*DAY}

/* ---------- feature 5: wrong notebook/confusion pairs ---------- */
function pairKey(a,b){const aa=norm(a),bb=norm(b);return aa<bb?aa+'||'+bb:bb+'||'+aa}
async function recordConfusion(c,selected){
  if(!selected||norm(selected)===norm(answerOf(c)))return;
  const key=pairKey(answerOf(c),selected);let x=confusionMap.get(key)||{pairKey:key,answerA:answerOf(c),answerB:selected,count:0,lastAt:0,cardIds:[]};
  x={...x,count:(x.count||0)+1,lastAt:now(),cardIds:[...new Set([...(x.cardIds||[]),c.id])].slice(-25)};confusionMap.set(key,x);if(dbAvailable){try{await StudyDB.put('confusionStats',x)}catch(e){}}try{localStorage.setItem(CONFUSION_FALLBACK_KEY,JSON.stringify([...confusionMap.values()]))}catch(e){}
}
function topConfusions(limit=30){return [...confusionMap.values()].sort((a,b)=>(b.count-a.count)||(b.lastAt-a.lastAt)).slice(0,limit)}
function renderConfusions(){const el=$('#confusionContent'),arr=topConfusions();if(!arr.length){el.innerHTML='<div class="confusion-row">まだ混同データはありません。誤答すると自動で記録されます。</div>';return}el.innerHTML=arr.map(x=>`<div class="confusion-row"><div class="confusion-pair">${esc(displayAnswer(x.answerA))} ↔ ${esc(displayAnswer(x.answerB))}</div><div class="confusion-meta">${x.count}回混同・関連問題 ${x.cardIds.length}問</div></div>`).join('')}

/* ---------- v22: semantic-vector hotspot review ---------- */
function semanticSimilarityWeight(sim){
  const x=Math.max(0,(Number(sim)||0)-SEMANTIC_NEIGHBOR_FLOOR)/(1-SEMANTIC_NEIGHBOR_FLOOR);
  return Math.min(1,x*x);
}
function semanticMetadataBoost(a,b){
  if(!a||!b)return 1;
  let m=1;
  if(cardSection(a)===cardSection(b))m+=.24;else if(cardPart(a)===cardPart(b))m+=.07;
  if(a.answer?.entityClass&&a.answer.entityClass===b.answer?.entityClass)m+=.10;
  return m;
}
function directErrorSignal(c,t=now()){
  const p=progress[c.id];if(!p||!(p.wrong>0))return 0;
  const errorRate=(p.wrong||0)/Math.max(1,p.attempts||0);
  const repeat=Math.log1p(p.wrong||0);
  const lw=Number(p.lastWrongAt)||0;
  const ageDays=lw?Math.max(0,(t-lw)/DAY):75;
  const recency=.25+.75*Math.exp(-ageDays/35);
  const stillWrong=p.lastResult==='wrong'?1.20:1;
  return (0.58*repeat+0.88*errorRate)*recency*stillWrong;
}
function importanceHeatMultiplier(c){return ({S:1.22,A:1.13,B:1.04,C:.96,R:.92})[impOf(c)]||1}
function learningHeatMultiplier(c){const st=statusOf(c);return st==='due'?1.24:st==='review'?1.16:st==='streak1'?1.10:st==='new'?1.03:1}
function computeSemanticHeat(force=false){
  if(!force&&!semanticHeatDirty&&semanticHeatCache)return semanticHeatCache;
  const raw=Object.create(null),score=Object.create(null),direct=Object.create(null);const t=now();
  const add=(id,v)=>{if(!id||!(v>0)||!Number.isFinite(v))return;raw[id]=(raw[id]||0)+v};
  for(const c of CARDS){
    const base=directErrorSignal(c,t);if(!(base>0))continue;direct[c.id]=base;add(c.id,base*1.45);
    for(const pair of (c.semantic?.neighbors||[])){
      const nid=pair[0],sim=Number(pair[1])||0;if(sim<SEMANTIC_NEIGHBOR_FLOOR)continue;
      const n=cardById.get(nid);if(!n)continue;add(nid,base*semanticSimilarityWeight(sim)*semanticMetadataBoost(c,n));
    }
    const dc=progress[c.id]?.distractorCounts||{};
    for(const [wrongText,count0] of Object.entries(dc)){
      const count=Number(count0)||0;if(count<=0)continue;
      const targets=answerIndex.get(norm(wrongText))||[];const confusionWeight=Math.log1p(count)*1.30;
      for(const target of targets){if(target.id!==c.id)add(target.id,confusionWeight*semanticMetadataBoost(c,target))}
    }
  }
  let maxScore=0;
  for(const c of CARDS){const v=(raw[c.id]||0)*importanceHeatMultiplier(c)*learningHeatMultiplier(c);score[c.id]=v;if(v>maxScore)maxScore=v}
  const metaByCluster=new Map((DATA?.semanticModel?.clusters||[]).map(x=>[Number(x.id),x]));
  const clusterAgg=new Map();
  for(const c of CARDS){const k=Number(c.semantic?.cluster);if(!Number.isInteger(k))continue;let x=clusterAgg.get(k);if(!x){const m=metaByCluster.get(k)||{};x={id:k,label:m.label||cardSectionTitle(c),part:m.part||cardPartTitle(c),center:m.center||[0,0],size:m.size||0,heat:0,directErrors:0,cards:[]};clusterAgg.set(k,x)}const sc=score[c.id]||0;if(sc>0)x.cards.push({id:c.id,score:sc});if(direct[c.id]>0)x.directErrors++;}
  let maxCluster=0;for(const x of clusterAgg.values()){x.cards.sort((a,b)=>b.score-a.score);const top=x.cards.slice(0,Math.min(12,x.cards.length));x.heat=top.length?top.reduce((z,a)=>z+a.score,0)/Math.sqrt(top.length):0;if(x.heat>maxCluster)maxCluster=x.heat}
  const clusters=[...clusterAgg.values()].map(x=>({...x,relative:maxCluster?x.heat/maxCluster:0})).sort((a,b)=>b.heat-a.heat);
  const hotAreaCount=clusters.filter(x=>x.heat>0&&x.relative>=SEMANTIC_HOT_AREA_RATIO).length;
  semanticHeatCache={raw,score,direct,maxScore,clusters,hotAreaCount,computedAt:t};semanticHeatDirty=false;return semanticHeatCache;
}
function semanticReviewDeck(limit=SEMANTIC_REVIEW_LIMIT){
  const h=computeSemanticHeat();let candidates=CARDS.filter(c=>(h.score[c.id]||0)>0.01).sort((a,b)=>(h.score[b.id]-h.score[a.id])||a.id.localeCompare(b.id));
  if(!candidates.length)return [];
  candidates=candidates.slice(0,Math.max(limit*4,160));
  const groups=new Map();for(const c of candidates){const k=Number(c.semantic?.cluster);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(c)}
  const weights=new Map(h.clusters.map(x=>[Number(x.id),Math.max(.04,Math.pow(Math.max(0,x.relative||0),.72))]));
  const usedCount=new Map(),out=[];let lastCluster=null,sameRun=0;
  while(out.length<limit){
    const options=[];
    for(const [k,arr] of groups){const used=usedCount.get(k)||0;if(used>=arr.length)continue;const next=arr[used],base=weights.get(k)||.04,cardScore=h.maxScore?Math.min(1,(h.score[next.id]||0)/h.maxScore):0;const fairness=base/(1+used*.48);const priority=fairness*(.72+.28*cardScore);options.push({k,next,priority})}
    if(!options.length)break;options.sort((a,b)=>b.priority-a.priority||((h.score[b.next.id]||0)-(h.score[a.next.id]||0))||a.next.id.localeCompare(b.next.id));
    let chosen=options[0];if(chosen.k===lastCluster&&sameRun>=2){const alt=options.find(x=>x.k!==lastCluster);if(alt)chosen=alt}
    out.push(chosen.next);usedCount.set(chosen.k,(usedCount.get(chosen.k)||0)+1);if(chosen.k===lastCluster)sameRun++;else{lastCluster=chosen.k;sameRun=1}
  }
  return out;
}
function heatLevel(relative){return relative>=.72?'強':relative>=.42?'中':relative>=.20?'弱':'微'}
function renderHotspotMap(){
  const h=computeSemanticHeat(true),content=$('#hotspotContent'),map=$('#hotspotMap');if(!content||!map)return;
  if(!h.clusters.some(x=>x.heat>0)){map.innerHTML='<div class="hotspot-empty">まだ弱点マップを作れる誤答履歴がありません。通常学習で誤答すると自動的に形成されます。</div>';content.innerHTML='';return}
  const W=620,H=340,pad=28;const pts=h.clusters.filter(x=>x.heat>0||x.directErrors>0).map(x=>{const cx=Number(x.center?.[0])||0,cy=Number(x.center?.[1])||0;const px=pad+(cx+1)/2*(W-2*pad),py=pad+(cy+1)/2*(H-2*pad);const r=7+Math.min(19,Math.sqrt(Math.max(1,x.size||1))*1.15);const rel=Math.max(0,Math.min(1,x.relative||0));const hue=220-rel*214,light=66-rel*20;return `<g><circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r.toFixed(1)}" fill="hsl(${hue.toFixed(0)} 76% ${light.toFixed(0)}%)" fill-opacity="${(.25+.70*rel).toFixed(2)}" stroke="hsl(${hue.toFixed(0)} 55% 40%)" stroke-width="${rel>=SEMANTIC_HOT_AREA_RATIO?2:1}"><title>${esc(x.label)}：弱点 ${heatLevel(rel)}</title></circle></g>`}).join('');
  map.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="意味ベクトル空間の弱点マップ">${pts}</svg><div class="hotspot-legend"><span>低</span><span class="legend-gradient"></span><span>高</span></div>`;
  const top=h.clusters.filter(x=>x.heat>0).slice(0,10);content.innerHTML=top.map((x,i)=>{const rel=x.relative||0;const pct=Math.round(rel*100);return `<div class="hotspot-row"><div class="hotspot-rank">${i+1}</div><div class="hotspot-main"><div class="hotspot-label">${esc(x.label)}</div><div class="hotspot-meta">${esc(x.part||'')}・直接誤答 ${x.directErrors}問・弱点 ${heatLevel(rel)}</div><div class="hotspot-bar"><span style="width:${pct}%"></span></div></div><div class="hotspot-score">${pct}</div></div>`}).join('');
}

/* ---------- feature 6: diagnostic distractors + session-position randomization ---------- */
function choicesFor(c){
  const ds=(c.distractors||[]).slice(0,3);if(ds.length!==3){console.error('distractors missing',c.id);return [{answer:answerOf(c),correct:true,key:0}]}
  const opts=[{answer:answerOf(c),correct:true,meta:c.answer},...ds.map(d=>({answer:d.text,correct:false,meta:d}))];
  const seed=state.sessionSeed||'default';return opts.map(o=>({...o,key:hash(seed+'|'+c.id+'|'+o.answer)})).sort((a,b)=>a.key-b.key);
}

/* ---------- feature 1: persistent state-machine auto advance ---------- */
function clearAdvanceTimer(){if(advanceTimer!==null){clearTimeout(advanceTimer);advanceTimer=null}}
function nextCardId(){return deck[state.index+1]?.id||null}
async function setPendingAdvance(c,delay){state.pendingAdvance={cardId:c.id,nextCardId:nextCardId(),dueAt:now()+delay,sessionSeed:state.sessionSeed};await saveSession();schedulePendingCheck()}
function schedulePendingCheck(){clearAdvanceTimer();const p=state.pendingAdvance;if(!p)return;const wait=Math.max(0,p.dueAt-now());advanceTimer=setTimeout(reconcilePendingAdvance,Math.min(wait+20,2147480000))}
async function reconcilePendingAdvance(){
  clearAdvanceTimer();const p=state.pendingAdvance;if(!p||state.sessionPhase!=='active')return;if(now()<p.dueAt){schedulePendingCheck();return}
  const current=deck[state.index];if(current&&current.id===p.cardId){
    if(state.index<deck.length-1){state.index++;state.revealed=false;state.selectedChoice=null;state.selectedAnswer=null;state.feedback=null;state.pendingAdvance=null;await saveSession();render();const card=$('#card');if(card&&card.getBoundingClientRect().top<0){try{card.scrollIntoView({behavior:'smooth',block:'start'})}catch(e){card.scrollIntoView(true)}}}
    else await finishSession('completed')
  }else{state.pendingAdvance=null;await saveSession()}
}
async function resetAnswer({save=true}={}){clearAdvanceTimer();state.revealed=false;state.selectedChoice=null;state.selectedAnswer=null;state.feedback=null;state.pendingAdvance=null;if(save)await saveSession()}

/* ---------- feature 7: concise correction feedback ---------- */
function feedbackNote(c,selected){
  if(c.feedback&&c.feedback.note)return c.feedback.note;
  const clue=[];const q=promptOf(c);const article=q.match(/第\s*\d+\s*条(?:\s*\d+\s*項)?/);if(article)clue.push(article[0].replace(/\s+/g,''));const year=q.match(/(?:18|19|20)\d{2}年/);if(year)clue.push(year[0]);
  const prefix=clue.length?`識別ポイント：${clue.join('・')}。` : '';
  return `${prefix}正答は「${displayAnswer(answerOf(c))}」です。${selected?`選んだ「${displayAnswer(selected)}」と区別して確認しましょう。`:''}`;
}

async function recordResult(c,isCorrect,selectedAnswer,responseMs){
  const t=now(),prev=normalizeEntry(progress[c.id]);prev.cardId=c.id;const wasMastered=!!prev.mastered||prev.correctStreak>=2;const wasDue=isDueEntry(prev,t);
  let correctStreak=isCorrect?Math.min(2,(prev.correctStreak||0)+1):0;let mastered=correctStreak>=2;
  const p={...prev,cardId:c.id,attempts:(prev.attempts||0)+1,correct:(prev.correct||0)+(isCorrect?1:0),wrong:(prev.wrong||0)+(isCorrect?0:1),correctStreak,mastered,lastResult:isCorrect?'correct':'wrong',updatedAt:t,distractorCounts:{...(prev.distractorCounts||{})}};
  if(!isCorrect){p.mastered=false;p.retained=false;p.retentionStage=0;p.dueAt=null;p.masteredAt=null;p.lastWrongAnswer=selectedAnswer;p.lastWrongAt=t;p.distractorCounts[selectedAnswer]=(p.distractorCounts[selectedAnswer]||0)+1}
  else if(mastered&&!wasMastered){scheduleAfterMastery(p,t)}
  else if(mastered&&wasDue){advanceRetention(p,t)}
  await persistCard(p);
  await addAttempt({cardId:c.id,timestamp:t,correct:isCorrect,selectedAnswer,responseMs:Math.max(0,Number(responseMs)||0),sessionId:state.sessionSeed,wasDue,importance:impOf(c),sectionCode:cardSection(c)});
  if(!isCorrect)await recordConfusion(c,selectedAnswer);
  semanticHeatDirty=true;
  updateStats();
  return {isCorrect,correctStreak:p.correctStreak,mastered:p.mastered,becameMastered:p.mastered&&!wasMastered,lostMastery:!p.mastered&&wasMastered,retentionAdvanced:isCorrect&&wasDue,retained:!!p.retained,nextDueAt:p.dueAt};
}
let questionShownAt=now();
async function choose(index){
  if(state.sessionPhase!=='active'||!deck.length||state.revealed)return;const c=deck[state.index],opts=choicesFor(c);if(index<0||index>=opts.length)return;const selected=opts[index];state.selectedChoice=index;state.selectedAnswer=selected.answer;const isCorrect=!!selected.correct;
  try{state.feedback=await recordResult(c,isCorrect,selected.answer,now()-questionShownAt)}catch(e){console.warn('学習履歴の記録に失敗しました',e);state.feedback={isCorrect,correctStreak:0,mastered:false,becameMastered:false,lostMastery:false}}
  const stats=normalizeSessionStats(state.sessionStats)||{requestedCount:state.sessionSize,targetCount:deck.length,answered:0,correct:0,wrong:0,startedAt:sessionStartedAt,endedAt:null,endReason:null};stats.answered=Math.min(deck.length,stats.answered+1);stats.correct+=isCorrect?1:0;stats.wrong=stats.answered-stats.correct;state.sessionStats=stats;
  state.revealed=true;render();const delay=isCorrect?850:2300;await setPendingAdvance(c,delay);
}

/* ---------- feature 2: safe service-worker update ---------- */
function hasUnsafeTransition(){return !!state.pendingAdvance||state.revealed}
function markUpdateReady(reg){updateRegistration=reg;updateReady=true;try{localStorage.setItem(UPDATE_READY_KEY,'1')}catch(e){};toast('更新版を準備しました。学習を中断せず次回起動時に反映します。')}
function applyWaitingUpdateIfSafe(reason,force=false){if(!updateReady||!updateRegistration?.waiting||(!force&&hasUnsafeTransition()))return false;try{localStorage.removeItem(UPDATE_READY_KEY)}catch(e){};updateRegistration.waiting.postMessage({type:'SKIP_WAITING',reason});updateReady=false;return true}
async function setupServiceWorker(){
  if(!('serviceWorker' in navigator))return;
  try{const reg=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});updateRegistration=reg;await reg.update();if(reg.waiting)markUpdateReady(reg);reg.addEventListener('updatefound',()=>{const w=reg.installing;if(w)w.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller)markUpdateReady(reg)})});navigator.serviceWorker.addEventListener('controllerchange',()=>{try{localStorage.setItem('kokyo_reload_next_open','1')}catch(e){}})}catch(e){console.warn('Service worker registration failed',e)}
  window.addEventListener('pagehide',()=>{saveProgressShadow();if(updateReady)applyWaitingUpdateIfSafe('pagehide',true)});
}

/* ---------- UI ---------- */
function buildPartSelect(){const parts=[];for(const c of CARDS){if(!parts.some(p=>p.code===cardPart(c)))parts.push({code:cardPart(c),title:cardPartTitle(c)})}$('#partSelect').innerHTML=parts.map(p=>`<option value="${esc(p.code)}">${esc(p.code)} ${esc(p.title)}</option>`).join('');$('#partSelect').value=state.part;buildSectionSelect()}
function buildSectionSelect(){const secs=[];for(const c of CARDS.filter(x=>cardPart(x)===state.part)){if(!secs.some(s=>s.code===cardSection(c)))secs.push({code:cardSection(c),title:cardSectionTitle(c)})}$('#sectionSelect').innerHTML='<option value="ALL">全部</option>'+secs.map(s=>`<option value="${esc(s.code)}">${esc(s.code)} ${esc(s.title)}</option>`).join('');if(!secs.some(s=>s.code===state.section))state.section='ALL';$('#sectionSelect').value=state.section}
function rotateSessionSeed(){state.sessionSeed=newSeed();sessionStartedAt=now()}
function buildCandidateDeck(){
  let d=CARDS.slice();if(state.mode==='importance')d=d.filter(c=>impOf(c)===state.importance);else if(state.mode==='field')d=d.filter(c=>cardPart(c)===state.part&&(state.section==='ALL'||cardSection(c)===state.section));else if(state.mode==='review')d=d.filter(c=>{const st=statusOf(c);return st!=='new'&&st!=='mastered'&&st!=='due'});else if(state.mode==='due')d=dueCards();else if(state.mode==='wrong')d=d.filter(c=>(progress[c.id]?.wrong||0)>0).sort((a,b)=>((progress[b.id]?.wrong||0)-(progress[a.id]?.wrong||0))||((progress[b.id]?.updatedAt||0)-(progress[a.id]?.updatedAt||0)));else if(state.mode==='semantic')d=semanticReviewDeck();
  if(state.query.trim()){const q=norm(state.query);d=d.filter(c=>norm(promptOf(c)).includes(q)||norm(answerOf(c)).includes(q)||norm(cardSectionTitle(c)).includes(q))}if(state.unseenOnly)d=d.filter(c=>statusOf(c)==='new');if(state.shuffle&&state.mode!=='semantic')d=seededShuffle(d);return d;
}
function setCompletedToSetup(){if(state.sessionPhase==='completed'){state.sessionPhase='setup';state.sessionStats=null;deck=[];state.index=0}}
function canChangeFilters(){if(state.sessionPhase==='active'){toast('演習中は出題条件を変更できません。先に「演習を終了」を押してください。');return false}setCompletedToSetup();return true}
async function setMode(el){if(!canChangeFilters())return;restoredDeckIds=null;state.mode=el.dataset.mode;state.index=0;rotateSessionSeed();await resetAnswer({save:false});$$('.tab').forEach(x=>x.classList.toggle('active',x===el));$('#importanceControls').style.display=state.mode==='importance'?'block':'none';$('#fieldControls').style.display=state.mode==='field'?'block':'none';rebuild(true);await saveSession()}
function updateControlLock(){const active=state.sessionPhase==='active';$$('.tab,.imp-btn').forEach(x=>x.disabled=active);for(const id of ['partSelect','sectionSelect','search','unseenOnly','shuffle','resetProgress','importProgressBtn','restart']){const el=$('#'+id);if(el)el.disabled=active}}
function selectedSessionSize(){const input=$('#sessionSize');const raw=input&&input.value!==''?input.value:state.sessionSize;return clampSessionSize(raw)}
function updateSessionSizeUI(){
  const input=$('#sessionSize');if(!input)return;state.sessionSize=clampSessionSize(state.sessionSize);input.max=String(Math.max(1,CARDS.length));if(document.activeElement!==input)input.value=String(state.sessionSize);$$('.quick-size').forEach(b=>b.classList.toggle('active',Number(b.dataset.size)===state.sessionSize));
  const available=candidateDeck.length,target=Math.min(state.sessionSize,available),hint=$('#sessionSizeHint'),start=$('#startSessionBtn');$('#setupSummary').textContent=`${titleForDeck()}・該当 ${available.toLocaleString()}問`;
  if(!available){hint.textContent=state.mode==='semantic'?'まだ意味弱点に該当する問題がありません。通常学習で誤答すると自動的に形成されます。':'現在の条件に該当する問題がありません。';start.disabled=true;start.textContent='演習を開始できません'}else{hint.textContent=state.sessionSize>available?`指定は${state.sessionSize}問ですが、該当する全${available}問を出題します。`:`該当${available.toLocaleString()}問から${target}問を出題します。`;start.disabled=false;start.textContent=`${target}問で演習開始`}
}
async function startSession(){
  if(state.sessionPhase==='active')return;state.sessionSize=selectedSessionSize();rotateSessionSeed();candidateDeck=buildCandidateDeck();if(!candidateDeck.length){state.sessionPhase='setup';render();toast('出題できる問題がありません');return}
  const target=Math.min(state.sessionSize,candidateDeck.length);deck=candidateDeck.slice(0,target);state.index=0;await resetAnswer({save:false});state.sessionPhase='active';sessionStartedAt=now();state.sessionStats={requestedCount:state.sessionSize,targetCount:target,answered:0,correct:0,wrong:0,startedAt:sessionStartedAt,endedAt:null,endReason:null};restoredDeckIds=null;await saveSession();render();$('#sidebar').classList.remove('open');try{$('#card').scrollIntoView({behavior:'smooth',block:'start'})}catch(e){}
}
async function finishSession(reason='manual'){
  if(state.sessionPhase!=='active')return;clearAdvanceTimer();state.pendingAdvance=null;const stats=normalizeSessionStats(state.sessionStats)||{requestedCount:state.sessionSize,targetCount:deck.length,answered:0,correct:0,wrong:0,startedAt:sessionStartedAt,endedAt:null,endReason:null};stats.endedAt=now();stats.endReason=reason;state.sessionStats=stats;state.sessionPhase='completed';state.revealed=false;state.selectedChoice=null;state.selectedAnswer=null;state.feedback=null;await saveSession();render();applyWaitingUpdateIfSafe(reason==='completed'?'session-complete':'session-ended',true)
}
async function returnToSetup(){clearAdvanceTimer();state.pendingAdvance=null;state.sessionPhase='setup';state.sessionStats=null;state.index=0;deck=[];await resetAnswer({save:false});candidateDeck=buildCandidateDeck();await saveSession();render()}
async function repeatSession(){await returnToSetup();await startSession()}
function formatDuration(ms){if(!Number.isFinite(ms)||ms<0)return '';if(ms<60000)return '1分未満';const m=Math.max(1,Math.round(ms/60000));return `${m}分`}
function renderCompletion(){const st=normalizeSessionStats(state.sessionStats)||{targetCount:deck.length,answered:0,correct:0,wrong:0,startedAt:null,endedAt:null,endReason:'manual'};const pct=st.answered?Math.round(st.correct/st.answered*100):0;$('#completeHeading').textContent=st.endReason==='completed'?`${st.targetCount}問の演習が終了しました`:'演習を終了しました';const duration=st.startedAt&&st.endedAt?formatDuration(st.endedAt-st.startedAt):'';$('#completeSummary').textContent=`${titleForDeck()}${duration?`・${duration}`:''}`;$('#resultAnswered').textContent=`${st.answered}/${st.targetCount}`;$('#resultCorrect').textContent=String(st.correct);$('#resultWrong').textContent=String(st.wrong);$('#resultAccuracy').textContent=st.answered?`${pct}%`:'—';$('#completeNote').textContent=st.endReason==='completed'?'この演習セットは完了です。学習履歴・定着予定・意味弱点は自動保存されています。':`途中終了です。${Math.max(0,st.targetCount-st.answered)}問はこのセッションでは未回答です。回答済みの学習履歴は保存されています。`}
function bind(){
  $$('.tab').forEach(b=>b.addEventListener('click',()=>setMode(b)));
  $$('.imp-btn').forEach(b=>b.addEventListener('click',async()=>{if(!canChangeFilters())return;restoredDeckIds=null;state.importance=b.dataset.imp;state.index=0;rotateSessionSeed();await resetAnswer({save:false});$$('.imp-btn').forEach(x=>x.classList.toggle('active',x===b));rebuild(true);await saveSession()}));
  $('#partSelect').addEventListener('change',async e=>{if(!canChangeFilters())return;restoredDeckIds=null;state.part=e.target.value;state.section='ALL';buildSectionSelect();state.index=0;rotateSessionSeed();await resetAnswer({save:false});rebuild(true);await saveSession()});
  $('#sectionSelect').addEventListener('change',async e=>{if(!canChangeFilters())return;restoredDeckIds=null;state.section=e.target.value;state.index=0;rotateSessionSeed();await resetAnswer({save:false});rebuild(true);await saveSession()});
  $('#search').addEventListener('input',e=>{if(!canChangeFilters())return;restoredDeckIds=null;state.query=e.target.value;state.index=0;resetAnswer({save:false}).then(()=>{rebuild(true);saveSession()})});
  $('#unseenOnly').addEventListener('change',e=>{if(!canChangeFilters())return;restoredDeckIds=null;state.unseenOnly=e.target.checked;state.index=0;resetAnswer({save:false}).then(()=>{rebuild(true);saveSession()})});
  $('#shuffle').addEventListener('change',e=>{if(!canChangeFilters())return;restoredDeckIds=null;state.shuffle=e.target.checked;state.index=0;rotateSessionSeed();resetAnswer({save:false}).then(()=>{rebuild(true);saveSession()})});
  $('#sessionSize').addEventListener('input',()=>{const v=Number($('#sessionSize').value);if(Number.isFinite(v)&&v>=1){state.sessionSize=clampSessionSize(v);updateSessionSizeUI()}});$('#sessionSize').addEventListener('change',async()=>{state.sessionSize=selectedSessionSize();$('#sessionSize').value=String(state.sessionSize);updateSessionSizeUI();await saveSession()});
  $$('.quick-size').forEach(b=>b.addEventListener('click',async()=>{state.sessionSize=clampSessionSize(b.dataset.size);$('#sessionSize').value=String(state.sessionSize);updateSessionSizeUI();await saveSession()}));$('#startSessionBtn').addEventListener('click',startSession);$('#repeatSessionBtn').addEventListener('click',repeatSession);$('#backToSetupBtn').addEventListener('click',returnToSetup);$('#endSessionBtn').addEventListener('click',()=>{const st=normalizeSessionStats(state.sessionStats);if(confirm(`現在の演習を終了しますか？\n回答済み：${st?.answered||0} / ${st?.targetCount||deck.length}問`))finishSession('manual')});
  $('#choices').addEventListener('click',e=>{const b=e.target.closest('.choice');if(b)choose(Number(b.dataset.index))});
  $('#restart').addEventListener('click',returnToSetup);
  $('#resetProgress').addEventListener('click',async()=>{if(confirm('学習履歴をすべて初期化しますか？')){progress={};confusionMap.clear();semanticHeatDirty=true;if(dbAvailable){for(const s of ['cardState','attemptEvents','confusionStats'])await StudyDB.clear(s)}try{localStorage.removeItem(LEGACY_STORAGE_KEY);localStorage.removeItem(CONFUSION_FALLBACK_KEY)}catch(e){}updateStats();rebuild(true);toast('学習履歴を初期化しました')}});
  $('#exportProgress').addEventListener('click',exportProgressData);$('#importProgressBtn').addEventListener('click',()=>$('#importProgress').click());$('#importProgress').addEventListener('change',importProgressData);$('#exportDiagnostics').addEventListener('click',exportDiagnostics);
  $('#showConfusions').addEventListener('click',()=>{renderConfusions();const d=$('#confusionDialog');if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open','')});$('#closeConfusions').addEventListener('click',()=>{const d=$('#confusionDialog');if(typeof d.close==='function')d.close();else d.removeAttribute('open')});
  $('#showHotspots').addEventListener('click',()=>{renderHotspotMap();const d=$('#hotspotDialog');if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open','')});$('#closeHotspots').addEventListener('click',()=>{const d=$('#hotspotDialog');if(typeof d.close==='function')d.close();else d.removeAttribute('open')});
  $('#mobileFilter').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
  document.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;if(state.sessionPhase==='active'&&!state.revealed&&['1','2','3','4'].includes(e.key)){e.preventDefault();choose(Number(e.key)-1)}});
  for(const ev of ['visibilitychange','pageshow','focus'])window.addEventListener(ev,()=>{if(document.visibilityState!=='hidden')reconcilePendingAdvance()});
}
function rebuild(resetReveal=true){candidateDeck=buildCandidateDeck();if(state.sessionPhase==='setup'){deck=[];state.index=0;if(resetReveal&&!state.pendingAdvance){state.revealed=false;state.selectedChoice=null;state.selectedAnswer=null;state.feedback=null}}render()}
function titleForDeck(){if(state.mode==='importance')return impLabel[state.importance];if(state.mode==='field'){const c=CARDS.find(x=>cardPart(x)===state.part&&(state.section==='ALL'||cardSection(x)===state.section));return state.section==='ALL'?(c?`${cardPart(c)} ${cardPartTitle(c)}`:state.part):(c?`${cardSection(c)} ${cardSectionTitle(c)}`:state.section)}if(state.mode==='review')return '未習熟復習';if(state.mode==='due')return '今日の定着確認';if(state.mode==='wrong')return '誤答ノート';if(state.mode==='semantic')return '意味弱点復習';return '全範囲'}
function render(){
  const phase=state.sessionPhase;$('#sessionTitle').textContent=titleForDeck();const setup=$('#sessionSetup'),complete=$('#sessionComplete'),card=$('#card'),empty=$('#empty'),endBtn=$('#endSessionBtn'),hint=$('#kbdHint');setup.classList.toggle('show',phase==='setup');complete.classList.toggle('show',phase==='completed');endBtn.classList.toggle('show',phase==='active');card.style.display=phase==='active'&&deck.length?'flex':'none';empty.classList.remove('show');updateControlLock();
  if(phase==='setup'){
    candidateDeck=buildCandidateDeck();const has=candidateDeck.length>0;$('#sessionSub').textContent=`${candidateDeck.length.toLocaleString()}問から演習セットを作成`;$('#counter').textContent='開始前';$('#progressFill').style.width='0%';updateSessionSizeUI();if(!has){empty.classList.add('show');empty.innerHTML=state.mode==='semantic'?'<strong>まだ意味弱点がありません</strong>通常学習で誤答すると、その問題と意味的に近い領域が自動的に弱点マップへ反映されます。':'<strong>該当するカードがありません</strong>絞り込み条件を変更してください。'}hint.textContent='問題数を決めて「演習開始」を押してください。演習中は選択肢のタップだけで進みます。';return
  }
  if(phase==='completed'){
    const st=normalizeSessionStats(state.sessionStats);$('#sessionSub').textContent='演習終了';$('#counter').textContent=st?`${st.answered} / ${st.targetCount}`:'終了';$('#progressFill').style.width=st&&st.targetCount?`${Math.min(100,(st.answered/st.targetCount)*100)}%`:'0%';renderCompletion();hint.textContent='演習は終了しています。「同じ条件でもう一度」または「条件を選び直す」から次の演習を始められます。';return
  }
  const has=deck.length>0;if(!has){state.sessionPhase='setup';candidateDeck=buildCandidateDeck();render();return}const st=normalizeSessionStats(state.sessionStats);$('#sessionSub').textContent=`${deck.length}問・演習中${state.mode==='semantic'?'・誤答ホットエリア優先':''}`;$('#counter').textContent=`${state.index+1} / ${deck.length}`;$('#progressFill').style.width=`${((state.index+1)/deck.length)*100}%`;hint.textContent='選択肢をタップするだけで進みます。キーボードでは 1〜4 で回答できます。';
  const c=deck[state.index],status=statusOf(c),opts=choicesFor(c);$('#sectionBadge').textContent=`${cardSection(c)} ${cardSectionTitle(c)}`;const ib=$('#impBadge');ib.textContent=impLabel[impOf(c)];ib.className='badge '+impOf(c);$('#statusBadge').textContent=statusLabel[status]||status;$('#sourceInfo').textContent=sourceLabel(c);$('#question').textContent=promptOf(c);$('#answer').textContent=displayAnswer(answerOf(c));
  $('#choices').innerHTML=opts.map((o,i)=>{let cls='choice';if(state.revealed){if(o.correct)cls+=' correct';else if(i===state.selectedChoice)cls+=' wrong';else cls+=' dim'}return `<button class="${cls}" data-index="${i}" ${state.revealed?'disabled':''}><span class="choice-key">${i+1}</span><span class="choice-text">${esc(displayAnswer(o.answer))}</span></button>`}).join('');$('#answerWrap').classList.toggle('show',state.revealed);
  const note=$('#feedbackNote');if(state.revealed&&state.feedback&&!state.feedback.isCorrect){note.textContent=feedbackNote(c,state.selectedAnswer);note.classList.add('show')}else{note.textContent='';note.classList.remove('show')}
  const fb=$('#autoFeedback');if(state.revealed&&state.feedback){const f=state.feedback;let msg='';if(f.isCorrect&&f.retained)msg='正解。定着確認を完了しました。';else if(f.isCorrect&&f.retentionAdvanced)msg='正解。定着確認クリア。次回の復習間隔を延ばしました。';else if(f.isCorrect&&f.becameMastered)msg='正解。2回連続正答で「習熟」になりました。';else if(f.isCorrect&&f.mastered)msg='正解。「習熟」です。';else if(f.isCorrect)msg='正解。連続正答 1 / 2。';else if(f.lostMastery)msg='不正解。習熟状態を解除し、再学習に戻します。';else msg='不正解。連続正答数は0に戻りました。';fb.textContent=msg+(state.index===deck.length-1?' 結果を表示します。':' 自動で次へ進みます。');fb.className='auto-feedback show '+(f.isCorrect?'correct':'wrong')}else{fb.textContent='';fb.className='auto-feedback'}
  if(impOf(c)==='R'){$('#refSummary').textContent='重要度：参考外（政経過去問では判定しない）';$('#refContent').innerHTML='第I〜IV部は倫理分野のため、今回のセンター政経資料による頻度分類の対象外です。'}else{$('#refSummary').textContent=`センター政経での語の出現：${c.importance.refHits}問`;const codes=(c.importance.refQuestionCodes||[]).join('、')||'該当なし';const terms=(c.importance.matchTerms||[]).join(' / ');$('#refContent').innerHTML=`<div>照合語: <code>${esc(terms||answerOf(c))}</code></div><div>該当問題コード: <code>${esc(codes)}</code></div>`}$('#refDetails').open=false;questionShownAt=now();
}
function updateStats(){const cnt={new:0,review:0,streak1:0,mastered:0,due:0};for(const c of CARDS){const s=statusOf(c);cnt[s]=(cnt[s]||0)+1}$('#statNew').textContent=(cnt.new||0).toLocaleString();$('#statAgain').textContent=(cnt.review||0).toLocaleString();$('#statHard').textContent=(cnt.streak1||0).toLocaleString();$('#statGood').textContent=((cnt.mastered||0)+(cnt.due||0)).toLocaleString();$('#dueCards').textContent=(cnt.due||0).toLocaleString();const dueTab=$('.tab[data-mode="due"]');if(dueTab)dueTab.textContent=`今日の復習 ${cnt.due||0}`;const h=computeSemanticHeat();const hot=$('#hotAreas');if(hot)hot.textContent=(h.hotAreaCount||0).toLocaleString();const semTab=$('.tab[data-mode="semantic"]');if(semTab)semTab.textContent=h.hotAreaCount?`意味弱点 ${h.hotAreaCount}`:'意味弱点'}

async function exportProgressData(){let attempts=[];if(dbAvailable){try{attempts=await StudyDB.getAll('attemptEvents')}catch(e){}}const payload={app:'公共一問一答',formatVersion:3,appVersion:APP_VERSION,dataVersion:DATA.dataVersion,schemaVersion:SCHEMA_VERSION,masteryRule:'2_consecutive_correct_plus_retention',exportedAt:new Date().toISOString(),progress,confusions:topConfusions(9999),attempts};shareJson(payload,'公共一問一答_学習履歴_v26.json','公共一問一答 学習履歴')}
async function exportDiagnostics(){const attempts=dbAvailable?await StudyDB.getAll('attemptEvents'):[];const heat=computeSemanticHeat(true);const payload={appVersion:APP_VERSION,dataVersion:DATA.dataVersion,semanticModel:DATA.semanticModel?.id||null,generatedAt:new Date().toISOString(),summary:{cards:CARDS.length,due:dueCards().length,confusionPairs:confusionMap.size,attempts:attempts.length,hotAreas:heat.hotAreaCount},hotspots:heat.clusters.filter(x=>x.heat>0).slice(0,20).map(x=>({cluster:x.id,label:x.label,relative:x.relative,directErrors:x.directErrors,topCards:x.cards.slice(0,8)})),confusions:topConfusions(9999),distractorSelections:Object.fromEntries(Object.entries(progress).filter(([,p])=>Object.keys(p.distractorCounts||{}).length).map(([id,p])=>[id,p.distractorCounts]))};shareJson(payload,'公共一問一答_学習分析_v26.json','公共一問一答 学習分析')}
function shareJson(payload,name,title){const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const file=new File([blob],name,{type:'application/json'});if(navigator.canShare&&navigator.canShare({files:[file]})){navigator.share({title,files:[file]}).catch(()=>{})}else{const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}}
async function importProgressData(e){const f=e.target.files&&e.target.files[0];if(!f)return;try{const obj=JSON.parse(await f.text());const raw=obj.progress||obj;if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('invalid');progress={};for(const [id,v] of Object.entries(raw)){const p=normalizeEntry({...v,cardId:id});progress[id]=p;if(dbAvailable)await StudyDB.put('cardState',p)}if(Array.isArray(obj.confusions)){confusionMap.clear();for(const x of obj.confusions){if(x.pairKey){confusionMap.set(x.pairKey,x);if(dbAvailable)await StudyDB.put('confusionStats',x)}}try{localStorage.setItem(CONFUSION_FALLBACK_KEY,JSON.stringify([...confusionMap.values()]))}catch(e){}}if(dbAvailable&&Array.isArray(obj.attempts)){await StudyDB.clear('attemptEvents');for(const ev of obj.attempts){const copy={...ev};delete copy.id;await StudyDB.add('attemptEvents',copy)}}semanticHeatDirty=true;updateStats();rebuild(true);await saveSession();toast('学習履歴を読み込みました')}catch(err){console.error(err);alert('学習履歴ファイルを読み込めませんでした。')}e.target.value=''}
let toastTimer;function toast(s){const t=$('#toast');t.textContent=s;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2200)}

async function loadDataset(){const r=await fetch('./cards.json',{cache:'no-store'});if(!r.ok)throw new Error('cards.json '+r.status);DATA=await r.json();if(DATA.schemaVersion!==2)throw new Error('unsupported card schema');if(DATA.dataVersion!==DATA_VERSION_EXPECTED)console.warn('data version mismatch',DATA.dataVersion);CARDS=DATA.cards;META=DATA.meta;cardById=new Map(CARDS.map(c=>[c.id,c]));answerIndex=new Map();for(const c of CARDS){const k=norm(answerOf(c));if(!answerIndex.has(k))answerIndex.set(k,[]);answerIndex.get(k).push(c)}semanticHeatDirty=true}
async function init(){
  await loadDataset();await loadStudyData();state.sessionSeed=newSeed();const restored=await loadSession();
  $('#allCards').textContent=META.totalCards.toLocaleString();$('#peCards').textContent=META.politicsEconomicsCards.toLocaleString();$('#refQs').textContent=META.referenceQuestions.toLocaleString();for(const k of ['S','A','B','C'])$('#cnt'+k).textContent=(META.importanceCounts[k]||0)+'枚';buildPartSelect();bind();
  if(restored){$$('.tab').forEach(x=>x.classList.toggle('active',x.dataset.mode===state.mode));$$('.imp-btn').forEach(x=>x.classList.toggle('active',x.dataset.imp===state.importance));$('#importanceControls').style.display=state.mode==='importance'?'block':'none';$('#fieldControls').style.display=state.mode==='field'?'block':'none';$('#search').value=state.query;$('#unseenOnly').checked=state.unseenOnly;$('#shuffle').checked=state.shuffle;$('#sessionSize').value=String(state.sessionSize)}
  if(restored&&(state.sessionPhase==='active'||state.sessionPhase==='completed')&&restoredDeckIds&&restoredDeckIds.length){const map=new Map(CARDS.map(c=>[c.id,c]));deck=restoredDeckIds.map(id=>map.get(id)).filter(Boolean);if(!deck.length){state.sessionPhase='setup';state.sessionStats=null}else if(state.restoreCardId){const ix=deck.findIndex(c=>c.id===state.restoreCardId);if(ix>=0)state.index=ix}delete state.restoreCardId;candidateDeck=buildCandidateDeck();render()}else{state.sessionPhase='setup';state.sessionStats=null;rebuild(false)}updateStats();$('#loadingState').classList.add('hide');await setupServiceWorker();await saveSession();if(state.pendingAdvance&&state.sessionPhase==='active')reconcilePendingAdvance();
}
if(typeof window!=='undefined'&&typeof document!=='undefined'){init().catch(e=>{console.error(e);const l=$('#loadingState');if(l)l.textContent='読み込みに失敗しました。ページを再読み込みしてください。';});}
if(typeof module!=='undefined'&&module.exports){module.exports={hash,norm,displayAnswer,normalizeEntry,isDueEntry,scheduleAfterMastery,advanceRetention,pairKey,feedbackNote,choicesFor,semanticSimilarityWeight,directErrorSignal,computeSemanticHeat,semanticReviewDeck,normalizeSessionStats,clampSessionSize,validSessionPhase,RETENTION_INTERVAL_DAYS,DAY,DEFAULT_SESSION_SIZE,state};}
