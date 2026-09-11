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
    <div class="modal-head"><strong id="todoEditorTitle">일정 수정</strong><button class="small-btn" type="button" data-close>닫기</button></div>
    <form class="todo-editor-form">
      <label>제목<input required maxlength="160" name="text" class="modal-input"></label>
      <label>시작일<input required type="date" name="date" class="modal-input"></label>
      <details class="todo-editor-options">
      <summary>추가 옵션<span class="todo-editor-options-summary"></span></summary>
      <div class="todo-editor-options-fields">
      <label>종료일<input type="date" name="endDate" class="modal-input"></label>
      <label class="todo-editor-check"><input type="checkbox" name="allDay"> 종일</label>
      <div class="todo-editor-grid todo-editor-time"><label>시작 시간<input type="time" name="time" class="modal-input"></label><label>종료 시간<input type="time" name="endTime" class="modal-input"></label></div>
      <label>장소<input maxlength="160" name="location" class="modal-input"></label>
      <label>카테고리<select name="cat" class="modal-input">${cats.map(c => `<option value="${escAttr(c.id)}">${esc(c.name)}</option>`).join('')}</select></label>
      <label>공유·주인<select name="party" class="modal-input"><option value="private">나만</option>${partyOptions().map(o => `<option value="${escAttr(o.id)}">${esc(o.label)}</option>`).join('')}</select></label>
      <label class="todo-editor-check"><input type="checkbox" name="important"> 중요 일정</label>
      <label>알림 시간<input type="time" name="reminderTime" class="modal-input"></label>
      <button type="button" class="small-btn todo-editor-recur" data-recur>반복 설정 열기</button>
      <label>메모<textarea name="notes" class="modal-input" rows="4"></textarea></label>
      </div></details>
      <div class="todo-editor-save"><button type="button" class="small-btn todo-editor-delete" data-delete>삭제</button><button type="button" class="small-btn" data-close>취소</button><button type="submit" class="add-btn">저장</button></div>
    </form></div>`;
  const form = modal.querySelector('form'), fields = form.elements;
  for (const name of ['text', 'time', 'endTime', 'location', 'notes']) fields[name].value = todo[name] || '';
  fields.date.value = todo.startDate || key;
  fields.endDate.value = todo.endDate || '';
  fields.cat.value = todo.cat || cats[0]?.id || '';
  fields.reminderTime.value = todo.reminderTime || formatReminder(todo);
  fields.allDay.checked = !!todo.allDay;
  fields.important.checked = !!todo.important;
  fields.party.value = todoScope(todo, 'private') === 'shared' ? party : 'private';
  fields.party.disabled = !isTodoAuthor(todo);
  const repeatButton = modal.querySelector('[data-recur]');
  repeatButton.hidden = recurring || !isTodoAuthor(todo);
  if (recurring) {
    fields.date.disabled = true;
    fields.endDate.disabled = true;
    fields.reminderTime.disabled = true;
  }
  const options = modal.querySelector('.todo-editor-options');
  const optionsSummary = modal.querySelector('.todo-editor-options-summary');
  const updateOptionsSummary = () => {
    const settings = [];
    if (fields.endDate.value) settings.push(`종료 ${fields.endDate.value}`);
    if (fields.allDay.checked) settings.push('종일');
    else if (fields.time.value || fields.endTime.value) settings.push([fields.time.value, fields.endTime.value].filter(Boolean).join('–'));
    if (fields.location.value.trim()) settings.push('장소');
    if (fields.cat.value && fields.cat.value !== cats[0]?.id) settings.push(fields.cat.selectedOptions[0]?.textContent || '카테고리');
    if (fields.party.value !== 'private') settings.push(fields.party.selectedOptions[0]?.textContent || '공유');
    if (fields.important.checked) settings.push('중요');
    if (fields.reminderTime.value) settings.push(`알림 ${fields.reminderTime.value}`);
    if (recurring) settings.push('반복 일정');
    if (fields.notes.value.trim()) settings.push('메모');
    optionsSummary.textContent = settings.length ? settings.join(' · ') : '시간·장소·공유 등';
    return settings.length > 0;
  };
  options.open = updateOptionsSummary();
  const revealField = field => {
    if (options.contains(field)) options.open = true;
    field.focus();
  };
  form.addEventListener('invalid', event => {
    if (event.target === form.querySelector(':invalid')) revealField(event.target);
  }, true);
  let dirty = false, saving = false;
  const previousFocus = document.activeElement;
  const returnFocus = () => { if (previousFocus?.isConnected) previousFocus.focus(); };
  const remove = () => { window.removeEventListener('popstate', onBack); modal.remove(); returnFocus(); };
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
  modal.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => close(false); });
  modal.onclick = event => { if (event.target === modal) close(false); };
  modal.onkeydown = event => {
    if (event.key === 'Escape') { event.stopPropagation(); close(false); }
    if (event.key !== 'Tab') return;
    const controls = [...modal.querySelectorAll('button, input, select, textarea, summary')].filter(el => !el.disabled && el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  // 삭제는 목록의 ✕와 같은 규칙 — 일정을 만든 사람에게만 보인다.
  const deleteButton = modal.querySelector('[data-delete]');
  deleteButton.hidden = !isTodoAuthor(todo);
  deleteButton.onclick = async () => {
    if (saving) return;
    const latest = (recurring ? getAllRecurring() : getDay(key).todos).find(item => item.id === id);
    if (!latest) { toast('일정이 변경되었어요. 닫고 다시 열어 주세요.'); return; }
    if (!(await confirmScheduleDeletion(latest.text))) return;
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
    const start = recurring ? key : fields.date.value, end = fields.endDate.value;
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
    const shared = fields.party.value !== 'private';
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
      changed.assignee = shared ? resolveAssignee(fields.party.value) : currentUser.uid;
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
      submit.textContent = '저장';
    }
    if (!saved) { renderAll(); return; }
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
  history.pushState({ todoEditor: true }, '');
  window.addEventListener('popstate', onBack);
  fields.text.focus();
}
