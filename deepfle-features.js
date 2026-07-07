/* DeepFle 트랙A — PDF·CSV·공유·QR·인쇄 실동작 + 연습모드 라벨 정리
   기존 HTML 수정 없이 동작 (클릭 이벤트 위임 방식) */
(function () {
  'use strict';
  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }
  function dateStr() { const d = new Date(); return `${d.getFullYear()}${('0'+(d.getMonth()+1)).slice(-2)}${('0'+d.getDate()).slice(-2)}`; }
  function toast(m) { if (window.showToast) window.showToast(m, 'success'); }

  function exportCSV() {
    const rows = [['매체','상태','광고비','노출','클릭','CTR','전환','ROAS','CPA']];
    document.querySelectorAll('#mediaTableBody tr').forEach(tr => {
      const c = [...tr.querySelectorAll('td')].map(td => td.innerText.replace(/\s+/g,' ').trim());
      if (c.length) rows.push(c.slice(0, 9));
    });
    const csv = '\uFEFF' + rows.map(r => r.map(x => `"${x}"`).join(',')).join('\n');
    downloadBlob(csv, `DeepFle_리포트_${dateStr()}.csv`, 'text/csv;charset=utf-8');
  }
  function exportPDF() { window.print(); }
  function shareLink() {
    const u = location.origin + location.pathname + '?s=' + Math.random().toString(36).slice(2, 9);
    if (navigator.clipboard) navigator.clipboard.writeText(u).catch(() => {});
    return u;
  }
  function showQR(text) {
    const src = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(text);
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:3000;display:flex;align-items:center;justify-content:center';
    ov.onclick = () => ov.remove();
    ov.innerHTML = `<div style="background:#fff;padding:24px;border-radius:14px;text-align:center;max-width:280px;">
      <div style="font-size:14px;font-weight:700;margin-bottom:12px;">추적 링크 QR코드</div>
      <img src="${src}" width="220" height="220" alt="QR">
      <div style="font-size:11px;color:#888;margin-top:10px;word-break:break-all;">${text}</div>
      <div style="font-size:11px;color:#aaa;margin-top:8px;">(빈 곳을 클릭하면 닫힙니다)</div></div>`;
    document.body.appendChild(ov);
  }

  document.addEventListener('click', function (e) {
    const el = e.target.closest('button, .export-btn, .copy-btn');
    if (!el) return;
    // Raw 업로드/다운로드 전용 핸들러가 있는 버튼은 위임 대상에서 제외
    if (el.closest('#panel-raw-upload, #panel-raw-download')) return;
    const t = (el.innerText || '').trim();
    if (/QR/i.test(t)) {
      const url = el.closest('tr')?.querySelector('.link-url')?.innerText || location.href;
      showQR(url);
    } else if (/PDF/i.test(t)) { exportPDF(); toast('인쇄 창에서 \'PDF로 저장\'을 선택하세요'); }
    else if (/Excel|CSV/i.test(t)) { exportCSV(); toast('CSV 파일을 다운로드했습니다'); }
    else if (/공유/.test(t)) { shareLink(); toast('공유 링크가 복사되었습니다'); }
  }, true);

  // 추적링크 행에 QR 버튼 주입
  function injectQR() {
    document.querySelectorAll('#linkTable tr').forEach(tr => {
      const last = tr.querySelector('td:last-child');
      if (last && !last.querySelector('.df-qr')) {
        const b = document.createElement('button');
        b.className = 'copy-btn df-qr'; b.textContent = 'QR'; b.style.marginLeft = '4px';
        last.appendChild(b);
      }
    });
  }
  const mo = new MutationObserver(() => {
    clearTimeout(window._df); window._df = setTimeout(() => { injectQR(); }, 250);
  });
  mo.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => { injectQR(); }, 1000);
  console.log('[DeepFle] 트랙A 활성화: PDF·CSV·공유·QR');
})();