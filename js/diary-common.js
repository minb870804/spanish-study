async function loginWithGoogle() {
  // iOS/Android 앱(Capacitor)에서는 네이티브 구글 로그인을 사용한다
  // (웹뷰에서는 구글이 OAuth 팝업을 차단하기 때문)
  const cap = window.Capacitor;
  if (cap && cap.isNativePlatform && cap.isNativePlatform()) {
    try {
      const result = await cap.Plugins.FirebaseAuthentication.signInWithGoogle();
      const idToken = result.credential && result.credential.idToken;
      const accessToken = result.credential && result.credential.accessToken;
      if (!idToken) throw new Error('네이티브 로그인에서 토큰을 받지 못했습니다.');
      const credential = firebase.auth.GoogleAuthProvider.credential(idToken, accessToken || null);
      await auth.signInWithCredential(credential);
    } catch (e) {
      console.error('네이티브 로그인 에러:', e);
      alert('구글 로그인 중 문제가 발생했습니다.\n' + (e.message || e));
    }
    return;
  }
  const provider = new firebase.auth.GoogleAuthProvider();
  // 팝업 우선 (iOS 홈 화면 앱에서도 팝업이 리다이렉트보다 안정적)
  try {
    await auth.signInWithPopup(provider);
  } catch (e) {
    // 팝업이 차단되면 리다이렉트로 자동 전환
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment' || e.code === 'auth/cancelled-popup-request') {
      try { await auth.signInWithRedirect(provider); return; } catch (e2) { e = e2; }
    }
    console.error('로그인 에러:', e);
    alert(`구글 로그인 중 문제가 발생했습니다.\n코드: ${e.code}\n메시지: ${e.message}`);
  }
}
async function logout() {
  if (confirm('로그아웃 하시겠습니까?')) { await auth.signOut(); location.reload(); }
}

function toggleTheme() {
  const isDark = document.body.classList.toggle('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  updateThemeButton();
}
function updateThemeButton() {
  document.getElementById('themeToggle').innerHTML = document.body.classList.contains('dark') ? '☀️ 라이트' : '🌙 다크';
}
function loadTheme() {
  if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');
  updateThemeButton();
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

let diarySyncPhase = 'signed-out';
function setDiarySync(phase) {
  diarySyncPhase = phase;
  renderDiarySync();
}
function renderDiarySync() {
  const panel = document.getElementById('diarySyncPanel');
  if (!panel) return;
  panel.hidden = diarySyncPhase === 'signed-out';
  const phase = navigator.onLine ? diarySyncPhase : 'offline';
  const messages = {
    'signed-out':'로그인 후 기록을 불러와요.',
    loading:'기록을 불러오는 중이에요.',
    cached:'기기에 보관된 기록을 표시하고 있어요. 서버 연결을 확인해 주세요.',
    pending:'서버에 변경사항을 저장하는 중이에요.',
    synced:'서버와 동기화됐어요.',
    offline:'오프라인이에요. 연결되면 다시 동기화해요.',
    error:'기록을 동기화하지 못했어요. 연결을 확인하고 다시 시도해 주세요.'
  };
  document.getElementById('diarySyncStatus').textContent = messages[phase];
  const retry = document.getElementById('diarySyncRetry');
  retry.hidden = !['error','cached','offline'].includes(phase);
  retry.disabled = !navigator.onLine;
}
function observeDiarySnapshot(snapshot) {
  setDiarySync(snapshot.metadata?.hasPendingWrites ? 'pending' : snapshot.metadata?.fromCache ? 'cached' : 'synced');
}
window.addEventListener('offline', renderDiarySync);
window.addEventListener('online', () => {
  if (diarySyncPhase !== 'signed-out' && typeof retryDiarySync === 'function') retryDiarySync();
});
