// ============================================================
// GLOBAL NUMBER FORMAT HELPERS — full digits, no abbreviations
// ============================================================
function fmtN(n){return Math.round(n).toLocaleString();}
function fmtW(n){return '₩'+Math.round(n).toLocaleString();}

// ============================================================
// GLOBAL PERIOD SELECTOR
// ============================================================
window._globalFrom = null;
window._globalTo = null;
window._globalComparing = false;
window._globalCompFrom = null;
window._globalCompTo = null;

function initGlobalPeriod() {
  const yesterday = new Date(Date.now() - 86400000);
  const past = new Date(yesterday.getTime() - 29*86400000);
  const fromStr = past.toISOString().slice(0,10), toStr = yesterday.toISOString().slice(0,10);
  window._globalFrom = fromStr;
  window._globalTo = toStr;
  const gf = document.getElementById('globalFrom'), gt = document.getElementById('globalTo');
  if (gf) gf.value = fromStr;
  if (gt) gt.value = toStr;
  const gc = document.getElementById('globalCompare');
  if (gc) gc.checked = false;
  window._globalComparing = false;
  _hideGlobalCompRow();
}

function _calcCompPeriod(fromStr, toStr) {
  const d1 = new Date(fromStr), d2 = new Date(toStr);
  const days = Math.max(1, Math.round((d2-d1)/86400000)+1);
  const compEnd = new Date(d1.getTime() - 86400000);
  const compStart = new Date(compEnd.getTime() - (days-1)*86400000);
  return { compFrom: compStart.toISOString().slice(0,10), compTo: compEnd.toISOString().slice(0,10), days };
}

function onGlobalCompareToggle() {
  const chk = document.getElementById('globalCompare');
  window._globalComparing = chk && chk.checked;
  if (window._globalComparing) {
    _syncGlobalFromInputs();
    const { compFrom, compTo } = _calcCompPeriod(window._globalFrom, window._globalTo);
    window._globalCompFrom = compFrom;
    window._globalCompTo = compTo;
    _showGlobalCompRow();
  } else {
    window._globalCompFrom = null;
    window._globalCompTo = null;
    _hideGlobalCompRow();
  }
}

function _showGlobalCompRow() {
  const row = document.getElementById('topbarCompRow');
  if (!row) return;
  row.style.display = 'flex';
  row.className = 'topbar-comp-row';
  row.innerHTML = `<span>비교:</span>
    <input type="date" id="globalCompFrom" value="${window._globalCompFrom||''}" onchange="onGlobalCompDateChange('from')">
    <span>~</span>
    <input type="date" id="globalCompTo" value="${window._globalCompTo||''}" onchange="onGlobalCompDateChange('to')">`;
}

function _hideGlobalCompRow() {
  const row = document.getElementById('topbarCompRow');
  if (row) { row.style.display = 'none'; row.innerHTML = ''; }
}

function onGlobalCompDateChange(which) {
  const cfEl = document.getElementById('globalCompFrom'), ctEl = document.getElementById('globalCompTo');
  if (!cfEl || !ctEl) return;
  // Maintain same day count as base period
  const d1 = new Date(window._globalFrom), d2 = new Date(window._globalTo);
  const baseDays = Math.max(1, Math.round((d2-d1)/86400000)+1);
  if (which === 'from') {
    const newFrom = new Date(cfEl.value);
    const newTo = new Date(newFrom.getTime() + (baseDays-1)*86400000);
    ctEl.value = newTo.toISOString().slice(0,10);
  } else {
    const newTo = new Date(ctEl.value);
    const newFrom = new Date(newTo.getTime() - (baseDays-1)*86400000);
    cfEl.value = newFrom.toISOString().slice(0,10);
  }
  window._globalCompFrom = cfEl.value;
  window._globalCompTo = ctEl.value;
}

function _syncGlobalFromInputs() {
  const gf = document.getElementById('globalFrom'), gt = document.getElementById('globalTo');
  if (gf) window._globalFrom = gf.value;
  if (gt) window._globalTo = gt.value;
}

function onGlobalPeriodQuery() {
  _syncGlobalFromInputs();
  if (window._globalComparing) {
    const cfEl = document.getElementById('globalCompFrom'), ctEl = document.getElementById('globalCompTo');
    if (cfEl) window._globalCompFrom = cfEl.value;
    if (ctEl) window._globalCompTo = ctEl.value;
  }
  // Re-render the current active panel
  const activePanel = document.querySelector('.dash-panel.active');
  if (!activePanel) return;
  const panelId = activePanel.id.replace('panel-','');
  const renders = {
    overview: renderOverview, 'media-report': renderMediaReportResult,
    reporting: renderReporting, 'raw-download': renderRawDownload,
  };
  if (renders[panelId]) renders[panelId]();
}

// ============================================================
// DAILY MEMO / NOTES SYSTEM
// ============================================================
let _dailyMemos = {};

// Memo key format: "date|media" e.g. "2026-06-01|meta" or "2026-06-01|__all__"
function _memoKey(date, media) { return media ? (date + '|' + media) : date; }

function getMemo(date, media) {
  const key = _memoKey(date, media);
  const val = _dailyMemos[key];
  if (!val) return {};
  // Migrate old string memos to new object format
  if (typeof val === 'string') return { text: val, editor: '', editedAt: '' };
  return val;
}
function setMemo(date, text, media) {
  const key = _memoKey(date, media);
  if (text) {
    _dailyMemos[key] = {
      text: text,
      editor: currentUser ? currentUser.email : '',
      editedAt: new Date().toISOString()
    };
  } else {
    delete _dailyMemos[key];
  }
  try { localStorage.setItem('deepfle_memos_'+(currentAccount?.id||'default'), JSON.stringify(_dailyMemos)); } catch(e){}
}
function loadMemos() {
  try { _dailyMemos = JSON.parse(localStorage.getItem('deepfle_memos_'+(currentAccount?.id||'default'))||'{}'); } catch(e){ _dailyMemos={}; }
}

function memoCell(dateStr, media) {
  const memo = getMemo(dateStr, media);
  const has = !!(memo && memo.text);
  const preview = has ? memo.text.slice(0,20).replace(/'/g,"\\'") : '';
  const mediaArg = media ? ",'" + media + "'" : '';
  return `<span class="memo-icon ${has?'has':''}" onclick="event.stopPropagation();openMemoPopup('${dateStr}'${mediaArg})" title="${has ? preview : '메모 추가'}">📝</span>`;
}

function openMemoPopup(dateStr, media, prefill) {
  const existing = getMemo(dateStr, media);
  const hasText = !!(existing && existing.text);
  const displayText = hasText ? existing.text : (prefill || '');
  const mediaLabel = media ? (MEDIA_LABELS[media] || media) : '';
  const mediaTag = media && media !== '__all__' ? ` [${mediaLabel}]` : (media === '__all__' ? ' [전체 매체]' : '');

  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'memo-modal-overlay';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="memo-modal">
      <div class="memo-modal-header">
        <div class="memo-modal-title">${dateStr}${mediaTag} ${prefill && !hasText ? '인사이트 수정' : '메모'}</div>
        <button class="modal-close" onclick="this.closest('.memo-modal-overlay').remove()">x</button>
      </div>
      <textarea class="form-textarea" id="memoPopupText" rows="5" placeholder="메모를 입력하세요...">${displayText.replace(/</g,'&lt;')}</textarea>
      ${hasText && existing.editor ? `<div class="memo-modal-meta">작성자: ${existing.editor} | ${existing.editedAt ? new Date(existing.editedAt).toLocaleString('ko') : ''}</div>` : ''}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
        ${hasText ? `<button class="btn btn-sm btn-danger-outline" onclick="deleteMemoAndClose('${dateStr}','${media||''}')">삭제</button>` : ''}
        <button class="btn btn-sm btn-outline" onclick="this.closest('.memo-modal-overlay').remove()">취소</button>
        <button class="btn btn-sm btn-primary" onclick="saveMemoAndClose('${dateStr}','${media||''}')">저장</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => { const ta = document.getElementById('memoPopupText'); if (ta) ta.focus(); }, 50);
}

function saveMemoAndClose(dateStr, media) {
  const ta = document.getElementById('memoPopupText');
  const val = ta ? ta.value.trim() : '';
  setMemo(dateStr, val, media || undefined);
  document.querySelector('.memo-modal-overlay')?.remove();
  showToast(val ? '메모가 저장되었습니다' : '메모가 삭제되었습니다', 'success');
  // Refresh current view
  onGlobalPeriodQuery();
}

function deleteMemoAndClose(dateStr, media) {
  setMemo(dateStr, '', media || undefined);
  document.querySelector('.memo-modal-overlay')?.remove();
  showToast('메모가 삭제되었습니다', 'success');
  onGlobalPeriodQuery();
}

// ============================================================
// UNIFIED INSIGHT SYSTEM (대시보드 + MR 공유)
// ============================================================
let _unifiedInsightText = '';
let _unifiedInsightEdited = null;

function _loadUnifiedInsight() {
  try {
    const saved = JSON.parse(localStorage.getItem('deepfle_unified_insight_'+(currentAccount?.id||'default'))||'null');
    if (saved) { _unifiedInsightText = saved.text || ''; _unifiedInsightEdited = saved; }
  } catch(e){}
}
function _saveUnifiedInsight(text) {
  _unifiedInsightText = text;
  _unifiedInsightEdited = { text, editor: currentUser ? currentUser.email : '', editedAt: new Date().toISOString() };
  try { localStorage.setItem('deepfle_unified_insight_'+(currentAccount?.id||'default'), JSON.stringify(_unifiedInsightEdited)); } catch(e){}
}

function generateUnifiedInsight(series, labels, dates) {
  if (_unifiedInsightText) return _unifiedInsightText;
  const sum = arr => arr.reduce((a,b)=>a+b,0);
  const items = [];
  series.forEach(s => {
    const totalCost = sum(s.cost), totalClick = sum(s.click), totalImp = sum(s.imp), totalConv = sum(s.conv), totalRev = sum(s.revenue);
    const ctr = totalImp ? (totalClick/totalImp*100) : 0;
    const cvr = totalClick ? (totalConv/totalClick*100) : 0;
    const roas = totalCost ? (totalRev/totalCost*100) : 0;
    const cpa = totalConv ? Math.round(totalCost/totalConv) : 0;
    const half = Math.floor(s.cost.length / 2);
    const firstHalfCost = sum(s.cost.slice(0, half)), secondHalfCost = sum(s.cost.slice(half));
    const firstHalfConv = sum(s.conv.slice(0, half)), secondHalfConv = sum(s.conv.slice(half));
    const costChange = firstHalfCost ? ((secondHalfCost - firstHalfCost) / firstHalfCost * 100) : 0;
    const convChange = firstHalfConv ? ((secondHalfConv - firstHalfConv) / firstHalfConv * 100) : 0;
    const costDir = costChange >= 0 ? '증가' : '감소';
    const convDir = convChange >= 0 ? '증가' : '감소';

    let insight = '', suggestion = '';
    if (roas >= 500) {
      insight = `ROAS ${roas.toFixed(0)}%로 고효율 구간 유지. 전환수 ${fmtN(totalConv)}건, CPA ${fmtW(cpa)}`;
      suggestion = '예산 증액을 통한 스케일업 검토';
    } else if (roas >= 300) {
      insight = `ROAS ${roas.toFixed(0)}%로 안정적 성과. CTR ${ctr.toFixed(2)}%, CVR ${cvr.toFixed(2)}%`;
      suggestion = '소재 최적화를 통한 효율 개선 여지 확인';
    } else {
      insight = `ROAS ${roas.toFixed(0)}%로 효율 저하 구간. CPA ${fmtW(cpa)}로 비용 부담 상승`;
      suggestion = '타겟 재설정 또는 비효율 소재 OFF 권장';
    }
    if (Math.abs(costChange) > 15) {
      insight += `. 광고비 후반기 ${Math.abs(costChange).toFixed(0)}% ${costDir}`;
    }
    if (Math.abs(convChange) > 20) {
      suggestion += `. 전환수 ${Math.abs(convChange).toFixed(0)}% ${convDir} 추세 주목`;
    }

    items.push({
      label: s.label, color: s.color || '#4F46E5',
      costChange: `${costChange>=0?'+':''}${costChange.toFixed(1)}% ${costDir}`,
      convChange: `${convChange>=0?'+':''}${convChange.toFixed(1)}% ${convDir}`,
      summary: `광고비 ${fmtW(totalCost)} · ROAS ${roas.toFixed(0)}% · 전환 ${fmtN(totalConv)}건`,
      insight, suggestion
    });
  });
  return JSON.stringify(items);
}

function _insightItemsToText(items) {
  return items.map(it =>
    `${it.label}\n효율변화: 광고비 ${it.costChange}, 전환수 ${it.convChange}\n인사이트: ${it.insight}\n제안: ${it.suggestion}`
  ).join('\n\n');
}

function renderUnifiedInsightSection(text, sectionId) {
  const editorInfo = _unifiedInsightEdited && _unifiedInsightEdited.editor
    ? `<div style="font-size:10px;color:var(--gray-400);margin-top:6px;">${_unifiedInsightEdited.editor} · ${_unifiedInsightEdited.editedAt ? new Date(_unifiedInsightEdited.editedAt).toLocaleString('ko') : ''} 수정됨</div>` : '';
  let items = [];
  try { items = JSON.parse(text); } catch(e) {}
  const isStructured = Array.isArray(items) && items.length > 0;
  const cardsHTML = isStructured ? items.map(it => `
    <div style="border:1px solid var(--gray-100);border-radius:10px;padding:14px 16px;background:#fff;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <div style="width:10px;height:10px;border-radius:50%;background:${it.color||'var(--primary)'};flex-shrink:0;"></div>
        <div style="font-weight:700;font-size:13px;">${it.label}</div>
        <div style="font-size:11px;color:var(--gray-400);margin-left:auto;">${it.summary||''}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr;gap:6px;font-size:12px;line-height:1.6;">
        <div><span style="font-weight:600;color:var(--gray-500);margin-right:6px;">효율변화</span><span style="color:var(--gray-700);">광고비 ${it.costChange}, 전환수 ${it.convChange}</span></div>
        <div><span style="font-weight:600;color:var(--gray-500);margin-right:6px;">인사이트</span><span style="color:var(--gray-700);">${it.insight}</span></div>
        <div><span style="font-weight:600;color:var(--primary);margin-right:6px;">제안</span><span style="color:var(--gray-700);">${it.suggestion}</span></div>
      </div>
    </div>`).join('') : `<pre style="white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:12.5px;line-height:1.7;color:var(--gray-700);margin:0;background:var(--gray-50);border-radius:8px;padding:14px 16px;">${text||'분석 데이터가 없습니다.'}</pre>`;
  const editText = isStructured ? _insightItemsToText(items) : (text||'');
  return `<div class="card mr-section" id="${sectionId}">
    <div class="card-header">
      <div><div class="card-title">인사이트</div><div class="card-sub">매체별 효율 분석 및 제안</div></div>
      <button class="btn btn-sm btn-outline" id="${sectionId}EditBtn" onclick="toggleInsightEdit('${sectionId}')">수정</button>
    </div>
    <div id="${sectionId}View" style="padding:12px 16px;">
      <div style="display:flex;flex-direction:column;gap:10px;">${cardsHTML}</div>
      ${editorInfo}
    </div>
    <div id="${sectionId}Edit" style="display:none;padding:12px 16px;">
      <textarea id="${sectionId}Textarea" style="width:100%;min-height:200px;border:1px solid var(--gray-200);border-radius:8px;padding:12px;font-size:12.5px;line-height:1.7;resize:vertical;font-family:inherit;">${editText}</textarea>
      <div style="display:flex;gap:8px;margin-top:8px;justify-content:flex-end;">
        <button class="btn btn-sm btn-outline" onclick="cancelInsightEdit('${sectionId}')">취소</button>
        <button class="btn btn-sm btn-primary" onclick="saveInsightEdit('${sectionId}')">저장</button>
      </div>
    </div>
  </div>`;
}

function toggleInsightEdit(sectionId) {
  const view = document.getElementById(sectionId+'View');
  const edit = document.getElementById(sectionId+'Edit');
  if (!view || !edit) return;
  view.style.display = 'none';
  edit.style.display = 'block';
  document.getElementById(sectionId+'EditBtn').style.display = 'none';
}
function cancelInsightEdit(sectionId) {
  document.getElementById(sectionId+'View').style.display = 'block';
  document.getElementById(sectionId+'Edit').style.display = 'none';
  document.getElementById(sectionId+'EditBtn').style.display = '';
}
function saveInsightEdit(sectionId) {
  const ta = document.getElementById(sectionId+'Textarea');
  if (!ta) return;
  _saveUnifiedInsight(ta.value);
  const viewEl = document.getElementById(sectionId+'View');
  if (viewEl) {
    const pre = viewEl.querySelector('pre');
    if (pre) pre.textContent = ta.value;
    else {
      const container = viewEl.querySelector('div');
      if (container) container.innerHTML = `<pre style="white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:12.5px;line-height:1.7;color:var(--gray-700);margin:0;background:var(--gray-50);border-radius:8px;padding:14px 16px;">${ta.value}</pre>`;
    }
  }
  cancelInsightEdit(sectionId);
  showToast('인사이트가 저장되었습니다','success');
}

// ============================================================
// MEDIA TYPE CLASSIFICATION
// ============================================================
const MEDIA_TYPE = {
  naver_sa: 'search', google: 'search_da', meta: 'da', kakao: 'da',
  tiktok: 'video', naver_gfa: 'da', youtube: 'video'
};
function isSearchMedia(key) { return MEDIA_TYPE[key] === 'search'; }

// ============================================================
// DATA STORE
// ============================================================
const DEMO_USERS = {
  master:     {id:'u_master', name:'관리자', email:'admin@deepfle.io',    role:'master',     avatar:'관', avatarColor:'#7C3AED'},
  user:       {id:'u_user',   name:'김담당자', email:'kim@agency.io',  role:'user',       avatar:'김', avatarColor:'#0EA5E9'},
  advertiser: {id:'u_adv',   name:'브랜드팀',  email:'brand@client.io',role:'advertiser', avatar:'브', avatarColor:'#10B981'},
};

const ROLE_META = {
  master:     {label:'마스터', desc:'전체 관리 권한', icon:'👑', color:'var(--master)', lightColor:'var(--master-light)', badgeClass:'badge-purple'},
  user:       {label:'사용자',  desc:'조회 · 편집',    icon:'✏️', color:'var(--user)',   lightColor:'var(--user-light)',   badgeClass:'badge-blue'},
  advertiser: {label:'광고주', desc:'조회 전용',       icon:'👁️', color:'var(--advertiser)', lightColor:'var(--advertiser-light)', badgeClass:'badge-green'},
};

// Can perform write actions?
const CAN_EDIT   = (r) => r === 'master' || r === 'user';
const IS_MASTER  = (r) => r === 'master';

let currentUser = null;
let currentAccount = null;

const ACCOUNTS = [];          // 데모 계정 제거 — 실 계정은 BACKEND_ACCOUNTS 사용
let ALL_PLATFORM_USERS = [];  // 데모 사용자 제거 — 실 사용자는 BACKEND_USERS 사용
let BACKEND_USERS = [];       // GET /api/users 결과 캐시

const MEDIA_DATA = [
  {key:'kakao',          name:'카카오모먼트',  color:'#FFE300', spend:0,imp:0,click:0,cvr:0,roas:0,cpa:0,on:false, dailyBudget:0},
  {key:'naver_sa',       name:'네이버 검색광고',  color:'#03C75A',spend:0,imp:0,click:0,cvr:0,roas:0,cpa:0,on:false, dailyBudget:0},
  {key:'naver_gfa',      name:'네이버 성과형(GFA)',color:'#00C73C',spend:0,imp:0,click:0,cvr:0,roas:0,cpa:0,on:false, dailyBudget:0},
  {key:'google',         name:'구글 Ads',        color:'#4285F4', spend:0,imp:0,click:0,cvr:0,roas:0,cpa:0,on:false, dailyBudget:0},
  {key:'meta',           name:'메타(페이스북)',color:'#1877F2', spend:0,imp:0,click:0,cvr:0,roas:0,cpa:0,on:false, dailyBudget:0},
  {key:'kakao_biz',      name:'카카오 비즈보드',color:'#F7E600',spend:0,imp:0,click:0,cvr:0,roas:0,cpa:0,on:false, dailyBudget:0},
  {key:'naver_shopping', name:'네이버 쇼핑',  color:'#00C73C', spend:0,imp:0,click:0,cvr:0,roas:0,cpa:0,on:false, dailyBudget:0},
  {key:'tiktok',         name:'틱톡',          color:'#000',    spend:0,imp:0,click:0,cvr:0,roas:0,cpa:0,on:false, dailyBudget:0},
  {key:'youtube',        name:'유튜브',        color:'#FF0000', spend:0,imp:0,click:0,cvr:0,roas:0,cpa:0,on:false, dailyBudget:0},
  {key:'karrot',         name:'당근마켓',      color:'#FF7E36', spend:0,imp:0,click:0,cvr:0,roas:0,cpa:0,on:false, dailyBudget:0},
];

// 일일 소진한도는 계정별 로드 (_loadAccountSettings에서 처리)

let rules = [];

let reports = [];

let links = [];

const AUD_DEMO = [];
function _saveAudiences() { localStorage.setItem('deepfle_audiences', JSON.stringify(audiences)); }
let audiences = JSON.parse(localStorage.getItem('deepfle_audiences') || 'null') || [];

let activities = [];

const ALL_MEDIA_NAMES = ['카카오모먼트','네이버 검색광고','구글 Ads','메타(페이스북)','카카오 비즈보드','네이버 쇼핑','틱톡','유튜브','당근마켓'];
const MEDIA_META = {
  '카카오모먼트':{icon:'K',color:'#FFCD00',txt:'#3C1E1E'}, '네이버 검색광고':{icon:'N',color:'#03C75A',txt:'#fff'},
  '구글 Ads':{icon:'G',color:'#4285F4',txt:'#fff'}, '메타(페이스북)':{icon:'f',color:'#1877F2',txt:'#fff'},
  '카카오 비즈보드':{icon:'K',color:'#F7E600',txt:'#3C1E1E'}, '네이버 쇼핑':{icon:'N',color:'#00C73C',txt:'#fff'},
  '틱톡':{icon:'♪',color:'#000',txt:'#fff'}, '유튜브':{icon:'▶',color:'#FF0000',txt:'#fff'}, '당근마켓':{icon:'🥕',color:'#FF7E36',txt:'#fff'},
};
// 연동 매체: 백엔드에서 로드, 데모값 없음
let connectedMedia = [];
let mediaConnInfo = {};
let _oauthPendingMedia = null;

// ============================================================
// AUTH
// ============================================================
function loginAs(role) {
  currentUser = {...DEMO_USERS[role]};
  const accessibleAccounts = ACCOUNTS.filter(a => a.users?.includes(currentUser.id));
  currentAccount = accessibleAccounts[0] || null;
  _applyMediaOnOff();
  localStorage.setItem('deepfle_session', JSON.stringify({mode:'mock', role}));
  initDashboard();
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pw    = document.getElementById('login-pw').value;
  if (!email) { showToast('이메일을 입력해주세요','warning'); return; }
  if (!pw)    { showToast('비밀번호를 입력해주세요','warning'); return; }

  const btn = document.getElementById('login-btn');
  const _setBtnLoading = (msg) => { if (btn) { btn.disabled = true; btn.textContent = msg; } };
  const _setBtnReady   = ()    => { if (btn) { btn.disabled = false; btn.textContent = '로그인'; } };

  // 페이지 로드 시 백엔드가 꺼져 있다가 나중에 켜진 경우 → 재연결 시도
  if (!DEEPFLE_API.live) {
    _setBtnLoading('연결 확인 중...');
    await DEEPFLE_API.healthCheck();
    const badge = document.getElementById('backendStatusBadge');
    if (badge) {
      if (DEEPFLE_API.live) {
        badge.innerHTML = '🟢 백엔드 연결됨 — 실제 JWT 인증 사용';
        badge.style.cssText = 'color:#16A34A;background:#DCFCE7;';
      } else {
        badge.innerHTML = '🔴 백엔드 연결 실패 — Mock 모드 (데모 계정만 로그인 가능)';
        badge.style.cssText = 'color:#DC2626;background:#FEE2E2;';
      }
    }
  }

  if (DEEPFLE_API.live) {
    // 백엔드 실인증
    _setBtnLoading('로그인 중...');
    let loginOk = false;
    try {
      const { token, user } = await DEEPFLE_API.post('/auth/login', {email, password: pw});
      loginOk = true;
      DEEPFLE_API.token = token;
      currentUser = {id:user.id, name:user.name, email:user.email, role:user.role,
                     avatar:user.name[0], avatarColor:user.avatarColor};
      _setBtnLoading('계정 로드 중...');
      try {
        const { workspaces } = await DEEPFLE_API.get('/workspaces');
        BACKEND_WORKSPACES = workspaces;
        currentWorkspace = workspaces[0] || null;
        let accounts = [];
        if (currentWorkspace) {
          const res = await DEEPFLE_API.get(`/workspaces/${currentWorkspace.id}/accounts`);
          accounts = res.accounts || [];
        } else {
          accounts = (await DEEPFLE_API.get('/accounts')).accounts || [];
        }
        BACKEND_ACCOUNTS = accounts;
        if (accounts[0]) {
          currentAccount = {id:accounts[0].id, name:accounts[0].name,
                            advertiser:accounts[0].advertiser, color:accounts[0].color, users:[]};
          await loadBackendMedia(currentAccount.id);
        } else {
          currentAccount = null;
        }
      } catch(e2) { /* 계정 로드 실패는 무시하고 대시보드 진입 */ }
      // 라이브 모드: localStorage 데모 잔여 데이터 제거
      ['deepfle_manual_conv_data','deepfle_demo_conversions','deepfle_audiences'].forEach(k=>localStorage.removeItem(k));
      localStorage.setItem('deepfle_session', JSON.stringify({
        mode:'live', token:DEEPFLE_API.token, user:currentUser,
        workspaceId: currentWorkspace?.id||null, accountId: currentAccount?.id||null
      }));
      _setBtnReady();
      initDashboard();
      showToast(`🟢 로그인 성공 — ${user.name} (${user.role})`,'success');
    } catch(e) {
      _setBtnReady();
      if (!loginOk) {
        if (e.status === 403 || e.message === 'pending') {
          showToast('관리자 승인 대기 중입니다. 마스터에게 문의해주세요.', 'warning');
        } else {
          showToast(`로그인 실패: ${e.message}`, 'error');
        }
      } else { initDashboard(); showToast(`🟢 로그인 성공`,'success'); }
    }
  } else {
    _setBtnReady();
    // Mock 모드: DEMO_CREDENTIALS에서 이메일·비밀번호 일치 확인
    const roleKey = Object.keys(DEMO_CREDENTIALS).find(
      k => DEMO_CREDENTIALS[k].email === email && DEMO_CREDENTIALS[k].password === pw
    );
    if (roleKey) loginAs(roleKey);
    else showToast('이메일 또는 비밀번호가 올바르지 않습니다', 'error');
  }
}

// ============================================================
// 회원가입 위자드 (1-Step)
// ============================================================
const SG_STEPS = ['기본 정보'];
const SG_TOTAL = 1;
let _sgStep = 1;
let _sgData = {};
let _sgEmailVerified = false;

function showSignupForm() {} // 하위 호환
function sendEmailVerification() {}
function confirmEmailVerify() {}
function doSignup() {}

function showSignupPage() {
  _sgStep = 1; _sgEmailVerified = false;
  _sgData = {name:'',email:'',pw:'',pwConfirm:'',company:'',position:'',phone:'',role:'user',termsAll:false,terms1:false,terms2:false,marketing:false,inviteCode:''};
  document.getElementById('page-login').style.display='none';
  document.getElementById('page-login').classList.remove('active');
  const sg=document.getElementById('page-signup'); sg.style.display='flex';
  _renderSgStep();
}
function showLoginPage() {
  document.getElementById('page-signup').style.display='none';
  document.getElementById('page-login').style.display='';
  document.getElementById('page-login').classList.add('active');
}

function _renderSgStep() {
  const bar=document.getElementById('sgProgressBar');
  if(bar) bar.innerHTML='';
  document.getElementById('sgStepTitle').textContent='기본 정보 입력';
  document.getElementById('sgStepSub').textContent='이름·이메일·비밀번호를 입력하세요';
  const prev=document.getElementById('sgPrevBtn'),next=document.getElementById('sgNextBtn');
  if(prev) prev.style.display='none';
  if(next) {next.style.display=''; next.textContent='가입하기';}
  const body=document.getElementById('sgBody');
  if(!body) return;
  body.innerHTML=_sgBody1();
}

function _sgBody1() {
  const pwStr=v=>{if(!v)return['','',0];let s=0;if(v.length>=8)s++;if(/[A-Z]/.test(v))s++;if(/[0-9]/.test(v))s++;if(/[^A-Za-z0-9]/.test(v))s++;return[['약','보통','강','매우 강'][s-1]||'약',['#EF4444','#F59E0B','#10B981','#06B6D4'][s-1]||'#EF4444',Math.min(s*25,100)];};
  const [pwLbl,pwClr,pwPct]=pwStr(_sgData.pw);
  const verifyRowDisplay=_sgEmailVerified||_sgData.email?'':'none';
  return `<div style="display:flex;flex-direction:column;gap:14px;">
    <div>
      <label style="font-size:12px;font-weight:600;color:#94A3B8;display:block;margin-bottom:5px;">이름 <span style="color:#EF4444;">*</span></label>
      <input class="form-input" id="sg1name" value="${_sgData.name}" placeholder="홍길동" style="background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.12);color:#fff;" oninput="_sgData.name=this.value">
    </div>
    <div>
      <label style="font-size:12px;font-weight:600;color:#94A3B8;display:block;margin-bottom:5px;">이메일 <span style="color:#EF4444;">*</span></label>
      <div style="display:flex;gap:8px;">
        <input class="form-input" id="sg1email" type="email" value="${_sgData.email}" placeholder="email@company.com"
          style="flex:1;background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.12);color:#fff;"
          oninput="_sgData.email=this.value;_sgEmailVerified=false;const r=document.getElementById('sgVerifyRow');if(r)r.style.display='none'">
        <button onclick="sgSendVerify()" style="white-space:nowrap;padding:0 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:transparent;color:#94A3B8;font-size:12px;cursor:pointer;">인증코드 발송</button>
      </div>
      <div id="sgVerifyRow" style="display:${verifyRowDisplay};margin-top:8px;">
        <div style="display:flex;gap:8px;align-items:center;">
          <input class="form-input" id="sg1code" placeholder="인증코드 6자리" maxlength="6"
            style="flex:1;background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.12);color:#fff;height:34px;font-size:14px;letter-spacing:6px;"
            ${_sgEmailVerified?'disabled':''}>
          <button onclick="sgConfirmVerify()" style="white-space:nowrap;padding:0 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:transparent;color:#94A3B8;font-size:12px;cursor:pointer;" ${_sgEmailVerified?'disabled':''}>확인</button>
        </div>
        <div id="sgVerifyStatus" style="font-size:11px;margin-top:5px;">
          ${_sgEmailVerified?'<span style="color:#10B981;">✅ 이메일 인증 완료</span>':''}
        </div>
      </div>
    </div>
    <div>
      <label style="font-size:12px;font-weight:600;color:#94A3B8;display:block;margin-bottom:5px;">비밀번호 <span style="color:#EF4444;">*</span></label>
      <input class="form-input" id="sg1pw" type="password" value="${_sgData.pw}" placeholder="8자 이상 · 영문+숫자+특수문자"
        style="background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.12);color:#fff;" oninput="_sgData.pw=this.value;_updatePwStrength(this.value)">
      <div id="sgPwStrength" style="display:${_sgData.pw?'flex':'none'};align-items:center;gap:8px;margin-top:6px;">
        <div style="flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,0.1);overflow:hidden;">
          <div id="sgPwStrengthBar" style="width:${pwPct}%;height:100%;background:${pwClr};border-radius:2px;transition:width .3s;"></div>
        </div>
        <span id="sgPwStrengthLbl" style="font-size:11px;color:${pwClr};font-weight:600;">${pwLbl}</span>
      </div>
    </div>
    <div>
      <label style="font-size:12px;font-weight:600;color:#94A3B8;display:block;margin-bottom:5px;">비밀번호 확인 <span style="color:#EF4444;">*</span></label>
      <input class="form-input" id="sg1pwc" type="password" value="${_sgData.pwConfirm}" placeholder="비밀번호 재입력"
        style="background:rgba(255,255,255,0.06);border-color:${_sgData.pwConfirm&&_sgData.pw!==_sgData.pwConfirm?'#EF4444':_sgData.pwConfirm&&_sgData.pw===_sgData.pwConfirm?'#10B981':'rgba(255,255,255,0.12)'};color:#fff;"
        oninput="_sgData.pwConfirm=this.value;this.style.borderColor=this.value?(_sgData.pw===this.value?'#10B981':'#EF4444'):'rgba(255,255,255,0.12)'">
      ${_sgData.pwConfirm&&_sgData.pw===_sgData.pwConfirm?`<div style="font-size:11px;color:#10B981;margin-top:4px;">✅ 비밀번호 일치</div>`:''}
    </div>
  </div>`;
}

function _updatePwStrength(v) {
  const row=document.getElementById('sgPwStrength');
  const bar=document.getElementById('sgPwStrengthBar');
  const lbl=document.getElementById('sgPwStrengthLbl');
  if(!row) return;
  if(!v){row.style.display='none';return;}
  let s=0;
  if(v.length>=8)s++;if(/[A-Z]/.test(v))s++;if(/[0-9]/.test(v))s++;if(/[^A-Za-z0-9]/.test(v))s++;
  const colors=['#EF4444','#F59E0B','#10B981','#06B6D4'];
  const labels=['약','보통','강','매우 강'];
  const clr=colors[Math.max(0,s-1)];
  row.style.display='flex';
  bar.style.width=Math.min(s*25,100)+'%';
  bar.style.background=clr;
  lbl.textContent=labels[Math.max(0,s-1)];
  lbl.style.color=clr;
}
async function sgSendVerify() {
  const email=document.getElementById('sg1email')?.value?.trim()||_sgData.email;
  if(!email||!email.includes('@')){showToast('올바른 이메일을 입력해 주세요','warning');return;}
  _sgData.email=email;
  const statusEl=document.getElementById('sgVerifyStatus');
  if(statusEl) statusEl.innerHTML=`<span style="color:#94A3B8;">발송 중...</span>`;
  try {
    const res=await fetch(`${DEEPFLE_API.BASE_URL}/auth/send-verify`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email})
    });
    const data=await res.json();
    if(res.status===409){showToast('이미 가입된 이메일입니다','warning');return;}
    if(!res.ok){showToast(data.error||'발송 실패','error');return;}
    document.getElementById('sgVerifyRow').style.display='';
    if(data.sent){
      if(statusEl) statusEl.innerHTML=`<span style="color:#64748B;">${email}으로 인증코드를 발송했습니다. 메일함을 확인해주세요.</span>`;
      showToast('인증코드를 이메일로 발송했습니다','success');
    } else {
      if(statusEl) statusEl.innerHTML=`<span style="color:#EF4444;">이메일 발송에 실패했습니다. 관리자에게 SMTP 설정을 요청하거나 서버 환경변수(SMTP_HOST)를 확인해주세요.</span>`;
      showToast('이메일 발송 실패: SMTP 서버 미설정','error');
    }
  } catch(e) {
    if(statusEl) statusEl.innerHTML=`<span style="color:#EF4444;">서버 연결 실패. 백엔드가 실행 중인지 확인해주세요.</span>`;
    showToast('서버 연결 실패','error');
  }
}
async function sgConfirmVerify() {
  const code=document.getElementById('sg1code')?.value?.trim();
  if(!code){showToast('인증코드를 입력해주세요','warning');return;}
  const email=_sgData.email||document.getElementById('sg1email')?.value?.trim();
  try {
    const res=await fetch(`${DEEPFLE_API.BASE_URL}/auth/check-verify`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email,code})
    });
    const data=await res.json();
    if(res.ok&&data.verified){
      _sgEmailVerified=true;
      document.getElementById('sgVerifyStatus').innerHTML='<span style="color:#10B981;font-weight:600;">✅ 이메일 인증 완료</span>';
      document.getElementById('sg1code').disabled=true;
      const btn=document.querySelector('[onclick="sgConfirmVerify()"]');
      if(btn) btn.disabled=true;
      showToast('이메일 인증 완료!','success');
    } else {
      document.getElementById('sgVerifyStatus').innerHTML=`<span style="color:#EF4444;">❌ ${data.error||'인증 실패'}</span>`;
    }
  } catch(e) {
    document.getElementById('sgVerifyStatus').innerHTML=`<span style="color:#EF4444;">서버 연결 실패</span>`;
  }
}

function _sgBody2() {
  const rc=(val,icon,title,desc)=>{const sel=_sgData.role===val;return`<div onclick="_sgData.role='${val}';_renderSgStep()" style="border:2px solid ${sel?'#4F46E5':'rgba(255,255,255,0.1)'};border-radius:10px;padding:14px 16px;cursor:pointer;background:${sel?'rgba(79,70,229,0.15)':'transparent'};display:flex;align-items:center;gap:12px;transition:all .2s;"><span style="font-size:22px;">${icon}</span><div style="flex:1;"><div style="font-size:13px;font-weight:700;color:#fff;">${title}</div><div style="font-size:11px;color:#94A3B8;margin-top:2px;">${desc}</div></div>${sel?`<div style="width:18px;height:18px;border-radius:50%;background:#4F46E5;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><span style="color:#fff;font-size:10px;">✓</span></div>`:''}</div>`;};
  return`<div style="display:flex;flex-direction:column;gap:14px;">
    <div>
      <label style="font-size:12px;font-weight:600;color:#94A3B8;display:block;margin-bottom:5px;">회사/소속명 <span style="color:#EF4444;">*</span></label>
      <input class="form-input" id="sg2company" value="${_sgData.company}" placeholder="예) (주)디지털에이전시" style="background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.12);color:#fff;" oninput="_sgData.company=this.value">
    </div>
    <div style="display:flex;gap:10px;">
      <div style="flex:1;"><label style="font-size:12px;font-weight:600;color:#94A3B8;display:block;margin-bottom:5px;">직책 <span style="font-size:10px;font-weight:400;">(선택)</span></label>
        <input class="form-input" id="sg2position" value="${_sgData.position}" placeholder="예) 퍼포먼스 마케터" style="background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.12);color:#fff;" oninput="_sgData.position=this.value">
      </div>
      <div style="flex:1;"><label style="font-size:12px;font-weight:600;color:#94A3B8;display:block;margin-bottom:5px;">연락처 <span style="font-size:10px;font-weight:400;">(선택)</span></label>
        <input class="form-input" id="sg2phone" type="tel" value="${_sgData.phone}" placeholder="010-0000-0000" style="background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.12);color:#fff;" oninput="_sgData.phone=this.value">
      </div>
    </div>
    <div>
      <label style="font-size:12px;font-weight:600;color:#94A3B8;display:block;margin-bottom:8px;">역할 선택 <span style="color:#EF4444;">*</span></label>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${rc('user','✏️','에이전시 담당자','캠페인 관리·편집·리포트 생성 권한')}
        ${rc('advertiser','👁️','광고주 담당자','성과 데이터 조회 전용 (편집 불가)')}
      </div>
    </div>
  </div>`;
}

function _sgBody3() {
  const chk=(id,val,lbl,req)=>`<label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);"><input type="checkbox" id="${id}" ${val?'checked':''} onchange="_sgData.${id}=this.checked;${id==='termsAll'?'_sgToggleAll(this.checked);':'_sgSyncAll();'}_renderSgStep()" style="width:16px;height:16px;cursor:pointer;accent-color:#4F46E5;flex-shrink:0;"><span style="flex:1;font-size:13px;color:${req?'#e2e8f0':'#94A3B8'};">${lbl}${req?` <span style="color:#EF4444;font-size:10px;">(필수)</span>`:` <span style="font-size:10px;color:#475569;">(선택)</span>`}</span></label>`;
  return`<div>
    ${chk('termsAll',_sgData.termsAll,'전체 동의',false)}
    <div style="padding-left:8px;margin-top:4px;">
      ${chk('terms1',_sgData.terms1,'이용약관 동의',true)}
      <a href="#" onclick="event.preventDefault();const d=document.getElementById('t1d');d.style.display=d.style.display?'':'block'" style="font-size:10px;color:#4F46E5;margin-left:26px;display:block;margin-bottom:2px;">내용 보기 ▾</a>
      <div id="t1d" style="display:none;max-height:70px;overflow-y:auto;background:rgba(255,255,255,0.04);border-radius:6px;padding:8px 10px;font-size:10px;color:#64748B;line-height:1.7;margin-bottom:6px;">본 서비스는 광고 성과 분석을 목적으로 제공됩니다. 서비스 이용 시 발생하는 데이터는 서비스 품질 개선 목적으로만 활용되며 제3자에게 제공되지 않습니다. 이용약관에 동의하지 않을 경우 서비스 이용이 제한될 수 있습니다.</div>
      ${chk('terms2',_sgData.terms2,'개인정보 처리방침 동의',true)}
      <a href="#" onclick="event.preventDefault();const d=document.getElementById('t2d');d.style.display=d.style.display?'':'block'" style="font-size:10px;color:#4F46E5;margin-left:26px;display:block;margin-bottom:2px;">내용 보기 ▾</a>
      <div id="t2d" style="display:none;max-height:70px;overflow-y:auto;background:rgba(255,255,255,0.04);border-radius:6px;padding:8px 10px;font-size:10px;color:#64748B;line-height:1.7;margin-bottom:6px;">수집 항목: 이름, 이메일, 소속, 연락처. 수집 목적: 서비스 제공 및 계정 관리. 보유 기간: 회원 탈퇴 시까지. 제3자 제공: 없음.</div>
      ${chk('marketing',_sgData.marketing,'마케팅 정보 수신 동의',false)}
    </div>
  </div>`;
}
function _sgToggleAll(v){_sgData.terms1=v;_sgData.terms2=v;_sgData.marketing=v;}
function _sgSyncAll(){_sgData.termsAll=_sgData.terms1&&_sgData.terms2&&_sgData.marketing;}

function _sgBody4() {
  return`<div style="text-align:center;padding:4px 0 16px;">
    <div style="font-size:48px;margin-bottom:12px;">🎉</div>
    <div style="font-size:18px;font-weight:700;color:#fff;margin-bottom:6px;">${_sgData.name}님, 가입 완료!</div>
    <div style="font-size:13px;color:#94A3B8;margin-bottom:24px;line-height:1.7;"><b style="color:#818CF8;">${_sgData.email}</b>으로<br>계정이 생성되었습니다.</div>
    <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:16px;margin-bottom:20px;text-align:left;">
      <div style="font-size:11px;font-weight:700;color:#64748B;margin-bottom:8px;letter-spacing:.5px;">초대 코드 입력 (선택)</div>
      <div style="font-size:12px;color:#475569;margin-bottom:10px;">마스터로부터 초대 코드를 받으셨다면 입력 시 즉시 계정에 접근할 수 있습니다.</div>
      <div style="display:flex;gap:8px;">
        <input class="form-input" id="sg4invite" placeholder="초대 코드 입력 (예: ABC123)"
          style="flex:1;background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.12);color:#fff;height:36px;font-size:13px;letter-spacing:2px;"
          oninput="_sgData.inviteCode=this.value.toUpperCase();this.value=this.value.toUpperCase()">
        <button onclick="sgApplyInvite()" style="padding:0 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:transparent;color:#94A3B8;font-size:12px;cursor:pointer;white-space:nowrap;">적용</button>
      </div>
      <div id="sgInviteStatus" style="font-size:11px;margin-top:6px;"></div>
    </div>
    <button onclick="sgFinish()" class="login-btn" style="margin:0;width:100%;font-size:14px;background:linear-gradient(135deg,#4F46E5,#818CF8);">🚀 DeepFle 시작하기</button>
    <div style="font-size:11px;color:#475569;margin-top:12px;">초대 코드가 없어도 마스터 승인 후 계정을 이용할 수 있습니다.</div>
  </div>`;
}
function sgApplyInvite() {
  const code=document.getElementById('sg4invite')?.value?.trim();
  if(!code){showToast('초대 코드를 입력해 주세요','warning');return;}
  if(code.length>=4){
    document.getElementById('sgInviteStatus').innerHTML='<span style="color:#10B981;">✅ 유효한 초대 코드입니다. 시작하기를 눌러 입장하세요.</span>';
    showToast('초대 코드 확인 완료!','success');
  } else {
    document.getElementById('sgInviteStatus').innerHTML='<span style="color:#EF4444;">❌ 유효하지 않은 코드입니다.</span>';
  }
}

function sgNext() {
  if(_sgStep===1){
    const name=document.getElementById('sg1name')?.value?.trim()||_sgData.name;
    const email=document.getElementById('sg1email')?.value?.trim()||_sgData.email;
    const pw=document.getElementById('sg1pw')?.value||_sgData.pw;
    const pwc=document.getElementById('sg1pwc')?.value||_sgData.pwConfirm;
    if(!name||!email||!pw||!pwc){showToast('모든 필수 항목을 입력해 주세요','warning');return;}
    if(!_sgEmailVerified){showToast('이메일 인증을 완료해 주세요','warning');return;}
    if(pw!==pwc){showToast('비밀번호가 일치하지 않습니다','warning');return;}
    if(pw.length<8){showToast('비밀번호는 8자 이상이어야 합니다','warning');return;}
    Object.assign(_sgData,{name,email,pw,pwConfirm:pwc});
    sgFinish();
  }
}
function sgPrev(){}

async function sgFinish() {
  const btn = document.getElementById('sgNextBtn');
  if (btn) { btn.disabled = true; btn.textContent = '가입 처리 중...'; }
  try {
    const res = await fetch(`${DEEPFLE_API.BASE_URL}/auth/register`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: _sgData.name, email: _sgData.email, password: _sgData.pw})
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || '가입 실패. 다시 시도해주세요', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '가입하기'; }
      return;
    }
    if (data.pending) {
      // 승인 대기 화면
      document.getElementById('sgBody').innerHTML = `
        <div style="text-align:center;padding:24px 0;">
          <div style="font-size:48px;margin-bottom:16px;">⏳</div>
          <div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:8px;">가입 신청이 완료됐습니다</div>
          <div style="font-size:13px;color:#94A3B8;line-height:1.6;">
            관리자 승인 후 서비스를 이용하실 수 있습니다.<br>
            승인은 영업일 기준 1~2일 내 처리됩니다.
          </div>
          <div style="margin-top:16px;padding:12px;background:rgba(255,255,255,0.05);border-radius:8px;font-size:12px;color:#64748B;">
            가입 이메일: <span style="color:#818CF8;">${_sgData.email}</span>
          </div>
        </div>`;
      document.getElementById('sgStepTitle').textContent = '가입 신청 완료';
      document.getElementById('sgStepSub').textContent = '마스터 승인 후 로그인이 가능합니다';
      if (btn) { btn.textContent = '로그인 화면으로'; btn.disabled = false; btn.onclick = ()=>showLoginPage(); }
    } else {
      showLoginPage();
      setTimeout(() => {
        document.getElementById('login-email').value = _sgData.email;
        showToast(`${_sgData.name}님, 환영합니다! 이메일로 로그인해주세요`, 'success');
      }, 200);
    }
  } catch(e) {
    showToast('서버 연결 실패. 백엔드가 실행 중인지 확인해주세요', 'error');
    if (btn) { btn.disabled = false; btn.textContent = '가입하기'; }
  }
}

function doLogout() {
  currentUser = null;
  currentAccount = null;
  localStorage.removeItem('deepfle_session');
  localStorage.removeItem('deepfle_last_panel');
  DEEPFLE_API.token = null;
  document.getElementById('page-dashboard').style.display='none';
  document.getElementById('page-login').classList.add('active');
  document.getElementById('page-login').style.display='';
  showToast('로그아웃되었습니다','info');
}

// ============================================================
// DASHBOARD INIT
// ============================================================
// 계정별 localStorage 키 (설정값 분리)
function _accKey(k) {
  return k + '__' + (currentAccount?.id || 'global');
}

// 계정 전환 시 per-account 설정값 로드
function _loadAccountSettings() {
  USE_DAILY_BUDGET = JSON.parse(localStorage.getItem(_accKey('deepfle_use_daily_budget')) || 'false');
  const saved = JSON.parse(localStorage.getItem(_accKey('deepfle_daily_budgets')) || '{}');
  MEDIA_DATA.forEach(m => { if (saved[m.name] !== undefined) m.dailyBudget = saved[m.name]; });
  _loadManualMedia();
}

// Settings 패널을 열고 특정 탭으로 이동
function openSettingsTab(tabName) {
  if (tabName === 'account') {
    openMyAccount();
    return;
  }
  showPanel('settings');
  const pill = document.querySelector(`.tab-pill[onclick*="'${tabName}'"]`);
  if (pill) switchSettingTab(pill, tabName);
}

function initDashboard() {
  document.getElementById('page-login').classList.remove('active');
  document.getElementById('page-login').style.display='none';
  const dash = document.getElementById('page-dashboard');
  dash.style.display='flex';
  dash.classList.add('active');

  _loadAccountSettings();
  applySidebar();
  applyTopbar();
  renderSidebarNav();
  loadMemos();
  initGlobalPeriod();
  const _savedPanel = localStorage.getItem('deepfle_last_panel') || '';
  showPanel((currentAccount && _savedPanel) ? _savedPanel : (currentAccount ? 'overview' : 'setup'), null);
}

function applySidebar() {
  const r = currentUser.role;
  const meta = ROLE_META[r];

  const strip = document.getElementById('sbRoleStrip');
  strip.className = `sb-role-strip ${r}`;
  document.getElementById('sbRoleIcon').textContent = meta.icon;
  document.getElementById('sbRoleName').textContent = meta.label;
  document.getElementById('sbRoleLabel').textContent = meta.desc;

  document.getElementById('sbAccountName').textContent = currentAccount ? currentAccount.name : '계정 없음';
  applyWhitelabel(currentAccount);   // Phase 9: 화이트라벨

  const av = document.getElementById('sbAvatar');
  av.textContent = currentUser.avatar;
  av.style.background = currentUser.avatarColor;
  document.getElementById('sbUserName').textContent = currentUser.name;
  document.getElementById('sbUserRole').textContent = meta.label;
}

function applyTopbar() {
  const r = currentUser.role;
  const meta = ROLE_META[r];
  const ind = document.getElementById('topbarRole');
  ind.className = `role-indicator ${r}`;
  ind.innerHTML = `${meta.icon} ${meta.label}`;
  ind.style.cursor = 'pointer';
  ind.title = '내 계정 설정';
  ind.onclick = () => openMyAccount();
}

function renderSidebarNav() {
  const r = currentUser.role;
  const nav = document.getElementById('sidebarNav');

  // 개념적 IA(계정/설정)는 유지하되, 표시는 이전처럼 평면 섹션 레이아웃으로.
  // 광고주는 간소화된 네비게이션 (조회 전용 3개 + 설정)
  const items = r === 'advertiser' ? [
    {section:'성과 현황'},
    {id:'overview',     icon:'📊', label:'대시보드',     roles:['advertiser']},
    {id:'media-report', icon:'📈', label:'미디어 리포트', roles:['advertiser']},
    {id:'raw-download', icon:'⬇️', label:'Raw 다운로드', roles:['advertiser']},
  ] : [
    {section:'데이터 분석'},
    {id:'overview',     icon:'📊', label:'대시보드',           roles:['master','user']},
    {id:'media-report', icon:'📈', label:'미디어 리포트',      roles:['master','user']},
    {section:'오퍼레이팅'},
    {id:'raw-upload',   icon:'📤', label:'Raw 업로드',         roles:['master','user']},
    {id:'report-set',   icon:'🧰', label:'리포트 설정',        roles:['master','user'], locked: !CAN_EDIT(r)},
    {id:'raw-download', icon:'⬇️', label:'Raw 다운로드',       roles:['master','user']},
    {section:'계정'},
    ...(_demoMode ? [] : [
      {id:'optimization', icon:'⚙️', label:'자동 최적화',        roles:['master'], masterOnly:true},
      {id:'attribution',  icon:'🔗', label:'어트리뷰션 링크',    roles:['master'], masterOnly:true},
      {id:'audience',     icon:'🎯', label:'오디언스 타겟팅',    roles:['master'], masterOnly:true},
    ]),
    {id:'workspace',    icon:'📰', label:'활동 피드',           roles:['master','user']},
    {section:'설정'},
    {id:'settings',     icon:'🔧', label:'설정',               roles:['master','user']},
    {id:'accounts',     icon:'🏢', label:'계정 관리',           roles:['master'], masterOnly:true},
  ];

  nav.innerHTML = '';
  items.forEach(item => {
    if (item.section) {
      nav.innerHTML += `<div class="sb-section">${item.section}</div>`;
      return;
    }
    if (!item.roles.includes(r)) return;
    const locked = item.locked ? 'locked' : '';
    const masterCls = item.masterOnly ? 'master-only' : '';
    const badge = item.badge ? `<span class="nav-badge">${item.badge}</span>` : '';
    nav.innerHTML += `
      <div class="nav-item ${locked} ${masterCls}"
           id="nav-${item.id}"
           onclick="${locked ? "showToast('편집 권한이 필요합니다','warning')" : `showPanel('${item.id}',this)`}">
        <span class="ni-icon">${item.icon}</span>${item.label}${badge}
      </div>`;
  });
}

// ============================================================
// PANEL ROUTING
// ============================================================
const PANEL_TITLES = {
  overview:'대시보드', 'media-report':'미디어 리포트', 'report-set':'리포트 설정',
  accounts:'계정 관리', optimization:'자동 최적화',
  reporting:'커스텀 리포트', attribution:'어트리뷰션 링크',
  audience:'오디언스 타겟팅', workspace:'활동 피드', settings:'설정',
  connections:'연결 관리', 'raw-download':'Raw 다운로드',
  'raw-upload':'Raw 업로드', setup:'시작하기'
};

function showPanel(name, navEl) {
  const _MASTER_ONLY_PANELS = ['optimization','attribution','audience'];
  if (_MASTER_ONLY_PANELS.includes(name) && currentUser.role !== 'master') {
    showToast('관리자(MASTER)만 접근할 수 있는 메뉴입니다', 'warning');
    return;
  }
  if (name && name !== 'setup') localStorage.setItem('deepfle_last_panel', name);
  document.querySelectorAll('.dash-panel').forEach(p=>p.classList.remove('active'));
  const panel = document.getElementById('panel-'+name);
  if (!panel) return;
  panel.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const navId = document.getElementById('nav-'+name);
  if (navId) navId.classList.add('active');

  document.getElementById('topbarTitle').textContent = PANEL_TITLES[name] || name;

  // 계정 없을 때 계정 필요 패널 → setup으로 리다이렉트
  const NEEDS_ACCOUNT = ['overview','media-report','report-set','raw-download','raw-upload',
    'optimization','attribution','audience','workspace','connections','reporting'];
  if (!currentAccount && NEEDS_ACCOUNT.includes(name)) {
    showToast('먼저 광고주 계정을 등록해주세요', 'warning');
    name = 'setup';
  }

  const renders = {
    overview: renderOverview, accounts: renderAccounts,
    optimization: renderOptimization, reporting: renderReporting,
    attribution: renderAttribution, audience: renderAudience,
    workspace: renderWorkspace, settings: renderSettings,
    'media-report': renderMediaReport, 'report-set': renderReportSettings,
    'raw-download': renderRawDownload, 'raw-upload': renderRawUpload,
    setup: renderSetupPanel
  };
  if (renders[name]) renders[name]();
  closeSidebar(); // 모바일에서 패널 이동 시 사이드바 닫기
}

// ============================================================
// MOBILE SIDEBAR
// ============================================================
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebarOverlay');
  const open = sb.classList.toggle('open');
  ov.classList.toggle('open', open);
}
function closeSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebarOverlay');
  if (sb) sb.classList.remove('open');
  if (ov) ov.classList.remove('open');
}

// ============================================================
// OVERVIEW (Dynamic Dashboard)
// ============================================================
let _dashLastSeries = null, _dashLastLabels = null, _dashLastDates = null;

function _dashKpiStoreKey(){ return 'deepfle_dashkpi_' + (currentAccount?.id || 'default'); }
function getDashKpiKeys(){
  try { const v = JSON.parse(localStorage.getItem(_dashKpiStoreKey()) || 'null'); if (Array.isArray(v) && v.length) return v; }
  catch(e){}
  return ['cost','imp','click','__conv_primary','revenue','roas'];
}
function saveDashKpiKeys(keys){ try { localStorage.setItem(_dashKpiStoreKey(), JSON.stringify(keys)); } catch(e){} }

let _kpiDragSrc = null;
function onKpiDragStart(e) {
  _kpiDragSrc = e.currentTarget;
  e.currentTarget.style.opacity = '0.4';
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', e.currentTarget.dataset.key);
}
function onKpiDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
function onKpiDragEnter(e) {
  const card = e.currentTarget;
  if (card !== _kpiDragSrc) card.style.borderColor = 'var(--primary)';
}
function onKpiDragLeave(e) { e.currentTarget.style.borderColor = ''; }
function onKpiDrop(e, saveFn, redrawFn) {
  e.preventDefault();
  e.currentTarget.style.borderColor = '';
  const grid = e.currentTarget.closest('.mr-kpi-grid');
  if (!grid || !_kpiDragSrc) return;
  const cards = [...grid.querySelectorAll('.mr-kpi-card[draggable]')];
  const fromIdx = cards.indexOf(_kpiDragSrc);
  const toIdx = cards.indexOf(e.currentTarget);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
  const keys = cards.map(c => c.dataset.key);
  const [moved] = keys.splice(fromIdx, 1);
  keys.splice(toIdx, 0, moved);
  saveFn(keys);
  redrawFn();
}
function onKpiDragEnd(e) { e.currentTarget.style.opacity = ''; _kpiDragSrc = null; }

async function renderOverview() {
  loadMemos();
  const r = currentUser.role;
  const banner = document.getElementById('overviewReadonlyBanner');
  banner.innerHTML = r === 'advertiser'
    ? `<div class="readonly-banner"><span class="readonly-banner-icon">👁️</span><span><strong>조회 전용 모드</strong> — 광고주 계정으로 접속 중입니다. 데이터 조회만 가능합니다.</span></div>`
    : '';
  _renderDashBody();
}

async function _renderDashBody() {
  const body = document.getElementById('dashBody');
  if (!body) return;
  const r = currentUser.role;
  const editable = CAN_EDIT(r);

  // Load catalog
  let catalog = {base:[], conversion:[]};
  try { catalog = await DEEPFLE_API.get(`/accounts/${currentAccount.id}/metric-catalog`); } catch(e) {}

  // Period from global selector
  const fromStr = window._globalFrom || new Date(Date.now() - 30*86400000).toISOString().slice(0,10);
  const toStr = window._globalTo || new Date().toISOString().slice(0,10);

  // 기간 계산
  const d1 = new Date(fromStr), d2 = new Date(toStr);
  const days = Math.max(1, Math.round((d2-d1)/86400000)+1);
  const dates = Array.from({length:days},(_,i)=>new Date(d1.getTime()+i*86400000));
  const labels = dates.map(d=>`${d.getMonth()+1}/${d.getDate()}`);

  // API 실데이터 로드 — 미연결 시 MEDIA_DATA 기반 시연 fallback
  const MEDIA_COLOR_MAP = {'카카오모먼트':'#FFCD00','네이버 검색광고':'#03C75A','구글 Ads':'#4285F4','메타(페이스북)':'#1877F2','카카오 비즈보드':'#F7E600'};
  let series;
  if (!DEEPFLE_API.USE_MOCK) {
    try {
      const res = await DEEPFLE_API.get(`/accounts/${currentAccount.id}/metric-data?from=${fromStr}&to=${toStr}`);
      const rows = res.data || [];
      const presentMedias = [...new Set(rows.map(r=>r.media))].filter(Boolean);
      if (presentMedias.length) series = _pivotMetricData(rows, dates, presentMedias);
    } catch(e) {}
  }
  if (!series || series.length === 0) series = [];
  // 수기 매체: 백엔드 데이터 캐시 후 일별 데이터 추가
  if (DEEPFLE_API.live && currentAccount && MANUAL_MEDIA.length) {
    try {
      const _mmRes = await DEEPFLE_API.get(`/accounts/${currentAccount.id}/manual-metrics?from=${fromStr}&to=${toStr}`);
      window._manualMetricsByMediaId = _buildManualMetricsIndex(_mmRes.rows || []);
    } catch(e) { window._manualMetricsByMediaId = window._manualMetricsByMediaId || {}; }
  }
  series = [...series, ..._getManualMediaSeries(dates)];
  // 마크업 적용 (매체별 설정에 따라 광고비 조정)
  series = series.map(s => ({...s, cost: s.cost.map(c => _markupCost(c, s.key))}));

  _dashLastSeries = series;
  _dashLastLabels = labels;
  _dashLastDates = dates;

  // Totals
  const sum = arr => arr.reduce((a,b)=>a+b,0);
  const totalCost = sum(series.flatMap(s=>s.cost));
  const totalClick = sum(series.flatMap(s=>s.click));
  const totalImp = sum(series.flatMap(s=>s.imp));
  const totalConv = sum(series.flatMap(s=>s.conv));
  const totalRev = sum(series.flatMap(s=>s.revenue));
  // 수기 전환 데이터 반영 (주 전환지표 conv_id=1)
  const _dashManualConv = _getManualConvSum(1, fromStr, toStr);
  const effectiveTotalConv = totalConv + _dashManualConv;
  const ctr = totalImp ? totalClick/totalImp : 0;
  const cpc = totalClick ? totalCost/totalClick : 0;
  const cpa = effectiveTotalConv ? totalCost/effectiveTotalConv : 0;
  const roas = totalCost ? totalRev/totalCost : 0;
  const cvr = totalClick ? effectiveTotalConv/totalClick : 0;
  const cpm = totalImp ? totalCost/totalImp*1000 : 0;

  // 비교 기간 (API 실데이터 또는 시연 fallback)
  const dashComparing = !!window._globalComparing;
  let dashCompData = null;
  if (dashComparing) {
    let compFrom = window._globalCompFrom, compTo = window._globalCompTo;
    if (!compFrom || !compTo) {
      const ce = new Date(d1.getTime() - 86400000);
      const cs = new Date(ce.getTime() - (days-1)*86400000);
      compFrom = cs.toISOString().slice(0,10);
      compTo = ce.toISOString().slice(0,10);
    }
    let compSeries;
    if (!DEEPFLE_API.USE_MOCK) {
      try {
        const cres = await DEEPFLE_API.get(`/accounts/${currentAccount.id}/metric-data?from=${compFrom}&to=${compTo}`);
        const crows = cres.data || [];
        if (crows.length) {
          const compDays = Math.max(1, Math.round((new Date(compTo)-new Date(compFrom))/86400000)+1);
          const compDates = Array.from({length:compDays},(_,i)=>new Date(new Date(compFrom).getTime()+i*86400000));
          compSeries = _pivotMetricData(crows, compDates, series.map(s=>s.key));
        }
      } catch(e) {}
    }
    if (!compSeries || compSeries.length === 0) {
      dashCompData = null;
    } else {
      const cTC = sum(compSeries.flatMap(s=>s.cost));
      const cTCl = sum(compSeries.flatMap(s=>s.click));
      const cTI = sum(compSeries.flatMap(s=>s.imp));
      const cTCv = sum(compSeries.flatMap(s=>s.conv));
      const cTR = sum(compSeries.flatMap(s=>s.revenue));
      dashCompData = {
        cost:cTC, click:cTCl, imp:cTI, conv:cTCv, rev:cTR,
        ctr: cTI ? cTCl/cTI : 0, cpc: cTCl ? cTC/cTCl : 0,
        cpa: cTCv ? cTC/cTCv : 0, roas: cTC ? cTR/cTC : 0,
        cvr: cTCl ? cTCv/cTCl : 0, cpm: cTI ? cTC/cTI*1000 : 0,
      };
    }
  }
  function _dashCompBadge(raw, compRaw, kpiType) {
    if (compRaw===null || compRaw===undefined || !dashCompData) return '';
    const diff = raw - compRaw;
    const pct = compRaw ? (diff/compRaw*100) : 0;
    const up = diff >= 0;
    const sign = up ? '+' : '';
    let diffStr;
    if (kpiType === 'currency') diffStr = fmtW(Math.round(diff));
    else if (kpiType === 'rate' || kpiType === 'roas') diffStr = (diff*100).toFixed(2)+'%p';
    else diffStr = fmtN(Math.round(diff));
    return `<div class="mr-compare-badge ${up?'up':'down'}">vs 이전기간: ${sign}${pct.toFixed(1)}% (${sign}${diffStr})</div>`;
  }

  // KPI pool
  const pool = buildKpiPool(catalog);
  const selKeys = getDashKpiKeys();
  const kpiVals = {
    cost:{val:fmtW(totalCost),sub:`${days}일 기준`,raw:totalCost,compRaw:dashCompData?dashCompData.cost:null},
    imp:{val:fmtN(totalImp),sub:`CTR ${(ctr*100).toFixed(2)}%`,raw:totalImp,compRaw:dashCompData?dashCompData.imp:null},
    click:{val:fmtN(totalClick),sub:`CPC ${fmtW(Math.round(cpc))}`,raw:totalClick,compRaw:dashCompData?dashCompData.click:null},
    ctr:{val:(ctr*100).toFixed(2)+'%',sub:'클릭수 / 노출수',raw:ctr,compRaw:dashCompData?dashCompData.ctr:null},
    cpc:{val:fmtW(Math.round(cpc)),sub:'광고비 / 클릭수',raw:cpc,compRaw:dashCompData?dashCompData.cpc:null},
    cpm:{val:fmtW(Math.round(cpm)),sub:'광고비/노출x1000',raw:cpm,compRaw:dashCompData?dashCompData.cpm:null},
    cvr:{val:(cvr*100).toFixed(2)+'%',sub:'전환수 / 클릭수',raw:cvr,compRaw:dashCompData?dashCompData.cvr:null},
    cpa:{val:fmtW(Math.round(cpa)),sub:'광고비 / 전환수',raw:cpa,compRaw:dashCompData?dashCompData.cpa:null},
    roas:{val:(roas*100).toFixed(0)+'%',sub:'매출 / 광고비',raw:roas,compRaw:dashCompData?dashCompData.roas:null},
    __conv_primary:{val:fmtN(effectiveTotalConv),sub:`CVR ${(cvr*100).toFixed(2)}%${_dashManualConv>0?' ✎수기포함':''}`,raw:effectiveTotalConv,compRaw:dashCompData?dashCompData.conv:null},
    revenue:{val:fmtW(totalRev),sub:`CPA ${fmtW(Math.round(cpa))}`,raw:totalRev,compRaw:dashCompData?dashCompData.rev:null},
  };
  // 전역 KPI 값 저장 (알림 계산용)
  window._dashCurrentKpis = { roas, cpa, ctr, cvr, cost: totalCost };
  refreshAlertBell();

  const selectedPool = pool.filter(p=>selKeys.includes(p.key));
  const kpiCards = selectedPool.map(p=>{
    const v=kpiVals[p.key]||{val:'-',sub:'',raw:0,compRaw:null};
    const badge = dashComparing ? _dashCompBadge(v.raw, v.compRaw, p.type) : '';
    const tgtBar = _dashKpiTargetBar(p.key, v.raw);
    return `<div class="mr-kpi-card" draggable="true" data-key="${p.key}" ondragstart="onKpiDragStart(event)" ondragover="onKpiDragOver(event)" ondragenter="onKpiDragEnter(event)" ondragleave="onKpiDragLeave(event)" ondrop="onKpiDrop(event,saveDashKpiKeys,_renderDashBody)" ondragend="onKpiDragEnd(event)"><div class="drag-handle">⠿</div><div class="mr-kpi-label">${p.label}</div><div class="mr-kpi-val">${v.val}</div><div class="mr-kpi-sub">${v.sub}</div>${badge}${tgtBar}</div>`;
  }).join('');

  // 이상 감지 배너
  const _dashAlerts = _computeAlerts();
  const _alertBanner = (() => {
    if (_dashAlerts.length === 0) return '';
    const hasDanger = _dashAlerts.some(a=>a.sev==='danger');
    const cls = hasDanger ? 'danger' : 'warning';
    const icon = hasDanger ? '🔴' : '🟡';
    const top3 = _dashAlerts.slice(0,3).map(a=>`<span style="font-size:11px;background:rgba(0,0,0,.06);border-radius:4px;padding:1px 6px;margin-left:4px;">${a.label}</span>`).join('');
    const more = _dashAlerts.length > 3 ? `<span style="font-size:11px;color:inherit;margin-left:4px;">외 ${_dashAlerts.length-3}건</span>` : '';
    return `<div class="dash-alert-banner ${cls}">
      <span style="font-size:20px;flex-shrink:0;">${icon}</span>
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:700;margin-bottom:3px;">KPI 이상 감지 — ${_dashAlerts.length}건의 목표 미달/초과 항목이 있습니다</div>
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:2px;">${top3}${more}</div>
      </div>
      <button class="btn btn-xs btn-outline" style="flex-shrink:0;" onclick="toggleAlertDropdown()">상세 보기</button>
    </div>`;
  })();
  const pickerItems = pool.map(p=>{const chk=selKeys.includes(p.key)?'checked':'';return `<label class="mr-kpi-picker-item"><input type="checkbox" value="${p.key}" ${chk} onchange="onDashKpiCheckChange()">${p.label}</label>`;}).join('');

  // Table columns
  const tableCols = _mrBuildTableCols(catalog);

  // Media table rows (ON/OFF 제외)
  const _ovPixelData = _getMediaPixels();
  const mediaTableRows = MEDIA_DATA.map((m)=>{
    const displaySpend = _markupCost(m.spend, m.key||'');
    const displayCpa   = m.cvr ? Math.round(displaySpend / m.cvr) : m.cpa;
    const ctrVal = m.imp ? (m.click/m.imp*100).toFixed(2)+'%' : '-';
    const pixBadge = _ovPixelData[m.name]
      ? '<span style="font-size:9px;color:#059669;margin-left:5px;vertical-align:middle;" title="픽셀 연결됨">●</span>'
      : '<span style="font-size:9px;color:#F59E0B;margin-left:5px;vertical-align:middle;" title="픽셀 미설정">⚠</span>';
    let compBadge='';
    if(dashComparing&&dashCompData){
      const _mr=_seededRand(m.name.split('').reduce((a,c)=>a+c.charCodeAt(0),0)||1);
      const _cf=0.85+_mr()*0.30;
      const _pct=(_cf-1)*100;
      const _cls=_pct>=0?'color:var(--success)':'color:var(--danger)';
      compBadge=`<div style="font-size:10px;${_cls};margin-top:2px;">${_pct>=0?'+':''}${_pct.toFixed(1)}%</div>`;
    }
    return `<tr>
      <td><div class="media-logo"><div class="media-dot" style="background:${m.color}"></div>${m.name}${pixBadge}</div></td>
      ${USE_DAILY_BUDGET ? `<td class="text-right num">₩${(m.dailyBudget||0).toLocaleString()}</td>` : ''}
      <td class="text-right num"><div>₩${displaySpend.toLocaleString()}</div>${compBadge}</td>
      <td class="text-right num">${fmtN(m.imp)}</td>
      <td class="text-right num">${fmtN(m.click)}</td>
      <td class="text-right">${ctrVal}</td>
      <td class="text-right num">${fmtN(m.cvr)}</td>
      <td class="text-right" style="color:${m.roas>=400?'var(--success)':m.roas<300?'var(--danger)':''};">${m.roas}%</td>
      <td class="text-right num">₩${displayCpa.toLocaleString()}</td>
    </tr>`;
  }).join('');

  // 디바이스별 / 상품유형별 breakdown (series 합산 기반)
  const _totalCostAll = series.reduce((s,sv)=>s+sv.cost.reduce((a,b)=>a+b,0),0);
  const _noDataHtml = `<div style="text-align:center;padding:28px 0;color:var(--gray-400);font-size:13px;">매체를 연동하고 데이터를 수집하면 표시됩니다.</div>`;
  const _devSplits=[{k:'mobile',l:'모바일',c:'#4F46E5',r:.62},{k:'desktop',l:'PC/데스크탑',c:'#059669',r:.32},{k:'tablet',l:'태블릿',c:'#D97706',r:.06}];
  const _devBar = _totalCostAll > 0 ? (`<div style="display:flex;height:20px;border-radius:6px;overflow:hidden;background:var(--gray-100);margin:10px 0 6px;">
    ${_devSplits.map(d=>`<div style="width:${(d.r*100).toFixed(0)}%;background:${d.c};display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;" title="${d.l}">${(d.r*100).toFixed(0)}%</div>`).join('')}
  </div><div style="display:flex;gap:12px;flex-wrap:wrap;">${_devSplits.map(d=>`<span style="font-size:11px;color:var(--gray-600);display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:50%;background:${d.c};display:inline-block;"></span>${d.l} ${(d.r*100).toFixed(0)}%</span>`).join('')}</div>`) : '';
  function _compShareDelta(seedKey, r) {
    const rng=_seededRand(seedKey.split('').reduce((a,c)=>a+c.charCodeAt(0),31));
    const cr=Math.min(0.99,Math.max(0.01,r+(rng()-0.5)*0.1));
    const delta=(r-cr)*100;
    const cls=delta>=0?'color:var(--success)':'color:var(--danger)';
    return `<td class="text-right" style="font-size:11px;${cls}">${delta>=0?'+':''}${delta.toFixed(1)}%p</td>`;
  }
  const _devCompHeader = dashComparing ? '<th class="text-right" style="font-size:11px;">비중 변화</th>' : '';
  const _devRows = _totalCostAll > 0
    ? _devSplits.map(d=>`<tr><td><span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:${d.c};flex-shrink:0;"></span>${d.l}</span></td><td class="text-right num">${fmtW(Math.round(_totalCostAll*d.r))}</td><td class="text-right">${(d.r*100).toFixed(0)}%</td>${dashComparing?_compShareDelta('dev_'+d.k,d.r):''}</tr>`).join('')
    : '';
  const _prodSplits=[{k:'SEARCH',l:'검색광고',c:'#4F46E5',r:.38},{k:'DISPLAY',l:'디스플레이',c:'#059669',r:.30},{k:'PERFORMANCE_MAX',l:'PMax',c:'#D97706',r:.18},{k:'SHOPPING',l:'쇼핑',c:'#DC2626',r:.14}];
  const _prodBar = _totalCostAll > 0 ? (`<div style="display:flex;height:20px;border-radius:6px;overflow:hidden;background:var(--gray-100);margin:10px 0 6px;">
    ${_prodSplits.map(p=>`<div style="width:${(p.r*100).toFixed(0)}%;background:${p.c};display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;" title="${p.l}">${(p.r*100).toFixed(0)}%</div>`).join('')}
  </div><div style="display:flex;gap:12px;flex-wrap:wrap;">${_prodSplits.map(p=>`<span style="font-size:11px;color:var(--gray-600);display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:50%;background:${p.c};display:inline-block;"></span>${p.l} ${(p.r*100).toFixed(0)}%</span>`).join('')}</div>`) : '';
  const _prodCompHeader = dashComparing ? '<th class="text-right" style="font-size:11px;">비중 변화</th>' : '';
  const _prodRows = _totalCostAll > 0
    ? _prodSplits.map(p=>`<tr><td><span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:${p.c};flex-shrink:0;"></span>${p.l}</span></td><td class="text-right num">${fmtW(Math.round(_totalCostAll*p.r))}</td><td class="text-right">${(p.r*100).toFixed(0)}%</td>${dashComparing?_compShareDelta('prod_'+p.k,p.r):''}</tr>`).join('')
    : '';

  // Unified Insight
  _loadUnifiedInsight();
  const insightText = generateUnifiedInsight(series, labels, dates);

  // Download buttons
  const downloadBtns = `<div style="display:flex;gap:7px;flex-wrap:wrap;">
    <button class="btn btn-sm btn-outline" onclick="downloadDashExcel()">📊 엑셀</button>
    <button class="btn btn-sm btn-outline" onclick="downloadDashPDF()">📄 PDF</button>
    ${editable ? `<button class="btn btn-sm btn-primary" onclick="showShareModal()">🔗 공유 링크</button>` : ''}
  </div>`;

  body.innerHTML = `
    ${_alertBanner}
    <!-- Period info -->
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header">
        <div><div class="card-title">대시보드 요약</div><div class="card-sub">${currentAccount.name} · ${fromStr} ~ ${toStr}</div></div>
        ${downloadBtns}
      </div>
    </div>

    <!-- KPI Cards -->
    <div class="card mr-section">
      <div class="card-header">
        <div><div class="card-title">주요 KPI</div><div class="card-sub">${fromStr} ~ ${toStr}</div></div>
        <div class="mr-kpi-picker">
          <button class="btn btn-sm btn-outline" onclick="toggleDashKpiPicker()" title="KPI 카드 선택">⚙ KPI 설정</button>
          <div class="mr-kpi-picker-drop" id="dashKpiPickerDrop">${pickerItems}</div>
        </div>
      </div>
      <div class="mr-kpi-grid">${kpiCards}</div>
    </div>

    <!-- Device & Product Breakdown -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
      <div class="card mr-section">
        <div class="card-header"><div><div class="card-title">디바이스별 성과</div><div class="card-sub">기기 유형별 광고비 비중</div></div></div>
        ${_totalCostAll > 0 ? `${_devBar}<div style="overflow-x:auto;margin-top:8px;"><table class="data-table" style="width:100%;font-size:12px;"><thead><tr><th>디바이스</th><th class="text-right">광고비</th><th class="text-right">비중</th>${_devCompHeader}</tr></thead><tbody>${_devRows}</tbody></table></div>` : _noDataHtml}
      </div>
      <div class="card mr-section">
        <div class="card-header"><div><div class="card-title">상품유형별 성과</div><div class="card-sub">캠페인 유형별 광고비 비중</div></div></div>
        ${_totalCostAll > 0 ? `${_prodBar}<div style="overflow-x:auto;margin-top:8px;"><table class="data-table" style="width:100%;font-size:12px;"><thead><tr><th>상품유형</th><th class="text-right">광고비</th><th class="text-right">비중</th>${_prodCompHeader}</tr></thead><tbody>${_prodRows}</tbody></table></div>` : _noDataHtml}
      </div>
    </div>

    <!-- Media Table -->
    <div class="card mr-section">
      <div class="card-header">
        <div class="card-title">매체별 성과 현황</div>
        <div style="display:flex;gap:7px;">
          <button class="btn btn-sm" style="background:var(--gray-100);color:var(--gray-600);" onclick="refreshMediaData()">🔄 새로고침</button>
          ${editable && DEEPFLE_API.live ? `<button class="btn btn-sm" style="background:var(--gray-100);color:var(--gray-600);" onclick="syncAllConnectors()">⟳ 전체 매체 동기화</button>` : ''}
        </div>
      </div>
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th>매체</th>
              ${USE_DAILY_BUDGET ? '<th class="text-right">일일 소진한도</th>' : ''}
              <th class="text-right">광고비</th><th class="text-right">노출수</th>
              <th class="text-right">클릭수</th><th class="text-right">CTR</th>
              <th class="text-right">전환수</th><th class="text-right">ROAS</th>
              <th class="text-right">CPA</th>
            </tr>
          </thead>
          <tbody>${mediaTableRows}${(()=>{
            const onMedia=MEDIA_DATA.filter(m=>m.on);
            const tSpend=onMedia.reduce((s,m)=>s+_markupCost(m.spend,m.key||''),0);
            const tImp=onMedia.reduce((s,m)=>s+m.imp,0);
            const tClick=onMedia.reduce((s,m)=>s+m.click,0);
            const tConv=onMedia.reduce((s,m)=>s+m.cvr,0);
            const tCtr=tImp?(tClick/tImp*100).toFixed(2)+'%':'-';
            const tRoas=tSpend?(totalRev/tSpend*100).toFixed(0)+'%':'-';
            const tCpa=tConv?'₩'+Math.round(tSpend/tConv).toLocaleString():'-';
            return `<tr style="font-weight:700;background:var(--gray-50);border-top:2px solid var(--gray-200);">
              <td>합계</td>
              ${USE_DAILY_BUDGET?'<td></td>':''}
              <td class="text-right num">₩${tSpend.toLocaleString()}</td>
              <td class="text-right num">${fmtN(tImp)}</td>
              <td class="text-right num">${fmtN(tClick)}</td>
              <td class="text-right">${tCtr}</td>
              <td class="text-right num">${fmtN(tConv)}</td>
              <td class="text-right">${tRoas}</td>
              <td class="text-right num">${tCpa}</td>
            </tr>`;
          })()}</tbody>
        </table>
      </div>
    </div>

    <!-- Insights -->
    ${(()=>{
      const _isComp = dashComparing && dashCompData;
      const compFrom = window._globalCompFrom||'이전 기간';
      const compTo = window._globalCompTo||'';
      let lines=[];
      if (_isComp) {
        // 기간 비교 인사이트: 매체별 변화
        const costDiff=totalCost-dashCompData.cost, costPct=dashCompData.cost?(costDiff/dashCompData.cost*100):0;
        const rndM=_seededRand(77);
        lines.push(`<b>[효율변화]</b> 비교기간 대비 전체 광고비 ${costPct>=0?'+':''}${costPct.toFixed(1)}% 변동, ROAS ${((roas-dashCompData.roas)*100).toFixed(0)}%p 변화.`);
        lines.push(`<b>[인사이트]</b> ${MEDIA_DATA.filter(m=>m.on).slice(0,2).map(m=>`${m.name} ${rndM()>0.5?'성과 개선':'효율 감소'}`).join(', ')} 관측됨.`);
        lines.push(`<b>[제안]</b> 성과가 개선된 매체 예산 증액 및 효율 저하 매체 집행 전략 재검토를 권장합니다.`);
      } else {
        // 전일 대비 인사이트
        const _yCost=series.reduce((s,sv)=>s+(sv.cost[sv.cost.length-2]||0),0);
        const _tCost=series.reduce((s,sv)=>s+(sv.cost[sv.cost.length-1]||0),0);
        const _diff=_yCost?(_tCost-_yCost)/_yCost*100:0;
        lines.push(`<b>[효율변화]</b> 전일 대비 광고비 ${_diff>=0?'+':''}${_diff.toFixed(1)}%, ROAS ${roas>=dashCompData?.roas||roas>=1?'개선':'하락'} 추세.`);
        lines.push(`<b>[인사이트]</b> ${totalCost>0?`총 광고비 ${fmtW(totalCost)} 집행, CPA ${fmtW(Math.round(cpa))}로 목표 대비 효율을 검토할 필요 있음.`:' 집행 데이터가 없습니다.'}`);
        lines.push(`<b>[제안]</b> 고효율 매체 예산을 확대하고, CTR 및 CVR 개선을 위한 소재 A/B 테스트를 권장합니다.`);
      }
      const insightHtml = lines.map(l=>`<p style="margin:0 0 8px;">${l}</p>`).join('');
      window._dashInsightCopyText = lines.map(l=>l.replace(/<[^>]+>/g,'')).join('\n');
      return `<div class="card mr-section">
        <div class="card-header">
          <div><div class="card-title">인사이트</div><div class="card-sub">${_isComp?`비교기간(${compFrom}${compTo?' ~ '+compTo:''}) 대비 매체별 변화`:'전일 대비 성과 분석'}</div></div>
          <button class="btn btn-sm btn-outline" onclick="_copyDashInsight()">복사</button>
        </div>
        <div style="font-size:13px;line-height:1.7;color:var(--gray-700);margin-top:8px;">${insightHtml}</div>
      </div>`;
    })()}
  `;
}

function _copyDashInsight() {
  const t = window._dashInsightCopyText || '';
  navigator.clipboard.writeText(t)
    .then(() => showToast('클립보드에 복사되었습니다', 'success'))
    .catch(() => showToast('복사 실패', 'error'));
}

function refreshMediaData() {
  MEDIA_DATA.forEach(m => {
    if (m.on) {
      m.spend = Math.max(0, Math.round(m.spend * (0.97 + Math.random() * 0.06)));
      m.imp = Math.max(0, Math.round(m.imp * (0.97 + Math.random() * 0.06)));
      m.click = Math.max(0, Math.round(m.click * (0.97 + Math.random() * 0.06)));
      m.cvr = Math.max(0, Math.round(m.cvr * (0.97 + Math.random() * 0.06)));
      m.roas = Math.max(0, Math.round(m.roas * (0.97 + Math.random() * 0.06)));
      m.cpa = Math.max(0, Math.round(m.cpa * (0.97 + Math.random() * 0.06)));
    }
  });
  _renderDashBody();
  showToast('매체 데이터가 새로고침 되었습니다', 'success');
}


function toggleDashKpiPicker() {
  const d = document.getElementById('dashKpiPickerDrop');
  if (!d) return;
  const opening = !d.classList.contains('open');
  d.classList.toggle('open');
  if (opening) {
    setTimeout(()=>{
      const closer = e=>{ if (!d.contains(e.target) && !e.target.closest('.mr-kpi-picker')) { d.classList.remove('open'); document.removeEventListener('click',closer); }};
      document.addEventListener('click',closer);
    },10);
  }
}

function onDashKpiCheckChange() {
  const d = document.getElementById('dashKpiPickerDrop');
  if (!d) return;
  const keys = [...d.querySelectorAll('input:checked')].map(i=>i.value);
  if (!keys.length) { showToast('최소 1개 KPI를 선택하세요','warning'); return; }
  saveDashKpiKeys(keys);
  _renderDashBody();
}

function downloadDashExcel() { showToast('엑셀 다운로드 준비 중…','info'); }
function downloadDashPDF() { showToast('PDF 다운로드 준비 중…','info'); }
function downloadMrExcel() {
  if (!_mrLastSeries || !_mrLastLabels) { showToast('먼저 조회해 주세요','warning'); return; }
  const BOM = '﻿';
  const header = ['날짜','매체','광고비','노출수','클릭수','CTR','전환수','매출','CVR','CPA','ROAS'];
  const rows = [header.join(',')];
  _mrLastDates.forEach((dt,i)=>{
    const ds = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    _mrLastSeries.forEach(s=>{
      const imp = s.imp[i], cl = s.click[i], cost = s.cost[i], cv = s.conv[i], rv = s.revenue[i];
      rows.push([ds, s.label, cost, imp, cl, imp?(cl/imp*100).toFixed(2)+'%':'-', cv, rv,
        cl?(cv/cl*100).toFixed(2)+'%':'-', cv?Math.round(cost/cv):'-', cost?Math.round(rv/cost*100)+'%':'-'].join(','));
    });
  });
  const blob = new Blob([BOM+rows.join('\n')], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `미디어리포팅_${window._globalFrom||'export'}.csv`; a.click();
  showToast('엑셀(CSV) 다운로드 완료','success');
}
function downloadMrPDF() {
  const el = document.getElementById('mrResult');
  if (!el) { showToast('먼저 조회해 주세요','warning'); return; }
  const style = document.createElement('style');
  style.textContent = '@media print { body * { visibility:hidden; } #mrResult, #mrResult * { visibility:visible; } #mrResult { position:absolute; left:0; top:0; width:100%; } }';
  document.head.appendChild(style);
  window.print();
  setTimeout(()=>style.remove(), 500);
  showToast('PDF 인쇄 대화상자를 확인하세요','info');
}

// mock 모드 미디어 ON/OFF 상태를 localStorage에 저장 (계정별)
function _getMediaOnOff() { return JSON.parse(localStorage.getItem(_accKey('deepfle_media_onoff'))||'{}'); }
function _saveMediaOnOff(d) { localStorage.setItem(_accKey('deepfle_media_onoff'), JSON.stringify(d)); }
function _applyMediaOnOff() {
  const saved = _getMediaOnOff();
  MEDIA_DATA.forEach(m => { if (m.name in saved) m.on = saved[m.name]; });
}

async function toggleMedia(idx, el) {
  const m = MEDIA_DATA[idx];
  const newOn = !m.on;
  if (DEEPFLE_API.live && m.id != null) {
    try {
      await DEEPFLE_API.patch(`/media/${m.id}`, {is_on: newOn});
    } catch(e) {
      showToast(`변경 실패: ${e.message}`, e.status===403?'error':'warning');
      return;
    }
  } else if (!DEEPFLE_API.live) {
    // mock 모드: localStorage에 저장해 새로고침 후에도 유지
    const d = _getMediaOnOff(); d[m.name] = newOn; _saveMediaOnOff(d);
  }
  m.on = newOn;
  el.classList.toggle('on');
  activities.unshift({user:currentUser.name,avatar:currentUser.avatar,avatarColor:currentUser.avatarColor,time:'방금 전',role:currentUser.role,
    text:`${m.name} ${m.on?'활성화':'비활성화'}`,diff:null});
  showToast(`${m.name} ${m.on?'활성화':'비활성화'}되었습니다`,'success');
  _renderDashBody();
  // 미디어리포트 매체 목록 자동 갱신
  if (document.getElementById('panel-media-report')?.classList.contains('active')) renderMediaReport();
}


// ============================================================
// ACCOUNTS (MASTER ONLY)
// ============================================================
async function renderAccounts() {
  if (DEEPFLE_API.live && currentUser?.role === 'master') {
    try {
      const res = await DEEPFLE_API.get('/users');
      BACKEND_USERS = res.users || [];
    } catch(e) { BACKEND_USERS = []; }
    // 워크스페이스 전체 광고계정 fetch → 계정별 연동 매체 캐시
    if (currentWorkspace) {
      try {
        const aaRes = await DEEPFLE_API.get(`/workspaces/${currentWorkspace.id}/ad-accounts`);
        BACKEND_ACCOUNT_MEDIA = {};
        (aaRes.adAccounts || []).forEach(aa => {
          if (!aa.account_id) return;
          if (!BACKEND_ACCOUNT_MEDIA[aa.account_id]) BACKEND_ACCOUNT_MEDIA[aa.account_id] = [];
          if (aa.media && aa.status !== 'disconnected') {
            if (!BACKEND_ACCOUNT_MEDIA[aa.account_id].includes(aa.media))
              BACKEND_ACCOUNT_MEDIA[aa.account_id].push(aa.media);
          }
        });
      } catch(e) { /* 폴백: 빈 캐시 유지 */ }
    }
  }
  renderAccountGrid();
  renderUserTable();
}

function renderAccountGrid() {
  const list = DEEPFLE_API.live
    ? BACKEND_ACCOUNTS
    : ACCOUNTS.filter(a=>a.users?.includes(currentUser?.id));
  const grid = document.getElementById('accountGrid');
  if (!list.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px 20px;color:var(--gray-400);font-size:13px;">
      등록된 광고주 계정이 없습니다.<br>
      <button class="btn btn-sm btn-primary" style="margin-top:12px;" onclick="showAddAccountWizard()">+ 계정 추가</button>
    </div>`;
    return;
  }
  const usersList = DEEPFLE_API.live ? BACKEND_USERS : ALL_PLATFORM_USERS;
  const MEDIA_COLOR_MAP = {
    meta:'#1877F2', google:'#4285F4', kakao:'#FFE300', naver_sa:'#03C75A',
    tiktok:'#010101', naver_gfa:'#00C73C', youtube:'#FF0000', kakao_biz:'#F7E600',
    naver_shopping:'#00C73C', karrot:'#FF7A1A', taboola:'#1F96DA', dable:'#FF6600',
    coupang:'#ED1C24', mobion:'#6236FF', moloco:'#0052CC', kakao_sa:'#3A1D96',
    buzzvil:'#FF4081', inmobi:'#E91E63',
  };
  const MEDIA_LABEL_SHORT = {
    meta:'Meta', google:'Google', kakao:'카카오', naver_sa:'네이버SA',
    tiktok:'TikTok', naver_gfa:'네이버GFA', youtube:'YouTube', kakao_biz:'카카오BZ',
    naver_shopping:'네이버쇼핑', karrot:'당근', taboola:'Taboola', dable:'데이블',
    coupang:'쿠팡', mobion:'모비온', moloco:'Moloco', kakao_sa:'카카오SA',
    buzzvil:'버즈빌', inmobi:'InMobi',
  };
  grid.innerHTML = list.map(a=>{
    const members = usersList.filter(u=>(u.accounts||[]).includes(a.id));
    const avatars = members.slice(0,5).map(u=>
      `<div title="${u.name}" class="mini-avatar" style="background:${u.avatarColor||'#94A3B8'};flex-shrink:0;">${(u.name||'?')[0]}</div>`
    ).join('');
    const extraMembers = members.length > 5 ? `<span style="font-size:11px;color:var(--gray-400);margin-left:4px;">+${members.length-5}</span>` : '';
    const noMembers = members.length === 0
      ? `<span style="font-size:11px;color:var(--gray-300);">담당자 없음</span>` : '';

    // 연동 매체 뱃지
    const mediaKeys = DEEPFLE_API.live
      ? (BACKEND_ACCOUNT_MEDIA[a.id] || [])
      : (MEDIA_DATA.filter(m=>m.on).map(m=>m.key));
    const mediaBadges = mediaKeys.slice(0,6).map(k=>
      `<span title="${MEDIA_LABEL_SHORT[k]||k}" style="display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:600;background:${MEDIA_COLOR_MAP[k]||'#64748B'}1A;color:${MEDIA_COLOR_MAP[k]||'#64748B'};border:1px solid ${MEDIA_COLOR_MAP[k]||'#64748B'}33;white-space:nowrap;">
        <span style="width:6px;height:6px;border-radius:50%;background:${MEDIA_COLOR_MAP[k]||'#64748B'};flex-shrink:0;"></span>${MEDIA_LABEL_SHORT[k]||k}
      </span>`
    ).join('');
    const extraMedia = mediaKeys.length > 6
      ? `<span style="font-size:10px;color:var(--gray-400);">+${mediaKeys.length-6}</span>` : '';
    const noMedia = mediaKeys.length === 0
      ? `<span style="font-size:11px;color:var(--gray-300);">연동된 매체 없음</span>` : '';

    const isSelected = currentAccount?.id === a.id;
    const safeAccId = (a.id||'').replace(/'/g,"\\'");
    const safeAccName = (a.name||'').replace(/'/g,"\\'");
    const isMaster = currentUser?.role === 'master';
    return `<div class="account-card ${isSelected?'selected':''}" onclick="openAccountEditModal('${safeAccId}')">
      <div class="acc-header">
        <div>
          <div class="acc-name">${a.name}</div>
          <div class="acc-id">${a.advertiser||''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <div style="width:10px;height:10px;border-radius:50%;background:${a.color||'#4F46E5'};"></div>
          ${isMaster ? `<button onclick="event.stopPropagation();deleteAccount('${safeAccId}','${safeAccName}')" title="계정 삭제" style="width:22px;height:22px;border-radius:50%;border:1.5px solid #FCA5A5;background:#FEF2F2;color:#EF4444;font-size:13px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:inherit;">✕</button>` : ''}
        </div>
      </div>
      <div style="margin-top:10px;">
        <div style="font-size:10px;font-weight:600;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">연동 매체</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;min-height:22px;">${mediaBadges}${extraMedia}${noMedia}</div>
      </div>
      <div style="margin-top:10px;">
        <div style="font-size:10px;font-weight:600;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">담당자 <span style="font-weight:400;color:var(--gray-300);">${members.length}명</span></div>
        <div style="display:flex;align-items:center;gap:4px;min-height:24px;">${avatars}${extraMembers}${noMembers}</div>
      </div>
    </div>`;
  }).join('');
}

function openAccountEditModal(accId) {
  const a = BACKEND_ACCOUNTS.find(x=>x.id===accId) || ACCOUNTS.find(x=>x.id===accId);
  if (!a) return;
  let meta = {};
  try { meta = JSON.parse(localStorage.getItem('deepfle_acct_meta_'+accId)||'{}'); } catch(e) {}
  _wizData = {
    name: a.name||'', corp: meta.corp||a.advertiser||'', brand: meta.brand||'',
    industry: meta.industry||'', category: meta.category||'',
    managerId: currentUser?.email||'', managerName: currentUser?.name||'',
    memo: meta.memo||'', mediaLinks:[], conversions:[], members:[]
  };
  document.getElementById('modal-accountEdit').dataset.accId = accId;
  const body = document.getElementById('acctEditBody');
  if (body) body.innerHTML = _wizBodyStep1();
  const isSelected = currentAccount?.id === accId;
  const switchBtn = document.getElementById('acctEditSwitchBtn');
  if (switchBtn) {
    switchBtn.textContent = isSelected ? '현재 선택된 계정' : '이 계정으로 전환';
    switchBtn.disabled = isSelected;
  }
  const deleteBtn = document.getElementById('acctEditDeleteBtn');
  if (deleteBtn) deleteBtn.style.display = currentUser?.role === 'master' ? '' : 'none';
  showModal('accountEdit');
}

function acctEditDeleteNow() {
  const modal = document.getElementById('modal-accountEdit');
  const accId = modal?.dataset.accId;
  const a = BACKEND_ACCOUNTS.find(x=>x.id===accId) || ACCOUNTS.find(x=>x.id===accId);
  if (!a) return;
  deleteAccount(accId, a.name);
}

function acctEditSwitchNow() {
  const accId = document.getElementById('modal-accountEdit')?.dataset.accId;
  if (accId) { closeModal('accountEdit'); switchAccount(accId); }
}

async function saveAccountEdit() {
  const modal = document.getElementById('modal-accountEdit');
  const accId = modal?.dataset.accId;
  if (!accId) return;
  const name     = document.getElementById('w1name')?.value.trim()||'';
  const corp     = document.getElementById('w1corp')?.value.trim()||'';
  const brand    = document.getElementById('w1brand')?.value.trim()||'';
  const industry = document.getElementById('w1industry')?.value||'';
  const category = document.getElementById('w1category')?.value||'';
  const memo     = document.getElementById('w1memo')?.value.trim()||'';
  if (!name) { showToast('계정명을 입력해주세요','warning'); return; }
  localStorage.setItem('deepfle_acct_meta_'+accId, JSON.stringify({corp,brand,industry,category,memo}));
  const aLocal   = ACCOUNTS.find(x=>x.id===accId);
  if (aLocal) { aLocal.name=name; aLocal.advertiser=corp||brand||''; }
  const aBackend = BACKEND_ACCOUNTS.find(x=>x.id===accId);
  if (aBackend) { aBackend.name=name; aBackend.advertiser=corp||brand||''; }
  if (currentAccount?.id===accId) {
    currentAccount.name=name; currentAccount.advertiser=corp||brand||'';
    const sbEl=document.getElementById('sbAccountName'); if(sbEl) sbEl.textContent=name;
  }
  if (DEEPFLE_API.live) {
    try {
      await DEEPFLE_API.patch(`/accounts/${accId}`, {name, advertiser: corp||brand||''});
      showToast(`"${name}" 정보가 수정됐습니다`,'success');
    } catch(e) { showToast(`저장됐습니다 (백엔드 반영 실패: ${e.message})`,'warning'); }
  } else {
    showToast(`"${name}" 정보가 수정됐습니다`,'success');
  }
  renderAccountGrid();
  closeModal('accountEdit');
}

async function deleteAccount(accId, accName) {
  if (!confirm(`"${accName}" 계정을 삭제하시겠습니까?\n\n이 계정과 관련된 모든 설정 데이터가 삭제됩니다.`)) return;

  // 백엔드 API 호출 (live 모드면 반드시 성공해야 진행)
  if (DEEPFLE_API.live) {
    try { await DEEPFLE_API.del(`/accounts/${accId}`); }
    catch(e) {
      const hint = e.status === 404 ? '\n(백엔드 서버를 재시작 후 다시 시도하세요)' : '';
      showToast(`삭제 실패: ${e.message}${hint}`, 'error');
      return;
    }
  }

  // 인메모리 배열에서 제거
  const lIdx = ACCOUNTS.findIndex(x => x.id === accId);
  if (lIdx >= 0) ACCOUNTS.splice(lIdx, 1);
  const bIdx = BACKEND_ACCOUNTS.findIndex(x => x.id === accId);
  if (bIdx >= 0) BACKEND_ACCOUNTS.splice(bIdx, 1);

  // localStorage에서 이 계정 관련 키 전부 제거
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.includes(accId)) toRemove.push(k);
  }
  toRemove.forEach(k => localStorage.removeItem(k));

  // 현재 선택 계정이면 다른 계정으로 전환
  if (currentAccount?.id === accId) {
    const next = (BACKEND_ACCOUNTS[0] || ACCOUNTS[0]) || null;
    currentAccount = next;
    if (next) {
      document.getElementById('sbAccountName').textContent = next.name;
      applyWhitelabel(next);
      _loadAccountSettings();
    }
  }

  showToast(`"${accName}" 계정이 삭제됐습니다`, 'success');
  closeModal('accountEdit');
  renderAccountGrid();
}

function switchAccount(accId) {
  currentAccount = (BACKEND_ACCOUNTS.find(a=>a.id===accId) || ACCOUNTS.find(a=>a.id===accId));
  document.getElementById('sbAccountName').textContent = currentAccount.name;
  applyWhitelabel(currentAccount);            // Phase 9: 계정별 브랜딩
  _loadAccountSettings();                     // 계정별 설정(KPI·마크업·일일예산) 재로드
  loadMemos();                                // 계정별 메모 재로드
  // 백엔드 모드면 해당 계정 매체 재로드
  if (DEEPFLE_API.live) { loadBackendMedia(accId).then(()=>{ if(document.getElementById('panel-overview').classList.contains('active')) renderOverview(); }); }
  // 현재 열려있는 계정별 패널 갱신
  if (document.getElementById('panel-optimization').classList.contains('active')) renderOptimization();
  if (document.getElementById('panel-settings').classList.contains('active')) renderSettings();
  if (document.getElementById('panel-media-report')?.classList.contains('active')) renderMediaReport();
  showToast(`"${currentAccount.name}" 계정으로 전환했습니다`,'success');
  renderAccountGrid();
}

// Phase 9: 화이트라벨 — 계정 색상을 브랜드 액센트로 적용
function applyWhitelabel(account) {
  const color = account?.color || '#4F46E5';
  document.documentElement.style.setProperty('--brand-accent', color);
  const strip = document.getElementById('sbAccountStrip');
  if (strip) strip.style.borderLeft = `3px solid ${color}`;
  const dot = document.getElementById('sbBrandDot');
  if (dot) dot.style.background = color;
}

function renderUserTable() {
  const users = DEEPFLE_API.live ? BACKEND_USERS : ALL_PLATFORM_USERS;
  const accList = DEEPFLE_API.live ? BACKEND_ACCOUNTS : ACCOUNTS;
  document.getElementById('userCountLabel').textContent = `총 ${users.length}명`;
  if (!users.length) {
    document.getElementById('userTable').innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--gray-400);font-size:13px;">초대된 사용자가 없습니다.</td></tr>`;
    return;
  }
  document.getElementById('userTable').innerHTML = users.map(u=>{
    const meta = ROLE_META[u.role] || ROLE_META['user'];
    const accs = (u.accounts||[]).map(id=>accList.find(a=>a.id===id)?.name||id);
    const isSelf = u.id === currentUser?.id;
    const safeId = (u.id||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const safeName = (u.name||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const actionCell = isSelf
      ? `<span class="badge badge-gray" style="font-size:10px;">본인</span>`
      : `<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
          <select class="user-role-select" style="height:26px;font-size:11px;padding:0 4px;" onchange="changeUserRole('${safeId}',this.value)">
            <option value="master" ${u.role==='master'?'selected':''}>마스터</option>
            <option value="user" ${u.role==='user'?'selected':''}>사용자</option>
            <option value="advertiser" ${u.role==='advertiser'?'selected':''}>광고주</option>
          </select>
          <button class="btn btn-xs btn-outline" onclick="openAssignModal('${safeId}','${safeName}')">계정 배정</button>
          <button class="btn btn-xs btn-danger-outline" onclick="removeUser('${safeId}')">삭제</button>
        </div>`;
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:8px;">
        <div class="act-avatar" style="background:${u.avatarColor||'#94A3B8'};width:28px;height:28px;font-size:11px;">${(u.name||'?')[0]}</div>
        <span style="font-weight:600;font-size:13px;">${u.name}</span>
      </div></td>
      <td style="color:var(--gray-600);font-size:12px;">${u.email}</td>
      <td><span class="badge ${meta.badgeClass}">${meta.icon} ${meta.label}</span></td>
      <td style="font-size:11px;color:var(--gray-600);">${accs.slice(0,2).join(', ')}${accs.length>2?` +${accs.length-2}`:''}</td>
      <td style="font-size:12px;color:var(--gray-400);">${u.lastLogin||'-'}</td>
      <td>${actionCell}</td>
    </tr>`;
  }).join('');
}

function _onAssignRoleChange() {
  const role = document.getElementById('assignRoleSelect')?.value;
  const grp = document.getElementById('assignAccountsGroup');
  if (grp) grp.style.display = role === 'master' ? 'none' : '';
}

async function changeUserRole(uid, newRole) {
  const list = DEEPFLE_API.live ? BACKEND_USERS : ALL_PLATFORM_USERS;
  const u = list.find(x=>x.id===uid);
  if (!u) return;
  if (newRole === 'master' && !confirm(`${u.name}를 마스터로 승격하시겠습니까?\n마스터는 모든 계정과 설정에 접근할 수 있습니다.`)) {
    renderUserTable(); return;
  }
  if (DEEPFLE_API.live) {
    try {
      await DEEPFLE_API.request('PUT', `/admin/users/${uid}/role`, {role: newRole});
    } catch(e) { showToast(`역할 변경 실패: ${e.message}`, 'error'); renderAccounts(); return; }
  }
  u.role = newRole;
  showToast(`${u.name}의 역할이 ${(ROLE_META[newRole]||ROLE_META['user']).label}로 변경됐습니다`, 'success');
  renderAccounts();
}

async function removeUser(uid) {
  const list = DEEPFLE_API.live ? BACKEND_USERS : ALL_PLATFORM_USERS;
  const u = list.find(x=>x.id===uid);
  if (!u) return;
  if (!confirm(`${u.name}(${u.email}) 사용자를 삭제하시겠습니까?`)) return;
  if (DEEPFLE_API.live) {
    try {
      await DEEPFLE_API.request('DELETE', `/admin/users/${uid}`, null);
    } catch(e) { showToast(`삭제 실패: ${e.message}`, 'error'); return; }
  }
  list.splice(list.indexOf(u), 1);
  showToast(`${u.name} 사용자가 삭제됐습니다`, 'success');
  renderAccounts();
}

// ============================================================
// 계정 추가 위자드 (5-Step)
// ============================================================
const WIZ_INDUSTRIES = ['이커머스·유통','패션·의류','뷰티·화장품','식품·음료','교육·e러닝','금융·보험','건강·의료','IT·소프트웨어','자동차·모빌리티','부동산·인테리어','여행·숙박','게임·엔터테인먼트','기타'];
const WIZ_CATEGORIES = ['B2C 브랜드','B2C 퍼포먼스','B2B','앱·게임','리드 제너레이션','기타'];
const WIZ_STEPS_LABEL = ['기본 정보','매체 연동','전환지표','팀 멤버','완료'];
const WIZ_TOTAL = 5;

// 위저드 Step2 전용 — 계정별 MEDIA_DATA와 무관한 전체 매체 카탈로그
const _WIZ_ALL_MEDIA = [
  {key:'kakao',          name:'카카오모먼트',    color:'#FFE300'},
  {key:'naver_sa',       name:'네이버 검색광고',   color:'#03C75A'},
  {key:'naver_gfa',      name:'네이버 성과형(GFA)',color:'#00C73C'},
  {key:'google',         name:'구글 Ads',          color:'#4285F4'},
  {key:'meta',           name:'메타(페이스북)',  color:'#1877F2'},
  {key:'kakao_biz',      name:'카카오 비즈보드', color:'#F7E600'},
  {key:'naver_shopping', name:'네이버 쇼핑',     color:'#00C73C'},
  {key:'tiktok',         name:'틱톡',            color:'#000'},
  {key:'youtube',        name:'유튜브',          color:'#FF0000'},
  {key:'karrot',         name:'당근마켓',        color:'#FF7E36'},
  {key:'taboola',        name:'타부울라',        color:'#006EB5'},
  {key:'dable',          name:'데이블',          color:'#00B8A9'},
  {key:'coupang',        name:'쿠팡광고',        color:'#E9222B'},
  {key:'moloco',         name:'몰로코',          color:'#5B21B6'},
  {key:'kakao_sa',       name:'카카오 키워드광고',color:'#3A1D96'},
];
let _wizStep = 1;
let _wizData = {};

function showAddAccountWizard() {
  _wizStep = 1;
  _wizData = {
    name:'', corp:'', brand:'', industry:'', category:'',
    managerId: currentUser?.email || '',
    managerName: currentUser?.name || '',
    memo:'', mediaLinks:[], conversions:[], members:[]
  };
  _renderWizStep();
  showModal('addAccountWizard');
}

function _renderWizStep() {
  // 진행 바
  const bar = document.getElementById('wizProgressBar');
  if (bar) bar.innerHTML = WIZ_STEPS_LABEL.map((s,i)=>{
    const n=i+1, done=n<_wizStep, active=n===_wizStep;
    const bg=done?'var(--success)':active?'var(--primary)':'var(--gray-200)';
    const tc=(done||active)?'#fff':'var(--gray-500)';
    return `<div style="flex:1;text-align:center;padding:7px 4px;background:${bg};color:${tc};font-size:10px;">
      <div style="font-weight:700;font-size:11px;line-height:1.2;">${done?'✓':n}</div>
      <div style="margin-top:1px;font-size:9px;white-space:nowrap;overflow:hidden;">${s}</div>
    </div>`;
  }).join('');

  // 라벨·버튼
  const lbl=document.getElementById('wizStepLabel');
  if(lbl) lbl.textContent=`Step ${_wizStep} / ${WIZ_TOTAL} — ${WIZ_STEPS_LABEL[_wizStep-1]}`;
  const prev=document.getElementById('wizPrevBtn');
  const next=document.getElementById('wizNextBtn');
  if(prev) prev.style.display=_wizStep===1?'none':'';
  if(next) { next.style.display=_wizStep===WIZ_TOTAL?'none':''; next.textContent='다음 →'; }

  // 본문
  const body=document.getElementById('wizBody');
  if(!body) return;
  if(_wizStep===1) body.innerHTML=_wizBodyStep1();
  else if(_wizStep===2) body.innerHTML=_wizBodyStep2();
  else if(_wizStep===3) body.innerHTML=_wizBodyStep3();
  else if(_wizStep===4) body.innerHTML=_wizBodyStep4();
  else body.innerHTML=_wizBodyStep5();
}

function _wizBodyStep1() {
  const iOpts=WIZ_INDUSTRIES.map(o=>`<option value="${o}" ${_wizData.industry===o?'selected':''}>${o}</option>`).join('');
  const cOpts=WIZ_CATEGORIES.map(o=>`<option value="${o}" ${_wizData.category===o?'selected':''}>${o}</option>`).join('');
  return `<div style="display:flex;flex-direction:column;gap:12px;">
    <div style="display:flex;gap:10px;">
      <div style="flex:1;">
        <label class="form-label">계정명 <span style="color:var(--danger)">*</span></label>
        <input class="form-input" id="w1name" value="${_wizData.name}" placeholder="예) 아토모스 2026 Q3">
      </div>
      <div style="flex:1;">
        <label class="form-label">브랜드명 <span style="color:var(--danger)">*</span></label>
        <input class="form-input" id="w1brand" value="${_wizData.brand}" placeholder="예) ATOMOS">
      </div>
    </div>
    <div>
      <label class="form-label">법인명 <span style="color:var(--danger)">*</span></label>
      <input class="form-input" id="w1corp" value="${_wizData.corp}" placeholder="예) (주)아토모스">
    </div>
    <div style="display:flex;gap:10px;">
      <div style="flex:1;">
        <label class="form-label">업종 <span style="color:var(--danger)">*</span></label>
        <select class="form-select" id="w1industry">
          <option value="">선택하세요</option>${iOpts}
        </select>
      </div>
      <div style="flex:1;">
        <label class="form-label">카테고리 <span style="color:var(--danger)">*</span></label>
        <select class="form-select" id="w1category">
          <option value="">선택하세요</option>${cOpts}
        </select>
      </div>
    </div>
    <div>
      <label class="form-label">등록 담당자 <span style="font-size:10px;color:var(--gray-400);font-weight:400;">(자동 기입)</span></label>
      <div style="display:flex;gap:8px;">
        <input class="form-input" readonly value="${_wizData.managerId}" style="flex:2;background:var(--gray-50);color:var(--gray-500);">
        <input class="form-input" readonly value="${_wizData.managerName}" style="flex:1;background:var(--gray-50);color:var(--gray-500);">
      </div>
      <div style="font-size:10px;color:var(--gray-400);margin-top:3px;">현재 로그인된 계정 ID · 실명이 자동으로 기입됩니다.</div>
    </div>
    <div>
      <label class="form-label">담당자 메모 <span style="font-size:10px;color:var(--gray-400);font-weight:400;">(선택)</span></label>
      <textarea class="form-textarea" id="w1memo" rows="3"
        placeholder="예) 마크업율 15% 적용 / 주요 KPI: ROAS 300% 이상 / 광고주 요청: 경쟁사 노출 키워드 제외">${_wizData.memo}</textarea>
    </div>
  </div>`;
}

function _wizBodyStep2() {
  return `<div>
    <div style="font-size:12px;color:var(--gray-500);margin-bottom:12px;">연동할 매체를 선택하고 <b>광고계정 ID</b>와 <b>픽셀 ID</b>를 입력하세요.</div>
    <div style="display:flex;flex-direction:column;gap:8px;max-height:360px;overflow-y:auto;">
      ${_WIZ_ALL_MEDIA.map(m=>{
        const ex=_wizData.mediaLinks.find(l=>l.mediaName===m.name);
        const chk=!!ex, key=m.name.replace(/[\s()]/g,'_');
        const pcfg=MEDIA_PIXEL_CONFIG[m.name]||{label:'픽셀 ID',placeholder:'픽셀 ID 입력',hint:'매체 광고관리자에서 확인'};
        return `<div style="border:1px solid ${chk?'var(--primary)':'var(--gray-200)'};border-radius:8px;padding:10px 12px;transition:.15s;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="wiz2c_${key}" ${chk?'checked':''}
              onchange="toggleWizMedia('${m.name}',this.checked)" style="width:14px;height:14px;cursor:pointer;">
            <div style="width:9px;height:9px;border-radius:50%;background:${m.color};flex-shrink:0;"></div>
            <span style="font-size:13px;font-weight:600;">${m.name}</span>
          </label>
          <div id="wiz2a_${key}" style="margin-top:10px;padding-left:22px;display:flex;flex-direction:column;gap:8px;${chk?'':'display:none;'}">
            <div>
              <div style="font-size:10px;color:var(--gray-500);font-weight:600;margin-bottom:3px;">광고계정 ID <span style="color:var(--danger);">*</span></div>
              <input class="form-input" style="height:28px;font-size:12px;" placeholder="예: act_123456789"
                id="wiz2i_${key}" value="${ex?.accountId||''}"
                oninput="updateWizMediaId('${m.name}',this.value)">
            </div>
            <div>
              <div style="font-size:10px;color:var(--gray-500);font-weight:600;margin-bottom:3px;">${pcfg.label}</div>
              <input class="form-input" style="height:28px;font-size:12px;" placeholder="${pcfg.placeholder}"
                id="wiz2p_${key}" value="${ex?.pixelId||''}"
                oninput="updateWizPixelId('${m.name}',this.value)">
              <div style="font-size:10px;color:var(--gray-400);margin-top:3px;">📌 ${pcfg.hint}</div>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div style="margin-top:10px;font-size:11px;color:var(--gray-400);">⏭ 건너뛰기 가능 — 이후 설정 › 매체 연동에서 추가 가능</div>
  </div>`;
}

function toggleWizMedia(mediaName, checked) {
  const key=mediaName.replace(/[\s()]/g,'_');
  const d=document.getElementById(`wiz2a_${key}`); if(d) d.style.display=checked?'':'none';
  const card=d?.closest('div[style*="border:1px"]');
  if(card) card.style.borderColor=checked?'var(--primary)':'var(--gray-200)';
  if(!checked) { _wizData.mediaLinks=_wizData.mediaLinks.filter(l=>l.mediaName!==mediaName); }
  else if(!_wizData.mediaLinks.find(l=>l.mediaName===mediaName))
    _wizData.mediaLinks.push({mediaName, accountId:'', pixelId:''});
}
function updateWizMediaId(mediaName, val) {
  const item=_wizData.mediaLinks.find(l=>l.mediaName===mediaName);
  if(item) item.accountId=val;
  else _wizData.mediaLinks.push({mediaName, accountId:val, pixelId:''});
}
function updateWizPixelId(mediaName, val) {
  const item=_wizData.mediaLinks.find(l=>l.mediaName===mediaName);
  if(item) item.pixelId=val;
  else _wizData.mediaLinks.push({mediaName, accountId:'', pixelId:val});
}

function _wizBodyStep3() {
  const rows=_wizData.conversions;
  return `<div>
    <div style="font-size:12px;color:var(--gray-500);margin-bottom:12px;">추적할 전환 이벤트를 정의하세요. (예: 구매, 회원가입, 상담신청)</div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
      ${rows.length===0
        ? `<div style="text-align:center;padding:28px;color:var(--gray-400);font-size:12px;border:1px dashed var(--gray-200);border-radius:8px;">아직 추가된 전환지표가 없습니다.</div>`
        : rows.map((r,i)=>`
          <div style="display:flex;gap:6px;align-items:center;background:var(--gray-50);border-radius:6px;padding:8px;">
            <input class="form-input" style="flex:2;height:28px;font-size:12px;" value="${r.name}" placeholder="표시명 (예: 구매)"
              oninput="_wizData.conversions[${i}].name=this.value">
            <input class="form-input" style="flex:2;height:28px;font-size:12px;" value="${r.sourceField}" placeholder="출처 필드명 (예: purchase)"
              oninput="_wizData.conversions[${i}].sourceField=this.value">
            <select class="form-select" style="flex:1;height:28px;font-size:12px;" onchange="_wizData.conversions[${i}].valueType=this.value">
              <option value="count" ${r.valueType==='count'?'selected':''}>건수</option>
              <option value="amount" ${r.valueType==='amount'?'selected':''}>금액</option>
            </select>
            <button class="btn btn-xs btn-danger-outline" onclick="_wizData.conversions.splice(${i},1);_renderWizStep()">×</button>
          </div>`).join('')}
    </div>
    <button class="btn btn-outline btn-sm" onclick="_wizData.conversions.push({name:'',sourceField:'',valueType:'count'});_renderWizStep()">+ 전환지표 추가</button>
    <div style="margin-top:10px;font-size:11px;color:var(--gray-400);">⏭ 건너뛰기 가능 — 이후 리포트 설정 › 전환설정에서 추가 가능</div>
  </div>`;
}

function _wizBodyStep4() {
  const members=_wizData.members;
  return `<div>
    <div style="font-size:12px;color:var(--gray-500);margin-bottom:12px;">이 계정에 접근할 팀 멤버를 초대하세요. (마스터 권한 초대 불가)</div>
    <div style="display:flex;gap:8px;margin-bottom:12px;align-items:flex-end;">
      <div style="flex:2;">
        <label class="form-label" style="font-size:11px;">이메일</label>
        <input class="form-input" id="w4email" placeholder="user@company.com" style="height:32px;font-size:12px;">
      </div>
      <div style="flex:1;">
        <label class="form-label" style="font-size:11px;">권한</label>
        <select class="form-select" id="w4role" style="height:32px;font-size:12px;">
          <option value="user">✏️ 사용자</option>
          <option value="advertiser">👁️ 광고주</option>
        </select>
      </div>
      <button class="btn btn-outline btn-sm" onclick="addWizMember()" style="white-space:nowrap;">+ 추가</button>
    </div>
    ${members.length===0
      ? `<div style="text-align:center;padding:24px;color:var(--gray-400);font-size:12px;border:1px dashed var(--gray-200);border-radius:8px;">초대된 멤버가 없습니다.</div>`
      : `<div style="display:flex;flex-direction:column;gap:6px;">
          ${members.map((m,i)=>`
            <div style="display:flex;align-items:center;gap:8px;background:var(--gray-50);border-radius:6px;padding:8px 12px;">
              <div class="act-avatar" style="background:#94A3B8;width:26px;height:26px;font-size:10px;">${m.email[0].toUpperCase()}</div>
              <span style="flex:1;font-size:13px;">${m.email}</span>
              <span class="badge ${m.role==='user'?'badge-blue':'badge-green'}" style="font-size:10px;">${m.role==='user'?'✏️ 사용자':'👁️ 광고주'}</span>
              <button class="btn btn-xs btn-danger-outline" onclick="_wizData.members.splice(${i},1);_renderWizStep()">×</button>
            </div>`).join('')}
        </div>`}
    <div style="margin-top:10px;font-size:11px;color:var(--gray-400);">⏭ 건너뛰기 가능 — 이후 계정관리에서 초대 가능</div>
  </div>`;
}

function addWizMember() {
  const email=document.getElementById('w4email')?.value.trim();
  const role=document.getElementById('w4role')?.value;
  if(!email){showToast('이메일을 입력하세요','warning');return;}
  if(_wizData.members.find(m=>m.email===email)){showToast('이미 추가된 이메일입니다','warning');return;}
  _wizData.members.push({email,role});
  _renderWizStep();
}

function _wizBodyStep5() {
  const d=_wizData;
  const mCnt=d.mediaLinks.filter(l=>l.accountId).length;
  const cCnt=d.conversions.filter(c=>c.name).length;
  const convNames=d.conversions.filter(c=>c.name).map(c=>c.name).join(', ');
  return `<div style="text-align:center;padding:8px 0;">
    <div style="font-size:40px;margin-bottom:8px;">🎉</div>
    <div style="font-size:17px;font-weight:700;margin-bottom:4px;">계정 생성 준비 완료</div>
    <div style="font-size:12px;color:var(--gray-400);margin-bottom:20px;">아래 내용을 확인 후 계정을 생성하세요.</div>
    <div style="text-align:left;background:var(--gray-50);border-radius:10px;padding:16px;margin-bottom:16px;font-size:12px;display:flex;flex-direction:column;gap:8px;">
      <div style="display:flex;gap:8px;"><span style="width:72px;color:var(--gray-500);flex-shrink:0;">계정명</span><b>${d.name||'—'}</b></div>
      <div style="display:flex;gap:8px;"><span style="width:72px;color:var(--gray-500);flex-shrink:0;">법인명</span><span>${d.corp||'—'}</span></div>
      <div style="display:flex;gap:8px;"><span style="width:72px;color:var(--gray-500);flex-shrink:0;">브랜드명</span><span>${d.brand||'—'}</span></div>
      <div style="display:flex;gap:8px;"><span style="width:72px;color:var(--gray-500);flex-shrink:0;">업종</span><span>${d.industry||'—'} / ${d.category||'—'}</span></div>
      <div style="display:flex;gap:8px;"><span style="width:72px;color:var(--gray-500);flex-shrink:0;">담당자</span><span>${d.managerName} (${d.managerId})</span></div>
      <div style="height:1px;background:var(--gray-200);"></div>
      <div style="display:flex;gap:8px;"><span style="width:72px;color:var(--gray-500);flex-shrink:0;">매체 연동</span><span>${mCnt}개 연동 예정</span></div>
      <div style="display:flex;gap:8px;"><span style="width:72px;color:var(--gray-500);flex-shrink:0;">전환지표</span><span>${cCnt}개${cCnt?' — '+convNames:''}</span></div>
      <div style="display:flex;gap:8px;"><span style="width:72px;color:var(--gray-500);flex-shrink:0;">팀 멤버</span><span>${d.members.length}명 초대 예정</span></div>
      ${d.memo?`<div style="display:flex;gap:8px;"><span style="width:72px;color:var(--gray-500);flex-shrink:0;">메모</span><span style="color:var(--gray-600);">${d.memo}</span></div>`:''}
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      <button class="btn btn-primary" style="width:100%;padding:11px;font-size:14px;" onclick="finishAccountWizard('dash')">🚀 계정 생성 &amp; 대시보드 이동</button>
      <button class="btn btn-outline" style="width:100%;" onclick="finishAccountWizard('media')">🔗 계정 생성 &amp; 매체 연동 계속하기</button>
    </div>
  </div>`;
}

function wizNext() {
  if(_wizStep===1) {
    const name=document.getElementById('w1name')?.value.trim();
    const corp=document.getElementById('w1corp')?.value.trim();
    const brand=document.getElementById('w1brand')?.value.trim();
    const industry=document.getElementById('w1industry')?.value;
    const category=document.getElementById('w1category')?.value;
    if(!name||!corp||!brand||!industry||!category){showToast('필수 항목을 모두 입력해주세요','warning');return;}
    Object.assign(_wizData,{name,corp,brand,industry,category,
      memo:document.getElementById('w1memo')?.value||''});
  }
  if(_wizStep===2) {
    _wizData.mediaLinks.forEach(link=>{
      const key=link.mediaName.replace(/[\s()]/g,'_');
      const inp=document.getElementById(`wiz2i_${key}`); if(inp) link.accountId=inp.value.trim();
    });
  }
  if(_wizStep<WIZ_TOTAL){_wizStep++;_renderWizStep();}
}
function wizPrev(){if(_wizStep>1){_wizStep--;_renderWizStep();}}

async function finishAccountWizard(after) {
  const d = _wizData;
  if (!d.name) { showToast('계정명이 없습니다', 'warning'); _wizStep=1; _renderWizStep(); return; }

  if (DEEPFLE_API.live) {
    const btn = document.querySelector('#modal-addAccountWizard .btn-success');
    if (btn) { btn.disabled = true; btn.textContent = '생성 중…'; }
    try {
      const colors = ['#4F46E5','#0EA5E9','#10B981','#F59E0B','#EF4444','#8B5CF6'];
      const color = colors[Math.floor(Math.random()*colors.length)];
      const wsId = currentWorkspace?.id || 'ws_main';
      const res = await DEEPFLE_API.post(`/workspaces/${wsId}/accounts`, {
        name: d.name, advertiser: d.corp || d.brand || '', color
      });
      const acct = res.account;
      BACKEND_ACCOUNTS = [...(BACKEND_ACCOUNTS||[]), acct];
      // 팀 멤버 초대
      for (const m of (d.members||[])) {
        try {
          await DEEPFLE_API.post(`/workspaces/${wsId}/invite`, {
            name: m.email.split('@')[0], email: m.email, role: m.role||'user',
            account_ids: [acct.id]
          });
        } catch(e) {}
      }
      currentAccount = {id:acct.id, name:acct.name, advertiser:acct.advertiser||'', color:acct.color, users:[]};
      closeModal('addAccountWizard');
      applySidebar();
      applyWhitelabel(currentAccount);
      await renderAccounts();
      showToast(`"${d.name}" 계정이 생성됐습니다`, 'success');
      if (after==='dash') showPanel('overview', document.getElementById('nav-overview'));
      else if (after==='media') showPanel('settings', document.getElementById('nav-settings'));
    } catch(e) {
      showToast(`계정 생성 실패: ${e.message}`, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '완료'; }
    }
  } else {
    // Mock 모드
    const colors = ['#4F46E5','#0EA5E9','#10B981','#F59E0B','#EF4444','#8B5CF6'];
    const newAcc = {
      id:'acc'+Date.now(), name:d.name, advertiser:d.corp||d.brand||'',
      spend:'₩0', roas:'-', users:[currentUser?.id], color:colors[Math.floor(Math.random()*colors.length)]
    };
    ACCOUNTS.push(newAcc);
    closeModal('addAccountWizard');
    renderAccounts();
    showToast(`"${d.name}" 계정이 생성되었습니다`, 'success');
    if (after==='dash') { switchAccount(newAcc.id); showPanel('overview'); }
    else if (after==='media') { switchAccount(newAcc.id); showPanel('settings'); }
  }
}

async function inviteUser() {
  const email    = document.getElementById('inviteEmail').value.trim();
  const accSel   = document.getElementById('inviteAccounts');
  const accountIds = accSel ? Array.from(accSel.selectedOptions).map(o=>o.value) : [];

  if (!email || !email.includes('@')) { showToast('올바른 이메일을 입력해주세요','warning'); return; }
  if (accountIds.length === 0) { showToast('접근 계정을 하나 이상 선택해주세요','warning'); return; }

  const btn = document.querySelector('#modal-inviteUser .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = '처리 중…'; }

  try {
    const wsId = currentWorkspace?.id || 'ws_main';
    const res = await DEEPFLE_API.post(`/workspaces/${wsId}/invite`, {email, role: 'advertiser', account_ids: accountIds});
    if (res.invite_sent) {
      showToast(`초대 이메일이 ${email}로 발송됐습니다`, 'success');
      closeModal('inviteUser');
    } else {
      // Email failed — show invite link for manual sharing
      const linkBox = document.getElementById('inviteLinkBox');
      const linkInput = document.getElementById('inviteLinkInput');
      if (linkBox && linkInput && res.invite_url) {
        linkInput.value = res.invite_url;
        linkBox.style.display = '';
      }
      showToast('이메일 발송에 실패했습니다. 아래 링크를 직접 전달해주세요.', 'warning');
    }
  } catch(e) {
    showToast(`초대 실패: ${e.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '초대 이메일 발송'; }
  }
}

let _assignTargetUid = null;
function openAssignModal(uid, name) {
  _assignTargetUid = uid;
  const u = (DEEPFLE_API.live ? BACKEND_USERS : ALL_PLATFORM_USERS).find(x=>x.id===uid);
  document.getElementById('assignModalTitle').textContent = `권한 설정 — ${name}`;
  document.getElementById('assignModalSub').textContent = `${name}의 역할과 접근 가능 계정을 설정합니다.`;
  const roleEl = document.getElementById('assignRoleSelect');
  if (roleEl && u) roleEl.value = ['master','user','advertiser'].includes(u.role) ? u.role : 'user';
  const sel = document.getElementById('assignAccounts');
  if (sel) {
    const list = DEEPFLE_API.live ? BACKEND_ACCOUNTS : ACCOUNTS;
    const current = u?.accounts || [];
    sel.innerHTML = list.map(a=>`<option value="${a.id}" ${current.includes(a.id)?'selected':''}>${a.name}</option>`).join('');
  }
  _onAssignRoleChange();
  document.getElementById('modal-assignUser').classList.add('open');
}
async function submitAssignModal() {
  if (!_assignTargetUid) return;
  const role = document.getElementById('assignRoleSelect').value;
  const sel = document.getElementById('assignAccounts');
  const accountIds = sel ? Array.from(sel.selectedOptions).map(o=>o.value) : [];
  try {
    if (DEEPFLE_API.live) {
      await DEEPFLE_API.request('PUT', `/admin/users/${_assignTargetUid}/role`, {role});
      await DEEPFLE_API.request('PUT', `/admin/users/${_assignTargetUid}/accounts`, {account_ids: accountIds});
    } else {
      const u = ALL_PLATFORM_USERS.find(x=>x.id===_assignTargetUid);
      if (u) { u.role=role; u.accounts=accountIds; }
    }
    showToast('권한이 저장됐습니다', 'success');
    document.getElementById('modal-assignUser').classList.remove('open');
    renderAccounts();
  } catch(e) { showToast(`저장 실패: ${e.message}`, 'error'); }
}

function switchAccTab(el, tab) {
  el.closest('.tab-pills').querySelectorAll('.tab-pill').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  ['list','users','pending'].forEach(t=>{
    const el=document.getElementById('accTab-'+t);
    if(el) el.style.display = t===tab?'block':'none';
  });
}

async function loadPendingUsers() {
  const tbody = document.getElementById('pendingTable');
  if (!tbody) return;
  if (!DEEPFLE_API.live) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--gray-400);font-size:13px;">백엔드 연결 시 사용 가능합니다.</td></tr>`;
    return;
  }
  tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--gray-400);font-size:13px;">로딩 중...</td></tr>`;
  try {
    const data = await DEEPFLE_API.request('GET', '/admin/pending-users', null);
    const users = data.users || [];
    const badge = document.getElementById('pendingBadge');
    if (badge) { badge.textContent = users.length; badge.style.display = users.length ? '' : 'none'; }
    if (!users.length) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--gray-400);font-size:13px;">승인 대기 중인 회원이 없습니다.</td></tr>`;
      return;
    }
    tbody.innerHTML = users.map(u=>`<tr>
      <td style="font-weight:600;font-size:13px;">${u.name}</td>
      <td style="font-size:12px;color:var(--gray-600);">${u.email}</td>
      <td style="font-size:12px;color:var(--gray-400);">${(u.created_at||'').slice(0,10)}</td>
      <td>
        <button class="btn btn-xs btn-primary"
          data-uid="${u.id}" data-uname="${(u.name||'').replace(/"/g,'&quot;')}"
          onclick="approvePendingUser(this.dataset.uid, this.dataset.uname)">승인</button>
        <button class="btn btn-xs btn-danger-outline" style="margin-left:4px;"
          data-uid="${u.id}" data-uname="${(u.name||'').replace(/"/g,'&quot;')}"
          onclick="rejectPendingUser(this.dataset.uid, this.dataset.uname)">거절</button>
      </td>
    </tr>`).join('');
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:16px;color:#EF4444;font-size:13px;">로드 실패: ${e.message}</td></tr>`;
  }
}

async function approvePendingUser(uid, name) {
  try {
    await DEEPFLE_API.request('POST', `/admin/users/${uid}/approve`, {});
    showToast(`${name} 님의 가입을 승인했습니다. 사용자 관리 탭에서 계정을 배정하세요.`, 'success');
    await renderAccounts();
    // 승인 후 사용자 관리 탭으로 자동 전환
    const usersTab = document.querySelector('#panel-accounts .tab-pill:nth-child(2)');
    if (usersTab) switchAccTab(usersTab, 'users');
  } catch(e) { showToast(`승인 실패: ${e.message}`, 'error'); }
}

async function rejectPendingUser(uid, name) {
  if (!confirm(`${name} 님의 가입 신청을 거절(삭제)하시겠습니까?`)) return;
  try {
    await DEEPFLE_API.request('DELETE', `/admin/users/${uid}`, null);
    showToast(`${name} 님의 가입 신청을 거절했습니다`, 'info');
    loadPendingUsers();
  } catch(e) { showToast(`거절 실패: ${e.message}`, 'error'); }
}

// ============================================================
// OPTIMIZATION  (Phase 2 — 규칙 로그 추가)
// ============================================================

// Log data
const RULE_LOGS = [
  {ruleId:0, ruleName:'광고비 초과 자동 중지', time:'2024.01.31 14:23', type:'stopped',
   detail:'카카오모먼트 "신제품_1월" 캠페인 일시정지', affected:['신제품_1월'], saving:102400,
   reason:'일 광고비 ₩102,400 → 기준치 ₩100,000 초과'},
  {ruleId:0, ruleName:'광고비 초과 자동 중지', time:'2024.01.30 11:05', type:'stopped',
   detail:'메타 "1월이벤트" 캠페인 일시정지', affected:['1월이벤트'], saving:87200,
   reason:'일 광고비 ₩87,200 → 기준치 초과 (ROAS 0%)'},
  {ruleId:1, ruleName:'ROAS 저하 예산 감소', time:'2024.01.31 15:00', type:'decreased',
   detail:'네이버 "브랜드키워드" 광고세트 예산 20% 감소', affected:['브랜드키워드','일반키워드'], saving:0,
   reason:'ROAS 182% → 기준치 200% 미달'},
  {ruleId:1, ruleName:'ROAS 저하 예산 감소', time:'2024.01.31 14:00', type:'decreased',
   detail:'구글 "GDN_배너" 광고세트 예산 감소', affected:['GDN_배너'], saving:0,
   reason:'ROAS 168% → 기준치 미달'},
  {ruleId:2, ruleName:'고성과 예산 자동 증액', time:'2024.01.29 09:00', type:'increased',
   detail:'카카오 "유사타겟" 광고세트 예산 10% 증가', affected:['유사타겟_30대'], saving:0,
   reason:'ROAS 720% + 클릭 634 → 조건 충족'},
  {ruleId:0, ruleName:'광고비 초과 자동 중지', time:'2024.01.28 16:40', type:'stopped',
   detail:'틱톡 "MZ타겟" 캠페인 일시정지', affected:['MZ타겟_캠페인'], saving:65000,
   reason:'일 광고비 ₩65,000 + 전환 0건'},
  {ruleId:1, ruleName:'ROAS 저하 예산 감소', time:'2024.01.28 13:00', type:'decreased',
   detail:'메타 "리타게팅" 광고세트 예산 감소', affected:['리타게팅_30일'], saving:0,
   reason:'ROAS 158% 기준치 미달'},
  {ruleId:0, ruleName:'광고비 초과 자동 중지', time:'2024.01.27 10:12', type:'notified',
   detail:'관리자에게 이메일 알림 발송', affected:[], saving:0,
   reason:'카카오 "1월신제품" 광고비 임계치 80% 도달 (사전 알림)'},
];

const LOG_TYPE_META = {
  stopped:  {label:'자동 중지',  chipClass:'stopped',  icon:'⛔', color:'var(--danger)'},
  decreased:{label:'예산 감소',  chipClass:'decreased', icon:'📉', color:'var(--warning)'},
  increased:{label:'예산 증가',  chipClass:'increased', icon:'📈', color:'var(--success)'},
  notified: {label:'알림 발송',  chipClass:'notified',  icon:'📧', color:'var(--primary)'},
};

async function renderOptimization() {
  const r = currentUser.role;
  const editable = CAN_EDIT(r);
  document.getElementById('optimReadonlyBanner').innerHTML = '';
  document.getElementById('optimActions').innerHTML = editable
    ? `<button class="btn btn-primary btn-sm" onclick="showModal('ruleCreate')">+ 규칙 만들기</button>` : '';
  // 계정별 규칙을 백엔드에서 로드 (미연결 시 기존 로컬 rules 유지)
  if (DEEPFLE_API.live && currentAccount) {
    try {
      const res = await DEEPFLE_API.get(`/accounts/${currentAccount.id}/rules`);
      rules = res.rules.map(x => ({
        id:x.id, name:x.name, desc:x.description||'', level:x.level||'캠페인',
        schedule:x.schedule||'', active:!!x.active, lastRun:x.last_run||'-', log:''
      }));
    } catch(e) { /* 폴백: 기존 rules 유지 */ }
  }
  renderRuleTab();
}

function renderRuleTab() {
  const editable = CAN_EDIT(currentUser.role);
  document.getElementById('ruleBuilderArea').innerHTML = editable ? `
    <div class="rule-builder" style="margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:var(--primary);margin-bottom:12px;">⚡ 빠른 규칙 생성</div>
      <div class="rule-row">
        <select class="rule-select"><option>캠페인 레벨</option><option>광고세트</option><option>소재</option></select>
        <span style="font-size:12px;color:var(--gray-600);">에서</span>
        <select class="rule-select"><option>광고비</option><option>ROAS</option><option>CPA</option></select>
        <select class="rule-select"><option>≥ 이상</option><option>≤ 이하</option></select>
        <input class="rule-select" type="number" placeholder="100000" style="width:110px;">
        <span style="font-size:12px;color:var(--gray-600);">이면</span>
        <select class="rule-select"><option>광고 일시정지</option><option>예산 10% 감소</option><option>예산 10% 증가</option><option>알림 발송</option></select>
        <button class="btn btn-primary btn-sm" onclick="addRuleQuick()">저장</button>
      </div>
    </div>`
    : `<div class="readonly-banner"><span class="readonly-banner-icon">👁️</span><span>조회 전용 — 규칙 수정은 사용자(USER) 이상 권한이 필요합니다.</span></div>`;
  renderRuleList();
}

function switchOptimTab(el, tab) {
  el.closest('.tab-pills').querySelectorAll('.tab-pill').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('optimTab-rules').style.display = tab==='rules' ? 'block' : 'none';
  document.getElementById('optimTab-log').style.display   = tab==='log'   ? 'block' : 'none';
  if (tab === 'log') renderLogTab();
}

// 백엔드 실행 이력(rule_executions) → 로그 카드 모델로 변환
function mapExecToLogs(e) {
  const impacts = e.impacts || [];
  const typeOf = a => a==='pause'?'stopped':a==='budget_down'?'decreased':a==='budget_up'?'increased':'notified';
  const type = impacts.length ? typeOf(impacts[0].action) : 'notified';
  const affected = impacts.map(i=>i.media).filter(Boolean);
  let saving = 0;
  impacts.forEach(i=>{ if(typeof i.before==='number' && typeof i.after==='number' && i.before>i.after) saving += (i.before-i.after); });
  const detail = impacts.length
    ? `${impacts.length}개 매체 자동 조정 (${affected.slice(0,3).join(', ')}${affected.length>3?' 외':''})`
    : '영향 매체 없음';
  return {
    ruleName: e.ruleName + (e.undone?' (되돌림)':''),
    time: (e.executedAt||'').replace('T',' ').slice(0,16),
    type, detail, affected, saving, reason:'자동 규칙 실행 결과'
  };
}

async function renderLogTab() {
  let logs = RULE_LOGS;   // 백엔드 미연결 시 데모 폴백
  if (DEEPFLE_API.live && currentAccount) {
    try {
      const res = await DEEPFLE_API.get(`/accounts/${currentAccount.id}/rule-executions`);
      logs = res.executions.map(mapExecToLogs);
    } catch(e) { logs = []; }
  }
  // KPI 요약
  const totalSaving = logs.reduce((s,l)=>s+l.saving,0);
  const stopCount   = logs.filter(l=>l.type==='stopped').length;
  const decCount    = logs.filter(l=>l.type==='decreased').length;
  const incCount    = logs.filter(l=>l.type==='increased').length;
  document.getElementById('logKpiGrid').innerHTML = `
    <div class="log-kpi"><div class="log-kpi-num" style="color:var(--danger);">${stopCount}회</div><div class="log-kpi-label">자동 중지</div></div>
    <div class="log-kpi"><div class="log-kpi-num" style="color:var(--warning);">${decCount}회</div><div class="log-kpi-label">예산 감소</div></div>
    <div class="log-kpi"><div class="log-kpi-num" style="color:var(--success);">${incCount}회</div><div class="log-kpi-label">예산 증가</div></div>
    <div class="log-kpi"><div class="log-kpi-num" style="color:var(--primary);">${fmtW(totalSaving)}</div><div class="log-kpi-label">절감된 광고비</div></div>`;

  // 타임라인
  if (!logs.length) {
    document.getElementById('logTimeline').innerHTML =
      `<div class="empty"><div class="empty-icon">📋</div>이 계정의 자동 규칙 실행 이력이 아직 없습니다</div>`;
    return;
  }
  document.getElementById('logTimeline').innerHTML = logs.map((log,i) => {
    const meta = LOG_TYPE_META[log.type];
    const chips = log.affected.map(a=>`<span class="log-chip ${log.type}">${a}</span>`).join('');
    const saving = log.saving > 0
      ? `<div class="log-saving">💰 이번 실행으로 <strong>₩${log.saving.toLocaleString()}</strong> 절감</div>` : '';
    return `
      <div class="log-item">
        <div class="log-dot ${log.type==='stopped'?'warning':log.type==='increased'?'success':'info'}"></div>
        <div class="log-card">
          <div class="log-card-header">
            <div style="display:flex;align-items:center;gap:8px;">
              <span>${meta.icon}</span>
              <span class="log-rule-name">${log.ruleName}</span>
              <span class="log-chip ${log.type}" style="font-size:10px;">${meta.label}</span>
            </div>
            <span class="log-time">${log.time}</span>
          </div>
          <div class="log-detail">${log.detail}</div>
          <div style="font-size:11px;color:var(--gray-400);margin-top:4px;">📌 ${log.reason}</div>
          ${chips ? `<div class="log-affected">${chips}</div>` : ''}
          ${saving}
        </div>
      </div>`;
  }).join('');
}

function renderRuleList() {
  const editable = CAN_EDIT(currentUser.role);
  if (!rules.length) {
    document.getElementById('ruleList').innerHTML =
      `<div class="empty"><div class="empty-icon">⚙️</div>이 계정에 설정된 자동화 규칙이 없습니다${editable?' — 우측 상단에서 규칙을 추가하세요':''}</div>`;
    return;
  }
  document.getElementById('ruleList').innerHTML = rules.map((r,i)=>`
    <div class="rule-card">
      <div style="flex:1;">
        <div class="rule-name">${r.name}</div>
        <div class="rule-desc" style="color:var(--gray-400);font-size:11px;margin-top:2px;">${r.desc}</div>
        <div style="display:flex;gap:7px;margin-top:7px;align-items:center;">
          <span class="chip">${r.level}</span>
          <span class="chip">⏰ ${r.schedule}</span>
          <span style="font-size:11px;color:var(--gray-400);">마지막 실행: ${r.lastRun}</span>
        </div>
        ${r.log?`<div class="rule-log">📋 ${r.log}</div>`:''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0;">
        <div class="toggle ${r.active?'on':''} ${editable?'':'disabled'}" onclick="${editable?`toggleRule(${i},this)`:''}" title="${editable?'클릭하여 전환':'편집 권한 필요'}"></div>
        ${editable?`<button class="btn btn-xs btn-danger-outline" onclick="deleteRule(${i})">삭제</button>`:''}
      </div>
    </div>`).join('');
}

async function toggleRule(i,el) {
  const rule = rules[i];
  const next = !rule.active;
  if (DEEPFLE_API.live && rule.id != null) {
    try { await DEEPFLE_API.patch(`/rules/${rule.id}`, {active: next}); }
    catch(e){ showToast(`변경 실패: ${e.message}`, e.status===403?'error':'warning'); return; }
  }
  rule.active = next; el.classList.toggle('on', next);
  showToast(`규칙 "${rule.name}" ${next?'활성화':'비활성화'}`,'success');
}
async function deleteRule(i) {
  const rule = rules[i];
  if(!confirm(`"${rule.name}" 규칙을 삭제하시겠습니까?`)) return;
  if (DEEPFLE_API.live && rule.id != null) {
    try { await DEEPFLE_API.del(`/rules/${rule.id}`); }
    catch(e){ showToast(`삭제 실패: ${e.message}`, e.status===403?'error':'warning'); return; }
  }
  rules.splice(i,1); renderRuleList(); showToast('삭제되었습니다','success');
}
// 규칙 생성 공통 — 백엔드 연결 시 계정에 영속, 아니면 로컬
async function createRule(payload) {
  if (DEEPFLE_API.live && currentAccount) {
    const res = await DEEPFLE_API.post(`/accounts/${currentAccount.id}/rules`, payload);
    const x = res.rule;
    rules.unshift({id:x.id, name:x.name, desc:x.description||'', level:x.level,
                   schedule:x.schedule, active:!!x.active, lastRun:x.last_run||'-', log:''});
  } else {
    rules.unshift({name:payload.name, desc:payload.description, level:payload.level,
                   schedule:payload.schedule, active:!!payload.active, lastRun:'-', log:''});
  }
}
async function addRuleQuick() {
  try {
    await createRule({name:'새 자동화 규칙', description:'사용자 정의 조건 → 액션 실행',
                      level:'캠페인', schedule:'실시간', active:true});
  } catch(e){ showToast(`생성 실패: ${e.message}`, e.status===403?'error':'warning'); return; }
  renderRuleList(); showToast('규칙이 저장되었습니다','success');
}
async function addRuleFromModal() {
  const v = id => { const el=document.getElementById(id); return el ? el.value : ''; };
  const name = v('ruleNameInput') || '새 규칙';
  const level = v('ruleLevelInput') || '캠페인';
  const schedule = v('ruleScheduleInput') || '실시간';
  const metric = v('ruleCondMetric'), op = v('ruleCondOp'), val = v('ruleCondVal'), action = v('ruleActionInput');
  const description = (metric && action)
    ? `${metric} ${op} ${val||''} → ${action}`.replace(/\s+/g,' ').trim()
    : '사용자 정의 조건 → 액션 실행';
  try {
    await createRule({name, description, level, schedule, active:true});
  } catch(e){ showToast(`생성 실패: ${e.message}`, e.status===403?'error':'warning'); return; }
  closeModal('ruleCreate'); renderRuleList(); showToast(`"${name}" 규칙이 생성되었습니다`,'success');
}

// ============================================================
// REPORTING (Phase 2 — 풀 뷰어 추가)
// ============================================================
const REPORT_DETAIL = {
  kpis:[
    {label:'총 광고비',  val:'₩42,700,000', change:'+12.4%', up:true},
    {label:'총 노출수',  val:'18,300,000',  change:'+8.2%',  up:true},
    {label:'총 클릭수',  val:'284,000',   change:'-2.1%',  up:false},
    {label:'전환수',     val:'3,847',  change:'+18.7%', up:true},
    {label:'ROAS',       val:'412%',   change:'+23.1%', up:true},
  ],
  mediaRows:[
    {name:'카카오모먼트',  spend:'₩12,400,000',imp:'4,200,000',click:'68,000',cvr:'1,420',roas:'520%',cpa:'₩8,732',ctr:'1.62%',cpc:'₩182',cpm:'₩2,952'},
    {name:'네이버 검색광고',spend:'₩9,800,000', imp:'2,800,000',click:'54,000',cvr:'980', roas:'380%',cpa:'₩10,000',ctr:'1.93%',cpc:'₩181',cpm:'₩3,500'},
    {name:'구글 Ads',      spend:'₩7,200,000', imp:'5,100,000',click:'72,000',cvr:'820', roas:'410%',cpa:'₩8,780',ctr:'1.41%',cpc:'₩100',cpm:'₩1,412'},
    {name:'메타(페이스북)',spend:'₩6,500,000', imp:'3,400,000',click:'48,000',cvr:'540', roas:'340%',cpa:'₩12,037',ctr:'1.41%',cpc:'₩135',cpm:'₩1,912'},
    {name:'카카오 비즈보드',spend:'₩3,800,000',imp:'1,900,000',click:'22,000',cvr:'310', roas:'290%',cpa:'₩12,258',ctr:'1.16%',cpc:'₩173',cpm:'₩2,000'},
  ],
  insights:[
    {title:'카카오모먼트 최고 ROAS 달성', text:'카카오모먼트가 이번 달 520% ROAS를 기록하며 전체 매체 중 최고 성과를 보였습니다. 예산 추가 배분을 권장합니다.'},
    {title:'메타 CPA 개선 필요', text:'메타 광고의 CPA가 ₩12,037로 목표 대비 20% 높은 수준입니다. 오디언스 세분화 또는 소재 교체를 검토해주세요.'},
    {title:'전환수 18.7% 성장', text:'전월 대비 전환수가 18.7% 증가했습니다. 자동 규칙이 저성과 캠페인을 조기 중지해 광고비 효율이 개선되었습니다.'},
  ]
};

// ============================================================
// SHARE VIEW — 공개 읽기 전용 대시보드
// ============================================================
function _encodeShareToken(cfg) {
  return btoa(encodeURIComponent(JSON.stringify(cfg)));
}
function _decodeShareToken(token) {
  try { return JSON.parse(decodeURIComponent(atob(token))); } catch(e) { return null; }
}

function showShareModal() {
  const today = new Date().toISOString().slice(0,10);
  const monthAgo = new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  document.getElementById('slFrom').value = window._globalFrom || monthAgo;
  document.getElementById('slTo').value = window._globalTo || today;
  document.getElementById('slComment').value = '';
  document.getElementById('slUrl').value = '';
  document.getElementById('slCopyBtn').disabled = true;
  showModal('shareLink');
}

function generateShareLink() {
  const from = document.getElementById('slFrom').value;
  const to   = document.getElementById('slTo').value;
  const comment = document.getElementById('slComment').value.trim();
  const expiryDays = parseInt(document.getElementById('slExpiry').value) || 0;
  if (!from || !to) { showToast('기간을 선택해 주세요','warning'); return; }
  const cfg = {
    n: currentAccount?.name || 'DeepFle 대시보드',
    f: from, t: to,
    ...(comment && {c: comment}),
    ...(expiryDays > 0 && {exp: Date.now() + expiryDays * 86400000}),
  };
  const token = _encodeShareToken(cfg);
  const url = `${location.origin}${location.pathname}?share=${token}`;
  document.getElementById('slUrl').value = url;
  document.getElementById('slCopyBtn').disabled = false;
  logActivity('공유 링크 생성: ' + cfg.n + ' (' + from + '~' + to + ')');
  showToast('공유 링크가 생성되었습니다','success');
}

function copyShareLink() {
  const url = document.getElementById('slUrl').value;
  if (!url) return;
  navigator.clipboard?.writeText(url).then(()=>showToast('링크가 클립보드에 복사되었습니다','success')).catch(()=>{
    const el = document.getElementById('slUrl'); el.select(); document.execCommand('copy');
    showToast('링크가 복사되었습니다','success');
  }) || (() => {
    const el = document.getElementById('slUrl'); el.select(); document.execCommand('copy');
    showToast('링크가 복사되었습니다','success');
  })();
}

function _initShareView() {
  const params = new URLSearchParams(location.search);
  const token = params.get('share');
  if (!token) return false;
  // 다른 페이지 숨기고 share 페이지만 표시
  document.querySelectorAll('.page').forEach(p => p.style.display='none');
  const pg = document.getElementById('page-share');
  pg.style.display = 'block';
  pg.classList.add('active');

  const cfg = _decodeShareToken(token);
  if (!cfg) { _shareError('유효하지 않은 링크입니다', '링크가 잘못되었거나 손상되었습니다.'); return true; }
  if (cfg.exp && Date.now() > cfg.exp) { _shareError('링크가 만료되었습니다', '공유 링크의 유효 기간이 지났습니다. 에이전시에 새 링크를 요청하세요.'); return true; }

  document.getElementById('shareAccName').textContent = cfg.n;
  document.getElementById('sharePeriodSub').textContent = cfg.f + ' ~ ' + cfg.t;
  if (cfg.exp) {
    document.getElementById('shareExpiryBadge').textContent = '만료: ' + new Date(cfg.exp).toLocaleDateString('ko');
  }
  document.getElementById('shareFooterDate').textContent = cfg.t;
  _renderShareBody(cfg);
  return true;
}

function _shareError(title, desc) {
  document.getElementById('shareBody').innerHTML = `
    <div class="share-expired">
      <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
      <div style="font-size:20px;font-weight:700;margin-bottom:8px;">${title}</div>
      <div style="font-size:13px;color:var(--gray-400);">${desc}</div>
    </div>`;
}

function _renderShareBody(cfg) {
  const from = cfg.f, to = cfg.t;
  const d1 = new Date(from), d2 = new Date(to);
  const days = Math.max(1, Math.round((d2-d1)/86400000)+1);
  const dates = Array.from({length:days},(_,i)=>new Date(d1.getTime()+i*86400000));
  const labels = dates.map(d=>`${d.getMonth()+1}/${d.getDate()}`);

  const rnd = _seededRand(42);
  const onMedia = MEDIA_DATA.filter(m=>m.on);
  const series = onMedia.map(m => {
    const scale = m.spend / days;
    const cvr = m.click ? m.cvr/m.click : 0.02;
    const cost = Array.from({length:days},()=>Math.max(0,Math.round(scale*(1+(rnd()-0.5)*0.5))));
    const click = cost.map(c=>Math.round(c/(m.click?m.spend/m.click:400)));
    const imp   = click.map(c=>c*Math.round(20+rnd()*35));
    const conv  = click.map(c=>Math.round(c*cvr));
    const rev   = conv.map(v=>v*(150000+Math.round(rnd()*100000)));
    return {name:m.name, color:m.color, cost, click, imp, conv, rev};
  });

  const sumArr = arr => arr.reduce((a,b)=>a+b,0);
  const tCost = sumArr(series.flatMap(s=>s.cost));
  const tClick= sumArr(series.flatMap(s=>s.click));
  const tImp  = sumArr(series.flatMap(s=>s.imp));
  const tConv = sumArr(series.flatMap(s=>s.conv));
  const tRev  = sumArr(series.flatMap(s=>s.rev));
  const ctr  = tImp   ? tClick/tImp  : 0;
  const cpa  = tConv  ? tCost/tConv  : 0;
  const roas = tCost  ? tRev/tCost   : 0;

  const kpis = [
    {label:'총 광고비',  val:fmtW(tCost),                   sub:`${days}일 기준`},
    {label:'노출수',     val:fmtN(tImp),                    sub:`CTR ${(ctr*100).toFixed(2)}%`},
    {label:'클릭수',     val:fmtN(tClick),                  sub:`CPC ${fmtW(Math.round(tClick?tCost/tClick:0))}`},
    {label:'전환수',     val:fmtN(tConv),                   sub:`CVR ${(tClick?tConv/tClick*100:0).toFixed(2)}%`},
    {label:'ROAS',      val:(roas*100).toFixed(0)+'%',      sub:'매출/광고비', hi: roas>=4},
    {label:'CPA',       val:fmtW(Math.round(cpa)),          sub:'광고비/전환'},
  ];

  const kpiHtml = kpis.map(k=>`
    <div class="share-kpi-card">
      <div class="share-kpi-label">${k.label}</div>
      <div class="share-kpi-val" style="${k.hi?'color:var(--success);':''}">${k.val}</div>
      <div class="share-kpi-sub">${k.sub}</div>
    </div>`).join('');

  const mediaRows = series.map(s=>{
    const mc=sumArr(s.cost), mk=sumArr(s.click), mi=sumArr(s.imp), mv=sumArr(s.conv), mr=sumArr(s.rev);
    const mRoas = mc ? mr/mc : 0, mCpa = mv ? mc/mv : 0, mCtr = mi ? mk/mi : 0;
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:7px;"><div style="width:8px;height:8px;border-radius:50%;background:${s.color};flex-shrink:0;"></div>${s.name}</div></td>
      <td class="text-right">${fmtW(mc)}</td>
      <td class="text-right">${fmtN(mi)}</td>
      <td class="text-right">${fmtN(mk)}</td>
      <td class="text-right">${(mCtr*100).toFixed(2)}%</td>
      <td class="text-right">${fmtN(mv)}</td>
      <td class="text-right" style="font-weight:700;color:${mRoas>=4?'var(--success)':mRoas<3?'var(--danger)':''};">${(mRoas*100).toFixed(0)}%</td>
      <td class="text-right">${fmtW(Math.round(mCpa))}</td>
    </tr>`;
  }).join('');

  document.getElementById('shareBody').innerHTML = `
    ${cfg.c ? `<div class="share-comment">💬 ${cfg.c}</div>` : ''}
    <div class="share-section">
      <div class="share-section-title">전체 성과 요약</div>
      <div class="share-kpi-grid">${kpiHtml}</div>
    </div>
    <div class="share-section">
      <div class="share-section-title">매체별 성과</div>
      <div class="card" style="overflow-x:auto;">
        <table class="data-table" style="width:100%;font-size:12px;">
          <thead><tr>
            <th>매체</th><th class="text-right">광고비</th><th class="text-right">노출수</th>
            <th class="text-right">클릭수</th><th class="text-right">CTR</th>
            <th class="text-right">전환수</th><th class="text-right">ROAS</th><th class="text-right">CPA</th>
          </tr></thead>
          <tbody>${mediaRows}</tbody>
        </table>
      </div>
    </div>
    <div class="share-section">
      <div class="share-section-title">광고비 추세</div>
      <div class="card" style="padding:16px;">
        <canvas id="shareChart" height="110"></canvas>
      </div>
    </div>`;

  setTimeout(()=>{
    const ctx = document.getElementById('shareChart');
    if (!ctx || !window.Chart) return;
    new Chart(ctx, {
      type:'line',
      data:{
        labels,
        datasets: series.map(s=>({
          label:s.name, data:s.cost, borderColor:s.color,
          backgroundColor:s.color+'18', borderWidth:2, pointRadius:0, tension:.3, fill:false,
        }))
      },
      options:{
        responsive:true,
        plugins:{legend:{position:'bottom',labels:{font:{size:11}}}},
        scales:{
          x:{ticks:{maxTicksLimit:10,font:{size:10}}},
          y:{ticks:{font:{size:10},callback:v=>(v/10000).toFixed(0)+'만'}}
        }
      }
    });
  }, 100);
}

function renderReporting() {
  const editable = CAN_EDIT(currentUser.role);
  document.getElementById('reportActions').innerHTML = editable
    ? `<button class="btn btn-primary btn-sm" onclick="openCrCreateForm()">+ 리포트 생성</button>`
    : `<span style="font-size:12px;color:var(--gray-400);">조회 전용</span>`;

  const contentEl = document.getElementById('customReportContent');
  if (!contentEl) return;

  const rows = reports.map((r,i) => {
    const typeColor = {'월간':'var(--primary)','주간':'var(--success)','일간':'#0EA5E9','커스텀':'var(--warning)'}[r.type]||'var(--gray-600)';
    const mediaStr = r.media || '전체 매체';
    const cycleStr = r._sendCycle || '-';
    const lastSent = r._lastSent ? new Date(r._lastSent).toLocaleString('ko') : '-';
    const statusBadge = r._sendCycle
      ? '<span class="badge badge-green" style="font-size:10px;">자동발송</span>'
      : '<span class="badge badge-gray" style="font-size:10px;">수동</span>';
    return `<tr>
      <td style="font-weight:600;">${r.title}</td>
      <td><span style="color:${typeColor};font-weight:600;font-size:11px;">${r.type}</span></td>
      <td style="font-size:11px;">${r.date || '-'}</td>
      <td style="font-size:11px;">${mediaStr}</td>
      <td>${statusBadge}</td>
      <td style="font-size:11px;">${cycleStr}</td>
      <td style="font-size:11px;">${lastSent}</td>
      <td>
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          <button class="btn btn-xs btn-outline" onclick="openReportViewer(${i})">미리보기</button>
          <button class="btn btn-xs btn-outline" onclick="openCrSendConfig(${i})">발송설정</button>
          <button class="btn btn-xs btn-primary" onclick="crSendNow(${i})">즉시발송</button>
          ${editable ? `<button class="btn btn-xs" style="color:var(--danger);border:1px solid var(--danger);" onclick="deleteCrReport(${i})">삭제</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');

  contentEl.innerHTML = `
    <div class="card">
      <div style="overflow-x:auto;">
        <table class="data-table" style="width:100%;font-size:12px;">
          <thead><tr><th>리포트명</th><th>유형</th><th>기간</th><th>매체</th><th>상태</th><th>발송주기</th><th>최근발송</th><th>액션</th></tr></thead>
          <tbody>${rows.length ? rows : '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--gray-400);">생성된 리포트가 없습니다. 상단의 "+ 리포트 생성" 버튼을 클릭하세요.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div id="crSendConfigArea" style="margin-top:16px;"></div>`;
}

function openCrCreateForm() {
  const mediaOpts = [
    {key:'__all__',label:'전체 매체'},{key:'meta',label:'메타'},{key:'google',label:'Google Ads'},
    {key:'naver_sa',label:'네이버 검색광고'},{key:'kakao',label:'카카오모먼트'},{key:'tiktok',label:'틱톡'}
  ];
  const today = new Date().toISOString().slice(0,10);
  const monthAgo = new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  const html = `<div class="card" style="margin-bottom:16px;border:2px solid var(--primary);">
    <div class="card-header"><div class="card-title">새 커스텀 리포트</div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:4px;">
      <div class="form-group"><label class="form-label">리포트 제목</label><input class="form-input" id="crTitle" placeholder="예: 6월 주간 리포트"></div>
      <div class="form-group"><label class="form-label">리포트 유형</label><select class="form-select" id="crType"><option value="일간">일간</option><option value="주간">주간</option><option value="월간" selected>월간</option></select></div>
      <div class="form-group"><label class="form-label">시작일</label><input class="form-input" type="date" id="crFrom" value="${monthAgo}"></div>
      <div class="form-group"><label class="form-label">종료일</label><input class="form-input" type="date" id="crTo" value="${today}"></div>
      <div class="form-group" style="grid-column:span 2;"><label class="form-label">매체 선택</label>
        <div style="display:flex;flex-wrap:wrap;gap:8px;" id="crMediaChecks">
          ${mediaOpts.map(m=>`<label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;"><input type="checkbox" value="${m.key}" ${m.key==='__all__'?'checked':''}>${m.label}</label>`).join('')}
        </div>
      </div>
      <div class="form-group" style="grid-column:span 2;"><label class="form-label">발송 주기 (선택)</label>
        <div style="display:flex;gap:8px;">
          <select class="form-select" id="crCycle" style="flex:1;"><option value="">수동 (발송 안 함)</option><option value="매일">매일</option><option value="매주 월요일">매주 월요일</option><option value="매월 1일">매월 1일</option></select>
          <input class="form-input" type="time" id="crTime" value="09:00" style="width:120px;">
        </div>
      </div>
      <div class="form-group" style="grid-column:span 2;"><label class="form-label">수신자 이메일 (쉼표 구분)</label><input class="form-input" id="crRecipients" placeholder="user@email.com, team@email.com"></div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;padding:8px 4px 4px;">
      <button class="btn btn-sm btn-outline" onclick="document.getElementById('crSendConfigArea').innerHTML='';">취소</button>
      <button class="btn btn-sm btn-primary" onclick="createCrReport()">리포트 생성</button>
    </div>
  </div>`;
  const area = document.getElementById('crSendConfigArea');
  if (area) area.innerHTML = html;
}

function createCrReport() {
  const title = document.getElementById('crTitle')?.value || '새 리포트';
  const type = document.getElementById('crType')?.value || '월간';
  const from = document.getElementById('crFrom')?.value || '';
  const to = document.getElementById('crTo')?.value || '';
  const cycle = document.getElementById('crCycle')?.value || '';
  const time = document.getElementById('crTime')?.value || '09:00';
  const recipients = document.getElementById('crRecipients')?.value || '';
  const mediaChecks = document.querySelectorAll('#crMediaChecks input:checked');
  const mediaKeys = [...mediaChecks].map(c=>c.value);
  const mediaLabel = mediaKeys.includes('__all__') ? '전체 매체' : mediaKeys.map(k=>MEDIA_LABELS[k]||k).join(', ');

  const sum = arr => arr.reduce((a,b)=>a+b,0);
  const rnd = _seededRand((title+from).split('').reduce((a,c)=>a+c.charCodeAt(0),0)||1);
  const totalCost = Math.round(30000000 + rnd()*20000000);
  const totalConv = Math.round(800 + rnd()*1200);
  const totalRev = Math.round(totalCost * (2.5 + rnd()*3));
  const roas = totalCost ? (totalRev/totalCost*100).toFixed(0) : '-';

  reports.unshift({
    title, type, date: `${from} ~ ${to}`, spend: fmtW(totalCost), roas: roas+'%', cvr: fmtN(totalConv),
    media: mediaLabel,
    _sendCycle: cycle, _sendTime: time, _sendTo: recipients, _sendCc: '',
    _senderEmail: localStorage.getItem('deepfle_verified_email') || '', _mailSubject: title,
    _sendMsg: `${title} 리포트를 공유합니다.`, _lastSent: ''
  });
  document.getElementById('crSendConfigArea').innerHTML = '';
  renderReporting();
  showToast(`"${title}" 리포트가 생성되었습니다`, 'success');
}

function openCrSendConfig(idx) {
  const r = reports[idx];
  if (!r) return;
  const area = document.getElementById('crSendConfigArea');
  if (!area) return;
  area.innerHTML = `<div class="card" style="border:2px solid var(--primary);">
    <div class="card-header"><div class="card-title">"${r.title}" 발송 설정</div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:4px;">
      <div class="form-group"><label class="form-label">발송자 이메일</label><input class="form-input" id="csEmail" value="${r._senderEmail||localStorage.getItem('deepfle_verified_email')||''}"></div>
      <div class="form-group"><label class="form-label">메일 제목</label><input class="form-input" id="csSubject" value="${r._mailSubject||r.title}"></div>
      <div class="form-group"><label class="form-label">수신자</label><input class="form-input" id="csTo" value="${r._sendTo||''}" placeholder="email@example.com"></div>
      <div class="form-group"><label class="form-label">참조 (CC)</label><input class="form-input" id="csCc" value="${r._sendCc||''}"></div>
      <div class="form-group"><label class="form-label">발송 주기</label>
        <select class="form-select" id="csCycle"><option value="">수동</option><option value="매일" ${r._sendCycle==='매일'?'selected':''}>매일</option><option value="매주 월요일" ${r._sendCycle==='매주 월요일'?'selected':''}>매주 월요일</option><option value="매월 1일" ${r._sendCycle==='매월 1일'?'selected':''}>매월 1일</option></select>
      </div>
      <div class="form-group"><label class="form-label">발송 시간</label><input class="form-input" type="time" id="csTime" value="${r._sendTime||'09:00'}"></div>
      <div class="form-group" style="grid-column:span 2;"><label class="form-label">메시지</label><textarea class="form-input" id="csMsg" rows="3" style="resize:vertical;">${r._sendMsg||''}</textarea></div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;padding:8px 4px 4px;">
      <button class="btn btn-sm btn-outline" onclick="document.getElementById('crSendConfigArea').innerHTML='';">취소</button>
      <button class="btn btn-sm btn-primary" onclick="saveCrSendConfig(${idx})">저장</button>
    </div>
  </div>`;
}

function saveCrSendConfig(idx) {
  const r = reports[idx];
  if (!r) return;
  r._senderEmail = document.getElementById('csEmail')?.value || '';
  r._mailSubject = document.getElementById('csSubject')?.value || '';
  r._sendTo = document.getElementById('csTo')?.value || '';
  r._sendCc = document.getElementById('csCc')?.value || '';
  r._sendCycle = document.getElementById('csCycle')?.value || '';
  r._sendTime = document.getElementById('csTime')?.value || '09:00';
  r._sendMsg = document.getElementById('csMsg')?.value || '';
  document.getElementById('crSendConfigArea').innerHTML = '';
  renderReporting();
  showToast('발송 설정이 저장되었습니다', 'success');
}

function crSendNow(idx) {
  const r = reports[idx];
  if (!r) return;
  if (!r._sendTo) { showToast('수신자 이메일을 설정해주세요', 'error'); return; }
  const verified = localStorage.getItem('deepfle_smtp_verified');
  if (!verified) { showToast('설정 > 내 계정에서 이메일 인증을 먼저 완료해주세요', 'error'); return; }

  const cfg = _getEmailjsConfig();
  const ejReady = cfg.publicKey && cfg.serviceId && cfg.templateReport && typeof emailjs !== 'undefined';

  // 공유 링크 자동 생성
  let shareUrl = '';
  try {
    const parts = (r.date || '').split('~').map(s => s.trim());
    const token = _encodeShareToken({ n: currentAccount?.name || '', f: parts[0] || '', t: parts[1] || parts[0] || '' });
    shareUrl = `${location.origin}${location.pathname}?share=${token}`;
  } catch(e) {}

  const params = {
    to_email:      r._sendTo,
    to_name:       r._sendTo.split('@')[0],
    cc_email:      r._sendCc || '',
    subject:       r._mailSubject || r.title,
    report_title:  r.title,
    period:        r.date || '-',
    account_name:  currentAccount?.name || '-',
    total_spend:   r.spend || '-',
    roas:          r.roas || '-',
    conversions:   r.cvr || '-',
    media:         r.media || '전체 매체',
    message:       r._sendMsg || '',
    share_url:     shareUrl,
    sender_name:   currentUser?.name || 'DeepFle',
    sender_email:  r._senderEmail || localStorage.getItem('deepfle_verified_email') || '',
  };

  if (ejReady) {
    _initEmailjs();
    // 버튼 로딩 상태
    const btn = document.querySelector(`[onclick="crSendNow(${idx})"]`);
    if (btn) { btn.disabled = true; btn.textContent = '발송 중...'; }

    emailjs.send(cfg.serviceId, cfg.templateReport, params)
      .then(() => {
        r._lastSent = new Date().toISOString();
        renderReporting();
        showToast(`"${r.title}" 리포트가 ${r._sendTo}에게 발송되었습니다`, 'success');
      })
      .catch(err => {
        if (btn) { btn.disabled = false; btn.textContent = '즉시 발송'; }
        showToast(`발송 실패: ${err?.text || '네트워크 오류'} — EmailJS 설정을 확인해 주세요`, 'error');
      });
  } else {
    // 데모 모드 — EmailJS 미설정 시 로컬 처리
    r._lastSent = new Date().toISOString();
    renderReporting();
    const demoNote = ejReady ? '' : ' (데모 모드 — EmailJS 설정 후 실발송 가능)';
    showToast(`"${r.title}" 리포트 발송 완료${demoNote}`, ejReady ? 'success' : 'info');
  }
}

function deleteCrReport(idx) {
  if (!confirm('이 리포트를 삭제하시겠습니까?')) return;
  reports.splice(idx, 1);
  renderReporting();
  showToast('리포트가 삭제되었습니다', 'info');
}


// Report viewer charts
let rvTrendChart, rvDonutChart;
let _rvCurrentIdx = 0;

// Report viewer dynamic column system
const RV_ALL_COLS = [
  {key:'spend', label:'광고비'},
  {key:'imp',   label:'노출수'},
  {key:'click', label:'클릭수'},
  {key:'cvr',   label:'전환수'},
  {key:'roas',  label:'ROAS'},
  {key:'cpa',   label:'CPA'},
  {key:'ctr',   label:'CTR'},
  {key:'cpc',   label:'CPC'},
  {key:'cpm',   label:'CPM'},
];
let _rvSelectedCols = ['spend','imp','click','cvr','roas','cpa'];
let _rvConvCols = [];
let _rvRows = REPORT_DETAIL.mediaRows;

function _rvAllCols() { return [...RV_ALL_COLS, ..._rvConvCols]; }

function _rvBuildCols() {
  return _rvAllCols().filter(c=>_rvSelectedCols.includes(c.key));
}

function _rvRenderTable(mediaRows, cols) {
  return `<table>
    <thead><tr><th>매체</th>${cols.map(c=>`<th class="text-right">${c.label}</th>`).join('')}</tr></thead>
    <tbody>${mediaRows.map(m=>`<tr>
      <td><div style="display:flex;align-items:center;gap:7px;font-weight:600;">${m.name}</div></td>
      ${cols.map(c=>`<td class="text-right num">${m[c.key]||'-'}</td>`).join('')}
    </tr>`).join('')}</tbody>
  </table>`;
}

function _rvColPickerHTML() {
  return _rvAllCols().map(c=>{
    const chk = _rvSelectedCols.includes(c.key) ? 'checked' : '';
    const tag = _rvConvCols.find(cc=>cc.key===c.key) ? ' <span style="font-size:10px;color:var(--primary);background:var(--primary-light);padding:1px 5px;border-radius:3px;">전환</span>' : '';
    return `<label class="mr-kpi-picker-item"><input type="checkbox" value="${c.key}" ${chk} onchange="onRvColChange()">${c.label}${tag}</label>`;
  }).join('');
}

function toggleRvColPicker() {
  const d = document.getElementById('rvColPickerDrop');
  if (!d) return;
  const opening = !d.classList.contains('open');
  d.style.display = opening ? 'block' : 'none';
  d.classList.toggle('open');
  if (opening) {
    setTimeout(()=>{
      const closer = e=>{ if (!d.contains(e.target) && !e.target.closest('.mr-kpi-picker')) { d.style.display='none'; d.classList.remove('open'); document.removeEventListener('click',closer); }};
      document.addEventListener('click',closer);
    },10);
  }
}

function onRvColChange() {
  const d = document.getElementById('rvColPickerDrop');
  if (!d) return;
  const keys = [...d.querySelectorAll('input:checked')].map(i=>i.value);
  if (!keys.length) { showToast('최소 1개 컬럼을 선택하세요','warning'); return; }
  _rvSelectedCols = keys;
  const wrap = document.getElementById('rvMediaTableWrap');
  if (wrap) {
    const cols = _rvBuildCols();
    wrap.innerHTML = _rvRenderTable(_rvRows, cols);
  }
}

async function openReportViewer(idx) {
  const rep = reports[idx];
  const panel = document.getElementById('reportViewerPanel');
  _rvCurrentIdx = idx;

  // 리포트 기간 파싱
  const periodParts = (rep.date || '').split('~').map(s=>s.trim());
  const rvFrom = periodParts[0] || new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  const rvTo   = periodParts[1] || new Date().toISOString().slice(0,10);
  const d1 = new Date(rvFrom), d2 = new Date(rvTo);
  const days = Math.max(1, Math.round((d2-d1)/86400000)+1);
  const dates = Array.from({length:days},(_,i)=>new Date(d1.getTime()+i*86400000));
  const chartLabels = dates.map(d=>`${d.getMonth()+1}/${d.getDate()}`);

  // 전환설정 지표 로드 → _rvConvCols 갱신
  _rvConvCols = [];
  if (currentAccount) {
    try {
      const {conversions} = await DEEPFLE_API.get(`/accounts/${currentAccount.id}/conversion-settings`);
      const active = (conversions||[]).filter(c=>c.active);
      _rvConvCols = active.map(c=>({key:'conv_'+c.id, label:c.solution_metric}));
      _rvConvCols.forEach(cc=>{ if(!_rvSelectedCols.includes(cc.key)) _rvSelectedCols.push(cc.key); });
    } catch(e){}
  }

  // metric_data API 로드
  let apiRows = [];
  if (!DEEPFLE_API.USE_MOCK && currentAccount) {
    try {
      const res = await DEEPFLE_API.get(`/accounts/${currentAccount.id}/metric-data?from=${rvFrom}&to=${rvTo}`);
      apiRows = res.data || [];
    } catch(e) {}
  }

  const useReal = apiRows.length > 0;
  const _seed = (s) => { let x=Math.abs(s)|1; return ()=>{ x=(x*1664525+1013904223)>>>0; return x/4294967296; }; };
  const manualData = _getManualConvData();
  const sumArr = arr => arr.reduce((a,b)=>a+b,0);

  let kpisAll, chartSeries;

  if (useReal) {
    // 매체별 집계
    const mediaAgg = {};
    apiRows.forEach(r => {
      if (!mediaAgg[r.media]) mediaAgg[r.media] = {cost:0,imp:0,click:0,conv:0,revenue:0};
      mediaAgg[r.media][r.metric_key] = (mediaAgg[r.media][r.metric_key]||0) + r.value;
    });
    const tot = Object.values(mediaAgg).reduce((a,m)=>({cost:a.cost+m.cost,imp:a.imp+m.imp,click:a.click+m.click,conv:a.conv+m.conv,revenue:a.revenue+m.revenue}), {cost:0,imp:0,click:0,conv:0,revenue:0});

    // 실 KPI
    kpisAll = [
      {label:'총 광고비', val:fmtW(Math.round(tot.cost)), change:'', up:true},
      {label:'총 노출수', val:fmtN(Math.round(tot.imp)), change:'', up:true},
      {label:'총 클릭수', val:fmtN(Math.round(tot.click)), change:'', up:true},
      {label:'전환수',    val:fmtN(Math.round(tot.conv)), change:'', up:true},
      {label:'ROAS',      val:tot.cost ? Math.round(tot.revenue/tot.cost*100)+'%' : '-', change:'', up:true},
    ];

    // 실 매체 테이블
    const MC_COLORS = {meta:'#1877F2',google:'#4285F4',kakao:'#FFCD00',naver_sa:'#03C75A'};
    _rvRows = Object.entries(mediaAgg).map(([mk, m]) => {
      const nm = MEDIA_LABELS[mk]||mk;
      const row = {
        name: nm,
        spend: fmtW(Math.round(m.cost)),
        imp:   fmtN(Math.round(m.imp)),
        click: fmtN(Math.round(m.click)),
        cvr:   fmtN(Math.round(m.conv)),
        roas:  m.cost  ? Math.round(m.revenue/m.cost*100)+'%' : '-',
        cpa:   m.conv  ? fmtW(Math.round(m.cost/m.conv))      : '-',
        ctr:   m.imp   ? (m.click/m.imp*100).toFixed(2)+'%'   : '-',
        cpc:   m.click ? fmtW(Math.round(m.cost/m.click))     : '-',
        cpm:   m.imp   ? fmtW(Math.round(m.cost/m.imp*1000))  : '-',
        _color: MC_COLORS[mk]||'#64748B',
      };
      _rvConvCols.forEach((cc, ci) => {
        const convId = parseInt(cc.key.replace('conv_',''));
        const manSum = manualData.filter(md=>md.media===nm && md.conv_id===convId).reduce((s,md)=>s+(Number(md.value)||0),0);
        row[cc.key] = manSum > 0 ? fmtN(manSum) : fmtN(Math.round(m.conv * ((0.35+_seed(nm.charCodeAt(0)*31+ci*17)()*0.3)/(_rvConvCols.length||1))));
      });
      return row;
    });

    // 전환 KPI 추가
    const convKpis = _rvConvCols.map(cc=>{
      const total = _rvRows.reduce((s,r)=>s+(parseInt((r[cc.key]||'0').replace(/,/g,''))||0),0);
      return {label:`총 ${cc.label}`, val:fmtN(total), change:'', up:true};
    });
    kpisAll = [...kpisAll, ...convKpis];

    // 차트용 시계열
    const activeKeys = [...new Set(apiRows.map(r=>r.media))];
    chartSeries = _pivotMetricData(apiRows, dates, activeKeys);

  } else {
    // Mock fallback
    const d = REPORT_DETAIL;
    _rvRows = d.mediaRows.map(row => {
      const r = {...row};
      _rvConvCols.forEach((cc, ci) => {
        const convId = parseInt(cc.key.replace('conv_',''));
        const manSum = manualData.filter(m=>m.media===row.name && m.conv_id===convId).reduce((s,m)=>s+(Number(m.value)||0),0);
        if (manSum > 0) { r[cc.key] = fmtN(manSum); }
        else {
          const cvrNum = parseInt((r.cvr||'0').replace(/,/g,''))||0;
          const frac = (0.35+_seed(row.name.charCodeAt(0)*31+ci*17)()*0.3)/(_rvConvCols.length||1);
          r[cc.key] = fmtN(Math.round(cvrNum*frac));
        }
      });
      return r;
    });
    const convKpis = _rvConvCols.map(cc=>{
      const total = _rvRows.reduce((s,r)=>s+(parseInt((r[cc.key]||'0').replace(/,/g,''))||0),0);
      return {label:`총 ${cc.label}`, val:fmtN(total), change:'+12.3%', up:true};
    });
    kpisAll = [...d.kpis, ...convKpis];
    chartSeries = null;
  }

  const rvCols = _rvBuildCols();

  panel.innerHTML = `
    <div class="rv-header">
      <div>
        <div class="rv-title">${rep.title}</div>
        <div style="font-size:12px;color:var(--gray-400);margin-top:2px;">기간: ${rep.date} · 계정: ${currentAccount.name}</div>
      </div>
      <div class="rv-actions">
        <button class="export-btn" onclick="downloadReportPDF()">📄 PDF</button>
        <button class="export-btn" onclick="downloadReportExcel()">📊 Excel</button>
        <button class="export-btn" onclick="downloadReportCSV()">🗂 CSV</button>
        <button class="btn btn-primary btn-sm" onclick="shareReport()">🔗 공유</button>
        <button class="modal-close" onclick="closeReportViewer()" style="margin-left:4px;">×</button>
      </div>
    </div>
    <div class="rv-body">

      <!-- KPI 요약 -->
      <div class="rv-kpi-grid">
        ${kpisAll.map(k=>`
          <div class="rv-kpi">
            <div class="rv-kpi-label">${k.label}</div>
            <div class="rv-kpi-val">${k.val}</div>
            ${k.change ? `<div class="rv-kpi-change" style="color:${k.up?'var(--success)':'var(--danger)'};">${k.up?'▲':'▼'} ${k.change}</div>` : ''}
          </div>`).join('')}
      </div>

      <!-- 추이 차트 + 매체 비중 -->
      <div class="rv-chart-row">
        <div class="card" style="padding:16px;">
          <div class="card-header" style="margin-bottom:12px;">
            <div class="card-title">일별 광고비 &amp; ROAS 추이</div>
            <div class="tab-pills">
              <div class="tab-pill active" onclick="switchRvTab(this,'daily')">일별</div>
              <div class="tab-pill" onclick="switchRvTab(this,'weekly')">주별</div>
            </div>
          </div>
          <canvas id="rvTrendChart" height="160"></canvas>
        </div>
        <div class="card" style="padding:16px;">
          <div class="card-header" style="margin-bottom:12px;"><div class="card-title">매체별 비중</div></div>
          <canvas id="rvDonutChart" height="160"></canvas>
        </div>
      </div>

      <!-- 매체별 성과 테이블 -->
      <div class="rv-section">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--gray-100);">
          <div class="rv-section-title" style="margin:0;padding:0;border:0;">매체별 상세 성과</div>
          <div class="mr-kpi-picker" style="position:relative;">
            <button class="btn btn-xs btn-outline" onclick="toggleRvColPicker()" title="컬럼 선택">⚙</button>
            <div class="mr-kpi-picker-drop" id="rvColPickerDrop" style="display:none;">${_rvColPickerHTML()}</div>
          </div>
        </div>
        <div style="overflow-x:auto;" id="rvMediaTableWrap">
          ${_rvRenderTable(_rvRows, rvCols)}
        </div>
      </div>

      <!-- AI 인사이트 -->
      <div class="rv-section">
        <div class="rv-section-title">인사이트</div>
        ${REPORT_DETAIL.insights.map(ins=>`
          <div class="rv-insight">
            <div class="rv-insight-title">${ins.title}</div>
            <div class="rv-insight-text">${ins.text}</div>
          </div>`).join('')}
      </div>

    </div>`;

  document.getElementById('reportViewerOverlay').classList.add('open');

  // 차트 렌더
  setTimeout(()=>{
    if(rvTrendChart) rvTrendChart.destroy();
    if(rvDonutChart) rvDonutChart.destroy();

    // 트렌드 데이터
    let trendLabels, trendCostData, trendRoasData;
    if (useReal && chartSeries?.length) {
      trendLabels = chartLabels;
      trendCostData = chartLabels.map((_,i) => sumArr(chartSeries.map(s=>s.cost[i]||0)));
      trendRoasData = chartLabels.map((_,i) => {
        const c = sumArr(chartSeries.map(s=>s.cost[i]||0));
        const rv = sumArr(chartSeries.map(s=>s.revenue[i]||0));
        return c ? Math.round(rv/c*100) : 0;
      });
    } else {
      trendLabels = Array.from({length:31},(_,i)=>`1/${i+1}`);
      trendCostData = Array.from({length:31},()=>Math.floor(Math.random()*1800000+700000));
      trendRoasData = Array.from({length:31},()=>Math.floor(Math.random()*200+310));
    }

    // 도넛 데이터
    let donutLabels, donutData, donutColors;
    if (useReal && chartSeries?.length) {
      donutLabels = chartSeries.map(s=>MEDIA_LABELS[s.key]||s.key);
      donutData = chartSeries.map(s=>Math.round(sumArr(s.cost)/10000)/100);
      const MC_C = {meta:'#1877F2',google:'#4285F4',kakao:'#FFCD00',naver_sa:'#03C75A'};
      donutColors = chartSeries.map(s=>MC_C[s.key]||'#64748B');
    } else {
      donutLabels = REPORT_DETAIL.mediaRows.map(m=>m.name);
      donutData = [12.4,9.8,7.2,6.5,3.8];
      donutColors = ['#4285f4','#ea4335','#fbbc04','#34a853','#9334e6'];
    }

    const rvCrosshair = {id:'rv_crosshair',afterDraw(chart){if(chart.tooltip?._active?.length){const x=chart.tooltip._active[0].element.x;const ctx=chart.ctx;ctx.save();ctx.beginPath();ctx.strokeStyle='#dadce0';ctx.lineWidth=1;ctx.moveTo(x,chart.chartArea.top);ctx.lineTo(x,chart.chartArea.bottom);ctx.stroke();ctx.restore();}}};
    const rvTCtx = document.getElementById('rvTrendChart');
    if(rvTCtx) {
      rvTrendChart = new Chart(rvTCtx, {
        type:'line',
        data:{labels:trendLabels,datasets:[
          {label:'광고비', data:trendCostData,
           borderColor:'#4285f4',backgroundColor:'#4285f418',tension:.4,borderWidth:2,fill:true,
           pointRadius:0,pointHoverRadius:5,pointBackgroundColor:'#4285f4',pointBorderColor:'#fff',pointBorderWidth:2,pointHitRadius:20,yAxisID:'y'},
          {label:'ROAS(%)', data:trendRoasData,
           borderColor:'#ea4335',backgroundColor:'transparent',tension:.4,borderWidth:2,fill:false,
           pointRadius:0,pointHoverRadius:5,pointBackgroundColor:'#ea4335',pointBorderColor:'#fff',pointBorderWidth:2,pointHitRadius:20,yAxisID:'y1'},
        ]},
        options:{responsive:true,interaction:{mode:'index',intersect:false},hover:{mode:'index',intersect:false},
          plugins:{legend:{position:'top',align:'start',labels:{font:{size:12},color:'#5f6368',usePointStyle:true,pointStyle:'line',boxWidth:18,padding:20}},
            tooltip:{backgroundColor:'#fff',titleColor:'#202124',bodyColor:'#5f6368',borderColor:'#dadce0',borderWidth:1,cornerRadius:8,padding:12,caretSize:6}},
          scales:{
            x:{grid:{display:false},ticks:{font:{size:11},color:'#80868b',maxRotation:0},border:{display:false}},
            y:{position:'left',grid:{color:'#f1f3f4',drawBorder:false},ticks:{callback:v=>fmtW(v),font:{size:11},color:'#4285f4',padding:8,maxTicksLimit:6},border:{display:false}},
            y1:{position:'right',grid:{drawOnChartArea:false},ticks:{callback:v=>v+'%',font:{size:11},color:'#ea4335',padding:8,maxTicksLimit:6},border:{display:false}}
          }},
        plugins:[rvCrosshair]
      });
    }
    const rvDCtx = document.getElementById('rvDonutChart');
    if(rvDCtx) {
      rvDonutChart = new Chart(rvDCtx, {
        type:'doughnut',
        data:{labels:donutLabels, datasets:[{data:donutData,backgroundColor:donutColors,borderWidth:2,borderColor:'#fff',hoverOffset:4}]},
        options:{responsive:true,cutout:'65%',plugins:{legend:{position:'right',labels:{font:{size:12},color:'#5f6368',usePointStyle:true,pointStyle:'circle',boxWidth:8,padding:16}},
          tooltip:{backgroundColor:'#fff',titleColor:'#202124',bodyColor:'#5f6368',borderColor:'#dadce0',borderWidth:1,cornerRadius:8,padding:12}}}
      });
    }
  }, 80);
}

function closeReportViewer(e) {
  if (e && e.target !== document.getElementById('reportViewerOverlay')) return;
  document.getElementById('reportViewerOverlay').classList.remove('open');
  if(rvTrendChart){rvTrendChart.destroy();rvTrendChart=null;}
  if(rvDonutChart){rvDonutChart.destroy();rvDonutChart=null;}
}

function switchRvTab(el, type) {
  el.closest('.tab-pills').querySelectorAll('.tab-pill').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  if(rvTrendChart) { rvTrendChart.data.datasets[0].data=Array.from({length:31},()=>Math.floor(Math.random()*1800000+700000)); rvTrendChart.update(); }
}

// ── PDF/HTML 공통 출력 헬퍼 ──
function _openOrDownloadHtml(html, filename) {
  const win = window.open('', '_blank', 'width=960,height=800');
  if (win) {
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 700);
  } else {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    showToast('팝업 차단 → HTML 파일 다운로드됨. 파일 열기 후 Ctrl+P → "PDF로 저장" 선택하세요.', 'info');
  }
}

// ── 리포트 PDF HTML 빌더 ──
function _buildReportPdfHtml(rep) {
  const d       = REPORT_DETAIL;
  const cols    = _rvBuildCols();
  const rows    = _rvRows || d.mediaRows;
  const today   = new Date().toLocaleDateString('ko-KR', {year:'numeric',month:'long',day:'numeric'});
  const accName = currentAccount?.name || 'DeepFle';
  const repType = rep.type || '광고 성과';
  const period  = rep.date || '-';

  // DOM에서 실제 KPI 값 추출
  const kpiCards = [...document.querySelectorAll('.rv-kpi')].map(el => ({
    label:  el.querySelector('.rv-kpi-label')?.textContent?.trim() || '',
    val:    el.querySelector('.rv-kpi-val')?.textContent?.trim()   || '',
    change: el.querySelector('.rv-kpi-change')?.textContent?.trim() || '',
    up:     (el.querySelector('.rv-kpi-change')?.style.color || '').includes('059669'),
  }));

  // 차트 이미지 (canvas → base64)
  const trendImg = rvTrendChart?.toBase64Image?.() || '';
  const donutImg = rvDonutChart?.toBase64Image?.() || '';

  // 인사이트
  const insights = [...document.querySelectorAll('.rv-insight')].map(el => ({
    title: el.querySelector('.rv-insight-title')?.textContent?.trim() || '',
    text:  el.querySelector('.rv-insight-text')?.textContent?.trim()  || '',
  }));
  if (!insights.length) d.insights.forEach((ins, i) => insights.push({ title: ins.title, text: ins.text }));

  const CSS = `
@page{size:A4 portrait;margin:0;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',-apple-system,sans-serif;color:#0F172A;font-size:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.cover{width:210mm;height:297mm;background:#7C3AED;display:flex;flex-direction:column;page-break-after:always;position:relative;overflow:hidden;}
.cover-deco1{position:absolute;bottom:-60px;right:-60px;width:280px;height:280px;background:rgba(255,255,255,.07);border-radius:50%;}
.cover-deco2{position:absolute;bottom:40px;right:60px;width:140px;height:140px;background:rgba(255,255,255,.06);border-radius:50%;}
.cover-top{padding:32px 40px 0;display:flex;align-items:center;justify-content:space-between;}
.cover-logo{font-size:22px;font-weight:700;color:rgba(255,255,255,.9);letter-spacing:-.5px;}
.cover-logo span{color:rgba(255,255,255,.4);}
.cover-date{font-size:10px;color:rgba(255,255,255,.45);}
.cover-main{flex:1;display:flex;flex-direction:column;justify-content:center;padding:0 40px;}
.cover-tag{display:inline-block;background:rgba(255,255,255,.15);color:rgba(255,255,255,.8);font-size:10px;letter-spacing:.8px;padding:5px 14px;border-radius:20px;margin-bottom:22px;text-transform:uppercase;width:fit-content;}
.cover-title{font-size:34px;font-weight:700;color:#fff;line-height:1.2;margin-bottom:16px;letter-spacing:-.5px;}
.cover-sub{font-size:13px;color:rgba(255,255,255,.6);line-height:1.8;}
.cover-bottom{padding:24px 40px;border-top:1px solid rgba(255,255,255,.15);display:flex;gap:32px;}
.cover-meta-lbl{font-size:10px;color:rgba(255,255,255,.45);margin-bottom:4px;}
.cover-meta-val{font-size:15px;font-weight:700;color:#fff;}
.sp{width:210mm;min-height:297mm;padding:14mm 15mm 12mm;page-break-before:always;display:flex;flex-direction:column;}
.section-hd{display:flex;align-items:flex-end;gap:10px;margin-bottom:18px;padding-bottom:10px;border-bottom:2.5px solid #7C3AED;}
.sn{font-size:26px;font-weight:700;color:#EDE9FE;line-height:1;letter-spacing:-1px;}
.st{font-size:15px;font-weight:700;color:#1E1B4B;}
.ss{font-size:10px;color:#94A3B8;margin-left:auto;}
.kpi-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:8px;}
.kpi-card{background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px 12px;}
.kpi-lbl{font-size:9px;color:#94A3B8;font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:7px;}
.kpi-val{font-size:16px;font-weight:700;color:#0F172A;margin-bottom:4px;}
.kpi-up{font-size:10px;color:#059669;} .kpi-dn{font-size:10px;color:#DC2626;}
.chart-row{display:grid;grid-template-columns:1.7fr 1fr;gap:12px;margin-top:18px;}
.chart-box{background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:12px;}
.chart-lbl{font-size:10px;font-weight:600;color:#475569;margin-bottom:8px;}
.chart-box img{width:100%;height:auto;display:block;}
.mtable{width:100%;border-collapse:collapse;font-size:11px;}
.mtable th{background:#7C3AED;color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:600;}
.mtable td{padding:7px 10px;border-bottom:1px solid #F1F5F9;vertical-align:middle;}
.mtable tr:last-child td{border-bottom:none;}
.mtable tr:nth-child(even) td{background:#FAFAFA;}
.media-nm{font-weight:600;color:#1E293B;}
.roas-pill{display:inline-block;background:#EDE9FE;color:#5B21B6;padding:2px 7px;border-radius:6px;font-size:10px;font-weight:600;}
.ins-card{border:1px solid #E2E8F0;border-left:4px solid #7C3AED;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:11px;background:#FAFAFA;}
.ins-title{font-size:12px;font-weight:700;color:#1E1B4B;margin-bottom:5px;}
.ins-text{font-size:11px;color:#475569;line-height:1.65;}
.comment-box{background:#EDE9FE;border-radius:10px;padding:14px 16px;margin-top:16px;}
.comment-lbl{font-size:10px;color:#6D28D9;font-weight:700;margin-bottom:6px;}
.comment-txt{font-size:11px;color:#3730A3;line-height:1.65;}
.pg-footer{margin-top:auto;padding-top:10px;border-top:.5px solid #E2E8F0;display:flex;justify-content:space-between;font-size:9px;color:#94A3B8;}`;

  const kpiGridHtml = (kpiCards.length ? kpiCards : d.kpis.map(k => ({...k, up: k.up}))).map(k => `
    <div class="kpi-card">
      <div class="kpi-lbl">${k.label}</div>
      <div class="kpi-val">${k.val}</div>
      <div class="${k.up ? 'kpi-up':'kpi-dn'}">${k.change}</div>
    </div>`).join('');

  const chartSection = (trendImg || donutImg) ? `
    <div class="chart-row">
      ${trendImg ? `<div class="chart-box"><div class="chart-lbl">일별 광고비 &amp; ROAS 추이</div><img src="${trendImg}"></div>` : ''}
      ${donutImg ? `<div class="chart-box"><div class="chart-lbl">매체별 비중</div><img src="${donutImg}"></div>` : ''}
    </div>` : '';

  const tableHtml = `
    <table class="mtable">
      <thead><tr><th>매체</th>${cols.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(m => `
        <tr>
          <td class="media-nm">${m.name}</td>
          ${cols.map(c => c.key === 'roas'
            ? `<td><span class="roas-pill">${m[c.key]||'-'}</span></td>`
            : `<td>${m[c.key]||'-'}</td>`).join('')}
        </tr>`).join('')}
      </tbody>
    </table>`;

  const insightHtml = insights.map((ins, i) => `
    <div class="ins-card">
      <div class="ins-title">${i+1}. ${ins.title}</div>
      <div class="ins-text">${ins.text}</div>
    </div>`).join('');

  const footer = (t) => `<div class="pg-footer"><span>DeepFle · ${accName}</span><span>${t}</span><span>${today}</span></div>`;

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><title>${rep.title}</title>
<style>${CSS}</style></head><body>

<div class="cover">
  <div class="cover-deco1"></div><div class="cover-deco2"></div>
  <div class="cover-top">
    <div class="cover-logo">Deep<span>Fle</span></div>
    <div class="cover-date">생성일 ${today}</div>
  </div>
  <div class="cover-main">
    <div class="cover-tag">${repType} 리포트</div>
    <div class="cover-title">${rep.title}</div>
    <div class="cover-sub">${accName}&nbsp;&nbsp;·&nbsp;&nbsp;${period}<br>${rep.media||'전체 매체'}</div>
  </div>
  <div class="cover-bottom">
    <div><div class="cover-meta-lbl">총 광고비</div><div class="cover-meta-val">${rep.spend||'-'}</div></div>
    <div><div class="cover-meta-lbl">ROAS</div><div class="cover-meta-val">${rep.roas||'-'}</div></div>
    <div><div class="cover-meta-lbl">전환수</div><div class="cover-meta-val">${rep.cvr||'-'}</div></div>
    <div><div class="cover-meta-lbl">매체 수</div><div class="cover-meta-val">${rows.length}개</div></div>
  </div>
</div>

<div class="sp">
  <div class="section-hd"><span class="sn">01</span><span class="st">핵심 성과 요약</span><span class="ss">기간: ${period}</span></div>
  <div class="kpi-grid">${kpiGridHtml}</div>
  ${rep._sendMsg ? `<div class="comment-box"><div class="comment-lbl">광고주 코멘트</div><div class="comment-txt">${rep._sendMsg}</div></div>` : ''}
  ${chartSection}
  ${footer('핵심 성과 요약')}
</div>

<div class="sp">
  <div class="section-hd"><span class="sn">02</span><span class="st">매체별 상세 성과</span><span class="ss">${rows.length}개 매체 · ${cols.length}개 지표</span></div>
  ${tableHtml}
  ${footer('매체별 성과')}
</div>

<div class="sp">
  <div class="section-hd"><span class="sn">03</span><span class="st">AI 인사이트 &amp; 권장 액션</span><span class="ss">${insights.length}개 항목</span></div>
  ${insightHtml}
  ${footer('AI 인사이트')}
</div>

</body></html>`;
}

// Report downloads
function downloadReportPDF() {
  const rep = reports[_rvCurrentIdx];
  if (!rep) { showToast('리포트 뷰어가 열려 있지 않습니다', 'warning'); return; }
  showToast('PDF 생성 중...', 'info');
  const html = _buildReportPdfHtml(rep);
  _openOrDownloadHtml(html, (rep.title||'report').replace(/\s+/g,'_') + '.html');
}

function downloadReportExcel() {
  const rep = reports[_rvCurrentIdx];
  if (!rep) return;
  showToast('Excel 파일 생성 중...','info');
  // Build CSV-like data from REPORT_DETAIL
  const d = REPORT_DETAIL;
  const cols = _rvBuildCols();
  let csv = '﻿'; // BOM for Excel UTF-8
  csv += rep.title + '\n';
  csv += '기간: ' + (rep.date||'') + ' | 계정: ' + (currentAccount?.name||'') + '\n\n';
  // KPI summary
  csv += 'KPI 요약\n';
  csv += d.kpis.map(k=>k.label).join(',') + '\n';
  csv += d.kpis.map(k=>k.val).join(',') + '\n\n';
  // Media table
  csv += '매체별 성과\n';
  csv += '매체,' + cols.map(c=>c.label).join(',') + '\n';
  d.mediaRows.forEach(m => {
    csv += m.name + ',' + cols.map(c=>(m[c.key]||'-').toString().replace(/,/g,'')).join(',') + '\n';
  });
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = (rep.title||'report').replace(/\s+/g,'_') + '.csv';
  a.click(); URL.revokeObjectURL(url);
  showToast('Excel(CSV) 파일이 다운로드되었습니다','success');
}

function downloadReportCSV() {
  downloadReportExcel(); // Same CSV logic
}

function shareReport() {
  const rep = reports[_rvCurrentIdx];
  const shareUrl = window.location.href.split('#')[0] + '#report=' + (_rvCurrentIdx||0);
  navigator.clipboard.writeText(shareUrl).catch(()=>{});
  showToast('공유 링크가 클립보드에 복사되었습니다: ' + shareUrl, 'success');
}


// ============================================================
// ATTRIBUTION  (Phase 2 — 링크별 성과 차트 + 퍼널)
// ============================================================

const LINK_DETAIL_DATA = {
  'https://deepfle.io/t/abc123': {
    clicks:[420,380,560,710,820,640,580,760,900,850,720,680,820,940,1020,880,760,840,920,1100,1050,980,860,740,820,900,940,1020,880,760],
    convs: [ 18, 14, 22, 28, 32, 25, 20, 29, 34, 31, 26, 24, 30, 36, 38, 33, 28, 31, 35, 42, 40, 37, 32, 27, 30, 34, 36, 39, 33, 28],
    funnel:[{step:'노출',val:284000,color:'#4F46E5'},{step:'클릭',val:8420,color:'#818CF8'},{step:'방문',val:6200,color:'#A5B4FC'},{step:'장바구니',val:1840,color:'#10B981'},{step:'구매',val:312,color:'#059669'}],
    utms:{source:'kakao',medium:'cpc',campaign:'jan_newproduct',content:'banner_01',term:''},
  },
  'https://deepfle.io/t/def456': {
    clicks:[210,240,280,260,320,290,310,340,380,360,300,280,320,360,400,380,320,350,390,430,410,380,340,300,330,360,390,420,380,340],
    convs: [  8,  9, 11, 10, 13, 11, 12, 13, 15, 14, 11, 10, 12, 14, 16, 15, 12, 13, 15, 17, 16, 15, 13, 11, 12, 14, 15, 16, 15, 13],
    funnel:[{step:'노출',val:180000,color:'#4F46E5'},{step:'클릭',val:5230,color:'#818CF8'},{step:'방문',val:4100,color:'#A5B4FC'},{step:'장바구니',val:820,color:'#10B981'},{step:'구매',val:198,color:'#059669'}],
    utms:{source:'naver',medium:'cpc',campaign:'jan_keyword',content:'',term:'신제품 브랜드'},
  },
  'https://deepfle.io/t/ghi789': {
    clicks:[640,720,680,760,820,900,840,780,860,940,880,820,900,980,1060,1000,940,980,1060,1140,1080,1020,960,880,940,1000,1040,1120,1060,980],
    convs: [ 26, 29, 27, 31, 33, 37, 34, 32, 35, 38, 36, 33, 37, 40, 43, 41, 38, 40, 43, 47, 44, 41, 39, 36, 38, 41, 42, 46, 43, 39],
    funnel:[{step:'노출',val:420000,color:'#4F46E5'},{step:'클릭',val:12800,color:'#818CF8'},{step:'방문',val:9600,color:'#A5B4FC'},{step:'장바구니',val:2800,color:'#10B981'},{step:'구매',val:421,color:'#059669'}],
    utms:{source:'meta',medium:'paid_social',campaign:'new_year_event',content:'video_01',term:''},
  },
};
let attrClickChart;

function renderAttribution() {
  const editable = CAN_EDIT(currentUser.role);
  document.getElementById('attrReadonlyBanner').innerHTML = !editable
    ? `<div class="readonly-banner"><span class="readonly-banner-icon">👁️</span><span>조회 전용 — 추적 링크 생성은 사용자(USER) 이상 권한이 필요합니다.</span></div>` : '';
  document.getElementById('attrActions').innerHTML = editable
    ? `<button class="btn btn-primary btn-sm" onclick="showModal('linkCreate')">+ 링크 생성</button>` : '';
  document.getElementById('attrCreateArea').innerHTML = editable ? `
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header"><div class="card-title">빠른 링크 생성</div></div>
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
        <div class="form-group" style="flex:1;min-width:160px;margin:0"><label class="form-label">캠페인명</label><input class="form-input" id="qcName" placeholder="캠페인명"></div>
        <div class="form-group" style="flex:2;min-width:200px;margin:0"><label class="form-label">원본 URL</label><input class="form-input" id="qcUrl" placeholder="https://"></div>
        <div class="form-group" style="flex:0;margin:0"><label class="form-label">매체</label><select class="form-select" id="qcMedia"><option>카카오</option><option>네이버</option><option>구글</option><option>메타</option></select></div>
        <button class="btn btn-primary" onclick="quickGenLink()">생성</button>
      </div>
      <div id="quickLinkResult" style="margin-top:10px;"></div>
    </div>` : '';
  renderLinkTable();
}

function renderLinkTable() {
  document.getElementById('linkTable').innerHTML = links.map((l,i)=>`
    <tr style="cursor:pointer;" onclick="openAttrDetail(${i})">
      <td style="font-weight:600;">${l.name}</td>
      <td><span class="chip">${l.media}</span></td>
      <td><span class="link-url">${l.url}</span></td>
      <td class="text-right num">${l.click.toLocaleString()}</td>
      <td class="text-right num">${l.cvr.toLocaleString()}</td>
      <td class="text-right">${(l.cvr/l.click*100).toFixed(2)}%</td>
      <td style="font-size:11px;color:var(--gray-400);">${l.date}</td>
      <td><button class="copy-btn" onclick="event.stopPropagation();copyText('${l.url}')">복사</button></td>
    </tr>`).join('');
}

function openAttrDetail(idx) {
  const link = links[idx];
  const d = LINK_DETAIL_DATA[link.url] || LINK_DETAIL_DATA['https://deepfle.io/t/abc123'];
  const labels = Array.from({length:30},(_,i)=>`1/${i+1}`);
  const maxFunnel = d.funnel[0].val;
  const ctr = (link.click / d.funnel[0].val * 100).toFixed(2);
  const cvr = (link.cvr / link.click * 100).toFixed(2);

  document.getElementById('attrDetailPanel').innerHTML = `
    <div class="ad-header">
      <div>
        <div class="ad-title">${link.name}</div>
        <div style="font-size:11px;color:var(--gray-400);margin-top:2px;">${link.media} · ${link.date} · <span class="link-url">${link.url}</span></div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="copy-btn" onclick="copyText('${link.url}')">링크 복사</button>
        <button class="modal-close" onclick="closeAttrDetail()">×</button>
      </div>
    </div>
    <div class="ad-body">

      <!-- 요약 KPI -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px;">
        <div class="rv-kpi"><div class="rv-kpi-label">총 클릭</div><div class="rv-kpi-val">${link.click.toLocaleString()}</div></div>
        <div class="rv-kpi"><div class="rv-kpi-label">총 전환</div><div class="rv-kpi-val">${link.cvr.toLocaleString()}</div></div>
        <div class="rv-kpi"><div class="rv-kpi-label">CTR</div><div class="rv-kpi-val">${ctr}%</div></div>
        <div class="rv-kpi"><div class="rv-kpi-label">전환율</div><div class="rv-kpi-val" style="color:var(--success);">${cvr}%</div></div>
      </div>

      <!-- 클릭 추이 차트 -->
      <div class="card" style="margin-bottom:16px;padding:16px;">
        <div class="card-header" style="margin-bottom:12px;">
          <div class="card-title">일별 클릭 & 전환 추이</div>
          <div style="display:flex;gap:12px;font-size:11px;color:var(--gray-400);">
            <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:2px;background:#4F46E5;display:inline-block;border-radius:1px;"></span>클릭</span>
            <span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:2px;background:#10B981;display:inline-block;border-radius:1px;"></span>전환</span>
          </div>
        </div>
        <canvas id="attrClickChart" height="140"></canvas>
      </div>

      <!-- 전환 퍼널 -->
      <div class="card" style="margin-bottom:16px;padding:16px;">
        <div class="card-header" style="margin-bottom:12px;"><div class="card-title">전환 퍼널</div></div>
        <div class="funnel-wrap">
          ${d.funnel.map((f,i)=>{
            const pct = Math.round(f.val/maxFunnel*100);
            const rate = i>0 ? `(${(f.val/d.funnel[i-1].val*100).toFixed(1)}%)` : '';
            return `<div class="funnel-step">
              <div class="funnel-label">${f.step}</div>
              <div class="funnel-bar-wrap">
                <div class="funnel-bar" style="width:${pct}%;background:${f.color};">${pct>8?f.val.toLocaleString():''}</div>
              </div>
              <div class="funnel-val">${f.val.toLocaleString()}</div>
              <div class="funnel-rate" style="color:${i===0?'var(--primary)':'var(--gray-400)'};">${rate}</div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <!-- UTM 파라미터 -->
      <div class="card" style="padding:16px;">
        <div class="card-header" style="margin-bottom:12px;"><div class="card-title">UTM 파라미터</div></div>
        <table class="utm-table">
          <tr><td>utm_source</td><td><span class="utm-val">${d.utms.source}</span></td></tr>
          <tr><td>utm_medium</td><td><span class="utm-val">${d.utms.medium}</span></td></tr>
          <tr><td>utm_campaign</td><td><span class="utm-val">${d.utms.campaign}</span></td></tr>
          ${d.utms.content?`<tr><td>utm_content</td><td><span class="utm-val">${d.utms.content}</span></td></tr>`:''}
          ${d.utms.term?`<tr><td>utm_term</td><td><span class="utm-val">${d.utms.term}</span></td></tr>`:''}
          <tr><td>추적 URL</td><td><span class="utm-val" style="color:var(--primary);">${link.url}</span></td></tr>
        </table>
      </div>

    </div>`;

  document.getElementById('attrDetailOverlay').classList.add('open');

  setTimeout(()=>{
    if(attrClickChart) attrClickChart.destroy();
    const ctx = document.getElementById('attrClickChart');
    if(ctx) {
      attrClickChart = new Chart(ctx, {
        type:'line',
        data:{labels, datasets:[
          {label:'클릭',data:d.clicks,borderColor:'#4F46E5',backgroundColor:'rgba(79,70,229,.08)',tension:.4,yAxisID:'y'},
          {label:'전환',data:d.convs, borderColor:'#10B981',backgroundColor:'rgba(16,185,129,.08)',tension:.4,yAxisID:'y1'},
        ]},
        options:{responsive:true,interaction:{mode:'index',intersect:false},
          plugins:{legend:{display:false}},
          scales:{
            y: {position:'left', ticks:{font:{size:10}}},
            y1:{position:'right',grid:{drawOnChartArea:false},ticks:{font:{size:10}}}
          }}
      });
    }
  }, 80);
}

function closeAttrDetail(e) {
  if (e && e.target !== document.getElementById('attrDetailOverlay')) return;
  document.getElementById('attrDetailOverlay').classList.remove('open');
  if(attrClickChart){attrClickChart.destroy();attrClickChart=null;}
}

function quickGenLink() {
  const name = document.getElementById('qcName').value || '링크';
  const url = `https://deepfle.io/t/${Math.random().toString(36).substr(2,6)}`;
  document.getElementById('quickLinkResult').innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--gray-50);border-radius:8px;">
      <span style="font-size:12px;font-weight:600;color:var(--gray-600);">${name}</span>
      <span class="link-url">${url}</span>
      <button class="copy-btn" onclick="copyText('${url}')">복사</button>
    </div>`;
}

function addLink() {
  const name=document.getElementById('lcName').value||'새 링크';
  const media=document.getElementById('lcMedia').value;
  const url=`https://deepfle.io/t/${Math.random().toString(36).substr(2,6)}`;
  links.unshift({name,media,url,click:0,cvr:0,date:new Date().toLocaleDateString('ko')});
  closeModal('linkCreate'); renderLinkTable(); showToast('추적 링크가 생성되었습니다','success');
}

function copyText(text) {
  navigator.clipboard.writeText(text).catch(()=>{});
  showToast('클립보드에 복사되었습니다','success');
}

// ============================================================
// AUDIENCE
// ============================================================
const SYNC_META = {
  synced:  {label:'동기화됨',  cls:'synced'},
  syncing: {label:'동기화 중', cls:'syncing'},
  error:   {label:'동기화 실패',cls:'error'},
  idle:    {label:'대기 중',   cls:'idle'},
};

function renderAudience() {
  const editable = CAN_EDIT(currentUser.role);
  document.getElementById('audReadonlyBanner').innerHTML = !editable
    ? `<div class="readonly-banner"><span class="readonly-banner-icon">👁️</span><span>조회 전용 — 오디언스 생성은 사용자(USER) 이상 권한이 필요합니다.</span></div>` : '';
  document.getElementById('audActions').innerHTML = editable
    ? `<button class="btn btn-primary btn-sm" onclick="showModal('audienceCreate')">+ 오디언스 생성</button>` : '';

  const typeTxt={방문자:'#1D4ED8','구매자':'#16A34A','유사 타겟':'#92400E','커스텀':'#7C3AED'};
  document.getElementById('audienceGrid').innerHTML = audiences.map((a,i)=>{
    const syncRows = a.platforms.map(p=>{
      const st = (a.sync && a.sync[p]) || 'idle';
      const meta = SYNC_META[st];
      return `<div class="sync-platform-row">
        <span style="font-weight:600;color:var(--gray-600);">${p}</span>
        <span class="sync-status-text"><span class="sync-dot ${meta.cls}"></span>${meta.label}</span>
      </div>`;
    }).join('');
    return `
    <div class="audience-card">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:${typeTxt[a.type]||'#666'};margin-bottom:7px;">${a.type}</div>
      <div style="font-size:14px;font-weight:700;margin-bottom:3px;">${a.name}</div>
      <div style="font-size:11px;color:var(--gray-400);margin-bottom:6px;">${a.size}</div>
      ${a.conditions?`<div style="font-size:11px;color:var(--gray-600);background:var(--gray-50);border-radius:6px;padding:6px 9px;margin-bottom:10px;line-height:1.5;">🎯 ${a.conditions}</div>`:''}
      <div style="border-top:1px solid var(--gray-100);padding-top:8px;margin-bottom:8px;">${syncRows}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding-top:8px;border-top:1px solid var(--gray-100);">
        <div><div style="font-size:10px;color:var(--gray-400);">ROAS</div><div style="font-size:14px;font-weight:700;color:var(--success);">${a.roas}</div></div>
        <div><div style="font-size:10px;color:var(--gray-400);">CPA</div><div style="font-size:14px;font-weight:700;">${a.cpa}</div></div>
      </div>
      ${editable?`<div style="display:flex;gap:6px;margin-top:12px;">
        <button class="btn btn-xs btn-outline" style="flex:1" onclick="syncAudience(${i})">🔄 재동기화</button>
        <button class="btn btn-xs btn-danger-outline" onclick="audiences.splice(${i},1);_saveAudiences();renderAudience();showToast('삭제됨','success')">삭제</button>
      </div>`:''}
    </div>`;
  }).join('');
}

function syncAudience(i) {
  const a = audiences[i];
  a.platforms.forEach(p=>{ if(a.sync) a.sync[p]='syncing'; });
  renderAudience();
  showToast(`"${a.name}" 매체 동기화를 시작합니다`,'info');
  setTimeout(()=>{
    a.platforms.forEach(p=>{ if(a.sync) a.sync[p]='synced'; });
    _saveAudiences();
    renderAudience();
    showToast(`"${a.name}" 전 매체 동기화 완료`,'success');
  }, 1500);
}

// ── 세그먼트 빌더 ──
const SEG_FIELDS = {
  '인구통계': ['나이대','성별','지역','언어'],
  '행동':     ['사이트 방문','구매 이력','장바구니 담기','앱 실행','영상 시청'],
  '관심사':   ['패션/뷰티','IT/가전','식품','여행','육아','스포츠'],
  '기기':     ['모바일','데스크톱','iOS','Android'],
};
const SEG_OPERATORS = ['포함','제외','≥ 이상','≤ 이하'];
const SEG_VALUE_SCHEMA = {
  '나이대':      { type:'multicheck', opts:['10대','20대','30대','40대','50대','60대+'], default:'20대,30대' },
  '성별':        { type:'radio',      opts:['전체','남성','여성'],                        default:'전체' },
  '지역':        { type:'multicheck', opts:['서울','경기','인천','부산','대구','광주','대전','울산','강원','충청','전라','경상','제주'], default:'서울' },
  '언어':        { type:'radio',      opts:['한국어','영어','일본어','중국어'],             default:'한국어' },
  '사이트 방문':  { type:'period',  unit:'일', max:180, default:'30' },
  '구매 이력':   { type:'period',  unit:'일', max:365, default:'30', extRequired:['ga4','acecounter'] },
  '장바구니 담기':{ type:'period',  unit:'일', max:180, default:'14' },
  '앱 실행':     { type:'period',  unit:'일', max:90,  default:'7',  extRequired:['airbridge','adjust','appsflyer'] },
  '영상 시청':   { type:'percent', default:'50' },
  '패션/뷰티':   { type:'level' }, 'IT/가전':{ type:'level' }, '식품':{ type:'level' },
  '여행':        { type:'level' }, '육아':   { type:'level' }, '스포츠':{ type:'level' },
};
let segConditions = [];
let segMatchType = 'AND';

function _segDefaultVal(field) {
  const s = SEG_VALUE_SCHEMA[field];
  if (!s) return '';
  if (s.type === 'multicheck') return s.default || s.opts[0];
  if (s.type === 'radio')      return s.default || s.opts[0];
  if (s.type === 'level')      return '관심 있음';
  return s.default || '';
}

function _renderSegValUI(field, val, idx) {
  const s = SEG_VALUE_SCHEMA[field];
  const extConn = _getExtConnected();
  if (s?.extRequired) {
    const missing = s.extRequired.filter(r => !extConn[r]);
    if (missing.length === s.extRequired.length) {
      const names = s.extRequired.slice(0,2).map(r => EXT_SOLUTIONS.find(e=>e.id===r)?.name||r).join(' · ');
      return `<span style="font-size:10px;color:#92400E;background:#FFFBEB;border:1px solid #FCD34D;border-radius:5px;padding:3px 8px;">⚠️ ${names} 연동 필요</span>`;
    }
  }
  if (!s || s.type === 'level') {
    const opts = ['관심 있음','매우 관심'];
    const cur = val || opts[0];
    return `<div class="seg-radio-group">${opts.map(o=>`<label class="seg-check-lbl"><input type="radio" name="segv_${idx}" value="${o}" ${cur===o?'checked':''} onchange="updateSegCond(${idx},'value',this.value);recalcReach()"> ${o}</label>`).join('')}</div>`;
  }
  switch (s.type) {
    case 'multicheck': {
      const sel = (val||s.default||'').split(',').map(v=>v.trim()).filter(Boolean);
      return `<div class="seg-multicheck" id="segMC_${idx}">${s.opts.map(o=>`<label class="seg-check-lbl"><input type="checkbox" value="${o}" ${sel.includes(o)?'checked':''} onchange="_segUpdateMulti(${idx})"> ${o}</label>`).join('')}</div>`;
    }
    case 'radio': {
      const cur = val || s.default || s.opts[0];
      return `<div class="seg-radio-group">${s.opts.map(o=>`<label class="seg-check-lbl"><input type="radio" name="segv_${idx}" value="${o}" ${cur===o?'checked':''} onchange="updateSegCond(${idx},'value',this.value);recalcReach()"> ${o}</label>`).join('')}</div>`;
    }
    case 'period':
      return `<div class="seg-period-wrap">최근&nbsp;<input class="seg-period-input" type="number" min="1" max="${s.max||365}" value="${val||s.default||'30'}" oninput="updateSegCond(${idx},'value',this.value);recalcReach()">&nbsp;${s.unit}</div>`;
    case 'percent':
      return `<div class="seg-period-wrap"><input class="seg-period-input" type="number" min="1" max="100" value="${val||'50'}" oninput="updateSegCond(${idx},'value',this.value);recalcReach()">&nbsp;% 이상 시청</div>`;
  }
  return `<input class="seg-select" style="width:90px;" value="${val||''}" onchange="updateSegCond(${idx},'value',this.value)" placeholder="값">`;
}

function _segUpdateMulti(idx) {
  const checks = document.querySelectorAll(`#segMC_${idx} input:checked`);
  const val = Array.from(checks).map(c=>c.value).join(', ');
  if (val) segConditions[idx].value = val;
  recalcReach();
}

function initSegBuilder() {
  segConditions = [{category:'행동', field:'사이트 방문', op:'포함', value:'30'}];
  segMatchType = 'AND';
  renderSegBuilder();
  recalcReach();
}

function renderSegBuilder() {
  const el = document.getElementById('segBuilder');
  if (!el) return;
  el.innerHTML = `
    <div class="seg-group">
      <div class="seg-group-header">
        <span class="seg-group-label">다음 조건을 만족하는 사용자</span>
        <div class="seg-andor">
          <span class="seg-andor-btn ${segMatchType==='AND'?'active':''}" onclick="setSegMatch('AND')">AND (모두)</span>
          <span class="seg-andor-btn ${segMatchType==='OR'?'active':''}" onclick="setSegMatch('OR')">OR (하나)</span>
        </div>
      </div>
      ${segConditions.map((c,i)=>`
        <div class="seg-cond" style="flex-wrap:wrap;align-items:flex-start;padding-bottom:6px;">
          <select class="seg-select" style="margin-top:2px;" onchange="updateSegCond(${i},'category',this.value)">
            ${Object.keys(SEG_FIELDS).map(cat=>`<option ${c.category===cat?'selected':''}>${cat}</option>`).join('')}
          </select>
          <select class="seg-select" style="margin-top:2px;" onchange="updateSegCond(${i},'field',this.value)">
            ${SEG_FIELDS[c.category].map(f=>`<option ${c.field===f?'selected':''}>${f}</option>`).join('')}
          </select>
          <select class="seg-select" style="margin-top:2px;" onchange="updateSegCond(${i},'op',this.value)">
            ${SEG_OPERATORS.map(o=>`<option ${c.op===o?'selected':''}>${o}</option>`).join('')}
          </select>
          <div class="seg-val-wrap" style="margin-top:4px;">${_renderSegValUI(c.field, c.value, i)}</div>
          ${segConditions.length>1?`<span class="seg-cond-remove" style="margin-top:4px;" onclick="removeSegCondition(${i})">×</span>`:''}
        </div>
      `).join('')}
    </div>`;
}

function setSegMatch(t){ segMatchType=t; renderSegBuilder(); recalcReach(); }
function addSegCondition(){
  segConditions.push({category:'관심사', field:'패션/뷰티', op:'포함', value:_segDefaultVal('패션/뷰티')});
  renderSegBuilder(); recalcReach();
}
function removeSegCondition(i){ segConditions.splice(i,1); renderSegBuilder(); recalcReach(); }
function updateSegCond(i, key, val) {
  segConditions[i][key] = val;
  if (key === 'category') {
    segConditions[i].field = SEG_FIELDS[val][0];
    segConditions[i].value = _segDefaultVal(SEG_FIELDS[val][0]);
  }
  if (key === 'field') segConditions[i].value = _segDefaultVal(val);
  renderSegBuilder(); recalcReach();
}

function recalcReach() {
  const TOTAL = 1240000;
  const isLL = document.getElementById('audType')?.value === '유사 타겟';
  let reach;
  if (isLL) {
    const seedIdx = document.getElementById('llSeed')?.value;
    const ratio = parseInt(document.querySelector('#lookalikeSec input[type=range]')?.value||'3');
    const seed = seedIdx !== '' && audiences[seedIdx] ? audiences[seedIdx] : null;
    reach = seed ? Math.round(seed.reach * ratio * 6) : Math.round(TOTAL * 0.15);
  } else if (segMatchType === 'AND') {
    reach = Math.round(TOTAL / Math.pow(1.8, segConditions.length));
  } else {
    reach = Math.round(TOTAL * (1 - Math.pow(0.55, segConditions.length)));
  }
  reach = Math.max(1200, reach);
  const pct = Math.min(100, Math.round(reach/TOTAL*100));
  const numEl = document.getElementById('segReachNum');
  const fillEl = document.getElementById('segReachFill');
  if (numEl) numEl.textContent = '약 ' + reach.toLocaleString() + '명';
  if (fillEl) fillEl.style.width = pct + '%';
  return reach;
}

function _onAudTypeChange() {
  const isLL = document.getElementById('audType')?.value === '유사 타겟';
  const segSec = document.getElementById('segBuilderSec');
  const llSec  = document.getElementById('lookalikeSec');
  if (segSec) segSec.style.display = isLL ? 'none' : '';
  if (llSec)  llSec.style.display  = isLL ? '' : 'none';
  if (isLL) _renderLookalikeUI();
}

function _renderLookalikeUI() {
  const seeds = audiences.filter(a => a.type !== '유사 타겟');
  document.getElementById('lookalikeSec').innerHTML = `
    <div style="background:var(--primary-light);border:1px solid #C7D2FE;border-radius:10px;padding:14px 16px;margin-bottom:14px;">
      <div style="font-size:12px;font-weight:700;color:var(--primary);margin-bottom:10px;">🎯 유사 타겟 설정</div>
      <div class="form-group" style="margin-bottom:12px;">
        <label class="form-label" style="font-size:12px;">시드 오디언스 <span style="font-size:10px;color:var(--gray-400);">— 유사 타겟의 기반이 될 오디언스</span></label>
        <select class="form-select" id="llSeed" onchange="recalcReach()">
          ${seeds.length ? seeds.map(a=>`<option value="${audiences.indexOf(a)}">${a.name} · ${a.size}</option>`).join('') : '<option value="">생성된 오디언스가 없습니다</option>'}
        </select>
      </div>
      <div>
        <label class="form-label" style="font-size:12px;">확장 비율&nbsp;
          <span id="llRatioLbl" style="color:var(--primary);font-weight:700;">3%</span>
          <span style="font-size:10px;color:var(--gray-400);margin-left:4px;">— 값이 클수록 도달↑ 정밀도↓</span>
        </label>
        <input type="range" min="1" max="10" value="3" style="width:100%;accent-color:var(--primary);margin:6px 0;"
          oninput="document.getElementById('llRatioLbl').textContent=this.value+'%';recalcReach()">
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--gray-400);">
          <span>정밀 (1%)</span><span>광범위 (10%)</span>
        </div>
      </div>
    </div>`;
  recalcReach();
}

function addAudience() {
  const name = document.getElementById('audName').value.trim() || '새 오디언스';
  const type = document.getElementById('audType').value;
  const plats = Array.from(document.getElementById('audPlatform').selectedOptions).map(o=>o.value);
  const platforms = plats.length ? plats : ['카카오'];
  const sync = {}; platforms.forEach(p=>sync[p]='syncing');
  let reach, conditions;
  if (type === '유사 타겟') {
    const seedIdx = document.getElementById('llSeed')?.value;
    const ratio = document.querySelector('#lookalikeSec input[type=range]')?.value || '3';
    const seed = seedIdx !== '' && audiences[seedIdx] ? audiences[seedIdx] : null;
    reach = recalcReach();
    conditions = seed ? `시드: "${seed.name}" · 확장 ${ratio}%` : `유사 확장 ${ratio}%`;
  } else {
    reach = recalcReach();
    conditions = segConditions.map(c=>`${c.field} ${c.op}${c.value?' '+c.value:''}`).join(segMatchType==='AND'?' + ':' / ');
  }
  const aud = {name, type, size:'약 '+reach.toLocaleString()+'명', reach, platforms, roas:'분석중', cpa:'-', sync, conditions};
  audiences.unshift(aud);
  _saveAudiences();
  closeModal('audienceCreate');
  renderAudience();
  showToast(`"${name}" 오디언스 생성 · ${platforms.length}개 매체 동기화 중`,'success');
  logActivity(`"${name}" 오디언스 생성 (도달 ${reach.toLocaleString()}명)`);
  setTimeout(()=>{ platforms.forEach(p=>aud.sync[p]='synced'); aud.roas='측정 대기'; _saveAudiences(); renderAudience(); }, 1800);
}

// ============================================================
// WORKSPACE
// ============================================================
// @멘션 하이라이트
function highlightMentions(text) {
  return text.replace(/@([가-힣A-Za-z0-9_]+)/g, '<span class="mention">@$1</span>');
}

// 활동 기록 헬퍼
function logActivity(text, diff=null) {
  activities.unshift({
    id:'a'+Date.now(), user:currentUser.name, avatar:currentUser.avatar,
    avatarColor:currentUser.avatarColor, time:'방금 전', role:currentUser.role,
    text, diff, likes:0, liked:false, comments:[]
  });
}

function renderWorkspace() {
  const r = currentUser.role;
  const editable = CAN_EDIT(r);

  // Activity feed (좋아요 + 코멘트)
  document.getElementById('activityFeed').innerHTML = activities.map((a)=>{
    const roleMeta = ROLE_META[a.role];
    const comments = (a.comments||[]).map(c=>`
      <div class="comment-item">
        <div class="comment-avatar" style="background:${c.color}">${c.avatar}</div>
        <div class="comment-body">
          <div class="comment-head"><span class="comment-name">${c.user}</span><span class="comment-time">${c.time}</span></div>
          <div class="comment-text">${highlightMentions(c.text)}</div>
        </div>
      </div>`).join('');
    const commentInput = editable ? `
      <div class="comment-input-row">
        <div class="mention-dropdown" id="mentionDrop-${a.id}"></div>
        <input class="comment-input" id="cmtInput-${a.id}" placeholder="댓글 작성… (@로 멘션)"
               oninput="onCommentInput('${a.id}',this)" onkeydown="if(event.key==='Enter')addComment('${a.id}')">
        <span class="comment-send" onclick="addComment('${a.id}')">전송</span>
      </div>` : '';
    return `<div class="act-item">
      <div class="act-avatar" style="background:${a.avatarColor}">${a.avatar}</div>
      <div class="act-body">
        <div class="act-header">
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="act-user">${a.user}</span>
            <span class="badge ${roleMeta.badgeClass}" style="font-size:10px;padding:1px 6px;">${roleMeta.label}</span>
          </div>
          <span class="act-time">${a.time}</span>
        </div>
        <div class="act-text">${a.text}</div>
        ${a.diff?`<div class="act-diff"><div class="diff-old">- ${a.diff.old}</div><div class="diff-new">+ ${a.diff.new}</div></div>`:''}
        <div class="act-actions">
          <span class="act-action-btn ${a.liked?'liked':''}" onclick="toggleLike('${a.id}')">${a.liked?'❤️':'🤍'} ${a.likes||0}</span>
          <span class="act-action-btn">💬 ${(a.comments||[]).length}</span>
        </div>
        ${comments?`<div class="comment-thread">${comments}</div>`:''}
        ${commentInput}
      </div>
    </div>`;
  }).join('');

  // Team members (show members of current account)
  const _allUsers = DEEPFLE_API.live ? BACKEND_USERS : ALL_PLATFORM_USERS;
  const accUsers = _allUsers.filter(u=>(u.accounts||[]).includes(currentAccount?.id));
  document.getElementById('wsInviteBtn').innerHTML = IS_MASTER(r)
    ? `<button class="btn btn-primary btn-xs" onclick="showModal('inviteUser')">+ 초대</button>` : '';
  document.getElementById('teamMembers').innerHTML = accUsers.map(u=>{
    const meta = ROLE_META[u.role];
    return `<div class="team-member">
      <div class="member-avatar" style="background:${u.avatarColor}">${u.name[0]}</div>
      <div class="member-info">
        <div class="member-name">${u.name}</div>
        <div class="member-role-tag">${u.email}</div>
      </div>
      <span class="badge ${meta.badgeClass}">${meta.icon} ${meta.label}</span>
    </div>`;
  }).join('');

  // Notification toggles
  document.getElementById('notifSettings').innerHTML = [
    {label:'규칙 실행 알림', on:true, edit:editable},
    {label:'주간 리포트 발송', on:false, edit:editable},
  ].map(n=>`<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;">
    <span>${n.label}</span>
    <div class="toggle ${n.on?'on':''} ${n.edit?'':'disabled'}" onclick="${n.edit?"this.classList.toggle('on')":''}" title="${n.edit?'':'편집 권한 필요'}"></div>
  </div>`).join('');
}

// ── 좋아요 ──
function toggleLike(id) {
  const a = activities.find(x=>x.id===id);
  if (!a) return;
  a.liked = !a.liked;
  a.likes = (a.likes||0) + (a.liked?1:-1);
  renderWorkspace();
}

// ── 코멘트 입력: @멘션 드롭다운 ──
function onCommentInput(id, input) {
  const drop = document.getElementById('mentionDrop-'+id);
  if (!drop) return;
  const val = input.value;
  const m = val.match(/@([가-힣A-Za-z0-9_]*)$/);
  if (m) {
    const q = m[1];
    const _allU = DEEPFLE_API.live ? BACKEND_USERS : ALL_PLATFORM_USERS;
    const accUsers = _allU.filter(u=>(u.accounts||[]).includes(currentAccount?.id) && u.name.includes(q));
    if (accUsers.length) {
      drop.innerHTML = accUsers.map(u=>`
        <div class="mention-opt" onclick="pickMention('${id}','${u.name}')">
          <div class="mention-opt-avatar" style="background:${u.avatarColor}">${u.name[0]}</div>
          <div><div style="font-weight:600;">${u.name}</div><div style="font-size:10px;color:var(--gray-400);">${u.email}</div></div>
        </div>`).join('');
      drop.classList.add('open');
      return;
    }
  }
  drop.classList.remove('open');
}

function pickMention(id, name) {
  const input = document.getElementById('cmtInput-'+id);
  input.value = input.value.replace(/@([가-힣A-Za-z0-9_]*)$/, '@'+name+' ');
  document.getElementById('mentionDrop-'+id).classList.remove('open');
  input.focus();
}

function addComment(id) {
  const input = document.getElementById('cmtInput-'+id);
  const text = input.value.trim();
  if (!text) return;
  const a = activities.find(x=>x.id===id);
  if (!a) return;
  a.comments = a.comments || [];
  a.comments.push({user:currentUser.name, avatar:currentUser.avatar, color:currentUser.avatarColor, time:'방금 전', text});
  renderWorkspace();
  showToast('댓글이 등록되었습니다','success');
}

// ============================================================
// MEDIA REPORTING (Ph A 스텁 + Ph C 시작 — 지표사전이 KPI/컬럼을 구동)
// ============================================================
let _mrTrendChart, _mrDonutChart;
let _mrCatalog = {base:[], conversion:[]};

// KPI 풀 — 기본 매체(base) + 파생 + 전환(catalog에서). 단위: count|currency|rate|roas
const KPI_DEFS_BASE = [
  {key:'cost',  label:'광고비',   type:'currency'},
  {key:'imp',   label:'노출수',   type:'count'},
  {key:'click', label:'클릭수',   type:'count'},
  {key:'ctr',   label:'CTR',     type:'rate', derived:true},
  {key:'cpc',   label:'CPC',     type:'currency', derived:true},
  {key:'cpm',   label:'CPM',     type:'currency', derived:true},
  {key:'cvr',   label:'CVR',     type:'rate', derived:true},
  {key:'cpa',   label:'CPA',     type:'currency', derived:true},
  {key:'roas',  label:'ROAS',    type:'roas', derived:true},
];
// 사용자 계정별 KPI 선택 저장
function _kpiStoreKey(){ return 'deepfle_mrkpi_' + (currentAccount?.id || 'default'); }
function getSelectedKpiKeys(){
  try { const v = JSON.parse(localStorage.getItem(_kpiStoreKey()) || 'null'); if (Array.isArray(v) && v.length) return v; }
  catch(e){}
  return ['cost','imp','click','__conv_primary','revenue','roas'];  // 기본 6
}
function saveSelectedKpiKeys(keys){ try { localStorage.setItem(_kpiStoreKey(), JSON.stringify(keys)); } catch(e){} }

// 지표사전을 합쳐 전체 KPI 후보 도출 (전환 지표는 'conv:<name>' 키로 동적 생성, '구매(매출)'이 있으면 revenue 별도)
function buildKpiPool(catalog) {
  const pool = [...KPI_DEFS_BASE];
  const convs = (catalog?.conversion || []);
  // '__conv_primary' = 첫 번째 카운트형 전환 지표를 '전환' 카드로 (없으면 매출)
  const primary = convs.find(c=>c.type==='count') || convs[0];
  pool.splice(3, 0, {key:'__conv_primary', label:'전환수'+(primary?` (${primary.name})`:''), type:'count', dynamic:true, isPrimary:true});
  // 전환설정 각 항목을 후보로
  convs.forEach(c=>{
    if (c.type==='currency') {
      pool.push({key:'revenue', label:c.name, type:'currency', from:'currency'});
    } else if (c !== primary) {
      pool.push({key:'conv:'+c.name, label:c.name, type:'count', from:'conv'});
    }
  });
  // 매출이 전환설정에 없으면 기본 revenue도 후보
  if (!convs.some(c=>c.type==='currency')) pool.push({key:'revenue', label:'매출', type:'currency'});
  // 중복 제거 (같은 key는 첫 항목 유지)
  const seen = new Set(), uniq = [];
  pool.forEach(p=>{ if (!seen.has(p.key)) { seen.add(p.key); uniq.push(p); } });
  return uniq;
}

async function renderMediaReport() {
  const el = document.getElementById('mediaReportBody');
  if (!el) return;
  // 매체 옵션 = 연결관리의 실 연결 매체 + 지표 사전(설정의 매핑)도 미리 로드
  let mediaList = [];
  let catalog = {base:[], conversion:[]};
  if (DEEPFLE_API.live && currentWorkspace && currentAccount) {
    try {
      const res = await DEEPFLE_API.get(`/workspaces/${currentWorkspace.id}/ad-accounts`);
      const seen = new Set();
      res.adAccounts.forEach(a => {
        if (a.status !== 'disconnected' && !seen.has(a.media)) {
          seen.add(a.media);
          mediaList.push({key:a.media, label:MEDIA_LABELS[a.media]||a.media});
        }
      });
    } catch(e) {}
    try { catalog = await DEEPFLE_API.get(`/accounts/${currentAccount.id}/metric-catalog`); } catch(e) {}
  }
  // 백엔드 미연결/응답 빈 경우 → 현재 연동(ON) 매체 기반 fallback
  if (!mediaList.length) {
    mediaList = MEDIA_DATA.filter(m => m.on).map(m => ({
      key: m.key || m.name,
      label: MEDIA_LABELS[m.key] || m.name,
    }));
    // 연동된 매체 없으면 빈 목록 유지
  }
  // 수기 등록 매체를 드롭다운에 추가
  MANUAL_MEDIA.forEach(m => {
    if (!mediaList.find(x => x.key === m.name || x.key === m.id)) {
      mediaList.push({key: m.name, label: m.name + ' (수기)'});
    }
  });
  const opts = '<option value="__all__">전체 매체 (비교)</option>' +
    mediaList.map(m=>`<option value="${m.key}">${m.label}</option>`).join('');

  el.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header">
        <div><div class="card-title">매체 선택</div><div class="card-sub">상단 기간 설정과 선택 매체의 매체+전환 실적을 한눈에</div></div>
      </div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:10px;">
        <select class="form-select" id="mrMedia" style="flex:1;height:38px;font-size:13px;padding:6px 12px;">${opts}</select>
        <button class="btn btn-primary btn-sm" style="height:38px;padding:0 20px;white-space:nowrap;" onclick="renderMediaReportResult()">조회</button>
      </div>
      <div style="display:flex;gap:14px;align-items:center;margin-top:10px;padding-top:10px;border-top:1px solid var(--gray-100);flex-wrap:wrap;">
        <span style="font-size:12px;color:var(--gray-500);font-weight:600;flex-shrink:0;">디바이스별 보기</span>
        ${[['all','전체'],['mobile','모바일'],['desktop','PC'],['tablet','태블릿']].map(([v,l],i)=>`<label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;color:var(--gray-700);"><input type="radio" name="mrDevice" value="${v}" ${i===0?'checked':''} onchange="renderMediaReportResult()"> ${l}</label>`).join('')}
      </div>
      <div style="font-size:11px;color:var(--gray-400);margin-top:8px;">컬럼: 설정&gt;매체연동 매핑(${catalog.base.map(b=>b.name).join('·')||'-'}) + 전환설정(${catalog.conversion.map(c=>c.name).join('·')||'-'})</div>
    </div>
    <div id="mrResult"></div>`;
  // 진입 즉시 전체 매체 비교 시연 렌더
  renderMediaReportResult();
}

function _seededRand(seed){ let s=seed; return ()=>{ s=(s*9301+49297)%233280; return s/233280; }; }

// Week label helper: returns e.g. '26년1월2주차'
function _weekLabel(date) {
  const d = new Date(date);
  const dow = d.getDay();
  const monOff = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() + monOff);
  const y = mon.getFullYear() % 100;
  const m = mon.getMonth() + 1;
  const mDate = mon.getDate();
  const first = new Date(mon.getFullYear(), mon.getMonth(), 1);
  const fDow = first.getDay();
  let wk;
  if (fDow === 1) {
    wk = Math.floor((mDate - 1) / 7) + 1;
  } else {
    const firstMon = 1 + (8 - fDow) % 7;
    wk = Math.floor((mDate - firstMon) / 7) + 2;
  }
  return `${y}년${m}월${wk}주차`;
}

// Trend metric selector options
const MR_TREND_METRICS = [
  {key:'cost',label:'광고비'},{key:'imp',label:'노출수'},{key:'click',label:'클릭수'},
  {key:'ctr',label:'CTR'},{key:'cpc',label:'CPC'},{key:'cpm',label:'CPM'},
  {key:'conv',label:'전환수'},{key:'revenue',label:'매출'},{key:'cvr',label:'CVR'},
  {key:'cpa',label:'CPA'},{key:'roas',label:'ROAS'},
];
let _mrTrendSelections = ['cost','conv'];
let _mrLastSeries = null;
let _mrLastLabels = null;
let _mrLastDates = null;

function _mrComputeTrendVal(series, i, key) {
  const sum = arr => arr.reduce((a,b)=>a+b,0);
  const c = sum(series.map(s=>s.cost[i]));
  const cl = sum(series.map(s=>s.click[i]));
  const im = sum(series.map(s=>s.imp[i]));
  const cv = sum(series.map(s=>s.conv[i]));
  const rv = sum(series.map(s=>s.revenue[i]));
  if (key==='cost') return c;
  if (key==='imp') return im;
  if (key==='click') return cl;
  if (key==='conv') return cv;
  if (key==='revenue') return rv;
  if (key==='ctr') return im ? cl/im*100 : 0;
  if (key==='cpc') return cl ? c/cl : 0;
  if (key==='cpm') return im ? c/im*1000 : 0;
  if (key==='cvr') return cl ? cv/cl*100 : 0;
  if (key==='cpa') return cv ? c/cv : 0;
  if (key==='roas') return c ? rv/c*100 : 0;
  return 0;
}

let _mrDonutMetric = 'cost';
const _MR_DONUT_METRICS = [{key:'cost',label:'광고비'},{key:'imp',label:'노출수'},{key:'click',label:'클릭수'},{key:'conv',label:'전환수'},{key:'revenue',label:'매출'}];

function _mrFmtVal(key, val) {
  const isRate = ['ctr','cvr','roas'].includes(key);
  if (isRate) return val.toFixed(2)+'%';
  if (['cost','revenue','cpc','cpm','cpa'].includes(key)) return fmtW(Math.round(val));
  return fmtN(Math.round(val));
}

const _mrCrosshairPlugin = {
  id:'mr_crosshair',
  afterDraw(chart) {
    if (chart.tooltip?._active?.length) {
      const x = chart.tooltip._active[0].element.x;
      const ctx = chart.ctx;
      const yTop = chart.chartArea.top, yBot = chart.chartArea.bottom;
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = '#dadce0';
      ctx.lineWidth = 1;
      ctx.moveTo(x, yTop);
      ctx.lineTo(x, yBot);
      ctx.stroke();
      ctx.restore();
    }
  }
};

function _mrRedrawTrend() {
  if (!_mrLastSeries || !_mrLastLabels) return;
  if (_mrTrendChart) _mrTrendChart.destroy();

  const GA_COLORS = ['#4285f4','#ea4335'];
  const key1 = _mrTrendSelections[0] || 'cost';
  const key2 = _mrTrendSelections[1] || 'conv';
  const label1 = (MR_TREND_METRICS.find(m=>m.key===key1)||{}).label||key1;
  const label2 = (MR_TREND_METRICS.find(m=>m.key===key2)||{}).label||key2;

  const sum = arr => arr.reduce((a,b)=>a+b,0);
  const data1 = _mrLastLabels.map((_,i) => _mrComputeTrendVal(_mrLastSeries, i, key1));
  const data2 = _mrLastLabels.map((_,i) => _mrComputeTrendVal(_mrLastSeries, i, key2));

  const datasets = [
    {
      label: label1, data: data1, yAxisID: 'y',
      borderColor: GA_COLORS[0], backgroundColor: GA_COLORS[0]+'18',
      borderWidth: 2, fill: true, tension: .4,
      pointRadius: 0, pointHoverRadius: 5,
      pointBackgroundColor: GA_COLORS[0], pointBorderColor: '#fff', pointBorderWidth: 2,
      pointHitRadius: 20
    },
    {
      label: label2, data: data2, yAxisID: 'y1',
      borderColor: GA_COLORS[1], backgroundColor: 'transparent',
      borderWidth: 2, fill: false, tension: .4,
      pointRadius: 0, pointHoverRadius: 5,
      pointBackgroundColor: GA_COLORS[1], pointBorderColor: '#fff', pointBorderWidth: 2,
      pointHitRadius: 20
    }
  ];

  const tCtx = document.getElementById('mrTrend');
  if (!tCtx) return;

  _mrTrendChart = new Chart(tCtx, {
    type: 'line',
    data: { labels: _mrLastLabels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      hover: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top', align: 'start',
          labels: { font: { size: 12 }, color: '#5f6368', usePointStyle: true, pointStyle: 'line', boxWidth: 18, padding: 20 }
        },
        tooltip: {
          backgroundColor: '#fff', titleColor: '#202124', bodyColor: '#5f6368',
          borderColor: '#dadce0', borderWidth: 1, cornerRadius: 8, padding: 12,
          bodyFont: { size: 12 }, titleFont: { size: 12, weight: '600' },
          displayColors: true, boxWidth: 12, boxHeight: 2, boxPadding: 6,
          caretSize: 6, caretPadding: 8,
          callbacks: {
            label: ctx => `  ${ctx.dataset.label}: ${_mrFmtVal(ctx.datasetIndex===0?key1:key2, ctx.raw)}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 }, color: '#80868b', maxRotation: 0, autoSkipPadding: 20 },
          border: { display: false }
        },
        y: {
          position: 'left',
          grid: { color: '#f1f3f4', drawBorder: false },
          ticks: { callback: v => _mrFmtVal(key1, v), font: { size: 11 }, color: GA_COLORS[0], padding: 8, maxTicksLimit: 6 },
          border: { display: false }
        },
        y1: {
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { callback: v => _mrFmtVal(key2, v), font: { size: 11 }, color: GA_COLORS[1], padding: 8, maxTicksLimit: 6 },
          border: { display: false }
        }
      }
    },
    plugins: [_mrCrosshairPlugin]
  });
}

function onMrTrendSelect(idx) {
  const sel = document.getElementById('mrTrendSel'+idx);
  if (sel) { _mrTrendSelections[idx] = sel.value; _mrRedrawTrend(); }
}

// Generate comparison data using different seed
function _mrGenCompareSeries(from, to, media, days) {
  const mediaKeys = (!media || media==='__all__') ? ['meta','google','naver_sa','kakao'] : [media];
  const seedStr = (media+'|COMP|'+from).split('').reduce((a,c)=>a+c.charCodeAt(0),0);
  const rnd = _seededRand(seedStr || 2);
  const scaleByMedia = {meta:1800000, google:1500000, naver_sa:2200000, kakao:900000};
  const cvrByMedia = {meta:0.018, google:0.025, naver_sa:0.034, kakao:0.012, tiktok:0.016, naver_gfa:0.020};
  function dailySeries(scale, vol) {
    return Array.from({length:days},()=>{ const v = scale*(1+ (rnd()-0.5)*vol); return Math.max(0, Math.round(v)); });
  }
  const MEDIA_COLOR = {meta:'#1877F2', google:'#4285F4', kakao:'#FFCD00', naver_sa:'#03C75A', tiktok:'#000000', __all__:'#4F46E5'};
  return mediaKeys.map(k=>{
    const scale = scaleByMedia[k] || 1200000;
    const cvr   = cvrByMedia[k]   || 0.020;
    const cost = dailySeries(scale, 0.45);
    const click = cost.map(c=>Math.round(c/(380+rnd()*180)));
    const imp = click.map(c=>c*Math.round(20+rnd()*40));
    const conv = click.map(c=>Math.round(c*cvr));
    const revenue = conv.map(v=>v*(150000+Math.round(rnd()*120000)));
    return {key:k, label:MEDIA_LABELS[k]||k, color:MEDIA_COLOR[k]||'#64748B', cost, click, imp, conv, revenue};
  });
}

function toggleCompareRow() {
  const chk = document.getElementById('mrCompare');
  const row = document.getElementById('mrCompareRow');
  if (!chk || !row) return;
  row.style.display = chk.checked ? 'flex' : 'none';
  if (chk.checked) resetCompPeriod();
  renderMediaReportResult();
}
function resetCompPeriod() {
  const from = document.getElementById('mrFrom').value;
  const to = document.getElementById('mrTo').value;
  if (!from || !to) return;
  const d1 = new Date(from), d2 = new Date(to);
  const days = Math.max(1, Math.round((d2-d1)/86400000)+1);
  const compEnd = new Date(d1.getTime() - 86400000);
  const compStart = new Date(compEnd.getTime() - (days-1)*86400000);
  const cf = document.getElementById('mrCompFrom'), ct = document.getElementById('mrCompTo');
  if (cf) cf.value = compStart.toISOString().slice(0,10);
  if (ct) ct.value = compEnd.toISOString().slice(0,10);
}

async function renderMediaReportResult() {
  loadMemos();
  const target = document.getElementById('mrResult');
  if (!target) return;
  const from = window._globalFrom || new Date(Date.now() - 30*86400000).toISOString().slice(0,10);
  const to   = window._globalTo || new Date().toISOString().slice(0,10);
  const media = document.getElementById('mrMedia') ? document.getElementById('mrMedia').value : '__all__';
  const deviceFilter = document.querySelector('input[name="mrDevice"]:checked')?.value || 'all';
  const comparing = !!window._globalComparing;

  // 지표사전 로드 — 컬럼 구성에 사용 (Ph C 미리보기)
  let catalog = {base:[], conversion:[]};
  try { catalog = await DEEPFLE_API.get(`/accounts/${currentAccount.id}/metric-catalog`); } catch(e) {}

  // 기간 일수
  const d1 = new Date(from), d2 = new Date(to);
  const days = Math.max(1, Math.round((d2-d1)/86400000)+1);
  const dates = Array.from({length:days},(_,i)=>new Date(d1.getTime()+i*86400000));
  const labels = dates.map(d=>`${d.getMonth()+1}/${d.getDate()}`);

  const MEDIA_COLOR = {meta:'#1877F2', google:'#4285F4', kakao:'#FFCD00', naver_sa:'#03C75A', tiktok:'#000000', __all__:'#4F46E5'};
  const mediaLabel = media==='__all__' ? '전체 매체' : (MEDIA_LABELS[media]||media);
  const mediaKeys = (!media || media==='__all__') ? ['meta','google','naver_sa','kakao'] : [media];

  // API 실데이터 로드 — 백엔드 미연결 시 시연용 난수 fallback
  let series;
  if (!DEEPFLE_API.USE_MOCK) {
    try {
      const qs = (media && media !== '__all__') ? `?from=${from}&to=${to}&media=${media}` : `?from=${from}&to=${to}`;
      const res = await DEEPFLE_API.get(`/accounts/${currentAccount.id}/metric-data${qs}`);
      const rows = res.data || [];
      const presentMedias = (media && media !== '__all__') ? [media] : [...new Set(rows.map(r=>r.media))].filter(Boolean);
      const activeKeys = presentMedias.length ? presentMedias : mediaKeys;
      series = _pivotMetricData(rows, dates, activeKeys);
    } catch(e) { series = null; }
  }
  if (!series) series = [];
  // 수기 매체: 백엔드 데이터 캐시 후 일별 데이터 추가
  if (DEEPFLE_API.live && currentAccount && MANUAL_MEDIA.length) {
    try {
      let _mmQs = `?from=${from}&to=${to}`;
      const manualMediaName = MANUAL_MEDIA.find(m => m.name === media || m.id === media)?.name;
      if (manualMediaName) _mmQs += `&media=${encodeURIComponent(manualMediaName)}`;
      const _mmRes = await DEEPFLE_API.get(`/accounts/${currentAccount.id}/manual-metrics${_mmQs}`);
      window._manualMetricsByMediaId = _buildManualMetricsIndex(_mmRes.rows || []);
    } catch(e) { window._manualMetricsByMediaId = window._manualMetricsByMediaId || {}; }
  }
  const manualFilter = (media && media !== '__all__') ? media : null;
  const manualSeriesMr = _getManualMediaSeries(dates).filter(s => !manualFilter || s.key === manualFilter || s.label.startsWith(manualFilter));
  series = [...series, ...manualSeriesMr];
  if (series.length === 0 || series.every(s => s.cost.every(v => v === 0))) {
    target.innerHTML = `<div class="card" style="padding:60px 0;text-align:center;color:var(--gray-400);"><div style="font-size:36px;margin-bottom:12px;">📊</div><div style="font-size:14px;font-weight:500;">조회된 데이터가 없습니다</div><div style="font-size:12px;margin-top:6px;">설정 &gt; 리포트 설정 &gt; 매체 연동에서 광고 계정을 연결하고 데이터를 동기화해주세요.</div></div>`;
    return;
  }
  // 마크업 적용
  series = series.map(s => ({...s, cost: s.cost.map(c => _markupCost(c, s.key))}));

  _mrLastSeries = series;
  _mrLastLabels = labels;
  _mrLastDates = dates;

  // 합계
  const sum = arr => arr.reduce((a,b)=>a+b,0);
  const totalCost = sum(series.flatMap(s=>s.cost));
  const totalClick= sum(series.flatMap(s=>s.click));
  const totalImp  = sum(series.flatMap(s=>s.imp));
  const totalConv = sum(series.flatMap(s=>s.conv));
  const totalRev  = sum(series.flatMap(s=>s.revenue));
  // 수기 전환 데이터 반영
  const _mrManualConv = _getManualConvSum(1, from, to);
  const effectiveTotalConv = totalConv + _mrManualConv;
  const ctr   = totalImp ? totalClick/totalImp : 0;
  const cpc   = totalClick ? totalCost/totalClick : 0;
  const cpa   = effectiveTotalConv ? totalCost/effectiveTotalConv : 0;
  const roas  = totalCost ? totalRev/totalCost : 0;
  const cvr   = totalClick ? effectiveTotalConv/totalClick : 0;
  const cpm   = totalImp ? totalCost/totalImp*1000 : 0;

  // 비교 기간 데이터 (API 실데이터 또는 시연용 fallback)
  let compData = null;
  if (comparing) {
    let compFrom = window._globalCompFrom, compTo = window._globalCompTo;
    if (!compFrom || !compTo) {
      const ce = new Date(d1.getTime() - 86400000);
      const cs = new Date(ce.getTime() - (days-1)*86400000);
      compFrom = cs.toISOString().slice(0,10);
      compTo = ce.toISOString().slice(0,10);
    }
    let compSeries;
    if (!DEEPFLE_API.USE_MOCK) {
      try {
        const cqs = (media && media !== '__all__') ? `?from=${compFrom}&to=${compTo}&media=${media}` : `?from=${compFrom}&to=${compTo}`;
        const cres = await DEEPFLE_API.get(`/accounts/${currentAccount.id}/metric-data${cqs}`);
        const crows = cres.data || [];
        const compDays = Math.max(1, Math.round((new Date(compTo)-new Date(compFrom))/86400000)+1);
        const compDates = Array.from({length:compDays},(_,i)=>new Date(new Date(compFrom).getTime()+i*86400000));
        compSeries = _pivotMetricData(crows, compDates, series.map(s=>s.key));
      } catch(e) { compSeries = null; }
    }
    if (!compSeries || compSeries.every(s => s.cost.every(v => v === 0))) {
      const compRnd = _seededRand((media+'|COMP|'+compFrom).split('').reduce((a,c)=>a+c.charCodeAt(0),0) || 2);
      compSeries = series.map(s => ({
        key:s.key, label:s.label, color:s.color,
        cost: s.cost.map(v => Math.max(0, Math.round(v * (0.88 + compRnd() * 0.24)))),
        click: s.click.map(v => Math.max(0, Math.round(v * (0.88 + compRnd() * 0.24)))),
        imp: s.imp.map(v => Math.max(0, Math.round(v * (0.88 + compRnd() * 0.24)))),
        conv: s.conv.map(v => Math.max(0, Math.round(v * (0.88 + compRnd() * 0.24)))),
        revenue: s.revenue.map(v => Math.max(0, Math.round(v * (0.88 + compRnd() * 0.24)))),
      }));
    }
    const cTotalCost = sum(compSeries.flatMap(s=>s.cost));
    const cTotalClick= sum(compSeries.flatMap(s=>s.click));
    const cTotalImp  = sum(compSeries.flatMap(s=>s.imp));
    const cTotalConv = sum(compSeries.flatMap(s=>s.conv));
    const cTotalRev  = sum(compSeries.flatMap(s=>s.revenue));
    compData = {
      from:compFrom, to:compTo, series:compSeries,
      cost:cTotalCost, click:cTotalClick, imp:cTotalImp, conv:cTotalConv, rev:cTotalRev,
      ctr: cTotalImp ? cTotalClick/cTotalImp : 0,
      cpc: cTotalClick ? cTotalCost/cTotalClick : 0,
      cpa: cTotalConv ? cTotalCost/cTotalConv : 0,
      roas: cTotalCost ? cTotalRev/cTotalCost : 0,
      cvr: cTotalClick ? cTotalConv/cTotalClick : 0,
      cpm: cTotalImp ? cTotalCost/cTotalImp*1000 : 0,
    };
  }

  // ── 브레이크다운 fetch (캠페인 / 디바이스 / 상품유형) ────────────────────────
  let campaignData = [], deviceBDData = [], productBDData = [];
  if (currentAccount && !DEEPFLE_API.USE_MOCK) {
    const mqs  = (media && media !== '__all__') ? `?media=${media}` : '';
    const bdqs = `?from=${from}&to=${to}` + ((media && media !== '__all__') ? `&media=${media}` : '');
    [campaignData, deviceBDData, productBDData] = await Promise.all([
      DEEPFLE_API.get(`/accounts/${currentAccount.id}/campaigns${mqs}`).then(r=>r.campaigns||[]).catch(()=>[]),
      DEEPFLE_API.get(`/accounts/${currentAccount.id}/device-breakdown${bdqs}`).then(r=>r.breakdown||[]).catch(()=>[]),
      DEEPFLE_API.get(`/accounts/${currentAccount.id}/product-breakdown${bdqs}`).then(r=>r.breakdown||[]).catch(()=>[]),
    ]);
  }

  // 디바이스 집계
  const DEVICE_LABELS = {mobile:'모바일',desktop:'PC/데스크탑',tablet:'태블릿',ctv:'CTV'};
  const DEVICE_COLORS = {mobile:'#4F46E5',desktop:'#059669',tablet:'#D97706',ctv:'#DC2626'};
  const deviceTotals = {};
  deviceBDData.forEach(r=>{
    if (!deviceTotals[r.device]) deviceTotals[r.device]={cost:0,imp:0,click:0,conv:0};
    const t=deviceTotals[r.device];
    if (r.metric_key==='cost') t.cost+=r.value;
    else if (r.metric_key==='imp') t.imp+=r.value;
    else if (r.metric_key==='click') t.click+=r.value;
    else if (r.metric_key==='conv') t.conv+=r.value;
  });
  if (!Object.keys(deviceTotals).length && totalCost>0) {
    const _DS={meta:{mobile:0.75,desktop:0.25},google:{mobile:0.60,desktop:0.35,tablet:0.05},naver_sa:{mobile:0.55,desktop:0.45},kakao:{mobile:0.85,desktop:0.15},tiktok:{mobile:1.00}};
    const dSp=(media!=='__all__'?_DS[media]:null)||{mobile:0.68,desktop:0.29,tablet:0.03};
    Object.entries(dSp).forEach(([d,r])=>{deviceTotals[d]={cost:Math.round(totalCost*r),imp:Math.round(totalImp*r),click:Math.round(totalClick*r),conv:Math.round(effectiveTotalConv*r)};});
  }

  // 상품유형 집계
  const CAMPAIGN_TYPE_LABELS={SEARCH:'검색광고',DISPLAY:'디스플레이',PERFORMANCE_MAX:'PMax',SHOPPING:'쇼핑',VIDEO:'동영상',BIZBOARD:'비즈보드',CHANNEL_MSG:'채널메시지',CONVERSION:'전환',AWARENESS:'인지도',TRAFFIC:'트래픽',WEB_SITE:'파워링크',BRAND:'브랜드검색'};
  const PRODUCT_TYPE_COLORS=['#4F46E5','#059669','#D97706','#DC2626','#7C3AED','#0891B2','#DB2777'];
  const productTotals={};
  productBDData.forEach(r=>{
    if (!productTotals[r.campaign_type]) productTotals[r.campaign_type]={cost:0,imp:0,click:0,conv:0};
    const t=productTotals[r.campaign_type];
    if (r.metric_key==='cost') t.cost+=r.value;
    else if (r.metric_key==='imp') t.imp+=r.value;
    else if (r.metric_key==='click') t.click+=r.value;
    else if (r.metric_key==='conv') t.conv+=r.value;
  });
  if (!Object.keys(productTotals).length && totalCost>0) {
    const _PS={meta:{CONVERSION:0.55,AWARENESS:0.30,TRAFFIC:0.15},google:{SEARCH:0.60,PERFORMANCE_MAX:0.25,DISPLAY:0.15},kakao:{BIZBOARD:0.76,CHANNEL_MSG:0.24},naver_sa:{WEB_SITE:0.80,BRAND:0.20}};
    const pSp=(media!=='__all__'?_PS[media]:null)||{SEARCH:0.45,DISPLAY:0.30,VIDEO:0.25};
    Object.entries(pSp).forEach(([type,r])=>{productTotals[type]={cost:Math.round(totalCost*r),imp:Math.round(totalImp*r),click:Math.round(totalClick*r),conv:Math.round(effectiveTotalConv*r)};});
  }

  _mrCatalog = catalog;
  const pool = buildKpiPool(catalog);
  const selKeys = getSelectedKpiKeys();
  const kpiVals = {
    cost:{val:fmtW(totalCost),sub:`${days}일 기준`, raw:totalCost, compRaw:compData?compData.cost:null},
    imp:{val:fmtN(totalImp),sub:`CTR ${(ctr*100).toFixed(2)}%`, raw:totalImp, compRaw:compData?compData.imp:null},
    click:{val:fmtN(totalClick),sub:`CPC ${fmtW(Math.round(cpc))}`, raw:totalClick, compRaw:compData?compData.click:null},
    ctr:{val:(ctr*100).toFixed(2)+'%',sub:'클릭수 / 노출수', raw:ctr, compRaw:compData?compData.ctr:null},
    cpc:{val:fmtW(Math.round(cpc)),sub:'광고비 / 클릭수', raw:cpc, compRaw:compData?compData.cpc:null},
    cpm:{val:fmtW(Math.round(cpm)),sub:'광고비/노출x1000', raw:cpm, compRaw:compData?compData.cpm:null},
    cvr:{val:(cvr*100).toFixed(2)+'%',sub:'전환수 / 클릭수', raw:cvr, compRaw:compData?compData.cvr:null},
    cpa:{val:fmtW(Math.round(cpa)),sub:'광고비 / 전환수', raw:cpa, compRaw:compData?compData.cpa:null},
    roas:{val:(roas*100).toFixed(0)+'%',sub:'매출 / 광고비', raw:roas, compRaw:compData?compData.roas:null},
    __conv_primary:{val:fmtN(effectiveTotalConv),sub:`CVR ${(cvr*100).toFixed(2)}%${_mrManualConv>0?' ✎수기포함':''}`, raw:effectiveTotalConv, compRaw:compData?compData.conv:null},
    revenue:{val:fmtW(totalRev),sub:`CPA ${fmtW(Math.round(cpa))}`, raw:totalRev, compRaw:compData?compData.rev:null},
  };

  function _compBadge(raw, compRaw, kpiType) {
    if (compRaw===null || compRaw===undefined || !compData) return '';
    const diff = raw - compRaw;
    const pct = compRaw ? (diff/compRaw*100) : 0;
    const up = diff >= 0;
    const sign = up ? '+' : '';
    let diffStr;
    if (kpiType === 'currency') diffStr = fmtW(Math.round(diff));
    else if (kpiType === 'rate' || kpiType === 'roas') diffStr = (diff*100).toFixed(2)+'%p';
    else diffStr = fmtN(Math.round(diff));
    return `<div class="mr-compare-badge ${up?'up':'down'}">vs 이전기간: ${sign}${pct.toFixed(1)}% (${sign}${diffStr})</div>`;
  }

  const selectedPool = pool.filter(p=>selKeys.includes(p.key));
  const kpiCards = selectedPool.map(p=>{
    const v=kpiVals[p.key]||{val:'-',sub:'',raw:0,compRaw:null};
    const badge = comparing ? _compBadge(v.raw, v.compRaw, p.type) : '';
    return `<div class="mr-kpi-card" draggable="true" data-key="${p.key}" ondragstart="onKpiDragStart(event)" ondragover="onKpiDragOver(event)" ondragenter="onKpiDragEnter(event)" ondragleave="onKpiDragLeave(event)" ondrop="onKpiDrop(event,saveSelectedKpiKeys,renderMediaReportResult)" ondragend="onKpiDragEnd(event)"><div class="drag-handle">⠿</div><div class="mr-kpi-label">${p.label}</div><div class="mr-kpi-val">${v.val}</div><div class="mr-kpi-sub">${v.sub}</div>${badge}</div>`;
  }).join('');
  const pickerItems = pool.map(p=>{const chk=selKeys.includes(p.key)?'checked':'';const tag=p.derived?' <span style="font-size:9px;color:var(--gray-400);margin-left:auto;">파생</span>':(p.from||p.dynamic)?' <span style="font-size:9px;color:#059669;margin-left:auto;">전환수</span>':'';return `<label class="mr-kpi-picker-item"><input type="checkbox" value="${p.key}" ${chk} onchange="onKpiCheckChange()">${p.label}${tag}</label>`;}).join('');
  const tableCols = _mrBuildTableCols(catalog);

  // Build trend metric selectors (2 selectors)
  function _mrTrendSelHTML(idx) {
    const opts = MR_TREND_METRICS.map(m=>`<option value="${m.key}" ${_mrTrendSelections[idx]===m.key?'selected':''}>${m.label}</option>`).join('');
    return `<select id="mrTrendSel${idx}" onchange="onMrTrendSelect(${idx})" style="font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid var(--gray-200);">${opts}</select>`;
  }
  const donutMetricSel = _MR_DONUT_METRICS.map(m=>`<option value="${m.key}" ${_mrDonutMetric===m.key?'selected':''}>${m.label}</option>`).join('');

  // --- Sum/comparison row helpers ---
  function _sumRow(label, agg, cols) {
    return `<tr class="sum-row"><td style="font-weight:700;">${label}</td>${cols.map(c=>'<td style="font-weight:700;">'+c.fmt(_mrAggCellVal(agg,c.key))+'</td>').join('')}</tr>`;
  }
  const _CURRENCY_KEYS = new Set(['cost','cpc','cpm','cpa','revenue']);
  const _RATE_KEYS = new Set(['ctr','cvr','roas']);
  function _compRow(label, curAgg, prevAgg, cols) {
    return `<tr class="comp-row"><td>${label}</td>${cols.map(c=>{
      const cur = _mrAggCellVal(curAgg,c.key), prev = _mrAggCellVal(prevAgg,c.key);
      if (prev===null || prev===0 || cur===null) return '<td>-</td>';
      const diff = cur - prev;
      const pct = ((diff)/Math.abs(prev)*100);
      const cls = pct >= 0 ? 'pct-up' : 'pct-down';
      const sign = diff >= 0 ? '+' : '';
      let diffStr;
      if (_CURRENCY_KEYS.has(c.key)) diffStr = fmtW(Math.round(diff));
      else if (_RATE_KEYS.has(c.key)) diffStr = (diff*100).toFixed(2)+'%p';
      else diffStr = fmtN(Math.round(diff));
      return '<td><span class="'+cls+'">'+(pct>=0?'+':'')+pct.toFixed(1)+'%<br><span style="font-size:10px;">'+sign+diffStr+'</span></span></td>';
    }).join('')}</tr>`;
  }

  // Total aggregation for sum rows
  const allIdxs = dates.map((_,i)=>i);
  const totalAgg = _mrAggregateIdxs(series, allIdxs);

  // --- Monthly aggregation ---
  const monthMap = {};
  dates.forEach((d,i)=>{
    const ym = (d.getFullYear()%100)+'년'+(d.getMonth()+1)+'월';
    if (!monthMap[ym]) monthMap[ym] = [];
    monthMap[ym].push(i);
  });
  const monthEntries = Object.entries(monthMap);
  const monthRows = monthEntries.map(([ym,idxs])=>{
    const agg = _mrAggregateIdxs(series, idxs);
    return `<tr><td style="font-weight:600;">${ym}</td>${tableCols.map(c=>'<td>'+c.fmt(_mrAggCellVal(agg,c.key))+'</td>').join('')}</tr>`;
  }).join('')
    + _sumRow('합계', totalAgg, tableCols)
    + (()=>{
      if (monthEntries.length < 2) return '';
      const lastMonthAgg = _mrAggregateIdxs(series, monthEntries[monthEntries.length-1][1]);
      const prevMonthAgg = _mrAggregateIdxs(series, monthEntries[monthEntries.length-2][1]);
      return _compRow('전기간 대비', lastMonthAgg, prevMonthAgg, tableCols);
    })();

  // --- Weekly aggregation ---
  const weekMap = {};
  dates.forEach((d,i)=>{
    const wl = _weekLabel(d);
    if (!weekMap[wl]) weekMap[wl] = [];
    weekMap[wl].push(i);
  });
  const weekEntries = Object.entries(weekMap);
  const weekRows = weekEntries.map(([wl,idxs])=>{
    const agg = _mrAggregateIdxs(series, idxs);
    return `<tr><td style="font-weight:600;">${wl}</td>${tableCols.map(c=>'<td>'+c.fmt(_mrAggCellVal(agg,c.key))+'</td>').join('')}</tr>`;
  }).join('')
    + _sumRow('합계', totalAgg, tableCols)
    + (()=>{
      if (weekEntries.length < 2) return '';
      const lastWeekAgg = _mrAggregateIdxs(series, weekEntries[weekEntries.length-1][1]);
      const prevWeekAgg = _mrAggregateIdxs(series, weekEntries[weekEntries.length-2][1]);
      return _compRow('전기간 대비', lastWeekAgg, prevWeekAgg, tableCols);
    })();

  // --- Daily rows (max 31) ---
  const showAllDaily = days <= 31;
  const dailyDates = showAllDaily ? dates : dates.slice(-31);
  const dailyOffset = showAllDaily ? 0 : dates.length - 31;
  const dailyLabelsSlice = showAllDaily ? labels : labels.slice(-31);
  const isAllMedia = media==='__all__';

  const dailyRows = dailyDates.map((dt,di)=>{
    const i = dailyOffset + di;
    const dateStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    if (isAllMedia) {
      const dayAgg = _mrAggregateIdxs(series, [i]);
      const cells = tableCols.map(c=>'<td>'+c.fmt(_mrAggCellVal(dayAgg,c.key))+'</td>').join('');
      return `<tr><td>${dateStr}${memoCell(dateStr, '__all__')}</td>${cells}</tr>`;
    } else {
      const cells = tableCols.map(c=>'<td>'+c.fmt(_mrCellVal(series[0],i,c.key))+'</td>').join('');
      return `<tr><td>${dateStr}${memoCell(dateStr, media)}</td>${cells}</tr>`;
    }
  }).join('');

  const dailyNotice = !showAllDaily ? `<div style="padding:10px;font-size:12px;color:var(--gray-400);text-align:center;">기간이 31일을 초과합니다. 최근 31일만 표시됩니다. <button class="btn btn-sm btn-outline" onclick="showToast('엑셀 다운로드 (전체 기간)','info')">엑셀 다운로드</button></div>` : '';


  // ── 섹션 8: 디바이스별 ──────────────────────────────────────────────────────
  const _devEntries=Object.entries(deviceTotals).sort(([,a],[,b])=>b.cost-a.cost);
  const _devTotal=_devEntries.reduce((s,[,t])=>s+t.cost,0)||1;
  const _mrDevBar=_devEntries.length?`
    <div style="margin:12px 0 8px;">
      <div style="display:flex;height:24px;border-radius:8px;overflow:hidden;background:var(--gray-100);">
        ${_devEntries.map(([d,t])=>{const p=(t.cost/_devTotal*100).toFixed(1);const c=DEVICE_COLORS[d]||'#64748B';return `<div style="width:${p}%;background:${c};display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;white-space:nowrap;overflow:hidden;" title="${DEVICE_LABELS[d]||d}: ${p}%">${parseFloat(p)>8?p+'%':''}</div>`;}).join('')}
      </div>
      <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap;">
        ${_devEntries.map(([d])=>`<div style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--gray-600);"><span style="width:10px;height:10px;border-radius:50%;background:${DEVICE_COLORS[d]||'#64748B'};display:inline-block;"></span>${DEVICE_LABELS[d]||d}</div>`).join('')}
      </div>
    </div>`:'';
  const _mrDevRows=_devEntries.map(([d,t])=>{
    const p=(t.cost/_devTotal*100).toFixed(1)+'%';
    const ctr=t.imp?(t.click/t.imp*100).toFixed(2)+'%':'-';
    const cpc=t.click?fmtW(Math.round(t.cost/t.click)):'-';
    const cpa=t.conv?fmtW(Math.round(t.cost/t.conv)):'-';
    const dc=DEVICE_COLORS[d]||'#64748B';
    const dimmed=deviceFilter!=='all'&&deviceFilter!==d;
    const rowStyle=dimmed?'opacity:0.35;':(deviceFilter===d?'background:var(--gray-50);font-weight:600;':'');
    return `<tr style="${rowStyle}"><td><span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:${dc};flex-shrink:0;"></span>${DEVICE_LABELS[d]||d}</span></td><td class="text-right num">${fmtW(t.cost)}</td><td class="text-right">${p}</td><td class="text-right num">${fmtN(t.imp)}</td><td class="text-right num">${fmtN(t.click)}</td><td class="text-right num">${ctr}</td><td class="text-right num">${cpc}</td><td class="text-right num">${fmtN(t.conv)}</td><td class="text-right num">${cpa}</td></tr>`;
  }).join('')||'<tr><td colspan="9" style="text-align:center;color:var(--gray-400);padding:20px;">데이터 없음</td></tr>';

  // ── 섹션 9: 매체별 성과 ──────────────────────────────────────────────────
  const _mrMediaTotal=totalCost||1;
  const _mrMediaBar=series.length?`
    <div style="margin:12px 0 8px;">
      <div style="display:flex;height:24px;border-radius:8px;overflow:hidden;background:var(--gray-100);">
        ${series.map(s=>{const sc=sum(s.cost);const p=(sc/_mrMediaTotal*100).toFixed(1);return `<div style="width:${p}%;background:${s.color||'#64748B'};display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;white-space:nowrap;overflow:hidden;" title="${s.label}: ${p}%">${parseFloat(p)>8?p+'%':''}</div>`;}).join('')}
      </div>
      <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap;">
        ${series.map(s=>`<div style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--gray-600);"><span style="width:10px;height:10px;border-radius:50%;background:${s.color||'#64748B'};display:inline-block;"></span>${s.label}</div>`).join('')}
      </div>
    </div>`:'';
  const _mrMediaRows=series.map(s=>{
    const sc=sum(s.cost),si=sum(s.imp),scl=sum(s.click),sv=sum(s.conv),sr=sum(s.revenue);
    const p=(sc/_mrMediaTotal*100).toFixed(1)+'%';
    const ctr=si?(scl/si*100).toFixed(2)+'%':'-';
    const cpc=scl?fmtW(Math.round(sc/scl)):'-';
    const roas=sc?(sr/sc*100).toFixed(0)+'%':'-';
    const cpa=sv?fmtW(Math.round(sc/sv)):'-';
    return `<tr><td><span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:${s.color||'#64748B'};flex-shrink:0;"></span>${s.label}</span></td><td class="text-right num">${fmtW(sc)}</td><td class="text-right">${p}</td><td class="text-right num">${fmtN(si)}</td><td class="text-right num">${fmtN(scl)}</td><td class="text-right num">${ctr}</td><td class="text-right num">${cpc}</td><td class="text-right num">${fmtN(sv)}</td><td class="text-right num">${roas}</td><td class="text-right num">${cpa}</td></tr>`;
  }).join('')||'<tr><td colspan="10" style="text-align:center;color:var(--gray-400);padding:20px;">데이터 없음</td></tr>';
  const _mrMediaTotalRow=`<tr style="font-weight:700;background:var(--gray-50);"><td>합계</td><td class="text-right num">${fmtW(totalCost)}</td><td class="text-right">100%</td><td class="text-right num">${fmtN(totalImp)}</td><td class="text-right num">${fmtN(totalClick)}</td><td class="text-right num">${totalImp?(totalClick/totalImp*100).toFixed(2)+'%':'-'}</td><td class="text-right num">${totalClick?fmtW(Math.round(totalCost/totalClick)):'-'}</td><td class="text-right num">${fmtN(effectiveTotalConv)}</td><td class="text-right num">${totalCost?(totalRev/totalCost*100).toFixed(0)+'%':'-'}</td><td class="text-right num">${effectiveTotalConv?fmtW(Math.round(totalCost/effectiveTotalConv)):'-'}</td></tr>`;

  const _mrPixelData = _getMediaPixels();
  const _mrOnMedia = MEDIA_DATA.filter(m=>m.on);
  const _mrMissingPixel = _mrOnMedia.filter(m=>!_mrPixelData[m.name]);
  const _mrPixelNotice = _mrMissingPixel.length > 0 ? `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#FFFBEB;border:1px solid #FCD34D;border-radius:10px;margin-bottom:12px;">
      <span style="font-size:15px;flex-shrink:0;">⚠️</span>
      <div style="flex:1;">
        <div style="font-size:12px;font-weight:600;color:#92400E;">픽셀 미설정 매체 — 실전환 데이터가 수집되지 않을 수 있습니다</div>
        <div style="margin-top:3px;display:flex;flex-wrap:wrap;gap:4px;">${_mrMissingPixel.map(m=>`<span style="background:${m.color};color:#fff;font-size:10px;padding:1px 7px;border-radius:8px;">${m.name}</span>`).join('')}</div>
      </div>
      <button class="btn btn-xs" style="background:#FCD34D;color:#92400E;border:none;font-size:11px;white-space:nowrap;flex-shrink:0;" onclick="showPanel('settings');setTimeout(()=>{const t=document.querySelector('.tab-pill[onclick*=connection]');if(t)switchSettingTab(t,'connection');},150);">설정하러 가기</button>
    </div>` : '';

  target.innerHTML = `
    ${_mrPixelNotice}
    <!-- 1. KPI Cards -->
    <div class="card mr-section">
      <div class="card-header">
        <div><div class="card-title">전체 매체 KPI</div>
          <div class="card-sub">${mediaLabel} · ${from} ~ ${to}</div></div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="btn btn-sm btn-outline" onclick="downloadMrExcel()">📊 엑셀</button>
          <button class="btn btn-sm btn-outline" onclick="downloadMrPDF()">📄 PDF</button>
        <div class="mr-kpi-picker">
          <button class="btn btn-sm btn-outline" onclick="toggleKpiPicker()" title="KPI 카드 선택">⚙ KPI 설정</button>
          <div class="mr-kpi-picker-drop" id="kpiPickerDrop">${pickerItems}</div>
        </div>
        </div>
      </div>
      <div class="mr-kpi-grid">${kpiCards}</div>
    </div>

    <!-- 2. Charts: trend (left 70%) + donut (right 30%) -->
    <div class="mr-section" style="display:grid;grid-template-columns:7fr 3fr;gap:16px;min-height:420px;">
      <div class="card" style="display:flex;flex-direction:column;min-height:400px;">
        <div class="card-header" style="flex-shrink:0;padding-bottom:0;">
          <div><div class="card-title">일자 추세</div></div>
          <div style="display:flex;gap:6px;align-items:center;">${_mrTrendSelHTML(0)} ${_mrTrendSelHTML(1)}</div>
        </div>
        <div style="flex:1;position:relative;min-height:320px;"><canvas id="mrTrend" style="position:absolute;top:0;left:0;width:100%;height:100%;"></canvas></div>
      </div>
      <div class="card" style="display:flex;flex-direction:column;min-height:400px;">
        <div class="card-header" style="flex-shrink:0;padding-bottom:0;">
          <div><div class="card-title" id="mrDonutTitle">매체 구성 (${(_MR_DONUT_METRICS.find(m=>m.key===_mrDonutMetric)||{}).label||'광고비'})</div></div>
          <select id="mrDonutMetricSel" onchange="onMrDonutMetricChange()" style="font-size:11px;padding:3px 6px;border-radius:6px;border:1px solid var(--gray-200);">${donutMetricSel}</select>
        </div>
        <div style="flex:1;position:relative;min-height:320px;"><canvas id="mrDonut" style="position:absolute;top:0;left:0;width:100%;height:100%;"></canvas></div>
      </div>
    </div>

    <!-- 3. 디바이스별 성과 -->
    <div class="card mr-section" style="margin-top:16px;">
      <div class="card-header">
        <div><div class="card-title">디바이스별 성과${deviceFilter!=='all'?' <span style="font-size:11px;font-weight:400;color:var(--gray-400);">('+{'mobile':'모바일','desktop':'PC','tablet':'태블릿'}[deviceFilter]+' 기준)</span>':''}</div><div class="card-sub">${mediaLabel} · 기기별 광고 집행 현황</div></div>
      </div>
      ${_mrDevBar}
      <div style="overflow-x:auto;">
        <table class="data-table" style="width:100%;font-size:12px;min-width:700px;">
          <thead><tr><th>디바이스</th><th class="text-right">광고비</th><th class="text-right">비율</th><th class="text-right">노출</th><th class="text-right">클릭</th><th class="text-right">CTR</th><th class="text-right">CPC</th><th class="text-right">전환</th><th class="text-right">CPA</th></tr></thead>
          <tbody>${_mrDevRows}</tbody>
        </table>
      </div>
    </div>

    <!-- 4. 매체별 성과 -->
    <div class="card mr-section" style="margin-top:16px;">
      <div class="card-header">
        <div><div class="card-title">매체별 성과</div><div class="card-sub">${mediaLabel} · 매체별 집행 현황</div></div>
      </div>
      ${_mrMediaBar}
      <div style="overflow-x:auto;">
        <table class="data-table" style="width:100%;font-size:12px;min-width:800px;">
          <thead><tr><th>매체</th><th class="text-right">광고비</th><th class="text-right">비율</th><th class="text-right">노출</th><th class="text-right">클릭</th><th class="text-right">CTR</th><th class="text-right">CPC</th><th class="text-right">전환</th><th class="text-right">ROAS</th><th class="text-right">CPA</th></tr></thead>
          <tbody>${_mrMediaRows}${_mrMediaTotalRow}</tbody>
        </table>
      </div>
    </div>

    <!-- 6. Monthly table -->
    <div class="card mr-section">
      <div class="card-header"><div><div class="card-title">월간 실적</div><div class="card-sub">월별 합산</div></div></div>
      <div style="overflow-x:auto;">
        <table class="data-table" style="width:100%;font-size:12px;min-width:720px;">
          <thead><tr><th>월</th>${tableCols.map(c=>'<th>'+c.label+'</th>').join('')}</tr></thead>
          <tbody>${monthRows}</tbody>
        </table>
      </div>
    </div>

    <!-- 5. Weekly table -->
    <div class="card mr-section">
      <div class="card-header"><div><div class="card-title">주간 실적</div><div class="card-sub">월~일 기준 주차 합산</div></div></div>
      <div style="overflow-x:auto;">
        <table class="data-table" style="width:100%;font-size:12px;min-width:720px;">
          <thead><tr><th>주차</th>${tableCols.map(c=>'<th>'+c.label+'</th>').join('')}</tr></thead>
          <tbody>${weekRows}</tbody>
        </table>
      </div>
    </div>

    <!-- 6. Daily table (max 31) -->
    <div class="card mr-section">
      <div class="card-header">
        <div><div class="card-title">일간 실적</div><div class="card-sub">${isAllMedia?'전체매체 합산':'일자별'}${!showAllDaily?' (최근 31일)':''}</div></div>
        <button class="btn btn-sm btn-outline" onclick="showToast('엑셀 다운로드','info')">엑셀 다운로드</button>
      </div>
      ${dailyNotice}
      <div style="overflow-x:auto;">
        <table class="data-table" style="width:100%;font-size:12px;min-width:720px;">
          <thead><tr><th>날짜</th>${tableCols.map(c=>'<th>'+c.label+'</th>').join('')}</tr></thead>
          <tbody>${dailyRows}${(()=>{
            const dLen = dailyDates.length;
            const lastDayAgg = dLen >= 2 ? _mrAggregateIdxs(series, [dailyOffset+dLen-1]) : null;
            const prevDayAgg = dLen >= 2 ? _mrAggregateIdxs(series, [dailyOffset+dLen-2]) : null;
            return _sumRow('합계', totalAgg, tableCols) + (lastDayAgg && prevDayAgg ? _compRow('전기간 대비', lastDayAgg, prevDayAgg, tableCols) : '');
          })()
          }</tbody>
        </table>
      </div>
    </div>

    `;

  // 차트 렌더
  if (_mrTrendChart) _mrTrendChart.destroy();
  if (_mrDonutChart) _mrDonutChart.destroy();
  _mrRedrawTrend();
  _mrRedrawDonut();
}

function _mrRedrawDonut() {
  if (!_mrLastSeries) return;
  if (_mrDonutChart) _mrDonutChart.destroy();
  const sum = arr => arr.reduce((a,b)=>a+b,0);
  const key = _mrDonutMetric || 'cost';
  const metricLabel = (_MR_DONUT_METRICS.find(m=>m.key===key)||{}).label||'광고비';
  const titleEl = document.getElementById('mrDonutTitle');
  if (titleEl) titleEl.textContent = `매체 구성 (${metricLabel})`;
  const GA_DONUT = ['#4285f4','#ea4335','#fbbc04','#34a853','#9334e6','#00acc1'];
  const dataArr = _mrLastSeries.map(s => sum(s[key] || []));
  const dCtx = document.getElementById('mrDonut');
  if (!dCtx) return;
  _mrDonutChart = new Chart(dCtx, {
    type:'doughnut',
    data:{labels:_mrLastSeries.map(s=>s.label), datasets:[{data:dataArr, backgroundColor:GA_DONUT.slice(0,_mrLastSeries.length), borderWidth:2, borderColor:'#fff', hoverOffset:4}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'60%',
      plugins:{legend:{position:'bottom',labels:{font:{size:11},color:'#5f6368',usePointStyle:true,pointStyle:'circle',boxWidth:8,padding:12}},
        tooltip:{backgroundColor:'#fff',titleColor:'#202124',bodyColor:'#5f6368',borderColor:'#dadce0',borderWidth:1,cornerRadius:8,padding:12,
          callbacks:{label:ctx=>{const total=ctx.dataset.data.reduce((a,b)=>a+b,0);const pct=total?(ctx.raw/total*100).toFixed(1):'0';return ` ${ctx.label}: ${['cost','revenue'].includes(key)?fmtW(ctx.raw):fmtN(ctx.raw)} (${pct}%)`;}}}}}
  });
}

function onMrDonutMetricChange() {
  const sel = document.getElementById('mrDonutMetricSel');
  if (sel) { _mrDonutMetric = sel.value; _mrRedrawDonut(); }
}

// Aggregate daily indices for monthly/weekly tables
// flat metric_data rows [{date,media,metric_key,value}] → series [{key,label,color,cost[],click[],imp[],conv[],revenue[]}]
function _pivotMetricData(rows, dates, mediaKeys) {
  const byMediaDate = {};
  rows.forEach(r => {
    if (!byMediaDate[r.media]) byMediaDate[r.media] = {};
    if (!byMediaDate[r.media][r.date]) byMediaDate[r.media][r.date] = {};
    byMediaDate[r.media][r.date][r.metric_key] = r.value;
  });
  const MC = {meta:'#1877F2',google:'#4285F4',kakao:'#FFCD00',naver_sa:'#03C75A',tiktok:'#000000',kakao_biz:'#F7E600',youtube:'#FF0000',karrot:'#FF7E36',naver_shopping:'#00C73C',naver_gfa:'#00C73C'};
  return mediaKeys.map(k => {
    const dateMap = byMediaDate[k] || {};
    const cost=[], click=[], imp=[], conv=[], revenue=[];
    dates.forEach(d => {
      const ds = d.toISOString ? d.toISOString().slice(0,10) : d;
      const mk = dateMap[ds] || {};
      cost.push(Math.round(mk.cost||0));
      click.push(Math.round(mk.click||0));
      imp.push(Math.round(mk.imp||0));
      conv.push(Math.round(mk.conv||0));
      revenue.push(Math.round(mk.revenue||0));
    });
    return {key:k, label:MEDIA_LABELS[k]||k, color:MC[k]||'#64748B', cost, click, imp, conv, revenue};
  });
}

function _mrAggregateIdxs(series, idxs) {
  const sum = arr => arr.reduce((a,b)=>a+b,0);
  const cost = sum(idxs.flatMap(i=>series.map(s=>s.cost[i])));
  const click = sum(idxs.flatMap(i=>series.map(s=>s.click[i])));
  const imp = sum(idxs.flatMap(i=>series.map(s=>s.imp[i])));
  const conv = sum(idxs.flatMap(i=>series.map(s=>s.conv[i])));
  const revenue = sum(idxs.flatMap(i=>series.map(s=>s.revenue[i])));
  return {cost, click, imp, conv, revenue};
}

function _mrAggCellVal(agg, key) {
  if (key==='imp') return agg.imp;
  if (key==='click') return agg.click;
  if (key==='cost') return agg.cost;
  if (key==='conv') return agg.conv;
  if (key==='revenue') return agg.revenue;
  if (key==='ctr') return agg.imp ? agg.click/agg.imp : null;
  if (key==='cpc') return agg.click ? agg.cost/agg.click : null;
  if (key==='cpm') return agg.imp ? agg.cost/agg.imp*1000 : null;
  if (key==='cvr') return agg.click ? agg.conv/agg.click : null;
  if (key==='cpa') return agg.conv ? agg.cost/agg.conv : null;
  if (key==='roas') return agg.cost ? agg.revenue/agg.cost : null;
  return 0;
}

function _mrBuildTableCols(catalog) {
  const cols = [
    {key:'imp',label:'노출수',fmt:v=>fmtN(v)},
    {key:'click',label:'클릭수',fmt:v=>fmtN(v)},
    {key:'ctr',label:'CTR',fmt:v=>v!==null?(v*100).toFixed(2)+'%':'-'},
    {key:'cost',label:'광고비',fmt:v=>fmtW(v)},
    {key:'cpc',label:'CPC',fmt:v=>v!==null?fmtW(v):'-'},
    {key:'cpm',label:'CPM',fmt:v=>v!==null?fmtW(v):'-'},
  ];
  const convs = catalog?.conversion || [];
  if (convs.length) {
    const primary = convs.find(c=>c.type==='count') || convs[0];
    if (primary) cols.push({key:'conv',label:primary.name||'전환수',fmt:v=>fmtN(v)});
    convs.filter(c=>c.type==='currency').forEach(c=>cols.push({key:'revenue',label:c.name||'매출',fmt:v=>fmtW(v)}));
  } else {
    cols.push({key:'conv',label:'전환수',fmt:v=>fmtN(v)});
    cols.push({key:'revenue',label:'매출',fmt:v=>fmtW(v)});
  }
  cols.push({key:'cvr',label:'CVR',fmt:v=>v!==null?(v*100).toFixed(2)+'%':'-'});
  cols.push({key:'cpa',label:'CPA',fmt:v=>v!==null?fmtW(v):'-'});
  cols.push({key:'roas',label:'ROAS',fmt:v=>v!==null?Math.round(v*100)+'%':'-'});
  return cols;
}

function _mrCellVal(s, i, key) {
  if (key==='imp') return s.imp[i];
  if (key==='click') return s.click[i];
  if (key==='cost') return s.cost[i];
  if (key==='conv') return s.conv[i];
  if (key==='revenue') return s.revenue[i];
  if (key==='ctr') return s.imp[i] ? s.click[i]/s.imp[i] : null;
  if (key==='cpc') return s.click[i] ? s.cost[i]/s.click[i] : null;
  if (key==='cpm') return s.imp[i] ? s.cost[i]/s.imp[i]*1000 : null;
  if (key==='cvr') return s.click[i] ? s.conv[i]/s.click[i] : null;
  if (key==='cpa') return s.conv[i] ? s.cost[i]/s.conv[i] : null;
  if (key==='roas') return s.cost[i] ? s.revenue[i]/s.cost[i] : null;
  return 0;
}

function _mrTableRowsDynamic(labels, series, comparing, cols) {
  let rows = [];
  for (let i = 0; i < labels.length; i++) {
    const render = s => {
      const cells = cols.map(c=>'<td>'+c.fmt(_mrCellVal(s,i,c.key))+'</td>').join('');
      return comparing ? `<tr><td>${labels[i]}</td><td>${s.label}</td>${cells}</tr>` : `<tr><td>${labels[i]}</td>${cells}</tr>`;
    };
    if (comparing) series.forEach(s=>rows.push(render(s)));
    else rows.push(render(series[0]));
  }
  return rows.slice(0,60).join('');
}

function toggleKpiPicker() {
  const d = document.getElementById('kpiPickerDrop');
  if (!d) return;
  const opening = !d.classList.contains('open');
  d.classList.toggle('open');
  if (opening) {
    setTimeout(()=>{
      const closer = e=>{ if (!d.contains(e.target) && !e.target.closest('.mr-kpi-picker')) { d.classList.remove('open'); document.removeEventListener('click',closer); }};
      document.addEventListener('click',closer);
    },10);
  }
}

function onKpiCheckChange() {
  const d = document.getElementById('kpiPickerDrop');
  if (!d) return;
  const keys = [...d.querySelectorAll('input:checked')].map(i=>i.value);
  if (!keys.length) { showToast('최소 1개 KPI를 선택하세요','warning'); return; }
  saveSelectedKpiKeys(keys);
  renderMediaReportResult();
}

// ============================================================
// REPORT SETTINGS (Ph A 스텁 — Ph E에서 본 구현)
// ============================================================
const RS_ALL_COLUMNS = [
  {key:'date',label:'날짜',fixed:true},{key:'media',label:'매체',fixed:true},
  {key:'cost',label:'광고비'},{key:'imp',label:'노출수'},{key:'click',label:'클릭수'},
  {key:'conv',label:'전환수'},{key:'revenue',label:'매출'},
  {key:'ctr',label:'CTR',derived:true},{key:'cpc',label:'CPC',derived:true},
  {key:'cpm',label:'CPM',derived:true},{key:'roas',label:'ROAS',derived:true},{key:'cpa',label:'CPA',derived:true}
];
const RS_ALL_MEDIA = ['meta','google','naver_sa','kakao'];
let _rsConfigs = [];
let _rsHistory = [];
let _rsEditIdx = -1;

function switchRsTab(el, name) {
  el.closest('.tab-pills').querySelectorAll('.tab-pill').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  ['conversion','manual-data'].forEach(t=>{
    const e=document.getElementById('rs-'+t); if(e) e.style.display=t===name?'block':'none';
  });
  if(name==='conversion') renderConversionSettings();
  if(name==='manual-data') renderManualConvData();
}

async function renderReportSettings() {
  // 첫 탭(수기 전환 데이터 입력)을 기본으로 표시
  ['conversion'].forEach(t=>{
    const e=document.getElementById('rs-'+t); if(e) e.style.display='none';
  });
  const manEl=document.getElementById('rs-manual-data');
  if(manEl) manEl.style.display='block';
  // 탭 pill 활성화 상태 동기화
  const pills=document.querySelectorAll('#panel-report-set .tab-pill');
  pills.forEach(p=>p.classList.remove('active'));
  if(pills[0]) pills[0].classList.add('active');
  renderManualConvData();
}

// ============================================================
// 수기 전환 데이터 입력 (일자별 매체×전환지표 입력)
// ============================================================
const MANUAL_CONV_KEY = 'deepfle_manual_conv_data';
function _getManualConvData() { return JSON.parse(localStorage.getItem(MANUAL_CONV_KEY)||'[]'); }
function _saveManualConvDataStore(arr) { localStorage.setItem(MANUAL_CONV_KEY, JSON.stringify(arr)); }

async function renderManualConvData() {
  const el = document.getElementById('manualConvBody');
  if (!el) return;

  // 전환지표 로드
  let convs = [];
  if (currentAccount) {
    try {
      const res = await DEEPFLE_API.get(`/accounts/${currentAccount.id}/conversion-settings`);
      convs = (res.conversions||[]).filter(c=>c.active);
    } catch(e){}
  }
  if (!convs.length) {
    el.innerHTML = `<div class="card"><div style="padding:24px;text-align:center;color:var(--gray-400);font-size:13px;">전환설정에 활성 지표가 없습니다. <b>전환설정</b> 탭에서 지표를 먼저 추가하세요.</div></div>`;
    return;
  }

  // 날짜 범위 기본값: 최근 7일
  const today = new Date().toISOString().slice(0,10);
  const d7ago = new Date(Date.now()-6*86400000).toISOString().slice(0,10);
  if (!window._mcvFrom) window._mcvFrom = d7ago;
  if (!window._mcvTo)   window._mcvTo   = today;
  if (!window._mcvConvId || !convs.find(c=>c.id===window._mcvConvId))
    window._mcvConvId = convs[0].id;

  const selConvId = window._mcvConvId;
  const selConv   = convs.find(c=>c.id===selConvId) || convs[0];
  const allMedia  = [...MEDIA_DATA.filter(m=>m.on).map(m=>m.name), ...MANUAL_MEDIA.map(m=>m.name)];

  // 기간 내 날짜 배열 생성
  const dateList = [];
  for (let d = new Date(window._mcvFrom); d <= new Date(window._mcvTo); d.setDate(d.getDate()+1))
    dateList.push(d.toISOString().slice(0,10));

  // 기존 저장값 맵: key = "date__media"
  const stored = _getManualConvData();
  const existMap = {};
  stored.filter(r=>r.conv_id===selConvId).forEach(r=>{ existMap[`${r.date}__${r.media}`] = r.value; });

  // 전환지표 드롭다운
  const convOptHtml = convs.map(c=>`<option value="${c.id}" ${c.id===selConvId?'selected':''}>${c.solution_metric}</option>`).join('');

  el.innerHTML = `
  <div class="card" style="margin-bottom:16px;">
    <div class="card-header">
      <div><div class="card-title">수기 전환 데이터 입력</div>
        <div class="card-sub">기간 × 매체별 전환 수치를 직접 입력하거나 엑셀에서 복사·붙여넣기 합니다</div>
      </div>
    </div>

    <!-- 컨트롤 바 -->
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:6px;">
        <label style="font-size:12px;font-weight:600;color:var(--gray-600);">전환지표</label>
        <select class="form-select" style="height:32px;font-size:12px;min-width:110px;"
          onchange="window._mcvConvId=Number(this.value);renderManualConvData()">${convOptHtml}</select>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <label style="font-size:12px;font-weight:600;color:var(--gray-600);">기간</label>
        <input class="form-input" type="date" id="mcvFrom" value="${window._mcvFrom}" style="height:32px;font-size:12px;width:140px;"
          onchange="window._mcvFrom=this.value">
        <span style="font-size:12px;color:var(--gray-400);">~</span>
        <input class="form-input" type="date" id="mcvTo" value="${window._mcvTo}" style="height:32px;font-size:12px;width:140px;"
          onchange="window._mcvTo=this.value">
        <button class="btn btn-sm btn-outline" onclick="window._mcvFrom=document.getElementById('mcvFrom').value;window._mcvTo=document.getElementById('mcvTo').value;renderManualConvData()">불러오기</button>
      </div>
    </div>

    <!-- 붙여넣기 안내 -->
    <div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:6px;padding:8px 12px;font-size:11px;color:#0369A1;margin-bottom:12px;display:flex;align-items:center;gap:8px;">
      <span>💡</span>
      <span>엑셀에서 <b>날짜 순 × 매체 순</b>으로 값만 복사(Ctrl+C)한 후, 원하는 시작 셀을 클릭하고 붙여넣기(Ctrl+V) 하세요. Tab 구분·줄 바꿈 자동 인식.</span>
    </div>

    <!-- 입력 매트릭스 -->
    <div style="overflow-x:auto;">
      <table class="data-table" id="mcvMatrix" style="font-size:12px;min-width:500px;">
        <thead><tr>
          <th style="min-width:90px;background:var(--gray-50);">날짜</th>
          ${allMedia.map(m=>`<th class="text-right" style="min-width:90px;">${m}</th>`).join('')}
        </tr></thead>
        <tbody>
          ${dateList.map(date=>`<tr>
            <td style="font-weight:600;color:var(--gray-600);background:var(--gray-50);white-space:nowrap;">${date.slice(5)}</td>
            ${allMedia.map(media=>`<td class="text-right" style="padding:3px 4px;">
              <input type="number" min="0" class="form-input manual-conv-cell"
                data-date="${date}" data-media="${media}" data-conv-id="${selConvId}"
                style="width:82px;height:26px;font-size:12px;text-align:right;padding:2px 6px;"
                value="${existMap[`${date}__${media}`]!==undefined ? existMap[`${date}__${media}`] : ''}"
                onpaste="_handleManualConvPaste(event)">
            </td>`).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;">
      <span style="font-size:11px;color:var(--gray-400);">${selConv.solution_metric} · ${dateList.length}일 × ${allMedia.length}개 매체</span>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-sm btn-outline" onclick="renderManualConvData()">초기화</button>
        <button class="btn btn-primary btn-sm" onclick="saveManualConvData()">💾 저장</button>
      </div>
    </div>
  </div>

  <!-- 이력 (날짜별 아코디언) -->
  ${(()=>{
    const histByDate = {};
    stored.forEach(r=>{ if(!histByDate[r.date]) histByDate[r.date]=[]; histByDate[r.date].push(r); });
    const sortedDates = Object.keys(histByDate).sort().reverse();
    if (!window._mcvHistExpanded) window._mcvHistExpanded = new Set();
    const histBody = sortedDates.length === 0
      ? `<div style="padding:24px;text-align:center;color:var(--gray-400);font-size:13px;">저장된 데이터가 없습니다.</div>`
      : `<table class="data-table" style="width:100%;font-size:12px;"><tbody>
          ${sortedDates.map(date=>{
            const entries = histByDate[date];
            const isExp = window._mcvHistExpanded.has(date);
            const total = entries.reduce((s,r)=>s+(Number(r.value)||0),0);
            const detailRows = isExp ? entries.slice().sort((a,b)=>a.media.localeCompare(b.media)).map(r=>{
              const cLabel = convs.find(c=>c.id===r.conv_id)?.solution_metric||'(삭제됨)';
              const ed = window._mcvEditingEntry;
              const isEditing = ed && ed.date===r.date && ed.media===r.media && ed.conv_id===r.conv_id;
              const valueCell = isEditing
                ? `<td style="padding:4px 8px;">
                    <input id="mcv-edit-inp" type="number" min="0" value="${r.value}"
                      style="width:80px;border:1px solid var(--primary);border-radius:6px;padding:3px 7px;font-size:12px;font-weight:600;"
                      onkeydown="if(event.key==='Enter')updateManualConvEntry('${r.date}','${r.media}',${r.conv_id});if(event.key==='Escape')cancelEditManualConvEntry();">
                  </td>
                  <td style="padding:4px 8px;text-align:right;white-space:nowrap;">
                    <button class="btn btn-xs" style="background:var(--primary);color:#fff;border:none;font-size:10px;padding:2px 8px;"
                      onclick="updateManualConvEntry('${r.date}','${r.media}',${r.conv_id})">✓</button>
                    <button class="btn btn-xs" style="background:var(--gray-200);color:var(--gray-600);border:none;font-size:10px;padding:2px 7px;margin-left:3px;"
                      onclick="cancelEditManualConvEntry()">✗</button>
                  </td>`
                : `<td class="text-right" style="padding:6px 12px;font-weight:600;">${fmtN(r.value)}</td>
                  <td style="padding:6px 10px;text-align:right;white-space:nowrap;">
                    <button class="btn btn-xs" style="background:#EEF2FF;color:#4F46E5;border:1px solid #C7D2FE;font-size:10px;padding:1px 7px;margin-right:3px;"
                      onclick="event.stopPropagation();editManualConvEntry('${r.date}','${r.media}',${r.conv_id})">수정</button>
                    <button class="btn btn-xs" style="background:#FEE2E2;color:#DC2626;border:1px solid #FCA5A5;font-size:10px;padding:1px 7px;"
                      onclick="event.stopPropagation();deleteManualConvEntry('${r.date}','${r.media}',${r.conv_id})">삭제</button>
                  </td>`;
              return `<tr style="background:#F8FAFF;">
                <td style="padding:6px 28px;color:var(--gray-700);font-size:12px;">${r.media}</td>
                <td style="padding:6px 8px;"><span style="font-size:10px;background:var(--primary-light);color:var(--primary);padding:1px 6px;border-radius:8px;">${cLabel}</span></td>
                ${valueCell}
              </tr>`;
            }).join('') : '';
            return `<tr onclick="toggleMcvHistDate('${date}')" style="cursor:pointer;background:var(--gray-50);border-bottom:1px solid var(--gray-200);">
              <td colspan="4" style="padding:10px 14px;">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                  <div style="display:flex;align-items:center;gap:10px;">
                    <span style="font-size:10px;color:var(--gray-400);width:12px;display:inline-block;">${isExp?'▼':'▶'}</span>
                    <span style="font-weight:700;font-size:13px;">📅 ${date}</span>
                    <span style="font-size:10px;background:var(--gray-200);color:var(--gray-600);padding:2px 8px;border-radius:10px;">${entries.length}건</span>
                    <span style="font-size:11px;color:var(--gray-400);">합계 ${fmtN(total)}</span>
                  </div>
                  <button class="btn btn-xs" style="background:#FEE2E2;color:#DC2626;border:1px solid #FCA5A5;font-size:10px;padding:2px 8px;"
                    onclick="event.stopPropagation();deleteManualConvDate('${date}')">전체 삭제</button>
                </div>
              </td>
            </tr>${detailRows}`;
          }).join('')}
        </tbody></table>`;
    return `<div class="card"><div class="card-header"><div class="card-title">입력 이력</div><div class="card-sub">날짜 클릭 시 세부 내용 확인·삭제</div></div>${histBody}</div>`;
  })()}`;
}

function _handleManualConvPaste(event) {
  event.preventDefault();
  const text = (event.clipboardData||window.clipboardData).getData('text');
  if (!text) return;
  const pasteRows = text.trim().split(/\r?\n/).map(r=>r.split('\t'));
  const startInput = event.target;
  const tbody = startInput.closest('tbody');
  if (!tbody) return;
  const allTbodyRows = [...tbody.querySelectorAll('tr')];
  const startTr = startInput.closest('tr');
  const startTd = startInput.closest('td');
  const rowIdx = allTbodyRows.indexOf(startTr);
  const colIdx = [...startTr.querySelectorAll('td')].indexOf(startTd);
  pasteRows.forEach((pr, ri) => {
    const tRow = allTbodyRows[rowIdx + ri];
    if (!tRow) return;
    const tds = [...tRow.querySelectorAll('td')];
    pr.forEach((val, ci) => {
      const tTd = tds[colIdx + ci];
      if (!tTd) return;
      const inp = tTd.querySelector('input[type="number"]');
      if (inp) inp.value = val.trim().replace(/[^0-9.]/g,'');
    });
  });
}

function saveManualConvData() {
  const cells = document.querySelectorAll('.manual-conv-cell');
  if (!cells.length) { showToast('입력 테이블이 없습니다','warning'); return; }
  // 현재 편집 중인 기간+지표 범위만 제거 후 재삽입
  const selConvId = window._mcvConvId;
  const fromDate = window._mcvFrom, toDate = window._mcvTo;
  let stored = _getManualConvData().filter(r=>!(r.conv_id===selConvId && r.date>=fromDate && r.date<=toDate));
  let cnt = 0;
  cells.forEach(inp=>{
    const val = inp.value.trim();
    if (val !== '') {
      stored.push({date:inp.dataset.date, media:inp.dataset.media, conv_id:Number(inp.dataset.convId), value:Number(val)});
      cnt++;
    }
  });
  _saveManualConvDataStore(stored);
  showToast(`${cnt}건 저장 완료 — 대시보드·리포트에 자동 반영됩니다`, 'success');
  // 대시보드·MR 갱신
  if (document.getElementById('panel-overview')?.style.display==='block') _renderDashBody();
  renderManualConvData();
}

function toggleMcvHistDate(date) {
  if (!window._mcvHistExpanded) window._mcvHistExpanded = new Set();
  if (window._mcvHistExpanded.has(date)) {
    window._mcvHistExpanded.delete(date);
    if (window._mcvEditingEntry?.date === date) window._mcvEditingEntry = null;
  } else window._mcvHistExpanded.add(date);
  renderManualConvData();
}

function editManualConvEntry(date, media, convId) {
  if (!window._mcvHistExpanded) window._mcvHistExpanded = new Set();
  window._mcvHistExpanded.add(date);
  window._mcvEditingEntry = { date, media, conv_id: convId };
  renderManualConvData();
  setTimeout(() => { const i = document.getElementById('mcv-edit-inp'); if (i) { i.focus(); i.select(); } }, 60);
}

function updateManualConvEntry(date, media, convId) {
  const inp = document.getElementById('mcv-edit-inp');
  if (!inp) return;
  const newVal = Math.max(0, parseInt(inp.value, 10) || 0);
  const stored = _getManualConvData();
  stored.forEach(r => { if (r.date===date && r.media===media && r.conv_id===convId) r.value = newVal; });
  _saveManualConvDataStore(stored);
  window._mcvEditingEntry = null;
  showToast('전환수 수정 완료', 'success');
  if (document.getElementById('panel-overview')?.style.display==='block') _renderDashBody();
  renderManualConvData();
}

function cancelEditManualConvEntry() {
  window._mcvEditingEntry = null;
  renderManualConvData();
}

function deleteManualConvEntry(date, media, convId) {
  if (!confirm(`${date} / ${media} 항목을 삭제하시겠습니까?`)) return;
  _saveManualConvDataStore(_getManualConvData().filter(r=>!(r.date===date&&r.media===media&&r.conv_id===convId)));
  renderManualConvData();
}

function deleteManualConvDate(date) {
  if (!confirm(`${date} 전체 데이터를 삭제하시겠습니까?`)) return;
  _saveManualConvDataStore(_getManualConvData().filter(r=>r.date!==date));
  if (window._mcvHistExpanded) window._mcvHistExpanded.delete(date);
  renderManualConvData();
}

// 특정 기간의 수기 전환 합계
function _getManualConvSum(convId, fromDate, toDate, mediaName) {
  return _getManualConvData()
    .filter(r=>r.conv_id===convId && r.date>=fromDate && r.date<=toDate
               && (mediaName===undefined || r.media===mediaName))
    .reduce((s,r)=>s+(Number(r.value)||0), 0);
}

// ============================================================
// 리포트양식 대량업로드 (매핑 매트릭스 + CSV 업/다운)
// ============================================================
const BASE_METRICS = [
  {key:'imp',label:'노출수'},{key:'click',label:'클릭수'},{key:'cost',label:'광고비'},
  {key:'cpc',label:'CPC'},{key:'cpm',label:'CPM'}
];

const _COL_SYNC_KEY = 'deepfle_col_sync';

const _CSYNC_COLS = [
  {key:'imp',  label:'노출수'},
  {key:'clk',  label:'클릭수'},
  {key:'cost', label:'광고비'},
  {key:'conv', label:'전환수', extPriority: true},
  {key:'rev',  label:'전환매출'},
];

// 매체 키별 API 필드명 예시 (placeholder)
const _CSYNC_EXAMPLES = {
  meta:           ['impressions', 'clicks', 'spend', 'actions[purchase]', 'action_values[purchase]'],
  naver_sa:       ['impressionCnt', 'clickCnt', 'salesAmt', 'rvConversionCnt', 'rvConversionAmt'],
  google:         ['impressions', 'clicks', 'cost_micros', 'conversions', 'conversions_value'],
  kakao:          ['impression_count', 'click_count', 'cost', 'conversion_count', 'revenue'],
  kakao_biz:      ['imp', 'click', 'cost', 'conversion', 'revenue'],
  naver_shopping: ['impCnt', 'clickCnt', 'salesAmt', 'purchaseCnt', 'purchaseAmt'],
  tiktok:         ['impression', 'click', 'spend', 'conversion', 'revenue'],
  youtube:        ['impressions', 'clicks', 'cost', 'conversions', 'conversions_value'],
  karrot:         ['impressions', 'clicks', 'charge_fee', 'conversions', 'revenue'],
  taboola:        ['impressions', 'clicks', 'spent', 'conversions_value', 'revenue'],
  dable:          ['imp', 'click', 'cost', 'conv', 'revenue'],
  moloco:         ['impressions', 'clicks', 'spend', 'installs', 'revenue'],
};

function renderColumnSyncView() {
  const el = document.getElementById('reportBulkBody');
  if (!el) return;
  const editable = CAN_EDIT(currentUser?.role);

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(_accKey(_COL_SYNC_KEY)) || '{}') || {}; } catch(e) {}

  // 연동된(on) 매체만 표시
  const activeMed = MEDIA_DATA.filter(m => m.on && m.key);

  if (activeMed.length === 0) {
    el.innerHTML = `<div class="card">
      <div style="text-align:center;padding:40px 20px;color:var(--gray-400);">
        <div style="font-size:32px;margin-bottom:12px;">📡</div>
        <div style="font-weight:600;margin-bottom:4px;">연동된 매체가 없습니다</div>
        <div style="font-size:12px;">매체 연동 설정 후 컬럼 동기화를 설정할 수 있습니다.</div>
      </div>
    </div>`;
    return;
  }

  // 예시 텍스트 (연동된 첫 2개 매체 기준)
  const exampleLines = activeMed.slice(0, 2).map(m => {
    const ex = _CSYNC_EXAMPLES[m.key] || [];
    const pairs = _CSYNC_COLS.slice(0, 3).map((c, i) => ex[i] ? `<code style="font-family:monospace;background:rgba(255,255,255,.6);padding:1px 5px;border-radius:3px;">${ex[i]}</code> → ${c.label}` : '').filter(Boolean);
    return `<b>${m.name}</b>: ${pairs.join(' &nbsp;·&nbsp; ')}`;
  }).join('<br>');

  const theadCols = _CSYNC_COLS.map(c => `
    <th style="padding:10px 12px;font-size:11px;font-weight:700;color:var(--gray-600);text-align:center;
               border-bottom:2px solid var(--gray-200);background:var(--gray-50);white-space:nowrap;min-width:130px;">
      <div style="font-size:10px;color:var(--gray-400);font-weight:500;margin-bottom:2px;">DeepFle 지표</div>
      ${c.label}
      ${c.extPriority ? `<div style="font-size:9px;color:var(--primary);font-weight:600;margin-top:2px;">외부솔루션 우선</div>` : ''}
    </th>`).join('');

  const tbodyRows = activeMed.map((m, ri) => {
    const ex = _CSYNC_EXAMPLES[m.key] || [];
    return `
    <tr style="${ri%2===1 ? 'background:var(--gray-50);' : ''}">
      <td style="padding:10px 14px;border-bottom:1px solid var(--gray-100);white-space:nowrap;">
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:8px;height:8px;border-radius:50%;background:${m.color};flex-shrink:0;"></div>
          <span style="font-size:12px;font-weight:600;color:var(--gray-800);">${m.name}</span>
        </div>
      </td>
      ${_CSYNC_COLS.map((c, ci) => {
        const val = saved[m.key]?.[ci] || '';
        const ph = ex[ci] || 'API 필드명';
        return `<td style="padding:8px 10px;border-bottom:1px solid var(--gray-100);text-align:center;">
          ${editable
            ? `<input type="text" id="csync_${m.key}_${ci}" value="${val.replace(/"/g,'&quot;')}" placeholder="${ph}"
                 style="width:100%;min-width:110px;height:28px;font-size:11px;font-family:monospace;
                        text-align:center;padding:2px 6px;border:1.5px solid var(--gray-200);
                        border-radius:5px;outline:none;background:#fff;color:var(--gray-800);"
                 onfocus="this.style.borderColor='var(--primary)'" onblur="this.style.borderColor='var(--gray-200)'">`
            : (val
                ? `<code style="font-size:11px;font-family:monospace;color:#0F766E;background:#F0FDF4;padding:2px 7px;border-radius:4px;white-space:nowrap;">${val}</code>`
                : `<span style="font-size:11px;color:var(--gray-300);">미설정</span>`)
          }
        </td>`;
      }).join('')}
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="card">
      <div class="card-header" style="margin-bottom:4px;">
        <div>
          <div class="card-title">매체-솔루션간 컬럼 동기화</div>
          <div class="card-sub">연동된 매체의 API 필드명 → DeepFle 표준 지표 매핑</div>
        </div>
        ${editable ? `<button class="btn btn-sm btn-primary" onclick="saveColSync()">저장</button>` : ''}
      </div>
      <div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:8px;padding:12px 16px;
                  font-size:12px;color:#0369A1;margin:12px 0 20px;line-height:2;">
        <div style="font-weight:700;margin-bottom:6px;">입력 예시</div>
        ${exampleLines}
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(186,230,253,.6);
                    font-size:11px;color:#0369A1;opacity:.85;">
          ※ <b>전환수</b> 컬럼은 GA4·MMP 등 외부 솔루션이 연동된 경우 해당 데이터가 우선 적용됩니다.
          직접 입력한 API 필드값은 외부 솔루션 미연동 시에만 사용됩니다.
        </div>
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;min-width:600px;">
          <thead>
            <tr>
              <th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--gray-600);
                         text-align:left;border-bottom:2px solid var(--gray-200);background:var(--gray-50);
                         white-space:nowrap;">매체</th>
              ${theadCols}
            </tr>
          </thead>
          <tbody>${tbodyRows}</tbody>
        </table>
      </div>
      <div style="margin-top:16px;display:flex;align-items:center;justify-content:center;gap:10px;
                  padding:10px;border-radius:8px;background:var(--gray-50);border:1px solid var(--gray-200);">
        <span style="font-size:12px;color:var(--gray-500);">매체 API 필드명</span>
        <span style="font-size:18px;color:var(--primary);">→</span>
        <span style="font-size:12px;font-weight:700;color:var(--primary);">DeepFle 지표에 동기화</span>
      </div>
    </div>`;
}

function saveColSync() {
  const activeMed = MEDIA_DATA.filter(m => m.on && m.key);
  let existing = {};
  try { existing = JSON.parse(localStorage.getItem(_accKey(_COL_SYNC_KEY)) || '{}'); } catch(e) {}
  activeMed.forEach(m => {
    existing[m.key] = _CSYNC_COLS.map((_, ci) => {
      const inp = document.getElementById(`csync_${m.key}_${ci}`);
      return inp ? inp.value.trim() : (existing[m.key]?.[ci] || '');
    });
  });
  localStorage.setItem(_accKey(_COL_SYNC_KEY), JSON.stringify(existing));
  showToast('컬럼 동기화 설정이 저장되었습니다', 'success');
}

// renderReportBulkUpload alias for backward compatibility
function renderReportBulkUpload() { renderColumnSyncView(); }

// ── (구) bulk upload helpers — removed ────────────────────────────────────────
function _resetBulkSaved(){}
function _updateBulkStep(){}
function downloadBulkTemplate(){ showToast('이 기능은 더 이상 사용되지 않습니다','info'); }
function handleBulkUpload(){}
function saveBulkMap(){}


// ============================================================
// (구) 리포트 내보내기 — 탭 제거됨, 내부 함수는 유지
// ============================================================
async function renderReportExport() {
  const el = document.getElementById('reportSetBody');
  if (!el) return;
  const accId = currentAccount?.id;

  if (DEEPFLE_API.live && accId) {
    try {
      const rc = await DEEPFLE_API.get(`/accounts/${accId}/report-config`);
      _rsConfigs = rc.configs || [];
      _rsConfigs.forEach(c => {
        try { c._columns = JSON.parse(c.columns_json || '[]'); } catch(e) { c._columns = []; }
        try { c._media   = JSON.parse(c.media_json   || '[]'); } catch(e) { c._media   = []; }
      });
    } catch(e) { _rsConfigs = []; }
    try {
      const rh = await DEEPFLE_API.get(`/accounts/${accId}/report-history`);
      _rsHistory = rh.history || [];
    } catch(e) { _rsHistory = []; }
  } else {
    _rsConfigs = JSON.parse(localStorage.getItem('deepfle_rs_configs') || '[]');
    _rsHistory = JSON.parse(localStorage.getItem('deepfle_rs_history') || '[]');
  }
  _rsRender(el);
}

function _rsRender(el) {
  if (!el) el = document.getElementById('reportSetBody');
  if (!el) return;
  const canEdit = CAN_EDIT(currentUser?.role);
  const cycleLabel = {manual:'수동', daily:'매일', weekly:'매주'};

  const configRows = _rsConfigs.map((c, i) => {
    const cols = (c._columns || []).map(k => {
      const m = RS_ALL_COLUMNS.find(x=>x.key===k);
      return m ? m.label : k;
    }).join(', ');
    const medias = (c._media || []).map(k => MEDIA_LABELS[k] || k).join(', ') || '전체';
    return `<tr>
      <td style="font-weight:600;">${c.name || '(이름 없음)'}</td>
      <td style="font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${cols}">${cols || '-'}</td>
      <td>${medias}</td>
      <td><span class="badge ${c.update_cycle==='daily'?'badge-green':c.update_cycle==='weekly'?'badge-blue':'badge-gray'}">${cycleLabel[c.update_cycle]||c.update_cycle}</span></td>
      <td style="font-size:11px;color:var(--gray-400);">${c.last_pull ? new Date(c.last_pull).toLocaleString('ko') : '-'}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-sm btn-outline" onclick="_rsEdit(${i})">편집</button>
        <button class="btn btn-sm btn-primary" onclick="_rsExport(${i})">엑셀</button>
        ${canEdit ? `<button class="btn btn-sm btn-danger-outline" onclick="_rsDelete(${i})">삭제</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  const historyRows = _rsHistory.slice(0, 10).map(h => `<tr>
    <td style="font-size:11px;">${h.file_name || '-'}</td>
    <td style="font-size:11px;">${h.period_from || ''} ~ ${h.period_to || ''}</td>
    <td><span class="badge ${h.status==='done'?'badge-green':'badge-red'}">${h.status==='done'?'완료':'오류'}</span></td>
    <td style="font-size:11px;color:var(--gray-400);">${h.created_at ? new Date(h.created_at).toLocaleString('ko') : '-'}</td>
  </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--gray-400);padding:24px;">내보내기 이력이 없습니다</td></tr>';

  el.innerHTML = `
    <!-- 1. 리포트 구성 목록 -->
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header">
        <div><div class="card-title">리포트 구성</div><div class="card-sub">엑셀 내보내기에 사용할 컬럼·매체·갱신 주기 설정</div></div>
        <div style="display:flex;gap:8px;">
          ${canEdit ? `<button class="btn btn-sm btn-primary" onclick="_rsNew()">+ 새 리포트</button>` : ''}
          ${canEdit ? `<button class="btn btn-sm btn-outline" onclick="_rsPull()">🔄 지금 갱신</button>` : ''}
        </div>
      </div>
      ${_rsConfigs.length ? `<div style="overflow-x:auto;margin-top:8px;"><table class="data-table"><thead><tr>
        <th>리포트명</th><th>컬럼</th><th>매체</th><th>갱신주기</th><th>마지막 갱신</th><th>관리</th>
      </tr></thead><tbody>${configRows}</tbody></table></div>` :
      `<div class="empty" style="padding:30px;text-align:center;">
        <div style="font-size:28px;margin-bottom:8px;">📋</div>
        <div style="font-size:13px;color:var(--gray-600);">리포트 구성이 없습니다. <b>+ 새 리포트</b>를 클릭하여 추가하세요.</div>
      </div>`}
    </div>
    <!-- 2. 리포트 편집/생성 모달 영역 -->
    <div id="rsEditorArea"></div>
    <!-- 3. 내보내기 이력 -->
    <div class="card">
      <div class="card-header"><div class="card-title">내보내기 이력</div></div>
      <div style="overflow-x:auto;margin-top:8px;"><table class="data-table"><thead><tr>
        <th>파일명</th><th>기간</th><th>상태</th><th>생성일</th>
      </tr></thead><tbody>${historyRows}</tbody></table></div>
    </div>`;
}

function _rsNew() {
  _rsEditIdx = -1;
  _rsShowEditor({
    name: '', _columns: ['date','media','cost','imp','click','conv','revenue','ctr','cpc','roas'],
    _media: ['meta','google','naver_sa','kakao'], update_cycle: 'manual'
  });
}

function _rsEdit(idx) {
  _rsEditIdx = idx;
  _rsShowEditor({..._rsConfigs[idx]});
}

function _rsShowEditor(cfg) {
  const area = document.getElementById('rsEditorArea');
  if (!area) return;
  const selCols = cfg._columns || [];
  const availCols = RS_ALL_COLUMNS.filter(c => !c.fixed && !selCols.includes(c.key));
  const selMedia = cfg._media || [];
  const cycleLabel = {manual:'수동', daily:'매일', weekly:'매주'};

  area.innerHTML = `
    <div class="card" style="margin-bottom:16px;border:2px solid var(--primary);position:relative;">
      <button class="btn btn-sm" onclick="document.getElementById('rsEditorArea').innerHTML=''" style="position:absolute;top:10px;right:10px;font-size:16px;">✕</button>
      <div class="card-header"><div class="card-title">${_rsEditIdx >= 0 ? '리포트 편집' : '새 리포트 생성'}</div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px;">
        <!-- 좌: 기본 설정 -->
        <div>
          <div class="form-group"><label class="form-label">리포트명</label>
            <input class="form-input" id="rsEdName" value="${cfg.name || ''}" placeholder="일간 매체 성과 리포트">
          </div>
          <div class="form-group"><label class="form-label">갱신 주기</label>
            <select class="form-input" id="rsEdCycle">
              ${['manual','daily','weekly'].map(v => `<option value="${v}" ${cfg.update_cycle===v?'selected':''}>${cycleLabel[v]}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label class="form-label">매체 선택</label>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${RS_ALL_MEDIA.map(m => `<label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;">
                <input type="checkbox" class="rsMediaChk" value="${m}" ${selMedia.includes(m)?'checked':''}>
                ${MEDIA_LABELS[m]||m}
              </label>`).join('')}
            </div>
          </div>
        </div>
        <!-- 우: 컬럼 구성 -->
        <div>
          <div class="form-group"><label class="form-label">사용 가능 컬럼</label>
            <div id="rsAvailPool" style="display:flex;flex-wrap:wrap;gap:4px;min-height:32px;padding:8px;border:1px dashed var(--gray-200);border-radius:6px;">
              ${availCols.map(c => `<span class="metric-chip" style="cursor:pointer;" onclick="_rsAddCol('${c.key}')">${c.label} ${c.derived?'<span style=\"font-size:9px;color:var(--gray-400);\">(파생)</span>':''}</span>`).join('')}
            </div>
          </div>
          <div class="form-group"><label class="form-label">선택된 컬럼 (순서대로 엑셀 출력)</label>
            <div id="rsSelPool" style="display:flex;flex-wrap:wrap;gap:4px;min-height:32px;padding:8px;border:1px solid var(--primary);border-radius:6px;background:var(--primary-light);">
              ${selCols.filter(k=>!RS_ALL_COLUMNS.find(c=>c.key===k)?.fixed).map(k => {
                const m = RS_ALL_COLUMNS.find(c=>c.key===k);
                return `<span class="metric-chip conv" style="cursor:pointer;" onclick="_rsRemoveCol('${k}')">${m?m.label:k} ✕</span>`;
              }).join('')}
            </div>
            <div style="font-size:10px;color:var(--gray-400);margin-top:4px;">날짜, 매체는 기본 포함. 클릭하여 추가/제거</div>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
        <button class="btn btn-sm btn-outline" onclick="document.getElementById('rsEditorArea').innerHTML=''">취소</button>
        <button class="btn btn-sm btn-primary" onclick="_rsSave()">저장</button>
      </div>
    </div>`;
  window._rsEditorCfg = cfg;
}

function _rsAddCol(key) {
  const cfg = window._rsEditorCfg;
  if (!cfg || cfg._columns.includes(key)) return;
  cfg._columns.push(key);
  _rsShowEditor(cfg);
}

function _rsRemoveCol(key) {
  const cfg = window._rsEditorCfg;
  if (!cfg) return;
  cfg._columns = cfg._columns.filter(k => k !== key);
  _rsShowEditor(cfg);
}

async function _rsSave() {
  const cfg = window._rsEditorCfg;
  if (!cfg) return;
  const name = document.getElementById('rsEdName')?.value?.trim() || '기본 리포트';
  const cycle = document.getElementById('rsEdCycle')?.value || 'manual';
  const mediaChks = document.querySelectorAll('.rsMediaChk:checked');
  const media = Array.from(mediaChks).map(c => c.value);
  const payload = { name, columns: cfg._columns, media, update_cycle: cycle };

  if (DEEPFLE_API.live && currentAccount) {
    if (_rsEditIdx >= 0 && _rsConfigs[_rsEditIdx]?.id) payload.id = _rsConfigs[_rsEditIdx].id;
    try {
      await DEEPFLE_API.post(`/accounts/${currentAccount.id}/report-config`, payload);
      showToast('리포트 설정이 저장되었습니다', 'success');
    } catch(e) { showToast(e.message, 'error'); return; }
  } else {
    if (_rsEditIdx >= 0) {
      _rsConfigs[_rsEditIdx] = {..._rsConfigs[_rsEditIdx], name, _columns: cfg._columns, _media: media, update_cycle: cycle};
    } else {
      _rsConfigs.push({name, _columns: cfg._columns, _media: media, update_cycle: cycle, id: Date.now()});
    }
    localStorage.setItem('deepfle_rs_configs', JSON.stringify(_rsConfigs));
  }
  await renderReportExport();
}

async function _rsDelete(idx) {
  if (!confirm('이 리포트 설정을 삭제하시겠습니까?')) return;
  if (DEEPFLE_API.live && currentAccount && _rsConfigs[idx]?.id) {
    try {
      await DEEPFLE_API.del(`/report-config/${_rsConfigs[idx].id}`);
      showToast('삭제되었습니다', 'success');
    } catch(e) { showToast(e.message, 'error'); return; }
  } else {
    _rsConfigs.splice(idx, 1);
    localStorage.setItem('deepfle_rs_configs', JSON.stringify(_rsConfigs));
  }
  await renderReportExport();
}

async function _rsPull() {
  if (!DEEPFLE_API.live || !currentAccount) {
    showToast('백엔드 연결이 필요합니다', 'error');
    return;
  }
  try {
    const res = await DEEPFLE_API.post(`/accounts/${currentAccount.id}/metric-data/pull`);
    showToast(`데이터 갱신 완료: ${res.inserted}건 (${res.date})`, 'success');
    await renderReportExport();
  } catch(e) { showToast(e.message, 'error'); }
}

async function _rsExport(idx) {
  const cfg = _rsConfigs[idx];
  if (!cfg) return;
  const today = new Date();
  const from = new Date(today.getTime() - 30*86400000).toISOString().slice(0,10);
  const to = today.toISOString().slice(0,10);
  const payload = { from, to, columns: cfg._columns || [], media: cfg._media || [] };

  if (DEEPFLE_API.live && currentAccount) {
    try {
      const res = await DEEPFLE_API.post(`/accounts/${currentAccount.id}/report-export`, payload);
      _rsDownloadCsv(res.columns, res.rows, res.fileName);
      showToast(`${res.fileName} 다운로드 (${res.rowCount}행)`, 'success');
      await renderReportExport();
    } catch(e) { showToast(e.message, 'error'); }
  } else {
    showToast('백엔드 연결 시 엑셀 내보내기가 활성화됩니다', 'info');
  }
}

function _rsDownloadCsv(columns, rows, fileName) {
  const colLabels = columns.map(k => {
    const m = RS_ALL_COLUMNS.find(c=>c.key===k);
    return m ? m.label : k;
  });
  const mediaLbl = k => MEDIA_LABELS[k] || k;
  let csv = '﻿' + colLabels.join(',') + '\n';
  for (const r of rows) {
    csv += columns.map(k => {
      if (k === 'media') return mediaLbl(r[k] || '');
      return r[k] ?? '';
    }).join(',') + '\n';
  }
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (fileName || 'report').replace('.xlsx', '.csv');
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ============================================================
// SETTINGS
// ============================================================
function renderSettings() {
  // 설정 클릭 시 항상 리포트 설정 > 매체 연동을 기본 표시
  const connCard = document.getElementById('subCard-connection');
  if (connCard) switchSettingSubTab(connCard, 'connection', 'report');
}

// 내 계정 모달 열기 (사이드바 아바타 / 상단 역할 인디케이터 클릭 시)
function openMyAccount() {
  renderMyAccountContent();
  document.getElementById('modal-myAccount').classList.add('open');
}

function renderMyAccountContent() {
  const body = document.getElementById('myAccountBody');
  if (!body) return;
  const ej = _getEmailjsConfig();
  const isSet = !!(ej.publicKey && ej.serviceId && ej.templateVerify && ej.templateReport);
  body.innerHTML = `
    <div class="card" style="margin-bottom:0;box-shadow:none;border:none;padding:0;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div class="form-group" style="margin:0;"><label class="form-label">이름</label><input class="form-input" id="maName" value="${currentUser.name||''}"></div>
        <div class="form-group" style="margin:0;"><label class="form-label">이메일</label><input class="form-input" id="maEmail" value="${currentUser.email||''}" readonly style="background:var(--gray-50)"></div>
      </div>
      <div style="padding-top:14px;border-top:1px solid var(--gray-100);margin-bottom:14px;">
        <div style="font-size:12px;font-weight:600;color:var(--gray-600);text-transform:uppercase;margin-bottom:10px;">비밀번호 변경</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <input class="form-input" type="password" id="maPwCurrent" placeholder="현재 비밀번호" style="font-size:13px;">
          <input class="form-input" type="password" id="maPwNew" placeholder="새 비밀번호 (8자 이상)" style="font-size:13px;">
          <input class="form-input" type="password" id="maPwConfirm" placeholder="새 비밀번호 확인" style="font-size:13px;">
        </div>
      </div>
      ${currentUser.role !== 'advertiser' ? `<div style="padding-top:14px;border-top:1px solid var(--gray-100);margin-bottom:14px;">
        <div style="font-size:12px;font-weight:600;color:var(--gray-600);text-transform:uppercase;margin-bottom:10px;">데이터 · 연동 상태</div>
        <div style="display:flex;align-items:center;justify-content:space-between;font-size:13px;margin-bottom:10px;">
          <span>API 연동 모드</span>
          <span class="badge ${DEEPFLE_API.USE_MOCK?'badge-orange':'badge-green'}">${DEEPFLE_API.USE_MOCK?'🧪 Mock (localStorage)':'🟢 Live'}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;font-size:13px;margin-bottom:14px;">
          <span>로컬 저장 상태</span>
          <span style="font-size:12px;color:var(--gray-400);">${localStorage.getItem(STORE_KEY)?'자동 저장됨 ✓':'세션 데이터'}</span>
        </div>
        ${IS_MASTER(currentUser.role)?`<button class="btn btn-sm btn-danger-outline" onclick="resetData()">데이터 초기화</button>`:''}
      </div>` : ''}
      ${IS_MASTER(currentUser.role) ? `<div style="padding-top:14px;border-top:1px solid var(--gray-100);margin-bottom:14px;">
        <div style="font-size:12px;font-weight:600;color:var(--gray-600);text-transform:uppercase;margin-bottom:10px;">이메일 발송 인증</div>
        <div style="font-size:11px;color:var(--gray-400);margin-bottom:10px;">리포트 자동발송 및 즉시발송에 사용할 이메일을 인증합니다. 입력한 이메일로 보안키가 발송됩니다.</div>
        <div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:10px;">
          <div class="form-group" style="flex:1;margin:0;"><label style="font-size:11px;color:var(--gray-500);">발송 이메일</label><input class="form-input" id="emailVerifyAddr" placeholder="user@company.com" style="font-size:12px;height:34px;" value="${localStorage.getItem('deepfle_verified_email')||currentUser.email||''}"></div>
          <button class="btn btn-sm btn-outline" style="height:34px;white-space:nowrap;" onclick="sendEmailSecurityKey()">보안키 발송</button>
        </div>
        <div id="emailKeySection" style="display:none;margin-bottom:10px;">
          <div style="display:flex;gap:8px;align-items:center;">
            <input class="form-input" id="emailSecurityKey" placeholder="보안키 6자리 입력" style="font-size:12px;height:34px;flex:1;max-width:200px;">
            <button class="btn btn-sm btn-primary" onclick="confirmEmailSecurityKey()">인증 확인</button>
          </div>
          <div id="emailKeyStatus" style="font-size:11px;color:var(--gray-400);margin-top:4px;"></div>
        </div>
        <div id="emailVerifiedBadge" style="font-size:12px;color:${localStorage.getItem('deepfle_smtp_verified')?'var(--success)':'var(--gray-400)'};">${localStorage.getItem('deepfle_smtp_verified')?'✅ '+(localStorage.getItem('deepfle_verified_email')||'')+' 인증 완료':'인증되지 않음'}</div>
      </div>` : ''}
      ${currentUser.role !== 'advertiser' ? `<div style="padding-top:14px;border-top:1px solid var(--gray-100);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div style="font-size:12px;font-weight:600;color:var(--gray-600);text-transform:uppercase;">EmailJS 연동 설정</div>
          <span style="font-size:10px;padding:2px 8px;border-radius:8px;background:${isSet?'#ECFDF5':'var(--gray-100)'};color:${isSet?'#065F46':'var(--gray-400)'};">${isSet?'✅ 연동됨':'미설정'}</span>
        </div>
        <div style="font-size:11px;color:var(--gray-400);margin-bottom:10px;">
          <a href="https://www.emailjs.com" target="_blank" style="color:var(--primary);">emailjs.com</a>에서 무료 계정 생성 후 아래 키를 입력하세요. (무료: 월 200건)
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div class="form-group" style="margin:0;"><label style="font-size:11px;color:var(--gray-500);">Public Key</label><input class="form-input" id="ejPublicKey" placeholder="예: user_xxxxxxxxxxxxxxxx" style="font-size:12px;height:34px;" value="${ej.publicKey||''}"></div>
          <div class="form-group" style="margin:0;"><label style="font-size:11px;color:var(--gray-500);">Service ID</label><input class="form-input" id="ejServiceId" placeholder="예: service_xxxxxxx" style="font-size:12px;height:34px;" value="${ej.serviceId||''}"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div class="form-group" style="margin:0;"><label style="font-size:11px;color:var(--gray-500);">Template ID (인증 메일용)</label><input class="form-input" id="ejTplVerify" placeholder="예: template_xxxxxxx" style="font-size:12px;height:34px;" value="${ej.templateVerify||''}"></div>
            <div class="form-group" style="margin:0;"><label style="font-size:11px;color:var(--gray-500);">Template ID (리포트 발송용)</label><input class="form-input" id="ejTplReport" placeholder="예: template_xxxxxxx" style="font-size:12px;height:34px;" value="${ej.templateReport||''}"></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:4px;">
            <button class="btn btn-sm btn-primary" onclick="saveEmailjsConfig()">저장</button>
            <button class="btn btn-sm btn-outline" onclick="testEmailjsConnection()" ${isSet?'':'disabled'}>연결 테스트</button>
          </div>
          <div id="ejTestStatus" style="font-size:11px;color:var(--gray-400);min-height:16px;"></div>
        </div>
      </div>` : ''}
    </div>`;
}

function saveMyAccountProfile() {
  const name = document.getElementById('maName')?.value?.trim();
  const pwCurrent = document.getElementById('maPwCurrent')?.value;
  const pwNew = document.getElementById('maPwNew')?.value;
  const pwConfirm = document.getElementById('maPwConfirm')?.value;
  if (!name) { showToast('이름을 입력해주세요', 'warning'); return; }
  if (pwNew || pwConfirm) {
    if (!pwCurrent) { showToast('현재 비밀번호를 입력해주세요', 'warning'); return; }
    if (pwNew.length < 8) { showToast('새 비밀번호는 8자 이상이어야 합니다', 'warning'); return; }
    if (pwNew !== pwConfirm) { showToast('새 비밀번호가 일치하지 않습니다', 'warning'); return; }
  }
  if (name !== currentUser.name) currentUser.name = name;
  showToast('저장되었습니다', 'success');
  applySidebar();
}

// ============================================================
// EmailJS 연동
// ============================================================
const EMAILJS_CONFIG_KEY = 'deepfle_emailjs_config';
function _getEmailjsConfig() { return JSON.parse(localStorage.getItem(EMAILJS_CONFIG_KEY) || '{}'); }
function _saveEmailjsConfigStore(d) { localStorage.setItem(EMAILJS_CONFIG_KEY, JSON.stringify(d)); }

function _initEmailjs() {
  const cfg = _getEmailjsConfig();
  if (cfg.publicKey && typeof emailjs !== 'undefined') {
    emailjs.init({ publicKey: cfg.publicKey });
    return true;
  }
  return false;
}

function saveEmailjsConfig() {
  const publicKey = document.getElementById('ejPublicKey')?.value?.trim();
  const serviceId = document.getElementById('ejServiceId')?.value?.trim();
  const templateVerify = document.getElementById('ejTplVerify')?.value?.trim();
  const templateReport = document.getElementById('ejTplReport')?.value?.trim();
  if (!publicKey || !serviceId) { showToast('Public Key와 Service ID는 필수입니다', 'warning'); return; }
  _saveEmailjsConfigStore({ publicKey, serviceId, templateVerify, templateReport });
  _initEmailjs();
  showToast('EmailJS 설정이 저장되었습니다', 'success');
  renderMyAccountContent();
}

function testEmailjsConnection() {
  const cfg = _getEmailjsConfig();
  if (!cfg.publicKey || !cfg.serviceId || !cfg.templateVerify) {
    showToast('저장된 설정이 없습니다', 'warning'); return;
  }
  if (typeof emailjs === 'undefined') { showToast('EmailJS SDK를 불러오지 못했습니다. 네트워크를 확인해 주세요', 'error'); return; }
  _initEmailjs();
  const statusEl = document.getElementById('ejTestStatus');
  if (statusEl) statusEl.innerHTML = '<span style="color:var(--gray-400);">연결 확인 중...</span>';
  const verifiedEmail = localStorage.getItem('deepfle_verified_email') || document.getElementById('emailVerifyAddr')?.value?.trim();
  if (!verifiedEmail) { showToast('먼저 발송 이메일을 입력해 주세요', 'warning'); return; }
  emailjs.send(cfg.serviceId, cfg.templateVerify, {
    to_email: verifiedEmail,
    to_name: '관리자',
    security_code: 'TEST-OK',
    expires_in: '테스트 메일'
  }).then(() => {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--success);">✅ 테스트 메일 발송 성공 — 받은편지함을 확인하세요</span>';
    showToast('테스트 메일 발송 성공!', 'success');
  }).catch(err => {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger);">❌ 발송 실패: ${err?.text || JSON.stringify(err)}</span>`;
    showToast('테스트 발송 실패 — 키/ID를 확인해 주세요', 'error');
  });
}

// 현재 세션의 인증 코드 (window 변수로 관리 — localStorage 저장 금지)
window._emailVerifySession = null; // { code, email, expiresAt }

function sendEmailSecurityKey() {
  const email = document.getElementById('emailVerifyAddr')?.value?.trim();
  if (!email || !email.includes('@')) { showToast('올바른 이메일 주소를 입력해 주세요', 'warning'); return; }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  window._emailVerifySession = { code, email, expiresAt: Date.now() + 10 * 60 * 1000 };

  const section = document.getElementById('emailKeySection');
  const status = document.getElementById('emailKeyStatus');

  const cfg = _getEmailjsConfig();
  const ejReady = cfg.publicKey && cfg.serviceId && cfg.templateVerify && typeof emailjs !== 'undefined';

  if (ejReady) {
    // 실제 발송
    _initEmailjs();
    if (status) status.innerHTML = '<span style="color:var(--gray-400);">발송 중...</span>';
    if (section) section.style.display = 'block';
    emailjs.send(cfg.serviceId, cfg.templateVerify, {
      to_email: email,
      to_name: currentUser?.name || '사용자',
      security_code: code,
      expires_in: '10분'
    }).then(() => {
      if (status) status.innerHTML = `<span style="color:var(--gray-500);">${email}로 보안키를 발송했습니다. 10분 내 입력해 주세요.</span>`;
      showToast(`${email}로 보안키 발송 완료`, 'success');
    }).catch(err => {
      if (status) status.innerHTML = `<span style="color:var(--danger);">발송 실패: ${err?.text || '네트워크 오류'} — EmailJS 설정을 확인해 주세요.</span>`;
      showToast('보안키 발송 실패', 'error');
      window._emailVerifySession = null;
    });
  } else {
    // 데모 모드 (EmailJS 미설정)
    if (section) section.style.display = 'block';
    if (status) status.innerHTML = `<span style="color:var(--gray-500);">데모 모드 — 실제 이메일이 발송되지 않습니다. 코드: <strong>${code}</strong></span>`;
    showToast(`데모 모드: 코드 ${code}`, 'info');
  }
}

function confirmEmailSecurityKey() {
  const input = document.getElementById('emailSecurityKey')?.value?.trim();
  const email = document.getElementById('emailVerifyAddr')?.value?.trim();
  const status = document.getElementById('emailKeyStatus');
  const badge = document.getElementById('emailVerifiedBadge');

  const session = window._emailVerifySession;
  const isExpired = !session || Date.now() > session.expiresAt;
  const isMatch   = session && input === session.code;
  const emailMatch = session && email === session.email;

  if (isExpired) {
    if (status) status.innerHTML = '<span style="color:var(--danger);">보안키가 만료되었습니다. 다시 발송해 주세요.</span>';
    return;
  }
  if (!emailMatch) {
    if (status) status.innerHTML = '<span style="color:var(--danger);">이메일 주소가 일치하지 않습니다.</span>';
    return;
  }
  if (isMatch) {
    localStorage.setItem('deepfle_smtp_verified', '1');
    localStorage.setItem('deepfle_verified_email', email);
    window._emailVerifySession = null;
    if (status) status.innerHTML = '<span style="color:var(--success);">✅ 보안키 인증 성공</span>';
    if (badge) { badge.textContent = '✅ ' + email + ' 인증 완료'; badge.style.color = 'var(--success)'; }
    document.getElementById('emailKeySection').style.display = 'none';
    showToast('이메일 인증 완료 — 리포트 발송이 가능합니다', 'success');
  } else {
    if (status) status.innerHTML = '<span style="color:var(--danger);">보안키가 올바르지 않습니다. 다시 확인해 주세요.</span>';
  }
}

// (deprecated) 설정의 OAuth 목업 카드 — 연결관리로 일원화되어 제거됨
function renderMediaConnectList() {
  const el = document.getElementById('mediaConnectList');
  if (!el) return;
  const connCount = connectedMedia.length;
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding-bottom:10px;border-bottom:1px solid var(--gray-100);">
      <span style="font-size:12px;color:var(--gray-400);">${connCount}개 매체 연동됨 / 총 ${ALL_MEDIA_NAMES.length}개</span>
    </div>` +
    ALL_MEDIA_NAMES.map(m=>{
      const conn = connectedMedia.includes(m);
      const meta = MEDIA_META[m] || {icon:'?',color:'#94A3B8',txt:'#fff'};
      const info = mediaConnInfo[m];
      return `<div class="media-connected-card">
        <div class="media-logo-box" style="background:${meta.color};color:${meta.txt};">${meta.icon}</div>
        <div class="media-conn-info">
          <div class="media-conn-name">${m} ${conn?'<span class="sync-dot synced"></span>':''}</div>
          <div class="media-conn-meta">${conn && info ? `${info.account} · 마지막 동기화 ${info.lastSync}` : 'OAuth 인증 필요'}</div>
        </div>
        <button class="btn btn-sm ${conn?'btn-danger-outline':'btn-primary'}" onclick="${conn?`disconnectMedia('${m}')`:`startOAuth('${m}')`}">
          ${conn?'연동 해제':'🔗 연동하기'}
        </button>
      </div>`;
    }).join('');
}

// ── OAuth 플로우 ──
function startOAuth(name) {
  _oauthPendingMedia = name;
  const meta = MEDIA_META[name] || {icon:'?',color:'#94A3B8',txt:'#fff'};
  document.getElementById('oauthBody').innerHTML = `
    <div class="oauth-screen">
      <div class="oauth-logos">
        <div class="oauth-logo-box" style="background:var(--primary);">A</div>
        <span class="oauth-connector">⇄</span>
        <div class="oauth-logo-box" style="background:${meta.color};color:${meta.txt};">${meta.icon}</div>
      </div>
      <div class="oauth-title">${name} 계정 연동</div>
      <div class="oauth-sub">DeepFle가 다음 권한으로 ${name} 광고 데이터에<br>접근하는 것을 허용합니다.</div>
      <div class="oauth-perms">
        <div class="oauth-perm-item"><span class="oauth-perm-check">✓</span> 캠페인·광고세트·소재 성과 데이터 조회</div>
        <div class="oauth-perm-item"><span class="oauth-perm-check">✓</span> 광고 ON/OFF 및 예산 관리</div>
        <div class="oauth-perm-item"><span class="oauth-perm-check">✓</span> 오디언스 생성 및 동기화</div>
        <div class="oauth-perm-item"><span class="oauth-perm-check">✓</span> 리포트용 통계 데이터 수집</div>
      </div>
      <div class="oauth-account-input">
        <label class="form-label">${name} 계정 ID</label>
        <input class="form-input" id="oauthAccount" placeholder="예) account@${name.includes('카카오')?'kakao':name.includes('네이버')?'naver':'media'}.biz">
      </div>
      <button class="btn btn-primary" style="width:100%;" onclick="confirmOAuth()">권한 동의 및 연동</button>
      <div style="font-size:11px;color:var(--gray-400);margin-top:10px;">🔒 OAuth 2.0 보안 인증을 사용합니다</div>
    </div>`;
  document.getElementById('modal-oauth').classList.add('open');
}

function confirmOAuth() {
  const name = _oauthPendingMedia;
  const account = (document.getElementById('oauthAccount').value || '').trim() || `${name.split(' ')[0]}_광고계정`;
  // 인증 중 스피너
  document.getElementById('oauthBody').innerHTML = `
    <div class="oauth-screen">
      <div class="oauth-spinner"></div>
      <div class="oauth-title">인증 중…</div>
      <div class="oauth-sub">${name} 서버와 보안 연결을 수립하고 있습니다.</div>
    </div>`;
  setTimeout(()=>{
    connectedMedia.push(name);
    mediaConnInfo[name] = {account, lastSync:'방금 전'};
    closeModal('oauth');
    renderMediaConnectList();
    showToast(`${name} 연동 완료 · 데이터 수집을 시작합니다`,'success');
    logActivity(`${name} 매체 연동 완료`);
    _oauthPendingMedia = null;
  }, 1300);
}

function disconnectMedia(name) {
  if (!confirm(`${name} 연동을 해제하시겠습니까?\n수집된 데이터는 유지되지만 신규 동기화가 중단됩니다.`)) return;
  connectedMedia = connectedMedia.filter(m=>m!==name);
  delete mediaConnInfo[name];
  renderMediaConnectList();
  showToast(`${name} 연동이 해제되었습니다`,'warning');
}

function switchSettingGroup(el, groupName) {
  document.getElementById('settingPrimaryTabs').querySelectorAll('.tab-pill').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  ['report','goals'].forEach(g=>{
    const e=document.getElementById('settingGroup-'+g); if(e) e.style.display=g===groupName?'block':'none';
  });
  if(groupName==='report') {
    // 매체 연동을 기본 서브탭으로 표시
    const connCard=document.getElementById('subCard-connection');
    if(connCard) switchSettingSubTab(connCard,'connection','report');
  }
  if(groupName==='goals') { renderSettingKpiTargets(); }
}

function switchSettingSubTab(el, tabName, groupName) {
  const group=document.getElementById('settingGroup-'+groupName);
  if(group) group.querySelectorAll('.setting-sub-card').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  const tabsMap={report:['markup','connection','rdcols'],goals:['kpi','alert']};
  (tabsMap[groupName]||[]).forEach(t=>{
    const e=document.getElementById('setting-'+t); if(e) e.style.display=t===tabName?'block':'none';
  });
  if(tabName==='connection') { renderConnectorMatrix(); renderSettingConnection(); }
  if(tabName==='kpi') { renderSettingKpiTargets(); }
  if(tabName==='markup') { renderMarkupSettings(); }
  if(tabName==='rdcols') { renderColumnSyncView(); }
}

function switchSettingTab(el, name) {
  const groupMap={markup:'report',connection:'report',rdcols:'report',kpi:'goals',alert:'goals'};
  const gName=groupMap[name]||'report';
  const primaryPill=document.querySelector(`#settingPrimaryTabs .tab-pill[onclick*="'${gName}'"]`);
  if(primaryPill) {
    document.getElementById('settingPrimaryTabs').querySelectorAll('.tab-pill').forEach(t=>t.classList.remove('active'));
    primaryPill.classList.add('active');
    ['report','goals'].forEach(g=>{const e=document.getElementById('settingGroup-'+g);if(e)e.style.display=g===gName?'block':'none';});
  }
  const subCard=document.getElementById('subCard-'+name);
  if(subCard) switchSettingSubTab(subCard, name, gName);
}

// ============================================================
// ============================================================
// 설정 > 매체 연동 탭
// ============================================================
// 매체별 픽셀 ID 스키마
// ============================================================
const MEDIA_PIXEL_CONFIG = {
  '카카오모먼트':    { label:'픽셀 & SDK 코드',      placeholder:'예: 123456789012',        hint:'카카오 광고관리자 > 픽셀 & SDK' },
  '카카오 비즈보드': { label:'픽셀 & SDK 코드',      placeholder:'예: 123456789012',        hint:'카카오 광고관리자 > 픽셀 & SDK' },
  '네이버 검색광고': { label:'전환추적 Script Key',  placeholder:'예: s_xxxxxxxxxxxx',      hint:'네이버 광고 > 도구 > 전환추적 > 스크립트 설치' },
  '네이버 쇼핑':    { label:'전환추적 Script Key',   placeholder:'예: s_xxxxxxxxxxxx',      hint:'네이버 광고 > 도구 > 전환추적 > 스크립트 설치' },
  '구글 Ads':       { label:'전환 태그 ID (Gtag)',   placeholder:'예: AW-123456789',        hint:'Google Ads > 도구 > 전환 > 태그 설정' },
  '유튜브':         { label:'GA4 측정 ID',           placeholder:'예: G-XXXXXXXXXX',        hint:'Google Analytics 4 > 관리 > 데이터 스트림' },
  '메타(페이스북)': { label:'메타 픽셀 ID',          placeholder:'예: 1234567890123456',    hint:'Meta Events Manager > 데이터 소스 > 픽셀 ID' },
  '틱톡':           { label:'TikTok 픽셀 ID',        placeholder:'예: CXXXXXXXXXXXXXXXXXX', hint:'TikTok Ads Manager > Assets > Events' },
  '당근마켓':       { label:'당근 픽셀 ID',          placeholder:'예: daangn-xxxxxxxx',     hint:'당근비즈니스 > 광고 관리 > 픽셀 설치' },
};
function _getMediaPixels() { return JSON.parse(localStorage.getItem(_accKey('deepfle_media_pixels'))||'{}'); }
function _saveMediaPixels(d) { localStorage.setItem(_accKey('deepfle_media_pixels'), JSON.stringify(d)); }
function saveMediaPixel(name, val) {
  const d = _getMediaPixels(); d[name] = val; _saveMediaPixels(d);
  const idx = MEDIA_DATA.findIndex(m=>m.name===name);
  if (idx < 0) return;
  const badge = document.getElementById('connHdrPix_'+idx);
  if (badge) badge.outerHTML = _connPixelBadgeHtml(idx, val);
}
function saveMediaPixelByIdx(idx, val) {
  const m = MEDIA_DATA[idx]; if (!m) return;
  saveMediaPixel(m.name, val);
}

// ============================================================
const EXT_SOLUTIONS = [
  { id:'ga4',        name:'Google Analytics 4', abbr:'GA4', color:'#F97316', category:'분석 툴',  desc:'웹·앱 행동 데이터 및 전환 수집' },
  { id:'acecounter', name:'에이스카운터',          abbr:'ACE', color:'#3B82F6', category:'분석 툴',  desc:'국내 트래킹 솔루션 · 전환지표 연동' },
  { id:'cafe24',     name:'Cafe24',              abbr:'C24', color:'#10B981', category:'이커머스', desc:'쇼핑몰 주문·매출 데이터 수집' },
  { id:'airbridge',  name:'Airbridge',           abbr:'AIR', color:'#8B5CF6', category:'MMP',    desc:'앱 어트리뷰션 · 딥링크' },
  { id:'adjust',     name:'Adjust',              abbr:'ADJ', color:'#EC4899', category:'MMP',    desc:'앱 어트리뷰션 · 사기 방지' },
  { id:'appsflyer',  name:'AppsFlyer',           abbr:'AF',  color:'#0EA5E9', category:'MMP',    desc:'앱 어트리뷰션 · ROI 측정' },
];
function _getExtConnected() { return JSON.parse(localStorage.getItem(_accKey('deepfle_ext_conn'))||'{}'); }
function _saveExtConnected(d) { localStorage.setItem(_accKey('deepfle_ext_conn'), JSON.stringify(d)); }

const EXT_CONNECT_FIELDS = {
  ga4: {
    guide: '💡 GA4 관리 > 속성 설정에서 속성 ID를, 데이터 스트림 > 스트림 세부정보에서 측정 ID를 확인하세요.',
    fields: [
      { key:'propertyId',    label:'GA4 속성 ID',  placeholder:'예: 123456789',    required:true,  hint:'관리 > 속성 설정',                   type:'text' },
      { key:'measurementId', label:'측정 ID',       placeholder:'예: G-XXXXXXXXXX', required:true,  hint:'데이터 스트림 > 스트림 세부정보',     type:'text' },
      { key:'apiSecret',     label:'API Secret',    placeholder:'측정 프로토콜 비밀번호', required:false, hint:'데이터 스트림 > 측정 프로토콜 API 비밀번호 (선택)', type:'password' },
    ]
  },
  acecounter: {
    guide: '💡 에이스카운터 관리자 > 계정 설정에서 사이트 코드와 API Key를 발급받으세요.',
    fields: [
      { key:'siteId', label:'사이트 코드', placeholder:'예: AC-XXXXXXXX', required:true, hint:'에이스카운터 관리자 > 사이트 정보', type:'text' },
      { key:'apiKey', label:'API Key',     placeholder:'API Key 입력',    required:true, hint:'계정 설정 > API 발급',             type:'password' },
    ]
  },
  cafe24: {
    guide: '💡 Cafe24 개발자센터(developers.cafe24.com)에서 앱 등록 후 Client ID와 Client Secret을 발급받으세요.',
    fields: [
      { key:'mallId',       label:'쇼핑몰 ID',     placeholder:'예: myshop',          required:true, hint:'Cafe24 관리자 URL의 서브도메인', type:'text' },
      { key:'clientId',     label:'Client ID',     placeholder:'Client ID 입력',      required:true, hint:'Cafe24 개발자센터 > 앱 정보',   type:'text' },
      { key:'clientSecret', label:'Client Secret', placeholder:'Client Secret 입력',  required:true, hint:'Cafe24 개발자센터 > 앱 정보',   type:'password' },
    ]
  },
  airbridge: {
    guide: '💡 Airbridge 대시보드 > Settings > Tokens 에서 앱 이름과 API Token을 확인하세요.',
    fields: [
      { key:'appName',  label:'앱 이름 (App Name)', placeholder:'예: my-app',       required:true, hint:'Airbridge 대시보드 앱 목록 확인', type:'text' },
      { key:'apiToken', label:'API Token',           placeholder:'API Token 입력',   required:true, hint:'Settings > Tokens',             type:'password' },
    ]
  },
  adjust: {
    guide: '💡 Adjust 대시보드 > 앱 설정에서 App Token을, 계정 설정 > User Details에서 User Token을 확인하세요.',
    fields: [
      { key:'appToken',  label:'App Token',              placeholder:'예: abc1def2gh3i', required:true, hint:'Adjust 대시보드 > 앱 설정 > 앱 정보', type:'text' },
      { key:'userToken', label:'User Token (API Token)', placeholder:'User Token 입력',  required:true, hint:'계정 설정 > Your Account > User Details', type:'password' },
    ]
  },
  appsflyer: {
    guide: '💡 AppsFlyer 대시보드 > 계정 설정 > Security Center에서 API Token(V2)을 확인하세요.',
    fields: [
      { key:'appId',  label:'앱 ID',             placeholder:'iOS: id123456789  /  Android: com.myapp', required:true, hint:'App Store 또는 Play Store 앱 ID', type:'text' },
      { key:'apiKey', label:'API Key (V2 Token)', placeholder:'API Key 입력',                            required:true, hint:'계정 설정 > Security Center > API Token', type:'password' },
    ]
  },
};

let _extConnTarget = null;

function toggleExtSolution(id) {
  const d = _getExtConnected();
  if (d[id]) {
    if (!confirm(`${EXT_SOLUTIONS.find(s=>s.id===id)?.name} 연동을 해제하시겠습니까?`)) return;
    delete d[id];
    _saveExtConnected(d);
    showToast('연동 해제되었습니다', 'warning');
    renderSettingConnection();
  } else {
    showExtConnectModal(id);
  }
}

function showExtConnectModal(id) {
  const sol = EXT_SOLUTIONS.find(s => s.id === id);
  const schema = EXT_CONNECT_FIELDS[id];
  if (!sol || !schema) return;
  _extConnTarget = id;
  document.getElementById('extConnModalTitle').textContent = sol.name + ' 연동';
  document.getElementById('extConnModalSub').textContent = sol.category + ' · ' + sol.desc;
  document.getElementById('extConnGuide').textContent = schema.guide;
  document.getElementById('extConnFields').innerHTML = schema.fields.map(f => {
    const isPw = f.type === 'password';
    return `<div>
      <label style="font-size:12px;font-weight:600;color:var(--gray-600);display:block;margin-bottom:5px;">
        ${f.label}${f.required ? ' <span style="color:var(--danger);">*</span>' : ' <span style="font-size:10px;color:var(--gray-400);">(선택)</span>'}
      </label>
      <input class="form-input" id="extf_${f.key}" type="${isPw ? 'password' : 'text'}"
        value="" placeholder="${f.placeholder}"
        autocomplete="${isPw ? 'new-password' : 'off'}"
        readonly onfocus="this.removeAttribute('readonly')"
        style="font-size:13px;">
      <div style="font-size:11px;color:var(--gray-400);margin-top:3px;">📌 ${f.hint}</div>
    </div>`;
  }).join('');
  showModal('extConnect');
}

function submitExtConnect() {
  const schema = EXT_CONNECT_FIELDS[_extConnTarget];
  if (!schema) return;
  const entry = { connectedAt: new Date().toISOString().slice(0,10) };
  for (const f of schema.fields) {
    const val = document.getElementById('extf_' + f.key)?.value?.trim() || '';
    if (f.required && !val) {
      showToast(`"${f.label}" 항목을 입력해 주세요`, 'warning');
      document.getElementById('extf_' + f.key)?.focus();
      return;
    }
    if (val) entry[f.key] = val;
  }
  const d = _getExtConnected();
  d[_extConnTarget] = entry;
  _saveExtConnected(d);
  closeModal('extConnect');
  const solName = EXT_SOLUTIONS.find(s=>s.id===_extConnTarget)?.name;
  showToast(`${solName} 연동이 완료되었습니다`, 'success');
  renderSettingConnection();
}

// ============================================================
// KPI 목표치 / 이상 감지 알림
// ============================================================
// 일일 소진한도 기능 ON/OFF — 계정별 로드 (_loadAccountSettings)
let USE_DAILY_BUDGET = false;

const KPI_TARGET_SCHEMA = [
  { key:'roas', label:'ROAS 목표',  unit:'%',  placeholder:'예: 400',   hint:'현재 대비 목표 ROAS (%). 미달 시 경고.',  higherBetter:true },
  { key:'cpa',  label:'CPA 목표',   unit:'원', placeholder:'예: 50000', hint:'목표 CPA (원). 초과 시 경고.',             higherBetter:false },
  { key:'ctr',  label:'CTR 목표',   unit:'%',  placeholder:'예: 2.0',   hint:'목표 CTR (%). 미달 시 경고.',              higherBetter:true },
  { key:'cvr',  label:'CVR 목표',   unit:'%',  placeholder:'예: 1.5',   hint:'목표 전환율 (%). 미달 시 경고.',           higherBetter:true },
];

function _getKpiTargets() { return JSON.parse(localStorage.getItem(_accKey('deepfle_kpi_targets')) || '{}'); }
function _saveKpiTargets(d) { localStorage.setItem(_accKey('deepfle_kpi_targets'), JSON.stringify(d)); }

function renderSettingKpiTargets() {
  const el = document.getElementById('kpiTargetBody');
  if (!el) return;
  const targets = _getKpiTargets();
  const editable = CAN_EDIT(currentUser?.role);

  el.innerHTML = KPI_TARGET_SCHEMA.map(s => {
    const val = targets[s.key] !== undefined ? targets[s.key] : '';
    const hasVal = val !== '';
    return `<div class="kpi-target-row">
      <div>
        <div style="font-size:13px;font-weight:600;">${s.label}</div>
        <div style="font-size:11px;color:var(--gray-400);margin-top:2px;">${s.hint}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <input class="form-input" id="kpiTgt_${s.key}" type="number" min="0"
          style="width:120px;height:32px;font-size:13px;text-align:right;"
          placeholder="${s.placeholder}" value="${val}"
          ${!editable ? 'disabled' : ''}>
        <span style="font-size:12px;color:var(--gray-400);width:20px;">${s.unit}</span>
        ${hasVal ? `<span style="font-size:11px;color:var(--success);">설정됨</span>` : `<span style="font-size:11px;color:var(--gray-400);">미설정</span>`}
      </div>
    </div>`;
  }).join('');
}

function saveAllKpiTargets() {
  const d = {};
  KPI_TARGET_SCHEMA.forEach(s => {
    const el = document.getElementById('kpiTgt_' + s.key);
    const v = el?.value?.trim();
    if (v !== '' && !isNaN(Number(v))) d[s.key] = Number(v);
  });
  _saveKpiTargets(d);
  showToast('KPI 목표치가 저장되었습니다', 'success');
  renderSettingKpiTargets();
  refreshAlertBell();
  if (document.getElementById('panel-overview')?.classList.contains('active')) _renderDashBody();
}

function renderDailyBudgetSettings() {
  const el = document.getElementById('dailyBudgetBody');
  if (!el) return;
  const editable = CAN_EDIT(currentUser?.role);

  const toggleRow = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0 12px;border-bottom:1px solid var(--gray-100);">
      <div>
        <div style="font-size:13px;font-weight:600;">일일 소진한도 기능 사용</div>
        <div style="font-size:11px;color:var(--gray-400);margin-top:2px;">활성화 시 대시보드 성과표에 일일 소진한도 열이 표시됩니다</div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;cursor:${editable ? 'pointer' : 'default'};">
        <div style="position:relative;width:42px;height:24px;flex-shrink:0;">
          <input type="checkbox" id="useDailyBudgetToggle"
            ${USE_DAILY_BUDGET ? 'checked' : ''} ${!editable ? 'disabled' : ''}
            style="opacity:0;width:0;height:0;position:absolute;"
            onchange="toggleDailyBudgetFeature(this.checked)">
          <div id="dbToggleTrack" onclick="${editable ? 'document.getElementById(\'useDailyBudgetToggle\').click()' : ''}"
            style="position:absolute;inset:0;border-radius:12px;cursor:${editable ? 'pointer' : 'default'};transition:background 0.2s;
            background:${USE_DAILY_BUDGET ? 'var(--primary)' : 'var(--gray-300)'};">
            <div style="position:absolute;top:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left 0.2s;
              left:${USE_DAILY_BUDGET ? '21px' : '3px'};"></div>
          </div>
        </div>
        <span id="dailyBudgetToggleLabel" style="font-size:12px;font-weight:600;
          color:${USE_DAILY_BUDGET ? 'var(--primary)' : 'var(--gray-400)'};">
          ${USE_DAILY_BUDGET ? '사용 중' : '사용 안 함'}
        </span>
      </label>
    </div>`;

  const budgetTable = USE_DAILY_BUDGET ? `
    <div style="margin-top:14px;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:left;font-size:11px;color:var(--gray-400);padding:4px 0 8px;font-weight:600;border-bottom:1px solid var(--gray-200);">매체</th>
            <th style="text-align:right;font-size:11px;color:var(--gray-400);padding:4px 0 8px;font-weight:600;border-bottom:1px solid var(--gray-200);">일일 소진한도 (₩)</th>
          </tr>
        </thead>
        <tbody>
          ${MEDIA_DATA.map((m, i) => `
            <tr style="border-bottom:1px solid var(--gray-100);">
              <td style="padding:8px 0;font-size:13px;">
                <div style="display:flex;align-items:center;gap:7px;">
                  <div style="width:9px;height:9px;border-radius:50%;background:${m.color};flex-shrink:0;"></div>
                  ${m.name}
                </div>
              </td>
              <td style="text-align:right;padding:6px 0;">
                <input type="number" min="0" step="10000" class="form-input" id="db_${i}"
                  value="${m.dailyBudget || 0}"
                  ${!editable ? 'disabled' : ''}
                  style="width:150px;height:32px;font-size:13px;text-align:right;">
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${editable ? `
        <div style="margin-top:14px;display:flex;justify-content:flex-end;">
          <button class="btn btn-sm btn-primary" onclick="saveDailyBudgets()">저장</button>
        </div>` : ''}
    </div>` : `
    <div style="padding:16px 0 4px;font-size:12px;color:var(--gray-400);">
      기능을 활성화하면 매체별 하루 광고비 상한선을 개별 입력할 수 있으며, 대시보드 성과표에 반영됩니다.
    </div>`;

  el.innerHTML = toggleRow + budgetTable;
}

function toggleDailyBudgetFeature(on) {
  USE_DAILY_BUDGET = on;
  localStorage.setItem(_accKey('deepfle_use_daily_budget'), JSON.stringify(on));
  renderDailyBudgetSettings();
  _renderDashBody();
}

function saveDailyBudgets() {
  if (!CAN_EDIT(currentUser?.role)) { showToast('수정 권한이 없습니다', 'error'); return; }
  const budgetMap = {};
  MEDIA_DATA.forEach((m, i) => {
    const input = document.getElementById('db_' + i);
    if (input) {
      const v = parseInt(input.value.replace(/[^0-9]/g, ''), 10);
      m.dailyBudget = isNaN(v) ? 0 : v;
    }
    budgetMap[m.name] = m.dailyBudget;
  });
  localStorage.setItem(_accKey('deepfle_daily_budgets'), JSON.stringify(budgetMap));
  showToast('일일 소진한도가 저장되었습니다', 'success');
  logActivity('일일 소진한도 설정 저장');
  _renderDashBody();
}

// 현재 대시보드 KPI 값 전역 저장 (알림 계산용)
window._dashCurrentKpis = {};

function _computeAlerts() {
  const targets = _getKpiTargets();
  const cur = window._dashCurrentKpis;
  if (!targets || !cur || Object.keys(cur).length === 0) return [];

  const alerts = [];

  function check(key, currentRaw, targetVal, higherBetter, labelFn, fmtFn) {
    if (targetVal === undefined || targetVal === null || targetVal === '') return;
    const ratio = higherBetter ? currentRaw / targetVal : targetVal / currentRaw;
    if (!isFinite(ratio) || ratio >= 1.0) return;
    const pct = ((1 - ratio) * 100).toFixed(1);
    const sev = ratio < 0.8 ? 'danger' : 'warning';
    alerts.push({
      sev,
      label: labelFn(),
      desc: `현재 ${fmtFn(currentRaw)} / 목표 ${fmtFn(targetVal)} (${pct}% ${higherBetter ? '미달' : '초과'})`,
    });
  }

  check('roas', (cur.roas||0)*100,  targets.roas,  true,
    ()=>'ROAS 목표 미달', v=>v.toFixed(0)+'%');
  check('cpa',  cur.cpa||0,         targets.cpa,   false,
    ()=>'CPA 목표 초과',  v=>fmtW(Math.round(v)));
  check('ctr',  (cur.ctr||0)*100,   targets.ctr,   true,
    ()=>'CTR 목표 미달',  v=>v.toFixed(2)+'%');
  check('cvr',  (cur.cvr||0)*100,   targets.cvr,   true,
    ()=>'CVR 목표 미달',  v=>v.toFixed(2)+'%');
  // 매체별 ROAS 체크
  if (targets.roas) {
    MEDIA_DATA.filter(m=>m.on).forEach(m => {
      if (m.roas < targets.roas * 0.8) {
        alerts.push({
          sev: 'warning',
          label: `${m.name} ROAS 미달`,
          desc: `현재 ${m.roas}% / 목표 ${targets.roas}%`,
        });
      }
    });
  }

  // 매체별 일일 소진한도 체크
  if (USE_DAILY_BUDGET) {
    const days = window._globalFrom && window._globalTo
      ? Math.max(1, Math.round((new Date(window._globalTo)-new Date(window._globalFrom))/86400000)+1)
      : 30;
    MEDIA_DATA.filter(m=>m.on && m.dailyBudget > 0).forEach(m => {
      const avgDailySpend = _markupCost(m.spend, m.key||'') / days;
      const ratio = avgDailySpend / m.dailyBudget;
      if (ratio >= 0.9) {
        alerts.push({
          sev: ratio >= 1.0 ? 'danger' : 'warning',
          label: `${m.name} 일일예산 ${ratio>=1.0?'초과':'근접'}`,
          desc: `일평균 ${fmtW(Math.round(avgDailySpend))} / 한도 ${fmtW(m.dailyBudget)} (${(ratio*100).toFixed(0)}%)`,
        });
      }
    });
  }

  return alerts;
}

function _dashKpiTargetBar(key, raw) {
  const targets = _getKpiTargets();
  const target = targets[key];
  if (target === undefined || target === null || target === '') return '';

  const schema = KPI_TARGET_SCHEMA.find(s => s.key === key);
  if (!schema) return '';

  let currentDisplay, targetDisplay;
  if (key === 'roas' || key === 'ctr' || key === 'cvr') {
    currentDisplay = (raw * 100).toFixed(key==='roas'?0:2) + '%';
    targetDisplay  = target + '%';
  } else {
    currentDisplay = fmtW(Math.round(raw));
    targetDisplay  = fmtW(target);
  }

  const ratio = schema.higherBetter ? (raw*100) / target : target / raw;
  let cls, icon;
  if (!isFinite(ratio) || ratio >= 1.0) { cls='kpi-target-ok';   icon='✅'; }
  else if (ratio >= 0.85)               { cls='kpi-target-warn';  icon='⚠️'; }
  else                                  { cls='kpi-target-miss';  icon='❌'; }

  // cost는 raw가 이미 원 단위
  if (key === 'cost') {
    const rr = target / raw;
    if (rr >= 1.0) { cls='kpi-target-ok'; icon='✅'; }
    else if (rr >= 0.85) { cls='kpi-target-warn'; icon='⚠️'; }
    else { cls='kpi-target-miss'; icon='❌'; }
  }

  return `<div class="kpi-target-bar ${cls}">${icon} 목표 ${targetDisplay}</div>`;
}

async function refreshAlertBell() {
  const alerts = _computeAlerts();
  const badge = document.getElementById('alertBadge');
  if (!badge) return;
  let serverUnread = 0;
  try {
    if (currentAccount?.id && !DEEPFLE_API.USE_MOCK) {
      const res = await DEEPFLE_API.get(`/accounts/${currentAccount.id}/notifications`);
      serverUnread = res.unread || 0;
    }
  } catch(e) {}
  const total = alerts.length + serverUnread;
  if (total > 0) {
    badge.textContent = total > 9 ? '9+' : total;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

async function toggleAlertDropdown() {
  const drop = document.getElementById('alertDropdown');
  if (!drop) return;
  const isOpen = drop.classList.contains('open');

  if (!isOpen) {
    const alerts = _computeAlerts();
    const targets = _getKpiTargets();
    const hasTargets = Object.keys(targets).length > 0;

    // 로컬 KPI 알림 HTML
    const kpiItemsHtml = alerts.length > 0
      ? alerts.map(a => `
          <div class="alert-item">
            <div class="alert-item-icon">${a.sev==='danger'?'🔴':'🟡'}</div>
            <div>
              <div class="alert-item-lbl">${a.label}</div>
              <div class="alert-item-desc">${a.desc}</div>
            </div>
          </div>`).join('')
      : hasTargets
        ? `<div style="padding:16px 16px 0;text-align:center;font-size:12px;color:var(--gray-400);">✅ 모든 KPI가 목표를 달성하고 있습니다</div>`
        : `<div style="padding:16px 16px 0;text-align:center;font-size:12px;color:var(--gray-400);">KPI 목표치가 설정되지 않았습니다<br><button class="btn btn-xs btn-outline" style="margin-top:8px;" onclick="showPanel('settings');setTimeout(()=>switchSettingTab(document.querySelector('.tab-pill[onclick*=kpi]'),\\'kpi\\'),150);toggleAlertDropdown();">목표 설정하기</button></div>`;

    // 서버 알림 로드
    let serverNotifHtml = '';
    try {
      const res = await DEEPFLE_API.get(`/accounts/${currentAccount.id}/notifications`);
      const notifs = (res.notifications || []).slice(0, 5);
      if (notifs.length) {
        const LEVEL_ICON = {info:'🔵', warning:'🟡', error:'🔴', success:'🟢'};
        serverNotifHtml = `<div style="padding:8px 16px 4px;font-size:10px;font-weight:600;color:var(--gray-400);text-transform:uppercase;letter-spacing:.05em;border-top:1px solid var(--gray-100);margin-top:4px;">시스템 알림</div>`
          + notifs.map(n=>`
            <div class="alert-item">
              <div class="alert-item-icon">${LEVEL_ICON[n.level]||'🔵'}</div>
              <div>
                <div class="alert-item-lbl">${n.title||''}</div>
                <div class="alert-item-desc">${n.message||''}</div>
              </div>
            </div>`).join('');
        // 읽음 처리 (unread 배지 업데이트)
        const badge = document.getElementById('alertBadge');
        if (badge && res.unread > 0) {
          const total = alerts.length + res.unread;
          badge.textContent = total > 9 ? '9+' : total;
          badge.style.display = 'flex';
        }
      }
    } catch(e) {}

    drop.innerHTML = `
      <div class="alert-drop-hd">
        <span>알림 ${alerts.length > 0 ? `<span class="badge badge-red" style="margin-left:4px;">${alerts.length}</span>` : ''}</span>
        <button class="btn btn-xs btn-outline" onclick="showPanel('settings');setTimeout(()=>switchSettingTab(document.querySelector('.tab-pill[onclick*=kpi]'),\\'kpi\\'),150);toggleAlertDropdown();">목표 설정</button>
      </div>
      ${kpiItemsHtml}
      ${serverNotifHtml}`;
    drop.classList.add('open');

    setTimeout(() => {
      const closer = e => {
        if (!document.getElementById('alertBellWrap')?.contains(e.target)) {
          drop.classList.remove('open');
          document.removeEventListener('click', closer);
        }
      };
      document.addEventListener('click', closer);
    }, 10);
  } else {
    drop.classList.remove('open');
  }
}

let _connOpenItems = new Set();

function toggleConnAccordion(idx) {
  const m = MEDIA_DATA[idx]; if (!m) return;
  if (_connOpenItems.has(m.name)) _connOpenItems.delete(m.name);
  else _connOpenItems.add(m.name);
  renderSettingConnection();
}

function _connPixelBadgeHtml(idx, val) {
  return val
    ? `<span id="connHdrPix_${idx}" style="font-size:10px;color:#059669;background:#ECFDF5;padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0;">● 픽셀 등록됨</span>`
    : `<span id="connHdrPix_${idx}" style="font-size:10px;color:#D97706;background:#FFFBEB;padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0;">⚠ 픽셀 미입력</span>`;
}

function renderSettingConnection() {
  const el = document.getElementById('settingConnectionBody');
  if (!el) return;
  const editable = CAN_EDIT(currentUser?.role);
  const connected = _getExtConnected();
  const pixelData = _getMediaPixels();

  // 광고 매체 — ON 상태인 매체만 표시
  const rows = MEDIA_DATA.map((m, i) => {
    if (!m.on) return '';  // OFF 매체는 이 섹션에서 제외
    const pcfg = MEDIA_PIXEL_CONFIG[m.name] || { label:'픽셀 ID', placeholder:'픽셀 ID 입력', hint:'매체 광고관리자에서 확인' };
    const pixelVal = pixelData[m.name] || '';
    const isOpen = _connOpenItems.has(m.name);
    return `
    <div class="conn-acc">
      <div class="conn-acc-head ${isOpen?'open':''}" onclick="toggleConnAccordion(${i})">
        <div style="width:8px;height:8px;border-radius:50%;background:${m.color};flex-shrink:0;"></div>
        <span style="font-size:13px;font-weight:600;flex:1;">${m.name}</span>
        ${_connPixelBadgeHtml(i, pixelVal)}
        <span class="badge badge-green" style="font-size:10px;white-space:nowrap;">운영중</span>
        <span class="conn-acc-chev">▼</span>
      </div>
      ${isOpen ? `
      <div class="conn-acc-body">
        <div style="font-size:10px;color:var(--gray-400);font-weight:600;letter-spacing:.4px;margin-bottom:5px;">${pcfg.label}</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <input class="form-input" style="height:30px;font-size:12px;flex:1;max-width:340px;"
            placeholder="${pcfg.placeholder}" value="${pixelVal}"
            ${editable ? `oninput="saveMediaPixelByIdx(${i},this.value)"` : 'disabled'}>
        </div>
        <div style="font-size:10px;color:var(--gray-400);margin-top:4px;">📌 ${pcfg.hint}</div>
      </div>` : ''}
    </div>`;
  }).join('');

  const manualRows = MANUAL_MEDIA.map((m, i) => `
    <div class="conn-acc">
      <div class="conn-acc-head" style="cursor:default;">
        <div style="width:8px;height:8px;border-radius:50%;background:${m.color||'#64748B'};flex-shrink:0;"></div>
        <span style="font-size:13px;font-weight:600;flex:1;">${m.name}</span>
        <span class="badge badge-gray" style="font-size:9px;">수기</span>
        ${editable ? `<button class="btn btn-xs" style="color:var(--danger);background:none;margin-left:4px;" onclick="removeManualMedia(${i})" title="삭제">✕</button>` : ''}
      </div>
    </div>`).join('');

  // 외부 솔루션 카드
  const catGroups = {};
  EXT_SOLUTIONS.forEach(s => { (catGroups[s.category]||=(catGroups[s.category]=[])).push(s); });
  const extHtml = Object.entries(catGroups).map(([cat, items]) => `
    <div style="margin-top:14px;">
      <div style="font-size:11px;color:var(--gray-400);font-weight:600;letter-spacing:.5px;margin-bottom:8px;">${cat}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;">
        ${items.map(s => {
          const isConn = !!connected[s.id];
          return `<div style="border:1px solid ${isConn?'#22C55E':'var(--gray-200)'};border-radius:10px;padding:12px 14px;background:${isConn?'#F0FDF4':'#fff'};display:flex;flex-direction:column;gap:6px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <div style="width:32px;height:32px;border-radius:8px;background:${s.color};color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${s.abbr}</div>
              <div>
                <div style="font-size:13px;font-weight:600;line-height:1.2;">${s.name}</div>
                <div style="font-size:10px;color:var(--gray-400);">${s.desc}</div>
              </div>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:2px;">
              <span class="badge ${isConn?'badge-green':'badge-gray'}" style="font-size:10px;">${isConn?`✅ 연동됨 · ${connected[s.id].connectedAt}`:'미연동'}</span>
              ${editable ? `<button class="btn btn-xs ${isConn?'btn-outline':'btn-primary'}" style="font-size:11px;padding:3px 10px;" onclick="toggleExtSolution('${s.id}')">${isConn?'해제':'연결'}</button>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`).join('');

  const onCnt = MEDIA_DATA.filter(m=>m.on).length;
  const pixOkCnt = MEDIA_DATA.filter(m=>m.on && !!pixelData[m.name]).length;
  const pixMissing = onCnt - pixOkCnt;
  const pixSummary = pixMissing > 0
    ? `<span style="font-size:11px;color:#D97706;background:#FFFBEB;padding:2px 9px;border-radius:8px;">⚠ 운영중 매체 픽셀 미입력 ${pixMissing}개</span>`
    : onCnt > 0 ? `<span style="font-size:11px;color:#059669;background:#ECFDF5;padding:2px 9px;border-radius:8px;">● 운영중 매체 픽셀 전체 등록됨</span>` : '';

  const onCount = MEDIA_DATA.filter(m=>m.on).length;
  const noMediaMsg = (onCount === 0 && MANUAL_MEDIA.length === 0)
    ? `<div style="text-align:center;padding:20px;color:var(--gray-400);font-size:13px;">매체 커넥터 & API 키 관리에서 매체를 연동하면 이 곳에 트래커를 설정할 수 있습니다.</div>` : '';

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <div style="font-size:11px;color:var(--gray-400);font-weight:600;letter-spacing:.5px;">운영중 매체 (${onCount}개)${MANUAL_MEDIA.length?` · 수기 등록 ${MANUAL_MEDIA.length}개`:''}</div>
      ${pixSummary}
    </div>
    ${noMediaMsg}
    ${rows}
    ${manualRows ? `
    <div style="margin-top:10px;font-size:11px;color:var(--gray-400);font-weight:600;letter-spacing:.5px;margin-bottom:6px;">수기 등록 매체</div>
    ${manualRows}` : ''}
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--gray-100);">
      <div style="font-size:13px;font-weight:700;margin-bottom:2px;">외부 솔루션 연동</div>
      <div style="font-size:11px;color:var(--gray-400);">분석 툴·이커머스·MMP 데이터를 DeepFle 전환설정과 연결합니다.</div>
      ${extHtml}
    </div>`;
}

// ============================================================
// 수기 매체 등록 (localStorage 기반)
// ============================================================
let MANUAL_MEDIA = [];
function _saveManualMedia() { localStorage.setItem(_accKey('deepfle_manual_media'), JSON.stringify(MANUAL_MEDIA)); }
function _loadManualMedia() {
  const key = _accKey('deepfle_manual_media');
  let data = JSON.parse(localStorage.getItem(key)||'null');
  if (!data) {
    // 구버전 비계정 키에서 마이그레이션
    const legacy = localStorage.getItem('deepfle_manual_media');
    if (legacy) { try { data = JSON.parse(legacy); localStorage.setItem(key, legacy); localStorage.removeItem('deepfle_manual_media'); } catch(e){} }
  }
  MANUAL_MEDIA = data || [];
}

function showAddManualMediaForm() {
  const name = prompt('수기 등록 매체명을 입력하세요 (예: 카피웍스미디어, 지역신문광고)');
  if (!name || !name.trim()) return;
  if (MANUAL_MEDIA.some(m=>m.name===name.trim()) || MEDIA_DATA.some(m=>m.name===name.trim())) {
    showToast('이미 등록된 매체명입니다', 'warning'); return;
  }
  const colors = ['#6366F1','#EC4899','#F59E0B','#10B981','#0EA5E9','#8B5CF6','#EF4444','#14B8A6'];
  const color = colors[MANUAL_MEDIA.length % colors.length];
  MANUAL_MEDIA.push({ id: 'manual_' + Date.now(), name: name.trim(), color, mappings: {} });
  _saveManualMedia();
  showToast(`"${name.trim()}" 수기 매체 추가됨`, 'success');
  renderMediaMap();
  const connEl = document.getElementById('settingConnectionBody');
  if (connEl && connEl.children.length) renderSettingConnection();
}

function removeManualMedia(idx) {
  const m = MANUAL_MEDIA[idx];
  if (!m) return;
  if (!confirm(`"${m.name}" 수기 매체를 삭제하시겠습니까?`)) return;
  MANUAL_MEDIA.splice(idx, 1);
  _saveManualMedia();
  showToast('수기 매체 삭제됨', 'warning');
  renderSettingConnection();
  renderMediaMap();
}

function saveManualMediaMapping(idx, key, val) {
  if (!MANUAL_MEDIA[idx]) return;
  MANUAL_MEDIA[idx].mappings[key] = val;
  _saveManualMedia();
  showToast('저장됨', 'success');
}

// ── 수기 매체 일별 데이터 ───────────────────────────────────────────────────
function _manualDailyKey() { return _accKey('deepfle_manual_daily'); }
function _getManualDaily() {
  const local = JSON.parse(localStorage.getItem(_manualDailyKey()) || '{}');
  const backend = window._manualMetricsByMediaId || {};
  const merged = {};
  for (const [mid, dates] of Object.entries(local)) {
    merged[mid] = {...dates};
  }
  for (const [mid, dates] of Object.entries(backend)) {
    if (!merged[mid]) merged[mid] = {};
    for (const [d, v] of Object.entries(dates)) {
      merged[mid][d] = v;
    }
  }
  return merged;
}

function _buildManualMetricsIndex(rows) {
  const nameToId = {};
  MANUAL_MEDIA.forEach(m => { nameToId[m.name] = m.id; });
  const byId = {};
  (rows || []).forEach(r => {
    const mid = nameToId[r.media];
    if (!mid) return;
    if (!byId[mid]) byId[mid] = {};
    if (!byId[mid][r.date]) byId[mid][r.date] = {cost:0, imp:0, click:0, conv:0};
    byId[mid][r.date].cost  += (r.cost  || 0);
    byId[mid][r.date].imp   += (r.imp   || 0);
    byId[mid][r.date].click += (r.click || 0);
    byId[mid][r.date].conv  += ((r.conv_native||0)+(r.conv_ga4||0)+(r.conv_mmp||0)+(r.conv_manual||0));
  });
  return byId;
}
function _saveManualDaily(d) { localStorage.setItem(_manualDailyKey(), JSON.stringify(d)); }

function _getManualMediaSeries(dates) {
  if (!MANUAL_MEDIA.length) return [];
  const all = _getManualDaily();
  return MANUAL_MEDIA.map(m => {
    const mData = all[m.id] || {};
    const ds = dates.map(d => d.toISOString().slice(0, 10));
    return {
      key: m.id, label: m.name + ' (수기)', color: m.color||'#64748B',
      cost:    ds.map(d => mData[d]?.cost    || 0),
      imp:     ds.map(d => mData[d]?.imp     || 0),
      click:   ds.map(d => mData[d]?.click   || 0),
      conv:    ds.map(d => mData[d]?.conv    || 0),
      revenue: ds.map(d => mData[d]?.revenue || 0),
    };
  });
}

function _getManualMediaRawRows(from, to, mediaFilter) {
  if (!MANUAL_MEDIA.length) return [];
  const all = _getManualDaily();
  const rows = [];
  const d1 = new Date(from), d2 = new Date(to);
  const days = Math.max(1, Math.round((d2-d1)/86400000)+1);
  const dates = Array.from({length:days}, (_,i) => new Date(d1.getTime()+i*86400000));
  for (const m of MANUAL_MEDIA) {
    if (mediaFilter && mediaFilter !== m.id && mediaFilter !== m.name) continue;
    const mData = all[m.id] || {};
    for (const d of dates) {
      const ds = d.toISOString().slice(0, 10);
      const r = mData[ds];
      if (!r || (!r.imp && !r.click && !r.cost)) continue;
      rows.push({ date:ds, media:m.name, cost:r.cost||0, imp:r.imp||0, click:r.click||0, conv:r.conv||0, revenue:r.revenue||0 });
    }
  }
  return rows;
}

let _manualDataTarget = null;
function showManualDataModal(mediaId) {
  _manualDataTarget = mediaId;
  const m = MANUAL_MEDIA.find(x => x.id === mediaId);
  if (!m) return;
  const from = window._globalFrom || new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  const to   = window._globalTo   || new Date().toISOString().slice(0,10);
  _renderManualDataTable(mediaId, from, to);
  document.getElementById('modal-manualData').classList.add('open');
}

function _renderManualDataTable(mediaId, from, to) {
  const m = MANUAL_MEDIA.find(x => x.id === mediaId);
  if (!m) return;
  document.getElementById('manualDataTitle').textContent = `${m.name} — 수기 데이터 입력`;
  const all = _getManualDaily();
  const mData = all[mediaId] || {};
  const d1 = new Date(from), d2 = new Date(to);
  const days = Math.max(1, Math.round((d2-d1)/86400000)+1);
  const dates = Array.from({length:days}, (_,i) => new Date(d1.getTime()+i*86400000));
  const cols = [
    {key:'imp',     label:'노출수',   type:'number'},
    {key:'click',   label:'클릭수',   type:'number'},
    {key:'cost',    label:'광고비(원)', type:'number'},
    {key:'conv',    label:'전환수',   type:'number'},
    {key:'revenue', label:'전환매출(원)', type:'number'},
  ];
  const thRow = cols.map(c=>`<th style="padding:6px 10px;font-size:11px;text-align:right;min-width:90px;">${c.label}</th>`).join('');
  const bodyRows = dates.map(d => {
    const ds = d.toISOString().slice(0,10);
    const r = mData[ds] || {};
    const cells = cols.map(c=>`<td><input type="number" min="0" class="form-input manual-data-cell"
      data-date="${ds}" data-col="${c.key}"
      value="${r[c.key]||''}" placeholder="0"
      style="height:26px;font-size:11px;text-align:right;padding:0 6px;width:85px;"></td>`).join('');
    return `<tr><td style="padding:4px 10px;font-size:12px;white-space:nowrap;color:var(--gray-600);">${ds}</td>${cells}</tr>`;
  }).join('');
  document.getElementById('manualDataBody').innerHTML = `
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <input type="date" id="mdFrom" value="${from}" class="form-select" style="height:32px;font-size:12px;width:140px;">
      <span style="font-size:12px;color:var(--gray-500);">~</span>
      <input type="date" id="mdTo" value="${to}" class="form-select" style="height:32px;font-size:12px;width:140px;">
      <button class="btn btn-sm btn-outline" onclick="_renderManualDataTable('${mediaId}', document.getElementById('mdFrom').value, document.getElementById('mdTo').value)" style="height:32px;">기간 적용</button>
    </div>
    <div style="overflow:auto;max-height:400px;">
    <table style="border-collapse:collapse;width:100%;">
      <thead style="position:sticky;top:0;background:var(--gray-50);"><tr>
        <th style="padding:6px 10px;font-size:11px;text-align:left;">날짜</th>${thRow}
      </tr></thead>
      <tbody>${bodyRows}</tbody>
    </table></div>`;
}

function saveManualData() {
  const all = _getManualDaily();
  const mData = all[_manualDataTarget] || {};
  document.querySelectorAll('#manualDataBody .manual-data-cell').forEach(inp => {
    const { date, col } = inp.dataset;
    const val = parseFloat(inp.value) || 0;
    if (!mData[date]) mData[date] = {};
    mData[date][col] = val;
  });
  all[_manualDataTarget] = mData;
  _saveManualDaily(all);
  closeModal('manualData');
  showToast('수기 데이터가 저장됐습니다. 대시보드·리포트에 즉시 반영됩니다.', 'success');
  // 현재 열린 패널 새로고침
  if (document.getElementById('panel-overview')?.classList.contains('active')) _renderDashBody();
  if (document.getElementById('panel-media-report')?.classList.contains('active')) renderMediaReportResult();
}

// ============================================================
// 설정 > 전환설정 / 매체 지표 매핑 (계정별, 백엔드 연동)
// ============================================================
const CONV_SOURCES = [
  ['ga4','GA4'], ['acecounter','에이스카운터'], ['airbridge','Airbridge(MMP)'],
  ['adjust','Adjust(MMP)'], ['appsflyer','AppsFlyer(MMP)'], ['manual','직접입력'],
];
const CONV_TYPES = [['count','카운트'], ['currency','금액'], ['rate','비율']];
const SETTINGS_EDITABLE = () => CAN_EDIT(currentUser.role);

async function renderConversionSettings() {
  const el = document.getElementById('conversionArea');
  if (!el) return;
  const editable = SETTINGS_EDITABLE();
  document.getElementById('convAddBtn').style.display = editable ? '' : 'none';
  if (!currentAccount) {
    el.innerHTML = '<div class="readonly-banner">계정을 선택하세요.</div>'; return;
  }
  try {
    const { conversions } = await DEEPFLE_API.get(`/accounts/${currentAccount.id}/conversion-settings`);
    const srcOpts = (sel) => CONV_SOURCES.map(([v,l])=>`<option value="${v}" ${v===sel?'selected':''}>${l}</option>`).join('');
    const typeOpts = (sel) => CONV_TYPES.map(([v,l])=>`<option value="${v}" ${v===sel?'selected':''}>${l}</option>`).join('');
    const dis = editable ? '' : 'disabled';
    const rows = conversions.map(c=>`
      <tr data-id="${c.id}" style="border-left:3px solid var(--primary);background:linear-gradient(90deg,rgba(37,99,235,0.05) 0%,transparent 60%);">
        <td><select class="form-select cv-f" data-k="source" ${dis}>${srcOpts(c.source)}</select></td>
        <td><input class="form-input cv-f" data-k="source_metric" value="${(c.source_metric||'').replace(/"/g,'&quot;')}" placeholder="예) purchase" ${dis}></td>
        <td style="display:flex;align-items:center;gap:6px;padding:6px 8px;">
          <input class="form-input cv-f" data-k="solution_metric" value="${(c.solution_metric||'').replace(/"/g,'&quot;')}" placeholder="예) 구매" ${dis} style="font-weight:700;color:var(--primary);">
          <span style="white-space:nowrap;font-size:10px;font-weight:600;background:var(--primary-light);color:var(--primary);padding:2px 7px;border-radius:10px;">활성</span>
        </td>
        <td><select class="form-select cv-f" data-k="value_type" ${dis}>${typeOpts(c.value_type)}</select></td>
        <td style="text-align:center;">${editable?`<button class="btn btn-xs btn-outline" onclick="saveConversion(${c.id},this)">저장</button> <button class="btn btn-xs btn-danger-outline" onclick="deleteConversion(${c.id})">삭제</button>`:'-'}</td>
      </tr>`).join('');
    el.innerHTML = `
      <table class="data-table" style="width:100%;font-size:12px;">
        <thead><tr><th style="width:18%;">출처</th><th style="width:26%;">출처 지표명</th><th style="width:26%;">솔루션 지표명</th><th style="width:14%;">유형</th><th style="width:16%;">관리</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:var(--gray-400);padding:14px;">전환 지표가 없습니다. 우측 상단에서 추가하세요.</td></tr>'}</tbody>
      </table>`;
  } catch(e) { el.innerHTML = `<div class="readonly-banner">불러오기 실패: ${e.message}</div>`; }
}

async function addConversionRow() {
  if (!currentAccount) { showToast('계정을 선택하세요','warning'); return; }
  try {
    await DEEPFLE_API.post(`/accounts/${currentAccount.id}/conversion-settings`,
      {source:'manual', source_metric:'', solution_metric:'새 전환지표', value_type:'count'});
    renderConversionSettings(); showToast('전환 지표가 추가되었습니다','success');
  } catch(e){ showToast(`추가 실패: ${e.message}`, e.status===403?'error':'warning'); }
}

async function saveConversion(id, btn) {
  const tr = btn.closest('tr'); const body = {};
  tr.querySelectorAll('.cv-f').forEach(f=>body[f.dataset.k]=f.value);
  if (!body.solution_metric.trim()) { showToast('솔루션 지표명을 입력하세요','warning'); return; }
  try { await DEEPFLE_API.patch(`/conversion-settings/${id}`, body); showToast('저장되었습니다','success'); }
  catch(e){ showToast(`저장 실패: ${e.message}`, e.status===403?'error':'warning'); }
}

async function deleteConversion(id) {
  if (!confirm('이 전환 지표를 삭제하시겠습니까?')) return;
  try { await DEEPFLE_API.del(`/conversion-settings/${id}`); renderConversionSettings(); showToast('삭제되었습니다','success');
  } catch(e){ showToast(`삭제 실패: ${e.message}`, e.status===403?'error':'warning'); }
}

const METRIC_KEY_LABEL = {imp:'노출수', click:'클릭수', cost:'광고비', cpc:'CPC', cpm:'CPM'};
async function renderMediaMap() {
  const el = document.getElementById('mediaMapArea');
  if (!el) return;
  const editable = SETTINGS_EDITABLE();
  if (!DEEPFLE_API.live || !currentAccount) {
    el.innerHTML = '<div class="readonly-banner">백엔드 연결 + 계정 컨텍스트에서 동작합니다.</div>'; return;
  }
  try {
    const { mappings } = await DEEPFLE_API.get(`/accounts/${currentAccount.id}/media-metric-map`);
    if (!mappings.length) { el.innerHTML = '<div style="font-size:12px;color:var(--gray-400);padding:8px;">매핑이 없습니다.</div>'; return; }
    const byMedia = {};
    mappings.forEach(m=>{ (byMedia[m.media]=byMedia[m.media]||[]).push(m); });
    const dis = editable ? '' : 'disabled';
    const medias = Object.keys(byMedia);
    // 매체가 많아져도 스캔 가능하도록: 검색 + 매체별 아코디언(접힘 기본, 첫 항목만 펼침)
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <input class="form-input" id="mediaMapSearch" placeholder="🔍 매체 검색 (${medias.length}개 연동)" oninput="filterMediaMap(this.value)" style="height:32px;font-size:12px;flex:1;">
        <button class="btn btn-xs btn-outline" onclick="toggleAllMediaAcc(true)">모두 펼치기</button>
        <button class="btn btn-xs btn-outline" onclick="toggleAllMediaAcc(false)">모두 접기</button>
      </div>
      <div id="mediaMapAcc">` +
      medias.map((media, idx)=>{
        const rows = byMedia[media];
        const mapped = rows.filter(r=>r.provider_field && r.provider_field.trim()).length;
        const open = idx === 0;
        return `<div class="map-acc" data-media="${(MEDIA_LABELS[media]||media).toLowerCase()} ${media.toLowerCase()}">
          <div class="map-acc-head ${open?'open':''}" onclick="toggleMediaAcc(this)">
            <span class="map-acc-title">${MEDIA_LABELS[media]||media}</span>
            <span class="map-acc-meta">
              <span class="badge ${mapped===rows.length?'badge-green':'badge-orange'}">${mapped}/${rows.length} 매핑</span>
              <span class="map-acc-chev">▾</span>
            </span>
          </div>
          <div class="map-acc-body" style="display:${open?'block':'none'};">
            <table class="data-table" style="width:100%;font-size:12px;">
              <thead><tr><th style="width:22%;">솔루션 지표</th><th style="width:48%;">매체 제공 필드명</th><th style="width:30%;"></th></tr></thead>
              <tbody>${rows.map(m=>`
                <tr>
                  <td>${METRIC_KEY_LABEL[m.metric_key]||m.metric_key}</td>
                  <td><input class="form-input mm-f" id="mm-${m.id}" value="${(m.provider_field||'').replace(/"/g,'&quot;')}" placeholder="매체 필드명" ${dis}></td>
                  <td>${editable?`<button class="btn btn-xs btn-outline" onclick="saveMediaMap('${media}','${m.metric_key}','${m.solution_name}','mm-${m.id}')">저장</button>`:'-'}</td>
                </tr>`).join('')}</tbody>
            </table>
          </div>
        </div>`;
      }).join('') + `</div>`;

    // 수기 매체 섹션
    if (MANUAL_MEDIA.length) {
      const manualHtml = MANUAL_MEDIA.map((mm, idx) => {
        const keys = Object.keys(METRIC_KEY_LABEL);
        const rows = keys.map(k => `
          <tr>
            <td>${METRIC_KEY_LABEL[k]}</td>
            <td><input class="form-input mm-f" id="mm-manual-${idx}-${k}" value="${(mm.mappings[k]||'').replace(/"/g,'&quot;')}" placeholder="매체 필드명" ${editable?'':'disabled'}></td>
            <td>${editable?`<button class="btn btn-xs btn-outline" onclick="saveManualMediaMapping(${idx},'${k}',document.getElementById('mm-manual-${idx}-${k}').value)">저장</button>`:'-'}</td>
          </tr>`).join('');
        return `<div class="map-acc" data-media="${mm.name.toLowerCase()}">
          <div class="map-acc-head open" onclick="toggleMediaAcc(this)">
            <span class="map-acc-title" style="display:flex;align-items:center;gap:7px;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${mm.color};"></span>
              ${mm.name}
              <span class="badge badge-gray" style="font-size:9px;">수기</span>
            </span>
            <span class="map-acc-meta">
              <span class="badge ${Object.values(mm.mappings).filter(v=>v.trim()).length===keys.length?'badge-green':'badge-orange'}">${Object.values(mm.mappings).filter(v=>v.trim()).length}/${keys.length} 매핑</span>
              ${editable?`<button class="btn btn-xs" style="color:var(--danger);border:none;background:none;padding:0 4px;cursor:pointer;" onclick="event.stopPropagation();removeManualMedia(${idx})" title="삭제">✕</button>`:''}
              <span class="map-acc-chev">▾</span>
            </span>
          </div>
          <div class="map-acc-body">
            <table class="data-table" style="width:100%;font-size:12px;">
              <thead><tr><th style="width:22%;">솔루션 지표</th><th style="width:48%;">매체 제공 필드명</th><th style="width:30%;"></th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
      }).join('');
      el.innerHTML += `
        <div style="margin-top:16px;">
          <div style="font-size:11px;color:var(--gray-400);font-weight:600;letter-spacing:.5px;margin-bottom:8px;">수기 등록 매체</div>
          <div id="mediaMapManualAcc">${manualHtml}</div>
        </div>`;
    }
  } catch(e) { el.innerHTML = `<div class="readonly-banner">불러오기 실패: ${e.message}</div>`; }
}
function toggleMediaAcc(head) {
  const body = head.nextElementSibling;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  head.classList.toggle('open', !open);
}
function toggleAllMediaAcc(open) {
  document.querySelectorAll('#mediaMapAcc .map-acc').forEach(d=>{
    if (d.style.display === 'none') return;  // 검색 필터로 숨겨진 건 건너뜀
    d.querySelector('.map-acc-body').style.display = open ? 'block' : 'none';
    d.querySelector('.map-acc-head').classList.toggle('open', open);
  });
}
function filterMediaMap(q) {
  q = (q||'').toLowerCase().trim();
  document.querySelectorAll('#mediaMapAcc .map-acc').forEach(d=>{
    d.style.display = (!q || d.dataset.media.includes(q)) ? '' : 'none';
  });
}

async function saveMediaMap(media, metric_key, solution_name, inputId) {
  const provider_field = document.getElementById(inputId).value;
  try {
    await DEEPFLE_API.post(`/accounts/${currentAccount.id}/media-metric-map`,
      {media, metric_key, provider_field, solution_name});
    showToast(`${MEDIA_LABELS[media]||media} ${METRIC_KEY_LABEL[metric_key]} 매핑 저장`,'success');
  } catch(e){ showToast(`저장 실패: ${e.message}`, e.status===403?'error':'warning'); }
}

// ============================================================
// ACCOUNT SELECT MODAL
// ============================================================
function showModal(name) {
  if (name === 'accountSelect') {
    const accessible = BACKEND_ACCOUNTS.length ? BACKEND_ACCOUNTS : ACCOUNTS.filter(a=>a.users?.includes(currentUser.id));
    document.getElementById('accountSelectBody').innerHTML = accessible.length ? accessible.map(a=>`
      <div onclick="switchAccount('${a.id}');closeModal('accountSelect')" style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:9px;cursor:pointer;border:1.5px solid ${currentAccount?.id===a.id?'var(--primary)':'var(--gray-200)'};background:${currentAccount?.id===a.id?'var(--primary-light)':'#fff'};margin-bottom:8px;transition:.2s;">
        <div style="width:10px;height:10px;border-radius:50%;background:${a.color||'#4F46E5'};flex-shrink:0;"></div>
        <div style="flex:1;"><div style="font-size:13px;font-weight:700;">${a.name}</div><div style="font-size:11px;color:var(--gray-400);">${a.advertiser||''}</div></div>
        ${currentAccount?.id===a.id?'<span style="color:var(--primary);font-size:12px;font-weight:700;">현재</span>':''}
      </div>`).join('') : '<p style="text-align:center;color:var(--gray-400);padding:20px 0;font-size:13px;">등록된 계정이 없습니다.<br><button class="btn btn-sm btn-primary" style="margin-top:12px;" onclick="closeModal(\'accountSelect\');showPanel(\'accounts\',null);setTimeout(()=>{renderAccounts();showAddAccountWizard();},200)">+ 계정 추가</button></p>';
    // populate invite accounts
    const sel = document.getElementById('inviteAccounts');
    if(sel){ sel.innerHTML=''; (BACKEND_ACCOUNTS.length?BACKEND_ACCOUNTS:ACCOUNTS).forEach(a=>{ const o=document.createElement('option'); o.value=a.id; o.textContent=a.name; sel.appendChild(o); }); }
  }
  if (name === 'inviteUser') {
    const sel = document.getElementById('inviteAccounts');
    if (sel) {
      const list = BACKEND_ACCOUNTS.length ? BACKEND_ACCOUNTS : ACCOUNTS;
      sel.innerHTML = list.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
    }
    document.getElementById('inviteEmail').value = '';
    const lb = document.getElementById('inviteLinkBox');
    if (lb) lb.style.display = 'none';
  }
  if (name === 'audienceCreate') {
    initSegBuilder();
  }
  document.getElementById('modal-'+name).classList.add('open');
}

function closeModal(name) {
  document.getElementById('modal-'+name).classList.remove('open');
}

document.querySelectorAll('.modal-overlay').forEach(m=>{
  m.addEventListener('click', e=>{ if(e.target===m && !m.dataset.noBackdropClose) m.classList.remove('open'); });
});

// ============================================================
// TOAST
// ============================================================
function showToast(msg, type='success') {
  const c = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast-item toast-${type}`;
  const icons = {success:'✓',warning:'⚠',error:'✕',info:'ℹ'};
  el.innerHTML = `${icons[type]||'✓'} ${msg}`;
  c.appendChild(el);
  setTimeout(()=>el.style.opacity='0', 2800);
  setTimeout(()=>el.remove(), 3200);
}

function showAlert(htmlMsg, title='안내') {
  let ov = document.getElementById('_alertOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = '_alertOverlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(ov);
  }
  ov.innerHTML = `
    <div style="background:var(--surface,#fff);border-radius:12px;padding:24px 28px;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.18);">
      <div style="font-weight:700;font-size:15px;margin-bottom:14px;">${title}</div>
      <div style="font-size:13px;line-height:1.7;color:var(--gray-700,#374151);">${htmlMsg}</div>
      <button onclick="document.getElementById('_alertOverlay').style.display='none'"
        style="margin-top:18px;width:100%;padding:9px;background:var(--primary,#4F46E5);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">확인</button>
    </div>`;
  ov.style.display = 'flex';
}

// ============================================================
// API 추상화 레이어 (백엔드 연동 지점)
// ============================================================
// 실제 백엔드 연동 시 USE_MOCK=false 로 변경하고 BASE_URL 설정.
// mock 모드에서는 localStorage를 백엔드처럼 사용합니다.
const DEEPFLE_API = {
  USE_MOCK: true,               // 백엔드 헬스체크 성공 시 자동으로 false 전환
  live: false,                  // 백엔드 가용 여부
  BASE_URL: 'https://web-production-264b2.up.railway.app/api',   // 운영: https://api.deepfle.io/api
  token: null,                  // JWT (로그인 시 발급)

  // 엔드포인트 매핑
  endpoints: {
    login:        'POST   /auth/login',
    me:           'GET    /auth/me',
    accounts:     'GET    /accounts',
    mediaStats:   'GET    /accounts/:accId/media',
    mediaUpdate:  'PATCH  /media/:mediaId',
    rules:        'GET    /accounts/:accId/rules',
    audit:        'GET    /accounts/:accId/audit',
    reports:      'GET    /accounts/:accId/reports',
    links:        'GET    /accounts/:accId/attribution-links',
    audiences:    'GET    /accounts/:accId/audiences',
    audienceSync: 'POST   /accounts/:accId/audiences/:audId/sync',
    activities:   'GET    /accounts/:accId/activities',
    mediaConnect: 'POST   /accounts/:accId/integrations/:media/oauth',
    users:        'GET    /users',
  },

  // 백엔드 가용 여부 점검 (페이지 로드 시 1회)
  async healthCheck() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(()=>ctrl.abort(), 1200);
      const res = await fetch(this.BASE_URL + '/health', {signal: ctrl.signal});
      clearTimeout(t);
      this.live = res.ok;
      this.USE_MOCK = !res.ok;
    } catch(e) {
      this.live = false;
      this.USE_MOCK = true;
    }
    return this.live;
  },

  async request(method, path, body) {
    if (this.USE_MOCK) return this._mock(method, path, body);
    const res = await fetch(this.BASE_URL + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? {'Authorization': 'Bearer ' + this.token} : {})
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(()=>({}));
    if (!res.ok) { const err = new Error(data.error || `API ${res.status}`); err.status=res.status; throw err; }
    return data;
  },

  // mock: localStorage 기반 응답 (전환설정·metric-catalog는 실제 데이터 반환)
  _mock(method, path, body) {
    const DEMO_CONV_KEY = 'deepfle_demo_conversions';
    const getConvs = () => JSON.parse(localStorage.getItem(DEMO_CONV_KEY) || 'null') || [
      {id:1, source:'manual', source_metric:'purchase', solution_metric:'구매', value_type:'count', active:true},
      {id:2, source:'manual', source_metric:'sign_up',  solution_metric:'회원가입', value_type:'count', active:true},
    ];
    const saveConvs = c => localStorage.setItem(DEMO_CONV_KEY, JSON.stringify(c));

    return new Promise(resolve => {
      setTimeout(() => {
        if (path.includes('/metric-catalog')) {
          const convs = getConvs().filter(c => c.active);
          resolve({
            base: [{name:'노출수'},{name:'클릭수'},{name:'광고비'},{name:'CPC'},{name:'CPM'}],
            conversion: convs.map(c => ({id:c.id, name:c.solution_metric, type:c.value_type}))
          });
        } else if (method === 'GET' && path.includes('/conversion-settings')) {
          resolve({conversions: getConvs()});
        } else if (method === 'POST' && path.includes('/conversion-settings')) {
          const convs = getConvs();
          const newId = convs.length ? Math.max(...convs.map(c=>c.id)) + 1 : 1;
          const newConv = {id:newId, active:true, source:'manual', source_metric:'', solution_metric:'새 전환지표', value_type:'count', ...body};
          convs.push(newConv);
          saveConvs(convs);
          resolve({conversion: newConv});
        } else if (method === 'PATCH' && path.includes('/conversion-settings/')) {
          const id = parseInt(path.split('/').pop());
          const convs = getConvs();
          const idx = convs.findIndex(c => c.id === id);
          if (idx >= 0) { Object.assign(convs[idx], body); saveConvs(convs); }
          resolve({ok:true});
        } else if (method === 'DELETE' && path.includes('/conversion-settings/')) {
          const id = parseInt(path.split('/').pop());
          saveConvs(getConvs().filter(c => c.id !== id));
          resolve({ok:true});
        } else {
          resolve({ok:true, mock:true, method, path, data:body||null});
        }
      }, 80);
    });
  },

  get(p){return this.request('GET',p);},
  post(p,b){return this.request('POST',p,b);},
  patch(p,b){return this.request('PATCH',p,b);},
  put(p,b){return this.request('PUT',p,b);},
  del(p){return this.request('DELETE',p);},
  delete(p){return this.request('DELETE',p);},
};

// mock 모드 로그인 시 이메일/비밀번호 검증용 (백엔드 미연결 시에만 사용)
const DEMO_CREDENTIALS = {
  master:     {email:'admin@deepfle.io', password:'admin123'},
  user:       {email:'kim@agency.io',    password:'user123'},
  advertiser: {email:'brand@client.io',  password:'adv123'},
};

let BACKEND_ACCOUNTS = [];
let BACKEND_WORKSPACES = [];
let BACKEND_ACCOUNT_MEDIA = {};
let currentWorkspace = null;

// R1: 워크스페이스 전환
async function switchWorkspace(wsId) {
  currentWorkspace = BACKEND_WORKSPACES.find(w => w.id === wsId);
  const res = await DEEPFLE_API.get(`/workspaces/${wsId}/accounts`);
  BACKEND_ACCOUNTS = res.accounts;
  if (BACKEND_ACCOUNTS[0]) {
    currentAccount = {id:BACKEND_ACCOUNTS[0].id, name:BACKEND_ACCOUNTS[0].name,
                      advertiser:BACKEND_ACCOUNTS[0].advertiser, color:BACKEND_ACCOUNTS[0].color, users:[]};
    await loadBackendMedia(currentAccount.id);
  }
  applySidebar();
  renderSidebarNav();
  showPanel('overview', document.getElementById('nav-overview'));
  showToast(`"${currentWorkspace.name}" 워크스페이스로 전환했습니다`,'success');
}

// R1: 연결 관리 화면 렌더 (광고계정 + 외부연동, 백엔드 실데이터)
const MEDIA_LABELS = {meta:'메타', google:'Google Ads', kakao:'카카오모먼트', naver:'네이버검색',
  naver_sa:'네이버 검색광고', naver_gfa:'네이버 성과형(GFA)', tiktok:'틱톡', kakao_biz:'카카오 비즈보드',
  youtube:'유튜브', karrot:'당근마켓', naver_shopping:'네이버 쇼핑',
  apple_sa:'Apple Search Ads', pinterest:'Pinterest', x_ads:'X(Twitter)', criteo:'Criteo', msft:'Microsoft Ads', snap:'Snapchat',
  taboola:'Taboola', dable:'데이블', karrot:'당근마켓', coupang:'쿠팡광고',
  mobion:'모비온', moloco:'몰로코', kakao_sa:'카카오 키워드광고', buzzvil:'버즈빌', inmobi:'InMobi'};
const INTEG_LABELS = {ga4:'Google Analytics 4', cafe24:'Cafe24', mmp:'MMP(앱 어트리뷰션)', sns:'SNS'};

// ── 마크업 설정 ──────────────────────────────────────────────────────────────
const _MARKUP_CFG_KEY = 'deepfle_markup_cfg';
// 지원 매체 목록 (Snapchat·MSFT 제외)
const _MARKUP_MEDIAS = [
  {key:'meta',           label:'메타'},
  {key:'google',         label:'Google Ads'},
  {key:'kakao',          label:'카카오모먼트'},
  {key:'kakao_biz',      label:'카카오 비즈보드'},
  {key:'naver_sa',       label:'네이버 검색광고'},
  {key:'naver_gfa',      label:'네이버 성과형(GFA)'},
  {key:'naver_shopping', label:'네이버 쇼핑'},
  {key:'tiktok',         label:'틱톡'},
  {key:'youtube',        label:'유튜브'},
  {key:'karrot',         label:'당근마켓'},
  {key:'pinterest',      label:'Pinterest'},
  {key:'x_ads',          label:'X (Twitter)'},
  {key:'criteo',         label:'Criteo'},
  {key:'apple_sa',       label:'Apple Search Ads'},
];
function _getMarkupCfg(){ try{return JSON.parse(localStorage.getItem(_accKey(_MARKUP_CFG_KEY))||'{}');}catch{return {};} }
function _saveMarkupCfg(cfg){ localStorage.setItem(_accKey(_MARKUP_CFG_KEY),JSON.stringify(cfg)); }
// cfg 구조: { meta: { enabled, rate, method }, google: { ... }, ... }
function _markupCost(cost, mediaKey){
  const mc=_getMarkupCfg()[mediaKey];
  if(!mc?.enabled) return cost;
  const rate=(mc.rate||0)/100;
  if(!rate) return cost;
  return mc.method==='gross' ? Math.round(cost/(1-rate)) : Math.round(cost*(1+rate));
}
function _markupApplies(mediaKey){ return !!_getMarkupCfg()[mediaKey]?.enabled; }

function renderMarkupSettings(){
  const el=document.getElementById('setting-markup'); if(!el) return;
  const cfg=_getMarkupCfg();
  // 연동된 매체(ON 상태) + 수기 등록 매체만 표시
  const connectedKeys = new Set(MEDIA_DATA.filter(m=>m.on).map(m=>m.key).filter(Boolean));
  const connectedNames = new Set(MEDIA_DATA.filter(m=>m.on).map(m=>m.name));
  const activeMediaList = [
    ..._MARKUP_MEDIAS.filter(m => connectedKeys.has(m.key) || connectedNames.has(m.label)),
    ...MANUAL_MEDIA.map(m => ({key:'manual_'+m.id, label:m.name+' (수기)'}))
  ];
  if (!activeMediaList.length) {
    el.innerHTML=`<div class="card" style="max-width:720px;"><div style="padding:32px;text-align:center;color:var(--gray-400);font-size:13px;">매체 커넥터 & API 키 관리에서 매체를 연동하거나 수기 매체를 추가하면 마크업을 설정할 수 있습니다.</div></div>`;
    return;
  }
  const activeCount=activeMediaList.filter(m=>cfg[m.key]?.enabled).length;
  const rows=activeMediaList.map(m=>{
    const mc=cfg[m.key]||{};
    const on=!!mc.enabled;
    const rate=mc.rate??15;
    const method=mc.method||'net';
    const dimStyle=on?'':'opacity:0.4;pointer-events:none;';
    return `<tr>
      <td>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
          <input type="checkbox" id="mk_${m.key}_on" ${on?'checked':''}>
          ${m.label}
        </label>
      </td>
      <td id="mk_${m.key}_row" style="display:flex;gap:8px;align-items:center;${dimStyle}">
        <input type="number" id="mk_${m.key}_rate" class="form-input"
          value="${rate}" min="0" max="200" step="0.1"
          style="height:32px;font-size:12px;width:72px;text-align:right;padding:0 8px;">
        <span style="font-size:11px;color:var(--gray-400);">%</span>
      </td>
      <td id="mk_${m.key}_method_cell" style="${dimStyle}">
        <select id="mk_${m.key}_method" class="form-select" style="height:32px;font-size:12px;min-width:160px;">
          <option value="net"   ${method==='net'  ?'selected':''}>넷 (광고비 × (1+rate))</option>
          <option value="gross" ${method==='gross'?'selected':''}>그로스 (광고비 ÷ (1-rate))</option>
        </select>
      </td>
    </tr>`;
  }).join('');
  el.innerHTML=`
    <div class="card" style="max-width:720px;">
      <div class="card-header">
        <div>
          <div class="card-title">마크업 설정</div>
          <div class="card-sub">매체별로 마크업율과 방식을 개별 설정합니다</div>
        </div>
        ${activeCount?`<span class="badge badge-green">${activeCount}개 매체 적용중</span>`:'<span class="badge" style="background:var(--gray-100);color:var(--gray-500);">미적용</span>'}
      </div>
      <div style="overflow-x:auto;margin-top:12px;">
        <table class="data-table" style="width:100%;">
          <thead>
            <tr>
              <th style="width:170px;">적용 매체</th>
              <th style="width:130px;">마크업율</th>
              <th>방식</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="margin-top:16px;display:flex;gap:8px;">
        <button class="btn btn-primary btn-sm" onclick="saveMarkupSettings()">저장</button>
        <button class="btn btn-sm btn-outline" onclick="clearMarkupSettings()">전체 해제</button>
      </div>
    </div>`;
  // checkbox → opacity + pointer-events 연동
  activeMediaList.forEach(m=>{
    const cb=document.getElementById(`mk_${m.key}_on`);
    if(cb) cb.addEventListener('change',e=>{
      const on=e.target.checked;
      [document.getElementById(`mk_${m.key}_row`), document.getElementById(`mk_${m.key}_method_cell`)].forEach(el=>{
        if(!el) return;
        el.style.opacity=on?'1':'0.4';
        el.style.pointerEvents=on?'':'none';
      });
    });
  });
}
function _getActiveMarkupMedias(){
  const connectedKeys=new Set(MEDIA_DATA.filter(m=>m.on).map(m=>m.key).filter(Boolean));
  const connectedNames=new Set(MEDIA_DATA.filter(m=>m.on).map(m=>m.name));
  return [
    ..._MARKUP_MEDIAS.filter(m=>connectedKeys.has(m.key)||connectedNames.has(m.label)),
    ...MANUAL_MEDIA.map(m=>({key:'manual_'+m.id, label:m.name+' (수기)'}))
  ];
}
function saveMarkupSettings(){
  const cfg={};
  _getActiveMarkupMedias().forEach(m=>{
    const on=document.getElementById(`mk_${m.key}_on`)?.checked||false;
    const rate=parseFloat(document.getElementById(`mk_${m.key}_rate`)?.value||15);
    const method=document.getElementById(`mk_${m.key}_method`)?.value||'net';
    cfg[m.key]={enabled:on,rate,method};
  });
  _saveMarkupCfg(cfg);
  renderMarkupSettings();
  const cnt=Object.values(cfg).filter(v=>v.enabled).length;
  showToast(cnt?`마크업 저장됨 — ${cnt}개 매체 적용중`:'마크업 설정이 저장됐습니다','success');
}
function clearMarkupSettings(){
  const cfg={};
  _getActiveMarkupMedias().forEach(m=>{cfg[m.key]={enabled:false,rate:15,method:'net'};});
  _saveMarkupCfg(cfg);
  renderMarkupSettings();
  showToast('전체 마크업이 해제됐습니다','info');
}

// ── Raw Download 전역 상수 ────────────────────────────────────────────────────
const RD_DEVICE_LABELS = {mobile:'모바일',desktop:'PC/데스크탑',tablet:'태블릿',ctv:'CTV'};
const RD_TYPE_LABELS   = {SEARCH:'검색광고',DISPLAY:'디스플레이',PERFORMANCE_MAX:'PMax',SHOPPING:'쇼핑',VIDEO:'동영상',BIZBOARD:'비즈보드',CHANNEL_MSG:'채널메시지',CONVERSION:'전환',AWARENESS:'인지도',TRAFFIC:'트래픽',WEB_SITE:'파워링크',BRAND:'브랜드검색'};
const RD_COLS_DEFAULT  = [
  // ── 기본 차원 ──
  {key:'date',          label:'날짜',          type:'dim',    vis:true,  fmt:'S', group:'base'},
  {key:'media',         label:'매체',          type:'dim',    vis:true,  fmt:'S', group:'base'},
  // ── 계층 차원 (캠페인 하위 뎁스) ──
  {key:'campaign',      label:'캠페인',        type:'dim',    vis:false, fmt:'S', group:'hier'},
  {key:'adgroup',       label:'광고그룹',      type:'dim',    vis:false, fmt:'S', group:'hier'},
  {key:'keyword',       label:'키워드',        type:'dim',    vis:false, fmt:'S', group:'hier'},
  {key:'creative',      label:'소재',          type:'dim',    vis:false, fmt:'S', group:'hier'},
  // ── 분류 차원 ──
  {key:'campaign_type', label:'상품유형',      type:'dim',    vis:false, fmt:'S', group:'base'},
  {key:'device',        label:'디바이스',      type:'dim',    vis:false, fmt:'S', group:'base'},
  // ── 기본 지표 ──
  {key:'cost',          label:'광고비',        type:'metric', vis:true,  fmt:'W', group:'metric'},
  {key:'imp',           label:'노출수',        type:'metric', vis:true,  fmt:'N', group:'metric'},
  {key:'click',         label:'클릭수',        type:'metric', vis:true,  fmt:'N', group:'metric'},
  {key:'ctr',           label:'CTR',           type:'metric', vis:true,  fmt:'%', group:'metric'},
  {key:'cpc',           label:'CPC',           type:'metric', vis:false, fmt:'W', group:'metric'},
  {key:'cpm',           label:'CPM',           type:'metric', vis:false, fmt:'W', group:'metric'},
  // ── 전환 지표 (소스별) ──
  {key:'conv',          label:'전환(합계)',    type:'metric', vis:true,  fmt:'N', group:'conv'},
  {key:'conv_native',   label:'전환(매체픽셀)',type:'metric', vis:false, fmt:'N', group:'conv'},
  {key:'conv_ga4',      label:'전환(GA4)',     type:'metric', vis:false, fmt:'N', group:'conv'},
  {key:'conv_mmp',      label:'전환(MMP)',     type:'metric', vis:false, fmt:'N', group:'conv'},
  {key:'conv_manual',   label:'전환(수기)',    type:'metric', vis:false, fmt:'N', group:'conv'},
  {key:'cvr',           label:'CVR',           type:'metric', vis:false, fmt:'%', group:'metric'},
  {key:'cpa',           label:'CPA',           type:'metric', vis:false, fmt:'W', group:'metric'},
];
let _rdCurCols = null;
let _rdRows    = [];
let _rdSortKey = 'date';
let _rdSortAsc = true;
let _rdDragSrcIdx = null;

const _RD_COLS_VER = 'deepfle_rd_cols_v2'; // 컬럼 구조 변경 시 키 변경 → 자동 리셋
function _rdGetCols() {
  if (_rdCurCols) return _rdCurCols;
  try {
    const s = localStorage.getItem(_RD_COLS_VER);
    if (s) {
      const saved = JSON.parse(s);
      // 기존 저장에 없는 신규 컬럼 병합
      const savedKeys = new Set(saved.map(c => c.key));
      const merged = [...saved];
      for (const def of RD_COLS_DEFAULT) {
        if (!savedKeys.has(def.key)) merged.push(JSON.parse(JSON.stringify(def)));
      }
      _rdCurCols = merged;
      return _rdCurCols;
    }
  } catch(e) {}
  _rdCurCols = JSON.parse(JSON.stringify(RD_COLS_DEFAULT));
  return _rdCurCols;
}
function _rdSaveCols() { try { localStorage.setItem(_RD_COLS_VER, JSON.stringify(_rdCurCols||[])); } catch(e) {} }

function _rdCellVal(col, row) {
  const rawCost=row.cost||0;
  const cost=_markupCost(rawCost, row.media_key);
  const imp=row.imp||0, click=row.click||0, conv=row.conv||0;
  switch(col.key) {
    case 'date':          return row.date||'-';
    case 'media':         return MEDIA_LABELS[row.media_key]||row.media_key||MEDIA_LABELS[row.media]||row.media||'-';
    case 'device':        return RD_DEVICE_LABELS[row.device]||row.device||'-';
    case 'campaign_type': return RD_TYPE_LABELS[row.campaign_type]||row.campaign_type||'-';
    // 계층 차원
    case 'campaign':      return row.campaign  || '-';
    case 'adgroup':       return row.adgroup   || '-';
    case 'keyword':       return row.keyword   || '-';
    case 'creative':      return row.creative  || '-';
    // 기본 지표
    case 'cost':   return cost;
    case 'imp':    return imp;
    case 'click':  return click;
    case 'conv':   return conv;
    case 'ctr':    return imp?(click/imp*100):0;
    case 'cpc':    return click?Math.round(cost/click):0;
    case 'cpm':    return imp?Math.round(cost/imp*1000):0;
    case 'cvr':    return click?(conv/click*100):0;
    case 'cpa':    return conv?Math.round(cost/conv):0;
    // 전환 소스별
    case 'conv_native': return row.conv_native||0;
    case 'conv_ga4':    return row.conv_ga4   ||0;
    case 'conv_mmp':    return row.conv_mmp   ||0;
    case 'conv_manual': return row.conv_manual||0;
    default:       return '-';
  }
}
function _rdFmtDisp(col, row) {
  const v = _rdCellVal(col, row);
  if (typeof v !== 'number') return v;
  switch(col.fmt) {
    case 'W': return fmtW(Math.round(v));
    case 'N': return fmtN(Math.round(v));
    case '%': return v.toFixed(2)+'%';
    default:  return v;
  }
}
function _rdFmtCSV(col, row) {
  const v = _rdCellVal(col, row);
  if (typeof v === 'string') return v.includes(',') ? `"${v}"` : v;
  if (col.fmt==='%') return v.toFixed(2);
  return Math.round(v);
}

// ── 컬럼 리스트 렌더 ────────────────────────────────────────────────────────
function _rdRenderColList() {
  const el = document.getElementById('rdColList');
  if (!el) return;
  const cols = _rdGetCols();
  const GROUP_LABEL = {base:'기본', hier:'계층(캠페인↓)', conv:'전환', metric:'지표'};
  const GROUP_COLOR = {base:'#EFF6FF', hier:'#FEF9C3', conv:'#F0FDF4', metric:'#F5F3FF'};
  const GROUP_TC    = {base:'#1E40AF', hier:'#92400E', conv:'#166534', metric:'#5B21B6'};
  let lastGroup = null;
  let html = '';
  for (let i=0; i<cols.length; i++) {
    const c = cols[i];
    const g = c.group || (c.type==='dim'?'base':'metric');
    if (g !== lastGroup) {
      if (lastGroup !== null) html += '<div style="width:1px;height:28px;background:var(--gray-200);margin:0 4px;align-self:center;"></div>';
      lastGroup = g;
    }
    const bg  = c.vis ? 'var(--primary-50)' : 'var(--gray-50)';
    const bd  = c.vis ? 'var(--primary-300)' : 'var(--gray-200)';
    const tc  = c.vis ? 'var(--primary-700)' : 'var(--gray-400)';
    const tagBg = GROUP_COLOR[g] || '#F0FDF4';
    const tagTc = GROUP_TC[g]    || '#166534';
    html += `<div class="rd-col-chip ${c.vis?'rd-chip-on':'rd-chip-off'}"
         draggable="true" data-i="${i}"
         ondragstart="rdDragStart(event,${i})" ondragover="rdDragOver(event)"
         ondrop="rdDrop(event,${i})" ondragend="rdDragEnd()"
         style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;border:1px solid ${bd};background:${bg};cursor:grab;font-size:12px;color:${tc};user-select:none;">
      <span style="color:var(--gray-300);font-size:10px;">⠿</span>
      <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
        <input type="checkbox" style="margin:0;" ${c.vis?'checked':''} onchange="rdToggleCol(${i})">
        ${c.label}
      </label>
      <span style="font-size:9px;background:${tagBg};color:${tagTc};padding:1px 4px;border-radius:4px;">${GROUP_LABEL[g]||g}</span>
    </div>`;
  }
  el.innerHTML = html;
}
function rdDragStart(e,i){ _rdDragSrcIdx=i; e.dataTransfer.effectAllowed='move'; }
function rdDragOver(e){ e.preventDefault(); e.dataTransfer.dropEffect='move'; }
function rdDrop(e,i){
  e.preventDefault();
  if(_rdDragSrcIdx===null||_rdDragSrcIdx===i) return;
  const cols=_rdGetCols();
  const [m]=cols.splice(_rdDragSrcIdx,1);
  cols.splice(i,0,m);
  _rdSaveCols();
  _rdRenderColList();
  _rdDragSrcIdx=null;
}
function rdDragEnd(){ _rdDragSrcIdx=null; }
function rdToggleCol(i){
  const cols=_rdGetCols();
  cols[i].vis=!cols[i].vis;
  _rdSaveCols();
  _rdRenderColList();
}
function rdResetCols(){
  _rdCurCols=JSON.parse(JSON.stringify(RD_COLS_DEFAULT));
  _rdSaveCols();
  _rdRenderColList();
  showToast('컬럼 설정이 초기화됐습니다','info');
}
// ── 프리셋 저장/불러오기 ────────────────────────────────────────────────────
let _rdActivePreset = null;
const _RD_PRESETS_KEY='deepfle_rd_presets';
function _rdGetPresets(){ try{return JSON.parse(localStorage.getItem(_RD_PRESETS_KEY)||'[]');}catch{return [];} }
function _rdSavePresets(p){ localStorage.setItem(_RD_PRESETS_KEY,JSON.stringify(p)); }
function rdSavePreset(){
  const name=prompt('설정 이름을 입력하세요:');
  if(!name||!name.trim()) return;
  const presets=_rdGetPresets();
  const preset={
    name:name.trim(),
    from:document.getElementById('rdFrom')?.value||_ruFrom||'',
    to:document.getElementById('rdTo')?.value||_ruTo||'',
    media:document.getElementById('rdMedia')?.value||'',
    cols:JSON.parse(JSON.stringify(_rdGetCols()))
  };
  const idx=presets.findIndex(p=>p.name===preset.name);
  if(idx>=0) presets[idx]=preset; else presets.push(preset);
  _rdSavePresets(presets);
  _rdRenderPresets();
  showToast(`"${preset.name}" 설정이 저장됐습니다`,'success');
}
function rdLoadPreset(i){
  const p=_rdGetPresets()[i]; if(!p) return;
  _rdActivePreset = p;
  if(p.from){const el=document.getElementById('rdFrom'); if(el) el.value=p.from; else _ruFrom=p.from;}
  if(p.to)  {const el=document.getElementById('rdTo');   if(el) el.value=p.to;   else _ruTo=p.to;}
  if(p.media!==undefined){const el=document.getElementById('rdMedia'); if(el) el.value=p.media;}
  if(p.cols){_rdCurCols=JSON.parse(JSON.stringify(p.cols));_rdSaveCols();_rdRenderColList();}
  showToast(`"${p.name}" 설정을 불러왔습니다`,'success');
}
function rdDeletePreset(i){
  const presets=_rdGetPresets(); presets.splice(i,1); _rdSavePresets(presets); _rdRenderPresets();
}
function _rdRenderPresets(){
  const el=document.getElementById('rdPresetList'); if(!el) return;
  const presets=_rdGetPresets();
  if(!presets.length){el.innerHTML='<span style="font-size:11px;color:var(--gray-400);">저장된 설정이 없습니다</span>';return;}
  el.innerHTML=presets.map((p,i)=>`
    <div style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px 3px 12px;border-radius:16px;background:var(--primary-50);border:1px solid var(--primary-200);font-size:11px;">
      <span onclick="rdLoadPreset(${i})" style="color:var(--primary-700);font-weight:500;cursor:pointer;">${p.name}</span>
      <span onclick="rdDeletePreset(${i})" style="color:var(--gray-400);cursor:pointer;padding:0 2px;font-size:14px;line-height:1;">×</span>
    </div>`).join('');
}

// ── 클립보드 복사 ────────────────────────────────────────────────────────────
function rdCopyClipboard(){
  const rows=_rdRows;
  if(!rows||!rows.length){showToast('먼저 데이터를 조회하세요','warning');return;}
  const visCol=_rdGetCols().filter(c=>c.vis);
  const header=visCol.map(c=>c.label).join('\t');
  const body=rows.map(r=>visCol.map(c=>_rdFmtCSV(c,r)).join('\t')).join('\n');
  const text=header+'\n'+body;
  (navigator.clipboard?.writeText(text)||Promise.reject()).then(()=>{
    showToast(`클립보드에 복사됐습니다 (${rows.length.toLocaleString()}행)`,'success');
  }).catch(()=>{
    const ta=document.createElement('textarea');
    ta.value=text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
    showToast(`클립보드에 복사됐습니다 (${rows.length.toLocaleString()}행)`,'success');
  });
}

function _rdGetBreakdown(){
  const cols=_rdGetCols();
  const devOn = cols.find(c=>c.key==='device'&&c.vis);
  const ptOn  = cols.find(c=>c.key==='campaign_type'&&c.vis);
  if(devOn && ptOn) return 'both';
  if(devOn)         return 'device';
  if(ptOn)          return 'product';
  return 'none';
}

function _rdGetHierarchyLevel(){
  const cols = _rdGetCols();
  if(cols.find(c=>c.key==='creative' &&c.vis)) return 'creative';
  if(cols.find(c=>c.key==='keyword'  &&c.vis)) return 'keyword';
  if(cols.find(c=>c.key==='adgroup'  &&c.vis)) return 'adgroup';
  if(cols.find(c=>c.key==='campaign' &&c.vis)) return 'campaign';
  return null;
}

// ── 데이터 조회 ─────────────────────────────────────────────────────────────


async function fetchRawData() {
  const from   = document.getElementById('rdFrom')?.value  || window._globalFrom || new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  const to     = document.getElementById('rdTo')?.value    || window._globalTo   || new Date().toISOString().slice(0,10);
  const media  = document.getElementById('rdMedia')?.value || '';
  const result = document.getElementById('rdResult');
  if (result) result.innerHTML='<div style="padding:60px;text-align:center;color:var(--gray-400);">데이터 로드 중...</div>';
  let rows=[];
  if (currentAccount&&!DEEPFLE_API.USE_MOCK) {
    try {
      const hierLevel = _rdGetHierarchyLevel();
      let qs, endpoint;
      if (hierLevel) {
        const _hCols = _rdGetCols();
        const _devOn = _hCols.find(c => c.key === 'device' && c.vis);
        qs = `?from=${from}&to=${to}&level=${hierLevel}`;
        if (_devOn)  qs += '&with_device=1';
        if (media)   qs += `&media=${media}`;
        endpoint = `/accounts/${currentAccount.id}/raw-hierarchy`;
      } else {
        const breakdown = _rdGetBreakdown();
        qs = `?from=${from}&to=${to}&breakdown=${breakdown}`;
        if(media) qs+=`&media=${media}`;
        endpoint = `/accounts/${currentAccount.id}/raw-metrics`;
      }
      const res=await DEEPFLE_API.get(`${endpoint}${qs}`);
      rows=res.rows||[];
    } catch(e) { showToast('데이터 조회 실패: '+e.message,'error'); }
  }
  // backend manual_metrics 병합 (신규 시스템 우선)
  const _mmMediaSet = new Set();
  if (currentAccount && DEEPFLE_API.live) {
    try {
      let mmQs = `?from=${from}&to=${to}`;
      if (media) mmQs += `&media=${encodeURIComponent(media)}`;
      const mmRes = await DEEPFLE_API.get(`/accounts/${currentAccount.id}/manual-metrics${mmQs}`);
      const mmRows = (mmRes.rows || []).map(r => {
        _mmMediaSet.add(r.media);
        return {
          date: r.date, media: r.media,
          campaign: r.campaign||'', adgroup: r.adgroup||'',
          keyword: r.keyword||'', creative: r.creative||'',
          campaign_type: r.campaign_type||'', device: r.device||'',
          cost: r.cost||0, imp: r.imp||0, click: r.click||0,
          conv: (r.conv_native||0)+(r.conv_ga4||0)+(r.conv_mmp||0)+(r.conv_manual||0),
          conv_native: r.conv_native||0, conv_ga4: r.conv_ga4||0,
          conv_mmp: r.conv_mmp||0, conv_manual: r.conv_manual||0,
        };
      });
      rows = [...rows, ...mmRows];
    } catch(e) {}
  }
  // 수기 매체 데이터 병합 (localStorage 레거시, 백엔드에 없는 매체만)
  const _rdManualRows = _getManualMediaRawRows(from, to, media)
    .filter(r => !_mmMediaSet.has(r.media));
  rows = [...rows, ..._rdManualRows];
  _rdRows=rows;
  _rdSortKey='date'; _rdSortAsc=true;
  _rdRenderTable(_rdGetBreakdown());
}

// ── 테이블 렌더 ─────────────────────────────────────────────────────────────
function _rdRenderTable(breakdown) {
  const result=document.getElementById('rdResult');
  if(!result) return;
  const rows=_rdRows;
  const visCol=(_rdGetCols()).filter(c=>c.vis);
  if(!rows.length){
    result.innerHTML='<div class="card" style="padding:60px;text-align:center;color:var(--gray-400);"><div style="font-size:32px;margin-bottom:12px;">📋</div><div style="font-size:14px;">조회 버튼을 눌러 데이터를 불러오세요.</div><div style="font-size:12px;margin-top:6px;">기간·매체·세부기준을 설정한 후 조회하세요.</div></div>';
    return;
  }
  // 정렬
  const sorted=[...rows].sort((a,b)=>{
    let va=_rdCellVal({key:_rdSortKey,fmt:'S'},a);
    let vb=_rdCellVal({key:_rdSortKey,fmt:'S'},b);
    if(typeof va==='string') return _rdSortAsc?va.localeCompare(vb):vb.localeCompare(va);
    return _rdSortAsc?va-vb:vb-va;
  });
  const MAX=1500, disp=sorted.slice(0,MAX), hasMore=sorted.length>MAX;
  // 합계행
  const sumRow={};
  ['cost','imp','click','conv'].forEach(k=>{ sumRow[k]=rows.reduce((s,r)=>s+(r[k]||0),0); });
  const thCells=visCol.map(c=>`<th class="${c.type==='metric'?'text-right':''}" style="cursor:pointer;white-space:nowrap;user-select:none;" onclick="rdSort('${c.key}')">${c.label}${_rdSortKey===c.key?(_rdSortAsc?' ▲':' ▼'):''}</th>`).join('');
  let _sumDimSeen=false;
  const sumCells=visCol.map(c=>{
    if(c.type==='dim'){const s=!_sumDimSeen?(_sumDimSeen=true,'합계'):'';return `<td style="font-weight:700;">${s}</td>`;}
    const v=_rdFmtDisp(c,sumRow);
    return `<td class="text-right" style="font-weight:700;">${typeof v==='string'&&v.endsWith('%')?'-':v}</td>`;
  }).join('');
  const dataRows=disp.map(row=>`<tr>${visCol.map(c=>`<td class="${c.type==='metric'?'text-right num':''}">${_rdFmtDisp(c,row)}</td>`).join('')}</tr>`).join('');
  const notice=hasMore?`<div style="padding:8px 16px;font-size:11px;color:var(--gray-500);background:#FFFBEB;border-top:1px solid #FCD34D;">총 ${rows.length.toLocaleString()}행 중 ${MAX.toLocaleString()}행 표시 — CSV 다운로드로 전체 수신 가능</div>`:'';
  result.innerHTML=`
    <div class="card">
      <div class="card-header">
        <div><div class="card-title">Raw Data</div><div class="card-sub">총 ${rows.length.toLocaleString()}행</div></div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-sm btn-outline" onclick="rdCopyClipboard()">📋 클립보드 복사</button>
          <button class="btn btn-sm" style="background:#059669;color:#fff;" onclick="rdDownloadCSV()">⬇ CSV 다운로드</button>
        </div>
      </div>
      ${notice}
      <div style="overflow-x:auto;max-height:600px;overflow-y:auto;">
        <table class="data-table" style="width:100%;font-size:12px;white-space:nowrap;">
          <thead style="position:sticky;top:0;z-index:2;background:var(--surface);"><tr>${thCells}</tr></thead>
          <tbody>${dataRows}<tr style="background:var(--gray-50);">${sumCells}</tr></tbody>
        </table>
      </div>
    </div>`;
}
function rdSort(key){
  if(_rdSortKey===key) _rdSortAsc=!_rdSortAsc;
  else { _rdSortKey=key; _rdSortAsc=true; }
  _rdRenderTable(_rdGetBreakdown());
}

// ── CSV 다운로드 ─────────────────────────────────────────────────────────────
function rdDownloadCSV(){
  const _now = Date.now();
  if (rdDownloadCSV._t && _now - rdDownloadCSV._t < 800) return;
  rdDownloadCSV._t = _now;
  const rows=_rdRows;
  if(!rows||!rows.length){ showToast('먼저 데이터를 조회하세요','warning'); return; }
  const visCol=(_rdGetCols()).filter(c=>c.vis);
  // 계정 메타 정보
  let accMeta = {};
  if (currentAccount) { try { accMeta=JSON.parse(localStorage.getItem('deepfle_acct_meta_'+currentAccount.id)||'{}'); } catch(e){} }
  const _esc = v => (typeof v==='string'&&(v.includes(',')||v.includes('"'))) ? `"${v.replace(/"/g,'""')}"` : String(v||'');
  const accName=_esc(currentAccount?.name||''), accInd=_esc(accMeta.industry||''), accCat=_esc(accMeta.category||'');
  // 헤더: 계정명·업종·카테고리 컬럼 앞에 추가
  const header=['계정명','업종','카테고리',...visCol.map(c=>c.label)].join(',');
  // 각 행에 계정 정보 3컬럼 앞에 추가
  const body=rows.map(r=>[accName,accInd,accCat,...visCol.map(c=>_rdFmtCSV(c,r))].join(',')).join('\n');
  const csv='﻿'+header+'\n'+body;
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  const from=document.getElementById('rdFrom')?.value||'';
  const to=document.getElementById('rdTo')?.value||'';
  a.href=url; a.download=`raw_${from}_${to}.csv`;
  a.style.display='none';
  document.body.appendChild(a);
  a.dispatchEvent(new MouseEvent('click',{view:window,bubbles:false,cancelable:true}));
  setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); },150);
  showToast(`CSV 다운로드 완료 (${rows.length.toLocaleString()}행)`,'success');
  logActivity('Raw Download CSV 다운로드');
}


// ============================================================
// RAW UPLOAD PANEL
// ============================================================
let _ruTab = 'api';
let _ruFrom = '';
let _ruTo   = '';

async function renderRawUpload() {
  const el = document.getElementById('rawUploadBody');
  if (!el) return;
  if (DEEPFLE_API.live && currentAccount) await loadBackendMedia(currentAccount.id);
  const today = new Date().toISOString().slice(0,10);
  const d30   = new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  if (!_ruFrom) _ruFrom = window._globalFrom || d30;
  if (!_ruTo)   _ruTo   = window._globalTo   || today;

  el.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header" style="flex-wrap:wrap;gap:8px;">
        <div><div class="card-title">컬럼 설정</div><div class="card-sub">Raw 다운로드에 표시할 컬럼 순서 및 표시 여부를 관리합니다</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-sm btn-outline" onclick="rdResetCols()">초기화</button>
          <button class="btn btn-sm btn-outline" onclick="rdSavePreset()" style="font-size:11px;">+ 프리셋 저장</button>
        </div>
      </div>
      <div style="font-size:11px;color:var(--gray-400);margin-bottom:8px;">드래그로 순서 변경 · 체크박스로 표시/숨기기</div>
      <div id="rdColList" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
      <div style="margin-top:10px;border-top:1px solid var(--gray-100);padding-top:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span style="font-size:11px;color:var(--gray-500);">프리셋:</span>
        <div id="rdPresetList" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;flex:1;min-height:24px;"></div>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header" style="flex-wrap:wrap;gap:8px;">
        <div><div class="card-title">조회 기간</div><div class="card-sub">API 매체 미리보기 및 수기 매체 업로드 범위</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px;">
        <input type="date" id="ruFrom" class="form-select" value="${_ruFrom}" style="height:36px;font-size:12px;">
        <span style="color:var(--gray-400);font-size:13px;">~</span>
        <input type="date" id="ruTo" class="form-select" value="${_ruTo}" style="height:36px;font-size:12px;">
        <button class="btn btn-primary btn-sm" onclick="_ruApplyDate()">적용</button>
      </div>
    </div>
    <div class="tab-pills" style="margin-bottom:16px;">
      <div class="tab-pill${_ruTab==='api'?' active':''}" onclick="_ruSwitchTab('api')">API 연결 매체</div>
      <div class="tab-pill${_ruTab==='manual'?' active':''}" onclick="_ruSwitchTab('manual')">수기 매체 업로드</div>
    </div>
    <div id="ruApiSection" style="display:${_ruTab==='api'?'block':'none'};">
      <div id="ruApiBody"><div style="padding:40px;text-align:center;color:var(--gray-400);font-size:13px;">기간을 선택하고 <b>적용</b>을 눌러 데이터를 불러오세요.</div></div>
    </div>
    <input type="file" id="ruFileInput" accept=".csv" style="display:none;" onchange="_ruHandleFile(this)">
    <div id="ruManualSection" style="display:${_ruTab==='manual'?'block':'none'};">
      <div id="ruManualBody"></div>
    </div>`;

  _rdRenderColList();
  _rdRenderPresets();
  if (_ruTab === 'api') _ruLoadApiData();
  else _ruRenderManualSection();
}

function _ruApplyDate() {
  _ruFrom = document.getElementById('ruFrom').value || _ruFrom;
  _ruTo   = document.getElementById('ruTo').value   || _ruTo;
  if (_ruTab === 'api') _ruLoadApiData();
  else _ruRenderManualSection();
}

function _ruSwitchTab(tab) {
  _ruTab = tab;
  renderRawUpload();
}

async function _ruLoadApiData() {
  const el = document.getElementById('ruApiBody');
  if (!el) return;
  el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--gray-400);">데이터 로드 중...</div>';
  let rows = [];
  if (currentAccount && DEEPFLE_API.live) {
    try {
      const res = await DEEPFLE_API.get(`/accounts/${currentAccount.id}/raw-metrics?from=${_ruFrom}&to=${_ruTo}`);
      rows = (res.rows || []).map(r => ({
        date: r.date, media: r.media_key || r.media,
        cost: r.cost||0, imp: r.imp||0, click: r.click||0,
        conv_native: r.conv_native||0, conv_ga4: r.conv_ga4||0,
        conv_mmp: r.conv_mmp||0, conv_manual: r.conv_manual||0,
      }));
    } catch(e) {
      el.innerHTML = `<div class="card" style="padding:20px;color:var(--red-600);">데이터 조회 실패: ${e.message}</div>`;
      return;
    }
  }
  if (!rows.length) {
    el.innerHTML = '<div class="card" style="padding:40px;text-align:center;color:var(--gray-400);"><div style="font-size:32px;margin-bottom:12px;">📊</div><div>해당 기간 API 연결 매체 데이터가 없습니다.</div></div>';
    return;
  }
  const cols = ['date','media','campaign','adgroup','keyword','creative','campaign_type','device','cost','imp','click','conv_native','conv_ga4','conv_mmp','conv_manual'];
  const colLabels = {date:'날짜',media:'매체',campaign:'캠페인',adgroup:'광고그룹',keyword:'키워드',creative:'소재',campaign_type:'상품유형',device:'디바이스',cost:'광고비',imp:'노출수',click:'클릭수',conv_native:'전환(매체픽셀)',conv_ga4:'전환(GA4)',conv_mmp:'전환(MMP)',conv_manual:'전환(수기)'};
  const ths = cols.map(c=>`<th style="white-space:nowrap;font-size:11px;">${colLabels[c]||c}</th>`).join('');
  const trs = rows.slice(0,1000).map(row=>`<tr>${cols.map(c=>{
    const v = row[c]!=null?row[c]:'';
    const isNum = ['cost','imp','click','conv_native','conv_ga4','conv_mmp','conv_manual'].includes(c);
    return `<td class="${isNum?'text-right num':''}" style="font-size:12px;">${isNum&&typeof v==='number'?v.toLocaleString():v}</td>`;
  }).join('')}</tr>`).join('');
  el.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div><div class="card-title">API 연결 매체 데이터</div><div class="card-sub">총 ${rows.length.toLocaleString()}행 · Raw 다운로드와 동일한 컬럼 순서</div></div>
      </div>
      <div style="overflow-x:auto;max-height:560px;overflow-y:auto;">
        <table class="data-table" style="font-size:12px;white-space:nowrap;width:100%;">
          <thead style="position:sticky;top:0;background:var(--surface);z-index:2;"><tr>${ths}</tr></thead>
          <tbody>${trs}</tbody>
        </table>
      </div>
    </div>`;
}

function _ruRenderManualSection() {
  const el = document.getElementById('ruManualBody');
  if (!el) return;
  if (!MANUAL_MEDIA.length) {
    el.innerHTML = '<div class="card" style="padding:40px;text-align:center;color:var(--gray-400);"><div style="font-size:32px;margin-bottom:12px;">📤</div><div>등록된 수기 매체가 없습니다.</div><div style="font-size:12px;margin-top:6px;">설정 &gt; 매체 연동에서 수기 매체를 먼저 추가하세요.</div></div>';
    return;
  }
  const mediaNames = MANUAL_MEDIA.map(m =>
    `<span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:7px;height:7px;border-radius:50%;background:${m.color||'#64748B'};display:inline-block;"></span>${m.name}</span>`
  ).join(' · ');
  const statusCards = MANUAL_MEDIA.map(m =>
    `<div class="card" style="margin-bottom:8px;padding:12px 16px;">
       <div style="display:flex;align-items:center;gap:8px;">
         <div style="width:9px;height:9px;border-radius:50%;background:${m.color||'#64748B'};flex-shrink:0;"></div>
         <span style="font-size:13px;font-weight:600;">${m.name}</span>
         <span style="font-size:11px;color:var(--gray-400);">수기 등록 매체</span>
       </div>
       <div id="ruMediaStatus_${m.id}" style="margin-top:6px;font-size:12px;color:var(--gray-500);">조회 기간을 적용하면 업로드 현황이 표시됩니다.</div>
     </div>`
  ).join('');
  el.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header" style="flex-wrap:wrap;gap:8px;">
        <div>
          <div class="card-title">수기 매체 업로드</div>
          <div class="card-sub">등록된 수기 매체 ${MANUAL_MEDIA.length}개 · 1개의 통합 CSV로 일괄 업로드</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button type="button" id="btnRuTpl" class="btn btn-sm btn-outline">CSV 템플릿</button>
          <button type="button" id="btnRuUp"  class="btn btn-sm btn-primary">CSV 업로드</button>
        </div>
      </div>
      <div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:6px;padding:9px 13px;font-size:12px;color:#0369A1;margin-top:10px;line-height:1.6;">
        💡 통합 템플릿에는 등록된 모든 수기 매체의 예시 행이 포함됩니다. 날짜와 데이터를 입력 후 업로드하면 매체별로 자동 분류·저장됩니다.<br>
        <span style="opacity:.8;">컬럼: 날짜, 매체, 캠페인, 광고그룹, 키워드, 소재, 상품유형, 디바이스, 광고비, 노출수, 클릭수, 전환_매체픽셀, 전환_GA4, 전환_MMP, 전환_수기</span><br>
        <span style="opacity:.8;">등록 매체: ${mediaNames}</span>
      </div>
    </div>
    ${statusCards}`;

  const tplBtn = document.getElementById('btnRuTpl');
  const upBtn  = document.getElementById('btnRuUp');
  if (tplBtn) tplBtn.onclick = function(e) {
    e.preventDefault(); e.stopPropagation();
    _ruDownloadUnifiedTemplate();
  };
  if (upBtn) upBtn.onclick = function(e) {
    e.preventDefault(); e.stopPropagation();
    const fi = document.getElementById('ruFileInput');
    if (fi) {
      fi.value = '';
      fi.dispatchEvent(new MouseEvent('click', {view: window, bubbles: false, cancelable: true}));
    }
  };

  if (_ruFrom && _ruTo) MANUAL_MEDIA.forEach(m => _ruLoadMediaPreview(m.id, m.name));
}

function _ruDownloadUnifiedTemplate() {
  const _now = Date.now();
  if (_ruDownloadUnifiedTemplate._t && _now - _ruDownloadUnifiedTemplate._t < 800) return;
  _ruDownloadUnifiedTemplate._t = _now;
  const cols = '날짜,매체,캠페인,광고그룹,키워드,소재,상품유형,디바이스,광고비,노출수,클릭수,전환_매체픽셀,전환_GA4,전환_MMP,전환_수기';
  const d = _ruFrom || new Date().toISOString().slice(0,10);
  const rows = MANUAL_MEDIA.map(m => `${d},${m.name},,,,,,,0,0,0,0,0,0,0`).join('\n');
  const csv = '﻿' + cols + '\n' + rows;
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `manual_template_통합_${d}.csv`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.dispatchEvent(new MouseEvent('click', {view: window, bubbles: false, cancelable: true}));
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 150);
  showToast(`통합 CSV 템플릿 다운로드됨 (${MANUAL_MEDIA.length}개 매체)`, 'success');
}

let _ruTargetName = '';

async function _ruHandleFile(input) {
  const file = input.files[0];
  if (!file) return;
  const text = await file.text();
  const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').filter(l=>l.trim());
  if (lines.length < 2) { showToast('데이터 행이 없습니다','warning'); return; }
  const rawHdr = lines[0].replace(/^[\ufeff\uFEFF]+/,'');
  const _COL_KR = {'날짜':'date','매체':'media','캠페인':'campaign','광고그룹':'adgroup',
    '키워드':'keyword','소재':'creative','상품유형':'campaign_type','디바이스':'device',
    '광고비':'cost','노출수':'imp','클릭수':'click',
    '전환_매체픽셀':'conv_native','전환_ga4':'conv_ga4','전환_mmp':'conv_mmp','전환_수기':'conv_manual',
    '전환(매체픽셀)':'conv_native','전환(ga4)':'conv_ga4','전환(mmp)':'conv_mmp','전환(수기)':'conv_manual',
    'conv_nativ':'conv_native','conv_mm':'conv_mmp',
    'imp':'imp','click':'click','cost':'cost','conv_native':'conv_native',
    'conv_ga4':'conv_ga4','conv_mmp':'conv_mmp','conv_manual':'conv_manual'};
  function _parseCSV(line) {
    const c=[]; let cur='', inQ=false;
    for (let i=0;i<line.length;i++) {
      const ch=line[i];
      if (ch==='"') { if (inQ&&line[i+1]==='"'){cur+='"';i++;}else inQ=!inQ; }
      else if (ch===','&&!inQ) { c.push(cur); cur=''; }
      else cur+=ch;
    } c.push(cur); return c;
  }
  const headers = _parseCSV(rawHdr).map(h=>{
    const k = (h.trim().normalize ? h.trim().normalize('NFC') : h.trim());
    return _COL_KR[k]||_COL_KR[k.toLowerCase()]||k.toLowerCase();
  });
  const colIdx = {};
  headers.forEach((h,i)=>{ colIdx[h]=i; });
  if (colIdx['date'] === undefined) { showToast('필수 컬럼 "date"가 없습니다','error'); return; }
  const rows = [];
  for (let i=1; i<lines.length; i++) {
    const cells = _parseCSV(lines[i]);
    const get    = (k,def='') => (colIdx[k]!==undefined?(cells[colIdx[k]]||'').trim():def);
    const getNum = k => parseFloat((get(k,'0')||'0').replace(/,/g,''))||0;
    rows.push({ date:get('date'), media:get('media'), campaign:get('campaign'), adgroup:get('adgroup'), keyword:get('keyword'), creative:get('creative'), campaign_type:get('campaign_type'), device:get('device'), cost:getNum('cost'), imp:getNum('imp'), click:getNum('click'), conv_native:getNum('conv_native'), conv_ga4:getNum('conv_ga4'), conv_mmp:getNum('conv_mmp'), conv_manual:getNum('conv_manual') });
  }
  if (!rows.length) { showToast('유효한 행이 없습니다','warning'); return; }
  if (!currentAccount || !DEEPFLE_API.live) { showToast('백엔드 연결이 필요합니다','error'); return; }
  try {
    const res = await DEEPFLE_API.post(`/accounts/${currentAccount.id}/manual-metrics`, {rows});
    showToast(`${res.inserted}행 업로드 완료`, 'success');
    logActivity(`수기 매체 CSV ${res.inserted}행 업로드 완료`);
    MANUAL_MEDIA.forEach(m => _ruLoadMediaPreview(m.id, m.name));
  } catch(e) { showToast('업로드 실패: '+e.message,'error'); }
}

async function _ruLoadMediaPreview(mediaId, mediaName) {
  const el = document.getElementById(`ruMediaStatus_${mediaId}`);
  if (!el || !currentAccount || !DEEPFLE_API.live) return;
  try {
    const qs = `?from=${_ruFrom}&to=${_ruTo}&media=${encodeURIComponent(mediaName)}`;
    const res = await DEEPFLE_API.get(`/accounts/${currentAccount.id}/manual-metrics${qs}`);
    const rows = res.rows || [];
    if (!rows.length) {
      el.innerHTML = '<span style="color:var(--gray-400);">해당 기간 업로드된 데이터가 없습니다.</span>';
    } else {
      const tc = rows.reduce((s,r)=>s+(r.cost||0),0);
      const ti = rows.reduce((s,r)=>s+(r.imp||0),0);
      const tk = rows.reduce((s,r)=>s+(r.click||0),0);
      const sn = mediaName.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      el.innerHTML = `<span style="color:#059669;">&#10003; ${rows.length}행 업로드됨</span> · 광고비 ${tc.toLocaleString()}원 · 노출 ${ti.toLocaleString()} · 클릭 ${tk.toLocaleString()} <button class="btn btn-sm" style="margin-left:10px;font-size:11px;background:#DC2626;color:#fff;" onclick="_ruDeletePeriodData('${sn}')">이 기간 삭제</button>`;
    }
  } catch(e) { el.innerHTML = `<span style="color:var(--red-500);">조회 실패: ${e.message}</span>`; }
}

async function _ruDeletePeriodData(mediaName) {
  if (!confirm(`"${mediaName}" ${_ruFrom}~${_ruTo} 기간 업로드 데이터를 삭제하시겠습니까?`)) return;
  try {
    const qs = `?from=${_ruFrom}&to=${_ruTo}&media=${encodeURIComponent(mediaName)}`;
    await DEEPFLE_API.delete(`/accounts/${currentAccount.id}/manual-metrics${qs}`);
    showToast('삭제됨','success');
    const m = MANUAL_MEDIA.find(x=>x.name===mediaName);
    if (m) _ruLoadMediaPreview(m.id, m.name);
  } catch(e) { showToast('삭제 실패: '+e.message,'error'); }
}

// ── 패널 렌더 ────────────────────────────────────────────────────────────────
async function renderRawDownload(){
  const el=document.getElementById('rawDownloadBody');
  if(!el) return;
  // 최신 매체 상태 반영
  if (DEEPFLE_API.live && currentAccount) await loadBackendMedia(currentAccount.id);
  // 날짜: 활성 프리셋 > 글로벌 날짜 > 기본값(최근 30일)
  const p = _rdActivePreset;
  const from = (p?.from) || window._globalFrom || new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  const to   = (p?.to)   || window._globalTo   || new Date().toISOString().slice(0,10);
  // 매체 드롭다운: MEDIA_DATA(is_on) 우선, ad_accounts로 보완 (자격증명 저장 직후도 반영)
  const rdMediaMap = new Map();
  MEDIA_DATA.filter(m=>m.on).forEach(m => rdMediaMap.set(m.key||m.name, {key:m.key||'', label:MEDIA_LABELS[m.key]||m.name}));
  if (DEEPFLE_API.live && currentWorkspace) {
    try {
      const res = await DEEPFLE_API.get(`/workspaces/${currentWorkspace.id}/ad-accounts`);
      (res.adAccounts||[]).filter(a=>a.status==='connected').forEach(a => {
        if (!rdMediaMap.has(a.media)) rdMediaMap.set(a.media, {key:a.media, label:MEDIA_LABELS[a.media]||a.media});
      });
    } catch(e) {}
  }
  // 수기 매체도 드롭다운에 추가
  MANUAL_MEDIA.forEach(m => {
    if (!rdMediaMap.has('manual_'+m.id)) rdMediaMap.set('manual_'+m.id, {key:m.name, label:m.name+' (수기)'});
  });
  const _rdMediaList = [...rdMediaMap.values()];
  const mkOpts='<option value="">전체 매체</option>'+_rdMediaList.map(m=>`<option value="${m.key}">${m.label}</option>`).join('');

  el.innerHTML=`
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header" style="flex-wrap:wrap;gap:8px;">
        <div><div class="card-title">조회 조건</div><div class="card-sub">기간·매체를 설정하고 조회하세요</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" onclick="fetchRawData()">조회</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-top:14px;">
        <div>
          <div style="font-size:11px;color:var(--gray-500);margin-bottom:4px;font-weight:500;">시작일</div>
          <input type="date" id="rdFrom" class="form-select" value="${from}" style="height:36px;font-size:12px;">
        </div>
        <div>
          <div style="font-size:11px;color:var(--gray-500);margin-bottom:4px;font-weight:500;">종료일</div>
          <input type="date" id="rdTo" class="form-select" value="${to}" style="height:36px;font-size:12px;">
        </div>
        <div>
          <div style="font-size:11px;color:var(--gray-500);margin-bottom:4px;font-weight:500;">매체</div>
          <select id="rdMedia" class="form-select" style="height:36px;font-size:12px;">${mkOpts}</select>
        </div>
      </div>
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--gray-100);font-size:11px;color:var(--gray-400);">
        💡 컬럼 순서·표시 설정은 <span style="color:var(--primary-600);font-weight:600;cursor:pointer;" onclick="showPanel('raw-upload',document.getElementById('nav-raw-upload'))">Raw 업로드</span>에서 관리합니다
      </div>
    </div>
    <div id="rdResult"></div>`;
  // 프리셋 매체 선택 복원
  if (p?.media) { const rdMedia=document.getElementById('rdMedia'); if(rdMedia) rdMedia.value=p.media; }
}
const STATUS_BADGE = {connected:'badge-green', error:'badge-red', pending:'badge-orange', disconnected:'badge-gray'};
const STATUS_LABEL = {connected:'연결됨', error:'오류', pending:'대기중', disconnected:'해제됨'};

async function renderConnections() {
  if (!currentWorkspace || !DEEPFLE_API.live) {
    document.getElementById('connBody').innerHTML =
      '<div class="readonly-banner"><span class="readonly-banner-icon">ℹ️</span><span>연결 관리는 백엔드 연결 + 워크스페이스 컨텍스트에서 동작합니다.</span></div>';
    return;
  }
  const wsId = currentWorkspace.id;
  try {
    const [adRes, intRes] = await Promise.all([
      DEEPFLE_API.get(`/workspaces/${wsId}/ad-accounts`),
      DEEPFLE_API.get(`/workspaces/${wsId}/integrations`),
    ]);
    const canEdit = adRes.canEdit;
    const adRows = adRes.adAccounts.map(a => `
      <div class="media-connected-card">
        <div class="media-logo-box" style="background:${(MEDIA_META[a.media]||{}).color||'#64748B'};color:#fff;">${(MEDIA_LABELS[a.media]||a.media)[0]}</div>
        <div class="media-conn-info">
          <div class="media-conn-name">${MEDIA_LABELS[a.media]||a.media} · ${a.account_name||''} <span class="badge ${STATUS_BADGE[a.status]}">${STATUS_LABEL[a.status]}</span></div>
          <div class="media-conn-meta">${a.account_label?`광고주: ${a.account_label} · `:''}외부ID: ${a.external_id||'-'} · 동기화 ${a.last_sync?a.last_sync.slice(5,16):'-'}</div>
        </div>
        ${canEdit ? (a.status==='disconnected'
          ? `<button class="btn btn-sm btn-primary" onclick="setAdAccountStatus(${a.id},'connected')">재연결</button>`
          : `<button class="btn btn-sm btn-danger-outline" onclick="setAdAccountStatus(${a.id},'disconnected')">연결 해제</button>`) : ''}
      </div>`).join('');
    const intRows = intRes.integrations.map(i => `
      <div class="media-connected-card">
        <div class="media-logo-box" style="background:#0F172A;color:#fff;font-size:13px;">${(INTEG_LABELS[i.type]||i.type)[0]}</div>
        <div class="media-conn-info">
          <div class="media-conn-name">${INTEG_LABELS[i.type]||i.type} <span class="badge ${STATUS_BADGE[i.status]}">${STATUS_LABEL[i.status]}</span></div>
          <div class="media-conn-meta">${i.name||''}</div>
        </div>
      </div>`).join('');
    document.getElementById('connBody').innerHTML = `
      <div id="connectorMatrixConn"></div>
      <div id="metaConnectorStatus"></div>
      <div class="card" style="margin-bottom:16px;">
        <div class="card-header">
          <div><div class="card-title">매체 광고계정 연결</div><div class="card-sub">${currentWorkspace.name} · ${adRes.adAccounts.length}개</div></div>
          ${canEdit?`<button class="btn btn-primary btn-sm" onclick="showConnectAdAccount()">+ 광고계정 연결</button>`:''}
        </div>
        ${adRows || '<div class="empty"><div class="empty-icon">🔌</div>연결된 광고계정이 없습니다</div>'}
      </div>
      <div class="card">
        <div class="card-header">
          <div><div class="card-title">외부 데이터 연동</div><div class="card-sub">GA4 · Cafe24 · MMP</div></div>
        </div>
        ${intRows || '<div class="empty">연동이 없습니다</div>'}
      </div>`;
    renderConnectorMatrix('connectorMatrixConn');  // R2+: 전 매체 커넥터 도달성 매트릭스
    renderMetaConnector(adRes.canEdit);            // R2: 메타 실 API 상태
  } catch(e) {
    document.getElementById('connBody').innerHTML = `<div class="readonly-banner">불러오기 실패: ${e.message}</div>`;
  }
}

// R2+: 지원 매체 커넥터 매트릭스 (실제 API 도달성 + 자격증명 관리)
let _savedCredMedias = new Set();  // 자격증명이 저장된 매체 키 집합

async function renderConnectorMatrix(targetId = 'connectorMatrix') {
  const el = document.getElementById(targetId);
  if (!el) return;
  // mock 모드: 백엔드 없으면 안내만 표시
  if (!DEEPFLE_API.live) {
    el.innerHTML = `<div class="card" style="margin-bottom:16px;"><div class="card-sub">🔌 매체 커넥터 & API 키 관리는 백엔드 연결 시 사용 가능합니다.<br><span style="font-size:11px;color:var(--gray-400);">서버 실행 후 로그인하면 실 API 도달성 및 자격증명 관리를 이용할 수 있습니다.</span></div></div>`;
    return;
  }
  el.innerHTML = `<div class="card" style="margin-bottom:16px;"><div class="card-sub">전 매체 커넥터 실 API 도달성 검증 중… (실제 호출)</div></div>`;
  try {
    const [d, credData] = await Promise.all([
      DEEPFLE_API.get('/connectors/health-all'),
      currentAccount ? DEEPFLE_API.get(`/accounts/${currentAccount.id}/media-credentials`).catch(() => ({credentials:[]})) : Promise.resolve({credentials:[]}),
    ]);
    if (!d || !Array.isArray(d.results)) {
      el.innerHTML = `<div class="card" style="margin-bottom:16px;"><div class="card-sub">커넥터 데이터를 불러오지 못했습니다.</div></div>`;
      return;
    }
    _savedCredMedias = new Set((credData.credentials || []).map(c => c.media));
    const credMap = {};
    (credData.credentials || []).forEach(c => { credMap[c.media] = c; });

    const rMap = {};
    d.results.forEach(r => { rMap[r.media || r.key] = r; });

    const live = d.results.filter(r => r.tokenValid).length;
    const credConfigured = _savedCredMedias.size;
    const esc = s => String(s==null?'':s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const canEdit = CAN_EDIT(currentUser?.role);

    // 그룹 정의
    const CONN_GROUPS = [
      { label: '🔍 검색 광고', items: [
        { keys: ['naver_sa'] },
        { keys: ['kakao_sa'] },
      ]},
      { label: '📱 소셜 / SNS', items: [
        { keys: ['meta'] }, { keys: ['tiktok'] }, { keys: ['x_ads'] }, { keys: ['karrot'] },
      ]},
      { label: '🖥️ 디스플레이 / 네이티브', items: [
        { keys: ['naver_gfa'] }, { keys: ['google'] }, { keys: ['kakao'] }, { keys: ['pinterest'] },
        { keys: ['criteo'] }, { keys: ['taboola'] }, { keys: ['dable'] },
      ]},
      { label: '🛒 커머스 / 리타겟팅', items: [
        { keys: ['coupang'] },
      ]},
      { label: '📲 앱 / 모바일', items: [
        { keys: ['apple_sa'] }, { keys: ['inmobi'] }, { keys: ['moloco'] }, { keys: ['mobion'] }, { keys: ['buzzvil'] },
      ]},
    ];

    function renderTile(entry) {
      const credKey = entry.credKey || entry.keys[0];
      const primary = rMap[credKey] || rMap[entry.keys[0]] || {};
      const ok = entry.keys.some(k => rMap[k]?.reachable);
      const tokenValid = entry.keys.some(k => rMap[k]?.tokenValid);
      const displayLabel = entry.label || primary.label || MEDIA_LABELS[credKey] || credKey;
      const hasCred = _savedCredMedias.has(credKey);
      const credInfo = credMap[credKey];
      // 인증됨은 API 키가 등록되어 있고 실제 토큰 검증이 된 경우만 표시
      const statusBadge = (hasCred && tokenValid)
        ? `<span class="badge badge-green" style="font-size:10px;white-space:nowrap;">🟢 인증됨</span>`
        : hasCred
          ? `<span class="badge badge-orange" style="font-size:10px;white-space:nowrap;">🔑 키 등록</span>`
          : (ok ? `<span class="badge" style="font-size:10px;white-space:nowrap;background:#F1F5F9;color:#64748B;">API 연결 가능</span>`
                : `<span class="badge" style="font-size:10px;white-space:nowrap;background:#FFF7ED;color:#92400E;">도달 불가</span>`);
      const credBadge = hasCred
        ? `<span style="font-size:9px;color:#059669;background:#DCFCE7;padding:1px 6px;border-radius:8px;white-space:nowrap;">🔑 키 등록됨</span>`
        : `<span style="font-size:9px;color:#64748B;background:#F1F5F9;padding:1px 6px;border-radius:8px;white-space:nowrap;">미설정</span>`;
      const bg = hasCred ? '#F0FDF4' : '#fff';
      const border = hasCred ? '#86EFAC' : 'var(--gray-200)';
      const updatedAt = hasCred && credInfo ? `<div style="font-size:9px;color:var(--gray-400);">업데이트: ${credInfo.updated_at?.slice(0,10)||'-'}</div>` : '';
      const keyBtn = canEdit
        ? `<button onclick="openCredModal('${esc(credKey)}')" style="font-size:10px;padding:2px 8px;border:1px solid var(--gray-300);border-radius:6px;background:#fff;cursor:pointer;white-space:nowrap;margin-top:auto;">${hasCred ? '🔑 키 수정' : '🔑 API 키 설정'}</button>`
        : '';
      return `<div title="${esc(primary.apiMessage||'')}" style="border:1px solid ${border};border-radius:9px;padding:11px 12px;background:${bg};min-height:100px;display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:4px;">
          <span style="font-size:11px;font-weight:700;line-height:1.3;flex:1;">${esc(displayLabel)}</span>
          ${statusBadge}
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;">${credBadge}</div>
        ${updatedAt}
        <div style="font-size:9px;color:var(--gray-400);">${esc(primary.region||'')} · ${esc(primary.category||'-')}</div>
        ${keyBtn}
      </div>`;
    }

    // 아코디언 토글 함수 (전역)
    window._toggleConnGroup = function(id) {
      const panel = document.getElementById(id);
      const arrow = document.getElementById(id + '_arrow');
      if (!panel) return;
      const open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : 'block';
      if (arrow) arrow.textContent = open ? '▶' : '▼';
    };

    let groupHtml = '';
    let gIdx = 0;
    for (const group of CONN_GROUPS) {
      const gId = `cg_${gIdx++}`;
      const tiles = group.items.map(entry => renderTile(entry)).join('');
      // 그룹 요약: 매체 수 + 키 등록 수
      const totalCount = group.items.length;
      const credCount = group.items.filter(e => _savedCredMedias.has(e.credKey || e.keys[0])).length;
      const reachCount = group.items.filter(e => e.keys.some(k => rMap[k]?.reachable)).length;
      const credSummary = credCount > 0
        ? `<span style="font-size:11px;color:#059669;font-weight:600;">🔑 ${credCount}개 등록</span>`
        : `<span style="font-size:11px;color:var(--gray-400);">${totalCount}개 매체</span>`;
      const reachSummary = `<span style="font-size:11px;color:var(--gray-500);">도달 ${reachCount}/${totalCount}</span>`;

      groupHtml += `<div style="border:1px solid var(--gray-200);border-radius:10px;margin-bottom:8px;overflow:hidden;">
        <div onclick="_toggleConnGroup('${gId}')" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;cursor:pointer;background:var(--gray-50);user-select:none;">
          <span style="font-size:13px;font-weight:700;color:var(--gray-800);">${esc(group.label)}</span>
          <div style="display:flex;align-items:center;gap:12px;">
            ${credSummary}
            ${reachSummary}
            <span id="${gId}_arrow" style="font-size:11px;color:var(--gray-400);">▶</span>
          </div>
        </div>
        <div id="${gId}" style="display:none;padding:12px;background:#fff;">
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;align-items:stretch;">${tiles}</div>
        </div>
      </div>`;
    }

    el.innerHTML = `
      <div class="card" style="margin-bottom:16px;">
        <div class="card-header">
          <div>
            <div class="card-title">🔌 매체 커넥터 &amp; API 키 관리</div>
            <div class="card-sub">실 API 도달 <strong style="color:var(--success);">${d.reachable}/${d.total}</strong> · 인증됨 <strong style="color:#16A34A;">${live}개</strong> · API 키 등록 <strong style="color:#2563EB;">${credConfigured}개</strong></div>
          </div>
        </div>
        <div style="padding-top:4px;">${groupHtml}</div>
        <div style="font-size:11px;color:var(--gray-400);margin-top:4px;">💡 🔑 API 키 설정 버튼으로 매체별 자격증명을 등록하면 '지금 갱신' 시 실 API로 데이터를 가져옵니다.</div>
        ${canEdit ? `<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--gray-100);display:flex;align-items:center;gap:12px;">
          <span style="font-size:12px;color:var(--gray-500);">API 미지원 매체 또는 자체 집행 매체는 수기로 추가하고 데이터를 직접 입력합니다.</span>
          <button class="btn btn-sm btn-outline" style="white-space:nowrap;" onclick="showAddManualMediaForm()">+ 수기 매체 추가</button>
        </div>` : ''}
      </div>`;
  } catch(e) {
    el.innerHTML = `<div class="card" style="margin-bottom:16px;"><div class="card-sub">매트릭스 로드 실패: ${e.message}</div></div>`;
  }
}

// ── 자격증명 모달 ──
let _credModalMedia = null;
let _credModalFields = [];
let _credModalCredId = null;

async function openCredModal(mediaKey) {
  if (!currentAccount) { showToast('계정을 먼저 선택하세요', 'warning'); return; }
  _credModalMedia = mediaKey;
  const modal = document.getElementById('credModal');
  const title = document.getElementById('credModalTitle');
  const body = document.getElementById('credModalBody');
  if (!modal) return;
  title.textContent = '🔑 API 키 설정';
  body.innerHTML = '<div style="color:var(--gray-400);font-size:13px;padding:20px 0;">불러오는 중…</div>';
  modal.style.display = 'flex';

  try {
    const [fieldsData, credData] = await Promise.all([
      DEEPFLE_API.get(`/connectors/${mediaKey}/fields`),
      DEEPFLE_API.get(`/accounts/${currentAccount.id}/media-credentials`),
    ]);
    const savedEntry = (credData.credentials||[]).find(c => c.media === mediaKey);
    const savedCreds = savedEntry?.creds || {};
    _credModalCredId = savedEntry ? savedEntry.id : null;
    _credModalFields = fieldsData.fields || [];
    title.textContent = `🔑 ${fieldsData.label} — API 키 설정`;

    const authHint = {
      oauth: 'OAuth 2.0 인증 방식입니다. 매체 개발자 콘솔에서 Client ID/Secret을 발급받으세요.',
      apikey: 'API Key 인증 방식입니다. 매체 대시보드 또는 계정 매니저에게 API Key를 요청하세요.',
      signed: 'HMAC 서명 방식입니다. Access Key와 Secret Key 쌍이 필요합니다.',
    }[fieldsData.authType] || '매체 계정에서 API 자격증명을 발급받아 입력하세요.';

    const deleteBtn = document.getElementById('credDeleteBtn');
    if (deleteBtn) deleteBtn.style.display = _credModalCredId ? 'inline-block' : 'none';

    if (_credModalFields.length === 0) {
      body.innerHTML = `<div style="color:var(--gray-500);font-size:13px;padding:12px 0;">이 매체는 별도 API 키 설정이 필요하지 않습니다 (환경변수 사용).</div>`;
      return;
    }

    const notice = savedEntry
      ? `<div style="font-size:11px;color:#059669;background:#DCFCE7;border-radius:8px;padding:8px 12px;margin-bottom:14px;">✅ API 키가 등록되어 있습니다. 수정하려면 아래 필드를 변경 후 저장하세요.</div>`
      : `<div style="font-size:11px;color:#92400E;background:#FEF3C7;border-radius:8px;padding:8px 12px;margin-bottom:14px;">⚠ API 키가 아직 설정되지 않았습니다. 아래 정보를 입력해 저장하면 데이터 갱신 시 실 API가 사용됩니다.</div>`;

    const fields = _credModalFields.map(f => {
      const isSecret = f.type === 'password';
      const savedVal = (savedCreds[f.key] || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      const ph = savedVal ? '' : (f.placeholder || '');
      return `
      <div class="form-group" style="margin-bottom:10px;">
        <label class="form-label" style="font-size:12px;">${f.label}</label>
        <input class="form-input" id="credField_${f.key}"
          type="${f.type||'text'}"
          value="${savedVal}"
          placeholder="${ph}"
          autocomplete="${isSecret ? 'new-password' : 'off'}"
          readonly onfocus="this.removeAttribute('readonly')"
          style="height:34px;font-size:13px;">
      </div>`;
    }).join('');

    body.innerHTML = `
      <div style="font-size:11px;color:var(--gray-500);margin-bottom:12px;">${authHint}</div>
      ${notice}
      ${fields}
      <div style="font-size:10px;color:var(--gray-400);margin-top:4px;">⚠ 자격증명은 서버 DB에 저장됩니다. 운영 환경에서는 암호화 적용을 권장합니다.</div>`;

    // 비밀값은 빈칸으로 두고 placeholder로 안내 (보안상 기존값 복원 안함)
  } catch(e) {
    body.innerHTML = `<div style="color:var(--danger);font-size:13px;">로드 실패: ${e.message}</div>`;
  }
}

function closeCredModal() {
  const modal = document.getElementById('credModal');
  if (modal) modal.style.display = 'none';
  _credModalMedia = null;
  _credModalFields = [];
  _credModalCredId = null;
}

// 매체 연동 상태 변경 후 모든 관련 패널을 갱신한다
async function _refreshAllMediaPanels() {
  if (!currentAccount || !DEEPFLE_API.live) return;
  await loadBackendMedia(currentAccount.id);
  if (document.getElementById('panel-overview')?.classList.contains('active')) renderOverview();
  if (document.getElementById('panel-media-report')?.classList.contains('active')) renderMediaReport();
  if (document.getElementById('panel-raw-download')?.classList.contains('active')) renderRawDownload();
  if (document.getElementById('panel-settings')?.classList.contains('active')) renderSettings();
}

async function saveCredentials() {
  if (!_credModalMedia || !currentAccount) return;
  const creds = {};
  let hasValue = false;
  for (const f of _credModalFields) {
    const el = document.getElementById(`credField_${f.key}`);
    const val = el ? el.value.trim() : '';
    if (val) { creds[f.key] = val; hasValue = true; }
  }
  if (!hasValue) { showToast('최소 하나 이상의 자격증명을 입력하세요', 'warning'); return; }
  try {
    await DEEPFLE_API.post(`/accounts/${currentAccount.id}/media-credentials`, {media: _credModalMedia, creds});
    showToast(`${_credModalMedia} API 자격증명이 저장되었습니다`, 'success');
    closeCredModal();
    renderConnectorMatrix();
    _refreshAllMediaPanels();
  } catch(e) {
    showToast(`저장 실패: ${e.message}`, 'error');
  }
}

async function deleteCredentials() {
  if (!_credModalCredId) { showToast('삭제할 자격증명이 없습니다', 'warning'); return; }
  if (!confirm('저장된 API 자격증명을 삭제하시겠습니까?')) return;
  try {
    await DEEPFLE_API.del(`/media-credentials/${_credModalCredId}`);
    showToast('자격증명이 삭제되었습니다', 'success');
    closeCredModal();
    renderConnectorMatrix();
    _refreshAllMediaPanels();
  } catch(e) {
    showToast(`삭제 실패: ${e.message}`, 'error');
  }
}

// R2: 메타 실 API 커넥터 상태 + 동기화 UI
async function renderMetaConnector(canEdit) {
  const el = document.getElementById('metaConnectorStatus');
  if (!el) return;
  el.innerHTML = `<div class="card" style="margin-bottom:16px;"><div class="card-sub">메타 실 API 연결성 확인 중…</div></div>`;
  try {
    const s = await DEEPFLE_API.get('/connectors/meta/status');
    const reachBadge = s.reachable
      ? `<span class="badge badge-green">🟢 API 도달 가능</span>`
      : `<span class="badge badge-red">🔴 도달 불가</span>`;
    const tokenBadge = s.tokenValid
      ? `<span class="badge badge-green">토큰 유효 (실데이터)</span>`
      : `<span class="badge badge-orange">토큰 미설정 (fixture)</span>`;
    el.innerHTML = `
      <div class="card" style="margin-bottom:16px;border-left:3px solid #1877F2;">
        <div class="card-header">
          <div>
            <div class="card-title">🔵 Meta Marketing API 커넥터 <span style="font-size:11px;color:var(--gray-400);">${s.label} · ${s.graphVersion}</span></div>
            <div class="card-sub">실제 graph.facebook.com 호출 결과</div>
          </div>
          ${canEdit?`<button class="btn btn-primary btn-sm" onclick="syncMetaConnector()">⟳ 실 API 동기화</button>`:''}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">${reachBadge} ${tokenBadge}</div>
        <div style="font-size:12px;color:var(--gray-600);background:var(--gray-50);border-radius:8px;padding:10px 12px;font-family:monospace;">
          API 응답: ${s.apiMessage}
        </div>
        ${!s.tokenValid?`<div style="font-size:11px;color:var(--gray-400);margin-top:8px;">💡 유효한 META_ACCESS_TOKEN을 주입하면 실제 캠페인 데이터로 자동 전환됩니다. 현재는 데모 fixture를 사용합니다.</div>`:''}
      </div>`;
  } catch(e) {
    el.innerHTML = `<div class="card" style="margin-bottom:16px;"><div class="card-sub">커넥터 상태 로드 실패: ${e.message}</div></div>`;
  }
}

// R3: 계정의 전체 연결 매체 동기화 → 대시보드 매체 테이블 반영
async function syncAllConnectors() {
  if (!currentAccount || !DEEPFLE_API.live) { showToast('백엔드 연결이 필요합니다','warning'); return; }
  showToast('연결된 전 매체 동기화 중…','info');
  try {
    const r = await DEEPFLE_API.post(`/accounts/${currentAccount.id}/sync-connectors`,
      { ws_id: currentWorkspace?.id });
    const mode = r.usedFixture ? '데모 fixture 포함' : '실 데이터';
    showToast(`동기화 완료 — ${r.mediaCount}개 매체 · ${r.totalCampaigns}개 캠페인 (${mode})`,'success');
    await loadBackendMedia(currentAccount.id);
    renderOverview();
  } catch(e) {
    showToast(`동기화 실패: ${e.message}`, e.status===403?'error':'warning');
  }
}

async function syncMetaConnector() {
  showToast('메타 실 API 동기화 중…','info');
  try {
    const r = await DEEPFLE_API.post('/connectors/meta/sync', {
      ws_id: currentWorkspace.id,
      account_id: currentAccount?.id,
      ad_account_id: 'act_1029384756',
    });
    const mode = r.usedFixture ? '데모 fixture' : '실 캠페인 데이터';
    showToast(`동기화 완료 — ${r.campaignCount}개 캠페인 (${mode}), DB ${r.appliedToAccount}건 반영`,'success');
    // 매체 데이터 재로드 → 대시보드 반영
    if (currentAccount) await loadBackendMedia(currentAccount.id);
    renderConnections();
  } catch(e) {
    showToast(`동기화 실패: ${e.message}`, e.status===403?'error':'warning');
  }
}

async function setAdAccountStatus(id, status) {
  try {
    await DEEPFLE_API.patch(`/ad-accounts/${id}`, {status});
    showToast(`연결 상태가 '${STATUS_LABEL[status]}'(으)로 변경되었습니다`,'success');
    renderConnections();
  } catch(e) { showToast(`변경 실패: ${e.message}`, e.status===403?'error':'warning'); }
}

function showConnectAdAccount() {
  document.getElementById('caMediaKey').value = '';
  document.getElementById('caAccountName').value = '';
  document.getElementById('caExternalId').value = '';
  showModal('connectAdAccount');
}

async function submitConnectAdAccount() {
  const media = document.getElementById('caMediaKey').value;
  const name = (document.getElementById('caAccountName').value || '').trim();
  const extId = (document.getElementById('caExternalId').value || '').trim();
  if (!media) { showToast('매체를 선택하세요', 'warning'); return; }
  if (!name) { showToast('광고계정 이름을 입력하세요', 'warning'); return; }
  if (!currentWorkspace) { showToast('워크스페이스가 없습니다', 'warning'); return; }
  try {
    await DEEPFLE_API.post(`/workspaces/${currentWorkspace.id}/ad-accounts`,
      {media, account_id: currentAccount?.id, account_name: name, external_id: extId || 'ext_'+Date.now()});
    showToast(`${MEDIA_LABELS[media]||media} 광고계정이 연결되었습니다`, 'success');
    closeModal('connectAdAccount');
    renderConnections();
  } catch(e) { showToast(`연결 실패: ${e.message}`, e.status===403?'error':'warning'); }
}

// 백엔드에서 매체 데이터 로드 → 전역 MEDIA_DATA 교체
async function loadBackendMedia(accountId) {
  try {
    const { media, canEdit } = await DEEPFLE_API.get(`/accounts/${accountId}/media`);
    const savedBudgets = JSON.parse(localStorage.getItem(_accKey('deepfle_daily_budgets')) || '{}');
    MEDIA_DATA.length = 0;
    media.forEach(m => MEDIA_DATA.push({
      id:m.id, key:m.media_key||'', name:m.name, color:m.color,
      spend:m.spend, imp:m.imp, click:m.click,
      cvr:m.cvr, roas:m.roas, cpa:m.cpa, on:!!m.is_on,
      dailyBudget: savedBudgets[m.name] ?? 0,
    }));
    window._backendCanEdit = canEdit;
    // 미디어리포트 매체 목록 자동 갱신
    if (document.getElementById('panel-media-report')?.classList.contains('active')) renderMediaReport();
  } catch(e) { /* 폴백: 기존 MEDIA_DATA 유지 */ }
}

// ============================================================
// 영속성 레이어 (localStorage)
// ============================================================
const STORE_KEY = 'deepfle_state_v1';

function persist() {
  try {
    const snapshot = {
      audiences, rules, reports, links, activities,
      connectedMedia, mediaConnInfo,
      _savedAt: Date.now(),
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(snapshot));
  } catch(e) { /* 용량 초과 등 무시 */ }
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (s.audiences) audiences = s.audiences;
    if (s.rules) rules = s.rules;
    if (s.reports) reports = s.reports;
    if (s.links) links = s.links;
    if (s.activities) activities = s.activities;
    if (s.connectedMedia) connectedMedia = s.connectedMedia;
    if (s.mediaConnInfo) mediaConnInfo = s.mediaConnInfo;
    return true;
  } catch(e) { return false; }
}

function resetData() {
  if (!confirm('모든 데이터를 초기 상태로 되돌립니다. 계속하시겠습니까?')) return;
  localStorage.removeItem(STORE_KEY);
  location.reload();
}

// 변경 직후/이탈 시 자동 저장 + 주기적 저장
window.addEventListener('beforeunload', persist);
setInterval(persist, 5000);

// 구버전 데모 데이터 localStorage 정리
try {
  const _oldAud = JSON.parse(localStorage.getItem('deepfle_audiences') || '[]');
  if (Array.isArray(_oldAud) && _oldAud.some(a => a.name === '구매자 유사타겟 (30대)')) {
    localStorage.removeItem('deepfle_audiences');
  }
} catch(e) {}

// 앱 시작 시 저장 데이터 복원
loadPersisted();

// ============================================================
// SETUP / ONBOARDING PANEL
// ============================================================
function renderSetupPanel() {
  const r = currentUser?.role || 'user';
  const roleIcon  = {master:'👑', user:'✏️', advertiser:'👁️'}[r] || '👤';
  const roleLabel = {master:'마스터 (전체 관리 권한)', user:'사용자 (편집 권한)', advertiser:'광고주 (조회 전용)'}[r] || '';

  const masterSteps = [
    {n:1, icon:'👥', title:'권한 관리',
     desc:'팀 멤버를 초대하고 역할(마스터·사용자·광고주)을 부여합니다. 역할에 따라 접근 가능한 메뉴가 달라집니다.',
     btn:'멤버 초대', action:"showPanel('accounts',null);setTimeout(()=>{renderAccounts();switchAccTab(document.querySelector('#panel-accounts .tab-pill:nth-child(2)'),'users');},200)"},
    {n:2, icon:'🏢', title:'광고주 계정 등록',
     desc:'관리할 광고주(클라이언트) 또는 브랜드별 계정을 등록합니다. 계정당 하나의 브랜드를 대응시킵니다.',
     btn:'계정 등록', action:"showPanel('accounts',null);setTimeout(()=>{renderAccounts();showAddAccountWizard();},200)"},
    {n:3, icon:'⚙️', title:'내 계정 설정',
     desc:'비밀번호 변경, 표시 이름, 알림 이메일 등 개인 계정 설정을 완료합니다.',
     btn:'설정하기', action:"openMyAccount()"},
  ];
  const userSteps = [
    {n:1, icon:'🏢', title:'광고주 계정 등록',
     desc:'담당 클라이언트 또는 브랜드 계정을 등록합니다. 등록 후 대시보드에서 성과 데이터를 조회할 수 있습니다.',
     btn:'계정 등록', action:"showPanel('accounts',null);setTimeout(()=>{renderAccounts();showAddAccountWizard();},200)"},
    {n:2, icon:'⚙️', title:'내 계정 설정',
     desc:'비밀번호 변경, 표시 이름 등 개인 계정 설정을 완료합니다.',
     btn:'설정하기', action:"openMyAccount()"},
  ];
  const advSteps = [
    {n:1, icon:'⏳', title:'관리자 설정 대기 중',
     desc:'담당 관리자가 광고주 계정을 설정하고 있습니다.<br>완료 후 이메일로 안내 드리며, 대시보드에서 성과 데이터를 확인하실 수 있습니다.',
     btn:null, action:null},
  ];
  const steps = {master:masterSteps, user:userSteps, advertiser:advSteps}[r] || userSteps;

  const cardsHtml = steps.map(s=>`
    <div class="setup-card">
      <div class="setup-card-num">${s.n}</div>
      <div class="setup-card-icon">${s.icon}</div>
      <div class="setup-card-title">${s.title}</div>
      <div class="setup-card-desc">${s.desc}</div>
      ${s.btn
        ? `<button class="setup-card-btn" onclick="${s.action}">${s.btn} →</button>`
        : `<div class="setup-card-wait">⏳ 관리자 확인 후 자동으로 접근이 허용됩니다</div>`}
    </div>`).join('');

  document.getElementById('setupBody').innerHTML = `
    <div class="setup-wrap">
      <div class="setup-hero">
        <div class="setup-hero-emoji">👋</div>
        <h1 class="setup-hero-title">DeepFle에 오신 것을 환영합니다</h1>
        <p class="setup-hero-sub">
          <span class="setup-role-badge">${roleIcon} ${roleLabel}</span>&nbsp;계정으로 로그인했습니다.<br>
          아래 단계를 완료하면 광고 성과 분석을 시작할 수 있습니다.
        </p>
      </div>
      <div class="setup-steps">${cardsHtml}</div>
    </div>`;
}



async function _initInviteSignup(token) {
  // Show signup page while we load invite info
  document.getElementById('page-login').style.display = 'none';
  const sg = document.getElementById('page-signup');
  sg.style.display = 'flex';
  document.getElementById('sgStepTitle').textContent = '초대 링크로 가입';
  document.getElementById('sgStepSub').textContent = '초대 정보를 확인하는 중...';
  document.getElementById('sgBody').innerHTML = `<div style="text-align:center;padding:20px;color:#94A3B8;">초대 정보 로드 중...</div>`;
  const nextBtn = document.getElementById('sgNextBtn');
  if (nextBtn) nextBtn.style.display = 'none';
  const prevBtn = document.getElementById('sgPrevBtn');
  if (prevBtn) prevBtn.style.display = 'none';

  try {
    const res = await fetch(`${DEEPFLE_API.BASE_URL}/invite/${token}`);
    const data = await res.json();
    if (!res.ok || data.error) {
      document.getElementById('sgBody').innerHTML = `
        <div style="text-align:center;padding:24px 0;">
          <div style="font-size:40px;margin-bottom:12px;">❌</div>
          <div style="font-size:14px;color:#EF4444;font-weight:600;">${data.error || '유효하지 않은 초대 링크입니다'}</div>
          <div style="margin-top:16px;"><a href="#" style="color:#818CF8;font-size:13px;" onclick="event.preventDefault();location.href=location.pathname">로그인 화면으로</a></div>
        </div>`;
      return;
    }
    const email = data.email || '';
    const accounts = data.account_names || [];
    document.getElementById('sgStepTitle').textContent = '광고주 계정 생성';
    document.getElementById('sgStepSub').textContent = `${email} 으로 발송된 초대입니다`;
    document.getElementById('sgBody').innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="font-size:12px;font-weight:600;color:#94A3B8;display:block;margin-bottom:5px;">이름 <span style="color:#EF4444;">*</span></label>
          <input class="form-input" id="inv_name" placeholder="홍길동" style="background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.12);color:#fff;">
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:#94A3B8;display:block;margin-bottom:5px;">이메일</label>
          <input class="form-input" value="${email}" readonly style="background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.08);color:#64748B;">
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:#94A3B8;display:block;margin-bottom:5px;">비밀번호 <span style="color:#EF4444;">*</span></label>
          <input class="form-input" id="inv_pw" type="password" placeholder="8자 이상 · 영문+숫자+특수문자" autocomplete="new-password" style="background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.12);color:#fff;">
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:#94A3B8;display:block;margin-bottom:5px;">비밀번호 확인 <span style="color:#EF4444;">*</span></label>
          <input class="form-input" id="inv_pwc" type="password" placeholder="비밀번호 재입력" autocomplete="new-password" style="background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.12);color:#fff;">
        </div>
        ${accounts.length ? `<div style="padding:10px;background:rgba(79,70,229,0.12);border-radius:8px;border:1px solid rgba(79,70,229,0.3);">
          <div style="font-size:11px;color:#818CF8;font-weight:600;margin-bottom:4px;">접근 가능 계정</div>
          <div style="font-size:12px;color:#C7D2FE;">${accounts.map(a=>a.name||a).join(', ')}</div>
        </div>` : ''}
      </div>`;
    if (nextBtn) {
      nextBtn.style.display = '';
      nextBtn.textContent = '계정 생성';
      nextBtn.onclick = async () => {
        const name = document.getElementById('inv_name').value.trim();
        const pw = document.getElementById('inv_pw').value;
        const pwc = document.getElementById('inv_pwc').value;
        if (!name) { showToast('이름을 입력해주세요', 'warning'); return; }
        if (!pw || pw.length < 8) { showToast('비밀번호는 8자 이상이어야 합니다', 'warning'); return; }
        if (pw !== pwc) { showToast('비밀번호가 일치하지 않습니다', 'warning'); return; }
        nextBtn.disabled = true; nextBtn.textContent = '처리 중...';
        try {
          const r = await fetch(`${DEEPFLE_API.BASE_URL}/invite/${token}/accept`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name, password: pw})
          });
          const d = await r.json();
          if (!r.ok) { showToast(d.error || '가입 실패', 'error'); nextBtn.disabled = false; nextBtn.textContent = '계정 생성'; return; }
          // 가입 완료 → 반환된 JWT로 자동 로그인
          history.replaceState(null, '', location.pathname);
          document.getElementById('page-signup').style.display = 'none';
          DEEPFLE_API.live = true;
          DEEPFLE_API.token = d.token;
          const u = d.user;
          currentUser = {id:u.id, name:u.name, email:u.email, role:u.role, avatar:u.name[0], avatarColor:u.avatarColor};
          try {
            const { workspaces } = await DEEPFLE_API.get('/workspaces');
            BACKEND_WORKSPACES = workspaces;
            currentWorkspace = workspaces[0] || null;
            let accounts = [];
            if (currentWorkspace) {
              const res = await DEEPFLE_API.get(`/workspaces/${currentWorkspace.id}/accounts`);
              accounts = res.accounts || [];
            } else {
              accounts = (await DEEPFLE_API.get('/accounts')).accounts || [];
            }
            BACKEND_ACCOUNTS = accounts;
            if (accounts[0]) {
              currentAccount = {id:accounts[0].id, name:accounts[0].name, advertiser:accounts[0].advertiser, color:accounts[0].color, users:[]};
              await loadBackendMedia(currentAccount.id);
            } else {
              currentAccount = null;
            }
          } catch(e2) { /* 계정 로드 실패는 무시하고 대시보드 진입 */ }
          ['deepfle_manual_conv_data','deepfle_demo_conversions','deepfle_audiences'].forEach(k=>localStorage.removeItem(k));
          initDashboard();
          showToast(`계정 생성 완료 — ${u.name}으로 로그인됐습니다`, 'success');
        } catch(e) { showToast('서버 연결 실패', 'error'); nextBtn.disabled = false; nextBtn.textContent = '계정 생성'; }
      };
    }
  } catch(e) {
    document.getElementById('sgBody').innerHTML = `<div style="text-align:center;padding:24px;color:#EF4444;font-size:13px;">서버 연결 실패. 백엔드가 실행 중인지 확인해주세요.</div>`;
  }
}

// ── DEMO MODE ENGINE ────────────────────────────────────────────
let _demoMode = false;

const _DEMO_MEDIA_BASE = [
  {key:'naver_sa',  label:'네이버 검색광고', color:'#03C75A', spend:8900000,  imp:625000,  click:31000, conv:494, revenue:46280000},
  {key:'google',    label:'구글 Ads',         color:'#4285F4', spend:15200000, imp:2100000, click:28400, conv:475, revenue:62320000},
  {key:'kakao',     label:'카카오모먼트',     color:'#FFE300', spend:12500000, imp:1250000, click:18200, conv:480, revenue:47500000},
  {key:'meta',      label:'메타(페이스북)',   color:'#1877F2', spend:6700000,  imp:985000,  click:12600, conv:186, revenue:19430000},
  {key:'kakao_biz', label:'카카오 비즈보드', color:'#F7E600', spend:4100000,  imp:870000,  click:9800,  conv:97,  revenue:10250000},
];

function _genDemoMetricRows(from, to) {
  const d1 = new Date(from), d2 = new Date(to);
  const days = Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
  const dates = Array.from({length: days}, (_, i) =>
    new Date(d1.getTime() + i * 86400000).toISOString().slice(0, 10));
  const rows = [];
  _DEMO_MEDIA_BASE.forEach(m => {
    const rnd = _seededRand(m.key.split('').reduce((a, c) => a + c.charCodeAt(0), 0));
    dates.forEach(date => {
      const dow = new Date(date).getDay();
      const wkMul = (dow === 0 || dow === 6) ? 0.68 : 1.0;
      const noise = 0.78 + rnd() * 0.44;
      const mul = noise * wkMul;
      rows.push({media:m.key, date, metric_key:'cost',    value: Math.round(m.spend   / days * mul)});
      rows.push({media:m.key, date, metric_key:'imp',     value: Math.round(m.imp     / days * mul)});
      rows.push({media:m.key, date, metric_key:'click',   value: Math.round(m.click   / days * mul)});
      rows.push({media:m.key, date, metric_key:'conv',    value: Math.round(m.conv    / days * mul)});
      rows.push({media:m.key, date, metric_key:'revenue', value: Math.round(m.revenue / days * mul)});
    });
  });
  return rows;
}

function _genDemoRawRows(from, to) {
  const d1 = new Date(from), d2 = new Date(to);
  const days = Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
  const dates = Array.from({length: days}, (_, i) =>
    new Date(d1.getTime() + i * 86400000).toISOString().slice(0, 10));
  const campaigns = {
    naver_sa:  [['브랜드 검색','상품 검색','경쟁사 키워드'],['키워드_A','키워드_B','키워드_C']],
    google:    [['브랜드 캠페인','퍼포먼스Max','리마케팅'],['광고그룹_1','광고그룹_2','광고그룹_3']],
    kakao:     [['구매의도 타겟','유사타겟 확장','리타겟팅'],['소재_A','소재_B','소재_C']],
    meta:      [['신규고객 확보','재구매 유도','앱설치 유도'],['광고세트_1','광고세트_2','광고세트_3']],
    kakao_biz: [['비즈보드 메인','비즈보드 서브'],['소재_1','소재_2']],
  };
  const rows = [];
  _DEMO_MEDIA_BASE.forEach(m => {
    const [camps, adgs] = campaigns[m.key] || [['기본 캠페인'],['기본 광고그룹']];
    const rnd = _seededRand(m.key.split('').reduce((a, c) => a + c.charCodeAt(0), 13));
    dates.forEach(date => {
      const dow = new Date(date).getDay();
      const wkMul = (dow === 0 || dow === 6) ? 0.68 : 1.0;
      camps.forEach((camp, ci) => {
        const share = ci === 0 ? 0.48 : ci === 1 ? 0.31 : 0.21;
        const mul = (0.8 + rnd() * 0.4) * wkMul * share;
        rows.push({
          date, media: m.key, campaign: camp,
          adgroup: adgs[ci % adgs.length],
          keyword: m.key === 'naver_sa' ? `키워드_${ci + 1}` : '',
          creative: `소재_${ci + 1}`, campaign_type: '일반',
          device: ['mobile','desktop','mobile'][ci % 3],
          cost:       Math.round(m.spend   / days * mul),
          imp:        Math.round(m.imp     / days * mul),
          click:      Math.round(m.click   / days * mul),
          conv_native:Math.round(m.conv    / days * mul * 0.55),
          conv_ga4:   Math.round(m.conv    / days * mul * 0.32),
          conv_mmp:   0, conv_manual: 0,
        });
      });
    });
  });
  return rows;
}

function _buildDemoResponse(path) {
  const qFrom = (path.match(/[?&]from=([^&]+)/) || [])[1]
    || window._globalFrom
    || new Date(Date.now() - 30*86400000).toISOString().slice(0,10);
  const qTo   = (path.match(/[?&]to=([^&]+)/) || [])[1]
    || window._globalTo
    || new Date(Date.now() - 86400000).toISOString().slice(0,10);

  if (/\/metric-data/.test(path))
    return {data: _genDemoMetricRows(qFrom, qTo)};
  if (/\/(raw-metrics|raw-hierarchy)/.test(path))
    return {rows: _genDemoRawRows(qFrom, qTo)};
  if (/\/metric-catalog/.test(path))
    return {
      base: [{name:'노출수'},{name:'클릭수'},{name:'광고비'},{name:'CPC'},{name:'CPM'}],
      conversion: [{id:1,name:'구매',type:'count'},{id:2,name:'회원가입',type:'count'}],
    };
  if (/\/conversion-settings/.test(path))
    return {conversions: [
      {id:1, source:'manual', source_metric:'purchase',  solution_metric:'구매',    value_type:'count', active:true},
      {id:2, source:'manual', source_metric:'sign_up',   solution_metric:'회원가입', value_type:'count', active:true},
    ]};
  if (/\/report-config/.test(path))
    return {configs: [
      {id:1, name:'주간 통합 리포트',      media:'__all__',  metrics:['cost','imp','click','conv'], schedule:'weekly',  createdAt:'2026-06-01'},
      {id:2, name:'네이버SA 월간 리포트',  media:'naver_sa', metrics:['cost','click','conv'],       schedule:'monthly', createdAt:'2026-06-15'},
    ]};
  if (/\/report-history/.test(path))   return {history:[]};
  if (/\/manual-metrics/.test(path))   return {rows:[]};
  if (/\/rules/.test(path))
    return {rules: [
      {id:'r1', name:'구글 ROAS 하락 알림',      media:'google', mediaName:'구글 Ads',    metric:'roas',  op:'<', threshold:300,      action:'alert', active:true, createdAt:'2026-06-20 09:00'},
      {id:'r2', name:'카카오 예산 초과 자동중단', media:'kakao',  mediaName:'카카오모먼트', metric:'spend', op:'>', threshold:15000000, action:'pause', active:true, createdAt:'2026-06-15 14:30'},
    ]};
  if (/\/rule-executions/.test(path))  return {executions:[]};
  if (/\/attribution-links/.test(path)) return {links:[]};
  if (/\/audiences/.test(path))        return {audiences:[]};
  if (/\/media-credentials/.test(path)) return {credentials:[]};
  if (/\/connectors\/health-all/.test(path))
    return {results: _DEMO_MEDIA_BASE.map(m => ({
      media: m.key, key: m.key, label: m.label, category: '검색/디스플레이',
      reachable: true, tokenValid: false, latencyMs: 0, error: null,
    }))};
  if (/\/connectors\/.*\/fields/.test(path)) return {fields:[]};
  if (/\/audit/.test(path))            return {activities:[]};
  if (/\/activities/.test(path))       return {activities:[]};
  if (/\/integrations/.test(path))     return {integrations:[]};
  if (/\/media-metric-map/.test(path)) return {maps:[]};
  if (/\/ad-accounts/.test(path))
    return {canEdit: true, adAccounts: _DEMO_MEDIA_BASE.map(m => ({
      id:'aa_'+m.key, account_id:'demo_acc1', media:m.key,
      status:'connected', name:m.label,
    }))};
  if (/\/accounts\/[^/]+\/media$/.test(path))
    return {
      canEdit: true,
      media: _DEMO_MEDIA_BASE.map((m, i) => ({
        id: i+1, media_key: m.key, name: m.label, color: m.color,
        spend: m.spend, imp: m.imp, click: m.click,
        cvr: +(m.conv/m.click*100).toFixed(2),
        roas: +(m.revenue/m.spend*100).toFixed(0),
        cpa:  Math.round(m.spend/m.conv),
        is_on: true,
      })),
    };
  if (/\/workspaces\/[^/]+\/accounts/.test(path))
    return {accounts:[{id:'demo_acc1', name:'데모 브랜드', advertiser:'데모(주)', color:'#4F46E5'}]};
  if (/\/workspaces/.test(path))
    return {workspaces:[{id:'ws_demo', name:'데모 워크스페이스'}]};
  if (/\/accounts/.test(path))
    return {accounts:[{id:'demo_acc1', name:'데모 브랜드', advertiser:'데모(주)', color:'#4F46E5'}]};
  if (/\/users/.test(path))
    return {users:[{id:'u_master', name:'데모 관리자', email:'demo@deepfle.io',
      role:'master', avatarColor:'#4F46E5', accounts:['demo_acc1'], lastLogin:'방금'}]};
  return {ok:true};
}

function _initDemoMode() {
  _demoMode = true;

  // API를 데모 응답으로 완전 대체
  DEEPFLE_API.USE_MOCK = false;
  DEEPFLE_API.live     = true;
  const _demoGet = async (path) => _buildDemoResponse(path);
  DEEPFLE_API.get     = _demoGet;
  DEEPFLE_API.post    = async () => ({ok:true});
  DEEPFLE_API.patch   = async () => ({ok:true});
  DEEPFLE_API.put     = async () => ({ok:true});
  DEEPFLE_API.del     = async () => ({ok:true});
  DEEPFLE_API.request = async (method, path) =>
    method === 'GET' ? _buildDemoResponse(path) : {ok:true};

  // 데모 계정 설정
  const demoAcc = {id:'demo_acc1', name:'데모 브랜드', advertiser:'데모(주)', color:'#4F46E5', users:['u_master'], myRole:'master'};
  ACCOUNTS.length = 0; ACCOUNTS.push(demoAcc);
  BACKEND_ACCOUNTS.length = 0; BACKEND_ACCOUNTS.push(demoAcc);
  currentWorkspace = {id:'ws_demo', name:'데모 워크스페이스'};

  // MEDIA_DATA 데모 데이터로 채우기
  MEDIA_DATA.length = 0;
  _DEMO_MEDIA_BASE.forEach(m => MEDIA_DATA.push({
    key:m.key, name:m.label, color:m.color, on:true,
    spend:m.spend, imp:m.imp, click:m.click,
    conv:m.conv, revenue:m.revenue,
    ctr:+(m.click/m.imp*100).toFixed(2),
    cvr:+(m.conv/m.click*100).toFixed(2),
    roas:+(m.revenue/m.spend*100).toFixed(0),
    cpa:Math.round(m.spend/m.conv), dailyBudget:0,
  }));
  [{key:'tiktok',name:'틱톡',color:'#000000'},{key:'youtube',name:'유튜브',color:'#FF0000'},
   {key:'karrot',name:'당근마켓',color:'#FF7E36'},{key:'naver_shopping',name:'네이버 쇼핑',color:'#00C73C'}
  ].forEach(m => MEDIA_DATA.push({...m, on:false, spend:0,imp:0,click:0,conv:0,revenue:0,ctr:0,cvr:0,roas:0,cpa:0,dailyBudget:0}));

  // 활동 피드 · 규칙
  activities = [
    {user:'데모 관리자', avatar:'데', avatarColor:'#4F46E5', time:'10분 전',  role:'master', msg:'구글 Ads ROAS 지난주 대비 8.4% 상승 확인'},
    {user:'데모 관리자', avatar:'데', avatarColor:'#4F46E5', time:'2시간 전', role:'master', msg:'카카오모먼트 일별 예산 1,250만원 집행 완료'},
    {user:'데모 관리자', avatar:'데', avatarColor:'#4F46E5', time:'어제',     role:'master', msg:'KPI 목표 설정 완료 (ROAS 350% / CPA ₩30,000)'},
    {user:'데모 관리자', avatar:'데', avatarColor:'#4F46E5', time:'3일 전',   role:'master', msg:'5개 매체 API 연동 완료'},
  ];
  rules = [
    {id:'r1', name:'구글 ROAS 하락 알림',      media:'google', mediaName:'구글 Ads',    metric:'roas',  op:'<', threshold:300,      action:'alert', active:true, createdAt:'2026-06-20 09:00'},
    {id:'r2', name:'카카오 예산 초과 자동중단', media:'kakao',  mediaName:'카카오모먼트', metric:'spend', op:'>', threshold:15000000, action:'pause', active:true, createdAt:'2026-06-15 14:30'},
  ];

  // 사용자 · 계정 설정 후 대시보드 진입 (로그인 스킵)
  currentUser = {id:'u_master', name:'데모 관리자', email:'demo@deepfle.io', role:'master', avatar:'데', avatarColor:'#4F46E5'};
  currentAccount = demoAcc;
  localStorage.removeItem('deepfle_last_panel');
  sessionStorage.setItem('deepfle_demo', '1');
  initDashboard();
}
// ────────────────────────────────────────────────────────────────

// 백엔드 가용 여부 점검 → 로그인 화면에 상태 배지 표시
(async function bootstrap(){
  // ?demo=1 — 가이드 페이지 데모 버튼으로 진입
  if (new URLSearchParams(location.search).get('demo') === '1') {
    _initDemoMode();
    return;
  }

  // ?share=TOKEN 자동 감지 — 로그인 없이 공유 뷰로 진입
  if (new URLSearchParams(location.search).get('share')) {
    _initShareView();
    return;
  }

  // ?invite=TOKEN 자동 감지 — 광고주 초대 링크로 접근
  const _inviteToken = new URLSearchParams(location.search).get('invite');
  if (_inviteToken) {
    await _initInviteSignup(_inviteToken);
    return;
  }

  // 저장된 세션 복원 시도 (새로고침 시 로그인 화면 건너뜀)
  const _ss = (() => { try { return JSON.parse(localStorage.getItem('deepfle_session')||'null'); } catch(e){ return null; } })();
  if (sessionStorage.getItem('deepfle_demo') === '1') {
    _initDemoMode();
    return;
  }
  if (_ss?.mode === 'mock' && DEMO_CREDENTIALS[_ss.role]) {
    currentUser = {...DEMO_USERS[_ss.role]};
    currentAccount = ACCOUNTS.filter(a=>a.users?.includes(currentUser.id))[0] || null;
    _applyMediaOnOff();
    initDashboard();
    return;
  }
  if (_ss?.mode === 'live' && _ss.token) {
    DEEPFLE_API.token = _ss.token;
    DEEPFLE_API.USE_MOCK = false;
    DEEPFLE_API.live = true;
    try {
      const user = await DEEPFLE_API.get('/auth/me');
      currentUser = {id:user.id,name:user.name,email:user.email,role:user.role,avatar:user.name[0],avatarColor:user.avatarColor};
      try {
        const { workspaces } = await DEEPFLE_API.get('/workspaces');
        BACKEND_WORKSPACES = workspaces;
        currentWorkspace = workspaces.find(w=>w.id===_ss.workspaceId) || workspaces[0] || null;
        let accs = [];
        if (currentWorkspace) {
          accs = (await DEEPFLE_API.get(`/workspaces/${currentWorkspace.id}/accounts`)).accounts || [];
        } else {
          accs = (await DEEPFLE_API.get('/accounts')).accounts || [];
        }
        BACKEND_ACCOUNTS = accs;
        const saved = accs.find(a=>a.id===_ss.accountId) || accs[0];
        if (saved) { currentAccount={id:saved.id,name:saved.name,advertiser:saved.advertiser,color:saved.color,users:[]}; await loadBackendMedia(currentAccount.id); }
      } catch(e2) {}
      initDashboard();
      return;
    } catch(e) {
      // 401/403 = 토큰 만료·무효 → 세션 삭제
      // 네트워크 오류 등 = 세션 유지(다음 로드 시 재시도)
      if (e.status === 401 || e.status === 403) localStorage.removeItem('deepfle_session');
      DEEPFLE_API.token = null; DEEPFLE_API.USE_MOCK = true; DEEPFLE_API.live = false;
    }
  }

  await DEEPFLE_API.healthCheck();
  const badge = document.getElementById('backendStatusBadge');
  if (badge) {
    if (DEEPFLE_API.live) {
      badge.innerHTML = '🟢 백엔드 연결됨 — 실제 JWT 인증 · 서버 권한검증 사용';
      badge.style.cssText = 'color:#16A34A;background:#DCFCE7;';
    } else {
      badge.innerHTML = '🔴 백엔드 연결 실패 — <span style="text-decoration:underline;cursor:pointer;" onclick="doLogin()">로그인 시 자동 재시도</span>';
      badge.style.cssText = 'color:#DC2626;background:#FEE2E2;';
    }
  }
})();
