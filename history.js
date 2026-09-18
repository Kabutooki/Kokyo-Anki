/* v28: on-demand explanations and persistent exercise history */
'use strict';
const ATTEMPT_FALLBACK_KEY='kokyo_flashcards_attempts_v28';
let EXPLANATIONS={}, EXPLANATION_SOURCES={};
let attemptFallback=[], historyRows=[], historyLimit=30, historyRequest=0;
let historyPauseAt=0, historyNotice='', historyLastFocus=null;
function historyIsOpen(){return !!document.querySelector('#historyDialog')?.open}
function loadAttemptFallback(){try{const x=JSON.parse(localStorage.getItem(ATTEMPT_FALLBACK_KEY)||'[]');attemptFallback=Array.isArray(x)?x.filter(validAttempt):[]}catch(e){attemptFallback=[]}}
function validAttempt(x){return !!(x&&typeof x.cardId==='string'&&Number.isFinite(Number(x.timestamp))&&typeof x.correct==='boolean')}
function attemptKey(x){return x.eventId||JSON.stringify([x.cardId,x.timestamp,x.sessionId,x.selectedAnswer,x.correct])}
function saveAttemptFallback(){try{localStorage.setItem(ATTEMPT_FALLBACK_KEY,JSON.stringify(attemptFallback));return true}catch(e){return false}}
async function recordAttemptWithFallback(ev){
  const copy={...ev,eventId:ev.eventId||newSeed()};
  // Wait for transaction completion: a successful request alone may still be rolled back.
  if(dbAvailable){try{await new Promise((resolve,reject)=>{const tx=StudyDB.db.transaction('attemptEvents','readwrite');tx.objectStore('attemptEvents').add(copy);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});return}catch(e){console.warn('attempt保存失敗',e)}}
  attemptFallback.push(copy);
  if(!saveAttemptFallback())toast('回答履歴を端末に保存できません。終了後に履歴を書き出してください。');
}
async function allAttemptEvents(){
  let rows=[];historyNotice='';
  if(dbAvailable){try{rows=await StudyDB.getAll('attemptEvents')}catch(e){historyNotice='詳細な回答記録を読み込めませんでした。残っている記録を表示します。'}}
  const seen=new Set(),out=[];
  for(const x of [...rows,...attemptFallback]){if(!validAttempt(x))continue;const k=attemptKey(x);if(!seen.has(k)){seen.add(k);out.push(x)}}
  return out;
}
function historyDate(t){return Number(t)>0?new Date(Number(t)).toLocaleString('ja-JP',{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'日時の記録なし'}
function historySourceLinks(c){
  const ex=EXPLANATIONS[c.id];
  const links=(ex?.sourceIds||[]).map(id=>EXPLANATION_SOURCES[id]).filter(x=>x&&/^https:\/\//.test(x.url));
  return `<div class="history-source">問題の出典：${esc(sourceLabel(c))}</div>`+(links.length?`<details class="history-sources"><summary>解説の参考資料</summary>${links.map(x=>`<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a>`).join('')}</details>`:'');
}
function historyEntry(x){
  const c=cardById.get(x.cardId),ex=EXPLANATIONS[c.id];
  const result=x.summaryOnly?'学習済み':x.correct?'正解':'不正解';
  const selected=x.summaryOnly?'この問題の過去の選択内容は記録されていません。':x.selectedAnswer?displayAnswer(x.selectedAnswer):'選択内容の記録なし';
  const meta=x.summaryOnly?`旧履歴・回答 ${x.attempts}回／正解 ${x.correctCount}回／不正解 ${x.wrongCount}回`:`${historyDate(x.timestamp)}・${cardSectionTitle(c)}`;
  return `<details class="history-entry"><summary><span class="history-entry-meta"><span class="history-result ${x.summaryOnly?'summary':x.correct?'correct':'wrong'}">${result}</span><span>${esc(meta)}</span></span><span class="history-question">${esc(promptOf(c))}</span><span class="history-open-hint">回答・解説を開く</span></summary><div class="history-detail"><div class="history-answer-label">${x.summaryOnly?'記録について':'あなたの回答'}</div><div class="history-selected">${esc(selected)}</div><div class="history-answer-label">正解</div><div class="history-answer">${esc(displayAnswer(answerOf(c)))}</div><div class="history-explanation"><h3>解説</h3><p>${esc(ex?.text||'解説の読み込みに失敗しました。ページを再読み込みしてください。')}</p></div>${historySourceLinks(c)}</div></details>`;
}
function filteredHistory(){
  const query=norm($('#historySearch').value),result=$('#historyResult').value,scope=$('#historyScope').value;
  return historyRows.filter(x=>{
    if(scope==='session'&&(x.summaryOnly||x.sessionId!==state.sessionSeed))return false;
    if(result==='wrong'&&(x.summaryOnly?x.wrongCount===0:x.correct))return false;
    if(result==='correct'&&(x.summaryOnly?x.correctCount===0:!x.correct))return false;
    const c=cardById.get(x.cardId);
    return !query||norm([promptOf(c),answerOf(c),cardSectionTitle(c),x.selectedAnswer,EXPLANATIONS[c.id]?.text].join(' ')).includes(query);
  });
}
function renderHistory(){
  const rows=filteredHistory(),shown=rows.slice(0,historyLimit);
  $('#historyCount').textContent=`${rows.length.toLocaleString()}件${historyNotice?'・'+historyNotice:''}`;
  $('#historyList').innerHTML=shown.length?shown.map(historyEntry).join(''):`<div class="history-empty">${historyRows.length?'条件に合う履歴がありません。検索や絞り込みを変えてください。':'まだ演習履歴がありません。回答すると、ここからいつでも解説を読めます。'}</div>`;
  $('#historyMore').hidden=rows.length<=historyLimit;
}
async function openHistory(scope='all'){
  const d=$('#historyDialog');if(d.open)return;
  // A tap immediately after answering can overlap the final storage write.
  // Wait briefly so the just-finished answer is included in the snapshot.
  while(typeof answerSaving!=='undefined'&&answerSaving)await new Promise(r=>setTimeout(r,20));
  historyLastFocus=document.activeElement;historyPauseAt=now();clearAdvanceTimer();
  $('#historySearch').value='';$('#historyResult').value='all';$('#historyScope').value=scope;historyLimit=30;
  $('#historyScope option[value="session"]').disabled=!state.sessionSeed;
  $('#historyList').innerHTML='<div class="history-empty">履歴を読み込んでいます…</div>';$('#historyCount').textContent='';$('#historyMore').hidden=true;
  d.showModal();$('#historySearch').focus();
  const request=++historyRequest;
  const events=await allAttemptEvents();if(request!==historyRequest||!d.open)return;
  historyRows=events.filter(x=>cardById.has(x.cardId));
  const recorded=new Set(historyRows.map(x=>x.cardId));
  // Aggregate-only legacy histories remain readable; do not invent past answers or sessions.
  for(const [id,p] of Object.entries(progress))if(p.attempts>0&&!recorded.has(id)&&cardById.has(id))historyRows.push({cardId:id,timestamp:p.updatedAt,summaryOnly:true,attempts:p.attempts,correctCount:p.correct||0,wrongCount:p.wrong||0});
  historyRows.sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));renderHistory();
}
function closeHistory(){const d=$('#historyDialog');if(d.open)d.close()}
function resumeFromHistory(){
  historyRequest++;
  const paused=Math.max(0,now()-historyPauseAt);historyPauseAt=0;
  if(state.pendingAdvance){state.pendingAdvance.dueAt+=paused;saveSession();schedulePendingCheck()}
  if(typeof questionShownAt==='number')questionShownAt+=paused;
  historyLastFocus?.focus();
}
function bindHistory(){
  $('#showHistory').addEventListener('click',()=>openHistory());
  $('#showSessionHistory').addEventListener('click',()=>openHistory('session'));
  $('#closeHistory').addEventListener('click',closeHistory);
  $('#historyDialog').addEventListener('close',resumeFromHistory);
  for(const id of ['historySearch','historyResult','historyScope'])$('#'+id).addEventListener(id==='historySearch'?'input':'change',()=>{historyLimit=30;renderHistory()});
  $('#historyMore').addEventListener('click',()=>{const oldCount=historyLimit;historyLimit+=30;const rows=filteredHistory();$('#historyList').insertAdjacentHTML('beforeend',rows.slice(oldCount,historyLimit).map(historyEntry).join(''));$('#historyMore').hidden=rows.length<=historyLimit});
}
