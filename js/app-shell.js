(() => {
  const icons = {
    home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
    study:'<path d="M12 5v16M3 3c4 0 7 1 9 3 2-2 5-3 9-3v15c-4 0-7 1-9 3-2-2-5-3-9-3Z"/>',
    diary:'<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M9 3v18M3 7h4M3 12h4M3 17h4M12 8h5M12 12h5"/>',
    shared:'<path d="M21 11c0 5-9 10-9 10S3 16 3 11a5 5 0 0 1 9-3 5 5 0 0 1 9 3Z"/>',
    settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>'
  };
  function init() {
    const nav=document.createElement('nav'); nav.className='app-nav'; nav.setAttribute('aria-label','주요 메뉴');
    const links=[['home','홈','./'],['study','스터디','study.html'],['diary','일기','diary.html'],['shared','교환일기','shared-diary.html'],['settings','설정','./#settings']];
    nav.innerHTML=links.map(([id,label,href])=>`<a href="${href}" data-page="${id}"><svg viewBox="0 0 24 24" class="ui-icon" aria-hidden="true">${icons[id]}</svg><span>${label}</span></a>`).join('');
    const header=document.querySelector('body > header');
    if(header)header.after(nav); else document.body.prepend(nav);
    const update=()=>{
      const path=location.pathname.replace(/\.html$/,'');
      const current=path.endsWith('/shared-diary')?'shared':path.endsWith('/diary')?'diary':path.endsWith('/study')?'study':location.hash==='#settings'?'settings':'home';
      nav.querySelectorAll('a').forEach(a=>{ if(a.dataset.page===current)a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current'); });
    };
    update(); window.addEventListener('hashchange',update);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init); else init();
})();
