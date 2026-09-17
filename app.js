/* 公共一問一答 v21 - local-first learning engine */
'use strict';
const APP_VERSION='21';
const DATA_VERSION_EXPECTED='2026.09.18.1';
const SCHEMA_VERSION=3;
const LEGACY_STORAGE_KEY='kokyo_flashcards_progress_v2';
const SESSION_FALLBACK_KEY='kokyo_flashcards_session_v21';
const UPDATE_READY_KEY='kokyo_flashcards_update_ready_v21';
const CONFUSION_FALLBACK_KEY='kokyo_flashcards_confusions_v21';
const RETENTION_INTERVAL_DAYS=[1,3,7,21,45];
const DAY=86400000;
let DATA=null, CARDS=[], META={};
let progress={};
let confusionMap=new Map();
let deck=[];
let state={mode:'importance',importance:'S',part:'第V部',section:'ALL',query:'',unseenOnly:false,shuffle:false,index:0,revealed:false,selectedChoice:null,selectedAnswer:null,feedback:null,sessionSeed:'',pendingAdvance:null};
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
function cardKey(c){return c.id+'|'+promptOf(c)+'|'+answerOf(c)}
function seededShuffle(arr,seed=state.sessionSeed){return arr.slice().sort((a,b)=>hash(seed+'|'+cardKey(a))-hash(seed+'|'+cardKey(b)))}
function now(){return Date.now()}
function clampInt(v,min,max){v=Number(v)||0;return Math.max(min,Math.min(max,Math.floor(v)))}

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
  return {cardId:e.cardId,attempts:Math.max(0,Number(e.attempts)||0),correct:Math.max(0,Number(e.correct)||0),wrong:Math.max(0,Number(e.wrong)||0),correctStreak:streak,mastered,lastResult:e.lastResult||null,updatedAt,masteredAt,retentionStage:clampInt(e.retentionStage,0,5),dueAt,retained,lastWrongAnswer:e.lastWrongAnswer||null,distractorCounts:(e.distractorCounts&&typeof e.distractorCounts==='object')?e.distractorCounts:{}};
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
  const payload={key:'active',appVersion:APP_VERSION,dataVersion:DATA?.dataVersion,state:{...state,feedback:state.feedback?{...state.feedback}:null},deckIds:deck.map(c=>c.id),currentCardId:deck[state.index]?.id||null,sessionStartedAt,updatedAt:now()};
  try{localStorage.setItem(SESSION_FALLBACK_KEY,JSON.stringify(payload))}catch(e){}
  if(dbAvailable){try{await StudyDB.put('sessionState',payload)}catch(e){console.warn('session保存失敗',e)}}
}
async function loadSession(){
  let s=null;if(dbAvailable){try{s=await StudyDB.get('sessionState','active')}catch(e){}}
  if(!s){try{s=JSON.parse(localStorage.getItem(SESSION_FALLBACK_KEY)||'null')}catch(e){}}
  if(!s||!s.state||s.dataVersion!==DATA.dataVersion)return false;
  const old=s.state;
  Object.assign(state,{mode:old.mode||state.mode,importance:old.importance||state.importance,part:old.part||state.part,section:old.section||'ALL',query:old.query||'',unseenOnly:!!old.unseenOnly,shuffle:!!old.shuffle,index:Math.max(0,Number(old.index)||0),revealed:!!old.revealed,selectedChoice:Number.isInteger(old.selectedChoice)?old.selectedChoice:null,selectedAnswer:old.selectedAnswer||null,feedback:old.feedback||null,sessionSeed:old.sessionSeed||newSeed(),pendingAdvance:old.pendingAdvance||null});
  sessionStartedAt=s.sessionStartedAt||now();restoredDeckIds=Array.isArray(s.deckIds)?s.deckIds:null;state.restoreCardId=s.currentCardId||null;return true;
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
  clearAdvanceTimer();const p=state.pendingAdvance;if(!p)return;if(now()<p.dueAt){schedulePendingCheck();return}
  const current=deck[state.index];if(current&&current.id===p.cardId){
    if(state.index<deck.length-1){state.index++;state.revealed=false;state.selectedChoice=null;state.selectedAnswer=null;state.feedback=null;state.pendingAdvance=null;await saveSession();render();const card=$('#card');if(card&&card.getBoundingClientRect().top<0){try{card.scrollIntoView({behavior:'smooth',block:'start'})}catch(e){card.scrollIntoView(true)}}}
    else{state.pendingAdvance=null;await saveSession();toast('このセットは終了しました');applyWaitingUpdateIfSafe('deck-end',true)}
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
  if(!isCorrect){p.mastered=false;p.retained=false;p.retentionStage=0;p.dueAt=null;p.masteredAt=null;p.lastWrongAnswer=selectedAnswer;p.distractorCounts[selectedAnswer]=(p.distractorCounts[selectedAnswer]||0)+1}
  else if(mastered&&!wasMastered){scheduleAfterMastery(p,t)}
  else if(mastered&&wasDue){advanceRetention(p,t)}
  await persistCard(p);
  await addAttempt({cardId:c.id,timestamp:t,correct:isCorrect,selectedAnswer,responseMs:Math.max(0,Number(responseMs)||0),sessionId:state.sessionSeed,wasDue,importance:impOf(c),sectionCode:cardSection(c)});
  if(!isCorrect)await recordConfusion(c,selectedAnswer);
  updateStats();
  return {isCorrect,correctStreak:p.correctStreak,mastered:p.mastered,becameMastered:p.mastered&&!wasMastered,lostMastery:!p.mastered&&wasMastered,retentionAdvanced:isCorrect&&wasDue,retained:!!p.retained,nextDueAt:p.dueAt};
}
let questionShownAt=now();
async function choose(index){
  if(!deck.length||state.revealed)return;const c=deck[state.index],opts=choicesFor(c);if(index<0||index>=opts.length)return;const selected=opts[index];state.selectedChoice=index;state.selectedAnswer=selected.answer;const isCorrect=!!selected.correct;
  try{state.feedback=await recordResult(c,isCorrect,selected.answer,now()-questionShownAt)}catch(e){console.warn('学習履歴の記録に失敗しました',e);state.feedback={isCorrect,correctStreak:0,mastered:false,becameMastered:false,lostMastery:false}}
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
async function setMode(el){restoredDeckIds=null;state.mode=el.dataset.mode;state.index=0;rotateSessionSeed();await resetAnswer({save:false});$$('.tab').forEach(x=>x.classList.toggle('active',x===el));$('#importanceControls').style.display=state.mode==='importance'?'block':'none';$('#fieldControls').style.display=state.mode==='field'?'block':'none';rebuild(true);await saveSession()}
function bind(){
  $$('.tab').forEach(b=>b.addEventListener('click',()=>setMode(b)));
  $$('.imp-btn').forEach(b=>b.addEventListener('click',async()=>{restoredDeckIds=null;state.importance=b.dataset.imp;state.index=0;rotateSessionSeed();await resetAnswer({save:false});$$('.imp-btn').forEach(x=>x.classList.toggle('active',x===b));rebuild(true);await saveSession()}));
  $('#partSelect').addEventListener('change',async e=>{restoredDeckIds=null;state.part=e.target.value;state.section='ALL';buildSectionSelect();state.index=0;rotateSessionSeed();await resetAnswer({save:false});rebuild(true);await saveSession()});
  $('#sectionSelect').addEventListener('change',async e=>{restoredDeckIds=null;state.section=e.target.value;state.index=0;rotateSessionSeed();await resetAnswer({save:false});rebuild(true);await saveSession()});
  $('#search').addEventListener('input',e=>{restoredDeckIds=null;state.query=e.target.value;state.index=0;resetAnswer({save:false}).then(()=>{rebuild(true);saveSession()})});
  $('#unseenOnly').addEventListener('change',e=>{restoredDeckIds=null;state.unseenOnly=e.target.checked;state.index=0;resetAnswer({save:false}).then(()=>{rebuild(true);saveSession()})});
  $('#shuffle').addEventListener('change',e=>{restoredDeckIds=null;state.shuffle=e.target.checked;state.index=0;rotateSessionSeed();resetAnswer({save:false}).then(()=>{rebuild(true);saveSession()})});
  $('#choices').addEventListener('click',e=>{const b=e.target.closest('.choice');if(b)choose(Number(b.dataset.index))});
  $('#restart').addEventListener('click',async()=>{restoredDeckIds=null;state.index=0;rotateSessionSeed();await resetAnswer({save:false});rebuild(true);await saveSession();toast('先頭に戻りました')});
  $('#resetProgress').addEventListener('click',async()=>{if(confirm('学習履歴をすべて初期化しますか？')){progress={};confusionMap.clear();if(dbAvailable){for(const s of ['cardState','attemptEvents','confusionStats'])await StudyDB.clear(s)}try{localStorage.removeItem(LEGACY_STORAGE_KEY);localStorage.removeItem(CONFUSION_FALLBACK_KEY)}catch(e){}updateStats();rebuild(true);toast('学習履歴を初期化しました')}});
  $('#exportProgress').addEventListener('click',exportProgressData);$('#importProgressBtn').addEventListener('click',()=>$('#importProgress').click());$('#importProgress').addEventListener('change',importProgressData);$('#exportDiagnostics').addEventListener('click',exportDiagnostics);
  $('#showConfusions').addEventListener('click',()=>{renderConfusions();const d=$('#confusionDialog');if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open','')});$('#closeConfusions').addEventListener('click',()=>{const d=$('#confusionDialog');if(typeof d.close==='function')d.close();else d.removeAttribute('open')});
  $('#mobileFilter').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
  document.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;if(!state.revealed&&['1','2','3','4'].includes(e.key)){e.preventDefault();choose(Number(e.key)-1)}});
  for(const ev of ['visibilitychange','pageshow','focus'])window.addEventListener(ev,()=>{if(document.visibilityState!=='hidden')reconcilePendingAdvance()});
}
function rebuild(resetReveal=true){
  let d=CARDS.slice();if(state.mode==='importance')d=d.filter(c=>impOf(c)===state.importance);else if(state.mode==='field')d=d.filter(c=>cardPart(c)===state.part&&(state.section==='ALL'||cardSection(c)===state.section));else if(state.mode==='review')d=d.filter(c=>{const st=statusOf(c);return st!=='new'&&st!=='mastered'&&st!=='due'});else if(state.mode==='due')d=dueCards();else if(state.mode==='wrong')d=d.filter(c=>(progress[c.id]?.wrong||0)>0).sort((a,b)=>((progress[b.id]?.wrong||0)-(progress[a.id]?.wrong||0))||((progress[b.id]?.updatedAt||0)-(progress[a.id]?.updatedAt||0)));
  if(state.query.trim()){const q=norm(state.query);d=d.filter(c=>norm(promptOf(c)).includes(q)||norm(answerOf(c)).includes(q)||norm(cardSectionTitle(c)).includes(q))}if(state.unseenOnly)d=d.filter(c=>statusOf(c)==='new');if(state.shuffle)d=seededShuffle(d);deck=d;if(state.index>=deck.length)state.index=Math.max(0,deck.length-1);if(resetReveal&&!state.pendingAdvance){state.revealed=false;state.selectedChoice=null;state.selectedAnswer=null;state.feedback=null}render()
}
function titleForDeck(){if(state.mode==='importance')return impLabel[state.importance];if(state.mode==='field'){const c=CARDS.find(x=>cardPart(x)===state.part&&(state.section==='ALL'||cardSection(x)===state.section));return state.section==='ALL'?(c?`${cardPart(c)} ${cardPartTitle(c)}`:state.part):(c?`${cardSection(c)} ${cardSectionTitle(c)}`:state.section)}if(state.mode==='review')return '未習熟復習';if(state.mode==='due')return '今日の定着確認';if(state.mode==='wrong')return '誤答ノート';return '全範囲'}
function render(){
  $('#sessionTitle').textContent=titleForDeck();$('#sessionSub').textContent=`${deck.length.toLocaleString()}枚${state.unseenOnly?'・未学習のみ':''}${state.query?'・検索中':''}${state.shuffle?'・シャッフル':''}`;const has=deck.length>0;$('#empty').classList.toggle('show',!has);$('#card').style.display=has?'flex':'none';$('#counter').textContent=has?`${state.index+1} / ${deck.length}`:'0 / 0';$('#progressFill').style.width=has?`${((state.index+1)/deck.length)*100}%`:'0%';if(!has)return;
  const c=deck[state.index],st=statusOf(c),opts=choicesFor(c);$('#sectionBadge').textContent=`${cardSection(c)} ${cardSectionTitle(c)}`;const ib=$('#impBadge');ib.textContent=impLabel[impOf(c)];ib.className='badge '+impOf(c);$('#statusBadge').textContent=statusLabel[st]||st;$('#sourceInfo').textContent=`一問一答 p.${c.source.page} / #${c.source.number}`;$('#question').textContent=promptOf(c);$('#answer').textContent=displayAnswer(answerOf(c));
  $('#choices').innerHTML=opts.map((o,i)=>{let cls='choice';if(state.revealed){if(o.correct)cls+=' correct';else if(i===state.selectedChoice)cls+=' wrong';else cls+=' dim'}return `<button class="${cls}" data-index="${i}" ${state.revealed?'disabled':''}><span class="choice-key">${i+1}</span><span class="choice-text">${esc(displayAnswer(o.answer))}</span></button>`}).join('');$('#answerWrap').classList.toggle('show',state.revealed);
  const note=$('#feedbackNote');if(state.revealed&&state.feedback&&!state.feedback.isCorrect){note.textContent=feedbackNote(c,state.selectedAnswer);note.classList.add('show')}else{note.textContent='';note.classList.remove('show')}
  const fb=$('#autoFeedback');if(state.revealed&&state.feedback){const f=state.feedback;let msg='';if(f.isCorrect&&f.retained)msg='正解。定着確認を完了しました。';else if(f.isCorrect&&f.retentionAdvanced)msg='正解。定着確認クリア。次回の復習間隔を延ばしました。';else if(f.isCorrect&&f.becameMastered)msg='正解。2回連続正答で「習熟」になりました。';else if(f.isCorrect&&f.mastered)msg='正解。「習熟」です。';else if(f.isCorrect)msg='正解。連続正答 1 / 2。';else if(f.lostMastery)msg='不正解。習熟状態を解除し、再学習に戻します。';else msg='不正解。連続正答数は0に戻りました。';fb.textContent=msg+' 自動で次へ進みます。';fb.className='auto-feedback show '+(f.isCorrect?'correct':'wrong')}else{fb.textContent='';fb.className='auto-feedback'}
  if(impOf(c)==='R'){$('#refSummary').textContent='重要度：参考外（政経過去問では判定しない）';$('#refContent').innerHTML='第I〜IV部は倫理分野のため、今回のセンター政経資料による頻度分類の対象外です。'}else{$('#refSummary').textContent=`センター政経での語の出現：${c.importance.refHits}問`;const codes=(c.importance.refQuestionCodes||[]).join('、')||'該当なし';const terms=(c.importance.matchTerms||[]).join(' / ');$('#refContent').innerHTML=`<div>照合語: <code>${esc(terms||answerOf(c))}</code></div><div>該当問題コード: <code>${esc(codes)}</code></div>`}$('#refDetails').open=false;questionShownAt=now();
}
function updateStats(){const cnt={new:0,review:0,streak1:0,mastered:0,due:0};for(const c of CARDS){const s=statusOf(c);cnt[s]=(cnt[s]||0)+1}$('#statNew').textContent=(cnt.new||0).toLocaleString();$('#statAgain').textContent=(cnt.review||0).toLocaleString();$('#statHard').textContent=(cnt.streak1||0).toLocaleString();$('#statGood').textContent=((cnt.mastered||0)+(cnt.due||0)).toLocaleString();$('#dueCards').textContent=(cnt.due||0).toLocaleString();const dueTab=$('.tab[data-mode="due"]');if(dueTab)dueTab.textContent=`今日の復習 ${cnt.due||0}`}

async function exportProgressData(){let attempts=[];if(dbAvailable){try{attempts=await StudyDB.getAll('attemptEvents')}catch(e){}}const payload={app:'公共一問一答',formatVersion:3,appVersion:APP_VERSION,dataVersion:DATA.dataVersion,schemaVersion:SCHEMA_VERSION,masteryRule:'2_consecutive_correct_plus_retention',exportedAt:new Date().toISOString(),progress,confusions:topConfusions(9999),attempts};shareJson(payload,'公共一問一答_学習履歴_v21.json','公共一問一答 学習履歴')}
async function exportDiagnostics(){const attempts=dbAvailable?await StudyDB.getAll('attemptEvents'):[];const payload={appVersion:APP_VERSION,dataVersion:DATA.dataVersion,generatedAt:new Date().toISOString(),summary:{cards:CARDS.length,due:dueCards().length,confusionPairs:confusionMap.size,attempts:attempts.length},confusions:topConfusions(9999),distractorSelections:Object.fromEntries(Object.entries(progress).filter(([,p])=>Object.keys(p.distractorCounts||{}).length).map(([id,p])=>[id,p.distractorCounts]))};shareJson(payload,'公共一問一答_学習分析_v21.json','公共一問一答 学習分析')}
function shareJson(payload,name,title){const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const file=new File([blob],name,{type:'application/json'});if(navigator.canShare&&navigator.canShare({files:[file]})){navigator.share({title,files:[file]}).catch(()=>{})}else{const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}}
async function importProgressData(e){const f=e.target.files&&e.target.files[0];if(!f)return;try{const obj=JSON.parse(await f.text());const raw=obj.progress||obj;if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('invalid');progress={};for(const [id,v] of Object.entries(raw)){const p=normalizeEntry({...v,cardId:id});progress[id]=p;if(dbAvailable)await StudyDB.put('cardState',p)}if(Array.isArray(obj.confusions)){confusionMap.clear();for(const x of obj.confusions){if(x.pairKey){confusionMap.set(x.pairKey,x);if(dbAvailable)await StudyDB.put('confusionStats',x)}}try{localStorage.setItem(CONFUSION_FALLBACK_KEY,JSON.stringify([...confusionMap.values()]))}catch(e){}}if(dbAvailable&&Array.isArray(obj.attempts)){await StudyDB.clear('attemptEvents');for(const ev of obj.attempts){const copy={...ev};delete copy.id;await StudyDB.add('attemptEvents',copy)}}updateStats();rebuild(true);await saveSession();toast('学習履歴を読み込みました')}catch(err){console.error(err);alert('学習履歴ファイルを読み込めませんでした。')}e.target.value=''}
let toastTimer;function toast(s){const t=$('#toast');t.textContent=s;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2200)}

async function loadDataset(){const r=await fetch('./cards.json',{cache:'no-store'});if(!r.ok)throw new Error('cards.json '+r.status);DATA=await r.json();if(DATA.schemaVersion!==1)throw new Error('unsupported card schema');if(DATA.dataVersion!==DATA_VERSION_EXPECTED)console.warn('data version mismatch',DATA.dataVersion);CARDS=DATA.cards;META=DATA.meta}
async function init(){
  await loadDataset();await loadStudyData();state.sessionSeed=newSeed();const restored=await loadSession();
  $('#allCards').textContent=META.totalCards.toLocaleString();$('#peCards').textContent=META.politicsEconomicsCards.toLocaleString();$('#refQs').textContent=META.referenceQuestions.toLocaleString();for(const k of ['S','A','B','C'])$('#cnt'+k).textContent=(META.importanceCounts[k]||0)+'枚';buildPartSelect();bind();
  if(restored){$$('.tab').forEach(x=>x.classList.toggle('active',x.dataset.mode===state.mode));$$('.imp-btn').forEach(x=>x.classList.toggle('active',x.dataset.imp===state.importance));$('#importanceControls').style.display=state.mode==='importance'?'block':'none';$('#fieldControls').style.display=state.mode==='field'?'block':'none';$('#search').value=state.query;$('#unseenOnly').checked=state.unseenOnly;$('#shuffle').checked=state.shuffle}
  if(restored&&restoredDeckIds&&restoredDeckIds.length){const map=new Map(CARDS.map(c=>[c.id,c]));deck=restoredDeckIds.map(id=>map.get(id)).filter(Boolean);if(state.restoreCardId){const ix=deck.findIndex(c=>c.id===state.restoreCardId);if(ix>=0)state.index=ix}delete state.restoreCardId;render()}else rebuild(false);updateStats();$('#loadingState').classList.add('hide');await setupServiceWorker();await saveSession();if(state.pendingAdvance)reconcilePendingAdvance();
}
if(typeof window!=='undefined'&&typeof document!=='undefined'){init().catch(e=>{console.error(e);const l=$('#loadingState');if(l)l.textContent='読み込みに失敗しました。ページを再読み込みしてください。';});}
if(typeof module!=='undefined'&&module.exports){module.exports={hash,norm,displayAnswer,normalizeEntry,isDueEntry,scheduleAfterMastery,advanceRetention,pairKey,feedbackNote,choicesFor,RETENTION_INTERVAL_DAYS,DAY,state};}
