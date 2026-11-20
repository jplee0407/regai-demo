import { judgeChange, inspectionSchedule, checkLabel, activeVersion, daysBetween, label, addDays, impact } from './engine.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const B = await (await fetch('data/bundle.json', { cache: 'no-store' })).json();
const SITES = B.사업장목록;
const HQ = B.본사;
const SITE0 = B.사업장; // 정답셋(회귀 테스트) 기준 사업장
const NOTICES = B.고시 || [];
const PEOPLE = [...SITES.flatMap(s => s.담당자.map(p => ({ ...p, 사업장: s.id }))), ...HQ.담당자.map(p => ({ ...p, 사업장: 'HQ' }))];
const siteName = id => id === 'HQ' ? '본사 공통' : SITES.find(s => s.id === id)?.사업장 || id;
const siteShort = id => id === 'HQ' ? '본사' : SITES.find(s => s.id === id)?.약칭 || id;
let curSite = 'ALL';
const selSites = () => curSite === 'ALL' ? SITES : SITES.filter(s => s.id === curSite);
const inSite = x => curSite === 'ALL' || x.사업장 === curSite || x.사업장 === 'HQ';
const sitePill = id => `<span class="pill ${id === 'HQ' ? 'gray' : 'navy'}" style="font-size:10.5px">${esc(siteShort(id))}</span>`;
const ST = ['대기', '진행 중', '완료'];

// ---------------------------------------------------------------- 상태 저장 (브라우저 localStorage)
const KEY = 'regai-demo-v4';
const nowStr = () => new Date().toLocaleString('sv-SE').slice(0, 16);
let S;
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 저장 불가 환경 */ } }
function log(msg, who = '김지훈') { S.log.unshift({ t: nowStr(), who, msg }); if (S.log.length > 200) S.log.length = 200; }
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2600); }

// ---------------------------------------------------------------- 기본 설정
const today = new Date().toISOString().slice(0, 10);
$('baseDate').value = today;
const base = () => $('baseDate').value || today;
const repo = B.빌드.저장소;
$('buildinfo').textContent = `화학물질관리법·시행규칙 발췌 기반 · 가상 사업장 · 빌드 ${B.빌드.커밋} (${B.빌드.시각.slice(0, 16).replace('T', ' ')} UTC)`;
const dday = d => { const n = daysBetween(base(), d); return n === 0 ? 'D-day' : n > 0 ? `D-${n}` : `D+${-n}`; };
const personOpts = (sel, site) => PEOPLE.filter(p => !site || p.사업장 === site || p.사업장 === 'HQ').map(p => `<option value="${esc(p.이름)}" ${p.이름 === sel ? 'selected' : ''}>${esc(p.이름)} (${esc(p.부서)})</option>`).join('');
const pickPerson = (부서, site) => { const ps = site.담당자; return (ps.find(p => p.부서 === 부서) || ps.find(p => p.부서 === '환경안전팀') || ps[0]).이름; };
const shash = s => { let h = 2166136261; for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, '0') + '····'; };

// ---------------------------------------------------------------- 지식 = 저장소 지식 + 전문가 승인 내역
function docLinks(d) { return (S && S.docLinks && S.docLinks[d.유형]) || d.관련조문; }
function knowledge(apps = S.approvals) {
  const K = { ...B, 규칙: clone(B.규칙), 조문: clone(B.조문), 가이드: clone(B.가이드), 해석: clone(B.해석 || []), 수량: {} };
  const approvedNotices = new Set();
  for (const a of apps) {
    if (a.notice) approvedNotices.add(a.notice);
    if (a.종류 === '확인') continue;
    if (a.종류 === '수량기준') { (K.수량[a.CAS] ||= []).push({ 시행일: a.시행일, 하위: Number(a.값), 승인: a.승인자 }); continue; }
    if (a.종류 === '새규칙') { K.규칙.push(clone(a.값)); continue; }
    if (a.종류 === '해석편집') { const i = K.해석.findIndex(g => g.id === a.값.id); if (i >= 0) K.해석[i] = clone(a.값); else K.해석.push(clone(a.값)); continue; }
    if (a.종류 === '가이드편집') { const i = K.가이드.findIndex(g => g.코드 === a.값.코드); if (i >= 0) K.가이드[i] = clone(a.값); else K.가이드.push(clone(a.값)); continue; }
    const r = K.규칙.find(x => x.id === a.규칙);
    if (!r) continue;
    const prev = r.버전.find(v => !v.폐지일) || r.버전[r.버전.length - 1];
    const nv = clone(prev);
    nv.버전 = Math.max(...r.버전.map(v => v.버전)) + 1;
    nv.시행일 = a.시행일; nv.폐지일 = null;
    nv.승인 = `${a.승인자} 승인 (${a.일시.slice(0, 10)})`;
    if (a.근거 && !nv.근거.includes(a.근거)) nv.근거.push(a.근거);
    if (a.종류 === '기한일수') nv.결과.기한.일수 = Number(a.값);
    if (a.종류 === '필수항목추가' && !nv.필수항목.includes(a.값)) nv.필수항목.push(a.값);
    if (a.종류 === '필수항목편집') nv.필수항목 = a.값;
    if (a.종류 === '결정표편집') { nv.결정표 = a.값.결정표; nv.연장.최대_년 = a.값.연장_최대; }
    if (a.종류 === '버전교체') { const keep = { 버전: nv.버전, 시행일: nv.시행일, 폐지일: null, 승인: nv.승인 }; Object.assign(nv, clone(a.값.버전), keep); if (a.값.이름) r.이름 = a.값.이름; if (a.값.설명) r.설명 = a.값.설명; }
    if (prev.시행일 < a.시행일) prev.폐지일 = a.시행일;
    r.버전.push(nv);
  }
  // 승인된 고시의 바뀐 조문을 조문 KB에 새 버전으로 추가
  for (const n of NOTICES.filter(n => approvedNotices.has(n.id))) {
    for (const c of n.변경조문) {
      const list = K.조문[c.id];
      if (!list) continue;
      const prev = list.find(a => !a.폐지일) || list[list.length - 1];
      if (prev.시행일 >= n.시행일) continue;
      prev.폐지일 = n.시행일;
      list.push({ ...prev, 내용: c.신 + ' (가상 개정)', 시행일: n.시행일, 폐지일: null, 해시: shash(c.신) });
    }
  }
  return K;
}
let K;
function qtyAt(m, date) {
  const ov = (K.수량[m.CAS] || []).filter(x => x.시행일 <= date).sort((a, b) => a.시행일 < b.시행일 ? -1 : 1).pop();
  const fut = (K.수량[m.CAS] || []).filter(x => x.시행일 > date).sort((a, b) => a.시행일 < b.시행일 ? -1 : 1)[0];
  return { 하위: ov ? ov.하위 : m.규정수량_하위_t, 상위: m.규정수량_상위_t, 예정: fut };
}
function mocDue(m, date) {
  const r = judgeChange(K, { ...mocFlags(m), 변경완료_예정일: m.변경완료_예정일 }, date)[0];
  return r ? r.기한 : null;
}
function mocFlags(m) {
  const t = m.변경유형;
  return { 물질_변경_추가: t.includes('물질 변경'), 취급시설_용량_증가: t.includes('용량'), 함량_농도_성상_변경: t.includes('함량'), 위험도_증가: t.includes('위험 증가'), 시설_위치_변경: t.includes('위치') };
}

// ---------------------------------------------------------------- AI 영향 분석 (시연: 미리 만든 AI 결과 + 사업장 데이터 대조)
function fill(tpl, v) { return tpl.replace(/\{(\S+?)\}/g, (_, k) => v[k] ?? ''); }
function analyze(n) {
  const items = [];
  const due = (spec, v = {}) => spec.기준 === '시행일' ? addDays(n.시행일, spec.일수) : addDays(v[spec.기준] || n.시행일, spec.일수);
  const changedCAS = (n.수량변경 || []).map(q => q.CAS);
  const prop = (n.규칙제안 || []).find(p => p.종류 === '기한일수');
  const ids = n.변경조문.map(c => c.id);
  const cites = n.변경조문.map(c => c.조문);
  for (const site of SITES) {
    const push = x => items.push({ 사업장: site.id, 근거: cites, ...x });
    for (const r of n.영향규칙 || []) {
      let ents = [];
      if (r.대상 === '변경관리') {
        ents = site.변경관리.filter(m => m.상태 === '진행' && m.계획서_제출예정).map(m => ({
          구분: '설비 변경', 대상: `${m.id} ${m.이름}`, 담당자: m.담당자,
          v: { ...m, 기존기한: m.계획서_제출예정, 신기한: addDays(m.변경완료_예정일, prop ? prop.제안 : -60) },
        }));
      } else if (r.대상 === '물질' && r.조건.집계) {
        const ms = site.물질;
        if (ms.length) ents = [{ 구분: '물질', 대상: `${site.약칭} 취급 유해화학물질 ${ms.length}종`, 담당자: pickPerson(r.부서, site), v: { 물질수: ms.length, 물질목록: ms.map(m => m.이름).join(', ') } }];
      } else if (r.대상 === '물질') {
        ents = site.물질.filter(m => r.조건.전체 || (r.조건.수량변경 && changedCAS.includes(m.CAS))).map(m => {
          const q = (n.수량변경 || []).find(x => x.CAS === m.CAS) || {};
          return { 구분: '물질', 대상: `${m.이름} (CAS ${m.CAS})`, 담당자: pickPerson(r.부서, site),
            v: { ...m, 보유량: m.최대보유량_t, ...q, 배수_구: q.하위_구 ? (m.최대보유량_t / q.하위_구).toFixed(1) : '', 배수_신: q.하위_신 ? (m.최대보유량_t / q.하위_신).toFixed(1) : '' } };
        });
      } else if (r.대상 === '시설') {
        ents = site.시설.filter(f => (r.조건.유형 && r.조건.유형.includes(f.유형))
          || (r.조건.물질수량변경 && f.물질.some(id => changedCAS.includes(site.물질.find(m => m.id === id)?.CAS)))
          || (r.조건.연장후보 && f.연속적합_횟수 >= 2))
          .map(f => ({ 구분: '시설', 대상: f.이름, 담당자: f.담당자, v: f }));
      } else {
        // 교육·신고: 이 고시가 사업장에 실제 영향을 줄 때만 (수량기준 고시는 해당 물질이 있는 사업장만)
        if (changedCAS.length && !site.물질.some(m => changedCAS.includes(m.CAS))) continue;
        if (r.대상 === '교육' && n.영향규칙.some(x => x.대상 === '변경관리') && !site.변경관리.some(m => m.상태 === '진행' && m.계획서_제출예정)) continue;
        ents = [{ 구분: r.대상 === '교육' ? '교육' : '신고·제출', 대상: `${site.약칭} ${r.대상명}`, 담당자: pickPerson(r.부서, site), v: {} }];
      }
      for (const e of ents) push({ 구분: e.구분, 대상: e.대상, 영향: fill(r.영향, e.v), 조치: r.조치, 담당자: e.담당자, 기한: due(r.기한, e.v), 신뢰도: r.신뢰도 });
    }
    // 문서: 관련 조문이 바뀐 조문과 연결된 사업장 문서 (수량기준 고시는 해당 물질이 있는 사업장만)
    if (changedCAS.length && !site.물질.some(m => changedCAS.includes(m.CAS))) continue;
    const aff = site.물질.filter(m => changedCAS.includes(m.CAS)).map(m => ({ m, q: n.수량변경.find(x => x.CAS === m.CAS) }));
    const dv = { 사업장: site.사업장,
      수량표_구: aff.map(({ m, q }) => `${m.이름} 하위 ${q.하위_구} t (배수 ${(m.최대보유량_t / q.하위_구).toFixed(1)})`).join(' / '),
      수량표_신: aff.map(({ m, q }) => `${m.이름} 하위 ${q.하위_신} t (배수 ${(m.최대보유량_t / q.하위_신).toFixed(1)})`).join(' / '),
      규정수량_구: aff.map(({ m, q }) => `${m.이름} … 하위 규정수량 ${q.하위_구} 톤`).join(' / '),
      규정수량_신: aff.map(({ m, q }) => `${m.이름} … 하위 규정수량 ${q.하위_신} 톤`).join(' / ') };
    for (const d of site.문서) {
      const hit = docLinks(d).some(x => ids.some(id => id === x || id.startsWith(x + '-')));
      if (!hit) continue;
      const recs = (n.문서수정 || []).filter(x => x.문서 === d.유형).map(x => ({ ...x, 현행: fill(x.현행, dv), 수정안: fill(x.수정안, dv), 채택: null })).map(x => ({ ...x, 최종: x.수정안 }));
      push({ 구분: '문서', 대상: `${d.이름} (${d.번호})`, 문서: d.id, 담당자: d.담당자, 기한: addDays(n.시행일, -30), 신뢰도: recs.length ? 0.9 : 0.62,
        영향: recs.length ? `개정 조문을 인용하는 문서 — 수정 위치 ${recs.length}곳 식별, 수정 문구 제안` : '관련 조문이 연결된 문서 — 수정 필요 여부 검토',
        조치: recs.length ? '수정안 검토·채택 후 문서 개정' : '문서 검토 (변경 불필요 시 확인 기록)', 수정안: recs });
    }
  }
  // 전사 지식: 규칙 수정과 지적·조치 가이드 (본사 관리)
  const seen = new Set();
  for (const p of n.규칙제안 || []) {
    if (seen.has(p.규칙)) continue; seen.add(p.규칙);
    const rule = B.규칙.find(r => r.id === p.규칙);
    items.push({ 사업장: 'HQ', 구분: '지식(규칙)', 대상: rule ? `판정 규칙 ${rule.id} ${rule.이름}` : '물질별 규정수량 표', 담당자: '김지훈', 기한: addDays(n.시행일, -21), 신뢰도: 0.95,
      영향: p.종류 === '확인' ? '판정 값 변경 없음 — 근거 문구 확인' : `${p.항목}: ${p.현행} → ${p.제안} (전 사업장 공통 적용)`, 조치: '④ 신·구 비교 화면에서 전문가 확인·승인', 근거: [p.근거], 규칙키: p.규칙 });
  }
  for (const g of impact(B, ids).가이드) {
    items.push({ 사업장: 'HQ', 구분: '지식(가이드)', 대상: `지적·조치 가이드 ${g.코드} ${g.지적유형}`, 담당자: '문소희', 기한: addDays(n.시행일, -21), 신뢰도: 0.82,
      영향: '권고 조치 문구에 개정 전 기준이 들어 있을 수 있음', 조치: '권고 조치 문구 갱신', 근거: ids });
  }
  return items.map((x, i) => ({ id: `${n.id}-${String(i + 1).padStart(2, '0')}`, 출처: 'AI', 상태: '대기', 판단: '확인 전', ...x }));
}

// ---------------------------------------------------------------- 초기 상태 (시연용: 일부 고시는 이미 진행 중)
function seed() {
  S = { v: 4, notices: {}, approvals: [], prop: {}, log: [], checked: null };
  for (const n of NOTICES.filter(n => n.초기상태)) {
    const st = n.초기상태;
    (n.규칙제안 || []).forEach((p, i) => { if (!st.규칙승인) return; S.prop[`${n.id}:${i}`] = '승인'; S.approvals.push({ notice: n.id, idx: i, 규칙: p.규칙, 종류: p.종류, 값: p.제안, CAS: p.CAS, 시행일: p.시행일, 근거: p.근거, 승인자: st.승인자, 일시: st.분석일 + ' 15:00', 의견: '개정 조문과 일치 확인' }); });
  }
  K = knowledge();
  for (const n of NOTICES.filter(n => n.초기상태)) {
    const st = n.초기상태;
    const tasks = analyze(n);
    tasks.forEach((t, i) => {
      t.판단 = '조치 대상'; t.판단자 = st.승인자.split(' ')[0];
      const na = (st.비대상 || []).find(x => x.사업장 === t.사업장 && t.대상.includes(x.포함));
      if (na) { t.판단 = '비대상'; t.판단사유 = na.사유; return; }
      const k = (i * 7) % 10;
      if (st.완료 === 'all' || k < (st.완료비율 || 0) * 10) t.상태 = '완료';
      else if (k < ((st.완료비율 || 0) + (st.진행비율 || 0)) * 10) t.상태 = '진행 중';
      if (t.규칙키 && st.규칙승인) t.상태 = '완료';
      if (t.상태 === '완료' && t.수정안) t.수정안.forEach(r => { r.채택 = '채택'; });
    });
    S.notices[n.id] = { 분석일: st.분석일, tasks };
    S.log.push({ t: st.분석일 + ' 09:10', who: 'AI', msg: `${n.id} 영향도 분석 — 조치 ${tasks.length}건 제안` });
    if (st.규칙승인) S.log.push({ t: st.분석일 + ' 15:00', who: st.승인자.split(' ')[0], msg: `${n.id} 규칙 반영 제안 승인` });
  }
  S.log.sort((a, b) => a.t < b.t ? 1 : -1);
  save();
}
try { S = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { S = null; }
if (!S || S.v !== 4) seed();
K = knowledge();

function nstate(n) {
  const s = S.notices[n.id];
  if (!s) return '신규';
  const t = s.tasks.filter(act);
  if (t.length && t.every(x => x.상태 === '완료')) return '완료';
  if (t.some(x => x.상태 !== '대기')) return '조치 중';
  return '분석 완료';
}
const stPill = st => `<span class="pill ${{ 신규: 'red', '분석 완료': 'navy', '조치 중': 'orange', 완료: 'green' }[st]}">${st}</span>`;
const act = x => x.판단 !== '비대상';
const JD = ['확인 전', '조치 대상', '비대상'];
const taskPill = st => `<span class="pill ${{ 대기: 'gray', '진행 중': 'orange', 완료: 'green' }[st]}">${st}</span>`;

// ---------------------------------------------------------------- 탭
let curTab = 't1';
function showTab(t) {
  curTab = t;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.t === t));
  ['t1', 't2', 't3', 't4', 't5', 't6', 't7'].forEach(x => $(x).classList.toggle('hidden', x !== t));
  render();
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.t));
let cur = NOTICES[0]?.id;
const noticeOpts = () => NOTICES.map(n => `<option value="${n.id}" ${n.id === cur ? 'selected' : ''}>[${nstate(n)}] ${esc(n.제목)}</option>`).join('');
const N = () => NOTICES.find(n => n.id === cur);
function goNotice(id, tab) { cur = id; showTab(tab); }

// ---------------------------------------------------------------- 단어 단위 비교
function diffHtml(a, b) {
  const A = a.split(/(\s+)/), Bt = b.split(/(\s+)/);
  const m = A.length, n = Bt.length, L = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = A[i] === Bt[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0, j = 0, oldH = '', newH = '';
  while (i < m && j < n) {
    if (A[i] === Bt[j]) { oldH += esc(A[i]); newH += esc(Bt[j]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { oldH += `<del>${esc(A[i])}</del>`; i++; }
    else { newH += `<ins>${esc(Bt[j])}</ins>`; j++; }
  }
  while (i < m) oldH += `<del>${esc(A[i++])}</del>`;
  while (j < n) newH += `<ins>${esc(Bt[j++])}</ins>`;
  return { oldH, newH };
}
const cmpBox = (a, b, h1 = '현행', h2 = '개정') => { const d = diffHtml(a, b); return `<div class="cmp diff"><div class="old"><div class="h">${h1}</div>${d.oldH}</div><div class="new"><div class="h">${h2}</div>${d.newH}</div></div>`; };

// ================================================================ ① 사업장 현황
function renderSite() {
  const st = x => x === '기한 경과' ? 'red' : x === '임박' ? 'orange' : 'green';
  const INSP = Object.fromEntries(SITES.map(site => [site.id, inspectionSchedule(K, site, base())]));
  // 사업장 카드 (클릭하면 해당 사업장만 보기)
  $('siteKpi').innerHTML = SITES.map(site => {
    const near = INSP[site.id].filter(r => r.상태 !== '정상').length;
    const acc = site.물질.filter(m => m.구분.includes('사고대비')).length;
    const mocs = site.변경관리.filter(m => m.상태 === '진행').length;
    const on = curSite === site.id;
    return `<div class="ncard" data-site="${site.id}" style="${on ? 'border-color:var(--blue);box-shadow:0 0 0 2px var(--lblue)' : ''}">
      <div class="row between"><b style="font-size:16px;color:var(--navy)">${esc(site.사업장)}</b><span class="pill line">${site.사업장군}</span></div>
      <div class="muted" style="margin:2px 0 10px">${esc(site.기본정보.업종)} · ${esc(site.기본정보.종업원)}</div>
      <div class="grid4" style="gap:6px">
        <div><div style="font-size:19px;font-weight:800;color:var(--navy)">${site.물질.length}</div><div class="muted small">유해화학물질 (사고대비 ${acc})</div></div>
        <div><div style="font-size:19px;font-weight:800;color:var(--navy)">${site.시설.length}</div><div class="muted small">취급시설</div></div>
        <div><div style="font-size:19px;font-weight:800;color:${near ? 'var(--red)' : 'var(--navy)'}">${near}</div><div class="muted small">검사 임박·경과</div></div>
        <div><div style="font-size:19px;font-weight:800;color:var(--navy)">${mocs}</div><div class="muted small">진행 중 변경</div></div>
      </div></div>`;
  }).join('');
  const ss = selSites(), multi = ss.length > 1;
  const sc = id => multi ? `<td>${sitePill(id)}</td>` : '';
  const sh = multi ? '<th>사업장</th>' : '';
  $('siteBasic').innerHTML = ss.map(site => { const bi = site.기본정보; return (multi ? `<b style="grid-column:1/3;color:var(--navy);margin-top:6px">${esc(site.사업장)}</b>` : '') +
    [['회사', bi.회사], ['사업장', site.사업장], ['업종', bi.업종], ['소재지', bi.소재지], ['종업원', bi.종업원], ['사업장 군', site.사업장군], ['유해화학물질관리자', bi.유해화학물질관리자], ['취급자 교육', bi.취급자_교육_이수율]]
      .filter(([k]) => !multi || !['회사', '사업장'].includes(k)).map(([k, v]) => `<b>${k}</b><span>${esc(v)}</span>`).join(''); }).join('');
  $('permitTable').innerHTML = `<tr>${sh}<th>허가 종류</th><th>허가번호</th><th>최근 변경</th></tr>` + ss.flatMap(site => site.영업허가.map(p => `<tr>${sc(site.id)}<td>${esc(p.종류)}</td><td class="small">${esc(p.번호)}</td><td>${p.최근변경}</td></tr>`)).join('');
  $('planInfo').innerHTML = ss.map(site => { const pl = site.계획서; return (multi ? `<b style="grid-column:1/3;color:var(--navy);margin-top:6px">${esc(site.사업장)}</b>` : '') +
    [['최초 제출', pl.최초제출], ['최근 변경 제출', pl.최근변경제출], ['이행점검', pl.이행점검], ['결과', pl.결과], ['총괄영향범위', pl.총괄영향범위]].map(([k, v]) => `<b>${k}</b><span>${esc(v)}</span>`).join(''); }).join('');
  $('chemTable').innerHTML = `<tr>${sh}<th>물질</th><th>CAS</th><th>UN</th><th>구분</th><th class="num">최대 보유량</th><th class="num">하위 규정수량</th><th class="num">배수</th><th class="num">상위 규정수량</th><th>취급시설</th><th>MSDS 개정</th></tr>` +
    ss.flatMap(site => site.물질.map(m => {
      const q = qtyAt(m, base());
      const mul = m.최대보유량_t / q.하위;
      return `<tr>${sc(site.id)}<td><b>${esc(m.이름)}</b></td><td>${m.CAS}</td><td>${m.UN}</td><td class="small">${esc(m.구분)}</td><td class="num">${m.최대보유량_t} t</td>
        <td class="num">${q.하위} t${q.예정 ? `<br><span class="pill orange">${q.예정.시행일}부터 ${q.예정.하위} t</span>` : ''}</td>
        <td class="num"><b>${mul.toFixed(1)}</b>${q.예정 ? `<br><span class="muted">→ ${(m.최대보유량_t / q.예정.하위).toFixed(1)}</span>` : ''}</td><td class="num">${q.상위} t</td><td>${m.시설.join(', ')}</td><td>${m.MSDS개정}</td></tr>`;
    })).join('');
  const r242 = activeVersion(K.규칙.find(r => r.id === 'R-24-2'), base());
  $('facDesc').textContent = `다음 검사 기한은 규칙 R-24-2 v${r242.버전}(사업장 군별 결정표)으로 기준일 ${base()}에 계산 — ${ss.map(x => `${x.약칭} ${x.사업장군}`).join(' · ')}`;
  $('facTable').innerHTML = `<tr>${sh}<th>시설</th><th>유형</th><th>취급 물질</th><th>용량</th><th>위험도</th><th>방류벽</th><th>누출감지</th><th>최근 검사</th><th>주기</th><th>다음 기한</th><th>상태</th><th>담당</th></tr>` +
    ss.flatMap(site => site.시설.map((f, i) => { const r = INSP[site.id][i]; return `<tr>${sc(site.id)}<td><b>${esc(f.이름)}</b></td><td>${esc(f.유형)}</td><td class="small">${f.물질.map(id => esc(site.물질.find(m => m.id === id)?.이름)).join(', ')}</td><td>${esc(f.용량)}</td><td>${f.위험도}</td><td class="small">${esc(f.방류벽)}</td><td>${esc(f.누출감지)}</td><td>${f.최근_검사일}</td><td>${r.주기_년}년${r.연장_년 ? ` +${r.연장_년}` : ''}</td><td><b>${r.기한}</b> <span class="muted">${dday(r.기한)}</span></td><td><span class="pill ${st(r.상태)}">${r.상태}</span></td><td>${esc(f.담당자)}</td></tr>`; })).join('');
  $('mocTable').innerHTML = `<tr>${sh}<th>변경 건</th><th>변경 유형</th><th>완료 예정</th><th>계획서 제출 기한</th><th>상태</th></tr>` +
    ss.flatMap(site => site.변경관리.map(m => { const d = m.상태 === '진행' ? mocDue(m, base()) : null; const chg = d && m.계획서_제출예정 && d !== m.계획서_제출예정;
      return `<tr>${sc(site.id)}<td><b>${m.id}</b><br>${esc(m.이름)}<div class="muted">${esc(m.담당자)}</div></td><td class="small">${esc(m.변경유형)}</td><td>${m.변경완료_예정일}</td>
      <td>${d ? `<b>${d}</b> <span class="small" style="${d < base() ? 'color:var(--red);font-weight:700' : 'color:var(--sub)'}">${dday(d)}</span>${chg ? `<br><span class="pill red">기존 계획 ${m.계획서_제출예정}</span>` : ''}` : '-'}</td><td>${m.상태 === '진행' ? '<span class="pill orange">진행</span>' : '<span class="pill gray">완료</span>'}</td></tr>`; })).join('');
  $('docTable').innerHTML = `<tr>${sh}<th>문서</th><th>개정</th><th>담당</th><th>연결 조문</th></tr>` +
    ss.flatMap(site => site.문서.map(d => `<tr>${sc(site.id)}<td><b>${esc(d.이름)}</b><div class="muted">${d.번호}</div></td><td class="small">${esc(d.개정)}</td><td style="white-space:nowrap">${esc(d.담당자)}</td><td class="small">${docLinks(d).map(x => x === 'QTY' ? '수량기준 고시' : x).join(', ')}</td></tr>`)).join('');
}
$('siteKpi').onclick = e => { const c = e.target.closest('[data-site]'); if (!c) return; setSite(curSite === c.dataset.site ? 'ALL' : c.dataset.site); };
function setSite(id) { curSite = id; $('siteSel').value = id; render(); }

// ================================================================ ② 모니터링
const SOURCES = [['법제처 현행법령 (화학물질관리법·시행령·시행규칙)', 'Open API'], ['국가법령정보센터 행정규칙 (화학물질안전원·환경부 고시)', 'Open API'], ['입법예고 (국민참여입법센터)', '목록 수집'], ['화학물질안전원 공지사항', '목록 수집']];
function renderMonitor() {
  const ck = S.checked || '오늘 06:00';
  $('sources').innerHTML = SOURCES.map(([a, b]) => `<div class="src"><span>${esc(a)}<br><span class="muted">${b} · 최근 확인 ${esc(ck)}</span></span><span class="ok">정상</span></div>`).join('');
  $('noticeList').innerHTML = NOTICES.map(n => {
    const st = nstate(n), s = S.notices[n.id];
    const done = s ? s.tasks.filter(t => t.상태 === '완료').length : 0;
    return `<div class="result ${st === '신규' ? 'hit' : ''}">
      <div class="row between"><div>${stPill(st)} <span class="pill line">${esc(n.구분)}</span> <span class="muted">${esc(n.발령기관)} · ${esc(n.공포번호)}</span></div><span class="muted">감지 ${n.감지일} · ${esc(n.감지경로)}</span></div>
      <h3 style="margin:8px 0 4px">${esc(n.제목)}</h3>
      <p class="muted" style="margin:0 0 8px">${esc(n.요약)}</p>
      <div class="row between"><div class="row small"><span>공포 <b>${n.공포일}</b></span><span>시행 <b>${n.시행일}</b> <span class="muted">(${dday(n.시행일)})</span></span><span>바뀐 조문 <b>${n.변경조문.length}</b>건</span>${s ? `<span>조치 <b>${done}/${s.tasks.length}</b> 완료</span>` : ''}</div>
      ${s ? `<div class="chips" style="margin:6px 0 0">${SITES.map(x => { const c = s.tasks.filter(t => t.사업장 === x.id).length; return `<span class="chip">${esc(x.약칭)} <b>${c ? c + '건' : '영향 없음'}</b></span>`; }).join('')}</div>` : ''}
      <div class="row"><button class="btn ghost sm" data-cmp="${n.id}">신·구 비교</button><button class="btn ${s ? 'blue' : 'orange'} sm" data-ana="${n.id}">${s ? '조치 목록 보기' : '우리 사업장 영향도 분석'}</button></div></div></div>`;
  }).join('');
  const nnew = NOTICES.filter(n => nstate(n) === '신규').length;
  $('newDot').textContent = nnew; $('newDot').classList.toggle('hidden', !nnew);
}
$('noticeList').onclick = e => {
  const c = e.target.closest('[data-cmp]'), a = e.target.closest('[data-ana]');
  if (c) goNotice(c.dataset.cmp, 't4');
  if (a) { const id = a.dataset.ana; goNotice(id, 't3'); if (!S.notices[id]) runAnalysis(); }
};
$('checkNow').onclick = () => {
  $('checkMsg').textContent = '확인 중… (조문 해시 비교)';
  $('checkNow').disabled = true;
  setTimeout(() => {
    S.checked = nowStr(); log('법령·고시 수동 확인 — 새 개정 없음 (기존 감지 건 유지)', '시스템'); save();
    $('checkNow').disabled = false;
    $('checkMsg').innerHTML = `<span class="ok">완료</span> · 감시 대상 4곳, 추가 개정 없음 (미처리 ${NOTICES.filter(n => nstate(n) === '신규').length}건)`;
    renderMonitor();
  }, 1200);
};

// ================================================================ ③ 영향 분석·조치
function noticeHead(n) {
  return `<div class="row" style="gap:6px">${stPill(nstate(n))}<span class="pill line">${esc(n.구분)}</span><b style="color:var(--navy)">${esc(n.제목)}</b></div>
    <div class="row small muted" style="margin-top:6px"><span>${esc(n.공포번호)}</span><span>공포 ${n.공포일}</span><span>시행 <b style="color:var(--text)">${n.시행일}</b> (${dday(n.시행일)})</span><span>${esc(n.요약)}</span></div>`;
}
const ALLCHEM = Object.values(SITES.reduce((a, x) => { x.물질.forEach(m => { (a[m.CAS] ||= { ...m, 사업장들: [] }).사업장들.push(x.id); }); return a; }, {}));
const SUM = k => SITES.reduce((a, x) => a + x[k].length, 0);
const STEPS = n => [`바뀐 조문 ${n.변경조문.length}건 읽기 · 변경 요지 추출`, `사업장 ${SITES.length}곳 데이터와 대조 (${SITES.map(x => x.약칭).join('·')} — 물질 ${SUM('물질')}종 · 시설 ${SUM('시설')}개 · 변경관리 ${SUM('변경관리')}건)`,
  `사업장별 사내 문서 ${SUM('문서')}건에서 수정 위치 탐색 · 수정 문구 작성`, '판정 규칙 · 지적·조치 가이드 연결 추적', '조치 목록 · 담당자 · 기한 제안'];
function runAnalysis(after) {
  const n = N();
  const steps = STEPS(n);
  let k = 0;
  const draw = () => { $('anaBox').innerHTML = `<div class="card"><h2>AI 영향도 분석 중…</h2><p class="desc">시연에서는 미리 만든 AI 결과를 재생하고, 사업장 데이터 대조는 실제로 계산합니다.</p><ul class="steps">${steps.map((s, i) => `<li class="${i < k ? 'done' : i === k ? 'run' : 'wait'}">${esc(s)}</li>`).join('')}</ul></div>`; };
  draw();
  const tick = () => {
    k++; draw();
    if (k < steps.length) return setTimeout(tick, 550);
    const tasks = analyze(n);
    tasks.filter(x => x.규칙키 && n.규칙제안.every((q, k) => q.규칙 !== x.규칙키 || S.prop[`${n.id}:${k}`])).forEach(x => { x.상태 = '완료'; x.판단 = '조치 대상'; x.판단자 = '김지훈'; });
    S.notices[n.id] = { 분석일: base(), tasks };
    if (after) after();
    log(`${n.id} 영향도 분석 — 조치 ${tasks.length}건 제안`, 'AI'); save();
    setTimeout(() => { renderAna(); toast(`AI가 영향 항목 ${tasks.length}건을 찾았습니다. 담당자·기한을 확인하세요.`); }, 300);
  };
  setTimeout(tick, 550);
}
function renderAna() {
  $('selN3').innerHTML = noticeOpts();
  const n = N();
  $('nHead3').innerHTML = noticeHead(n);
  const s = S.notices[n.id];
  if (!s) {
    $('anaBox').innerHTML = `<div class="card" style="text-align:center;padding:36px"><h2>아직 분석하지 않은 고시입니다</h2><p class="desc">AI가 바뀐 조문을 읽고 우리 사업장의 물질·시설·변경관리·사내 문서·판정 규칙과 대조해 조치 목록을 만듭니다.</p><button class="btn orange big" id="anaBtn">우리 사업장 영향도 분석</button></div>`;
    $('anaBtn').onclick = runAnalysis;
    return;
  }
  const all = s.tasks, t = all.filter(inSite), ta = t.filter(act);
  const bySite = [...SITES.map(x => x.id), 'HQ'].map(id => { const xs = all.filter(x => x.사업장 === id), xa = xs.filter(act);
    return { id, n: xs.length, w: xs.filter(x => x.판단 === '확인 전').length, na: xs.length - xa.length, d: xa.filter(x => x.상태 === '완료').length, a: xa.length }; });
  const cnt = {}; ta.forEach(x => cnt[x.구분] = (cnt[x.구분] || 0) + 1);
  const done = ta.filter(x => x.상태 === '완료').length, prog = ta.filter(x => x.상태 === '진행 중').length;
  const over = ta.filter(x => x.상태 !== '완료' && x.기한 < base()).length;
  const jw = t.filter(x => x.판단 === '확인 전').length, jy = t.filter(x => x.판단 === '조치 대상').length, jn = t.filter(x => x.판단 === '비대상').length;
  const docRecs = t.filter(x => x.수정안).flatMap(x => x.수정안);
  $('anaBox').innerHTML = `
  <div class="card">
    <div class="row between"><div><h2>영향 분석 결과 · 조치 목록</h2><p class="desc" style="margin:0">분석일 ${s.분석일} · AI 제안 ${t.filter(x => x.출처 === 'AI').length}건 · 직접 추가 ${t.filter(x => x.출처 !== 'AI').length}건 · 담당자가 AI 추천을 확인해 조치 대상·비대상을 판단합니다. 담당자와 기한은 바로 바꿀 수 있습니다.</p></div>
      <div class="row noprint">${jw ? `<button class="btn blue sm" id="bulkBtn">확인 전 ${jw}건 모두 조치 대상</button>` : ''}<button class="btn ghost sm" id="notifyBtn">담당자 알림 발송</button><button class="btn ghost sm" id="csvBtn">엑셀(CSV) 내보내기</button><button class="btn ghost sm" id="reBtn">다시 분석</button></div></div>
    <div class="chips"><span class="chip" style="${jw ? 'border-color:var(--orange);background:var(--lorange)' : ''}">판단 대기 <b>${jw}</b></span><span class="chip">조치 대상 <b>${jy}</b></span><span class="chip">비대상 <b>${jn}</b></span><span class="muted" style="align-self:center">|</span>${Object.entries(cnt).map(([k, v]) => `<span class="chip">${esc(k)} <b>${v}</b></span>`).join('')}<span class="chip">문서 수정 제안 <b>${docRecs.length}</b>곳 (채택 ${docRecs.filter(r => r.채택).length})</span></div>
    <div class="chips">${bySite.map(b => `<span class="chip" data-site="${b.id === 'HQ' ? 'ALL' : b.id}" style="cursor:pointer;${curSite === b.id ? 'border-color:var(--blue);background:var(--bg)' : ''}">${esc(siteName(b.id))} <b>${b.n ? `${b.n}건` : '영향 없음'}</b>${b.n ? ` · 완료 ${b.a ? Math.round(b.d / b.a * 100) : 0}%${b.w ? ` · 판단 대기 ${b.w}` : ''}` : ''}</span>`).join('')}</div>
    <div class="prog"><span class="d" style="width:${ta.length ? done / ta.length * 100 : 0}%"></span><span class="p" style="width:${ta.length ? prog / ta.length * 100 : 0}%"></span></div>
    <div class="legend"><span><i style="background:var(--green)"></i>완료 ${done}</span><span><i style="background:var(--orange)"></i>진행 중 ${prog}</span><span><i style="background:#E3E9F2"></i>대기 ${ta.length - done - prog}</span><span>(비대상 ${jn}건 제외)</span>${over ? `<span style="color:var(--red);font-weight:700">기한 경과 ${over}</span>` : ''}</div>
    <div class="scroll" style="margin-top:12px"><table class="tasks" id="taskTable">
      <tr><th>사업장</th><th>구분</th><th style="min-width:280px">영향 대상 · 내용</th><th>조치</th><th style="min-width:150px">담당자 판단</th><th>담당자</th><th>기한</th><th>상태</th><th class="noprint"></th></tr>
      ${all.map((x, i) => inSite(x) ? taskRow(x, i) : '').join('')}
    </table></div>
  </div>
  <div class="card noprint">
    <h2>조치 항목 직접 추가</h2>
    <div class="row" style="align-items:flex-end">
      <label class="field"><span>사업장</span><select id="adSite">${SITES.map(x => `<option value="${x.id}" ${x.id === curSite ? 'selected' : ''}>${esc(x.약칭)}</option>`).join('')}<option value="HQ">본사 공통</option></select></label>
      <label class="field"><span>구분</span><select id="adKind">${['설비 변경', '시설', '물질', '문서', '교육', '신고·제출', '지식(규칙)', '기타'].map(k => `<option>${k}</option>`).join('')}</select></label>
      <label class="field" style="flex:1;min-width:180px"><span>대상</span><input type="text" id="adTarget" style="width:100%" placeholder="예: P-301 벤젠 이송배관"></label>
      <label class="field" style="flex:1.4;min-width:200px"><span>조치 내용</span><input type="text" id="adAction" style="width:100%" placeholder="예: 배관 표지 교체"></label>
      <label class="field"><span>담당자</span><select id="adOwner">${personOpts('', curSite === 'ALL' ? 'ULS' : curSite)}</select></label>
      <label class="field"><span>기한</span><input type="date" id="adDue" value="${addDays(n.시행일, -14)}"></label>
      <div class="field"><button class="btn blue" id="adBtn">추가</button></div>
    </div>
  </div>`;
  $('taskTable').onchange = onTaskChange;
  $('taskTable').onclick = onTaskClick;
  $('anaBox').querySelectorAll('.chip[data-site]').forEach(c => c.onclick = () => setSite(c.dataset.site));
  $('adSite').onchange = e => { $('adOwner').innerHTML = personOpts('', e.target.value); };
  $('reBtn').onclick = () => { if (confirmBox('다시 분석하면 AI 제안 항목의 담당자·기한·상태가 초기화됩니다. (직접 추가한 항목은 유지)')) { const manual = all.filter(x => x.출처 !== 'AI'); delete S.notices[n.id]; runAnalysis(() => S.notices[n.id].tasks.push(...manual)); } };
  $('csvBtn').onclick = () => exportCsv(n, t);
  if ($('bulkBtn')) $('bulkBtn').onclick = () => { t.filter(x => x.판단 === '확인 전').forEach(x => { x.판단 = '조치 대상'; x.판단자 = '김지훈'; }); log(`${n.id} AI 추천 ${jw}건 일괄 확인 → 조치 대상`); save(); renderAna(); toast(`${jw}건을 조치 대상으로 확정했습니다`); };
  $('notifyBtn').onclick = () => {
    const by = {}; t.filter(x => x.판단 === '조치 대상' && x.상태 !== '완료').forEach(x => (by[x.담당자] ||= []).push(x));
    Object.entries(by).forEach(([p, xs]) => log(`알림 발송 → ${p}: ${n.id} 조치 ${xs.length}건 (가장 빠른 기한 ${xs.map(x => x.기한).sort()[0]})`, '시스템'));
    save(); toast(`담당자 ${Object.keys(by).length}명에게 알림을 보냈습니다 (시연: 이력에만 기록)`);
  };
  $('adBtn').onclick = () => {
    const 대상 = $('adTarget').value.trim(), 조치 = $('adAction').value.trim();
    if (!대상 || !조치) return toast('대상과 조치 내용을 입력하세요');
    all.push({ id: `${n.id}-M${all.filter(x => x.출처 !== 'AI').length + 1}`, 사업장: $('adSite').value, 출처: '직접', 상태: '대기', 판단: '조치 대상', 판단자: '김지훈', 구분: $('adKind').value, 대상, 영향: '담당자 직접 추가', 조치, 담당자: $('adOwner').value, 기한: $('adDue').value, 근거: [] });
    log(`${n.id} 조치 직접 추가: ${대상} — ${조치}`); save(); renderAna(); toast('조치 항목을 추가했습니다');
  };
}
function confirmBox(msg) { return window.confirm(msg); }
function taskRow(x, i) {
  const na = x.판단 === '비대상', wait = x.판단 === '확인 전';
  const over = !na && x.상태 !== '완료' && x.기한 < base();
  const src = x.출처 === 'AI' ? `<span class="ai">AI ${Math.round((x.신뢰도 || 0) * 100)}%</span>` : '<span class="man">직접</span>';
  let recs = '';
  if (x.수정안 && x.수정안.length) {
    recs = `<details ${x.수정안.some(r => !r.채택) && x.상태 !== '완료' ? '' : ''}><summary>AI 문서 수정안 ${x.수정안.length}곳 (채택 ${x.수정안.filter(r => r.채택).length})</summary>${x.수정안.map((r, j) => `
      <div class="rec"><div class="row between"><span class="loc">${esc(r.위치)}</span>${r.채택 ? `<span class="pill green">${r.채택}</span>` : '<span class="pill gray">검토 대기</span>'}</div>
      ${cmpBox(r.현행, r.최종 || r.수정안, '현행 문구', r.채택 === '수정 채택' ? '최종 문구 (담당자 수정)' : 'AI 수정안')}
      <div class="muted" style="margin-top:4px">사유: ${esc(r.사유)}</div>
      <div class="row noprint" style="margin-top:6px"><button class="btn green sm" data-adopt="${i}:${j}">채택</button><button class="btn ghost sm" data-edit="${i}:${j}">문구 수정 후 채택</button>${r.채택 ? `<button class="btn ghost sm" data-undo="${i}:${j}">채택 취소</button>` : ''}</div>
      <div class="hidden" id="ed-${i}-${j}"><textarea>${esc(r.최종 || r.수정안)}</textarea><button class="btn blue sm" data-save="${i}:${j}">저장·채택</button></div></div>`).join('')}</details>`;
  }
  const link = x.규칙키 ? ` <a href="#" data-rule="1" class="small">→ 승인 화면</a>` : '';
  const jc = { '확인 전': 'orange', '조치 대상': 'navy', 비대상: 'gray' }[x.판단];
  const judge = `<select data-f="판단" style="border-color:var(--${jc === 'gray' ? 'line' : jc});font-weight:700">${JD.map(v => `<option ${v === x.판단 ? 'selected' : ''}>${v}</option>`).join('')}</select>
    ${x.출처 === 'AI' ? `<div class="small muted" style="margin-top:3px">AI 추천: ${(x.신뢰도 || 0) < 0.7 ? '검토 필요' : '조치 대상'}</div>` : ''}
    ${na ? `<textarea data-f="판단사유" placeholder="비대상 사유 (필수)" style="min-height:52px;margin-top:4px;font-size:12px;${x.판단사유 ? '' : 'border-color:var(--red)'}">${esc(x.판단사유 || '')}</textarea>` : ''}
    ${!wait && x.판단자 ? `<div class="small muted" style="margin-top:3px">확인: ${esc(x.판단자)}</div>` : ''}`;
  return `<tr class="${over ? 'over' : ''} ${na ? 'na' : ''}" data-i="${i}">
    <td>${sitePill(x.사업장)}</td>
    <td><span class="pill line">${esc(x.구분)}</span><br>${src}</td>
    <td><b>${esc(x.대상)}</b><div class="muted">${esc(x.영향)}</div>${recs}</td>
    <td class="small">${esc(x.조치)}${link}</td>
    <td>${judge}</td>
    <td><select data-f="담당자">${personOpts(x.담당자, x.사업장 === 'HQ' ? null : x.사업장)}</select></td>
    <td><input type="date" data-f="기한" value="${x.기한}"><div class="small ${over ? '' : 'muted'}" style="${over ? 'color:var(--red);font-weight:700' : ''}">${dday(x.기한)}</div></td>
    <td>${na ? '<span class="pill gray">해당 없음</span>' : `<select data-f="상태" ${wait ? 'disabled title="먼저 조치 대상 여부를 확인하세요"' : ''}>${ST.map(s => `<option ${s === x.상태 ? 'selected' : ''}>${s}</option>`).join('')}</select>${wait ? '<div class="small muted">판단 후 진행</div>' : ''}`}</td>
    <td class="noprint">${x.출처 !== 'AI' ? `<button class="btn ghost sm" data-del="${i}">삭제</button>` : ''}</td></tr>`;
}
function onTaskChange(e) {
  const f = e.target.dataset.f; if (!f) return;
  const i = +e.target.closest('tr').dataset.i, n = N(), x = S.notices[n.id].tasks[i];
  const old = x[f]; x[f] = e.target.value;
  if (f === '판단') {
    x.판단자 = '김지훈';
    if (x[f] === '비대상') { x.판단사유 = x.판단사유 || ''; toast('비대상 사유를 입력하세요 (감사 대응용 기록)'); }
    if (x[f] !== '비대상') delete x.판단사유;
  }
  if (f === '판단사유') { log(`${x.id} 비대상 사유: ${x[f]} (${x.대상})`); save(); return renderAna(); }
  log(`${x.id} ${f} 변경: ${old} → ${x[f]} (${x.대상})`); save(); renderAna();
}
function onTaskClick(e) {
  const n = N(), t = S.notices[n.id].tasks, el = e.target;
  const ij = s => s.split(':').map(Number);
  if (el.dataset.rule) { e.preventDefault(); return showTab('t4'); }
  if (el.dataset.del) { const x = t.splice(+el.dataset.del, 1)[0]; log(`${n.id} 조치 삭제: ${x.대상}`); save(); return renderAna(); }
  if (el.dataset.adopt || el.dataset.undo || el.dataset.save) {
    const [i, j] = ij(el.dataset.adopt || el.dataset.undo || el.dataset.save), r = t[i].수정안[j];
    if (el.dataset.adopt) { r.채택 = '채택'; r.최종 = r.수정안; }
    if (el.dataset.undo) { r.채택 = null; r.최종 = r.수정안; }
    if (el.dataset.save) { r.최종 = el.previousElementSibling.value; r.채택 = r.최종 === r.수정안 ? '채택' : '수정 채택'; }
    if (r.채택 && t[i].상태 === '대기') t[i].상태 = '진행 중';
    if (t[i].수정안.every(q => q.채택) && t[i].상태 !== '완료') toast('모든 수정 위치를 채택했습니다. 문서 개정 후 상태를 완료로 바꾸세요');
    log(`${t[i].id} 문서 수정안 ${r.채택 || '채택 취소'}: ${r.위치}`); save(); renderAna();
    const det = $('taskTable').querySelector(`tr[data-i="${i}"] details`); if (det) det.open = true;
    return;
  }
  if (el.dataset.edit) { const [i, j] = ij(el.dataset.edit); $(`ed-${i}-${j}`).classList.toggle('hidden'); }
}
function exportCsv(n, t) {
  const rows = [['번호', '사업장', '구분', '대상', '영향', '조치', '담당자 판단', '비대상 사유', '판단자', '담당자', '기한', '상태', '출처', '근거']].concat(t.map(x => [x.id, siteName(x.사업장), x.구분, x.대상, x.영향, x.조치, x.판단, x.판단사유 || '', x.판단자 || '', x.담당자, x.기한, x.판단 === '비대상' ? '해당 없음' : x.상태, x.출처 === 'AI' ? `AI(${Math.round(x.신뢰도 * 100)}%)` : '직접', (x.근거 || []).join(' ')]));
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `${n.id}_조치목록.csv`; a.click();
}
$('selN3').onchange = e => { cur = e.target.value; renderAna(); };
$('cmpLink').onclick = () => showTab('t4');
$('printBtn').onclick = () => { document.querySelectorAll('#taskTable details').forEach(d => d.open = true); window.print(); };

// ================================================================ ④ 신·구 비교·규칙 반영
function renderCmp() {
  $('selN4').innerHTML = noticeOpts();
  const n = N();
  $('nHead4').innerHTML = noticeHead(n);
  $('cmpOut').innerHTML = n.변경조문.map(c => `<div style="margin-bottom:12px"><div class="row" style="margin-bottom:6px"><b style="color:var(--navy)">${esc(c.조문)}</b><span class="muted">${esc(c.제목)}</span><code>${esc(c.id)}</code></div>${cmpBox(c.구, c.신, '개정 전', `개정 후 (시행 ${n.시행일})`)}</div>`).join('');
  const pst = i => S.prop[`${n.id}:${i}`] || null;
  $('propOut').innerHTML = (n.규칙제안 || []).map((p, i) => {
    const st = pst(i);
    const rule = B.규칙.find(r => r.id === p.규칙);
    const field = p.종류 === '확인' ? `<span>${esc(p.제안)}</span>` :
      `<input type="${p.종류 === '필수항목추가' ? 'text' : 'number'}" id="pv-${i}" value="${esc(p.제안)}" ${st ? 'disabled' : ''} style="width:${p.종류 === '필수항목추가' ? 220 : 100}px">`;
    return `<div class="result ${st === '승인' ? '' : st === '반려' ? '' : 'hit'}">
      <div class="row between"><h3>${rule ? `${esc(rule.id)} ${esc(rule.이름)}` : '물질별 규정수량 표'} <span class="ai">AI 추출</span> <a href="#" class="small" data-kx="${p.규칙 === '수량기준' ? 'QTY' : p.규칙}">현재 지식 보기 ↓</a></h3>${st ? `<span class="pill ${st === '승인' ? 'green' : 'red'}">${st}</span>` : '<span class="pill orange">전문가 확인 대기</span>'}</div>
      <p class="muted" style="margin:0 0 8px">${esc(p.설명)}</p>
      <div class="kv"><b>변경 항목</b><span>${esc(p.항목)}</span><b>현행 값</b><span>${esc(p.현행)}</span><b>${p.종류 === '필수항목추가' ? '추가 항목' : '제안 값'}</b><span>${field}</span>
        <b>적용 시행일</b><span><input type="date" id="pd-${i}" value="${p.시행일}" ${st ? 'disabled' : ''}></span><b>근거 조문</b><span><code>${esc(p.근거)}</code></span>
        <b>승인자</b><span><select id="pa-${i}" ${st ? 'disabled' : ''}>${personOpts('김지훈')}</select></span><b>검토 의견</b><span><input type="text" id="pc-${i}" style="width:100%" placeholder="예: 개정 조문과 일치 확인" ${st ? 'disabled' : ''}></span></div>
      ${st ? '' : `<div class="row"><button class="btn green" data-ok="${i}">승인 · 지식에 반영</button><button class="btn ghost" data-no="${i}">반려</button></div>`}</div>`;
  }).join('') || '<p class="muted">규칙 변경 제안이 없습니다.</p>';
  renderKX();
}
$('selN4').onchange = e => { cur = e.target.value; renderCmp(); };
$('propOut').onclick = e => {
  const n = N(), ok = e.target.dataset.ok, no = e.target.dataset.no;
  const kx = e.target.closest('[data-kx]'); if (kx) { e.preventDefault(); ED.sel = kx.dataset.kx; ED.mode = 'view'; ED.draft = null; renderKX(); $('kx').scrollIntoView({ behavior: 'smooth' }); return; }
  if (ok === undefined && no === undefined) return;
  const i = +(ok ?? no), p = n.규칙제안[i];
  const ns = S.notices[n.id];
  if (no !== undefined) { S.prop[`${n.id}:${i}`] = '반려'; log(`${n.id} 규칙 제안 반려: ${p.항목}`); save(); return renderCmp(); }
  const a = { notice: n.id, idx: i, 규칙: p.규칙, 종류: p.종류, 값: p.종류 === '확인' ? null : (p.종류 === '필수항목추가' ? $(`pv-${i}`).value : Number($(`pv-${i}`).value)), CAS: p.CAS,
    시행일: $(`pd-${i}`).value, 근거: p.근거, 승인자: $(`pa-${i}`).value, 일시: nowStr(), 의견: $(`pc-${i}`).value };
  S.approvals.push(a); S.prop[`${n.id}:${i}`] = '승인';
  // 연결된 '지식(규칙)' 조치 항목 자동 완료
  const allDone = n.규칙제안.every((q, k) => q.규칙 !== p.규칙 || S.prop[`${n.id}:${k}`]);
  if (allDone && ns) ns.tasks.filter(t => t.규칙키 === p.규칙).forEach(t => { t.상태 = '완료'; t.판단 = '조치 대상'; t.판단자 = a.승인자; });
  log(`${n.id} 규칙 반영 승인: ${p.항목} ${p.현행} → ${a.값 ?? '변경 없음'} (시행 ${a.시행일})`, a.승인자);
  save(); K = knowledge(); ED.sel = p.규칙 === '수량기준' ? 'QTY' : p.규칙; ED.mode = 'view'; ED.draft = null; renderCmp(); showYaml(a);
  toast(`승인 완료 — ${a.시행일}부터 새 규칙 버전으로 판정합니다`);
};

// ================================================================ 지식 탐색기 (그래프 + 목록 + 편집)
const ED = { sel: 'R-23-3', mode: 'view', draft: null, q: '', hover: null };
const DOC_TYPES = SITES[0].문서.map(d => ({ 유형: d.유형, 이름: d.이름 }));
const refsOf = r => [...new Set(r.버전.flatMap(v => [...v.근거, ...[...JSON.stringify(v).matchAll(/"근거":"([^"]+)"/g)].map(m => m[1])]))];
const latest = r => r.버전.find(v => !v.폐지일) || r.버전[r.버전.length - 1];
const artLabel = id => { const a = (K.조문[id] || [])[0]; return a ? label(a) : id; };
const daysTxt = n => n < 0 ? `${-n}일 전` : n > 0 ? `${n}일 후` : '당일';
const FIELD_NAME = Object.fromEntries([['취급량_증가', '취급량 증가'], ['취급시설_용량_증가', '취급시설 용량 증가'], ['신규_취급시설', '새로운 취급시설 설치'], ['물질_변경_추가', '유해화학물질 변경·추가'], ['함량_농도_성상_변경', '함량·농도·성상 변경'], ['위험도_증가', '위험 증가'], ['시설_위치_변경', '사업장 내 시설 위치 변경']]);
const TYPE_COLOR = { 고시: '#C9822B', 조문: '#2D5FA8', 규칙: '#1B2F5B', 기준표: '#1B2F5B', 가이드: '#3A9B6A', 해석: '#B5487A', 문서: '#6B5BA8' };
const INT_KIND = ['유권해석', '질의회신', '컨설턴트 판단', '판례·심판', '내부 기준'];
const intOf = ruleId => K.해석.filter(x => x.적용규칙.includes(ruleId) && x.상태 !== '폐기');
const intCards = list => list.map(x => `<div class="cite" style="border-left:3px solid ${TYPE_COLOR.해석}"><span class="pill" style="background:${TYPE_COLOR.해석}">${esc(x.구분)}</span><span class="pill ${x.신뢰수준 === '공식' ? 'navy' : 'gray'}">${esc(x.신뢰수준)}</span>${x.상태 !== '유효' ? `<span class="pill orange">${esc(x.상태)}</span>` : ''} <b>${esc(x.제목)}</b><br>${esc(x.판단)}<div class="muted small">${esc(x.출처)} · 확인 ${esc(x.확인자)}${x.적용방법 ? ` · 적용: ${esc(x.적용방법)}` : ''}</div></div>`).join('');

// ---- 지식 그래프 구성
function kgraph() {
  const nodes = [], edges = [];
  const add = (id, type, label, sub, col) => nodes.push({ id, type, label, sub, col });
  const artKey = id => id.startsWith('QTY') ? 'QTY' : 'A:' + id;
  NOTICES.forEach(n => add('N:' + n.id, '고시', (n.제목.split('—')[1] || n.제목).trim(), `시행 ${n.시행일}`, 0));
  DOC_TYPES.forEach(d => add('D:' + d.유형, '문서', d.이름, `사업장 ${SITES.length}곳`, 0));
  Object.keys(K.조문).forEach(id => add('A:' + id, '조문', artLabel(id), K.조문[id][0].제목, 1));
  K.규칙.forEach(r => add(r.id, '규칙', `${r.id} ${r.이름}`, `${r.유형} · v${latest(r).버전}`, 2));
  add('QTY', '기준표', '물질별 규정수량 표', `물질 ${ALLCHEM.length}종`, 2);
  K.가이드.forEach(g => add('G:' + g.코드, '가이드', `${g.코드} ${g.지적유형}`, `규칙 ${g.규칙}`, 3));
  K.해석.forEach(x => add('I:' + x.id, '해석', x.제목.replace(/["']/g, ''), `${x.구분} · ${x.상태}`, 3));
  const has = id => nodes.some(n => n.id === id);
  const E = (a, b, t) => { if (has(a) && has(b) && !edges.some(e => e.a === a && e.b === b)) edges.push({ a, b, t }); };
  NOTICES.forEach(n => n.변경조문.forEach(c => E('N:' + n.id, artKey(c.id), '개정')));
  DOC_TYPES.forEach(d => docLinks(SITES[0].문서.find(x => x.유형 === d.유형)).forEach(id => E('D:' + d.유형, id === 'QTY' ? 'QTY' : 'A:' + id, '인용')));
  K.규칙.forEach(r => refsOf(r).forEach(id => E('A:' + id, r.id, '근거')));
  K.가이드.forEach(g => { E(g.규칙, 'G:' + g.코드, '연결'); g.근거.forEach(id => E('A:' + id, 'G:' + g.코드, '근거')); });
  Object.entries(K.조문).forEach(([id, vs]) => (vs[0].위임 || []).forEach(x => E('A:' + id, 'A:' + x, '위임')));
  K.해석.forEach(x => { x.관련조문.forEach(id => E('A:' + id, 'I:' + x.id, '해석')); x.적용규칙.forEach(r => E(r, 'I:' + x.id, '적용')); });
  return { nodes, edges };
}
function graphSvg() {
  const { nodes, edges } = kgraph();
  const W = 1180, NW = 236, NH = 34, GAP = 8, TOP = 44;
  const colX = [10, 330, 640, 940];
  const colHead = ['고시(개정) · 사업장 문서', '법령 조문', '판정 규칙 · 기준표', '가이드 · 해석·판단'];
  const pos = {}; const cnt = [0, 0, 0, 0];
  nodes.forEach(n => {
    if (n.col === 0 && n.type === '문서' && !cnt.sep) { cnt[0] += 22; cnt.sep = 1; }
    if (n.col === 3 && n.type === '해석' && !cnt.sep3) { cnt[3] += 22; cnt.sep3 = 1; }
    pos[n.id] = { x: colX[n.col], y: TOP + cnt[n.col] }; cnt[n.col] += NH + GAP;
  });
  // 가이드·규칙 칼럼은 가운데 정렬
  const H = Math.max(...cnt.slice(0, 4)) + TOP + 10;
  [2, 3].forEach(c => { const off = (H - TOP - cnt[c]) / 2.5; nodes.filter(n => n.col === c).forEach(n => pos[n.id].y += off); });
  const focus = ED.hover || ED.sel && (pos[ED.sel] ? ED.sel : null);
  const nb = new Set(focus ? [focus, ...edges.filter(e => e.a === focus || e.b === focus).flatMap(e => [e.a, e.b])] : []);
  const ECOL = { 개정: '#C9822B', 인용: '#6B5BA8', 근거: '#2D5FA8', 연결: '#3A9B6A', 위임: '#9AA5B4', 해석: '#B5487A', 적용: '#B5487A' };
  const path = e => {
    const A = pos[e.a], Bp = pos[e.b];
    if (e.t === '위임') { const x = A.x + NW, y1 = A.y + NH / 2, y2 = Bp.y + NH / 2; return `M${x} ${y1} C${x + 40} ${y1}, ${x + 40} ${y2}, ${x} ${y2}`; }
    const x1 = A.x + NW, y1 = A.y + NH / 2, x2 = Bp.x, y2 = Bp.y + NH / 2, mx = (x1 + x2) / 2;
    return `M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  };
  const eh = edges.map(e => { const on = !focus || (nb.has(e.a) && nb.has(e.b) && (e.a === focus || e.b === focus));
    return `<path d="${path(e)}" fill="none" stroke="${ECOL[e.t]}" stroke-width="${on && focus ? 2.4 : 1.2}" opacity="${on ? (focus ? .95 : .45) : .07}" ${e.t === '위임' ? 'stroke-dasharray="4 3"' : ''}/>`; }).join('');
  const nh = nodes.map(n => { const p = pos[n.id], on = !focus || nb.has(n.id), sel = n.id === ED.sel, c = TYPE_COLOR[n.type];
    const lab = n.label.length > 19 ? n.label.slice(0, 18) + '…' : n.label;
    return `<g class="gnode" data-node="${esc(n.id)}" style="cursor:pointer" opacity="${on ? 1 : .25}">
      <rect x="${p.x}" y="${p.y}" width="${NW}" height="${NH}" rx="7" fill="${sel ? c : '#fff'}" stroke="${c}" stroke-width="${sel ? 2.5 : 1.3}"/>
      <rect x="${p.x}" y="${p.y}" width="5" height="${NH}" rx="2" fill="${c}"/>
      <text x="${p.x + 12}" y="${p.y + 14}" font-size="11.5" font-weight="700" fill="${sel ? '#fff' : '#1F2A3C'}">${esc(lab)}</text>
      <text x="${p.x + 12}" y="${p.y + 27}" font-size="9.5" fill="${sel ? '#E5ECF7' : '#5B6577'}">${esc(n.sub.length > 30 ? n.sub.slice(0, 29) + '…' : n.sub)}</text>
      <title>${esc(n.label)} — ${esc(n.sub)}</title></g>`; }).join('');
  const heads = colHead.map((h, i) => `<text x="${colX[i]}" y="20" font-size="12" font-weight="800" fill="#1B2F5B">${h}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:900px;display:block" xmlns="http://www.w3.org/2000/svg">${heads}${eh}${nh}</svg>`;
}

// ---- 화면
function renderKX() {
  const box = $('kx'); if (!box) return;
  const legend = Object.entries({ 고시: '고시·개정', 조문: '법령 조문', 규칙: '판정 규칙·기준표', 가이드: '지적·조치 가이드', 해석: '해석·판단 (유권해석·컨설턴트)', 문서: '사업장 문서' })
    .map(([k, v]) => `<span><i style="background:${TYPE_COLOR[k]}"></i>${v}</span>`).join('') +
    '<span style="margin-left:10px">선: <b style="color:#C9822B">개정</b> · <b style="color:#2D5FA8">근거</b> · <b style="color:#3A9B6A">연결</b> · <b style="color:#6B5BA8">인용</b> · <b style="color:#B5487A">해석·적용</b> · <b style="color:#9AA5B4">위임(점선)</b></span>';
  box.innerHTML = `
    <div class="row between"><div><h2 id="kxTitle">지식 연결도 · 지식 편집</h2><p class="desc" style="margin:0">노드를 누르면 연결된 지식이 강조되고, 아래에서 내용과 연결 관계를 바로 수정할 수 있습니다. 판정 규칙은 수정하면 새 버전으로 저장되고 이전 버전은 이력으로 남습니다.</p></div>
      <div class="row"><input type="text" id="kxQ" placeholder="지식 검색 (예: 표시, 30일, 암모니아)" value="${esc(ED.q)}" style="width:240px"><button class="btn sm" style="background:${TYPE_COLOR.해석}" data-act="new-int">+ 해석·판단</button><button class="btn blue sm" data-act="new">+ 새 점검 규칙</button></div></div>
    <div class="legend" style="margin:10px 0 4px;flex-wrap:wrap">${legend}</div>
    <div class="scroll" id="kxGraph" style="border:1px solid var(--line);border-radius:10px;background:#FBFCFE;padding:6px">${graphSvg()}</div>
    <div class="grid2" style="grid-template-columns:280px 1fr;margin-top:14px">
      <div id="kxNav" style="max-height:640px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:8px">${navHtml()}</div>
      <div id="kxDetail">${detailHtml()}</div>
    </div>`;
  bindKX();
}
function navHtml() {
  const q = ED.q.trim();
  const m = (...t) => !q || t.join(' ').includes(q);
  const item = (id, title, sub, type) => `<div class="kxi ${ED.sel === id ? 'on' : ''}" data-node="${esc(id)}"><i style="background:${TYPE_COLOR[type]}"></i><div><b>${esc(title)}</b><div class="muted small">${esc(sub)}</div></div></div>`;
  const grp = (h, xs) => xs.length ? `<div class="kxh">${h}</div>${xs.join('')}` : '';
  return grp('판정 규칙 · 기준표', [...K.규칙.filter(r => m(r.id, r.이름, r.설명, JSON.stringify(latest(r)))).map(r => item(r.id, `${r.id} ${r.이름}`, `${r.유형} · v${latest(r).버전} · 시행 ${latest(r).시행일}`, '규칙')),
      ...(m('규정수량', '수량기준', ...ALLCHEM.map(x => x.이름)) ? [item('QTY', '물질별 규정수량 표', `물질 ${ALLCHEM.length}종 · 수량기준 고시`, '기준표')] : [])])
    + grp('지적·조치 가이드', K.가이드.filter(g => m(g.코드, g.지적유형, g.권고조치)).map(g => item('G:' + g.코드, `${g.코드} ${g.지적유형}`, `규칙 ${g.규칙}`, '가이드')))
    + grp('해석·판단 (유권해석·컨설턴트)', K.해석.filter(x => m(x.id, x.제목, x.판단, x.질의, x.구분, x.출처)).map(x => item('I:' + x.id, x.제목, `${x.구분} · ${x.신뢰수준} · ${x.상태}`, '해석')))
    + grp('법령 조문', Object.entries(K.조문).filter(([id, v]) => m(id, label(v[0]), v[0].제목, ...v.map(a => a.내용))).map(([id, v]) => item('A:' + id, label(v[0]), `${v[0].제목}${v.length > 1 ? ` · 버전 ${v.length}` : ''}`, '조문')))
    + grp('사업장 문서 (유형)', DOC_TYPES.filter(d => m(d.이름, d.유형)).map(d => item('D:' + d.유형, d.이름, `사업장 ${SITES.length}곳 · 조문 ${docLinks(SITES[0].문서.find(x => x.유형 === d.유형)).length}개 연결`, '문서')))
    + grp('고시 (개정)', NOTICES.filter(n => m(n.제목, n.요약)).map(n => item('N:' + n.id, (n.제목.split('—')[1] || n.제목).trim(), `${n.구분} · 시행 ${n.시행일}`, '고시')));
}
function neighbors(id) {
  const { nodes, edges } = kgraph();
  const nm = Object.fromEntries(nodes.map(n => [n.id, n]));
  return edges.filter(e => e.a === id || e.b === id).map(e => ({ n: nm[e.a === id ? e.b : e.a], t: e.t, dir: e.a === id ? '→' : '←' }));
}
const nbChips = id => { const xs = neighbors(id); return xs.length ? `<div class="chips">${xs.map(x => `<span class="chip" data-node="${esc(x.n.id)}" style="cursor:pointer;border-color:${TYPE_COLOR[x.n.type]}"><span class="muted">${x.t}</span> <b>${esc(x.n.label)}</b></span>`).join('')}</div>` : '<p class="muted">연결된 지식이 없습니다.</p>'; };
const citeChip = (id, del) => `<span class="chip" style="border-color:${TYPE_COLOR.조문}"><b data-node="A:${esc(id)}" style="cursor:pointer">${esc(artLabel(id))}</b> <code>${esc(id)}</code>${del ? ` <a href="#" data-act="${del}" data-v="${esc(id)}" style="color:var(--red);text-decoration:none">✕</a>` : ''}</span>`;
const citeSelect = (sid, exclude = []) => `<select id="${sid}"><option value="">+ 조문 연결</option>${Object.keys(K.조문).filter(x => !exclude.includes(x)).map(x => `<option value="${x}">${esc(artLabel(x))} (${x})</option>`).join('')}</select>`;
const card = (title, body) => `<div class="result" style="background:#fff">${title ? `<h3>${title}</h3>` : ''}${body}</div>`;

function detailHtml() {
  const id = ED.sel;
  if (id === 'NEW') return newRuleHtml();
  if (id.startsWith('I:')) return interpHtml(id.slice(2));
  if (id === 'QTY') return qtyHtml();
  if (id === 'I:NEW') return interpHtml('NEW');
  if (id.startsWith('G:')) return guideHtml(K.가이드.find(g => g.코드 === id.slice(2)));
  if (id.startsWith('A:')) return artHtml(id.slice(2));
  if (id.startsWith('D:')) return docHtml(id.slice(2));
  if (id.startsWith('N:')) return noticeKHtml(NOTICES.find(n => n.id === id.slice(2)));
  const r = K.규칙.find(x => x.id === id);
  return r ? ruleHtml(r) : '<p class="muted">왼쪽이나 그래프에서 지식을 고르세요.</p>';
}

// ---- 규칙
function ruleBody(r, v, edit) {
  const bind = (path, val, w = 220, num = false) => edit ? `<input type="${num ? 'number' : 'text'}" data-bind="${path}" ${num ? 'data-num="1"' : ''} value="${esc(val)}" style="width:${w}px">` : `<b>${esc(val)}</b>`;
  if (r.유형 === '조건판정') {
    const conds = v.조건.any.map((c, i) => {
      if (c.all) return `<li><b>모두 해당:</b> ${c.all.map((x, j) => `${edit ? bind(`버전.조건.any.${i}.all.${j}.설명`, x.설명, 150) : `<b>${esc(x.설명)}</b>`} ${citeChip(x.근거)}`).join(' <b>+</b> ')} ${edit ? `<a href="#" data-act="cond-del" data-v="${i}" style="color:var(--red)">삭제</a>` : ''}</li>`;
      return `<li>${edit ? bind(`버전.조건.any.${i}.설명`, c.설명, 230) : `<b>${esc(c.설명)}</b>`} <span class="muted small">(${esc(c.필드)})</span> ${citeChip(c.근거)} ${edit ? `<a href="#" data-act="cond-del" data-v="${i}" style="color:var(--red)">삭제</a>` : ''}</li>`;
    }).join('');
    const used = v.조건.any.flatMap(c => c.all ? c.all.map(x => x.필드) : [c.필드]);
    const addC = edit ? `<div class="row" style="margin-top:6px"><select id="kxNewField"><option value="">+ 조건 추가</option>${Object.entries(FIELD_NAME).filter(([k]) => !used.includes(k)).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select>${citeSelect('kxNewFieldCite')}<button class="btn ghost sm" data-act="cond-add">추가</button></div>` : '';
    const d = v.결과.기한;
    return `<div class="kxrule"><div class="kxif">IF</div><div><b>다음 중 하나라도 해당하면</b><ol style="margin:6px 0;padding-left:20px;line-height:2">${conds}</ol>${addC}</div></div>
      <div class="kxrule"><div class="kxif then">THEN</div><div class="kv" style="grid-template-columns:90px 1fr;margin:0">
        <b>조치</b><span>${bind('버전.결과.조치', v.결과.조치, 300)}</span><b>제출처</b><span>${bind('버전.결과.제출처', v.결과.제출처, 200)}</span><b>서식</b><span>${bind('버전.결과.서식', v.결과.서식, 200)}</span>
        <b>제출 기한</b><span>변경완료 예정일 ${edit ? `<button class="btn ghost sm" data-act="days" data-v="-10">−10</button> <input type="number" data-bind="버전.결과.기한.일수" data-num="1" value="${d.일수}" style="width:70px"> <button class="btn ghost sm" data-act="days" data-v="10">+10</button> 일 → <b id="kxDaysTxt">${daysTxt(d.일수)}</b>` : `<b style="color:var(--red);font-size:15px">${daysTxt(d.일수)}</b>`} ${citeChip(d.근거)}</span></div></div>`;
  }
  if (r.유형 === '결정표') {
    const rows = v.결정표.map((t, i) => `<tr><td>${edit ? `<select data-bind="버전.결정표.${i}.사업장군">${['1군', '2군', '기타'].map(x => `<option ${x === t.사업장군 ? 'selected' : ''}>${x}</option>`).join('')}</select>` : t.사업장군}</td>
      <td>${edit ? `<select data-bind="버전.결정표.${i}.위험도"><option value="">(전체)</option>${['가', '나', '다'].map(x => `<option ${x === t.위험도 ? 'selected' : ''}>${x}</option>`).join('')}</select>` : t.위험도 || '(전체)'}</td>
      <td>${edit ? `<input type="number" data-bind="버전.결정표.${i}.주기_년" data-num="1" value="${t.주기_년}" style="width:60px">` : `<b>${t.주기_년}</b>`} 년</td>${edit ? `<td><a href="#" data-act="row-del" data-v="${i}" style="color:var(--red)">삭제</a></td>` : ''}</tr>`).join('');
    const x = v.연장;
    return `<b>사업장 군 · 시설 위험도 → 정기검사 주기</b><table style="margin:6px 0 4px;max-width:520px"><tr><th>사업장 군</th><th>위험도</th><th>주기</th>${edit ? '<th></th>' : ''}</tr>${rows}</table>${edit ? '<button class="btn ghost sm" data-act="row-add">+ 행 추가</button>' : ''}
      <div class="kxrule" style="margin-top:10px"><div class="kxif">연장</div><div>최근 ${edit ? `<input type="number" data-bind="버전.연장.조건.연속적합_횟수_이상" data-num="1" value="${x.조건.연속적합_횟수_이상}" style="width:50px">` : `<b>${x.조건.연속적합_횟수_이상}</b>`}회 연속 적합 · 검사기관 ${edit ? `<input type="number" data-bind="버전.연장.조건.검사기관수_이상" data-num="1" value="${x.조건.검사기관수_이상}" style="width:50px">` : `<b>${x.조건.검사기관수_이상}</b>`}곳 이상 → 최대 ${edit ? `<input type="number" data-bind="버전.연장.최대_년" data-num="1" value="${x.최대_년}" style="width:50px">` : `<b>${x.최대_년}</b>`}년 연장 ${citeChip(x.근거)}</div></div>`;
  }
  if (r.유형 === '체크리스트') {
    return `<b>필수 항목 ${v.필수항목.length}개</b> <span class="muted small">(라벨 생성 · 현장 사진 판독 · 표시 점검에서 함께 사용)</span>
      <div class="chips">${v.필수항목.map((t, i) => `<span class="chip" style="font-size:13px">${i + 1}. <b>${esc(t)}</b>${edit ? ` <a href="#" data-act="item-del" data-v="${i}" style="color:var(--red);text-decoration:none">✕</a>` : ''}</span>`).join('')}</div>
      ${edit ? '<div class="row"><input type="text" id="kxNewItem" placeholder="항목 추가 (예: 24시간 비상연락처)" style="width:260px"><button class="btn ghost sm" data-act="item-add">추가</button></div>' : ''}
      ${v.결과 ? `<div class="kv" style="margin-top:8px"><b>미충족 시 조치</b><span>${bind('버전.결과.조치', v.결과.조치, 300)}</span>${v.결과.지적유형 ? `<b>지적 유형</b><span><span class="chip" data-node="G:${v.결과.지적유형}" style="cursor:pointer">${v.결과.지적유형}</span></span>` : ''}</div>` : ''}`;
  }
  return '';
}
function ruleHtml(r) {
  const cur = activeVersion(r, base()), last = latest(r);
  const edit = ED.mode === 'edit' && ED.draft?.id === r.id;
  const v = edit ? ED.draft.버전 : (ED.verView && r.버전.find(x => x.버전 === ED.verView)) || last;
  const tl = r.버전.map(x => { const st = x === cur ? 'green' : x.시행일 > base() ? 'orange' : 'gray';
    return `<span class="chip" data-act="ver" data-v="${x.버전}" style="cursor:pointer;${x === v && !edit ? 'border-color:var(--blue);background:var(--bg)' : ''}"><span class="pill ${st}">v${x.버전}</span> ${x.시행일}${x.폐지일 ? ` ~ ${x.폐지일}` : ' ~'} <span class="muted small">${esc(x.승인)}</span></span>`; }).join('<span class="muted">→</span>');
  const cites = edit ? ED.draft.버전.근거 : v.근거;
  return `<div class="result" style="background:#fff;border-color:${edit ? 'var(--orange)' : 'var(--line)'}">
    <div class="row between"><div>${edit ? `<input type="text" data-bind="이름" value="${esc(ED.draft.이름)}" style="font-size:15px;font-weight:700;width:360px">` : `<h3 style="margin:0">${esc(r.id)} ${esc(r.이름)} <span class="pill gray">${esc(r.유형)}</span></h3>`}</div>
      <div class="row">${edit ? '<span class="pill orange">편집 중</span>' : `<button class="btn blue" data-act="edit">✎ 수정하기</button>`}</div></div>
    ${edit ? `<input type="text" data-bind="설명" value="${esc(ED.draft.설명)}" style="width:100%;margin:6px 0">` : `<p class="muted" style="margin:6px 0">${esc(r.설명)}</p>`}
    <div class="chips" style="align-items:center"><b class="small">버전</b> ${tl}</div>
    ${!edit && v !== last ? `<p class="note" style="margin:6px 0">v${v.버전} (이력)을 보고 있습니다.</p>` : ''}
    <div style="margin:10px 0">${ruleBody(r, v, edit)}</div>
    <div><b class="small">근거 조문</b><div class="chips">${cites.map(c => citeChip(c, edit ? 'cite-del' : null)).join('')}${edit ? citeSelect('kxNewCite', cites) + '<button class="btn ghost sm" data-act="cite-add">연결</button>' : ''}</div></div>
    <div style="margin-top:6px"><div class="row between"><b class="small">관련 해석·판단 (법령만으로 애매한 부분의 판단 근거)</b><button class="btn ghost sm" data-act="new-int" data-v="${r.id}">+ 해석·판단 연결</button></div>${intCards(intOf(r.id)) || '<p class="muted small">연결된 해석·판단이 없습니다.</p>'}</div>
  </div>
  ${edit ? `<div class="result hit" id="kxReview">${reviewHtml(r)}</div>` : ''}
  ${card('연결된 지식', nbChips(r.id))}`;
}
function draftApproval(r) {
  return { notice: null, 규칙: r.id, 종류: '버전교체', 값: { 이름: ED.draft.이름, 설명: ED.draft.설명, 버전: ED.draft.버전 }, 시행일: ED.draft.시행일, 근거: null, 승인자: ED.draft.승인자, 일시: nowStr(), 의견: ED.draft.의견 || '지식 직접 편집' };
}
function flat(o, p = '', out = {}) { if (o && typeof o === 'object') { for (const [k, v] of Object.entries(o)) flat(v, p ? `${p}.${k}` : k, out); } else out[p] = o; return out; }
const PATH_NAME = p => p.replace(/^조건\.any\.(\d+)/, (_, i) => `조건 ${+i + 1}`).replace('결과.기한.일수', '제출 기한 (일)').replace(/^결정표\.(\d+)/, (_, i) => `결정표 ${+i + 1}행`).replace(/^필수항목\.(\d+)/, (_, i) => `필수 항목 ${+i + 1}`).replace(/^근거\.(\d+)/, (_, i) => `근거 조문 ${+i + 1}`).replace(/\./g, ' › ');
function reviewHtml(r) {
  const last = latest(r), d = ED.draft;
  const strip = v => { const { 버전, 시행일, 폐지일, 승인, ...rest } = v; return rest; };
  const A = flat(strip(last)), Bv = flat(strip(d.버전));
  const keys = [...new Set([...Object.keys(A), ...Object.keys(Bv)])];
  const ch = keys.filter(k => JSON.stringify(A[k]) !== JSON.stringify(Bv[k]));
  if (d.이름 !== r.이름) ch.unshift('#이름');
  const rows = ch.map(k => k === '#이름' ? `<tr><td>규칙 이름</td><td>${esc(r.이름)}</td><td><b>${esc(d.이름)}</b></td></tr>` : `<tr><td>${esc(PATH_NAME(k))}</td><td>${A[k] === undefined ? '<span class="muted">(없음)</span>' : esc(A[k])}</td><td><b>${Bv[k] === undefined ? '<span style="color:var(--red)">(삭제)</span>' : esc(Bv[k])}</b></td></tr>`).join('');
  let impactH = '';
  if (ch.length) {
    const Kd = knowledge([...S.approvals, draftApproval(r)]);
    const date = d.시행일 > base() ? d.시행일 : base();
    const imp = [];
    if (r.유형 === '조건판정') SITES.forEach(site => site.변경관리.filter(m => m.상태 === '진행').forEach(m => {
      const inp = { ...mocFlags(m), 변경완료_예정일: m.변경완료_예정일 };
      const o = judgeChange(K, inp, date)[0]?.기한 || '대상 아님', nn = judgeChange(Kd, inp, date)[0]?.기한 || '대상 아님';
      if (o !== nn) imp.push(`<tr><td>${sitePill(site.id)}</td><td>${m.id} ${esc(m.이름)}</td><td>${o}</td><td><b>${nn}</b></td></tr>`); }));
    if (r.유형 === '결정표') SITES.forEach(site => { const a1 = inspectionSchedule(K, site, date), b1 = inspectionSchedule(Kd, site, date);
      a1.forEach((x, i) => { if (x.기한 !== b1[i].기한) imp.push(`<tr><td>${sitePill(site.id)}</td><td>${esc(x.시설)}</td><td>${x.기한}</td><td><b>${b1[i].기한}</b></td></tr>`); }); });
    const g0 = runGolden(K), g1 = runGolden(Kd);
    const gch = g1.filter((x, i) => x.ok !== g0[i].ok);
    impactH = `<h3>판정 영향 미리보기 <span class="muted small">(${date} 기준)</span></h3>
      ${r.유형 === '체크리스트' ? `<p class="small">표시 점검 필수 항목 ${latest(r).필수항목.length}개 → <b>${d.버전.필수항목.length}개</b> · 3개 사업장 라벨 점검·사진 판독에 동일 적용</p>` : imp.length ? `<table style="margin-bottom:8px"><tr><th>사업장</th><th>대상</th><th>현재 결과</th><th>변경 후</th></tr>${imp.join('')}</table>` : '<p class="muted small">사업장 판정 결과 변화 없음</p>'}
      <p class="small">정답셋 ${g1.length}건: ${gch.length ? `<b style="color:var(--red)">결과가 바뀌는 사례 ${gch.length}건</b> (${gch.map(x => `${x.c.id} ${x.ok ? '실패→통과' : '통과→실패'}`).join(', ')}) — 의도한 변화면 정답셋도 함께 갱신` : '<span class="ok">결과 변화 없음</span>'}</p>`;
  }
  return `<h3>변경 확인 · 저장</h3>
    ${ch.length ? `<table><tr><th>항목</th><th>현재 (v${last.버전})</th><th>변경</th></tr>${rows}</table>` : '<p class="muted">아직 바뀐 내용이 없습니다. 위에서 값을 수정하세요.</p>'}
    ${impactH}
    <div class="row" style="align-items:flex-end;margin-top:8px"><label class="field"><span>적용 시행일 (v${last.버전} 시행 ${last.시행일} 이후)</span><input type="date" data-bind="시행일" value="${d.시행일}"></label>
      <label class="field"><span>승인자</span><select data-bind="승인자">${personOpts(d.승인자, 'HQ')}</select></label>
      <label class="field" style="flex:1;min-width:200px"><span>수정 사유</span><input type="text" data-bind="의견" value="${esc(d.의견 || '')}" placeholder="예: 내부 기준 강화" style="width:100%"></label></div>
    <div class="row"><button class="btn green" data-act="save" ${ch.length ? '' : 'disabled'}>새 버전(v${last.버전 + 1})으로 저장</button><button class="btn ghost" data-act="cancel">취소</button></div>`;
}

// ---- 규정수량 표
function qtyHtml() {
  const edit = ED.mode === 'edit' && ED.draft?.id === 'QTY';
  const rows = ALLCHEM.map(m => { const q = qtyAt(m, base()); const dv = edit ? ED.draft.값[m.CAS] : null;
    const hist = (K.수량[m.CAS] || []).map(x => `${x.시행일}부터 ${x.하위} t`).join(', ');
    const mul = SITES.filter(x => x.물질.some(y => y.CAS === m.CAS)).map(x => { const y = x.물질.find(z => z.CAS === m.CAS); return `${x.약칭} ${(y.최대보유량_t / q.하위).toFixed(1)}${edit && dv != q.하위 ? `→<b>${(y.최대보유량_t / dv).toFixed(1)}</b>` : ''}`; }).join(' · ');
    return `<tr ${edit && dv != q.하위 ? 'style="background:var(--lorange)"' : ''}><td><b>${esc(m.이름)}</b></td><td>${m.CAS}</td><td>${m.사업장들.map(sitePill).join('')}</td>
      <td class="num">${edit ? `<input type="number" data-cas="${m.CAS}" value="${dv}" style="width:70px">` : `<b>${q.하위}</b>`} t</td><td class="num">${q.상위} t</td><td class="small">${mul}</td><td class="small">${hist || '-'}</td></tr>`; }).join('');
  return `<div class="result" style="background:#fff;border-color:${edit ? 'var(--orange)' : 'var(--line)'}">
    <div class="row between"><h3 style="margin:0">물질별 규정수량 표 <span class="pill gray">기준표</span></h3>${edit ? '<span class="pill orange">편집 중</span>' : '<button class="btn blue" data-act="edit">✎ 수정하기</button>'}</div>
    <p class="muted" style="margin:6px 0">화학물질안전원 고시(유해화학물질별 수량기준)의 값입니다. 배수 계산·계획서 대상 판정·비상대응 등급에 사용됩니다.</p>
    <div class="scroll"><table><tr><th>물질</th><th>CAS</th><th>사업장</th><th class="num">하위 규정수량</th><th class="num">상위</th><th>사업장별 배수</th><th>개정 이력</th></tr>${rows}</table></div>
    ${edit ? `<div class="row" style="align-items:flex-end;margin-top:8px"><label class="field"><span>적용 시행일</span><input type="date" id="kxQtyDate" value="${ED.draft.시행일}"></label><label class="field"><span>승인자</span><select id="kxQtyBy">${personOpts('김지훈', 'HQ')}</select></label>
      <button class="btn green" data-act="qty-save">바뀐 값 저장</button><button class="btn ghost" data-act="cancel">취소</button></div>` : ''}
  </div>${card('연결된 지식', nbChips('QTY'))}`;
}
// ---- 가이드
function guideHtml(g) {
  const edit = ED.mode === 'edit' && ED.draft?.id === 'G:' + g.코드, x = edit ? ED.draft.값 : g;
  const bindT = (k, w) => edit ? `<input type="text" data-bind="값.${k}" value="${esc(x[k])}" style="width:${w}">` : `<b>${esc(x[k])}</b>`;
  return `<div class="result" style="background:#fff;border-color:${edit ? 'var(--orange)' : 'var(--line)'}">
    <div class="row between"><h3 style="margin:0">${esc(g.코드)} 지적·조치 가이드</h3>${edit ? '<span class="pill orange">편집 중</span>' : '<button class="btn blue" data-act="edit">✎ 수정하기</button>'}</div>
    <div class="kv" style="margin-top:8px"><b>지적 유형</b><span>${bindT('지적유형', '100%')}</span>
      <b>연결 규칙</b><span>${edit ? `<select data-bind="값.규칙">${K.규칙.map(r => `<option ${r.id === x.규칙 ? 'selected' : ''}>${r.id}</option>`).join('')}</select>` : `<span class="chip" data-node="${x.규칙}" style="cursor:pointer">${x.규칙}</span>`}</span>
      <b>권고 조치</b><span>${edit ? `<textarea data-bind="값.권고조치">${esc(x.권고조치)}</textarea>` : esc(x.권고조치)}</span>
      <b>근거 조문</b><span><div class="chips" style="margin:0">${x.근거.map(c => citeChip(c, edit ? 'gcite-del' : null)).join('')}${edit ? citeSelect('kxNewCite', x.근거) + '<button class="btn ghost sm" data-act="gcite-add">연결</button>' : ''}</div></span>
      <b>과거 사례</b><span>${(x.사례 || []).map((c, i) => `<div>${c.연도} · ${esc(c.시설)}: ${esc(c.내용)} ${edit ? `<a href="#" data-act="case-del" data-v="${i}" style="color:var(--red)">삭제</a>` : ''}</div>`).join('')}
        ${edit ? `<div class="row" style="margin-top:4px"><input type="number" id="kxCy" value="2026" style="width:70px"><input type="text" id="kxCf" placeholder="시설" style="width:120px"><input type="text" id="kxCc" placeholder="지적 내용" style="width:220px"><button class="btn ghost sm" data-act="case-add">사례 추가</button></div>` : ''}</span></div>
    ${edit ? `<div class="row"><button class="btn green" data-act="guide-save">저장</button><button class="btn ghost" data-act="cancel">취소</button></div>` : ''}
  </div>${card('연결된 지식', nbChips('G:' + g.코드))}`;
}
// ---- 조문
function artHtml(id) {
  const vs = K.조문[id];
  const docs = SITES.flatMap(s0 => s0.문서.filter(d => docLinks(d).includes(id)).map(d => `${s0.약칭} ${d.이름}`));
  return `<div class="result" style="background:#fff"><h3 style="margin:0 0 4px">${esc(label(vs[0]))} ${esc(vs[0].제목)} <code>${id}</code></h3>
    <p class="muted small" style="margin:0 0 8px">${esc(vs[0].법령명)} · 법령 원문은 법제처 수집 데이터라 화면에서 직접 고치지 않고, 개정 감지 시 새 버전으로 추가됩니다.</p>
    ${vs.map((a, i) => `<div class="cite" style="${a.폐지일 ? 'opacity:.6' : ''}"><b>시행 ${a.시행일}${a.폐지일 ? ` ~ ${a.폐지일} (이력)` : ''}</b> <code>${a.해시}</code><br>${i ? cmpBox(vs[i - 1].내용, a.내용, '이전', '개정').replace('class="cmp diff"', 'class="cmp diff" style="margin-top:6px"') : esc(a.내용)}</div>`).join('')}
    <p class="small" style="margin:8px 0 0">이 조문을 인용하는 사업장 문서 <b>${docs.length}</b>건${docs.length ? `: <span class="muted">${esc(docs.slice(0, 6).join(', '))}${docs.length > 6 ? ' 외' : ''}</span>` : ''}</p></div>
    ${card('연결된 지식 (이 조문이 바뀌면 영향받는 대상)', nbChips('A:' + id))}`;
}
// ---- 문서 유형
function docHtml(t) {
  const d0 = SITES[0].문서.find(d => d.유형 === t), links = docLinks(d0);
  return `<div class="result" style="background:#fff"><h3 style="margin:0 0 4px">${esc(d0.이름)} <span class="pill gray">사업장 문서</span></h3>
    <p class="muted small" style="margin:0 0 8px">문서가 인용하는 조문을 연결해 두면, 그 조문이 개정될 때 AI가 이 문서를 수정 대상으로 찾습니다. 연결은 바로 추가·삭제할 수 있습니다.</p>
    <b class="small">연결 조문</b><div class="chips">${links.map(c => c === 'QTY' ? `<span class="chip"><b data-node="QTY" style="cursor:pointer">수량기준 고시</b> <a href="#" data-act="dl-del" data-v="QTY" style="color:var(--red);text-decoration:none">✕</a></span>` : citeChip(c, 'dl-del')).join('')}
      ${citeSelect('kxNewCite', links)}<button class="btn ghost sm" data-act="dl-add">연결</button></div>
    <table style="margin-top:8px"><tr><th>사업장</th><th>문서 번호</th><th>개정</th><th>담당</th></tr>${SITES.map(s0 => { const d = s0.문서.find(x => x.유형 === t); return d ? `<tr><td>${sitePill(s0.id)}</td><td>${esc(d.번호)}</td><td class="small">${esc(d.개정)}</td><td>${esc(d.담당자)}</td></tr>` : ''; }).join('')}</table></div>
    ${card('연결된 지식', nbChips('D:' + t))}`;
}
function noticeKHtml(n) {
  return `<div class="result" style="background:#fff"><h3 style="margin:0 0 4px">${esc(n.제목)}</h3><p class="muted small">${esc(n.공포번호)} · 공포 ${n.공포일} · 시행 ${n.시행일}</p><p>${esc(n.요약)}</p>
    <div class="row"><button class="btn ghost sm" data-act="go-cmp" data-v="${n.id}">신·구 비교 보기</button><button class="btn ghost sm" data-act="go-ana" data-v="${n.id}">영향 분석·조치 보기</button></div></div>${card('이 고시가 바꾸는 조문', nbChips('N:' + n.id))}`;
}
function interpHtml(iid) {
  const isNew = iid === 'NEW';
  const edit = isNew || (ED.mode === 'edit' && ED.draft?.id === 'I:' + iid);
  const x = edit ? ED.draft.값 : K.해석.find(y => y.id === iid);
  const t = (k, w = '100%') => edit ? `<input type="text" data-bind="값.${k}" value="${esc(x[k] || '')}" style="width:${w}">` : esc(x[k]);
  const ta = k => edit ? `<textarea data-bind="값.${k}">${esc(x[k] || '')}</textarea>` : esc(x[k]);
  const sel = (k, opts) => edit ? `<select data-bind="값.${k}">${opts.map(o => `<option ${o === x[k] ? 'selected' : ''}>${o}</option>`).join('')}</select>` : `<b>${esc(x[k])}</b>`;
  const ruleSel = `<select id="kxIntRule"><option value="">+ 규칙 연결</option>${K.규칙.filter(r => !x.적용규칙.includes(r.id)).map(r => `<option value="${r.id}">${r.id} ${esc(r.이름)}</option>`).join('')}</select>`;
  return `<div class="result" style="background:#fff;border-color:${edit ? 'var(--orange)' : TYPE_COLOR.해석}">
    <div class="row between"><h3 style="margin:0"><span class="pill" style="background:${TYPE_COLOR.해석}">해석·판단</span> ${isNew ? '새 해석·판단 등록' : `${esc(x.id)} ${esc(x.제목)}`}</h3>${edit ? '<span class="pill orange">편집 중</span>' : '<button class="btn blue" data-act="edit">✎ 수정하기</button>'}</div>
    <p class="muted small" style="margin:6px 0">법령 문구만으로 판단이 애매한 경우, 기후에너지환경부 유권해석·질의회신이나 컨설턴트 판단을 근거와 함께 지식으로 남깁니다. 판정 규칙과 연결되어 판정 결과 화면에 함께 표시됩니다.</p>
    <div class="kv" style="grid-template-columns:100px 1fr"><b>구분</b><span>${sel('구분', INT_KIND)} ${edit ? '' : ''}</span>
      <b>제목</b><span>${t('제목')}</span><b>질의 (쟁점)</b><span>${ta('질의')}</span><b>판단 (답변)</b><span>${edit ? ta('판단') : `<b>${esc(x.판단)}</b>`}</span>
      <b>출처</b><span>${t('출처')} ${edit ? '<div class="muted small">예: 기후에너지환경부 질의회신 (문서번호, 일자) / 컨설팅본부 검토의견 번호</div>' : ''}</span>
      <b>신뢰 수준</b><span>${sel('신뢰수준', ['공식', '내부'])} <span class="muted small">공식 = 정부·기관 해석, 내부 = 컨설턴트·사내 판단</span></span>
      <b>상태</b><span>${sel('상태', ['유효', '검토 중', '폐기'])}</span><b>일자</b><span>${edit ? `<input type="date" data-bind="값.일자" value="${esc(x.일자 || base())}">` : esc(x.일자)}</span>
      <b>확인자</b><span>${edit ? `<select data-bind="값.확인자">${personOpts(x.확인자, 'HQ')}</select>` : esc(x.확인자)}</span>
      <b>관련 조문</b><span><div class="chips" style="margin:0">${x.관련조문.map(c => citeChip(c, edit ? 'icite-del' : null)).join('')}${edit ? citeSelect('kxNewCite', x.관련조문) + '<button class="btn ghost sm" data-act="icite-add">연결</button>' : ''}</div></span>
      <b>적용 규칙</b><span><div class="chips" style="margin:0">${x.적용규칙.map(r => `<span class="chip"><b data-node="${r}" style="cursor:pointer">${r}</b>${edit ? ` <a href="#" data-act="irule-del" data-v="${r}" style="color:var(--red);text-decoration:none">✕</a>` : ''}</span>`).join('')}${edit ? ruleSel + '<button class="btn ghost sm" data-act="irule-add">연결</button>' : ''}</div></span>
      <b>적용 방법</b><span>${ta('적용방법')}</span></div>
    ${edit ? `<div class="row"><button class="btn green" data-act="int-save">저장</button><button class="btn ghost" data-act="cancel">취소</button></div>` : ''}
  </div>${isNew ? '' : card('연결된 지식', nbChips('I:' + iid))}`;
}
function newRuleHtml() {
  return `<div class="result" style="background:#fff;border-color:var(--orange)"><h3>새 점검 규칙 추가 (체크리스트형)</h3>
    <div class="field"><span>규칙 이름</span><input type="text" id="nrName" style="width:100%" placeholder="예: 저장탱크 방류벽 점검 항목"></div>
    <div class="field"><span>근거 조문</span>${citeSelect('nrCite')}</div>
    <div class="field"><span>점검 항목 (한 줄에 하나)</span><textarea id="nrItems" placeholder="방류벽 용량 110% 이상&#10;배수 밸브 평상시 잠금&#10;방류벽 내부 균열 없음"></textarea></div>
    <div class="row"><label class="row small">시행일 <input type="date" id="nrDate" value="${base()}"></label><button class="btn green" data-act="nr-save">규칙 추가</button><button class="btn ghost" data-act="cancel">취소</button></div></div>`;
}

// ---- 이벤트
function setPath(o, path, val) { const ks = path.split('.'); let x = o; ks.slice(0, -1).forEach(k => { x = x[k]; }); x[ks[ks.length - 1]] = val; }
function selectNode(id) { ED.sel = id; ED.mode = 'view'; ED.draft = null; ED.verView = null; renderKX(); }
function refreshDetail() { $('kxDetail').innerHTML = detailHtml(); $('kxGraph').innerHTML = graphSvg(); $('kxNav').innerHTML = navHtml(); }
function bindKX() {
  const box = $('kx');
  box.onmouseover = e => { const g = e.target.closest('#kxGraph [data-node]'); const h = g ? g.dataset.node : null; if (h !== ED.hover) { ED.hover = h; $('kxGraph').innerHTML = graphSvg(); } };
  box.onmouseleave = () => { if (ED.hover) { ED.hover = null; $('kxGraph').innerHTML = graphSvg(); } };
  $('kxQ').oninput = e => { ED.q = e.target.value; $('kxNav').innerHTML = navHtml(); };
  box.oninput = e => {
    const b = e.target.dataset.bind; if (!b || !ED.draft) return;
    let v = e.target.value; if (e.target.dataset.num) v = Number(v);
    if (b.endsWith('.위험도') && v === '') v = undefined;
    setPath(ED.draft, b, v);
    if (b === '버전.결과.기한.일수' && $('kxDaysTxt')) $('kxDaysTxt').textContent = daysTxt(v);
    const r = K.규칙.find(x => x.id === ED.draft.id); if (r && $('kxReview') && !['승인자', '의견', '시행일'].includes(b)) $('kxReview').innerHTML = reviewHtml(r);
  };
  box.onchange = e => { if (e.target.dataset.bind === '시행일' && ED.draft) { const r = K.규칙.find(x => x.id === ED.draft.id); if (r) $('kxReview').innerHTML = reviewHtml(r); return; } if (e.target.dataset.cas && ED.draft) { ED.draft.값[e.target.dataset.cas] = Number(e.target.value); refreshDetail(); } };
  box.onclick = e => {
    const nodeEl = e.target.closest('[data-node]'); const actEl = e.target.closest('[data-act]');
    if (actEl) { e.preventDefault(); return kxAct(actEl.dataset.act, actEl.dataset.v); }
    if (nodeEl && !e.target.closest('input,select,textarea')) { e.preventDefault(); selectNode(nodeEl.dataset.node); }
  };
}
function kxAct(a, v) {
  const id = ED.sel, r = K.규칙.find(x => x.id === id), d = ED.draft;
  const done = (msg, apr) => { if (apr) S.approvals.push(apr); save(); K = knowledge(); ED.mode = 'view'; ED.draft = null; ED.verView = null; renderKX(); toast(msg); if (apr) showYaml(apr); };
  switch (a) {
    case 'new': ED.sel = 'NEW'; ED.mode = 'edit'; return refreshDetail();
    case 'new-int': { const nid = `I-${String(K.해석.length + 1).padStart(3, '0')}`;
      ED.draft = { id: 'I:NEW', 값: { id: nid, 구분: '유권해석', 제목: '', 질의: '', 판단: '', 출처: '', 확인자: '김지훈', 신뢰수준: '공식', 상태: '검토 중', 일자: base(), 관련조문: [], 적용규칙: v ? [v] : [], 적용방법: '' } };
      if (v) { const r0 = K.규칙.find(y => y.id === v); ED.draft.값.관련조문 = [...latest(r0).근거.slice(0, 1)]; }
      ED.sel = 'I:NEW'; ED.mode = 'edit'; return refreshDetail(); }
    case 'icite-del': d.값.관련조문 = d.값.관련조문.filter(x => x !== v); return refreshDetail();
    case 'icite-add': { const c = $('kxNewCite').value; if (c) d.값.관련조문.push(c); return refreshDetail(); }
    case 'irule-del': d.값.적용규칙 = d.값.적용규칙.filter(x => x !== v); return refreshDetail();
    case 'irule-add': { const c = $('kxIntRule').value; if (c) d.값.적용규칙.push(c); return refreshDetail(); }
    case 'int-save': {
      const x = d.값; if (!x.제목.trim() || !x.판단.trim()) return toast('제목과 판단(답변)을 입력하세요');
      if (!x.관련조문.length) return toast('관련 조문을 하나 이상 연결하세요');
      log(`해석·판단 ${d.id === 'I:NEW' ? '등록' : '수정'}: ${x.id} [${x.구분}] ${x.제목} (${x.상태})`, x.확인자);
      ED.sel = 'I:' + x.id;
      return done(`${x.id} 해석·판단을 저장했습니다 — 연결된 규칙의 판정 화면에 함께 표시됩니다`, { notice: null, 종류: '해석편집', 값: x, 시행일: base(), 승인자: x.확인자, 일시: nowStr() }); }
    case 'ver': ED.verView = +v; return refreshDetail();
    case 'edit':
      if (id === 'QTY') ED.draft = { id, 시행일: base(), 값: Object.fromEntries(ALLCHEM.map(m => [m.CAS, qtyAt(m, base()).하위])) };
      else if (id.startsWith('G:')) ED.draft = { id, 값: clone(K.가이드.find(g => g.코드 === id.slice(2))) };
      else if (id.startsWith('I:')) ED.draft = { id, 값: clone(K.해석.find(g => g.id === id.slice(2))) };
      else { const last = latest(r); ED.draft = { id, 이름: r.이름, 설명: r.설명, 버전: clone(last), 시행일: last.시행일 >= base() ? addDays(last.시행일, 1) : base(), 승인자: '김지훈', 의견: '' }; }
      ED.mode = 'edit'; return refreshDetail();
    case 'cancel': ED.mode = 'view'; ED.draft = null; if (id === 'NEW' || id === 'I:NEW') ED.sel = 'R-23-3'; return refreshDetail();
    case 'days': d.버전.결과.기한.일수 += +v; return refreshDetail();
    case 'cond-del': d.버전.조건.any.splice(+v, 1); return refreshDetail();
    case 'cond-add': { const f = $('kxNewField').value, c = $('kxNewFieldCite').value; if (!f) return toast('추가할 조건을 고르세요'); d.버전.조건.any.push({ 필드: f, 같음: true, 설명: FIELD_NAME[f], 근거: c || d.버전.근거[0] }); return refreshDetail(); }
    case 'row-add': d.버전.결정표.splice(d.버전.결정표.length - 1, 0, { 사업장군: '2군', 주기_년: 3 }); return refreshDetail();
    case 'row-del': d.버전.결정표.splice(+v, 1); return refreshDetail();
    case 'item-del': d.버전.필수항목.splice(+v, 1); return refreshDetail();
    case 'item-add': { const t = $('kxNewItem').value.trim(); if (!t) return; d.버전.필수항목.push(t); return refreshDetail(); }
    case 'cite-del': d.버전.근거 = d.버전.근거.filter(x => x !== v); return refreshDetail();
    case 'cite-add': { const c = $('kxNewCite').value; if (c) d.버전.근거.push(c); return refreshDetail(); }
    case 'save': {
      const last = latest(r);
      if (d.시행일 <= last.시행일) return toast(`시행일은 v${last.버전} 시행일(${last.시행일}) 이후여야 합니다`);
      const apr = draftApproval(r);
      log(`지식 편집: ${r.id} v${last.버전 + 1} 저장 (시행 ${d.시행일})${d.의견 ? ' — ' + d.의견 : ''}`, d.승인자);
      return done(`${r.id} v${last.버전 + 1}을 저장했습니다 (${d.시행일}부터 적용)`, apr);
    }
    case 'qty-save': {
      const date = $('kxQtyDate').value, by = $('kxQtyBy').value;
      const chg = ALLCHEM.filter(m => d.값[m.CAS] !== qtyAt(m, base()).하위);
      if (!chg.length) return toast('바뀐 값이 없습니다');
      chg.forEach(m => S.approvals.push({ notice: null, 규칙: '수량기준', 종류: '수량기준', CAS: m.CAS, 값: d.값[m.CAS], 시행일: date, 승인자: by, 일시: nowStr(), 의견: '규정수량 표 직접 편집' }));
      log(`규정수량 표 편집: ${chg.map(m => `${m.이름} ${qtyAt(m, base()).하위}→${d.값[m.CAS]} t`).join(', ')} (시행 ${date})`, by);
      return done(`규정수량 ${chg.length}건을 저장했습니다`, null);
    }
    case 'gcite-del': d.값.근거 = d.값.근거.filter(x => x !== v); return refreshDetail();
    case 'gcite-add': { const c = $('kxNewCite').value; if (c) d.값.근거.push(c); return refreshDetail(); }
    case 'case-add': { const c = $('kxCc').value.trim(); if (!c) return; (d.값.사례 ||= []).push({ 연도: +$('kxCy').value, 시설: $('kxCf').value.trim() || '-', 내용: c }); return refreshDetail(); }
    case 'case-del': d.값.사례.splice(+v, 1); return refreshDetail();
    case 'guide-save': log(`가이드 편집: ${d.값.코드} ${d.값.지적유형}`); return done('가이드를 저장했습니다', { notice: null, 종류: '가이드편집', 값: d.값, 시행일: base(), 승인자: '김지훈', 일시: nowStr() });
    case 'dl-del': case 'dl-add': {
      const t = id.slice(2), d0 = SITES[0].문서.find(x => x.유형 === t); S.docLinks ||= {};
      const cur0 = [...docLinks(d0)];
      if (a === 'dl-del') S.docLinks[t] = cur0.filter(x => x !== v);
      else { const c = $('kxNewCite').value; if (!c) return; S.docLinks[t] = [...cur0, c]; }
      log(`문서 연결 변경: ${d0.이름} → ${S.docLinks[t].join(', ')}`); save(); return refreshDetail();
    }
    case 'nr-save': {
      const name = $('nrName').value.trim(), items = $('nrItems').value.split('\n').map(x => x.trim()).filter(Boolean);
      if (!name || !items.length) return toast('규칙 이름과 점검 항목을 입력하세요');
      const nid = `R-NEW-${S.approvals.filter(x => x.종류 === '새규칙').length + 1}`;
      const rule = { id: nid, 이름: name, 유형: '체크리스트', 대상: '점검', 설명: '전문가가 직접 추가한 점검 규칙', 버전: [{ 버전: 1, 시행일: $('nrDate').value, 폐지일: null, 승인: '김지훈 승인 (직접 추가)', 근거: [$('nrCite').value].filter(Boolean), 필수항목: items, 결과: { 조치: '미충족 항목 보완' } }] };
      log(`새 점검 규칙 추가: ${nid} ${name} (${items.length}개 항목)`);
      ED.sel = nid;
      return done(`${nid} 규칙을 추가했습니다 — 그래프에 연결되었습니다`, { notice: null, 규칙: nid, 종류: '새규칙', 값: rule, 시행일: rule.버전[0].시행일, 승인자: '김지훈', 일시: nowStr() });
    }
    case 'go-cmp': cur = v; return renderCmp();
    case 'go-ana': return goNotice(v, 't3');
  }
}

function toYaml(o, ind = '') {
  if (Array.isArray(o)) return o.map(x => typeof x === 'object' && x ? `${ind}- ${toYaml(x, ind + '  ').trimStart()}` : `${ind}- ${x}`).join('\n');
  return Object.entries(o).map(([k, v]) => v && typeof v === 'object' ? `${ind}${k}:\n${toYaml(v, ind + '  ')}` : `${ind}${k}: ${v ?? 'null'}`).join('\n');
}
function showYaml(a) {
  let y;
  if (a.종류 === '새규칙') y = `# rules/${a.값.id}.yaml (신규)\n` + toYaml(a.값);
  else if (a.종류 === '수량기준') y = `# data/knowledge/thresholds.yaml (행 추가)\n` + toYaml([{ CAS: a.CAS, 하위_규정수량_t: a.값, 시행일: a.시행일, 승인: a.승인자 }]);
  else if (a.종류 === '확인') y = '# 판정 값 변경 없음 — 근거 조문 버전만 갱신';
  else if (a.종류 === '해석편집') y = `# data/knowledge/interpretations.yaml — ${a.값.id} 항목\n` + toYaml([a.값]);
  else if (a.종류 === '가이드편집') y = `# guides/guides.yaml — ${a.값.코드} 항목 수정\n` + toYaml([a.값]);
  else { const r = K.규칙.find(x => x.id === a.규칙); y = `# rules/${r.id}.yaml — '버전' 목록에 추가 (이전 버전은 폐지일 ${a.시행일}로 보존)\n버전:\n` + toYaml([r.버전[r.버전.length - 1]], '  '); }
  $('yamlOut').textContent = y; $('yamlBox').classList.remove('hidden');
}

// ================================================================ ⑤ 대시보드
function renderDash() {
  const raw = NOTICES.flatMap(n => (S.notices[n.id]?.tasks || []).filter(inSite).map(t => ({ ...t, n })));
  const all = raw.filter(act), jw = raw.filter(t => t.판단 === '확인 전').length, jn = raw.length - all.length;
  const done = all.filter(t => t.상태 === '완료').length;
  const over = all.filter(t => t.상태 !== '완료' && t.기한 < base());
  const soon = all.filter(t => t.상태 !== '완료' && t.기한 >= base() && daysBetween(base(), t.기한) <= 30);
  const pend = NOTICES.reduce((s, n) => s + (n.규칙제안 || []).filter((p, i) => !S.prop[`${n.id}:${i}`]).length, 0);
  $('dashKpi').innerHTML = [
    [NOTICES.length + '건', `감지 고시 (미분석 ${NOTICES.filter(n => nstate(n) === '신규').length})`, NOTICES.some(n => nstate(n) === '신규')],
    [jw + '건', 'AI 추천 판단 대기', jw > 0], [all.length + '건', `조치 대상 (비대상 ${jn} 제외)`], [(all.length ? Math.round(done / all.length * 100) : 0) + '%', `완료율 (${done}/${all.length})`],
    [over.length + '건', '기한 경과', over.length > 0], [pend + '건', '규칙 승인 대기', pend > 0],
  ].map(([v, l, a]) => `<div class="kpi ${a ? 'alert' : ''}"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  $('dashCards').innerHTML = NOTICES.map(n => {
    const tr = (S.notices[n.id]?.tasks || []).filter(inSite), t = tr.filter(act), w = tr.filter(x => x.판단 === '확인 전').length, d = t.filter(x => x.상태 === '완료').length, p = t.filter(x => x.상태 === '진행 중').length;
    const o = t.filter(x => x.상태 !== '완료' && x.기한 < base()).length;
    const kinds = {}; t.forEach(x => { kinds[x.구분] ||= [0, 0]; kinds[x.구분][0]++; if (x.상태 === '완료') kinds[x.구분][1]++; });
    const pct = t.length ? Math.round(d / t.length * 100) : 0;
    return `<div class="ncard" data-n="${n.id}">
      <div class="row between">${stPill(nstate(n))}<span class="muted small">시행 ${n.시행일} · ${dday(n.시행일)}</span></div>
      <h4>${esc(n.제목.replace('[가상] ', ''))}</h4>
      ${t.length ? `<div class="row between small"><b style="font-size:20px;color:var(--navy)">${pct}%</b><span class="muted">완료 ${d} · 진행 ${p} · 대기 ${t.length - d - p}${tr.length - t.length ? ` · 비대상 ${tr.length - t.length}` : ''}${w ? ` · <b style="color:var(--orange)">판단 대기 ${w}</b>` : ''}${o ? ` · <b style="color:var(--red)">경과 ${o}</b>` : ''}</span></div>
      <div class="prog" style="margin:6px 0 8px"><span class="d" style="width:${d / t.length * 100}%"></span><span class="p" style="width:${p / t.length * 100}%"></span></div>
      <div class="chips" style="margin:0">${Object.entries(kinds).map(([k, [a, b]]) => `<span class="chip">${esc(k)} <b>${b}/${a}</b></span>`).join('')}</div>`
      : `<p class="muted" style="margin:6px 0">아직 영향도 분석 전입니다.</p><button class="btn orange sm">영향도 분석</button>`}</div>`;
  }).join('');
  // 사업장 × 고시 진행 매트릭스
  const cell = (n, id) => { const s0 = S.notices[n.id]; if (!s0) return '<span class="muted">미분석</span>';
    const xs = s0.tasks.filter(x => x.사업장 === id), xa = xs.filter(act); if (!xs.length) return '<span class="muted">영향 없음</span>';
    const d = xa.filter(x => x.상태 === '완료').length, w = xs.filter(x => x.판단 === '확인 전').length, o = xa.filter(x => x.상태 !== '완료' && x.기한 < base()).length, pct = xa.length ? Math.round(d / xa.length * 100) : 100;
    return `<b>${pct}%</b> <span class="muted small">${d}/${xa.length}${w ? ` · 판단 대기 ${w}` : ''}</span>${o ? ` <span class="pill red">경과 ${o}</span>` : ''}<div class="prog" style="height:6px;margin-top:3px"><span class="d" style="width:${pct}%"></span></div>`; };
  $('matrixTable').innerHTML = `<tr><th>사업장</th>${NOTICES.map(n => `<th style="white-space:normal;min-width:150px">${esc(n.제목.replace('[가상] ', '').split('—')[1] || n.제목)}<div style="font-weight:400;font-size:11px;opacity:.8">시행 ${n.시행일}</div></th>`).join('')}</tr>` +
    [...SITES.map(x => x.id), 'HQ'].filter(id => curSite === 'ALL' || id === curSite || id === 'HQ').map(id => `<tr><td><b>${esc(siteName(id))}</b></td>${NOTICES.map(n => `<td>${cell(n, id)}</td>`).join('')}</tr>`).join('');
  const own = {}; all.forEach(t => { own[t.담당자] ||= { a: 0, d: 0, o: 0, p: 0 }; const x = own[t.담당자]; x.a++; if (t.상태 === '완료') x.d++; else if (t.기한 < base()) x.o++; if (t.상태 === '진행 중') x.p++; });
  $('ownerTable').innerHTML = `<tr><th>담당자</th><th>사업장</th><th class="num">배정</th><th class="num">진행 중</th><th class="num">완료</th><th class="num">기한 경과</th><th style="width:30%">완료율</th></tr>` +
    PEOPLE.filter(p => own[p.이름]).map(p => { const x = own[p.이름]; return `<tr><td>${esc(p.이름)} <span class="muted">${esc(p.부서)}</span></td><td>${sitePill(p.사업장)}</td><td class="num">${x.a}</td><td class="num">${x.p}</td><td class="num">${x.d}</td><td class="num" style="${x.o ? 'color:var(--red);font-weight:700' : ''}">${x.o}</td><td><div class="prog"><span class="d" style="width:${x.d / x.a * 100}%"></span></div></td></tr>`; }).join('');
  const dues = [...over, ...soon].sort((a, b) => a.기한 < b.기한 ? -1 : 1).slice(0, 12);
  $('dueTable').innerHTML = `<tr><th>기한</th><th>조치</th><th>담당</th><th>상태</th></tr>` + (dues.map(t => `<tr class="${t.기한 < base() ? 'over' : ''}"><td><b>${t.기한}</b><br><span class="small" style="${t.기한 < base() ? 'color:var(--red);font-weight:700' : ''}">${dday(t.기한)}</span></td><td>${sitePill(t.사업장)} <b>${esc(t.대상)}</b><div class="muted">${esc(t.조치)} · ${t.n.id}</div></td><td>${esc(t.담당자)}</td><td>${taskPill(t.상태)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">30일 이내 마감 항목이 없습니다. 기준일을 바꿔 보세요.</td></tr>');
  $('logTable').innerHTML = `<tr><th>일시</th><th>처리자</th><th>내용</th></tr>` + S.log.slice(0, 25).map(l => `<tr><td class="small">${esc(l.t)}</td><td>${esc(l.who)}</td><td class="small">${esc(l.msg)}</td></tr>`).join('');
}
$('dashCards').onclick = e => { const c = e.target.closest('[data-n]'); if (!c) return; goNotice(c.dataset.n, 't3'); if (!S.notices[c.dataset.n]) runAnalysis(); };

// ================================================================ ⑥ 지식 기반·판정
const citeHtml = list => list.map(c => `<div class="cite"><b>${esc(c.조문)}</b> <span class="muted">(${esc(c.법령)}, 시행 ${esc(c.시행일)})</span><br>${esc(c.내용)}</div>`).join('');
const CHANGE = [['취급량_증가', '취급량 증가'], ['취급시설_용량_증가', '취급시설 용량 증가'], ['신규_취급시설', '새로운 취급시설 설치'], ['물질_변경_추가', '유해화학물질 변경·추가'],
  ['함량_농도_성상_변경', '함량·농도·성상 변경'], ['위험도_증가', '위 변경으로 위험 증가'], ['시설_위치_변경', '사업장 내 취급시설 위치 변경']];
$('facility').innerHTML = SITES.map(x => `<optgroup label="${esc(x.사업장)}">${x.시설.map(f => `<option>${esc(x.약칭)} · ${esc(f.이름)}</option>`).join('')}</optgroup>`).join('');
$('changeChecks').innerHTML = CHANGE.map(([k, t]) => `<label class="chk"><input type="checkbox" data-k="${k}"> ${t}</label>`).join('');
function runJudge() {
  const input = { 변경완료_예정일: $('doneDate').value };
  document.querySelectorAll('#changeChecks input').forEach(c => { if (c.checked) input[c.dataset.k] = true; });
  const res = judgeChange(K, input, base());
  $('judgeHint').textContent = `기준일 ${base()} 시행 규칙으로 판정 · 대상: ${$('facility').value}`;
  if (!res.length) { $('judgeOut').innerHTML = `<div class="result"><h3><span class="pill green">해당 없음</span> 계획서 변경 제출 대상이 아님</h3><p class="muted">선택한 변경 사항이 법 제23조제3항 및 시행규칙 제19조제7항의 요건에 해당하지 않습니다.</p></div>`; return; }
  $('judgeOut').innerHTML = res.map(r => {
    const d = r.기한 ? daysBetween(base(), r.기한) : null;
    return `<div class="result hit"><h3><span class="pill red">대상</span> ${esc(r.조치)}</h3>
      <div class="kv"><b>제출 기한</b><span><b style="color:var(--red)">${esc(r.기한)}</b> ${d !== null ? `(${dday(r.기한)})` : ''} · ${esc(r.기한설명)}</span>
      <b>제출처</b><span>${esc(r.제출처)}</span><b>서식</b><span>${esc(r.서식)}</span><b>해당 사유</b><span>${r.사유.map(m => esc(m.설명)).join(', ')}</span>
      <b>적용 규칙</b><span><span class="pill navy">${esc(r.규칙)} v${r.버전}</span> 시행 ${esc(r.시행일)}</span></div>
      <details><summary>근거 조문 원문 보기</summary>${citeHtml(r.근거)}</details>
      ${intOf(r.규칙).length ? `<details open><summary>관련 해석·판단 ${intOf(r.규칙).length}건</summary>${intCards(intOf(r.규칙))}</details>` : ''}</div>`;
  }).join('');
}
$('judgeBtn').onclick = runJudge;
function renderLabelChecks() {
  const v = activeVersion(K.규칙.find(r => r.유형 === '체크리스트'), base());
  $('labelChecks').innerHTML = `<p class="muted" style="margin:0 0 4px">규칙 R-16-1 v${v.버전} (시행 ${v.시행일})</p>` + v.필수항목.map(t => `<label class="chk"><input type="checkbox" checked data-v="${esc(t)}"> ${esc(t)}</label>`).join('');
}
$('labelBtn').onclick = () => {
  const items = [...document.querySelectorAll('#labelChecks input')].filter(c => c.checked).map(c => c.dataset.v);
  const r = checkLabel(K, items, base());
  $('labelOut').innerHTML = r.적합
    ? `<div class="result"><h3><span class="pill green">적합</span> 필수 표시 항목이 모두 있음</h3>${citeHtml(r.근거)}</div>`
    : `<div class="result hit"><h3><span class="pill red">표시 미흡</span> 누락: ${r.누락.map(esc).join(', ')}</h3>
       <div class="kv"><b>조치</b><span>${esc(r.조치)}</span><b>지적 유형</b><span>${esc(r.가이드?.코드)} ${esc(r.가이드?.지적유형)}</span>
       <b>권고 조치</b><span>${esc(r.가이드?.권고조치)}</span><b>과거 사례</b><span>${(r.가이드?.사례 || []).map(s => `${s.연도} ${esc(s.시설)}: ${esc(s.내용)}`).join('<br>')}</span></div>
       <details><summary>근거 조문</summary>${citeHtml(r.근거)}</details>
       ${intOf(r.규칙).length ? `<details open><summary>관련 해석·판단 ${intOf(r.규칙).length}건</summary>${intCards(intOf(r.규칙))}</details>` : ''}</div>`;
};
function runGolden(Kx) {
  return Kx.정답셋.map(c => {
    let act;
    if (c.유형 === '변경판정') { const r = judgeChange(Kx, c.입력, c.기준일); act = { 규칙: r.map(x => x.규칙), 기한: r[0]?.기한 }; }
    else if (c.유형 === '정기검사') act = inspectionSchedule(Kx, { ...SITE0, 시설: SITE0.시설.filter(f => f.id === c.입력.시설) }, c.기준일)[0];
    else act = checkLabel(Kx, c.입력.항목, c.기준일);
    return { c, act, ok: Object.entries(c.기대).every(([k, v]) => JSON.stringify(v) === JSON.stringify(act[k])) };
  });
}
function renderKnowledge() {
  renderLabelChecks();
  if ($('judgeOut').innerHTML) runJudge();
  $('rulesOut').innerHTML = K.규칙.map(r => `<div class="result"><h3>${esc(r.id)} ${esc(r.이름)} <span class="pill gray">${esc(r.유형)}</span></h3><p class="muted" style="margin:0 0 6px">${esc(r.설명)}</p>
    <div class="scroll"><table><tr><th>버전</th><th>시행일</th><th>폐지일</th><th>상태</th><th>승인</th><th>근거 조문</th><th>핵심 값</th></tr>
    ${r.버전.map(v => { const act = activeVersion(r, base()) === v; return `<tr><td>v${v.버전}</td><td>${v.시행일}</td><td>${v.폐지일 || '-'}</td><td>${act ? '<span class="pill green">기준일 시행 중</span>' : v.시행일 > base() ? '<span class="pill orange">시행 예정</span>' : '<span class="pill gray">이력</span>'}</td><td class="small">${esc(v.승인)}</td><td class="small">${v.근거.join(', ')}</td>
      <td class="small">${v.결과?.기한 ? `기한 ${v.결과.기한.일수}일` : v.결정표 ? `결정표 ${v.결정표.map(t => t.주기_년).join('/')}년 · 연장 ${v.연장?.최대_년}년` : v.필수항목 ? `필수 ${v.필수항목.length}항목` : ''}</td></tr>`; }).join('')}</table></div></div>`).join('');
  $('qtyTable').innerHTML = `<tr><th>물질</th><th>CAS</th><th>취급 사업장</th><th class="num">하위 (기본)</th><th>개정 이력</th><th class="num">기준일 적용 값</th></tr>` +
    ALLCHEM.map(m => `<tr><td>${esc(m.이름)}</td><td>${m.CAS}</td><td>${m.사업장들.map(sitePill).join('')}</td><td class="num">${m.규정수량_하위_t} t</td><td class="small">${(K.수량[m.CAS] || []).map(x => `${x.시행일}부터 ${x.하위} t (${esc(x.승인)} 승인)`).join('<br>') || '-'}</td><td class="num"><b>${qtyAt(m, base()).하위} t</b></td></tr>`).join('');
  const arts = Object.values(K.조문).flat();
  $('lawTable').innerHTML = `<tr><th>ID</th><th>조문</th><th>제목</th><th>시행일</th><th>폐지일</th><th>해시</th><th>내용</th></tr>` +
    arts.map(a => `<tr><td>${a.id}</td><td>${esc(label(a))}</td><td>${esc(a.제목)}</td><td>${a.시행일}</td><td>${a.폐지일 || '-'}</td><td><code>${a.해시}</code></td><td class="small">${esc(a.내용)}</td></tr>`).join('');
  $('guideTable').innerHTML = `<tr><th>코드</th><th>지적 유형</th><th>연결 규칙</th><th>근거 조문</th><th>권고 조치</th></tr>` +
    K.가이드.map(g => `<tr><td>${g.코드}</td><td>${esc(g.지적유형)}</td><td>${g.규칙}</td><td>${g.근거.join(', ')}</td><td>${esc(g.권고조치)}</td></tr>`).join('');
  const results = runGolden(K);
  $('testTable').innerHTML = `<tr><th>사례</th><th>유형</th><th>기준일</th><th>내용</th><th>결과</th></tr>` +
    results.map(({ c, ok }) => `<tr><td>${c.id}</td><td>${c.유형}</td><td>${c.기준일}</td><td>${esc(c.설명)}</td><td><span class="pill ${ok ? 'green' : 'red'}">${ok ? '통과' : '실패'}</span></td></tr>`).join('');
}

// ================================================================ ⑦ GitHub 흐름
const gh = p => repo ? `https://github.com/${repo}${p}` : '#';
$('lnkActions').href = gh('/actions'); $('lnkPulls').href = gh('/pulls');
const FLOW = [
  ['수집', '매일 06시 법제처 Open API로 화학물질관리법·시행규칙·고시 조회', 'GitHub Actions 예약 실행', '/actions'],
  ['신·구 비교', '조문별 해시를 비교해 바뀐 조항만 추출', 'scripts/watch-law.mjs', '/blob/main/scripts/watch-law.mjs'],
  ['영향 분석', '바뀐 조문을 근거로 쓰는 규칙·가이드·사내 문서를 연결 관계로 추적', '근거 조문 ID 연결', '/tree/main/rules'],
  ['AI 초안', 'LLM이 바뀐 원문을 읽고 규칙 수정안·문서 수정안 작성', 'Pull Request 자동 생성', '/pulls'],
  ['전문가 승인', '컨설턴트가 신·구 대조와 수정안을 검토하고 승인', 'PR Review → Approve', '/pulls'],
  ['회귀 테스트', '정답셋을 다시 돌려 의도하지 않은 판정 변화 확인', 'PR 본문 테스트 결과', '/actions'],
  ['배포', '병합하면 새 규칙 버전이 시행일부터 적용, 화면 자동 갱신', 'Merge → GitHub Pages', '/deployments'],
  ['재판정·롤백', '진행 중 조치계획 재판정, 문제 시 이전 버전 복구', 'Revert', '/commits/main'],
];
$('flow').innerHTML = FLOW.map(([t, d, g, p], i) => `<div class="step"><span class="n">${i + 1}</span><b>${t}</b><p>${d}</p><div class="gh">${repo ? `<a href="${gh(p)}" target="_blank">${g} ↗</a>` : g}</div></div>`).join('');

// ================================================================ 공통
function render() {
  renderMonitor();
  if (curTab === 't1') renderSite();
  if (curTab === 't3') renderAna();
  if (curTab === 't4') renderCmp();
  if (curTab === 't5') renderDash();
  if (curTab === 't6') renderKnowledge();
}
$('baseDate').onchange = render;
$('siteSel').innerHTML = `<option value="ALL">전체 (${SITES.length}곳)</option>` + SITES.map(x => `<option value="${x.id}">${esc(x.사업장)}</option>`).join('');
$('siteSel').onchange = e => setSite(e.target.value);
$('resetBtn').onclick = e => { e.preventDefault(); if (confirmBox('시연 데이터를 처음 상태로 되돌릴까요? (이 브라우저에 저장된 분석·승인·이력이 삭제됩니다)')) { seed(); K = knowledge(); render(); toast('시연 데이터를 초기화했습니다'); } };
render();
