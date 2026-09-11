const HOME_CARD_DEFINITIONS = [
  {id:'today', label:'오늘 할 일', selector:'.today-card'},
  {id:'calendar', label:'달력과 선택한 날 일정', selector:'.calendar-card'},
  {id:'upcoming', label:'앞으로의 할 일', selector:'.upcoming-card'},
  {id:'shared', label:'함께 쓰는 공간', selector:'.shared-summary'}
];
const defaultCalendarView = () => window.matchMedia('(max-width: 767px)').matches ? 'week' : 'month';
let calendarView = defaultCalendarView();
let uiPreferenceState = {uid:null, preferences:null, pending:false, ready:false, saving:false, revision:0, message:''};
function sanitizeUiPreferences(value) {
  const ids = HOME_CARD_DEFINITIONS.map(card=>card.id);
  const storedOrder = Array.isArray(value?.homeCards?.order) ? value.homeCards.order : [];
  return {
    calendarView:['week','month'].includes(value?.calendarView) ? value.calendarView : defaultCalendarView(),
    homeCards:{
      order:[...new Set([...storedOrder.filter(id=>ids.includes(id)),...ids])],
      hidden:ids.filter(id=>Array.isArray(value?.homeCards?.hidden) && value.homeCards.hidden.includes(id))
    }
  };
}
function cacheUiPreferences(state) {
  if(!state.uid) return;
  try { localStorage.setItem(`minb-ui-preferences:${state.uid}`, JSON.stringify({preferences:state.preferences,pending:state.pending})); }
  catch { state.message=state.pending?'이 기기에 저장하지 못했어요. 온라인 저장 상태를 확인해 주세요.':''; }
}
function initializeUiPreferences(uid) {
  if(uiPreferenceState.uid===uid && uiPreferenceState.preferences) return;
  let cached=null;
  if(uid) { try { cached=JSON.parse(localStorage.getItem(`minb-ui-preferences:${uid}`)); } catch { /* An unreadable cache falls back to server preferences. */ } }
  uiPreferenceState={uid,preferences:sanitizeUiPreferences(cached?.preferences),pending:!!cached?.pending,ready:false,saving:false,revision:0,message:cached?.pending?'이 기기의 변경 내용을 동기화할 예정이에요.':''};
  applyUiPreferences();
}
function syncUiPreferences() {
  initializeUiPreferences(currentUser?.uid || null);
  const state=uiPreferenceState;
  if(!state.uid || !userData) return;
  const firstSnapshot=!state.ready;
  state.ready=true;
  if(!state.pending) {
    state.preferences=sanitizeUiPreferences(userData.uiPreferences);
    cacheUiPreferences(state);
  }
  applyUiPreferences();
  if(firstSnapshot && state.pending) saveUiPreferences();
}
function applyUiPreferences() {
  const preferences=uiPreferenceState.preferences || sanitizeUiPreferences(null);
  const changed=calendarView!==preferences.calendarView;
  calendarView=preferences.calendarView;
  const container=document.getElementById('homeCards');
  if(container) preferences.homeCards.order.forEach(id=>{
    const card=document.querySelector(HOME_CARD_DEFINITIONS.find(item=>item.id===id).selector);
    if(card) { container.appendChild(card); card.hidden=preferences.homeCards.hidden.includes(id); }
  });
  renderHomePreferences();
  if(changed && typeof renderMonthCal==='function') renderMonthCal();
}
function changeUiPreferences(change) {
  const state=uiPreferenceState;
  if(!state.uid || !state.ready) { toast('설정을 불러온 뒤 다시 시도해 주세요.'); return; }
  state.preferences=sanitizeUiPreferences(change(state.preferences));
  state.pending=true; state.revision++; state.message='변경 내용을 저장하고 있어요.';
  cacheUiPreferences(state);
  applyUiPreferences();
  saveUiPreferences();
}
async function saveUiPreferences() {
  const state=uiPreferenceState;
  if(!state.uid || !state.ready || !state.pending || state.saving) return;
  state.saving=true;
  state.message='변경 내용을 저장하고 있어요.';
  renderHomePreferences();
  const revision=state.revision;
  const preferences=state.preferences;
  try {
    await db.collection('users').doc(state.uid).update({
      'uiPreferences.calendarView':preferences.calendarView,
      'uiPreferences.homeCards':preferences.homeCards
    });
    if(revision===state.revision) { state.pending=false; state.message='저장했어요. 같은 계정으로 로그인하면 적용돼요.'; }
    if(uiPreferenceState===state) cacheUiPreferences(state);
  } catch {
    state.message='온라인 저장에 실패했어요. 이 기기의 변경 내용을 유지했어요. 다시 저장해 주세요.';
    if(uiPreferenceState===state) cacheUiPreferences(state);
  } finally {
    state.saving=false;
    if(uiPreferenceState===state) {
      renderHomePreferences();
      if(state.pending && revision!==state.revision) saveUiPreferences();
    }
  }
}
function setCalendarView(view) {
  if(!['week','month'].includes(view)) return;
  calMonth=new Date(selectedDate);
  changeUiPreferences(preferences=>({...preferences,calendarView:view}));
}
function moveHomeCard(id, direction) {
  changeUiPreferences(preferences=>{
    const order=[...preferences.homeCards.order], index=order.indexOf(id), target=index+direction;
    if(index>=0 && target>=0 && target<order.length) [order[index],order[target]]=[order[target],order[index]];
    return {...preferences,homeCards:{...preferences.homeCards,order}};
  });
  const button=document.getElementById(`home-card-${id}-${direction<0?'up':'down'}`);
  (button?.disabled ? document.getElementById(`home-card-${id}-visible`) : button)?.focus();
}
function renderHomePreferences() {
  const list=document.getElementById('homePreferenceList');
  if(!list) return;
  const state=uiPreferenceState, preferences=state.preferences || sanitizeUiPreferences(null);
  const focusId=list.contains(document.activeElement)?document.activeElement.id:null;
  list.replaceChildren();
  preferences.homeCards.order.forEach((id,index)=>{
    const definition=HOME_CARD_DEFINITIONS.find(card=>card.id===id);
    const row=document.createElement('li'), label=document.createElement('label'), input=document.createElement('input');
    row.className='home-preference-row';
    input.type='checkbox'; input.id=`home-card-${id}-visible`; input.checked=!preferences.homeCards.hidden.includes(id); input.disabled=!state.ready;
    input.addEventListener('change',()=>changeUiPreferences(value=>({...value,homeCards:{...value.homeCards,hidden:input.checked?value.homeCards.hidden.filter(item=>item!==id):[...value.homeCards.hidden,id]}})));
    label.append(input,document.createTextNode(definition.label)); row.append(label);
    const controls=document.createElement('div'); controls.className='home-preference-actions';
    [-1,1].forEach(direction=>{
      const button=document.createElement('button'); button.type='button'; button.className='ui-button';
      button.id=`home-card-${id}-${direction<0?'up':'down'}`; button.textContent=direction<0?'위로':'아래로';
      button.setAttribute('aria-label',`${definition.label} ${button.textContent} 이동`);
      button.disabled=!state.ready || (direction<0?index===0:index===preferences.homeCards.order.length-1);
      button.addEventListener('click',()=>moveHomeCard(id,direction)); controls.append(button);
    });
    row.append(controls); list.append(row);
  });
  if(focusId) document.getElementById(focusId)?.focus({preventScroll:true});
  document.getElementById('homePreferenceStatus').textContent=state.message || (state.ready?'변경하면 자동으로 저장돼요.':'로그인한 계정의 설정을 불러오는 중이에요.');
  document.getElementById('homePreferenceRetry').hidden=!state.pending || state.saving;
  document.getElementById('homePreferenceReset').disabled=!state.ready;
}
function initHomePreferences() {
  const section=document.createElement('section'); section.className='card home-preferences'; section.setAttribute('aria-labelledby','homePreferencesTitle');
  section.innerHTML='<div class="ui-section-head"><h3 id="homePreferencesTitle">홈 화면 편집</h3><button type="button" class="ui-button" id="homePreferenceReset">기본값으로</button></div><p class="ui-meta">표시할 카드를 선택하고 위아래로 순서를 바꾸세요. 달력 보기 방식도 계정에 저장돼요.</p><ul id="homePreferenceList" class="home-preference-list"></ul><div class="home-preference-footer"><p id="homePreferenceStatus" class="ui-meta" role="status" aria-live="polite"></p><button type="button" id="homePreferenceRetry" class="ui-button" hidden>다시 저장</button></div>';
  document.querySelector('#settingsView .settings-intro').after(section);
  document.getElementById('homePreferenceReset').addEventListener('click',()=>changeUiPreferences(()=>sanitizeUiPreferences(null)));
  document.getElementById('homePreferenceRetry').addEventListener('click',saveUiPreferences);
  const link=document.createElement('a'); link.href='#settings'; link.className='ui-button home-edit-link'; link.textContent='홈 화면 편집';
  document.querySelector('#homeView .hero').append(link);
  if(typeof relocateEntryCards==='function') relocateEntryCards();
  applyUiPreferences();
}
function collectDayAgenda(key) {
  const day = getDay(key), date = new Date(`${key}T12:00:00`);
  const entries = day.todos.filter(isScheduleVisible).map(todo => ({todo,key,kind:'todo',done:!!todo.done}));
  for (const sourceKey of allDayKeys()) {
    if (sourceKey === key) continue;
    for (const todo of getDay(sourceKey).todos.filter(isScheduleVisible)) {
      if (isPeriodTodo(todo) && todo.startDate <= key && todo.endDate >= key) entries.push({todo,key:sourceKey,kind:'todo',done:!!todo.done});
    }
  }
  for (const todo of getRecurringFor(date).filter(isScheduleVisible)) entries.push({todo,key,kind:'rec',done:!!day.recDone[todo.id]});
  return entries.sort((a,b)=>Number(a.done)-Number(b.done)||(a.todo.time||'99:99').localeCompare(b.todo.time||'99:99'));
}
function agendaMarkup(entries) {
  return entries.map(({todo,key,kind,done})=>{
    const owner=todoOwnerSignature(todo);
    const meta=[todo.allDay?'종일':todo.time||'시간 미정',kind==='rec'?'반복':null,isPeriodTodo(todo)?`${shortDateLabel(todo.startDate)}–${shortDateLabel(todo.endDate)}`:null,todo.location,owner?.label].filter(Boolean).map(esc).join(' · ');
    return `<button type="button" class="ui-agenda-row${done?' done':''}" data-agenda-key="${escAttr(key)}" data-agenda-id="${escAttr(todo.id)}" data-agenda-kind="${kind}" onclick="openAgendaEntry(this)"><span class="ui-agenda-main"><span class="ui-agenda-title">${esc(todo.text)}</span>${meta?`<span class="ui-meta">${meta}</span>`:''}</span><span class="ui-agenda-status">${done?'완료':canEditTodo(todo)?'열기':'보기'}</span></button>`;
  }).join('');
}
function openAgendaEntry(button) {
  const {agendaKey:key,agendaId:id,agendaKind:kind}=button.dataset;
  const todo=(kind==='rec'?getAllRecurring():getDay(key).todos).find(item=>item.id===id);
  if(todo && canEditTodo(todo))openTodoDetail(key,id,kind); else openDayDetail(key);
}
function renderDashboardOverview() {
  const today=dateKey(new Date()), entries=collectDayAgenda(today);
  const left=entries.filter(item=>!item.done).length;
  document.getElementById('todayCount').textContent=entries.length?`${entries.length}개 일정 중 ${left}개 남았어요`:'오늘을 가볍게 시작해 보세요';
  document.getElementById('todayAgenda').innerHTML=entries.length?agendaMarkup(entries):'<p class="ui-empty">오늘 예정된 일정이 없어요.<br>하고 싶은 일을 하나 추가해 보세요.</p>';
  const shared=document.getElementById('sharedStatus');
  shared.textContent=isShared()?`${(spaceData.members||[]).length}명이 함께 일정을 나누고 있어요`:'초대 코드로 함께 쓰는 공간을 연결하세요';
}
function renderSelectedAgenda() {
  const key=dateKey(selectedDate), entries=collectDayAgenda(key);
  document.getElementById('selectedAgendaTitle').textContent=`${selectedDate.getMonth()+1}월 ${selectedDate.getDate()}일 일정`;
  document.getElementById('selectedAgendaList').innerHTML=entries.length?agendaMarkup(entries):'<p class="ui-empty">선택한 날짜에 일정이 없어요. 일정·메모 버튼으로 기록할 수 있어요.</p>';
  document.querySelectorAll('[data-calendar-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.calendarView===calendarView)));
  document.getElementById('monthCal').classList.toggle('calendar-week',calendarView==='week');
  document.getElementById('calPrev').setAttribute('aria-label',calendarView==='week'?'이전 주':'이전 달');
  document.getElementById('calNext').setAttribute('aria-label',calendarView==='week'?'다음 주':'다음 달');
}
function initDashboardSettings() {
  const settings=document.getElementById('settingsView');
  settings.append(document.querySelector('.share-card'),document.querySelector('.category-section'));
  initHomePreferences();
  const update=()=>{
    const open=location.hash==='#settings';
    document.getElementById('homeView').hidden=open;
    settings.hidden=!open;
    document.getElementById('fab').hidden=open;
    if(open) { closeDayModal(); settings.querySelector('h2').focus({preventScroll:true}); }
    window.scrollTo(0,0);
  };
  window.addEventListener('hashchange',update);update();
}
document.addEventListener('DOMContentLoaded',initDashboardSettings);
