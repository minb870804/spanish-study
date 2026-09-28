function openTodoDetail(key, id, kind = 'todo') {
  const recurring = kind === 'rec';
  const todo = (recurring ? getAllRecurring() : getDay(key).todos).find(item => item.id === id);
  if (!todo || !canEditTodo(todo)) { toast('수정 권한을 확인할 수 없습니다.'); return; }
  const cats = getCategories(), owner = assigneeOf(todo);
  const party = owner === TOGETHER_KEY ? 'both' : owner === partnerUid() ? 'partner' : 'mine';
  const modal = document.createElement('div');
  modal.className = 'modal open todo-editor-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'todoEditorTitle');
  modal.innerHTML = `<div class="modal-box todo-editor-box">
    <div class="modal-head"><div><strong id="todoEditorTitle" tabindex="-1">일정 수정</strong><p class="todo-editor-date-summary"></p></div><button class="small-btn" type="button" data-close aria-label="일정 수정 닫기">닫기</button></div>
    <form class="todo-editor-form">
      <div class="todo-editor-body">
        <label class="todo-editor-title-field">어떤 일정인가요?<input required maxlength="160" name="text" class="modal-input" autocomplete="off"></label>
        <section class="schedule-section" aria-label="날짜와 시간">
          <div class="todo-editor-grid"><label>날짜<input required type="date" name="date" class="modal-input"></label><label class="todo-editor-check"><input type="checkbox" name="allDay"> 종일</label></div>
          <div class="todo-editor-grid todo-editor-time"><label>시작 시간<input type="time" name="time" class="modal-input"></label><label>종료 시간<input type="time" name="endTime" class="modal-input"></label></div>
          <label class="todo-editor-check"><input type="checkbox" name="multiDay"> 여러 날 일정</label>
          <label data-end-date hidden>종료일<input type="date" name="endDate" class="modal-input"></label>
          ${recurring ? '<p class="schedule-hint">반복 일정 전체에 적용돼요. 날짜와 알림은 기존 반복 설정을 따릅니다.</p>' : ''}
        </section>
        <fieldset class="schedule-section" data-sharing><legend>누구에게 보이나요?</legend>
          <div class="schedule-segments"><label><input type="radio" name="visibility" value="private"><span>나만 보기</span></label><label><input type="radio" name="visibility" value="shared"><span>배우자와 공유</span></label></div>
          <fieldset class="todo-editor-owner" hidden><legend>누구의 일정인가요?</legend><div class="schedule-segments">${partyOptions().map(o => `<label><input type="radio" name="ownerChoice" value="${escAttr(o.id)}"><span>${esc(o.label)}</span></label>`).join('')}</div></fieldset>
        </fieldset>
        <div class="schedule-settings">
          <details class="schedule-setting"><summary><span>장소</span><span data-location-summary></span></summary><label>장소 입력<input maxlength="160" name="location" class="modal-input" placeholder="장소를 입력하세요"></label></details>
          <details class="schedule-setting"><summary><span>알림</span><span data-reminder-summary></span></summary><label>당일 알림 시간<input type="time" name="reminderTime" class="modal-input"></label><button type="button" class="small-btn" data-clear-reminder ${recurring ? 'hidden' : ''}>알림 끄기</button>${recurring ? '<p class="schedule-hint">반복 일정의 알림은 여기서 바꾸지 않아요.</p>' : ''}</details>
          <button type="button" class="schedule-setting schedule-setting-button" data-recur><span>반복</span><span>반복 안 함</span></button>
        </div>
        <details class="todo-editor-options schedule-setting">
          <summary><span>더 설정하기</span><span class="todo-editor-options-summary"></span></summary>
          <div class="todo-editor-options-fields">
            <label>카테고리<select name="cat" class="modal-input">${cats.map(c => `<option value="${escAttr(c.id)}">${esc(c.name)}</option>`).join('')}</select></label>
            <label class="todo-editor-check"><input type="checkbox" name="important"> 중요 일정</label>
            <label>메모<textarea name="notes" class="modal-input" rows="3" placeholder="기억해 둘 내용을 적어 주세요"></textarea></label>
          </div>
        </details>
        <button type="button" class="todo-editor-delete" data-delete>일정 삭제</button>
      </div>
      <div class="todo-editor-save"><p class="todo-editor-error" role="alert" hidden></p><button type="button" class="small-btn" data-close>취소</button><button type="submit" class="add-btn">변경사항 저장</button></div>
    </form></div>`;
  const form = modal.querySelector('form'), fields = form.elements;
  for (const name of ['text', 'time', 'endTime', 'location', 'notes']) fields[name].value = todo[name] || '';
  fields.date.value = todo.startDate || key;
  fields.endDate.value = todo.endDate || '';
  fields.cat.value = todo.cat || cats[0]?.id || '';
  fields.reminderTime.value = todo.reminderTime || formatReminder(todo);
  fields.allDay.checked = !!todo.allDay;
  fields.multiDay.checked = !!todo.endDate && todo.endDate > fields.date.value;
  fields.important.checked = !!todo.important;
  fields.visibility.value = todoScope(todo, 'private');
  fields.ownerChoice.value = party;
  modal.querySelector('[data-sharing]').disabled = !isTodoAuthor(todo);
  const repeatButton = modal.querySelector('[data-recur]');
  repeatButton.hidden = recurring || !isTodoAuthor(todo);
  if (recurring) {
    fields.date.disabled = true;
    fields.multiDay.disabled = true;
    fields.endDate.disabled = true;
    fields.reminderTime.disabled = true;
  }
  const options = modal.querySelector('.todo-editor-options');
  const optionsSummary = modal.querySelector('.todo-editor-options-summary');
  const updateOptionsSummary = () => {
    const settings = [];
    if (fields.cat.value) settings.push(fields.cat.selectedOptions[0]?.textContent || '카테고리');
    if (fields.important.checked) settings.push('중요');
    if (fields.notes.value.trim()) settings.push('메모');
    optionsSummary.textContent = settings.join(' · ');
    modal.querySelector('[data-location-summary]').textContent = fields.location.value.trim() || '추가';
    modal.querySelector('[data-reminder-summary]').textContent = fields.reminderTime.value ? `당일 ${fields.reminderTime.value}` : '없음';
    modal.querySelector('.todo-editor-owner').hidden = fields.visibility.value !== 'shared';
    modal.querySelector('[data-end-date]').hidden = !fields.multiDay.checked;
    fields.endDate.disabled = recurring || !fields.multiDay.checked;
    fields.endDate.required = !recurring && fields.multiDay.checked;
    fields.endDate.min = fields.date.value;
    modal.querySelector('.todo-editor-time').hidden = fields.allDay.checked;
    fields.time.disabled = fields.endTime.disabled = fields.allDay.checked;
    const date = new Date(`${fields.date.value}T12:00:00`);
    const day = Number.isNaN(date.getTime()) ? '날짜를 선택해 주세요' : date.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
    modal.querySelector('.todo-editor-date-summary').textContent = `${day} · ${fields.allDay.checked ? '종일' : fields.time.value || '시간 미정'}`;
  };
  updateOptionsSummary();
  const revealField = field => {
    const disclosure = field.closest('details');
    if (disclosure) disclosure.open = true;
    field.focus();
  };
  form.addEventListener('invalid', event => {
    if (event.target === form.querySelector(':invalid')) revealField(event.target);
  }, true);
  let dirty = false, saving = false;
  const previousFocus = document.activeElement;
  const returnFocus = () => { if (previousFocus?.isConnected) previousFocus.focus(); };
  const previousOverflow = document.body.style.overflow;
  const fitViewport = () => {
    if (!window.visualViewport) return;
    modal.style.height = `${window.visualViewport.height}px`;
    modal.style.top = `${window.visualViewport.offsetTop}px`;
  };
  const remove = () => {
    window.removeEventListener('popstate', onBack);
    window.visualViewport?.removeEventListener('resize', fitViewport);
    window.visualViewport?.removeEventListener('scroll', fitViewport);
    document.body.style.overflow = previousOverflow;
    modal.remove(); returnFocus();
  };
  const close = force => {
    if (saving || (!force && dirty && !confirm('변경 내용을 저장하지 않고 닫을까요?'))) return;
    remove();
    if (history.state?.todoEditor) history.back();
  };
  const onBack = () => {
    if (saving || (dirty && !confirm('변경 내용을 저장하지 않고 닫을까요?'))) {
      history.pushState({ todoEditor: true }, '');
      return;
    }
    remove();
  };
  form.addEventListener('input', () => { dirty = true; updateOptionsSummary(); });
  form.addEventListener('change', () => { dirty = true; updateOptionsSummary(); });
  modal.querySelector('[data-clear-reminder]').onclick = () => { fields.reminderTime.value = ''; dirty = true; updateOptionsSummary(); };
  modal.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => close(false); });
  modal.onclick = event => { if (event.target === modal) close(false); };
  modal.onkeydown = event => {
    if (event.key === 'Escape') { event.stopPropagation(); close(false); }
    if (event.key !== 'Tab') return;
    const controls = [...modal.querySelectorAll('button, input, select, textarea, summary')].filter(el => !el.disabled && el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement.id === 'todoEditorTitle')) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  // 삭제는 목록의 ✕와 같은 규칙 — 일정을 만든 사람에게만 보인다.
  const deleteButton = modal.querySelector('[data-delete]');
  deleteButton.hidden = !isTodoAuthor(todo);
  deleteButton.onclick = async () => {
    if (saving) return;
    const latest = (recurring ? getAllRecurring() : getDay(key).todos).find(item => item.id === id);
    if (!latest) { toast('일정이 변경되었어요. 닫고 다시 열어 주세요.'); return; }
    if (!(await confirmScheduleDeletion(latest.text, recurring))) return;
    close(true); // 삭제하면 수정 중이던 내용은 의미가 없으므로 묻지 않고 닫는다
    if (recurring) await deleteRecurring(id, true);
    else await deleteTodoAt(key, id, true);
  };
  repeatButton.onclick = () => {
    if (saving || (dirty && !confirm('반복 설정을 열면 저장하지 않은 변경은 사라집니다. 계속할까요?'))) return;
    close(true);
    openRecurSetup(key, id);
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (saving) return;
    const start = recurring ? key : fields.date.value, end = fields.multiDay.checked ? fields.endDate.value : '';
    if (!fields.text.value.trim()) { revealField(fields.text); return; }
    if (end && end < start) { toast('종료일이 시작일보다 빠를 수 없습니다.'); revealField(fields.endDate); return; }
    if (!fields.allDay.checked && (!end || end === start) && fields.time.value && fields.endTime.value < fields.time.value && fields.endTime.value) {
      toast('종료시간이 시작시간보다 빠를 수 없습니다.'); revealField(fields.endTime); return;
    }
    const latest = (recurring ? getAllRecurring() : getDay(key).todos).find(item => item.id === id);
    if (!latest || !canEditTodo(latest)) { toast('일정이 변경되었어요. 닫고 다시 열어 주세요.'); return; }
    const category = cats.find(c => c.id === fields.cat.value) || todoCategory(latest);
    const reminderTime = fields.reminderTime.value;
    const sameReminder = start === key && reminderTime === (latest.reminderTime || formatReminder(latest));
    const reminder = recurring || sameReminder ? {} : buildReminderFields(start, reminderTime);
    if (reminder === null) { revealField(fields.reminderTime); return; }
    const shared = fields.visibility.value === 'shared';
    const changed = {
      ...latest, text: fields.text.value.trim(), allDay: fields.allDay.checked,
      time: fields.allDay.checked ? '' : fields.time.value,
      endTime: fields.allDay.checked ? '' : fields.endTime.value,
      location: normalizeTodoText(fields.location.value), notes: fields.notes.value.trim(),
      important: fields.important.checked, cat: category.id, catName: category.name, catColor: category.color,
      ...reminder
    };
    if (isTodoAuthor(latest)) {
      changed.visibility = shared ? 'shared' : 'private';
      changed.assignee = shared ? resolveAssignee(fields.ownerChoice.value) : currentUser.uid;
    }
    if (!recurring) {
      if (!reminderTime) {
        for (const name of ['reminderTime', 'remindAtMs', 'reminderSentAt', 'reminderSkippedAt']) delete changed[name];
      }
      if (end && end > start) { changed.startDate = start; changed.endDate = end; }
      else { delete changed.startDate; delete changed.endDate; }
    }
    saving = true;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = '저장 중…';
    const error = modal.querySelector('.todo-editor-error');
    error.hidden = true;
    let saved = false;
    try {
      if (recurring) saved = await saveRecurring(getAllRecurring().map(item => item.id === id ? changed : item));
      else {
        const day = getDay(key);
        if (start !== key) {
          day.todos = day.todos.filter(item => item.id !== id);
          const target = getDay(start);
          target.todos.push(changed);
          saved = await saveMovedDays(key, day, start, target);
        } else {
          day.todos = day.todos.map(item => item.id === id ? changed : item);
          saved = await saveDay(key, day);
        }
      }
    } finally {
      saving = false;
      submit.disabled = false;
      submit.textContent = '변경사항 저장';
    }
    if (!saved) { error.textContent = '저장하지 못했어요. 입력한 내용은 유지됩니다. 다시 시도해 주세요.'; error.hidden = false; renderAll(); return; }
    await cancelLocalReminder(id);
    if (!recurring && changed.remindAtMs && !changed.done) await scheduleLocalReminder(changed);
    selectedDate = new Date(`${start}T12:00:00`);
    renderRecurList();
    if (modalKey) openDayDetail(start);
    else renderAll();
    dirty = false;
    close(true);
    toast('일정을 저장했습니다.');
  };
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';
  fitViewport();
  window.visualViewport?.addEventListener('resize', fitViewport);
  window.visualViewport?.addEventListener('scroll', fitViewport);
  history.pushState({ todoEditor: true }, '');
  window.addEventListener('popstate', onBack);
  modal.querySelector('#todoEditorTitle').focus();
}
