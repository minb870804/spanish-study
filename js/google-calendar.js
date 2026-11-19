/* 설정 화면의 '구글 캘린더 연동' 카드.
 * 연결하면 서버(functions/gcal.js)가 내 구글 계정에 'minb 개인'·'minb 공유' 캘린더를 만들고,
 * 이후 일정이 저장될 때마다 자동으로 반영한다. 화면은 users/{uid}.googleCalendar 만 보고 상태를 그린다.
 */
(() => {
  let unsubscribe = null;
  let state = null;     // users/{uid}.googleCalendar
  let busy = false;
  let signedIn = false;

  const MESSAGES = {
    connected: '구글 캘린더를 연결했어요. 일정을 옮기는 중이에요 — 잠시 뒤 구글 캘린더에서 확인해 보세요.',
    cancelled: '구글 캘린더 연결을 취소했어요.',
    expired: '연결 시간이 지났어요. 다시 시도해 주세요.',
    scope: '캘린더 권한에 체크해야 연동할 수 있어요. 다시 연결하면서 권한을 허용해 주세요.',
    error: '구글 캘린더 연결에 실패했어요. 잠시 뒤 다시 시도해 주세요.'
  };

  function el(id) { return document.getElementById(id); }

  function ensureSection() {
    let section = el('gcalSection');
    if (section) return section;
    const settings = el('settingsView');
    if (!settings) return null;
    section = document.createElement('section');
    section.id = 'gcalSection';
    section.className = 'card gcal-card';
    section.setAttribute('aria-labelledby', 'gcalTitle');
    section.innerHTML = '<div class="ui-section-head"><h3 id="gcalTitle">구글 캘린더 연동</h3></div>'
      + '<p class="ui-meta" id="gcalStatus" role="status" aria-live="polite"></p>'
      + '<div class="gcal-actions">'
      + '<button type="button" class="ui-button primary" id="gcalConnect">구글 캘린더 연결</button>'
      + '<button type="button" class="ui-button" id="gcalResync" hidden>지금 다시 맞추기</button>'
      + '<button type="button" class="ui-button" id="gcalDisconnect" hidden>연결 끊기</button>'
      + '</div>'
      + '<p class="ui-meta gcal-note">minb에서 저장한 일정이 구글 캘린더의 <b>minb 개인</b>·<b>minb 공유</b> 캘린더에 자동으로 들어가요. 구글 캘린더에서 고친 내용은 minb로 돌아오지 않아요.</p>';
    const shareCard = settings.querySelector('.share-card');
    if (shareCard) shareCard.after(section); else settings.append(section);
    el('gcalConnect').addEventListener('click', connect);
    el('gcalResync').addEventListener('click', resync);
    el('gcalDisconnect').addEventListener('click', disconnect);
    return section;
  }

  function when(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function render() {
    const section = ensureSection();
    if (!section) return;
    const connected = !!(state && state.connected);
    const broken = connected && state.needsReconnect;
    let text;
    if (!connected) text = '연결하면 일정이 내 구글 캘린더에 자동으로 들어가요.';
    else if (broken) text = `${state.email || '구글 계정'} 연결이 끊겼어요. 다시 연결해 주세요.`;
    else {
      text = `${state.email || '구글 계정'}에 연결됨.`;
      text += state.lastFullSyncAt ? ` 마지막 전체 맞춤 ${when(state.lastFullSyncAt)} · 일정 ${state.syncedEvents || 0}개` : ' 일정을 옮기는 중이에요…';
    }
    el('gcalStatus').textContent = text;
    el('gcalConnect').hidden = connected && !broken;
    el('gcalConnect').textContent = broken ? '다시 연결' : '구글 캘린더 연결';
    el('gcalResync').hidden = !connected || broken;
    el('gcalDisconnect').hidden = !connected;
    section.querySelectorAll('button').forEach(button => { button.disabled = busy || !signedIn; });
  }

  async function run(task) {
    if (busy) return;
    busy = true; render();
    try { await task(); } catch (error) {
      console.warn('Google Calendar:', error);
      toast((error && error.message) || '잠시 뒤 다시 시도해 주세요.');
    } finally { busy = false; render(); }
  }

  function connect() {
    run(async () => {
      const { data } = await cloudFunctions.httpsCallable('googleCalendarConnectUrl')({});
      const cap = window.Capacitor;
      // 구글은 앱 안 웹뷰에서 로그인을 막는다. iOS 앱에서는 사파리로 열고, 연결은 서버에 저장되므로 앱에도 바로 반영된다.
      if (cap && cap.isNativePlatform && cap.isNativePlatform()) window.open(data.url, '_blank');
      else location.href = data.url;
    });
  }

  function resync() {
    run(async () => {
      await cloudFunctions.httpsCallable('googleCalendarResync')({});
      toast('구글 캘린더를 다시 맞추고 있어요.');
    });
  }

  function disconnect() {
    if (!confirm('구글 캘린더 연동을 끊을까요?\n이미 들어간 일정은 구글 캘린더에 남아 있어요. 필요하면 구글 캘린더에서 minb 캘린더를 지워 주세요.')) return;
    run(async () => {
      await cloudFunctions.httpsCallable('googleCalendarDisconnect')({});
      toast('구글 캘린더 연동을 끊었어요.');
    });
  }

  function showReturnMessage() {
    const params = new URLSearchParams(location.search);
    const result = params.get('gcal');
    if (!result) return;
    params.delete('gcal');
    const query = params.toString();
    history.replaceState(history.state, '', location.pathname + (query ? `?${query}` : '') + location.hash);
    setTimeout(() => toast(MESSAGES[result] || MESSAGES.error), 600);
  }

  function start() {
    showReturnMessage();
    render();
    auth.onAuthStateChanged(user => {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      state = null;
      signedIn = !!user;
      render();
      if (!user) return;
      unsubscribe = db.collection('users').doc(user.uid).onSnapshot(snap => {
        state = (snap.exists && snap.get('googleCalendar')) || null;
        render();
      }, error => console.warn('Google Calendar status:', error));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
