import { judgeChange, inspectionSchedule, checkLabel, activeVersion, daysBetween, label, addDays, impact, qtyJudge, siteGroup } from './engine.js';

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
const KEY = 'regai-demo-v8';
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
const personOptsShort = (sel, site) => { const ps = PEOPLE.filter(p => !site || p.사업장 === site || p.사업장 === 'HQ'); const g = {}; ps.forEach(p => (g[p.부서] ||= []).push(p));
  return Object.entries(g).map(([d, xs]) => `<optgroup label="${esc(d)}">${xs.map(p => `<option value="${esc(p.이름)}" ${p.이름 === sel ? 'selected' : ''}>${esc(p.이름)}</option>`).join('')}</optgroup>`).join(''); };
const personOpts = (sel, site) => PEOPLE.filter(p => !site || p.사업장 === site || p.사업장 === 'HQ').map(p => `<option value="${esc(p.이름)}" ${p.이름 === sel ? 'selected' : ''}>${esc(p.이름)} (${esc(p.부서)})</option>`).join('');
const pickPerson = (부서, site) => { const ps = site.담당자; return (ps.find(p => p.부서 === 부서) || ps.find(p => p.부서 === '환경안전팀') || ps[0]).이름; };
const shash = s => { let h = 2166136261; for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, '0') + '····'; };

// ---------------------------------------------------------------- 지식 = 저장소 지식 + 전문가 승인 내역
function docLinks(d) { return (S && S.docLinks && S.docLinks[d.유형]) || d.관련조문; }
function knowledge(apps = S.approvals) {
  const K = { ...B, 규칙: clone(B.규칙), 조문: clone(B.조문), 가이드: clone(B.가이드), 해석: clone(B.해석 || []), 의무: clone(B.의무 || []), 수량: {} };
  const approvedNotices = new Set();
  for (const a of apps) {
    if (a.대기) continue; // 수정안: 확정 전에는 판정에 쓰지 않음
    if (a.notice) approvedNotices.add(a.notice);
    if (a.종류 === '확인') continue;
    if (a.종류 === '수량기준') { (K.수량[a.CAS] ||= []).push({ 시행일: a.시행일, 하위: Number(a.값), 승인: a.승인자 }); continue; }
    if (a.종류 === '새규칙') { K.규칙.push(clone(a.값)); continue; }
    if (a.종류 === '의무편집') { const i = K.의무.findIndex(o => o.코드 === a.값.코드); if (i >= 0) K.의무[i] = clone(a.값); else K.의무.push(clone(a.값)); continue; }
    if (a.종류 === '규칙분류') { const r0 = K.규칙.find(x => x.id === a.규칙); if (r0) { r0.의무분류 = a.값.의무분류; r0.연관분류 = a.값.연관분류 || []; } continue; }
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
  for (const r of K.규칙) { const rv = S.review && S.review[r.id]; if (rv && rv.상태 === '확정') { const v = r.버전.find(x => !x.폐지일) || r.버전[r.버전.length - 1]; v.승인 = `${rv.검토자} 확정 (${(rv.일시 || '').slice(0, 10)})`; } }
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
  const j = qtyJudge(K, { CAS: m.CAS, 함량: m.함량, 보유량: m.최대보유량_t, 성상: m.성상 }, date);
  const fut = (K.수량[m.CAS] || []).filter(x => x.시행일 > date).sort((a, b) => a.시행일 < b.시행일 ? -1 : 1)[0];
  return { ...j, 예정: fut };
}
function mocDue(m) { return mocDueK(K, m); } // 공식 기한: 확정 규칙, 의무 발생일(변경완료 예정일)에 시행 중인 버전
function mocFlags(m) {
  const t = m.변경유형;
  return { 물질_변경_추가: t.includes('물질 변경'), 취급시설_용량_증가: t.includes('용량'), 함량_농도_성상_변경: t.includes('함량'), 위험도_증가: t.includes('위험 증가'), 시설_위치_변경: t.includes('위치') };
}

// ================================================================ 개정 규칙 확정 (C안: 판정은 확정 규칙, 개정안은 권고)
function propPill(n, i) {
  const st = propState(n, i), p = n.규칙제안[i];
  if (st === '승인') return '<span class="pill green">확정</span>';
  if (st === '반려') return '<span class="pill red">반려</span>';
  const d = diffDays(base(), p.시행일);
  return `<span class="pill ${d <= 60 ? 'red' : 'orange'}">AI 추천 · 개정 반영 대기${d >= 0 ? ` (시행 D-${d})` : ' (시행일 경과)'}</span>`;
}
function diffDays(a, b) { return Math.round((new Date(b) - new Date(a)) / 864e5); }
const pkey = (n, i) => `${n.id}:${i}`;
const propState = (n, i) => S.prop[pkey(n, i)] || null;           // null=확정 대기, '승인', '반려'
function pendingApprovals() {
  return NOTICES.flatMap(n => (n.규칙제안 || []).map((p, i) => ({ n, p, i }))).filter(({ n, i, p }) => !propState(n, i) && p.종류 !== '확인')
    .map(({ n, p, i }) => ({ notice: n.id, idx: i, 규칙: p.규칙, 종류: p.종류, 값: p.제안, CAS: p.CAS, 시행일: p.시행일, 근거: p.근거, 승인자: 'AI 추천(미확정)', 일시: nowStr(), 의견: '권고 계산용' }));
}
let _kp = { key: null, K: null };
function KP() { // 확정 규칙 + 미확정 개정안 (권고 일정 계산 전용, 공식 판정에 사용하지 않음)
  const key = S.approvals.length + '|' + JSON.stringify(S.prop);
  if (_kp.key !== key) _kp = { key, K: knowledge([...S.approvals, ...pendingApprovals()]) };
  return _kp.K;
}
function mocDueK(Kx, m) { const r = judgeChange(Kx, { ...mocFlags(m), 변경완료_예정일: m.변경완료_예정일 }, m.변경완료_예정일 > base() ? m.변경완료_예정일 : base())[0]; return r ? r.기한 : null; }
function mocAdvice(m) { const off = mocDueK(K, m), exp = mocDueK(KP(), m); return { off, exp, 권고: exp && off && exp < off ? exp : null }; }
const pendingNotices = () => NOTICES.filter(n => (n.규칙제안 || []).some((p, i) => !propState(n, i) && p.종류 !== '확인'));
function approveProposal(n, i, o) {
  const p = n.규칙제안[i];
  const a = { notice: n.id, idx: i, 규칙: p.규칙, 종류: p.종류, 값: p.종류 === '확인' ? null : o.값, CAS: p.CAS, 시행일: o.시행일, 근거: p.근거, 승인자: o.승인자, 일시: nowStr(), 의견: o.의견 };
  S.approvals.push(a); S.prop[pkey(n, i)] = '승인';
  const ns = S.notices[n.id];
  const allDone = n.규칙제안.every((q, k) => q.규칙 !== p.규칙 || propState(n, k));
  if (allDone && ns) ns.tasks.filter(t => t.규칙키 === p.규칙).forEach(t => { t.상태 = '완료'; t.판단 = '조치 대상'; t.판단자 = a.승인자; });
  log(`${n.id} 개정 규칙 확정: ${p.항목} ${p.현행} → ${a.값 ?? '변경 없음'} (시행 ${a.시행일})`, a.승인자);
  K = knowledge();
  // 연동 조치 기한 재계산 (권고 → 공식)
  let re = 0;
  NOTICES.forEach(nn => (S.notices[nn.id]?.tasks || []).filter(t => t.연동).forEach(t => {
    const site = SITES.find(x => x.id === t.사업장), m = site?.변경관리.find(x => x.id === t.연동.moc); if (!m) return;
    const adv = mocAdvice(m);
    if (adv.off && adv.off !== t.기한) { log(`${t.id} 기한 재계산 ${t.기한} → ${adv.off} (개정 규칙 확정)`, '시스템'); t.기한 = adv.off; re++; }
    t.권고기한 = adv.권고;
  }));
  save(); return { a, re };
}
function rejectProposal(n, i, who, memo) { S.prop[pkey(n, i)] = '반려'; log(`${n.id} 개정 규칙 반려: ${n.규칙제안[i].항목}${memo ? ' — ' + memo : ''}`, who); save(); }

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
        ents = site.변경관리.filter(m => m.상태 === '진행' && m.계획서_제출예정).map(m => {
          const adv = mocAdvice(m), exp = addDays(m.변경완료_예정일, prop ? prop.제안 : -60);
          return { 구분: '설비 변경', 대상: `${m.id} ${m.이름}`, 담당자: m.담당자, 연동: { moc: m.id, notice: n.id },
            v: { ...m, 기존기한: adv.off || m.계획서_제출예정, 신기한: exp, 공식기한: adv.off, 권고기한: adv.권고 } };
        });
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
      for (const e of ents) push({ 구분: e.구분, 대상: e.대상, 영향: fill(r.영향, e.v), 조치: r.조치, 담당자: e.담당자,
        기한: e.연동 ? (e.v.공식기한 || due(r.기한, e.v)) : due(r.기한, e.v), ...(e.연동 ? { 연동: e.연동, 권고기한: e.v.권고기한 } : {}), 신뢰도: r.신뢰도 });
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
      영향: p.종류 === '확인' ? '판정 값 변경 없음 — 근거 문구 확인' : `${p.항목}: ${p.현행} → ${p.제안} (전 사업장 공통 적용)`, 조치: '② 지식·규칙 관리에서 전문가 확인·확정', 근거: [p.근거], 규칙키: p.규칙 });
  }
  for (const g of impact(B, ids).가이드) {
    items.push({ 사업장: 'HQ', 구분: '지식(가이드)', 대상: `지적·조치 가이드 ${g.코드} ${g.지적유형}`, 담당자: '문소희', 기한: addDays(n.시행일, -21), 신뢰도: 0.82,
      영향: '권고 조치 문구에 개정 전 기준이 들어 있을 수 있음', 조치: '권고 조치 문구 갱신', 근거: ids });
  }
  return items.map((x, i) => ({ id: `${n.id}-${String(i + 1).padStart(2, '0')}`, 출처: 'AI', 상태: '대기', 판단: '확인 전', ...x }));
}

// ---------------------------------------------------------------- 초기 상태 (시연용: 일부 고시는 이미 진행 중)
function seed() {
  S = { v: 8, review: {}, notices: {}, approvals: [], prop: {}, log: [], checked: null };
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
      if (t.상태 === '완료') t.증빙 = [{ 이름: `${t.id}_${t.구분 === '문서' ? '개정문서' : t.구분 === '교육' ? '교육결과' : '조치결과'}.pdf`, 크기: 0, 일시: st.분석일 + ' 17:00', 등록자: t.담당자, 샘플: true }];
    });
    S.notices[n.id] = { 분석일: st.분석일, tasks };
    S.log.push({ t: st.분석일 + ' 09:10', who: 'AI', msg: `${n.id} 영향도 분석 — 조치 ${tasks.length}건 제안` });
    if (st.규칙승인) S.log.push({ t: st.분석일 + ' 15:00', who: st.승인자.split(' ')[0], msg: `${n.id} 규칙 반영 제안 승인` });
  }
  S.log.sort((a, b) => a.t < b.t ? 1 : -1);
  save();
}
try { S = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { S = null; }
if (!S || S.v !== 8) seed();
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
  ['t1', 't2', 't3', 't5', 't6', 't7', 't8'].forEach(x => $(x).classList.toggle('hidden', x !== t));
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
    const G = siteGroup(K, site, base());
    return `<div class="ncard" data-site="${site.id}" style="${on ? 'border-color:var(--blue);box-shadow:0 0 0 2px var(--lblue)' : ''}">
      <div class="row between"><b style="font-size:16px;color:var(--navy)">${esc(site.사업장)}</b><span class="pill line">${site.사업장군}</span></div>
      <div class="muted" style="margin:2px 0 6px">${esc(site.기본정보.업종)} · ${esc(site.기본정보.종업원)}</div>
      <div class="small" style="margin-bottom:8px;padding:6px 8px;border-radius:6px;background:${G.결과 === site.사업장군 ? 'var(--lgreen)' : 'var(--lorange)'}">계획서 작성수준 판정 <b>${esc(G.결과)}</b> <span class="muted">(규칙 ${G.규칙} · 고시 기준)</span>${G.결과 !== site.사업장군 ? ` — 등록값 ${site.사업장군}과 다름, 확인 필요` : ' — 등록값과 일치'}</div>
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
  const gp = g => ({ '상위 이상': 'red', '하위 이상': 'orange', '최하위 이상': 'navy', '최하위 미만': 'gray' }[g] || 'gray');
  $('chemTable').innerHTML = `<tr>${sh}<th>물질</th><th>CAS</th><th>함량·성상</th><th class="num">최대 보유량</th><th>적용 기준 (고시)</th><th class="num">함량기준</th><th class="num">최하위</th><th class="num">하위</th><th class="num">상위</th><th>구간</th><th class="num">하위 배수</th><th>취급시설</th></tr>` +
    ss.flatMap(site => site.물질.map(m => {
      const q = qtyAt(m, base());
      if (!q.해당) return `<tr>${sc(site.id)}<td><b>${esc(m.이름)}</b></td><td>${m.CAS}</td><td>${m.함량}% · ${esc(m.성상)}</td><td class="num">${m.최대보유량_t} t</td><td colspan="7" class="small muted">${esc(q.사유)}</td><td>${m.시설.join(', ')}</td></tr>`;
      return `<tr>${sc(site.id)}<td><b>${esc(m.이름)}</b><div class="muted small">${esc(m.구분)}</div></td><td>${m.CAS}</td><td>${m.함량}% · ${esc(m.성상)}</td><td class="num">${m.최대보유량_t} t</td>
        <td class="small"><span class="pill ${q.표 === '별표3' ? 'red' : 'line'}">${q.표 === '별표3' ? '별표3 사고대비' : '별표2 ' + esc(q.구분)}</span><div class="muted">${esc(q.물질명.slice(0, 28))}</div>${q.메모.length ? `<div class="muted" title="${esc(q.메모.join(' / '))}">ⓘ ${esc(q.메모[0].slice(0, 30))}</div>` : ''}</td>
        <td class="num">${q.함량기준 ?? '-'}%</td><td class="num">${q.최하위 ?? '-'}</td><td class="num"><b>${q.하위 ?? '-'}</b>${q.예정 ? `<br><span class="pill orange">${q.예정.시행일}부터 ${q.예정.하위}</span>` : ''}</td><td class="num">${q.상위 ?? '-'}</td>
        <td><span class="pill ${gp(q.구간)}">${q.구간}</span></td><td class="num"><b>${q.배수_하위 ?? '-'}</b></td><td>${m.시설.join(', ')}</td></tr>`;
    })).join('');
  const r242 = activeVersion(K.규칙.find(r => r.id === 'R-24-2'), base());
  $('facDesc').textContent = `다음 검사 기한은 규칙 R-24-2 v${r242.버전}(사업장 군별 결정표)으로 기준일 ${base()}에 계산 — ${ss.map(x => `${x.약칭} ${x.사업장군}`).join(' · ')}`;
  $('facTable').innerHTML = `<tr>${sh}<th>시설</th><th>유형</th><th>취급 물질</th><th>용량</th><th>위험도</th><th>방류벽</th><th>누출감지</th><th>최근 검사</th><th>주기</th><th>다음 기한</th><th>상태</th><th>담당</th></tr>` +
    ss.flatMap(site => site.시설.map((f, i) => { const r = INSP[site.id][i]; return `<tr>${sc(site.id)}<td><b>${esc(f.이름)}</b></td><td>${esc(f.유형)}</td><td class="small">${f.물질.map(id => esc(site.물질.find(m => m.id === id)?.이름)).join(', ')}</td><td>${esc(f.용량)}</td><td>${f.위험도}</td><td class="small">${esc(f.방류벽)}</td><td>${esc(f.누출감지)}</td><td>${f.최근_검사일}</td><td>${r.주기_년}년${r.연장_년 ? ` +${r.연장_년}` : ''}</td><td><b>${r.기한}</b> <span class="muted">${dday(r.기한)}</span></td><td><span class="pill ${st(r.상태)}">${r.상태}</span></td><td>${esc(f.담당자)}</td></tr>`; })).join('');
  $('mocTable').innerHTML = `<tr>${sh}<th>변경 건</th><th>변경 유형</th><th>완료 예정</th><th>계획서 제출 기한</th><th>상태</th></tr>` +
    ss.flatMap(site => site.변경관리.map(m => { const d = m.상태 === '진행' ? mocDue(m) : null; const chg = d && m.계획서_제출예정 && d !== m.계획서_제출예정; const adv = m.상태 === '진행' ? mocAdvice(m) : {};
      return `<tr>${sc(site.id)}<td><b>${m.id}</b><br>${esc(m.이름)}<div class="muted">${esc(m.담당자)}</div></td><td class="small">${esc(m.변경유형)}</td><td>${m.변경완료_예정일}</td>
      <td>${d ? `<b>${d}</b> <span class="small" style="${d < base() ? 'color:var(--red);font-weight:700' : 'color:var(--sub)'}">${dday(d)}</span>${chg ? `<br><span class="pill red">기존 계획 ${m.계획서_제출예정}</span>` : ''}${adv.권고 ? `<br><span class="small" style="color:var(--orange);font-weight:700">권고 ${adv.권고} (개정안 기준·잠정)</span>` : ''}` : '-'}</td><td>${m.상태 === '진행' ? '<span class="pill orange">진행</span>' : '<span class="pill gray">완료</span>'}</td></tr>`; })).join('');
  $('docTable').innerHTML = `<tr>${sh}<th>문서</th><th>개정</th><th>담당</th><th>연결 조문</th></tr>` +
    ss.flatMap(site => site.문서.map(d => `<tr>${sc(site.id)}<td><b>${esc(d.이름)}</b><div class="muted">${d.번호}</div></td><td class="small">${esc(d.개정)}</td><td style="white-space:nowrap">${esc(d.담당자)}</td><td class="small">${docLinks(d).map(x => x === 'QTY' ? '수량기준 고시' : x).join(', ')}</td></tr>`)).join('');
}
$('siteKpi').onclick = e => { const c = e.target.closest('[data-site]'); if (!c) return; setSite(curSite === c.dataset.site ? 'ALL' : c.dataset.site); };
function setSite(id) { curSite = id; $('siteSel').value = id; $('cgName').dataset.auto = '1'; cgInit(false); render(); }

// ================================================================ ③ 모니터링
const SOURCES = [['법제처 현행법령 (화학물질관리법·시행령·시행규칙)', 'Open API'], ['국가법령정보센터 행정규칙 (화학물질안전원·환경부 고시)', 'Open API'], ['입법예고 (국민참여입법센터)', '목록 수집'], ['화학물질안전원 공지사항', '목록 수집']];
function renderMonitor() {
  const ck = S.checked || '오늘 06:00';
  $('sources').innerHTML = SOURCES.map(([a, b]) => `<div class="src"><span>${esc(a)}<br><span class="muted">${b} · 최근 확인 ${esc(ck)}</span></span><span class="ok">정상</span></div>`).join('');
  $('noticeList').innerHTML = NOTICES.map(n => {
    const st = nstate(n), s = S.notices[n.id];
    const done = s ? s.tasks.filter(t => t.상태 === '완료').length : 0;
    return `<div class="result ${st === '신규' ? 'hit' : ''}" data-ncard="${n.id}">
      <div class="row between"><div>${stPill(st)} <span class="pill line">${esc(n.구분)}</span> <span class="muted">${esc(n.발령기관)} · ${esc(n.공포번호)}</span></div><span class="muted">감지 ${n.감지일} · ${esc(n.감지경로)}</span></div>
      <h3 style="margin:8px 0 4px">${esc(n.제목)}</h3>
      <p class="muted" style="margin:0 0 8px">${esc(n.요약)}</p>
      ${propWarn(n)}
      <div class="row between"><div class="row small"><span>공포 <b>${n.공포일}</b></span><span>시행 <b>${n.시행일}</b> <span class="muted">(${dday(n.시행일)})</span></span><span>바뀐 조문 <b>${n.변경조문.length}</b>건</span>${s ? `<span>조치 <b>${done}/${s.tasks.length}</b> 완료</span>` : ''}</div>
      ${s ? `<div class="chips" style="margin:6px 0 0">${SITES.map(x => { const c = s.tasks.filter(t => t.사업장 === x.id).length; return `<span class="chip">${esc(x.약칭)} <b>${c ? c + '건' : '영향 없음'}</b></span>`; }).join('')}</div>` : ''}
      <div class="row"><button class="btn ghost sm" data-cmp="${n.id}">${CMPOPEN.has(n.id) ? '신·구 비교 닫기' : '신·구 비교'}</button><button class="btn ${s ? 'blue' : 'orange'} sm" data-ana="${n.id}">${s ? '조치 목록 보기' : '우리 사업장 영향도 분석'}</button></div></div>${CMPOPEN.has(n.id) ? cmpInline(n) : ''}</div>`;
  }).join('');
  const nnew = NOTICES.filter(n => nstate(n) === '신규').length;
  $('newDot').textContent = nnew; $('newDot').classList.toggle('hidden', !nnew);
}
function propWarn(n) {
  const ps = (n.규칙제안 || []).map((p, i) => ({ p, i })).filter(({ p, i }) => p.종류 !== '확인');
  if (!ps.length) return '';
  const pend = ps.filter(({ i }) => !propState(n, i));
  if (!pend.length) return `<div class="small" style="margin:0 0 8px"><span class="pill green">규칙 확정</span> 개정 규칙 ${ps.length}건 확정 — 시행일부터 새 기준으로 공식 판정</div>`;
  const d = diffDays(base(), n.시행일), red = d <= 60;
  return `<div class="small" style="margin:0 0 8px;padding:6px 10px;border-radius:8px;background:${red ? '#FDECEC' : '#FFF4E5'};border:1px solid ${red ? 'var(--red)' : 'var(--orange)'}"><b style="color:${red ? 'var(--red)' : 'var(--orange)'}">⚠ 시행 ${d >= 0 ? 'D-' + d : '경과'}, 규칙 미확정 ${pend.length}건</b> — 새 기준은 권고 일정으로만 표시 · <a href="#" data-p7="P|${n.id}|${pend[0].i}">②에서 확정 →</a></div>`;
}
$('noticeList').onclick = e => {
  const p7 = e.target.closest('[data-p7]'); if (p7) { e.preventDefault(); return openReview(p7.dataset.p7); }
  const c = e.target.closest('[data-cmp]'), a = e.target.closest('[data-ana]');
  if (c) { const id = c.dataset.cmp; CMPOPEN.has(id) ? CMPOPEN.delete(id) : CMPOPEN.add(id); return renderMonitor(); }
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

// ================================================================ ④ 영향 분석·조치
function noticeHead(n) {
  return `<div class="row" style="gap:6px">${stPill(nstate(n))}<span class="pill line">${esc(n.구분)}</span><b style="color:var(--navy)">${esc(n.제목)}</b></div>
    <div class="row small muted" style="margin-top:6px"><span>${esc(n.공포번호)}</span><span>공포 ${n.공포일}</span><span>시행 <b style="color:var(--text)">${n.시행일}</b> (${dday(n.시행일)})</span><span>${esc(n.요약)}</span></div>${propWarn(n).replace('margin:0 0 8px', 'margin:8px 0 0')}`;
}
const ALLCHEM = Object.values(SITES.reduce((a, x) => { x.물질.forEach(m => { (a[m.CAS] ||= { ...m, 사업장들: [] }).사업장들.push(x.id); }); return a; }, {}));
const SUM = k => SITES.reduce((a, x) => a + x[k].length, 0);
const STEPS = n => [`바뀐 조문 ${n.변경조문.length}건 읽기 · 변경 요지 추출`, `사업장 ${SITES.length}곳 데이터와 대조 (${SITES.map(x => x.약칭).join('·')} — 물질 ${SUM('물질')}종 · 시설 ${SUM('시설')}개 · 변경관리 ${SUM('변경관리')}건)`,
  `사업장별 사내 문서 ${SUM('문서')}건에서 수정 위치 탐색 · 수정 문구 작성`, '판정 규칙 · 지적·조치 가이드 연결 추적', '조치 목록 · 담당자 · 기한 제안'];
function runAnalysis(after) {
  const n = N();
  const steps = STEPS(n);
  let k = 0;
  const draw = () => { $('anaBox').innerHTML = `<div class="card"><h2>AI 영향도 분석 중…</h2><ul class="steps">${steps.map((s, i) => `<li class="${i < k ? 'done' : i === k ? 'run' : 'wait'}">${esc(s)}</li>`).join('')}</ul></div>`; };
  draw();
  const tick = () => {
    k++; draw();
    if (k < steps.length) return setTimeout(tick, 550);
    const tasks = analyze(n);
    tasks.filter(x => x.규칙키 && n.규칙제안.every((q, k) => q.규칙 !== x.규칙키 || S.prop[`${n.id}:${k}`])).forEach(x => { x.상태 = '완료'; x.판단 = '조치 대상'; x.판단자 = '김지훈'; });
    S.notices[n.id] = { 분석일: base(), tasks };
    if (typeof after === 'function') after();
    log(`${n.id} 영향도 분석 — 조치 ${tasks.length}건 제안`, 'AI'); save();
    setTimeout(() => { renderAna(); toast(`AI가 영향 항목 ${tasks.length}건을 찾았습니다. 담당자·기한을 확인하세요.`); }, 300);
  };
  setTimeout(tick, 550);
}
function noticeSummary(n) {
  const st = S.notices[n.id];
  const ch = n.변경조문.map(c => { const d = diffHtml(c.구, c.신); return `<li><b>${esc(c.조문)}</b> — ${esc(c.제목)}<div class="diff small" style="margin-top:2px">개정 전: ${d.oldH}<br>개정 후: ${d.newH}</div></li>`; }).join('');
  const props = (n.규칙제안 || []).map((p, i) => `<li>${esc(p.항목)}: ${esc(p.현행)} → <b>${esc(p.제안)}</b> (시행 ${esc(p.시행일)}) — ${esc(S.prop[`${n.id}:${i}`] || '전문가 확인 대기')}</li>`).join('');
  let imp = '';
  if (st) {
    const t = st.tasks.filter(act);
    imp = `<li>영향 항목 ${st.tasks.length}건 (조치 대상 ${t.length}건, 완료 ${t.filter(x => x.상태 === '완료').length}건) — ` +
      [...SITES.map(x => x.id), 'HQ'].map(id => { const k = st.tasks.filter(x => x.사업장 === id).length; return `${siteShort(id)} ${k ? k + '건' : '영향 없음'}`; }).join(' · ') + '</li>';
    const docs = st.tasks.filter(x => x.수정안 && x.수정안.length).length;
    if (docs) imp += `<li>수정이 필요한 사내 문서 ${docs}건 (수정 위치 ${st.tasks.reduce((a, x) => a + (x.수정안?.length || 0), 0)}곳)</li>`;
    const due = t.filter(x => x.상태 !== '완료').map(x => x.기한).sort()[0];
    if (due) imp += `<li>가장 빠른 조치 기한 ${due} (${dday(due)})</li>`;
  }
  return `<div class="nsum printonly"><h4>고시 요약</h4>
    <table style="font-size:12.5px;margin-bottom:6px"><tr><td style="width:90px"><b>고시명</b></td><td>${esc(n.제목)}</td></tr><tr><td><b>발령</b></td><td>${esc(n.발령기관)} · ${esc(n.공포번호)} · 공포 ${n.공포일} · <b>시행 ${n.시행일}</b></td></tr><tr><td><b>요지</b></td><td>${esc(n.요약)}</td></tr></table>
    <b>주요 변경 내용</b><ul>${ch}</ul>
    ${props ? `<b style="display:block;margin-top:6px">판정 기준(지식) 반영</b><ul>${props}</ul>` : ''}
    ${imp ? `<b style="display:block;margin-top:6px">우리 사업장 영향 요약</b><ul>${imp}</ul>` : ''}
    <p class="muted small" style="margin:6px 0 0">출력 ${nowStr()} · 기준일 ${base()} · ${curSite === 'ALL' ? '전체 사업장' : siteName(curSite)}</p></div>`;
}
function renderAna() {
  $('selN3').innerHTML = noticeOpts();
  const n = N();
  $('nHead3').innerHTML = noticeHead(n) + noticeSummary(n);
  const s = S.notices[n.id];
  if (!s) {
    $('anaBox').innerHTML = `<div class="card" style="text-align:center;padding:36px"><h2>아직 분석하지 않은 고시입니다</h2><button class="btn orange big" id="anaBtn">우리 사업장 영향도 분석</button></div>`;
    $('anaBtn').onclick = () => runAnalysis();
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
    <div class="row between"><div><h2>영향 분석 결과 · 조치 목록</h2><p class="desc" style="margin:0">분석일 ${s.분석일} · AI 제안 ${t.filter(x => x.출처 === 'AI').length}건 · 직접 추가 ${t.filter(x => x.출처 !== 'AI').length}건</p></div>
      <div class="row noprint">${jw ? `<button class="btn blue sm" id="bulkBtn">확인 전 ${jw}건 모두 조치 대상</button>` : ''}<button class="btn ghost sm" id="notifyBtn">담당자 알림 발송</button><button class="btn ghost sm" id="csvBtn">엑셀(CSV) 내보내기</button><button class="btn ghost sm" id="reBtn">다시 분석</button></div></div>
    <div class="chips"><span class="chip" style="${jw ? 'border-color:var(--orange);background:var(--lorange)' : ''}">판단 대기 <b>${jw}</b></span><span class="chip">조치 대상 <b>${jy}</b></span><span class="chip">비대상 <b>${jn}</b></span><span class="chip" style="${t.filter(x => act(x) && x.상태 === '완료' && !(x.증빙 || []).length).length ? 'border-color:var(--red);background:var(--lred)' : ''}">증빙 누락 <b>${t.filter(x => act(x) && x.상태 === '완료' && !(x.증빙 || []).length).length}</b></span><span class="muted" style="align-self:center">|</span>${Object.entries(cnt).map(([k, v]) => `<span class="chip">${esc(k)} <b>${v}</b></span>`).join('')}<span class="chip">문서 수정 제안 <b>${docRecs.length}</b>곳 (채택 ${docRecs.filter(r => r.채택).length})</span></div>
    <div class="chips">${bySite.map(b => `<span class="chip" data-site="${b.id === 'HQ' ? 'ALL' : b.id}" style="cursor:pointer;${curSite === b.id ? 'border-color:var(--blue);background:var(--bg)' : ''}">${esc(siteName(b.id))} <b>${b.n ? `${b.n}건` : '영향 없음'}</b>${b.n ? ` · 완료 ${b.a ? Math.round(b.d / b.a * 100) : 0}%${b.w ? ` · 판단 대기 ${b.w}` : ''}` : ''}</span>`).join('')}</div>
    <div class="prog"><span class="d" style="width:${ta.length ? done / ta.length * 100 : 0}%"></span><span class="p" style="width:${ta.length ? prog / ta.length * 100 : 0}%"></span></div>
    <div class="legend"><span><i style="background:var(--green)"></i>완료 ${done}</span><span><i style="background:var(--orange)"></i>진행 중 ${prog}</span><span><i style="background:#E3E9F2"></i>대기 ${ta.length - done - prog}</span><span>(비대상 ${jn}건 제외)</span>${over ? `<span style="color:var(--red);font-weight:700">기한 경과 ${over}</span>` : ''}</div>
    <div class="scroll" style="margin-top:12px"><table class="tasks" id="taskTable">
      <colgroup><col style="width:52px"><col style="width:80px"><col style="min-width:240px"><col style="width:230px"><col style="width:112px"><col style="width:96px"><col style="width:116px"><col style="width:84px"><col style="width:150px"><col class="noprint" style="width:46px"></colgroup>
      <tr><th>사업장</th><th>구분</th><th>영향 대상 · 내용</th><th>조치</th><th>담당자 판단</th><th>담당자</th><th>기한</th><th>상태</th><th>완료 증빙</th><th class="noprint"></th></tr>
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
// ================================================================ AI에게 물어보기 (조치 근거 설명)
// 시연: 지식 기반(규칙·조문·고시·해석·사업장 데이터)만으로 설명을 구성. 운영 시 사내 sLLM이 같은 근거로 문장을 생성
const ASK = { open: new Set(), busy: new Set() };
function askSec(t, body, id) { return body ? `<div class="asksec" ${id ? `data-sec="${id}"` : ''} style="margin:10px 0 0"><div style="font-weight:800;color:var(--navy);margin-bottom:4px">${t}</div>${body}</div>` : ''; }
function explainTask(x, n) {
  const site = SITES.find(s0 => s0.id === x.사업장), sName = site ? site.사업장 : '본사(공통)';
  const fact = [], logic = [], check = [];
  let rule = x.규칙키 && x.규칙키 !== '수량기준' ? K.규칙.find(r => r.id === x.규칙키) : null, cites = [], dueTxt = '';
  const ob = taskObl(x);
  // 사업장 사실관계 + 판정 논리 (조치 유형별)
  if (x.연동 && site) {
    const m = site.변경관리.find(y => y.id === x.연동.moc);
    if (m) {
      fact.push(['변경관리', `${m.id} ${m.이름} (담당 ${m.담당자})`], ['변경 유형', m.변경유형], ['변경완료 예정일', m.변경완료_예정일], ['기존 계획서 제출 예정', m.계획서_제출예정 || '-']);
      const jd = m.변경완료_예정일 > base() ? m.변경완료_예정일 : base();
      const r0 = judgeChange(K, { ...mocFlags(m), 변경완료_예정일: m.변경완료_예정일 }, jd)[0], rp = judgeChange(KP(), { ...mocFlags(m), 변경완료_예정일: m.변경완료_예정일 }, jd)[0];
      if (r0) {
        rule = K.규칙.find(r => r.id === r0.규칙);
        logic.push(`판정 규칙 <b>${esc(r0.규칙)} v${r0.버전}</b> (${esc(r0.규칙명)}, 시행 ${esc(r0.시행일)}) ${ruleBadge(r0.규칙)}의 제출 요건 중 <b>${r0.사유.map(s0 => esc(s0.설명)).join(', ')}</b>에 해당합니다.`);
        logic.push(`변경 유형 "${esc(m.변경유형)}"은 시행규칙의 변경 제출 사유와 연결되므로, 변경된 화학사고예방관리계획서를 <b>${esc(r0.제출처 || '화학물질안전원장')}</b>에게 ${esc(r0.서식 || '서식')}에 따라 제출해야 합니다.`);
        dueTxt = `공식 기한 <b>${esc(r0.기한)}</b> (${dday(r0.기한)}) — ${esc(r0.기한설명 || '')}. 변경완료 예정일(${esc(m.변경완료_예정일)})에 시행 중인 <b>확정 규칙</b>으로 계산했습니다.`;
        if (rp && rp.기한 && rp.기한 < r0.기한) dueTxt += `<br><span style="color:var(--orange);font-weight:700">권고 ${esc(rp.기한)}</span> — 이번 고시(${esc(n.id)}) 개정안이 확정되면 적용될 기한입니다. 변경완료 예정일이 개정 시행일(${esc(n.시행일)}) 이후라 새 기한 적용 대상이므로, 확정 전이라도 권고 일정에 맞춰 준비하는 것이 안전합니다.`;
        cites = r0.근거;
      }
      if (m.변경완료_예정일 < n.시행일) check.push(`변경완료 예정일이 개정 시행일(${esc(n.시행일)}) 전이면 종전 기한(30일 전)이 적용됩니다 — 일정이 앞당겨지면 다시 판정하세요.`);
      check.push('취급량 증가가 계획서에 적은 최대 취급량 범위 안의 일시적 변동이면 변경 제출 대상이 아닐 수 있습니다 (관련 해석 참고).');
    }
  } else if (x.구분 === '물질' && site) {
    const cas = (x.대상.match(/CAS ([\d-]+)/) || [])[1], m = cas && site.물질.find(y => y.CAS === cas);
    if (m) {
      fact.push(['물질', `${m.이름} (CAS ${m.CAS})`], ['분류', m.구분], ['최대보유량', `${m.최대보유량_t} t`], ['함량·성상', `${m.함량}% · ${m.성상}`], ['취급시설', (m.시설 || []).join(', ')]);
      const q = (n.수량변경 || []).find(y => y.CAS === m.CAS);
      const j0 = qtyJudge(K, { CAS: m.CAS, 함량: m.함량, 보유량: m.최대보유량_t, 성상: m.성상 }, n.시행일), j1 = qtyJudge(KP(), { CAS: m.CAS, 함량: m.함량, 보유량: m.최대보유량_t, 성상: m.성상 }, n.시행일);
      rule = K.규칙.find(r => r.유형 === '수량판정');
      if (q) logic.push(`이번 고시로 하위 규정수량이 <b>${esc(q.하위_구)} t → ${esc(q.하위_신)} t</b>로 낮아집니다. 이 사업장 최대보유량 ${m.최대보유량_t} t은 하위 규정수량의 ${(m.최대보유량_t / q.하위_구).toFixed(1)}배 → <b>${(m.최대보유량_t / q.하위_신).toFixed(1)}배</b>가 됩니다.`);
      if (j0.해당) logic.push(`규정수량 판정 규칙 <b>${esc(j0.규칙)}</b>: 현재 <b>${esc(j0.구간)}</b>${j1.구간 !== j0.구간 ? ` → 개정 반영 시 <b style="color:var(--red)">${esc(j1.구간)}</b>` : ' (구간은 유지되지만 배수 증가)'}. ${(j1.메모 || []).map(esc).join(' ')}`);
      logic.push('규정수량 배수와 구간은 화학사고예방관리계획서 작성수준(1군·2군), 장외영향평가 범위, 취급시설 검사 주기 판단에 함께 쓰이므로 계획서와 관련 문서를 다시 확인해야 합니다.');
      cites = j1.근거 || [];
      check.push('혼합물은 전체 혼합물 총량으로 최대보유량을 산정해야 합니다 — 입력값이 순물질량이면 결과가 달라질 수 있습니다.');
    }
  } else if (x.구분 === '시설' && site) {
    const f = site.시설.find(y => y.이름 === x.대상);
    if (f) {
      fact.push(['시설', `${f.이름} (${f.유형}, ${f.용량 || '-'})`], ['위험도', f.위험도], ['최근 검사일', f.최근_검사일], ['연속 적합', `${f.연속적합_횟수}회 · 검사기관 ${f.검사기관수}곳`], ['방류벽·누출감지', `${f.방류벽 || '-'} · ${f.누출감지 || '-'}`]);
      const sc = inspectionSchedule(K, site, base()).find(y => y.시설 === f.이름);
      if (sc) { rule = K.규칙.find(r => r.id === sc.규칙); logic.push(`정기검사 결정표 <b>${esc(sc.규칙)} v${sc.버전}</b>: 사업장군 ${esc(site.사업장군)}·위험도 ${esc(f.위험도)} → 주기 ${sc.주기_년}년${sc.연장_년 ? ` + 연장 ${sc.연장_년}년` : ''}, 다음 검사 기한 <b>${esc(sc.기한)}</b> (${esc(sc.상태)}).`); cites = sc.근거; }
      logic.push(`이번 고시가 바꾼 조항이 이 시설의 취급 물질 또는 검사 조건과 연결되어 영향 대상으로 분류했습니다.`);
    }
  } else if (x.구분 === '문서' && site) {
    const d = site.문서.find(y => y.id === x.문서);
    if (d) {
      fact.push(['문서', `${d.이름} (${d.번호}, ${d.개정})`], ['관리 부서', `${d.부서} · ${d.담당자}`], ['문서가 인용하는 조문', docLinks(d).map(id => id === 'QTY' ? '규정수량 표' : artLabel(id)).join(', ')]);
      const hit = n.변경조문.filter(c => docLinks(d).includes(c.id) || (c.id.startsWith('QTY') && docLinks(d).includes('QTY')));
      logic.push(`이 문서는 이번 고시에서 바뀐 ${hit.length ? hit.map(c => `<b>${esc(c.조문)}</b>`).join(', ') : '조항'}을(를) 인용하고 있어 문구가 개정 내용과 어긋나게 됩니다.`);
      { const rr = docRules(d.유형); if (rr.length) logic.push(`이 문서와 연결된 판정 규칙: ${rr.map(id => `<b>${esc(id)}</b> ${esc(K.규칙.find(r => r.id === id)?.이름 || '')}`).join(', ')} — 규칙이 바뀌면 문서도 같이 맞춰야 합니다.`); }
      if (x.수정안?.length) logic.push(`AI가 수정이 필요한 위치 ${x.수정안.length}곳을 찾았습니다: ${x.수정안.map(r => esc(r.위치)).join(' / ')}.`);
      cites = cite0(docLinks(d).filter(id => id !== 'QTY'));
    }
  } else if (x.사업장 === 'HQ') {
    fact.push(['대상', x.대상], ['담당', '본사 환경안전팀 · TO21 컨설팅본부']);
    logic.push('판정 규칙과 지적·조치 가이드는 3개 사업장이 함께 쓰는 공통 지식입니다. 법규가 바뀌면 지식을 먼저 확정해야 각 사업장의 판정·기한이 새 기준으로 계산됩니다.');
  } else {
    fact.push(['사업장', sName], ['대상', x.대상]);
    if (site) fact.push(['진행 중 변경관리', `${site.변경관리.filter(m => m.상태 === '진행').length}건`], ['취급 물질', `${site.물질.length}종`]);
  }
  if (!cites.length && rule) cites = cite0(latest(rule).근거 || []);
  const ints = rule ? intOf(rule.id) : [];
  if (!dueTxt) dueTxt = `조치 기한 <b>${esc(x.기한)}</b> (${dday(x.기한)}) — ${x.출처 === 'AI' ? `AI 영향 규칙 기준: 고시 시행일(${esc(n.시행일)}) 전 준비 기간을 두고 산정` : '담당자 지정'}. 담당자가 바꿀 수 있습니다.`;
  if ((x.신뢰도 || 1) < 0.7) check.push(`AI 신뢰도 ${Math.round(x.신뢰도 * 100)}% — 담당자 확인이 필요합니다.`);
  if (x.판단 === '비대상') check.push(`담당자가 비대상으로 판단: ${esc(x.판단사유 || '(사유 없음)')}`);
  const o = ob ? oblOf(ob) : null;
  const 결론 = `<b>${esc(sName)}</b>의 <b>${esc(x.대상)}</b>은(는) ${esc(n.제목.replace('[가상] ', ''))}(공포 ${esc(n.공포일)}, 시행 ${esc(n.시행일)})의 영향을 받습니다. 따라서 <b>「${esc(x.조치)}」</b> 조치가 필요합니다.${o ? ` 이 조치는 화관법 의무 <b>${esc(o.상위?.코드 || '')} ${esc(o.상위?.이름 || '')}</b>의 세부 업무 <b>${esc(o.코드)} ${esc(o.이름)}</b>에 해당합니다.` : ''}`;
  return `<div class="askbox" data-askid="${esc(x.id)}" style="position:sticky;left:0;max-width:min(1140px,88vw);box-sizing:border-box;border:1px solid #C9B8F0;background:#FBF9FF;border-radius:10px;padding:12px 14px">
    <div class="row between"><div><span class="ai">AI</span> <b>왜 ${esc(sName)}은(는) 이 조치를 해야 하나요?</b> <span class="muted small">· ${esc(aiLabel())}</span></div><button class="btn ghost sm noprint" data-askclose="${esc(x.id)}">닫기</button></div>
    <div class="aiout"></div>
    <div class="row noprint" style="margin-top:8px;gap:6px"><input type="text" class="askq" placeholder="추가 질문 (예: 계획서 범위 안 증설이면 비대상인가요?)" style="flex:1;min-width:240px"><button class="btn blue sm" data-askq="${esc(x.id)}">질문</button>${aiOn() ? '' : '<a href="#" class="small" data-aicfg="1">생성형 AI 연결</a>'}</div>
    <details class="askev" ${aiOn() ? '' : 'open'} style="margin-top:8px"><summary class="small"><b>근거 자료</b> (지식 기반 설명 — 확정 규칙·조문·고시·사업장 데이터)</summary><div class="askevid">
    ${askSec('결론', `<p style="margin:0">${결론}</p>`)}
    ${askSec('이 사업장의 사실관계 (사업장 데이터)', fact.length ? `<div class="kv">${fact.map(([k, v]) => `<b>${esc(k)}</b><span>${esc(String(v))}</span>`).join('')}</div>` : '')}
    ${askSec('판정 논리', `<ol style="margin:0;padding-left:20px">${(logic.length ? logic : [`AI 영향 규칙: ${esc(x.영향)}`]).map(l => `<li>${l}</li>`).join('')}</ol>`, 'logic')}
    ${askSec('이번 고시로 바뀐 내용', n.변경조문.map(c => `<div style="margin-bottom:6px"><div class="row" style="margin-bottom:3px"><b style="color:var(--navy)">${esc(c.조문)}</b><span class="muted small">${esc(c.제목)}</span>${srcBtn(c.id)}</div>${cmpBox(c.구, c.신, '개정 전', `개정 후 (시행 ${n.시행일})`)}</div>`).join(''), 'diff')}
    ${askSec('적용 법규·근거 조문 (현행 원문)', cites.length ? citeHtml(cites) : '<p class="muted small" style="margin:0">연결된 조문이 없습니다.</p>', 'cite')}
    ${askSec('기한 산정', `<p style="margin:0">${dueTxt}</p>`, 'due')}
    ${o ? askSec('의무 · 이행하지 않으면', `<p style="margin:0">${oblPill(ob)} ${penHtml(o)}</p>`, 'pen') : ''}
    ${ints.length ? askSec('관련 해석·판단 (유권해석·컨설턴트)', intCards(ints), 'int') : ''}
    ${check.length ? askSec('담당자 확인 사항 · 비대상이 될 수 있는 경우', `<ul style="margin:0;padding-left:20px">${check.map(c => `<li>${c}</li>`).join('')}</ul>`, 'check') : ''}
    </div></details></div>`;
}
// ---- 생성형 AI 연결 (Claude API 또는 사내 온프레미스 LLM, 미설정 시 지식 기반 설명만)
const AIKEY = 'regai-ai';
function aiCfg() { try { return JSON.parse(localStorage.getItem(AIKEY)) || {}; } catch (e) { return {}; } }
function aiSave(c) { try { localStorage.setItem(AIKEY, JSON.stringify(c)); } catch (e) { /* 저장 불가 */ } }
const aiOn = () => { const c = aiCfg(); return c.종류 && c.종류 !== '지식' && (c.종류 === '사내' ? !!c.주소 : !!c.키); };
const aiLabel = () => { const c = aiCfg(); return !aiOn() ? '지식 기반 (생성형 AI 미연결)' : c.종류 === 'Claude' ? `Claude (${c.모델 || 'claude-sonnet-4-5'})` : `사내 LLM (${c.모델 || '-'})`; };
const AI_SYS = `너는 화학물질관리법(화관법) 전문 컨설턴트다. 사용자는 사업장 환경안전 담당자다.
규칙: 1) 반드시 [근거 자료]에 있는 사실·조문·수치만 사용한다. 2) 결론을 먼저 말하고, 사업장 사실관계 → 적용 조문(조·항·호를 명시) → 판정 논리 → 기한 → 이행하지 않을 때의 벌칙 → 담당자가 확인할 점 순서로 설명한다. 3) 근거 자료에 없는 내용은 추측하지 말고 "확인 필요"라고 쓴다. 4) 벌칙 금액이 근거 자료에 없으면 금액을 쓰지 않는다. 5) 한국어, 개조식, 600자 내외.`;
async function aiAsk(question, context, history = []) {
  const c = aiCfg();
  const user = `[질문]\n${question}\n\n[근거 자료]\n${context}`;
  if (c.종류 === 'Claude') {
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': c.키, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: c.모델 || 'claude-sonnet-4-5', max_tokens: 1500, system: AI_SYS, messages: [...history, { role: 'user', content: user }] }) });
    const j = await res.json(); if (!res.ok) throw new Error(j.error?.message || res.status);
    return j.content.map(b => b.text || '').join('');
  }
  const url = c.주소.replace(/\/$/, '') + (/\/chat\/completions$/.test(c.주소) ? '' : '/v1/chat/completions');
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(c.키 ? { authorization: `Bearer ${c.키}` } : {}) },
    body: JSON.stringify({ model: c.모델 || 'default', temperature: 0.2, messages: [{ role: 'system', content: AI_SYS }, ...history, { role: 'user', content: user }] }) });
  const j = await res.json(); if (!res.ok) throw new Error(j.error?.message || res.status);
  return j.choices[0].message.content;
}
const md = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^#{1,4}\s*(.+)$/gm, '<div style="font-weight:800;color:var(--navy);margin-top:6px">$1</div>').replace(/^\s*[-*]\s+(.+)$/gm, '<div style="padding-left:12px">• $1</div>').replace(/\n/g, '<br>').replace(/(<\/div>)<br>/g, '$1');
const ASKH = {};
async function runAi(id, question) {
  const box = document.querySelector(`[data-askid="${id}"]`); if (!box) return;
  const out = box.querySelector('.aiout'), dt = box.querySelector('.askev'), was = dt.open; dt.open = true; const ctx = box.querySelector('.askevid').innerText; dt.open = was;
  const h = ASKH[id] ||= [];
  out.insertAdjacentHTML('beforeend', `<div class="aiq small" style="margin-top:8px"><b>Q.</b> ${esc(question)}</div><div class="aia" style="margin-top:4px"><span class="muted small">${esc(aiLabel())}가 근거를 읽고 답변을 작성하는 중…</span></div>`);
  const slot = out.lastElementChild;
  try {
    const ans = await aiAsk(question, ctx, h);
    h.push({ role: 'user', content: `[질문]\n${question}` }, { role: 'assistant', content: ans });
    slot.innerHTML = `<div style="background:#fff;border:1px solid #E3DAF7;border-radius:8px;padding:10px 12px">${md(ans)}</div>`;
    log(`AI 질의: ${id} — ${question.slice(0, 40)}`, 'AI');
  } catch (err) { slot.innerHTML = `<span style="color:var(--red)" class="small">AI 연결 실패: ${esc(String(err.message || err))} — AI 설정(주소·키·모델)을 확인하세요. 아래 지식 기반 설명은 그대로 볼 수 있습니다.</span>`; }
}
function openAiCfg() {
  const c = aiCfg();
  $('aiBody').innerHTML = `<div class="kv"><b>답변 엔진</b><span><select id="aiKind"><option value="지식" ${!c.종류 || c.종류 === '지식' ? 'selected' : ''}>지식 기반 (오프라인, 생성형 AI 미사용)</option><option value="Claude" ${c.종류 === 'Claude' ? 'selected' : ''}>Claude API (Anthropic)</option><option value="사내" ${c.종류 === '사내' ? 'selected' : ''}>사내 온프레미스 LLM (OpenAI 호환 API)</option></select></span>
    <b>API 주소</b><span><input type="text" id="aiUrl" value="${esc(c.주소 || '')}" style="width:100%" placeholder="사내 LLM만 입력 · 예: http://10.0.0.5:8000/v1"></span>
    <b>모델</b><span><input type="text" id="aiModel" value="${esc(c.모델 || '')}" style="width:280px" placeholder="Claude: claude-sonnet-4-5 · 사내: 모델명"></span>
    <b>API 키</b><span><input type="password" id="aiKey" value="${esc(c.키 || '')}" style="width:100%" placeholder="Claude API 키 (사내 LLM은 필요 시)" autocomplete="off"></span></div>
    <p class="muted small" style="margin:8px 0 0">키는 이 브라우저에만 저장됩니다 (시연 PC에서만 입력). 어느 엔진이든 화면의 근거 자료만 넘겨 답하게 합니다.</p>
    <div class="row" style="margin-top:10px"><button class="btn green" id="aiSaveBtn">저장</button><button class="btn ghost" id="aiClear">키 삭제</button></div>`;
  $('aiModal').classList.remove('hidden');
  $('aiSaveBtn').onclick = () => { aiSave({ 종류: $('aiKind').value, 주소: $('aiUrl').value.trim(), 모델: $('aiModel').value.trim(), 키: $('aiKey').value.trim() }); $('aiModal').classList.add('hidden'); toast(`답변 엔진: ${aiLabel()}`); render(); };
  $('aiClear').onclick = () => { aiSave({ 종류: '지식' }); $('aiModal').classList.add('hidden'); toast('AI 연결 정보를 지웠습니다'); render(); };
}

function taskAdv(x) { if (!x.연동) return null; const site = SITES.find(s0 => s0.id === x.사업장), m = site?.변경관리.find(y => y.id === x.연동.moc); return m ? mocAdvice(m).권고 : null; }
function taskRow(x, i) {
  let adv;
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
  const link = x.규칙키 ? ` <a href="#" data-rule="1" class="small">→ ② 확정 화면</a>` : '';
  const jc = { '확인 전': 'orange', '조치 대상': 'navy', 비대상: 'gray' }[x.판단];
  const judge = `<select data-f="판단" style="border-color:var(--${jc === 'gray' ? 'line' : jc});font-weight:700">${JD.map(v => `<option ${v === x.판단 ? 'selected' : ''}>${v}</option>`).join('')}</select>
    ${x.출처 === 'AI' ? `<div class="small muted" style="margin-top:3px">AI 추천: ${(x.신뢰도 || 0) < 0.7 ? '검토 필요' : '조치 대상'}</div>` : ''}
    ${na ? `<textarea data-f="판단사유" placeholder="비대상 사유 (필수)" style="min-height:52px;margin-top:4px;font-size:12px;${x.판단사유 ? '' : 'border-color:var(--red)'}">${esc(x.판단사유 || '')}</textarea>` : ''}
    ${!wait && x.판단자 ? `<div class="small muted" style="margin-top:3px">확인: ${esc(x.판단자)}</div>` : ''}`;
  return `<tr class="${over ? 'over' : ''} ${na ? 'na' : ''}" data-i="${i}">
    <td>${sitePill(x.사업장)}</td>
    <td><span class="pill line">${esc(x.구분)}</span><br>${src}${(o0 => { const o = o0 && oblOf(o0); return o ? `<div class="small" style="margin-top:3px;color:${OBL_CLR};line-height:1.3;white-space:normal" title="${esc((o.상위 ? o.상위.이름 + ' › ' : '') + o.이름)}"><b>${esc(o.코드)}</b> ${esc(o.이름)}</div>` : ''; })(taskObl(x))}</td>
    <td><b>${esc(x.대상)}</b><div class="muted">${esc(x.영향)}</div>${recs}</td>
    <td class="act">${esc(x.조치)}${link ? `<div>${link}</div>` : ''}<div class="noprint" style="margin-top:4px"><button class="btn ghost sm" data-ask="${esc(x.id)}" style="border-color:#C9B8F0;color:#5B3FA8">${ASK.open.has(x.id) ? '설명 닫기' : 'AI에게 물어보기'}</button></div></td>
    <td>${judge}</td>
    <td><select data-f="담당자" title="${esc((PEOPLE.find(p => p.이름 === x.담당자) || {}).부서 || '')}">${personOptsShort(x.담당자, x.사업장 === 'HQ' ? null : x.사업장)}</select><div class="small muted">${esc((PEOPLE.find(p => p.이름 === x.담당자) || {}).부서 || '')}</div></td>
    <td><input type="date" data-f="기한" value="${x.기한}"><div class="small ${over ? '' : 'muted'}" style="${over ? 'color:var(--red);font-weight:700' : ''}">${dday(x.기한)}${x.연동 ? ' · 공식' : ''}</div>${(adv = taskAdv(x)) && adv < x.기한 && x.상태 !== '완료' && !na ? `<div class="small" style="color:var(--orange);font-weight:700;margin-top:2px" title="미확정 개정안 기준 — 더 이른 일정으로 준비 권고">권고 ${adv}<br><span style="font-weight:400">개정안 기준·잠정</span></div>` : ''}</td>
    <td>${na ? '<span class="pill gray">해당 없음</span>' : `<select data-f="상태" ${wait ? 'disabled title="먼저 조치 대상 여부를 확인하세요"' : ''}>${ST.map(s => `<option ${s === x.상태 ? 'selected' : ''}>${s}</option>`).join('')}</select>${wait ? '<div class="small muted">판단 후 진행</div>' : ''}`}</td>
    <td>${evCell(x, i)}</td>
    <td class="noprint">${x.출처 !== 'AI' ? `<button class="btn ghost sm" data-del="${i}">삭제</button>` : ''}</td></tr>` + (ASK.open.has(x.id) ? `<tr class="askrow noprint"><td colspan="10" style="background:#fff">${explainTask(x, N())}</td></tr>` : '');
}
function evCell(x, i) {
  if (x.판단 === '비대상') return '<span class="muted small">-</span>';
  const ev = x.증빙 || [];
  const list = ev.map((v, j) => `<div class="small" style="display:flex;gap:4px;align-items:center;margin-bottom:2px"><span>📎</span>${v.data ? `<a href="${v.data}" download="${esc(v.이름)}" title="${esc(v.일시)} · ${esc(v.등록자)}">${esc(v.이름)}</a>` : `<span title="${esc(v.일시)} · ${esc(v.등록자)}${v.샘플 ? ' (시연 샘플)' : ' (파일 크기가 커서 목록만 저장)'}">${esc(v.이름)}</span>`}<a href="#" data-evdel="${i}:${j}" class="noprint" style="color:var(--red);text-decoration:none">✕</a></div>`).join('');
  if (x.상태 !== '완료') return list ? list : '<span class="muted small">완료 시 첨부</span>';
  return `${list || '<span class="pill red">증빙 필요</span>'}<label class="btn ghost sm noprint" style="margin-top:3px;display:inline-block">+ 첨부<input type="file" multiple data-ev="${i}" style="display:none"></label>`;
}
function onTaskChange(e) {
  if (e.target.closest(".askrow")) return;
  if (e.target.dataset.ev !== undefined) {
    const i = +e.target.dataset.ev, n = N(), x = S.notices[n.id].tasks[i], files = [...e.target.files];
    Promise.all(files.map(f => new Promise(res => {
      const meta = { 이름: f.name, 크기: f.size, 일시: nowStr(), 등록자: '김지훈' };
      if (f.size > 400 * 1024) return res(meta);
      const fr = new FileReader(); fr.onload = () => res({ ...meta, data: fr.result }); fr.readAsDataURL(f);
    }))).then(list => {
      x.증빙 = [...(x.증빙 || []), ...list];
      log(`${x.id} 완료 증빙 첨부: ${list.map(v => v.이름).join(', ')}`);
      try { save(); } catch (err) { list.forEach(v => delete v.data); save(); }
      renderAna(); toast(`증빙 ${list.length}건을 첨부했습니다`);
    });
    return;
  }
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
  if (f === '상태' && x[f] === '완료' && !(x.증빙 || []).length) toast('완료 처리됨 — 오른쪽 "완료 증빙"에 증빙자료를 첨부하세요');
}
function onTaskClick(e) {
  const n = N(), t = S.notices[n.id].tasks, el = e.target;
  const ij = s => s.split(':').map(Number);
  const ak = e.target.closest('[data-ask]'); if (ak) { const id = ak.dataset.ask; if (ASK.open.has(id)) ASK.open.delete(id); else { ASK.open.add(id); if (aiOn()) setTimeout(() => runAi(id, '왜 이 사업장은 이 조치를 해야 하나요? 관련 고시와 법규 근거를 들어 설명해 주세요.'), 50); } return renderAna(); }
  const acl = e.target.closest('[data-askclose]'); if (acl) { ASK.open.delete(acl.dataset.askclose); return renderAna(); }
  const aq = e.target.closest('[data-askq]'); if (aq) { const box = aq.closest('.askbox'), q = box.querySelector('.askq').value.trim(); if (!q) return toast('질문을 입력하세요'); box.querySelector('.askq').value = '';
    if (!aiOn()) { box.querySelector('.aiout').insertAdjacentHTML('beforeend', `<div class="small" style="margin-top:6px"><b>Q.</b> ${esc(q)}<br><span class="muted">생성형 AI가 연결되지 않아 자유 질문에는 답할 수 없습니다. 아래 근거 자료를 확인하거나, 상단 'AI 설정'에서 Claude 또는 사내 LLM을 연결하세요.</span></div>`); box.querySelector('.askev').open = true; return; }
    return runAi(aq.dataset.askq, q); }
  const cf = e.target.closest('[data-aicfg]'); if (cf) { e.preventDefault(); return openAiCfg(); }
  if (el.dataset.rule) { e.preventDefault(); const k = (n.규칙제안 || []).findIndex(q => q.규칙 === t[+el.closest('tr').dataset.i]?.규칙키); return openReview(`P|${n.id}|${Math.max(0, k)}`); }
  if (el.dataset.evdel) { e.preventDefault(); const [i, j] = el.dataset.evdel.split(':').map(Number); const v = t[i].증빙.splice(j, 1)[0]; log(`${t[i].id} 증빙 삭제: ${v.이름}`); save(); return renderAna(); }
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
  const rows = [['번호', '사업장', '구분', '대상', '영향', '조치', '담당자 판단', '비대상 사유', '판단자', '담당자', '기한', '상태', '완료 증빙', '출처', '근거']].concat(t.map(x => [x.id, siteName(x.사업장), x.구분, x.대상, x.영향, x.조치, x.판단, x.판단사유 || '', x.판단자 || '', x.담당자, x.기한, x.판단 === '비대상' ? '해당 없음' : x.상태, (x.증빙 || []).map(v => v.이름).join(' / '), x.출처 === 'AI' ? `AI(${Math.round(x.신뢰도 * 100)}%)` : '직접', (x.근거 || []).join(' ')]));
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `${n.id}_조치목록.csv`; a.click();
}
$('selN3').onchange = e => { cur = e.target.value; renderAna(); };
$('cmpLink').onclick = () => openCmp(cur);
$('printBtn').onclick = () => { document.querySelectorAll('#taskTable details').forEach(d => d.open = true); window.print(); };

// ================================================================ 고시 신·구 비교 (③ 고시 모니터링 카드 안에서 펼침)
const CMPOPEN = new Set();
function cmpInline(n) {
  return `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)">${n.변경조문.map(c => `<div style="margin-bottom:10px"><div class="row" style="margin-bottom:4px"><b style="color:var(--navy)">${esc(c.조문)}</b><span class="muted small">${esc(c.제목)}</span>${srcBtn(c.id)}</div>${cmpBox(c.구, c.신, '개정 전', `개정 후 (시행 ${n.시행일})`)}</div>`).join('')}
    ${(n.규칙제안 || []).length ? `<div class="small" style="margin-top:4px"><b>규칙 변경안</b> ${(n.규칙제안).map((p, i) => `<div style="margin-top:4px">${propPill(n, i)} ${esc(p.항목)}: ${esc(p.현행)} → <b>${esc(p.제안)}</b> <a href="#" data-p7="P|${n.id}|${i}">② 지식·규칙 관리에서 보기 →</a></div>`).join('')}</div>` : ''}</div>`;
}
function openCmp(id) { CMPOPEN.add(id); showTab('t2'); setTimeout(() => document.querySelector(`[data-ncard="${id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60); }

// ================================================================ 지식 탐색기 (그래프 + 목록 + 편집)
const ED = { sel: 'R-23-3', mode: 'view', draft: null, q: '', hover: null };
const DOC_TYPES = SITES[0].문서.map(d => ({ 유형: d.유형, 이름: d.이름 }));
const refsOf = r => [...new Set(r.버전.flatMap(v => [...(v.근거 || []), ...[...JSON.stringify(v).matchAll(/"근거":"([^"]+)"/g)].map(m => m[1])]))];
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
  K.해석.forEach(x => add('I:' + x.id, '해석', String(x.제목 || x.id).replace(/["']/g, ''), `${x.구분} · ${x.상태}`, 3));
  const has = id => nodes.some(n => n.id === id);
  const E = (a, b, t) => { if (has(a) && has(b) && !edges.some(e => e.a === a && e.b === b)) edges.push({ a, b, t }); };
  NOTICES.forEach(n => n.변경조문.forEach(c => E('N:' + n.id, artKey(c.id), '개정')));
  DOC_TYPES.forEach(d => docLinks(SITES[0].문서.find(x => x.유형 === d.유형)).forEach(id => E('D:' + d.유형, id === 'QTY' ? 'QTY' : 'A:' + id, '인용')));
  K.규칙.forEach(r => refsOf(r).forEach(id => E('A:' + id, r.id, '근거')));
  K.가이드.forEach(g => { E(g.규칙, 'G:' + g.코드, '연결'); (g.근거 || []).forEach(id => E('A:' + id, 'G:' + g.코드, '근거')); });
  Object.entries(K.조문).forEach(([id, vs]) => (vs[0].위임 || []).forEach(x => E('A:' + id, 'A:' + x, '위임')));
  K.해석.forEach(x => { (x.관련조문 || []).forEach(id => E('A:' + id, 'I:' + x.id, '해석')); (x.적용규칙 || []).forEach(r => E(r, 'I:' + x.id, '적용')); });
  return { nodes, edges };
}
function safeGraph() { try { return graphSvg(); } catch (err) { console.error(err); return `<p style="color:var(--red)" class="small">관계도를 그리는 중 오류가 났습니다: ${esc(String(err.message || err))} — 오른쪽 위 '시연 데이터 초기화' 후 다시 시도하거나 이 문구를 알려주세요.</p>`; } }
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
    const L0 = String(n.label ?? ''), S0 = String(n.sub ?? ''); const lab = L0.length > 19 ? L0.slice(0, 18) + '…' : L0;
    return `<g class="gnode" data-node="${esc(n.id)}" style="cursor:pointer" opacity="${on ? 1 : .25}">
      <rect x="${p.x}" y="${p.y}" width="${NW}" height="${NH}" rx="7" fill="${sel ? c : '#fff'}" stroke="${c}" stroke-width="${sel ? 2.5 : 1.3}"/>
      <rect x="${p.x}" y="${p.y}" width="5" height="${NH}" rx="2" fill="${c}"/>
      <text x="${p.x + 12}" y="${p.y + 14}" font-size="11.5" font-weight="700" fill="${sel ? '#fff' : '#1F2A3C'}">${esc(lab)}</text>
      <text x="${p.x + 12}" y="${p.y + 27}" font-size="9.5" fill="${sel ? '#E5ECF7' : '#5B6577'}">${esc(S0.length > 30 ? S0.slice(0, 29) + '…' : S0)}</text>
      <title>${esc(L0)} — ${esc(S0)}</title></g>`; }).join('');
  const heads = colHead.map((h, i) => `<text x="${colX[i]}" y="20" font-size="12" font-weight="800" fill="#1B2F5B">${h}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:900px;display:block" xmlns="http://www.w3.org/2000/svg">${heads}${eh}${nh}</svg>`;
}

// ---- 화면
function renderKX() { try { return renderKX0(); } catch (err) { console.error(err); const h = $('kxHost'); if (h) h.innerHTML = `<p style="color:var(--red)">관계도 표시 오류: ${esc(String(err.message || err))}</p>`; } }
function renderKX0() {
  if (RV.view !== '관계도') return curTab === 't8' ? renderReview() : null;
  const host = $('kxHost'); if (!host) return;
  if ($('rvDetail')) $('rvDetail').innerHTML = '';
  host.innerHTML = '<div id="kx"></div>';
  const box = host.querySelector('#kx');
  const legend = Object.entries({ 고시: '고시·개정', 조문: '법령 조문', 규칙: '판정 규칙·기준표', 가이드: '지적·조치 가이드', 해석: '해석·판단 (유권해석·컨설턴트)', 문서: '사업장 문서' })
    .map(([k, v]) => `<span><i style="background:${TYPE_COLOR[k]}"></i>${v}</span>`).join('') +
    '<span style="margin-left:10px">선: <b style="color:#C9822B">개정</b> · <b style="color:#2D5FA8">근거</b> · <b style="color:#3A9B6A">연결</b> · <b style="color:#6B5BA8">인용</b> · <b style="color:#B5487A">해석·적용</b> · <b style="color:#9AA5B4">위임(점선)</b></span>';
  const sel = ED.sel, ro = sel && (sel.startsWith('A:') || sel.startsWith('N:'));
  box.innerHTML = `
    <div class="row between"><div><h2 style="margin:0">전체 관계도</h2><p class="desc" style="margin:2px 0 0">노드를 누르면 연결된 지식이 강조됩니다 · 규칙·기준표·가이드·해석·문서는 목록에서 열려 수정할 수 있습니다</p></div></div>
    <div class="legend" style="margin:10px 0 4px;flex-wrap:wrap">${legend}</div>
    <div class="scroll" id="kxGraph" style="border:1px solid var(--line);border-radius:10px;background:#FBFCFE;padding:6px">${safeGraph()}</div>
    ${ro ? `<div id="kxDetail" style="margin-top:12px">${detailHtml()}</div>` : ''}`;
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
const nbChips = (id, skip = []) => { const xs = neighbors(id).filter(x => !skip.includes(x.n.type)); return xs.length ? `<div class="chips">${xs.map(x => `<span class="chip" data-node="${esc(x.n.id)}" style="cursor:pointer;border-color:${TYPE_COLOR[x.n.type]}"><span class="muted">${x.t}</span> <b>${esc(x.n.label)}</b></span>`).join('')}</div>` : '<p class="muted">연결된 지식이 없습니다.</p>'; };
const citeChip = (id, del) => `<span class="chip" style="border-color:${TYPE_COLOR.조문}"><b data-node="A:${esc(id)}" style="cursor:pointer">${esc(artLabel(id))}</b> <code>${esc(id)}</code>${del ? ` <a href="#" data-act="${del}" data-v="${esc(id)}" style="color:var(--red);text-decoration:none">✕</a>` : ''}</span>`;
const citeSelect = (sid, exclude = []) => `<select id="${sid}"><option value="">+ 조문 연결</option>${Object.keys(K.조문).filter(x => !exclude.includes(x)).map(x => `<option value="${x}">${esc(artLabel(x))} (${x})</option>`).join('')}</select>`;
const nbCard = (title, id, skip) => { const xs = neighbors(id).filter(x => !skip.includes(x.n.type)); return xs.length ? card(title, nbChips(id, skip)) : ''; };
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
    const LK = v.조건.any ? 'any' : 'all', LIST = v.조건[LK];
    const conds = LIST.map((c, i) => {
      if (c.all) return `<li><b>모두 해당:</b> ${c.all.map((x, j) => `${edit ? bind(`버전.조건.${LK}.${i}.all.${j}.설명`, x.설명, 150) : `<b>${esc(x.설명)}</b>`} ${citeChip(x.근거)}`).join(' <b>+</b> ')} ${edit ? `<a href="#" data-act="cond-del" data-v="${i}" style="color:var(--red)">삭제</a>` : ''}</li>`;
      return `<li>${edit ? bind(`버전.조건.${LK}.${i}.설명`, c.설명, 230) : `<b>${esc(c.설명)}</b>`} <span class="muted small">(${esc(c.필드)})</span> ${citeChip(c.근거)} ${edit ? `<a href="#" data-act="cond-del" data-v="${i}" style="color:var(--red)">삭제</a>` : ''}</li>`;
    }).join('');
    const used = LIST.flatMap(c => c.all ? c.all.map(x => x.필드) : [c.필드]);
    const addC = edit ? `<div class="row" style="margin-top:6px"><select id="kxNewField"><option value="">+ 조건 추가</option>${Object.entries(FIELD_NAME).filter(([k]) => !used.includes(k)).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select>${citeSelect('kxNewFieldCite')}<button class="btn ghost sm" data-act="cond-add">추가</button></div>` : '';
    const d = v.결과.기한;
    const dueH = !d ? '-' : d.일수 != null && !d.년 && !d.개월
      ? `${esc(FIELD_NAME[d.기준필드] || d.기준필드.replace(/_/g, ' '))} ${edit ? `<button class="btn ghost sm" data-act="days" data-v="-10">−10</button> <input type="number" data-bind="버전.결과.기한.일수" data-num="1" value="${d.일수}" style="width:70px"> <button class="btn ghost sm" data-act="days" data-v="10">+10</button> 일 → <b id="kxDaysTxt">${daysTxt(d.일수)}</b>` : `<b style="color:var(--red);font-size:15px">${daysTxt(d.일수)}</b>`}`
      : `${esc(d.기준필드.replace(/_/g, ' '))} <b style="color:var(--red);font-size:15px">${d.년 ? `+${d.년}년 ` : ''}${d.개월 ? `+${d.개월}개월 ` : ''}${d.일수 ? daysTxt(d.일수) : ''}</b> 이내`;
    return `<div class="kxrule"><div class="kxif">IF</div><div><b>${LK === 'any' ? '다음 중 하나라도 해당하면' : '다음을 모두 충족하면'}</b><ol style="margin:6px 0;padding-left:20px;line-height:2">${conds}</ol>${addC}</div></div>
      <div class="kxrule"><div class="kxif then">THEN</div><div class="kv" style="grid-template-columns:90px 1fr;margin:0">
        <b>조치</b><span>${bind('버전.결과.조치', v.결과.조치, 300)}</span><b>제출처</b><span>${bind('버전.결과.제출처', v.결과.제출처, 200)}</span><b>서식</b><span>${bind('버전.결과.서식', v.결과.서식, 200)}</span>
        <b>제출 기한</b><span>${dueH} ${d ? citeChip(d.근거) : ''}</span></div></div>`;
  }
  if (r.유형 === '결정표') {
    const rows = v.결정표.map((t, i) => `<tr><td>${edit ? `<select data-bind="버전.결정표.${i}.사업장군">${['1군', '2군', '기타'].map(x => `<option ${x === t.사업장군 ? 'selected' : ''}>${x}</option>`).join('')}</select>` : t.사업장군}</td>
      <td>${edit ? `<select data-bind="버전.결정표.${i}.위험도"><option value="">(전체)</option>${['가', '나', '다'].map(x => `<option ${x === t.위험도 ? 'selected' : ''}>${x}</option>`).join('')}</select>` : t.위험도 || '(전체)'}</td>
      <td>${edit ? `<input type="number" data-bind="버전.결정표.${i}.주기_년" data-num="1" value="${t.주기_년}" style="width:60px">` : `<b>${t.주기_년}</b>`} 년</td>${edit ? `<td><a href="#" data-act="row-del" data-v="${i}" style="color:var(--red)">삭제</a></td>` : ''}</tr>`).join('');
    const x = v.연장;
    return `<b>사업장 군 · 시설 위험도 → 정기검사 주기</b><table style="margin:6px 0 4px;max-width:520px"><tr><th>사업장 군</th><th>위험도</th><th>주기</th>${edit ? '<th></th>' : ''}</tr>${rows}</table>${edit ? '<button class="btn ghost sm" data-act="row-add">+ 행 추가</button>' : ''}
      <div class="kxrule" style="margin-top:10px"><div class="kxif">연장</div><div>최근 ${edit ? `<input type="number" data-bind="버전.연장.조건.연속적합_횟수_이상" data-num="1" value="${x.조건.연속적합_횟수_이상}" style="width:50px">` : `<b>${x.조건.연속적합_횟수_이상}</b>`}회 연속 적합 · 검사기관 ${edit ? `<input type="number" data-bind="버전.연장.조건.검사기관수_이상" data-num="1" value="${x.조건.검사기관수_이상}" style="width:50px">` : `<b>${x.조건.검사기관수_이상}</b>`}곳 이상 → 최대 ${edit ? `<input type="number" data-bind="버전.연장.최대_년" data-num="1" value="${x.최대_년}" style="width:50px">` : `<b>${x.최대_년}</b>`}년 연장 ${citeChip(x.근거)}</div></div>`;
  }
  if (r.유형 === '수량판정') {
    const o = v.옵션;
    return `<div class="kxrule"><div class="kxif">1</div><div>사고대비물질이면 <b>별표 3</b>, 아니면 <b>별표 2</b> 규정수량 적용 ${edit ? `<select data-bind="버전.옵션.사고대비우선"><option value="true">(사고대비 우선 적용)</option></select>` : ''}</div></div>
      <div class="kxrule"><div class="kxif">2</div><div>함량이 <b>함량기준(% 이상)</b>에 미달하면 대상 아님</div></div>
      <div class="kxrule"><div class="kxif">3</div><div>성상이 <b>액체</b>이면 용액(*) 값, 액체·고체이며 <b>저확산</b> 표시가 있으면 저확산 값 적용 ${edit ? `<label class="small"><input type="checkbox" data-bind="버전.옵션.저확산적용" ${o.저확산적용 ? 'checked' : ''} disabled> 저확산 적용</label>` : ''}</div></div>
      <div class="kxrule"><div class="kxif">4</div><div>급성·만성·생태 등 복수 구분 해당 시 ${edit ? `<select data-bind="버전.옵션.복수구분">${['최소값', '첫 번째'].map(x => `<option ${x === o.복수구분 ? 'selected' : ''}>${x}</option>`).join('')}</select>` : `<b>${esc(o.복수구분 === '최소값' ? '가장 낮은 규정수량' : o.복수구분)}</b>`} 적용</div></div>
      <div class="kxrule"><div class="kxif then">THEN</div><div>최대보유량을 비교해 구간 판정: ${v.구간.map(g => `<span class="pill navy">${g.이름}</span>`).join(' ')} <span class="muted small">(기준표: 별표2 ${K.규정수량표.별표2.length}행 · 별표3 ${K.규정수량표.별표3.length}행 — <a href="#" data-node="QTY">규정수량 표 보기</a>)</span></div></div>`;
  }
  if (r.유형 === '사업장판정') {
    return `<table style="max-width:640px"><tr><th>순서</th><th>물질 구간(하나라도)</th><th>추가 조건</th><th>판정</th></tr>${v.결정.map((d, i) => `<tr><td>${i + 1}</td><td><span class="pill navy">${esc(d.구간)}</span></td><td>${d.조건 ? esc(d.조건.replace(/_/g, ' ')) : '-'}</td><td><b>${esc(d.결과)}</b><div class="muted small">${esc(d.설명 || '')}</div></td></tr>`).join('')}<tr><td>-</td><td colspan="2">그 외</td><td><b>${esc(v.기본)}</b></td></tr></table>
      <p class="muted small">물질별 구간은 <a href="#" data-node="R-QTY-1">R-QTY-1</a> 결과를 사용합니다.</p>`;
  }
  if (r.유형 === '기준표') {
    const cols = v.열 || [];
    return `<b>기준표 <span class="muted small">— 위에서부터 처음 맞는 행 적용 (규칙 저작 도구에서 작성)</span></b><table style="margin:6px 0"><tr>${cols.map(c => `<th>${esc(c.이름)} <span class="small" style="font-weight:400">(${esc(c.종류)})</span></th>`).join('')}</tr>${(v.행 || []).map(rw => `<tr>${cols.map(c => `<td>${esc(rw[c.이름] ?? '')}</td>`).join('')}</tr>`).join('')}</table>${v.결과?.조치 ? `<div class="kv"><b>조치</b><span>${esc(v.결과.조치)}</span></div>` : ''}`;
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
  ${nbCard('연결된 지식 (가이드·해석·문서)', r.id, ['조문'])}`;
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
      <label class="field"><span>작성자</span><select data-bind="승인자">${personOpts(d.승인자, 'HQ')}</select></label>
      <label class="field" style="flex:1;min-width:200px"><span>수정 사유</span><input type="text" data-bind="의견" value="${esc(d.의견 || '')}" placeholder="예: 내부 기준 강화" style="width:100%"></label></div>
    <div class="row"><button class="btn green" data-act="save" ${ch.length ? '' : 'disabled'}>수정안 저장 (v${last.버전 + 1})</button><button class="btn ghost" data-act="cancel">취소</button></div>`;
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
    
    <div class="scroll"><table><tr><th>물질</th><th>CAS</th><th>사업장</th><th class="num">하위 규정수량</th><th class="num">상위</th><th>사업장별 배수</th><th>개정 이력</th></tr>${rows}</table></div>
    ${edit ? `<div class="row" style="align-items:flex-end;margin-top:8px"><label class="field"><span>적용 시행일</span><input type="date" id="kxQtyDate" value="${ED.draft.시행일}"></label><label class="field"><span>작성자</span><select id="kxQtyBy">${personOpts('김지훈', 'HQ')}</select></label>
      <button class="btn green" data-act="qty-save">수정안 저장</button><button class="btn ghost" data-act="cancel">취소</button></div>` : ''}
  </div>${nbCard('연결된 지식', 'QTY', [])}`;
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
  </div>${nbCard('연결된 지식', 'G:' + g.코드, ['조문'])}`;
}
// ---- 조문
function artHtml(id) {
  const vs = K.조문[id];
  const docs = SITES.flatMap(s0 => s0.문서.filter(d => docLinks(d).includes(id)).map(d => `${s0.약칭} ${d.이름}`));
  return `<div class="result" style="background:#fff"><h3 style="margin:0 0 4px">${esc(label(vs[0]))} ${esc(vs[0].제목)} <code>${id}</code></h3>
    <p class="muted small" style="margin:0 0 8px">${esc(vs[0].법령명)}</p>
    ${vs.map((a, i) => `<div class="cite" style="${a.폐지일 ? 'opacity:.6' : ''}"><b>시행 ${a.시행일}${a.폐지일 ? ` ~ ${a.폐지일} (이력)` : ''}</b> <code>${a.해시}</code><br>${i ? cmpBox(vs[i - 1].내용, a.내용, '이전', '개정').replace('class="cmp diff"', 'class="cmp diff" style="margin-top:6px"') : esc(a.내용)}</div>`).join('')}
    <p class="small" style="margin:8px 0 0">이 조문을 인용하는 사업장 문서 <b>${docs.length}</b>건${docs.length ? `: <span class="muted">${esc(docs.slice(0, 6).join(', '))}${docs.length > 6 ? ' 외' : ''}</span>` : ''}</p></div>
    ${card('연결된 지식 (이 조문이 바뀌면 영향받는 대상)', nbChips('A:' + id))}`;
}
// ---- 문서 유형
function docHtml(t) {
  const d0 = SITES[0].문서.find(d => d.유형 === t), links = docLinks(d0);
  return `<div class="result" style="background:#fff"><h3 style="margin:0 0 4px">${esc(d0.이름)} <span class="pill gray">사업장 문서</span></h3>
    
    <b class="small">연결 조문</b><div class="chips">${links.map(c => c === 'QTY' ? `<span class="chip"><b data-node="QTY" style="cursor:pointer">수량기준 고시</b> <a href="#" data-act="dl-del" data-v="QTY" style="color:var(--red);text-decoration:none">✕</a></span>` : citeChip(c, 'dl-del')).join('')}
      ${citeSelect('kxNewCite', links)}<button class="btn ghost sm" data-act="dl-add">연결</button></div>
    <table style="margin-top:8px"><tr><th>사업장</th><th>문서 번호</th><th>개정</th><th>담당</th></tr>${SITES.map(s0 => { const d = s0.문서.find(x => x.유형 === t); return d ? `<tr><td>${sitePill(s0.id)}</td><td>${esc(d.번호)}</td><td class="small">${esc(d.개정)}</td><td>${esc(d.담당자)}</td></tr>` : ''; }).join('')}</table></div>
    ${nbCard('연결된 지식', 'D:' + t, ['조문', '기준표'])}`;
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
  </div>${isNew ? '' : nbCard('연결된 지식', 'I:' + iid, ['조문', '규칙'])}`;
}
function newRuleHtml() {
  return `<div class="result" style="background:#fff;border-color:var(--orange)"><h3>새 점검 규칙 추가 (체크리스트형)</h3>
    <div class="field"><span>규칙 이름</span><input type="text" id="nrName" style="width:100%" placeholder="예: 저장탱크 방류벽 점검 항목"></div>
    <div class="field"><span>의무 분류 (세부 업무)</span>${oblSelect('nrObl', 'C06-1')}</div>
    <div class="field"><span>근거 조문</span>${citeSelect('nrCite')}</div>
    <div class="field"><span>점검 항목 (한 줄에 하나)</span><textarea id="nrItems" placeholder="방류벽 용량 110% 이상&#10;배수 밸브 평상시 잠금&#10;방류벽 내부 균열 없음"></textarea></div>
    <div class="row"><label class="row small">시행일 <input type="date" id="nrDate" value="${base()}"></label><button class="btn green" data-act="nr-save">규칙 추가</button><button class="btn ghost" data-act="cancel">취소</button></div></div>`;
}

// ---- 이벤트
function setPath(o, path, val) { const ks = path.split('.'); let x = o; ks.slice(0, -1).forEach(k => { x = x[k]; }); x[ks[ks.length - 1]] = val; }
function selectNode(id) {
  if (RV.view !== '관계도' && curTab === 't8') {
    if (id.startsWith('A:')) { const aid = id.slice(2); if (SRCKEY(aid)) return openSource(aid); const a = (K.조문[aid] || [])[0]; return toast(a ? `${label(a)}: ${a.내용.slice(0, 120)}` : aid); }
    if (id.startsWith('N:')) return openCmp(id.slice(2));
    ED.mode = 'view'; ED.draft = null; ED.verView = null; ED.sel = id;
    RV.sel = K.규칙.some(r => r.id === id) ? id : 'K|' + id; return renderReview();
  }
  ED.sel = id; ED.mode = 'view'; ED.draft = null; ED.verView = null; renderKX(); }
function refreshDetail() { if ($('kxDetail')) $('kxDetail').innerHTML = detailHtml(); if ($('kxGraph')) $('kxGraph').innerHTML = graphSvg(); if ($('kxNav')) $('kxNav').innerHTML = navHtml(); }
function bindKX() {
  const box = $('kx');
  box.onmouseover = e => { if (!$('kxGraph')) return; const g = e.target.closest('#kxGraph [data-node]'); const h = g ? g.dataset.node : null; if (h !== ED.hover) { ED.hover = h; $('kxGraph').innerHTML = graphSvg(); } };
  box.onmouseleave = () => { if (ED.hover && $('kxGraph')) { ED.hover = null; $('kxGraph').innerHTML = graphSvg(); } };
  if ($('kxQ')) $('kxQ').oninput = e => { ED.q = e.target.value; $('kxNav').innerHTML = navHtml(); };
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
    if (nodeEl && !e.target.closest('input,select,textarea')) { e.preventDefault(); const nid = nodeEl.dataset.node;
      if (RV.view === '관계도' && !nid.startsWith('A:') && !nid.startsWith('N:')) { ED.sel = nid; ED.mode = 'view'; ED.draft = null; RV.view = '목록'; RV.sel = K.규칙.some(r => r.id === nid) ? nid : 'K|' + nid; return renderReview(); }
      selectNode(nid); }
  };
}
function kxAct(a, v) {
  const id = ED.sel, r = K.규칙.find(x => x.id === id), d = ED.draft;
  const done = (msg, apr) => {
    if (apr && PEND_KINDS.includes(apr.종류)) { apr.대기 = true; msg = msg.replace(/을 저장했습니다.*$|을 추가했습니다.*$/, '') + ' 수정안을 저장했습니다 — 확정하면 판정에 적용됩니다'; }
    if (apr) S.approvals.push(apr); save(); K = knowledge(); ED.mode = 'view'; ED.draft = null; ED.verView = null;
    if (apr && apr.대기) { RV.sel = 'E|' + (S.approvals.length - 1); RV.view = '목록'; }
    else if (RV.view === '목록' && RV.sel && RV.sel.startsWith('K|')) RV.sel = 'K|' + ED.sel;
    renderKX(); toast(msg); if (apr) showYaml(apr); };
  switch (a) {
    case 'new': ED.sel = 'NEW'; ED.mode = 'edit'; return refreshDetail();
    case 'new-int': { const nid = `I-${String(K.해석.length + 1).padStart(3, '0')}`;
      ED.draft = { id: 'I:NEW', 값: { id: nid, 구분: '유권해석', 제목: '', 질의: '', 판단: '', 출처: '', 확인자: '김지훈', 신뢰수준: '공식', 상태: '검토 중', 일자: base(), 관련조문: [], 적용규칙: v ? [v] : [], 적용방법: '' } };
      if (v) { const r0 = K.규칙.find(y => y.id === v); ED.draft.값.관련조문 = [...latest(r0).근거.slice(0, 1)]; }
      ED.sel = 'I:NEW'; ED.mode = 'edit'; return refreshDetail(); }
    case 'icite-del': d.값.관련조문 = d.값.관련조문.filter(x => x !== v); return refreshDetail();
    case 'icite-add': { const c = $('kxNewCite').value; if (!c) return; if (d.값.관련조문.includes(c)) return toast('이미 연결된 조문입니다'); d.값.관련조문.push(c); return refreshDetail(); }
    case 'irule-del': d.값.적용규칙 = d.값.적용규칙.filter(x => x !== v); return refreshDetail();
    case 'irule-add': { const c = $('kxIntRule').value; if (!c) return; if (d.값.적용규칙.includes(c)) return toast('이미 연결된 규칙입니다'); d.값.적용규칙.push(c); return refreshDetail(); }
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
    case 'cancel': ED.mode = 'view'; ED.draft = null; if (id === 'NEW' || id === 'I:NEW') { ED.sel = 'R-23-3'; if (RV.sel && RV.sel.startsWith('K|')) RV.sel = null; } if (RV.view !== '관계도') return renderReview(); return refreshDetail();
    case 'days': d.버전.결과.기한.일수 += +v; return refreshDetail();
    case 'cond-del': d.버전.조건.any.splice(+v, 1); return refreshDetail();
    case 'cond-add': { const f = $('kxNewField').value, c = $('kxNewFieldCite').value; if (!f) return toast('추가할 조건을 고르세요'); if (d.버전.조건.any.some(x => x.필드 === f)) return toast('이미 있는 조건입니다'); d.버전.조건.any.push({ 필드: f, 같음: true, 설명: FIELD_NAME[f], 근거: c || d.버전.근거[0] }); return refreshDetail(); }
    case 'row-add': d.버전.결정표.splice(d.버전.결정표.length - 1, 0, { 사업장군: '2군', 주기_년: 3 }); return refreshDetail();
    case 'row-del': d.버전.결정표.splice(+v, 1); return refreshDetail();
    case 'item-del': d.버전.필수항목.splice(+v, 1); return refreshDetail();
    case 'item-add': { const t = $('kxNewItem').value.trim(); if (!t) return; if (d.버전.필수항목.some(x => x.replace(/\s/g, '') === t.replace(/\s/g, ''))) return toast(`'${t}'은(는) 이미 있는 항목입니다`); d.버전.필수항목.push(t); return refreshDetail(); }
    case 'cite-del': d.버전.근거 = d.버전.근거.filter(x => x !== v); return refreshDetail();
    case 'cite-add': { const c = $('kxNewCite').value; if (!c) return; if (d.버전.근거.includes(c)) return toast('이미 연결된 조문입니다'); d.버전.근거.push(c); return refreshDetail(); }
    case 'save': {
      const last = latest(r);
      { const st = v0 => { const { 버전, 시행일, 폐지일, 승인, 검토, ...rest } = v0 || {}; return JSON.stringify(rest); }; if (st(last) === st(d.버전) && d.이름 === r.이름 && d.설명 === r.설명) return toast('바뀐 내용이 없습니다'); }
      if (d.시행일 <= last.시행일) return toast(`시행일은 v${last.버전} 시행일(${last.시행일}) 이후여야 합니다`);
      const apr = draftApproval(r);
      log(`지식 편집: ${r.id} v${last.버전 + 1} 저장 (시행 ${d.시행일})${d.의견 ? ' — ' + d.의견 : ''}`, d.승인자);
      return done(`${r.id} v${last.버전 + 1}을 저장했습니다 (${d.시행일}부터 적용)`, apr);
    }
    case 'qty-save': {
      const date = $('kxQtyDate').value, by = $('kxQtyBy').value;
      const chg = ALLCHEM.filter(m => d.값[m.CAS] !== qtyAt(m, base()).하위);
      if (!chg.length) return toast('바뀐 값이 없습니다');
      chg.forEach(m => S.approvals.push({ notice: null, 규칙: '수량기준', 종류: '수량기준', 대기: true, 이름: m.이름, CAS: m.CAS, 이전: qtyAt(m, base()).하위, 값: d.값[m.CAS], 시행일: date, 승인자: by, 일시: nowStr(), 의견: '규정수량 표 직접 편집' }));
      RV.sel = 'E|' + (S.approvals.length - 1); RV.view = '목록';
      log(`규정수량 표 편집: ${chg.map(m => `${m.이름} ${qtyAt(m, base()).하위}→${d.값[m.CAS]} t`).join(', ')} (시행 ${date})`, by);
      return done(`규정수량 ${chg.length}건 수정안을 저장했습니다 — 확정하면 판정에 적용됩니다`, null);
    }
    case 'gcite-del': d.값.근거 = d.값.근거.filter(x => x !== v); return refreshDetail();
    case 'gcite-add': { const c = $('kxNewCite').value; if (!c) return; if (d.값.근거.includes(c)) return toast('이미 연결된 조문입니다'); d.값.근거.push(c); return refreshDetail(); }
    case 'case-add': { const c = $('kxCc').value.trim(); if (!c) return; (d.값.사례 ||= []).push({ 연도: +$('kxCy').value, 시설: $('kxCf').value.trim() || '-', 내용: c }); return refreshDetail(); }
    case 'case-del': d.값.사례.splice(+v, 1); return refreshDetail();
    case 'guide-save': log(`가이드 편집: ${d.값.코드} ${d.값.지적유형}`); return done('가이드를 저장했습니다', { notice: null, 종류: '가이드편집', 값: d.값, 시행일: base(), 승인자: '김지훈', 일시: nowStr() });
    case 'dl-del': case 'dl-add': {
      const t = id.slice(2), d0 = SITES[0].문서.find(x => x.유형 === t); S.docLinks ||= {};
      const cur0 = [...docLinks(d0)];
      if (a === 'dl-del') S.docLinks[t] = cur0.filter(x => x !== v);
      else { const c = $('kxNewCite').value; if (!c) return; if (cur0.includes(c)) return toast('이미 연결된 조문입니다'); S.docLinks[t] = [...cur0, c]; }
      log(`문서 연결 변경: ${d0.이름} → ${S.docLinks[t].join(', ')}`); save(); return refreshDetail();
    }
    case 'nr-save': {
      const name = $('nrName').value.trim(), items = $('nrItems').value.split('\n').map(x => x.trim()).filter(Boolean);
      if (!name || !items.length) return toast('규칙 이름과 점검 항목을 입력하세요');
      const nid = `R-NEW-${S.approvals.filter(x => x.종류 === '새규칙').length + 1}`;
      const rule = { id: nid, 이름: name, 유형: '체크리스트', 의무분류: $('nrObl').value, 연관분류: [], 대상: '점검', 설명: '전문가가 직접 추가한 점검 규칙', 버전: [{ 버전: 1, 시행일: $('nrDate').value, 폐지일: null, 승인: '김지훈 승인 (직접 추가)', 근거: [$('nrCite').value].filter(Boolean), 필수항목: items, 결과: { 조치: '미충족 항목 보완' } }] };
      log(`새 점검 규칙 추가: ${nid} ${name} (${items.length}개 항목)`);
      ED.sel = nid;
      return done(`${nid} 규칙을 추가했습니다 — 그래프에 연결되었습니다`, { notice: null, 규칙: nid, 종류: '새규칙', 값: rule, 시행일: rule.버전[0].시행일, 승인자: '김지훈', 일시: nowStr() });
    }
    case 'go-cmp': return openCmp(v);
    case 'graph': ED.graph = !ED.graph; return renderKX();
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
  const pend = NOTICES.reduce((s, n) => s + (n.규칙제안 || []).filter((p, i) => !propState(n, i)).length, 0);
  const urgent = pendingNotices().filter(n => diffDays(base(), n.시행일) <= 60).length;
  $('dashKpi').innerHTML = [
    [NOTICES.length + '건', `감지 고시 (미분석 ${NOTICES.filter(n => nstate(n) === '신규').length})`, NOTICES.some(n => nstate(n) === '신규')],
    [jw + '건', 'AI 추천 판단 대기', jw > 0], [all.length + '건', `조치 대상 (비대상 ${jn} 제외)`], [(all.length ? Math.round(done / all.length * 100) : 0) + '%', `완료율 (${done}/${all.length})`],
    [over.length + '건', '기한 경과', over.length > 0], [pend + '건', `규칙 미확정 (AI 추천)${urgent ? ` · 시행 임박 ${urgent}` : ''}`, pend > 0],
  ].map(([v, l, a]) => `<div class="kpi ${a ? 'alert' : ''}"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  $('dashCards').innerHTML = NOTICES.map(n => {
    const tr = (S.notices[n.id]?.tasks || []).filter(inSite), t = tr.filter(act), w = tr.filter(x => x.판단 === '확인 전').length, d = t.filter(x => x.상태 === '완료').length, p = t.filter(x => x.상태 === '진행 중').length;
    const o = t.filter(x => x.상태 !== '완료' && x.기한 < base()).length;
    const kinds = {}; t.forEach(x => { kinds[x.구분] ||= [0, 0]; kinds[x.구분][0]++; if (x.상태 === '완료') kinds[x.구분][1]++; });
    const pct = t.length ? Math.round(d / t.length * 100) : 0;
    return `<div class="ncard" data-n="${n.id}">
      <div class="row between">${stPill(nstate(n))}<span class="muted small">시행 ${n.시행일} · ${dday(n.시행일)}</span></div>
      <h4>${esc(n.제목.replace('[가상] ', ''))}</h4>
      ${propWarn(n).replace('margin:0 0 8px', 'margin:0 0 6px')}
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
$('dashCards').onclick = e => { const p7 = e.target.closest('[data-p7]'); if (p7) { e.preventDefault(); return openReview(p7.dataset.p7); } const c = e.target.closest('[data-n]'); if (!c) return; goNotice(c.dataset.n, 't3'); if (!S.notices[c.dataset.n]) runAnalysis(); };

// ================================================================ ⑥ 판정 시뮬레이션
const citeHtml = list => list.map(c => `<div class="cite"><b>${esc(c.조문)}</b> <span class="muted">(${esc(c.법령)}, 시행 ${esc(c.시행일)})</span>${c.id ? srcBtn(c.id) : ''}<br>${esc(c.내용)}</div>`).join('');
const CHANGE = [['취급량_증가', '취급량 증가'], ['취급시설_용량_증가', '취급시설 용량 증가'], ['신규_취급시설', '새로운 취급시설 설치'], ['물질_변경_추가', '유해화학물질 변경·추가'],
  ['함량_농도_성상_변경', '함량·농도·성상 변경'], ['위험도_증가', '위 변경으로 위험 증가'], ['시설_위치_변경', '사업장 내 취급시설 위치 변경'],
  ['신규_취급시설_설치', '[고시] 취급시설 신규 설치·운영'], ['신규_유해화학물질_취급', '[고시] 규정수량 이상 신규 취급'], ['규정수량_이상_증가', '[고시] 최대보유량이 규정수량 이상으로 증가'], ['작성수준_2군에서_1군', '[고시] 작성수준 2군 → 1군']];
$('changeChecks').innerHTML = CHANGE.map(([k, t]) => `<label class="chk"><input type="checkbox" data-k="${k}"> ${t}</label>`).join('');
// ---- 판정 시험: 시설 변경 계획 (현재 → 변경 후 비교)
const num = s => { const m = String(s ?? '').replace(/,/g, '').match(/[\d.]+/); return m ? +m[0] : null; };
const unitOf = s => String(s ?? '').replace(/^[\d.,\s]+/, '').trim();
const STATE_RANK = { 고체: 0, 액체: 1, 기체: 2 };
let CG = null; // 편집 중인 변경 계획
function cgInit(keepFac) {
  if (!keepFac) { const prev = $('cgFac').value;
    $('cgFac').innerHTML = selSites().map(x => `<optgroup label="${esc(x.사업장)}">${x.시설.map(f => `<option value="${x.id}|${f.id}">${esc(f.이름)}</option>`).join('')}<option value="${x.id}|NEW">+ ${esc(x.약칭)} 신규 취급시설 설치</option></optgroup>`).join('');
    if ([...$('cgFac').options].some(o => o.value === prev)) $('cgFac').value = prev; }
  const [sid, fid] = $('cgFac').value.split('|'), site = SITES.find(x => x.id === sid), f = site.시설.find(x => x.id === fid);
  const mats = f ? f.물질.map(id => site.물질.find(m => m.id === id)).filter(Boolean) : [];
  CG = { site, f, 신규: !f,
    시설: { 용량: f ? num(f.용량) : null, 단위: f ? unitOf(f.용량) || 'm³' : 'm³', 위치: f ? (f.위치 || '현 위치') : '', 위험도: f ? f.위험도 : '가', 유형: f ? f.유형 : '저장탱크' },
    물질: mats.map(m => ({ 기존: true, CAS: m.CAS, 이름: m.이름, 함량: m.함량, 성상: m.성상, 보유량: m.최대보유량_t, 삭제: false })) };
  CG.후 = JSON.parse(JSON.stringify({ 시설: CG.시설, 물질: CG.물질 }));
  if (!$('cgName').value || $('cgName').dataset.auto === '1') { $('cgName').value = f ? `${f.이름} 변경` : `${site.약칭} 신규 취급시설 설치`; $('cgName').dataset.auto = '1'; }
  cgRender(); $('cgDiff').innerHTML = ''; $('judgeOut').innerHTML = '';
}
function cgRender() {
  const a = CG.시설, b = CG.후.시설;
  const tr = (label, cur, after, chg) => `<tr class="${chg ? 'chg' : ''}"><td><b>${label}</b></td><td class="cur">${cur}</td><td class="after">${after}</td></tr>`;
  const fac = `<table class="cgt" style="margin:10px 0"><colgroup><col style="width:150px"><col style="width:38%"><col></colgroup>
    <tr><th>시설 항목</th><th>현재 (등록 정보)</th><th>변경 후 (계획 입력)</th></tr>
    ${CG.신규 ? tr('시설 유형', '-', `<select data-cg="시설.유형">${['저장탱크', '반응·제조시설', '보관·소분시설', '하역시설', '배관'].map(x => `<option ${x === b.유형 ? 'selected' : ''}>${x}</option>`).join('')}</select>`, true) : tr('시설 유형', esc(a.유형), esc(b.유형), false)}
    ${tr('설계 용량', CG.신규 ? '-' : `${a.용량 ?? '-'} ${esc(a.단위)}`, `<div class="row" style="flex-wrap:nowrap"><input type="number" data-cg="시설.용량" value="${b.용량 ?? ''}" style="width:140px"> <span class="muted">${esc(b.단위)}</span></div>`, !CG.신규 && b.용량 !== a.용량)}
    ${tr('설치 위치', CG.신규 ? '-' : esc(a.위치), `<input type="text" data-cg="시설.위치" value="${esc(b.위치)}" placeholder="예: B동 북측 신규 부지">`, !CG.신규 && b.위치 !== a.위치)}
    ${tr('위험도 (정기검사)', CG.신규 ? '-' : esc(a.위험도), `<select data-cg="시설.위험도">${['가', '나', '다'].map(x => `<option ${x === b.위험도 ? 'selected' : ''}>${x}</option>`).join('')}</select>`, !CG.신규 && b.위험도 !== a.위험도)}</table>`;
  const rows = CG.후.물질.map((m, i) => {
    const o = CG.물질[i];
    const c = k => o && !m.삭제 && String(m[k]) !== String(o[k]);
    if (m.삭제) return `<tr class="na"><td><b>${esc(m.이름)}</b><div class="muted small">${m.CAS}</div></td><td class="cur">${o.함량}% · ${o.성상} · ${o.보유량} t</td><td colspan="3" class="muted">취급 중단 (이 시설에서 제외)</td><td><a href="#" data-cgdel="${i}">되살리기</a></td></tr>`;
    return `<tr class="${!o ? 'chg' : ''}"><td><b>${esc(m.이름)}</b>${!o ? ' <span class="pill orange">신규</span>' : ''}<div class="muted small">${m.CAS}</div></td>
      <td class="cur">${o ? `${o.함량}% · ${o.성상} · ${o.보유량} t` : '-'}</td>
      <td class="after ${c('함량') ? 'x' : ''}"><input type="number" data-cg="물질.${i}.함량" value="${m.함량}" style="${c('함량') ? 'border-color:var(--orange);background:var(--lorange);font-weight:700' : ''}"></td>
      <td class="after"><select data-cg="물질.${i}.성상" style="${c('성상') ? 'border-color:var(--orange);background:var(--lorange);font-weight:700' : ''}">${['고체', '액체', '기체'].map(x => `<option ${x === m.성상 ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
      <td class="after"><input type="number" data-cg="물질.${i}.보유량" value="${m.보유량}" style="${c('보유량') ? 'border-color:var(--orange);background:var(--lorange);font-weight:700' : ''}"></td>
      <td><a href="#" data-cgdel="${i}" style="color:var(--red)">${o ? '제외' : '삭제'}</a></td></tr>`;
  }).join('');
  const mat = `<table class="cgt"><colgroup><col style="width:170px"><col style="width:190px"><col style="width:90px"><col style="width:90px"><col style="width:130px"><col style="width:60px"></colgroup>
    <tr><th>취급 물질</th><th>현재 (함량·성상·사업장 최대보유량)</th><th>변경 후 함량(%)</th><th>성상</th><th>사업장 최대보유량(t)</th><th></th></tr>${rows || '<tr><td colspan="6" class="muted">취급 물질이 없습니다. 아래에서 추가하세요.</td></tr>'}
    <tr><td colspan="6"><div class="row"><input type="text" id="cgAddQ" list="qjList" placeholder="물질 추가 — 물질명 또는 CAS (예: 106-99-0)" style="width:300px"><input type="number" id="cgAddPct" placeholder="함량 %" style="width:90px"><select id="cgAddSt" style="width:90px"><option>액체</option><option>기체</option><option>고체</option></select><input type="number" id="cgAddQty" placeholder="보유량 t" style="width:110px"><button class="btn ghost sm" id="cgAddBtn">+ 물질 추가</button></div>
      <div class="muted small" style="margin-top:4px">최대보유량은 「규정수량 규정」 제2조에 따라 사업장 내 모든 시설의 합계(톤)로 입력합니다.</div></td></tr></table>`;
  $('cgForm').innerHTML = fac + mat;
}
function cgFlags() {
  const a = CG.시설, b = CG.후.시설, site = CG.site, F = [];
  const add = (k, 설명, 근거) => F.push({ k, 설명, 근거 });
  if (CG.신규) add('신규_취급시설_설치', `신규 취급시설(${b.유형}) 설치·운영`, '작성규정 제10조①1');
  if (!CG.신규 && b.용량 != null && a.용량 != null && b.용량 > a.용량) add('취급시설_용량_증가', `설계 용량 ${a.용량} → ${b.용량} ${a.단위} (+${+(b.용량 - a.용량).toFixed(2)})`, '법 제23조③1');
  if (!CG.신규 && b.위치 && b.위치 !== a.위치) add('시설_위치_변경', `설치 위치 "${a.위치}" → "${b.위치}"`, '시행규칙 제19조⑦');
  // 변경 후 사업장 데이터 (물질 합계)
  const after = JSON.parse(JSON.stringify(site));
  CG.후.물질.forEach((m, i) => {
    const o = CG.물질[i];
    let sm = after.물질.find(x => x.CAS === m.CAS);
    if (m.삭제) return;
    if (!sm) { sm = { id: 'NEW-' + i, 이름: m.이름, CAS: m.CAS, 구분: '', 최대보유량_t: 0, 함량: m.함량, 성상: m.성상, 시설: [] }; after.물질.push(sm); }
    if (!o) { const exist = site.물질.find(x => x.CAS === m.CAS); add(exist ? '물질_변경_추가' : '물질_변경_추가', `${m.이름} 이 시설에서 신규 취급${exist ? ' (사업장 내 기존 취급 물질)' : ' (사업장 최초 취급)'}`, '시행규칙 제19조⑦');
      if (!exist) add('신규_유해화학물질_취급', `${m.이름} 사업장 신규 취급`, '작성규정 제10조①4'); }
    if (o && +m.보유량 > +o.보유량) add('취급량_증가', `${m.이름} 최대보유량 ${o.보유량} → ${m.보유량} t`, '법 제23조③1');
    if (o && +m.함량 > +o.함량) { add('함량_농도_성상_변경', `${m.이름} 함량 ${o.함량} → ${m.함량}%`, '시행규칙 제19조⑦'); add('위험도_증가', `${m.이름} 함량·농도 증가 = 위험 증가`, '작성규정 제11조④1'); }
    if (o && m.성상 !== o.성상) { add('함량_농도_성상_변경', `${m.이름} 성상 ${o.성상} → ${m.성상}`, '시행규칙 제19조⑦');
      if (STATE_RANK[m.성상] > STATE_RANK[o.성상]) add('위험도_증가', `${m.이름} 성상 ${o.성상} → ${m.성상} = 위험 증가`, m.성상 === '기체' && o.성상 === '액체' ? '작성규정 제11조④3' : '작성규정 제11조④2'); }
    Object.assign(sm, { 함량: m.함량, 성상: m.성상, 최대보유량_t: +m.보유량 });
  });
  // 규정수량 구간·작성수준 비교
  const qb = site.물질.map(m => ({ m, j: qtyJudge(K, { CAS: m.CAS, 함량: m.함량, 보유량: m.최대보유량_t, 성상: m.성상 }, base()) }));
  const qa = after.물질.map(m => ({ m, j: qtyJudge(K, { CAS: m.CAS, 함량: m.함량, 보유량: m.최대보유량_t, 성상: m.성상 }, base()) }));
  const RANK = { '최하위 미만': 0, '최하위 이상': 1, '하위 이상': 2, '상위 이상': 3 };
  qa.forEach(({ m, j }) => { const p = qb.find(x => x.m.CAS === m.CAS); const r0 = p && p.j.해당 ? RANK[p.j.구간] : -1, r1 = j.해당 ? RANK[j.구간] : -1;
    if (r1 >= 2 && r0 < 2) add('규정수량_이상_증가', `${m.이름} 최대보유량이 규정수량 이상으로 증가 (${p && p.j.해당 ? p.j.구간 : '대상 아님'} → ${j.구간})`, '작성규정 제10조①2'); });
  const g0 = siteGroup(K, site, base()), g1 = siteGroup(K, after, base());
  if (g0.결과 === '2군' && g1.결과 === '1군') add('작성수준_2군에서_1군', `계획서 작성수준 2군 → 1군`, '작성규정 제11조②');
  const uniq = []; F.forEach(x => { if (!uniq.some(y => y.k === x.k && y.설명 === x.설명)) uniq.push(x); });
  return { F: uniq, qb, qa, g0, g1, after };
}
function runJudge() {
  const R0 = cgFlags();
  const input = { 변경완료_예정일: $('doneDate').value, 검사_개시일: $('inspStart').value };
  R0.F.forEach(x => input[x.k] = true);
  document.querySelectorAll('#changeChecks input').forEach(c => { if (c.checked) input[c.dataset.k] = true; });
  const jd = input.변경완료_예정일 && input.변경완료_예정일 > base() ? input.변경완료_예정일 : base();
  const res = judgeChange(K, input, jd), resP = judgeChange(KP(), input, jd);
  $('judgeHint').textContent = `확정 규칙으로 판정 (변경완료 예정일 ${jd}에 시행 중인 버전) · ${CG.site.사업장} · ${$('cgName').value}`;
  const qRow = ({ m, j }, p) => `<tr><td>${esc(m.이름)}</td><td>${p ? (p.j.해당 ? `<span class="pill gray">${p.j.구간}</span>` : '대상 아님') : '-'}</td><td>${j.해당 ? `<span class="pill ${j.구간 === '상위 이상' ? 'red' : j.구간 === '하위 이상' ? 'orange' : 'navy'}">${j.구간}</span> <span class="muted small">하위 ${j.하위} · 상위 ${j.상위 ?? '-'} t</span>` : `<span class="muted small">${esc(j.사유)}</span>`}</td></tr>`;
  const changedQ = R0.qa.filter(x => { const p = R0.qb.find(y => y.m.CAS === x.m.CAS); return !p || p.m.최대보유량_t !== x.m.최대보유량_t || p.m.함량 !== x.m.함량 || p.m.성상 !== x.m.성상; });
  $('cgDiff').innerHTML = `<div class="result" style="background:#fff"><h3>① 자동으로 찾은 변경 유형 <span class="muted small">(현재 ↔ 변경 후 비교)</span></h3>
    ${R0.F.length ? R0.F.map(x => `<div class="flag"><b>✔ ${esc(FIELD_NAME[x.k] || CHANGE.find(c => c[0] === x.k)?.[1] || x.k)}</b><span>${esc(x.설명)}</span><span class="muted small" style="margin-left:auto">${esc(x.근거)}</span></div>`).join('') : '<div class="flag no">현재 정보와 달라진 항목이 없습니다. 변경 후 칸에 계획을 입력하세요.</div>'}
    ${changedQ.length ? `<h3 style="margin-top:12px">② 규정수량 구간 변화 (R-QTY-1)</h3><table><tr><th>물질</th><th>현재</th><th>변경 후</th></tr>${changedQ.map(x => qRow(x, R0.qb.find(y => y.m.CAS === x.m.CAS))).join('')}</table>` : ''}
    <h3 style="margin-top:12px">③ 사업장 계획서 작성수준 (R-GRP-1)</h3><p>${esc(CG.site.사업장)}: <b>${esc(R0.g0.결과)}</b> → <b style="color:${R0.g0.결과 !== R0.g1.결과 ? 'var(--red)' : 'inherit'}">${esc(R0.g1.결과)}</b> ${R0.g0.결과 !== R0.g1.결과 ? '<span class="pill red">작성수준 변경</span>' : '<span class="muted small">(변동 없음)</span>'}</p></div>`;
  if (!res.length) { $('judgeOut').innerHTML = `<div class="result"><h3><span class="pill green">해당 없음</span> 계획서 신규·변경 제출 대상이 아님</h3><p class="muted">찾은 변경 유형이 판정 규칙의 제출 요건에 해당하지 않습니다. (변경관리 대장에는 기록)</p></div>`; return; }
  $('judgeOut').innerHTML = `<h3 style="color:var(--navy);margin:6px 0">④ 제출 의무 판정 ${res.length}건</h3>` + res.map(r => {
    const rp = resP.find(x => x.규칙 === r.규칙), adv = rp && rp.기한 && r.기한 && rp.기한 < r.기한 ? rp : null;
    const pn = adv ? pendingNotices().find(n => (n.규칙제안 || []).some(q => q.규칙 === r.규칙)) : null;
    return `<div class="result hit"><h3><span class="pill red">대상</span> ${esc(r.조치)}</h3>
      <div class="kv"><b>제출 기한</b><span>${r.기한 ? `<b style="color:var(--red)">${esc(r.기한)}</b> (${dday(r.기한)}) · ${esc(r.기한설명)}` : '<span class="muted">기준일 미입력</span>'}${adv ? `<br><span style="color:var(--orange);font-weight:700">권고 ${esc(adv.기한)} (${dday(adv.기한)})</span> <span class="small">— 미확정 개정안 기준·잠정${pn ? ` (${esc(pn.id)}, <a href="#" data-p7="P|${pn.id}|${pn.규칙제안.findIndex(q => q.규칙 === r.규칙)}">②에서 확정</a>)` : ''}</span>` : ''}</span>
      <b>제출처</b><span>${esc(r.제출처)}</span><b>서식</b><span>${esc(r.서식)}</span><b>해당 사유</b><span>${r.사유.map(m => esc(m.설명)).join(', ')}</span>
      <b>적용 규칙</b><span><span class="pill navy">${esc(r.규칙)} v${r.버전}</span> ${ruleBadge(r.규칙)} 시행 ${esc(r.시행일)}</span>
      <b>의무 · 미이행 시</b><span>${ruleObl(r.규칙) ? `${oblPill(ruleObl(r.규칙))} ${penHtml(oblOf(ruleObl(r.규칙)))}` : '-'}</span></div>
      <details><summary>근거 조문 원문 보기</summary>${citeHtml(r.근거)}</details>
      ${intOf(r.규칙).length ? `<details open><summary>관련 해석·판단 ${intOf(r.규칙).length}건</summary>${intCards(intOf(r.규칙))}</details>` : ''}</div>`;
  }).join('') + ``;
}
function setPathCG(path, v) { const ks = path.split('.'); let o = CG.후; ks.slice(0, -1).forEach(k => o = o[k]); o[ks[ks.length - 1]] = v; }
$('cgFac').onchange = () => { $('cgName').dataset.auto = '1'; cgInit(true); };
$('cgName').oninput = () => { $('cgName').dataset.auto = '0'; };
$('cgReset').onclick = () => cgInit(true);
$('cgForm').onchange = e => { const k = e.target.dataset.cg; if (!k) return; let v = e.target.value; if (e.target.type === 'number') v = v === '' ? null : +v; setPathCG(k, v); cgRender(); };
$('cgForm').onclick = e => {
  const d = e.target.closest('[data-cgdel]'); if (d) { e.preventDefault(); const i = +d.dataset.cgdel, m = CG.후.물질[i]; if (CG.물질[i]) m.삭제 = !m.삭제; else { CG.후.물질.splice(i, 1); } return cgRender(); }
  if (e.target.id === 'cgAddBtn') {
    let q = $('cgAddQ').value.trim(); if (!q) return toast('추가할 물질명 또는 CAS를 입력하세요');
    let hit = [...K.규정수량표.별표3, ...K.규정수량표.별표2].find(r => r.CAS.includes(q)) || [...K.규정수량표.별표3, ...K.규정수량표.별표2].find(r => r.물질명.includes(q) && r.CAS.length);
    const CAS = hit ? (hit.CAS.includes(q) ? q : hit.CAS[0]) : q;
    const exist = CG.site.물질.find(m => m.CAS === CAS);
    CG.후.물질.push({ 기존: false, CAS, 이름: exist ? exist.이름 : (hit ? hit.물질명.split('[')[0].trim() : q), 함량: +($('cgAddPct').value || 100), 성상: $('cgAddSt').value, 보유량: +($('cgAddQty').value || (exist ? exist.최대보유량_t : 0)), 삭제: false });
    CG.물질.push(undefined); cgRender();
  }
};

$('judgeBtn').onclick = runJudge;
cgInit(false);
$('qjList').innerHTML = [...K.규정수량표.별표3.map(r => [r.CAS[0], r.물질명]), ...K.규정수량표.별표2.slice(0, 2400).map(r => [r.CAS[0], r.물질명])].filter(x => x[0]).map(([c, n]) => `<option value="${c}">${esc(n.slice(0, 60))}</option>`).join('');
$('qjBtn').onclick = () => {
  let q = $('qjQ').value.trim();
  if (!/^\d+-\d+-\d$/.test(q)) { const hit = [...K.규정수량표.별표3, ...K.규정수량표.별표2].find(r => r.물질명.includes(q) && r.CAS.length); if (hit) q = hit.CAS[0]; }
  const r = qtyJudge(K, { CAS: q, 함량: +$('qjPct').value, 보유량: +$('qjQty').value, 성상: $('qjState').value }, base());
  $('qjOut').innerHTML = !r.해당 ? `<div class="result"><h3><span class="pill gray">대상 아님</span> ${esc(q)}</h3><p class="muted">${esc(r.사유)}</p>${ruleBadge(r.규칙)}</div>` :
    `<div class="result hit"><h3><span class="pill ${r.구간 === '상위 이상' ? 'red' : r.구간 === '하위 이상' ? 'orange' : 'navy'}">${r.구간}</span> ${esc(r.물질명)} <span class="muted small">CAS ${esc(q)}</span></h3>
      <div class="kv"><b>적용 기준</b><span>${r.표 === '별표3' ? '별표 3 (사고대비물질)' : `별표 2 (${esc(r.구분)})`} · 함량기준 ${r.함량기준 ?? '-'}% 이상</span>
      <b>규정수량</b><span>최하위 ${r.최하위 ?? '-'} t · 하위 <b>${r.하위 ?? '-'}</b> t · 상위 <b>${r.상위 ?? '-'}</b> t</span><b>최대보유량</b><span>${r.보유량} t (하위 대비 ${r.배수_하위 ?? '-'}배, 상위 대비 ${r.배수_상위 ?? '-'}배)</span>
      <b>판정 근거</b><span>${r.메모.map(esc).join('<br>') || '-'}</span><b>적용 규칙</b><span><span class="pill navy">${r.규칙} v${r.버전}</span> ${ruleBadge(r.규칙)}</span></div>
      <p class="small">→ ${r.구간 === '상위 이상' ? '1군 사업장 해당 가능 (주요취급시설 운영 시) — 화학사고예방관리계획서 1군 작성수준' : r.구간 === '하위 이상' ? '2군 사업장 해당 — 화학사고예방관리계획서 2군 작성수준' : '계획서 작성수준(1·2군) 기준 미만'}</p>
      <details><summary>근거 조문 원문</summary>${citeHtml(r.근거)}</details></div>`;
};
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
    else if (c.유형 === '수량판정') act = qtyJudge(Kx, c.입력, c.기준일);
    else if (c.유형 === '사업장판정') act = siteGroup(Kx, SITE0, c.기준일);
    else act = checkLabel(Kx, c.입력.항목, c.기준일);
    return { c, act, ok: Object.entries(c.기대).every(([k, v]) => JSON.stringify(v) === JSON.stringify(act[k])) };
  });
}
function renderKnowledge() {
  renderLabelChecks();
  if ($('judgeOut').innerHTML) runJudge();
  const results = runGolden(K);
  $('testTable').innerHTML = `<tr><th>사례</th><th>유형</th><th>기준일</th><th>내용</th><th>결과</th></tr>` +
    results.map(({ c, ok }) => `<tr><td>${c.id}</td><td>${c.유형}</td><td>${c.기준일}</td><td>${esc(c.설명)}</td><td><span class="pill ${ok ? 'green' : 'red'}">${ok ? '통과' : '실패'}</span></td></tr>`).join('');
}

// ================================================================ 원문 보기 (관련 페이지)
let PAGES = null;
try { PAGES = await (await fetch('sources/pages.json', { cache: 'no-store' })).json(); } catch (e) { PAGES = {}; }
const SRCKEY = id => id.startsWith('PLAN') ? 'PLAN' : id.startsWith('QTY') ? 'QTY' : id.startsWith('ACT') ? 'ACT' : id.startsWith('RULE') ? 'RULE' : null;
const srcBtn = id => SRCKEY(id) ? `<button class="btn ghost sm srcbtn" data-src="${esc(id)}">📄 원문 페이지</button>` : '';
const LAWLINK = { PLAN: B.원문?.PLAN?.링크, QTY: B.원문?.QTY?.링크, ACT: 'https://www.law.go.kr/법령/화학물질관리법', RULE: 'https://www.law.go.kr/법령/화학물질관리법시행규칙' };
function openSource(id, extra) {
  const k = SRCKEY(id); const a = (K.조문[id] || [])[0];
  $('srcLink').href = LAWLINK[k] || 'https://www.law.go.kr';
  $('srcNav').innerHTML = '';
  if (k === 'PLAN' && PAGES.PLAN && PAGES.PLAN.표시[id]) {
    const P = PAGES.PLAN, hl = P.표시[id], pages = [...new Set(hl.map(h => h.page))];
    const show = [...new Set([...pages, pages[pages.length - 1] + 1])].filter(n => n <= P.페이지수);
    $('srcTitle').textContent = `${B.원문.PLAN.이름} — ${a ? label(a) : id}`;
    $('srcSub').textContent = `${B.원문.PLAN.공포번호} · 시행 ${B.원문.PLAN.시행일} · 원본 PDF ${pages.map(n => n + '쪽').join(', ')} (노란 부분이 규칙의 근거)`;
    $('srcBody').innerHTML = show.map(n => `<div class="pg" id="pg-${n}"><img src="${P.경로.replace('{n}', String(n).padStart(2, '0'))}" alt="${n}쪽"><span class="pno">${n} / ${P.페이지수}쪽</span>${hl.filter(h => h.page === n).map(h => `<div class="hl" style="left:${h.x * 100 - 0.8}%;top:${h.y * 100 - 0.4}%;width:${h.w * 100 + 1.6}%;height:${h.h * 100 + 0.8}%"></div>`).join('')}</div>`).join('');
    $('srcNav').innerHTML = Array.from({ length: P.페이지수 }, (_, i) => i + 1).map(n => `<a href="#" data-pg="${n}" class="small" style="margin:0 2px;${pages.includes(n) ? 'font-weight:800;color:var(--red)' : ''}">${n}</a>`).join('') + ' ';
    $('srcModal').classList.remove('hidden');
    setTimeout(() => { const t = $('srcBody').querySelector('.hl'); if (t) t.scrollIntoView({ block: 'center' }); }, 120);
    return;
  }
  if ((k === 'QTY' || k === 'PLAN') && B.원문?.[k]) {
    const S0 = B.원문[k], art = a && a.조 ? `제${a.조}조` : null;
    $('srcTitle').textContent = `${S0.이름} — ${a ? label(a) : id}`;
    $('srcSub').textContent = `${S0.공포번호} · 시행 ${S0.시행일} · 고시 원문(HWPX)에서 추출한 본문 — 노란 부분이 규칙의 근거`;
    let body = `<div class="doc"><h4>${esc(S0.이름)}</h4><p class="muted small" style="text-align:center">${esc(S0.머리.slice(1, 3).join(' '))}</p>` +
      S0.조문.map((x, i) => `<div class="art ${art && x.번호 === art && !S0.조문.slice(0, i).some(y => y.번호 === art) ? 'on' : ''}">${esc(x.본문.join('\n'))}</div>`).join('') + '</div>';
    if (id.startsWith('QTY-B')) {
      const T = K.규정수량표, b3 = id.includes('B3');
      body = `<div class="doc"><h4>${esc(S0.이름)}</h4><p style="text-align:center"><b>${b3 ? '[별표 3] 사고대비물질별 규정수량' : '[별표 2] 인체급성유해성, 인체만성유해성, 생태유해성 물질별 규정수량'}</b></p>
        <div class="art on">${esc((T.일반기준[b3 ? '별표3' : '별표2'] || []).join('\n'))}</div>${extra || ''}<p class="muted small">전체 표: 별표 2 ${T.별표2.length}행 · 별표 3 ${T.별표3.length}행 (⑥ 판정 시뮬레이션의 물질 규정수량 판정기에서 검색)</p></div>`;
    }
    $('srcBody').innerHTML = body;
    $('srcModal').classList.remove('hidden');
    setTimeout(() => { const t = $('srcBody').querySelector('.art.on'); if (t) t.scrollIntoView({ block: 'center' }); }, 120);
    return;
  }
  $('srcTitle').textContent = a ? `${a.법령명} ${label(a)}` : id;
  $('srcSub').textContent = '시연 데이터는 법령 조문 요약본입니다. 원문은 국가법령정보센터에서 확인하세요 (법제처 Open API 연결 시 원문으로 대체).';
  $('srcBody').innerHTML = `<div class="doc"><div class="art on">${esc(a ? a.내용 : '(조문 없음)')}</div></div>`;
  $('srcModal').classList.remove('hidden');
}
// 별표 해당 행 (규정수량 판정 사례용)
function qtyRowsHtml(cas, pickRow) {
  const T = K.규정수량표;
  const r3 = T.별표3.filter(r => r.CAS.includes(cas)), r2 = T.별표2.filter(r => r.CAS.includes(cas));
  const row3 = r => `<tr class="${pickRow === r ? 'hlr' : ''}"><td>[별표3] ${r.번호}</td><td>${esc(r.물질명)}</td><td>${r.CAS.join(', ')}</td><td>-</td><td>${r.함량 ?? '-'}</td><td>${r.최하위 ?? '-'}${r.액체적용 ? '*' : ''}</td><td>${r.하위 ?? '-'}${r.액체적용 ? '*' : ''}</td><td>${r.상위 ?? '-'}${r.액체적용 ? '*' : ''}</td></tr>`;
  const row2 = r => `<tr class="${pickRow === r ? 'hlr' : ''}"><td>[별표2] ${r.연번}</td><td>${esc(r.물질명.slice(0, 40))}</td><td>${r.CAS.join(', ')}</td><td>${esc(r.구분)}</td><td>${r.함량 ?? '-'}</td><td>${r.최하위 ?? '-'}</td><td>${r.하위 ?? '-'}</td><td>${r.상위 ?? '-'}</td></tr>`;
  return `<table style="margin:8px 0"><tr><th>연번</th><th>화학물질명</th><th>CAS</th><th>구분</th><th>함량기준(%)</th><th>최하위(톤)</th><th>하위(톤)</th><th>상위(톤)</th></tr>${r3.map(row3).join('')}${r2.map(row2).join('')}</table>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-src]'); if (b) { e.preventDefault(); e.stopPropagation(); openSource(b.dataset.src, b.dataset.extra ? decodeURIComponent(b.dataset.extra) : ''); return; }
  const pg = e.target.closest('[data-pg]'); if (pg) {
    e.preventDefault(); const n = +pg.dataset.pg, P = PAGES.PLAN; let el = $(`pg-${n}`);
    if (!el) { $('srcBody').insertAdjacentHTML('beforeend', `<div class="pg" id="pg-${n}"><img src="${P.경로.replace('{n}', String(n).padStart(2, '0'))}"><span class="pno">${n} / ${P.페이지수}쪽</span></div>`); el = $(`pg-${n}`); }
    el.scrollIntoView({ block: 'start' });
  }
}, true);
$('srcClose').onclick = () => $('srcModal').classList.add('hidden');
$('srcModal').onclick = e => { if (e.target.id === 'srcModal') $('srcModal').classList.add('hidden'); };
document.addEventListener('click', e => { const p7 = e.target.closest('[data-p7]'); if (p7) { e.preventDefault(); openReview(p7.dataset.p7); } });
window.addEventListener('error', e => { try { toast('화면 오류: ' + (e.message || '').slice(0, 120)); } catch (x) {} });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('srcModal').classList.add('hidden'); $('aiModal').classList.add('hidden'); } if (e.key === 'Enter' && e.target.classList?.contains('askq')) e.target.parentElement.querySelector('[data-askq]').click(); });

// ================================================================ 의무 분류 (의무 10개 × 세부 업무, 미이행 시 벌칙)
const OBL_CLR = '#0F766E';
const PEN_CLR = { 형벌: 'red', 과태료: 'orange', 행정처분: 'navy', 과징금: 'purple' };
const PEN_KINDS = ['형벌', '과태료', '행정처분', '과징금'];
const topOf = code => (code || '').split('-')[0];
const oblTop = code => (K.의무 || []).find(o => o.코드 === topOf(code));
const oblSubs = () => (K.의무 || []).flatMap(o => (o.세부 || []).map(s0 => ({ ...s0, 상위: o })));
function oblOf(code) { if (!code) return null; if (!code.includes('-')) return oblTop(code); const t = oblTop(code); const s0 = t && (t.세부 || []).find(x => x.코드 === code); return s0 ? { ...s0, 상위: t } : null; }
const penHtml = (s0, short) => { const p = s0 && s0.벌칙; if (!p) return '<span class="muted small">-</span>';
  const kinds = (p.종류 || []).map(k => `<span class="pill ${PEN_CLR[k] || 'gray'}" style="font-size:11px">${esc(k)}</span>`).join(' ');
  const st = p.상태 === '확인 완료' ? `<span class="pill green" style="font-size:10.5px">확인 완료${p.확인자 ? ' · ' + esc(p.확인자) : ''}</span>` : '<span class="pill gray" style="font-size:10.5px" title="AI 초안 — 조문·금액은 최신 벌칙·과태료 별표로 컨설턴트 확인 필요">AI 초안·확인 필요</span>';
  return `${kinds || '<span class="pill gray" style="font-size:11px">직접 벌칙 없음</span>'} ${short ? '' : `<span class="small">${esc(p.내용 || '')}</span> `}${st}`; };
const oblPill = code => { const o = oblOf(code); if (!o) return ''; const pen = o.벌칙 ? ` · 미이행 시: ${(o.벌칙.종류 || []).join('·') || '직접 벌칙 없음'} — ${o.벌칙.내용 || ''}` : '';
  return `<span class="pill" style="background:${OBL_CLR};font-size:11px" title="${esc((o.상위 ? o.상위.코드 + ' ' + o.상위.이름 + ' › ' : '') + o.이름 + pen)}">${esc(o.코드)} ${esc(o.이름)}</span>`; };
const ruleObl = id => id === '수량기준' ? 'C01-2' : (K.규칙.find(r => r.id === id) || {}).의무분류 || null;
const DOC_OBL = { PLAN: 'C02-2', MOC: 'C02-3', QTY: 'C01-2', LABEL: 'C06-3', LABELFM: 'C06-3', INSP: 'C04-2', ER: 'C10-1', TR: 'C08-3' };
function taskObl(x) {
  if (x.규칙키) return ruleObl(x.규칙키);
  if (x.구분 === '문서') { const site = SITES.find(s0 => s0.id === x.사업장); const d = site?.문서.find(y => y.id === x.문서); return d ? DOC_OBL[d.유형] || null : null; }
  return { '설비 변경': 'C02-3', 물질: 'C01-2', 시설: 'C04-2', 교육: 'C08-3', '신고·제출': 'C02-3' }[x.구분] || null;
}
const oblSelect = (id, cur, withEmpty) => `<select id="${id}">${withEmpty && !cur ? '<option value="" selected>미분류</option>' : ''}${(K.의무 || []).filter(o => o.상태 !== '폐지').map(o => `<optgroup label="${esc(o.코드 + ' ' + o.이름)}">${(o.세부 || []).filter(s0 => s0.상태 !== '폐지' || s0.코드 === cur).map(s0 => `<option value="${s0.코드}" ${s0.코드 === cur ? 'selected' : ''}>${esc(s0.코드)} ${esc(s0.이름)}</option>`).join('')}</optgroup>`).join('')}</select>`;
const rulesOf = code => K.규칙.filter(r => code.includes('-') ? r.의무분류 === code : topOf(r.의무분류) === code);
const rstat = code => { const rs = rulesOf(code); return { n: rs.length, ok: rs.filter(r => rvOf(r).상태 === '확정').length }; };
let OB = { edit: null, open: false };
function renderObl() {
  const box = $('oblCard'); if (!box) return;
  const list = K.의무 || [], act = list.filter(o => o.상태 !== '폐지');
  const subsAll = act.flatMap(o => (o.세부 || []).filter(s0 => s0.상태 !== '폐지'));
  const subsCov = subsAll.filter(s0 => rulesOf(s0.코드).length).length;
  const penOk = subsAll.filter(s0 => s0.벌칙?.상태 === '확인 완료').length;
  const e = OB.edit;
  const subRow = (o, s0) => { const st = rstat(s0.코드); return `<tr style="${s0.상태 === '폐지' ? 'opacity:.5' : ''}"><td style="padding-left:18px"><b>${esc(s0.코드)}</b></td><td><b>${esc(s0.이름)}</b>${s0.사용자 ? ' <span class="pill gray" style="font-size:10.5px">추가</span>' : ''}${s0.상태 === '폐지' ? ' <span class="pill gray">폐지</span>' : ''}<div class="small muted">${esc(s0.설명 || '')}</div></td>
    <td><span class="pill ${s0.유형 === '판정형' ? 'navy' : 'line'}" style="font-size:11px">${esc(s0.유형 || '-')}</span></td><td class="small">${esc(s0.근거 || '')}</td><td style="min-width:240px">${penHtml(s0)}</td>
    <td>${st.n ? `<b>${st.ok}</b> / ${st.n}` : `<span style="color:${s0.유형 === '판정형' ? 'var(--red)' : 'var(--sub)'}">${s0.유형 === '판정형' ? '없음' : '-'}</span>`}</td><td><button class="btn ghost sm" data-ob="esub" data-v="${esc(s0.코드)}">편집</button></td></tr>`; };
  box.innerHTML = `<div class="row between"><div><h2 style="margin:0">의무 분류 <span class="muted small">— 화관법 의무 ${act.length}개 · 세부 업무 ${subsAll.length}개</span></h2>
      <p class="desc" style="margin:4px 0 0">규칙이 있는 세부 업무 <b>${subsCov}/${subsAll.length}</b> · 벌칙 확인 완료 <b>${penOk}/${subsAll.length}</b> · 벌칙은 AI 초안 → 컨설턴트 확인</p></div>
      <div class="row"><button class="btn ghost sm" data-ob="toggle">${OB.open ? '접기' : '세부 업무·벌칙 보기'}</button><button class="btn blue sm" data-ob="ntop">+ 의무 추가</button></div></div>
    ${OB.open ? `<div class="scroll" style="margin-top:10px"><table><tr><th>코드</th><th>의무 · 세부 업무</th><th>유형</th><th>대표 근거</th><th>미이행 시 벌칙</th><th>규칙 (확정/전체)</th><th></th></tr>${list.map(o => `<tr style="background:#EEF6F5;${o.상태 === '폐지' ? 'opacity:.5' : ''}"><td><b style="color:${OBL_CLR}">${esc(o.코드)}</b></td><td colspan="4"><b>${esc(o.이름)}</b>${o.사용자 ? ` <span class="pill gray" style="font-size:10.5px">추가 · ${esc(o.등록자 || '')}</span>` : ''}${o.상태 === '폐지' ? ' <span class="pill gray">폐지</span>' : ''} <span class="small muted">${esc(o.설명 || '')}</span></td><td>${(s => s.n ? `<b>${s.ok}</b> / ${s.n}` : '-')(rstat(o.코드))}</td><td style="white-space:nowrap"><button class="btn ghost sm" data-ob="etop" data-v="${esc(o.코드)}">편집</button> <button class="btn ghost sm" data-ob="nsub" data-v="${esc(o.코드)}">+ 세부</button></td></tr>` + (o.세부 || []).map(s0 => subRow(o, s0)).join('')).join('')}</table>
      </div>` : ''}
    ${e ? oblForm(e) : ''}`;
}
function oblForm(e) {
  const isSub = e.종류 === 'sub', v = e.값, who = `<select id="obWho">${personOpts('박정민', 'HQ')}</select>`;
  return `<div class="result" style="background:#fff;border-color:var(--blue);margin-top:10px"><h3>${e.새 ? (isSub ? `세부 업무 추가 — ${esc(e.상위)} ${esc(oblTop(e.상위)?.이름 || '')}` : '의무 추가') : `${isSub ? '세부 업무' : '의무'} 편집 — ${esc(v.코드)}`}</h3>
    <div class="kv"><b>코드</b><span><code>${esc(v.코드)}</code> <span class="muted small">(자동 부여)</span></span>
      <b>이름</b><span><input type="text" id="obName" value="${esc(v.이름 || '')}" style="width:340px" placeholder="${isSub ? '예: 운반차량 표시' : '예: 유해화학물질 운반'}"></span>
      <b>설명</b><span><input type="text" id="obDesc" value="${esc(v.설명 || '')}" style="width:100%"></span>
      ${isSub ? `<b>유형</b><span><select id="obType"><option ${v.유형 === '판정형' ? 'selected' : ''}>판정형</option><option ${v.유형 !== '판정형' ? 'selected' : ''}>관리형</option></select> <span class="muted small">판정형: 규칙으로 해당 여부·기한 판정 / 관리형: 일정·기록·증빙 관리</span></span>
      <b>대표 근거</b><span><input type="text" id="obCite" value="${esc(v.근거 || '')}" style="width:100%" placeholder="예: 법 제15조"></span>
      <b>미이행 시 벌칙</b><span>${PEN_KINDS.map(k => `<label class="small" style="margin-right:8px"><input type="checkbox" data-pen="${k}" ${(v.벌칙?.종류 || []).includes(k) ? 'checked' : ''}> ${k}</label>`).join('')}
        <input type="text" id="obPen" value="${esc(v.벌칙?.내용 || '')}" style="width:100%;margin-top:4px" placeholder="예: 미제출 시 과태료 ○○만원 이하 (법 제○○조, 시행령 별표 ○)"></span>
      <b>벌칙 확인</b><span><select id="obPenSt"><option ${v.벌칙?.상태 !== '확인 완료' ? 'selected' : ''}>AI 초안</option><option ${v.벌칙?.상태 === '확인 완료' ? 'selected' : ''}>확인 완료</option></select> <span class="muted small">조문·금액을 최신 법령으로 확인했으면 '확인 완료'</span></span>` : ''}
      <b>${e.새 ? '등록자' : '수정자'}</b><span>${who}</span>
      <b>사유</b><span><input type="text" id="obWhy" style="width:100%" placeholder="예: 운반 관련 지적이 늘어 별도 관리"></span>
      ${e.새 ? '' : `<b>상태</b><span><select id="obSt"><option ${v.상태 !== '폐지' ? 'selected' : ''}>사용 중</option><option ${v.상태 === '폐지' ? 'selected' : ''}>폐지</option></select> <span class="muted small">규칙이 연결되어 있으면 폐지할 수 없음</span></span>`}</div>
    <div class="row"><button class="btn green" data-ob="save">저장</button><button class="btn ghost" data-ob="cancel">취소</button></div></div>`;
}
$('oblCard') && ($('oblCard').onclick = e => {
  const b = e.target.closest('[data-ob]'); if (!b) return;
  const a = b.dataset.ob, v = b.dataset.v;
  if (a === 'toggle') { OB.open = !OB.open; return renderObl(); }
  if (a === 'ntop') { const n0 = Math.max(0, ...(K.의무 || []).map(o => +o.코드.slice(1) || 0)) + 1; OB.edit = { 종류: 'top', 새: true, 값: { 코드: 'C' + String(n0).padStart(2, '0'), 세부: [] } }; OB.open = true; return renderObl(); }
  if (a === 'nsub') { const t = oblTop(v), n0 = Math.max(0, ...(t.세부 || []).map(s0 => +s0.코드.split('-')[1] || 0)) + 1; OB.edit = { 종류: 'sub', 새: true, 상위: v, 값: { 코드: `${v}-${n0}`, 유형: '관리형', 벌칙: { 종류: [], 내용: '' } } }; return renderObl(); }
  if (a === 'etop') { OB.edit = { 종류: 'top', 값: clone(oblTop(v)) }; return renderObl(); }
  if (a === 'esub') { const s0 = oblOf(v); delete s0.상위; OB.edit = { 종류: 'sub', 상위: topOf(v), 값: clone(s0) }; return renderObl(); }
  if (a === 'cancel') { OB.edit = null; return renderObl(); }
  if (a === 'save') {
    const E0 = OB.edit, name = $('obName').value.trim(), who = $('obWho').value, why = $('obWhy').value.trim();
    if (!name) return toast('이름을 입력하세요');
    const st = $('obSt') ? $('obSt').value : '사용 중', code = E0.값.코드;
    if (st === '폐지' && rulesOf(code).length) return toast('연결된 규칙이 있어 폐지할 수 없습니다. 규칙 분류를 먼저 바꾸세요');
    let top;
    if (E0.종류 === 'top') {
      if ((K.의무 || []).some(o => o.이름 === name && o.코드 !== code)) return toast('같은 이름의 의무가 이미 있습니다');
      top = { ...clone(E0.값), 이름: name, 설명: $('obDesc').value.trim(), 상태: st };
      if (E0.새) Object.assign(top, { 사용자: true, 등록자: who, 등록일: base() }); else Object.assign(top, { 수정자: who, 수정일: base() });
    } else {
      top = clone(oblTop(E0.상위));
      const s0 = { ...clone(E0.값), 이름: name, 설명: $('obDesc').value.trim(), 유형: $('obType').value, 근거: $('obCite').value.trim(), 상태: st,
        벌칙: { 종류: [...document.querySelectorAll('[data-pen]:checked')].map(x => x.dataset.pen), 내용: $('obPen').value.trim(), 상태: $('obPenSt').value } };
      if (s0.벌칙.상태 === '확인 완료') { s0.벌칙.확인자 = who; s0.벌칙.확인일 = base(); }
      if (E0.새) Object.assign(s0, { 사용자: true, 등록자: who, 등록일: base() }); else Object.assign(s0, { 수정자: who, 수정일: base() });
      const i = top.세부.findIndex(x => x.코드 === s0.코드); if (i >= 0) top.세부[i] = s0; else top.세부.push(s0);
    }
    S.approvals.push({ notice: null, 종류: '의무편집', 값: top, 시행일: base(), 승인자: who, 일시: nowStr(), 의견: why });
    log(`의무 분류 ${E0.새 ? '추가' : '수정'}: ${code} ${name}${st === '폐지' ? ' (폐지)' : ''}${why ? ' — ' + why : ''}`, who);
    save(); K = knowledge(); OB.edit = null; toast(`${code} ${name} ${E0.새 ? '추가' : '저장'}했습니다`); return renderReview();
  }
});

// ================================================================ ② 규칙 검토·확정
const RV_ST = { 'AI 초안': 'gray', '검토 중': 'orange', '수정 요청': 'red', '확정': 'green', '반려': 'red' };
let RV = { sel: null, filter: '', group: '의무', sort: '최신', view: '목록', kind: '' };
const PEND_KINDS = ['기한일수', '필수항목추가', '필수항목편집', '결정표편집', '버전교체', '새규칙', '수량기준'];
const pendEdits = () => S.approvals.map((a, i) => ({ a, i })).filter(x => x.a.대기);
const editTitle = a => a.종류 === '새규칙' ? `${a.값.id} ${a.값.이름} (새 규칙)` : a.종류 === '수량기준' ? `규정수량 ${a.이름 || a.CAS}: ${a.이전 ?? '?'} → ${a.값} t` : `${a.규칙} ${(K.규칙.find(r => r.id === a.규칙) || {}).이름 || ''}`;
// 규칙의 출처 고시·법령 (공포번호·고시일·시행일)
function ruleSrc(r) {
  const L = B.법령 || [];
  let law = r.출처고시 ? L.find(l => r.출처고시.startsWith(l.법령명)) : null;
  if (!law) { const ids = latest(r).근거 || []; for (const id of ids) { const a = (K.조문[id] || [])[0]; if (a) { law = L.find(l => l.법령명 === a.법령명); if (law) break; } } }
  if (!law) return { 법령명: r.id.startsWith('R-NEW') ? '전문가 직접 추가' : '기타', 약칭: '', 공포번호: '', 공포일: latest(r).시행일 || '', 시행일: latest(r).시행일 || '' };
  return law;
}
const srcShort = l => l.약칭 || l.법령명.replace('화학물질관리법 시행규칙', '시행규칙').replace('화학물질관리법', '화관법');
const srcNo = l => (l.공포번호 || '').replace(/^.*(제[\d-]+호)$/, '$1');
const byDate = (da, db) => RV.sort === '오래된' ? (da || '').localeCompare(db || '') : (db || '').localeCompare(da || '');
function rvOf(r) {
  S.review ||= {};
  const base0 = latest(r).검토 || {};
  return S.review[r.id] || { 상태: base0.상태 === '확정' ? '확정' : (r.id.startsWith('R-NEW') ? '검토 중' : 'AI 초안'), 체크: {}, 이력: [], 의견: '' };
}
function rvCases(r) {
  const v = latest(r), cs = (v.검토 && v.검토.사례) || [];
  return cs.map(c => {
    let act;
    const d = c.입력.기준일 || '2026-12-20';
    if (r.유형 === '수량판정') act = qtyJudge(K, c.입력, d);
    else if (r.유형 === '사업장판정') act = siteGroup(K, SITES.find(x => x.id === c.입력.사업장) || SITES[0], d);
    else if (r.유형 === '조건판정') { const res = judgeChange(K, c.입력, base()).find(x => x.규칙 === r.id); act = res ? { 기한: res.기한, 대상: true } : { 대상: false }; }
    else if (r.유형 === '체크리스트') { const have = (c.입력.항목 || []).map(t => t.replace(/\s/g, '')); act = { 누락: (v.필수항목 || []).filter(t => !have.includes(String(t).replace(/\s/g, ''))).length }; }
    else if (r.유형 === '기준표') { const conds = (v.열 || []).filter(x => x.종류 === '조건'), row = (v.행 || []).find(rw => conds.every(cl => !rw[cl.이름] || rw[cl.이름] === '*' || rw[cl.이름] === '기타' || String(rw[cl.이름]) === String(c.입력[cl.이름] ?? ''))); act = row ? Object.fromEntries((v.열 || []).filter(x => x.종류 === '결과').map(o => [o.이름, row[o.이름]])) : {}; }
    else act = {};
    const ok = Object.entries(c.기대).every(([k, v]) => String(v) === String(act[k]));
    return { c, act, ok };
  });
}
// ---- ② 개정 반영 대기 (AI 추천) — 모니터링된 고시의 규칙 변경안
function propItems() { return NOTICES.flatMap(n => (n.규칙제안 || []).map((p, i) => ({ key: `P|${n.id}|${i}`, n, p, i, st: propState(n, i) }))); }
const propRvSt = st => st === '승인' ? '확정' : st === '반려' ? '반려' : 'AI 추천';
function openReview(key) { RV.sel = key; RV.filter = ''; showTab('t8'); }
function propImpact(n, i, 값, 시행일) {
  const p = n.규칙제안[i];
  if (p.종류 === '확인') return '<p class="muted small">값 변경 없음 — 현행 규칙이 개정 조문과 일치함을 확인하는 항목입니다.</p>';
  const a = { notice: n.id, idx: i, 규칙: p.규칙, 종류: p.종류, 값, CAS: p.CAS, 시행일, 근거: p.근거, 승인자: '미리보기', 일시: nowStr() };
  const K1 = knowledge([...S.approvals, a]);
  if (p.종류 === '기한일수') {
    const rows = SITES.flatMap(site => site.변경관리.filter(m => m.상태 === '진행').map(m => ({ site, m, now: mocDueK(K, m), aft: mocDueK(K1, m) })));
    return `<table><tr><th>사업장</th><th>변경관리</th><th>변경완료 예정</th><th>현재 공식 기한</th><th>확정 후 공식 기한</th></tr>${rows.map(x => `<tr><td>${sitePill(x.site.id)}</td><td>${esc(x.m.id)} ${esc(x.m.이름)}</td><td>${esc(x.m.변경완료_예정일)}</td><td>${x.now || '-'}</td><td>${x.aft && x.aft !== x.now ? `<b style="color:var(--red)">${x.aft}</b> <span class="small">(${dday(x.aft)})</span>` : (x.aft || '-') + ' <span class="small muted">변동 없음</span>'}</td></tr>`).join('')}</table>
      <p class="muted small" style="margin:4px 0 0">변경완료 예정일이 ${esc(시행일)} 이후인 건만 새 기한 적용 · 확정 시 ④ 기한 자동 재계산</p>`;
  }
  if (p.종류 === '수량기준') {
    const rows = SITES.flatMap(site => site.물질.filter(m => m.CAS === p.CAS).map(m => {
      const j0 = qtyJudge(K, { CAS: m.CAS, 함량: m.함량, 보유량: m.최대보유량_t, 성상: m.성상 }, 시행일), j1 = qtyJudge(K1, { CAS: m.CAS, 함량: m.함량, 보유량: m.최대보유량_t, 성상: m.성상 }, 시행일);
      return { site, m, j0, j1 };
    }));
    return rows.length ? `<table><tr><th>사업장</th><th>물질</th><th>최대보유량</th><th>현행 판정 (${esc(시행일)})</th><th>확정 후 판정</th></tr>${rows.map(x => `<tr><td>${sitePill(x.site.id)}</td><td>${esc(x.m.이름)}</td><td>${x.m.최대보유량_t} t</td><td>${esc(x.j0.구간 || '-')} <span class="small muted">(하위 ${x.j0.하위 ?? '-'} t)</span></td><td>${x.j1.구간 !== x.j0.구간 ? `<b style="color:var(--red)">${esc(x.j1.구간)}</b>` : esc(x.j1.구간 || '-')} <span class="small muted">(하위 ${x.j1.하위 ?? '-'} t)</span></td></tr>`).join('')}</table>` : '<p class="muted small">이 물질을 취급하는 사업장이 없습니다.</p>';
  }
  if (p.종류 === '필수항목추가') {
    const r0 = K.규칙.find(r => r.id === p.규칙), r1 = K1.규칙.find(r => r.id === p.규칙);
    const it = r => { const v = r.버전.find(v => v.시행일 <= 시행일 && (!v.폐지일 || v.폐지일 > 시행일)) || latest(r); return (v.필수항목 || v.항목 || []).map(x => x.이름 || x); };
    const a0 = it(r0), a1 = it(r1);
    return `<p class="small">점검 항목 ${a0.length}개 → <b>${a1.length}개</b>${a1.filter(x => !a0.includes(x)).map(x => ` <span class="pill red">+ ${esc(x)}</span>`).join('')}. 확정하면 라벨 점검·생성에 바로 적용됩니다.</p>`;
  }
  return '';
}
function renderPropDetail(key) {
  const [, nid, si] = key.split('|'), n = NOTICES.find(x => x.id === nid), i = +si, p = n.규칙제안[i], st = propState(n, i);
  const a = S.approvals.find(x => x.notice === n.id && x.idx === i), rule = B.규칙.find(r => r.id === p.규칙);
  const locked = !!st, d = diffDays(base(), p.시행일);
  const linked = Object.values(S.notices).flatMap(x => x.tasks || []).filter(t => t.연동 && t.연동.notice === n.id && t.판단 !== '비대상');
  const field = p.종류 === '확인' ? `<span>${esc(p.제안)}</span>` : `<input type="${p.종류 === '필수항목추가' ? 'text' : 'number'}" id="ppv" value="${esc(a ? a.값 : p.제안)}" ${locked ? 'disabled' : ''} style="width:${p.종류 === '필수항목추가' ? 220 : 100}px">`;
  $('rvDetail').innerHTML = `
    <div class="result ${locked ? '' : 'hit'}" style="${locked ? 'background:#fff' : ''}">
      <div class="row between"><h3 style="margin:0">${rule ? `${esc(rule.id)} ${esc(rule.이름)}` : '물질별 규정수량 표'} <span class="pill gray">${esc(p.종류)}</span> ${oblPill(ruleObl(p.규칙))} ${propPill(n, i)}</h3>
        <button class="btn ghost sm" data-pgo4="${n.id}">③ 신·구 비교 ↗</button></div>
      <p class="muted" style="margin:6px 0">${esc(p.설명)}</p>
      <div class="kv"><b>감지 고시</b><span>${esc(n.제목)}</span><b>공포·시행</b><span>공포 ${esc(n.공포일)} · 시행 ${esc(n.시행일)} · 감지 ${esc(n.감지일)} (${esc(n.감지경로)})</span>
        <b>미이행 시 벌칙</b><span>${ruleObl(p.규칙) ? `${oblPill(ruleObl(p.규칙))} ${penHtml(oblOf(ruleObl(p.규칙)))}` : '-'}</span>
        <b>확정 전 판정</b><span>기존 확정 규칙으로 판정 · 이 변경안은 <b style="color:var(--orange)">권고 일정</b>으로만 표시.${linked.length ? ` 현재 권고 표시 중인 조치 ${linked.length}건.` : ''}${!locked && d <= 60 ? ` <b style="color:var(--red)">시행 ${d >= 0 ? 'D-' + d : '경과'} — 확정이 필요합니다.</b>` : ''}</span></div>
    </div>
    <div class="result" style="background:#fff"><h3>바뀐 조문 (신·구)</h3>${n.변경조문.map(c => `<div style="margin-bottom:10px"><div class="row" style="margin-bottom:4px"><b style="color:var(--navy)">${esc(c.조문)}</b><span class="muted">${esc(c.제목)}</span>${srcBtn(c.id)}</div>${cmpBox(c.구, c.신, '개정 전', `개정 후 (시행 ${n.시행일})`)}</div>`).join('')}</div>
    <div class="result" style="background:#fff"><h3>AI가 추천한 규칙 변경</h3>
      <div class="kv"><b>변경 항목</b><span>${esc(p.항목)}</span><b>현행 값</b><span>${esc(p.현행)}</span><b>${p.종류 === '필수항목추가' ? '추가 항목' : '변경 값'}</b><span>${field}</span>
        <b>적용 시행일</b><span><input type="date" id="ppd" value="${esc(a ? a.시행일 : p.시행일)}" ${locked ? 'disabled' : ''}></span><b>근거 조문</b><span><code>${esc(p.근거)}</code> ${srcBtn(p.근거)}</span></div></div>
    <div class="result" style="background:#fff"><h3>확정 시 영향 미리보기 <span class="muted small">— 지금 엔진으로 계산</span></h3><div id="ppImpact">${propImpact(n, i, a ? a.값 : p.제안, a ? a.시행일 : p.시행일)}</div></div>
    <div class="result" style="background:#fff;border-color:var(--blue)"><h3>전문가 확정</h3>
      ${st === '승인' ? `<p><span class="pill green">확정</span> ${esc(a?.승인자 || '')} · ${esc(a?.일시 || '')}${a?.의견 ? ` — ${esc(a.의견)}` : ''}</p><p class="muted small">${esc(a?.시행일 || '')}부터 새 규칙 버전으로 공식 판정합니다.</p>${p.규칙 ? `<div class="row"><button class="btn blue" data-pact="edit">✎ 수정하기</button><span class="small muted">확정된 ${p.규칙 === '수량기준' ? '규정수량 표' : esc(p.규칙)}를 고칩니다 — 저장하면 수정안으로 올라가고, 확정해야 판정에 적용됩니다.</span></div>` : ''}`
      : st === '반려' ? `<p><span class="pill red">반려</span> 기존 확정 규칙을 유지합니다.</p><button class="btn ghost sm" data-pact="reopen">반려 취소</button>` : `
      <div class="row" style="align-items:flex-end"><label class="field"><span>확정자</span><select id="ppWho">${personOpts('박정민', 'HQ')}</select></label>
        <label class="field" style="flex:1;min-width:240px"><span>검토 의견</span><input type="text" id="ppMemo" placeholder="예: 개정 조문과 일치 확인" style="width:100%"></label></div>
      <div class="row"><button class="btn green" data-pact="ok">✔ 확정 · 지식에 반영</button><button class="btn ghost" data-pact="no" style="color:var(--red)">반려</button></div>`}
    </div>`;
}
// ---- 수정안 (확정 대기) 상세
function editDiffHtml(a) {
  if (a.종류 === '수량기준') return `<table><tr><th>물질</th><th>CAS</th><th>현재 하위 규정수량</th><th>수정안</th><th>시행일</th></tr><tr><td>${esc(a.이름 || '')}</td><td>${esc(a.CAS)}</td><td>${esc(String(a.이전 ?? '-'))} t</td><td><b style="color:var(--red)">${esc(String(a.값))} t</b></td><td>${esc(a.시행일)}</td></tr></table>`;
  if (a.종류 === '새규칙') return `<pre style="white-space:pre-wrap;margin:0">${esc(toYaml(a.값))}</pre>`;
  const r = K.규칙.find(x => x.id === a.규칙); if (!r) return '';
  const last = latest(r), strip = v => { const { 버전, 시행일, 폐지일, 승인, 검토, ...rest } = v || {}; return rest; };
  const nv = a.종류 === '버전교체' ? a.값.버전 : null;
  if (!nv) return `<p class="small">${esc(a.종류)}: ${esc(JSON.stringify(a.값))}</p>`;
  const A = flat(strip(last)), Bv = flat(strip(nv)), keys = [...new Set([...Object.keys(A), ...Object.keys(Bv)])].filter(k => JSON.stringify(A[k]) !== JSON.stringify(Bv[k]));
  const nm = a.값.이름 && a.값.이름 !== r.이름 ? `<tr><td>규칙 이름</td><td>${esc(r.이름)}</td><td><b>${esc(a.값.이름)}</b></td></tr>` : '';
  return keys.length || nm ? `<table><tr><th>항목</th><th>현재 (v${last.버전})</th><th>수정안 (시행 ${esc(a.시행일)})</th></tr>${nm}${keys.map(k => `<tr><td>${esc(PATH_NAME(k))}</td><td>${A[k] === undefined ? '<span class="muted">없음</span>' : esc(String(A[k]))}</td><td>${Bv[k] === undefined ? '<span class="muted">삭제</span>' : `<b style="color:var(--red)">${esc(String(Bv[k]))}</b>`}</td></tr>`).join('')}</table>` : '<p class="muted small">바뀐 값이 없습니다.</p>';
}
function renderEditDetail(i) {
  const a = S.approvals[i]; if (!a) return;
  const K2 = knowledge(S.approvals.map(x => x === a ? { ...x, 대기: false } : x));
  const g0 = runGolden(K), g1 = runGolden(K2), chg = g1.filter((x, k) => x.ok !== g0[k]?.ok);
  const rid = a.종류 === '새규칙' ? a.값.id : a.규칙, ob = rid === '수량기준' ? 'C01-2' : (a.종류 === '새규칙' ? a.값.의무분류 : ruleObl(rid));
  $('rvDetail').innerHTML = `
    <div class="result hit"><div class="row between"><h3 style="margin:0">${esc(editTitle(a))} <span class="pill gray">${esc(a.종류)}</span> <span class="pill orange">수정안 · 확정 대기</span> ${ob ? oblPill(ob) : ''}</h3>
      ${a.종류 !== '수량기준' && a.종류 !== '새규칙' ? `<button class="btn ghost sm" data-eact="view" data-v="${esc(rid)}">현재 규칙 보기</button>` : ''}</div>
      <div class="kv" style="margin-top:6px"><b>작성</b><span>${esc(a.승인자)} · ${esc(a.일시)}${a.의견 ? ` — ${esc(a.의견)}` : ''}</span><b>적용 시행일</b><span>${esc(a.시행일)}</span></div></div>
    <div class="result" style="background:#fff"><h3>바뀌는 내용</h3>${editDiffHtml(a)}</div>
    <div class="result" style="background:#fff"><h3>정답셋 영향 <span class="muted small">— 확정 시 결과가 바뀌는 사례 ${chg.length}건</span></h3>${chg.length ? `<table><tr><th>사례</th><th>내용</th><th>현재</th><th>확정 후</th></tr>${chg.map(x => `<tr><td>${esc(x.c.id)}</td><td class="small">${esc(x.c.설명)}</td><td>${g0.find(y => y.c.id === x.c.id)?.ok ? '통과' : '실패'}</td><td><span class="pill ${x.ok ? 'green' : 'red'}">${x.ok ? '통과' : '실패'}</span></td></tr>`).join('')}</table><p class="small muted" style="margin:4px 0 0">의도한 변화면 정답셋도 함께 갱신합니다.</p>` : '<p class="small" style="margin:0"><span class="pill green">변화 없음</span> 정답셋 결과가 그대로입니다.</p>'}</div>
    <div class="result" style="background:#fff;border-color:var(--blue)"><h3>확정</h3>
      <div class="row" style="align-items:flex-end"><label class="field"><span>확정자</span><select id="edWho">${personOpts('박정민', 'HQ')}</select></label>
        <label class="field" style="flex:1;min-width:240px"><span>의견</span><input type="text" id="edMemo" style="width:100%" placeholder="예: 고시 원문과 일치 확인"></label></div>
      <div class="row"><button class="btn green" data-eact="ok" data-v="${i}">✔ 확정 · 판정에 적용</button><button class="btn ghost" data-eact="no" data-v="${i}" style="color:var(--red)">반려 (수정안 삭제)</button></div></div>`;
}
function confirmEdit(i, who, memo) {
  const a = S.approvals[i]; delete a.대기; Object.assign(a, { 확정자: who, 확정일시: nowStr(), 확정의견: memo });
  const rid = a.종류 === '새규칙' ? a.값.id : a.규칙;
  if (rid && rid !== '수량기준') {
    S.review ||= {}; const prev = S.review[rid], wasOk = a.종류 === '새규칙' || (prev ? prev.상태 === '확정' : (B.규칙.find(r => r.id === rid) && latest(B.규칙.find(r => r.id === rid)).검토?.상태 === '확정'));
    if (wasOk) { const rv = prev || { 체크: {}, 이력: [] }; Object.assign(rv, { 상태: '확정', 검토자: who, 의견: memo || '수정안 확정', 일시: nowStr() }); rv.이력 = [...(rv.이력 || []), { t: nowStr(), who, 상태: '확정', 의견: `수정안 확정 (${a.종류}, 시행 ${a.시행일})` }]; S.review[rid] = rv; }
  }
  log(`수정안 확정: ${editTitle(a)} (${a.종류}, 시행 ${a.시행일})${memo ? ' — ' + memo : ''}`, who); save(); K = knowledge();
}
// 규칙 외 지식(기준표·가이드·해석·문서 연결)의 의무 분류: 연결된 규칙·문서 유형에서 자동, 담당자가 바꿀 수 있음
function kobl(id) {
  if (S.kobl && S.kobl[id]) return S.kobl[id];
  if (id === 'QTY') return 'C01-2';
  if (id.startsWith('G:')) { const g = K.가이드.find(x => x.코드 === id.slice(2)); return g ? ruleObl(g.규칙) : null; }
  if (id.startsWith('I:')) { const x = K.해석.find(y => y.id === id.slice(2)); return x ? (x.적용규칙 || []).map(ruleObl).find(Boolean) || null : null; }
  if (id.startsWith('D:')) return DOC_OBL[id.slice(2)] || null;
  return null;
}
// 문서 ↔ 규칙 매핑: 문서가 인용하는 조문과 규칙의 근거 조문이 겹치면 자동 연결 (담당자 추가·제외 가능)
const docOf = t => SITES[0].문서.find(x => x.유형 === t);
function docRulesAuto(t) { const L = docLinks(docOf(t)); return K.규칙.filter(r => refsOf(r).some(id => L.includes(id)) || (L.includes('QTY') && r.유형 === '수량판정')).map(r => r.id); }
function docRules(t) { const m = (S.docRule || {})[t] || {}; return [...new Set([...docRulesAuto(t).filter(id => !(m.del || []).includes(id)), ...(m.add || []).filter(id => K.규칙.some(r => r.id === id))])]; }
const ruleDocs = id => DOC_TYPES.filter(d => docRules(d.유형).includes(id));
function docRuleEdit(t, id, on) { S.docRule ||= {}; const m = S.docRule[t] ||= { add: [], del: [] }; const auto = docRulesAuto(t).includes(id);
  m.add = m.add.filter(x => x !== id); m.del = m.del.filter(x => x !== id);
  if (on && !auto) m.add.push(id); if (!on && auto) m.del.push(id);
  log(`문서-규칙 연결 ${on ? '추가' : '제외'}: ${docOf(t)?.이름} ↔ ${id}`); save(); }
const linkChip = (label, sel, auto, del) => `<span class="chip" style="border-color:${auto ? 'var(--line)' : 'var(--blue)'}"><a href="#" data-rvsel="${esc(sel)}" style="text-decoration:none"><b>${esc(label)}</b></a>${auto ? '' : ' <span class="small muted">직접</span>'}${del ? ` <a href="#" data-drdel="${esc(del)}" style="color:var(--red);text-decoration:none" title="연결 제외">✕</a>` : ''}</span>`;
function kItems() {
  return [['QTY', '물질별 규정수량 표', `물질 ${ALLCHEM.length}종 · 규정수량 규정`, '기준표'], ...K.가이드.map(g => ['G:' + g.코드, `${g.코드} ${g.지적유형}`, `가이드 · 규칙 ${g.규칙}`, '가이드']), ...K.해석.map(x => ['I:' + x.id, x.제목, `해석 · ${x.구분} · ${x.상태}`, '해석']), ...DOC_TYPES.map(d => ['D:' + d.유형, `${d.이름} — 조문 연결`, `문서 · 조문 ${docLinks(SITES[0].문서.find(x => x.유형 === d.유형)).length}개`, '문서'])]
    .map(([id, t, sub, ty]) => ({ k: { id, t, sub, ty, ob: kobl(id) } }));
}
const kItemHtml = k => `<div class="kxi ${RV.sel === 'K|' + k.id ? 'on' : ''}" data-rv="K|${esc(k.id)}"><i style="background:${TYPE_COLOR[k.ty]}"></i><div style="flex:1"><div class="row between"><b class="small">${esc(k.t)}</b><span class="pill line" style="font-size:10.5px">${esc(k.ty)}</span></div><div class="muted small">${esc(k.sub)}${k.ob ? ` · <b style="color:${OBL_CLR}">${esc(k.ob)}</b> ${esc(oblOf(k.ob)?.이름 || '')}` : ' · 미분류'}</div></div></div>`;
function renderReview() {
  renderObl();
  document.querySelectorAll('[data-rvview]').forEach(b => b.className = `btn sm ${b.dataset.rvview === RV.view ? '' : 'ghost'}`);
  $('rvTools').classList.toggle('hidden', RV.view === '관계도'); $('rvMain').classList.toggle('hidden', RV.view === '관계도'); $('kxHost').classList.toggle('hidden', RV.view !== '관계도');
  if (RV.view !== '관계도') $('kxHost').innerHTML = ''; else $('rvDetail').innerHTML = ''; // 같은 id(#kx)가 두 곳에 생기지 않도록
  if ($('rvGroup')) $('rvGroup').value = RV.group;
  const all = K.규칙.map(r => ({ r, rv: rvOf(r) }));
  const cnt = s0 => all.filter(x => x.rv.상태 === s0).length;
  const done = cnt('확정');
  const PI = propItems(), pp = PI.filter(x => !x.st).length, PE = pendEdits();
  $('rvKpi').innerHTML = [[(pp + PE.length) + '건', `확정 대기 (개정안 ${pp} · 수정안 ${PE.length})`, pp + PE.length > 0], [all.length + '개', '전체 규칙'], [done + '개', '확정'], [cnt('AI 초안') + '개', 'AI 초안 (검토 전)', cnt('AI 초안') > 0], [cnt('검토 중') + '개', '검토 중'], [cnt('수정 요청') + '개', '수정 요청', cnt('수정 요청') > 0],
    ].map(([v, l, a]) => `<div class="kpi ${a ? 'alert' : ''}"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  const pend = all.length - done + pp + PE.length; $('rvDot').textContent = pend; $('rvDot').classList.toggle('hidden', !pend);
  if (RV.view === '관계도') return renderKX();
  const list = RV.kind && RV.kind !== '규칙' ? [] : all.filter(x => !RV.filter || x.rv.상태 === RV.filter);
  const groups = {}, ghead = {};
  const EG = '수정안 (확정 대기)', pel = RV.kind && RV.kind !== '규칙' && RV.kind !== '기준표' ? [] : PE.filter(x => (!RV.filter || RV.filter === '수정안') && (RV.kind !== '기준표' || x.a.종류 === '수량기준'));
  if (pel.length) groups[EG] = [];
  const pl = RV.kind && RV.kind !== '규칙' ? [] : PI.filter(x => !RV.filter || propRvSt(x.st) === RV.filter);
  const PG = '개정 반영 대기 (AI 추천 · 모니터링 고시)';
  if (pl.length) groups[PG] = [];
  const KG = '__none__';
  const kitems = RV.filter || RV.kind === '규칙' ? [] : kItems().filter(x => !RV.kind || x.k.ty === RV.kind);
  if (RV.group === '의무') {
    (K.의무 || []).forEach(o => { const rs = all.filter(x => topOf(x.r.의무분류) === o.코드); if (o.상태 === '폐지' && !rs.length) return; if (RV.filter && !list.some(x => topOf(x.r.의무분류) === o.코드)) return; const k = `${o.코드} ${o.이름}`; groups[k] = []; ghead[k] = `<span style="color:${OBL_CLR}">${esc(k)}</span> <span class="small" style="float:right;color:${rs.length ? (rs.every(x => x.rv.상태 === '확정') ? 'var(--green)' : 'var(--orange)') : 'var(--red)'}">${rs.length ? `확정 ${rs.filter(x => x.rv.상태 === '확정').length} / 전체 ${rs.length}` : '규칙 없음'}</span>`; });
    list.slice().sort((a0, b0) => RV.sort === '코드' ? (a0.r.의무분류 || 'Z').localeCompare(b0.r.의무분류 || 'Z', undefined, { numeric: true }) : byDate(ruleSrc(a0.r).공포일, ruleSrc(b0.r).공포일) || (a0.r.의무분류 || 'Z').localeCompare(b0.r.의무분류 || 'Z', undefined, { numeric: true })).forEach(x => { const o = oblTop(x.r.의무분류); (groups[o ? `${o.코드} ${o.이름}` : '미분류'] ||= []).push(x); });
    kitems.forEach(x => { const o = oblTop(x.k.ob); const key = o ? `${o.코드} ${o.이름}` : '미분류 지식'; (groups[key] ||= []).push(x); });
    Object.keys(ghead).forEach(k => { const n0 = (groups[k] || []).filter(x => x.k).length; if (n0) ghead[k] = ghead[k].replace('</span> <span class="small" style="float:right;', `</span> <span class="small muted" style="font-weight:400">· 지식 ${n0}</span> <span class="small" style="float:right;`); });
  } else {
    const lawOf = {}; list.forEach(x => { const l = ruleSrc(x.r); lawOf[l.법령명] = l; });
    Object.values(lawOf).sort((a0, b0) => RV.sort === '코드' ? a0.법령명.localeCompare(b0.법령명) : byDate(a0.공포일, b0.공포일)).forEach(l => { groups[l.법령명] = []; });
    list.forEach(x => groups[ruleSrc(x.r).법령명].push(x));
    Object.keys(groups).filter(k => k !== PG).forEach(k => { const l = lawOf[k], rs = groups[k]; ghead[k] = `<div>${esc(k)} <span class="small" style="float:right">확정 ${rs.filter(x => x.rv.상태 === '확정').length} / 전체 ${rs.length}</span></div><div class="small" style="font-weight:400;color:var(--sub)">${esc(l.공포번호 || '')}${l.공포일 ? ` · <b style="color:var(--navy)">${l.구분 === '고시' ? '고시' : '공포'} ${esc(l.공포일)}</b>` : ''}${l.시행일 ? ` · 시행 ${esc(l.시행일)}` : ''}</div>`; });
    const byOb = {}; kitems.forEach(x => { const o = oblTop(x.k.ob); (byOb[o ? o.코드 : 'Z'] ||= []).push(x); });
    Object.keys(byOb).sort().forEach(c => { const o = oblTop(c), key = 'KN:' + c; groups[key] = byOb[c];
      ghead[key] = `<div><span class="small" style="font-weight:400;color:var(--sub)">기준표·가이드·해석·문서</span> <span class="small" style="float:right;font-weight:400">${byOb[c].length}개</span></div><div style="color:${OBL_CLR}">${o ? esc(o.코드 + ' ' + o.이름) : '미분류'}</div>`; });
  }
  const kitemsOld = [['QTY', '물질별 규정수량 표', `물질 ${ALLCHEM.length}종 · 규정수량 규정`, '기준표'], ...K.가이드.map(g => ['G:' + g.코드, `${g.코드} ${g.지적유형}`, `지적·조치 가이드 · 규칙 ${g.규칙}`, '가이드']), ...K.해석.map(x => ['I:' + x.id, x.제목, `${x.구분} · ${x.신뢰수준} · ${x.상태}`, '해석']), ...DOC_TYPES.map(d => ['D:' + d.유형, `${d.이름} — 조문 연결`, `사업장 문서 · 조문 ${docLinks(SITES[0].문서.find(x => x.유형 === d.유형)).length}개`, '문서'])];
  if (RV.kind) Object.keys(groups).forEach(k => { if (!groups[k].length && k !== PG && k !== EG) delete groups[k]; });
  if (pl.length) { const w = pl.filter(x => !x.st).length; ghead[PG] = `개정 반영 대기 (AI 추천 · 모니터링 고시) <span class="small" style="float:right;color:${w ? 'var(--orange)' : 'var(--green)'}">대기 ${w} / 전체 ${pl.length}</span>`; }
  if (pel.length) ghead[EG] = `수정안 (확정 대기) <span class="small" style="float:right;color:var(--orange)">${pel.length}건</span>`;
  $('rvList').innerHTML = (Object.keys(groups).length > 2 ? `<div class="row" style="justify-content:flex-end;gap:4px;margin:-2px 0 4px"><a href="#" class="small" data-foldall="1">모두 접기</a><span class="small muted">·</span><a href="#" class="small" data-foldall="0">모두 펼치기</a></div>` : '') + Object.entries(groups).map(([g, xs]) => `<div class="kxh" data-fold="${esc(g)}" style="cursor:pointer;user-select:none;display:flex;gap:4px;align-items:flex-start"><span class="fic" style="flex:0 0 14px;color:var(--sub)">${FOLD.has(g) ? '▸' : '▾'}</span><div style="flex:1;min-width:0">${ghead[g] || esc(g)}</div></div>` + (g === EG ? pel.map(({ a, i }) => `<div class="kxi ${RV.sel === 'E|' + i ? 'on' : ''}" data-rv="E|${i}"><i style="background:var(--orange)"></i><div style="flex:1"><div class="row between"><b>${esc(a.종류 === '새규칙' ? a.값.id : a.규칙)}</b><span class="pill orange">수정안</span></div><div class="small">${esc(editTitle(a))}</div><div class="muted small">${esc(a.종류)} · ${esc(a.승인자)} · ${esc(a.일시.slice(0, 10))} · 시행 ${esc(a.시행일)}</div></div></div>`) : g.startsWith('개정 반영') ? pl.slice().sort((a0, b0) => RV.sort === '코드' ? 0 : byDate(a0.n.공포일, b0.n.공포일)).map(x => `<div class="kxi ${RV.sel === x.key ? 'on' : ''}" data-rv="${x.key}"><i style="background:${TYPE_COLOR.고시}"></i><div style="flex:1"><div class="row between"><b>${esc(x.n.id)}</b>${propPill(x.n, x.i).replace(/AI 추천 · 개정 반영 대기 /, '대기 ')}</div><div class="small">${esc(x.p.항목)}</div><div class="small" style="color:var(--navy)">고시 <b>${esc(x.n.공포일)}</b> · 시행 ${esc(x.n.시행일)}</div><div class="muted small">${esc(x.p.규칙)} · ${esc(x.p.현행)} → ${esc(x.p.제안)}${ruleObl(x.p.규칙) ? ` · ${esc(ruleObl(x.p.규칙))} ${esc(oblOf(ruleObl(x.p.규칙))?.이름 || '')}` : ''}</div></div></div>`) : xs.map(x0 => x0.k ? kItemHtml(x0.k) : (({ r, rv }) =>
    `<div class="kxi ${RV.sel === r.id ? 'on' : ''}" data-rv="${r.id}"><i style="background:${TYPE_COLOR.규칙}"></i><div style="flex:1"><div class="row between"><b>${esc(r.id)}</b><span class="pill ${RV_ST[rv.상태]}">${rv.상태}</span></div><div class="small">${esc(r.이름)}</div>${(l => `<div class="small" style="color:var(--navy)" title="${esc(l.법령명 + ' ' + (l.공포번호 || ''))}">${RV.group === '고시' ? '' : esc(srcShort(l)) + ' '}${esc(srcNo(l))}${l.공포일 ? ` · ${l.구분 === '고시' ? '고시' : '공포'} <b>${esc(l.공포일)}</b>` : ''}</div>`)(ruleSrc(r))}<div class="muted small">${esc(r.유형)} · v${latest(r).버전}${r.의무분류 ? ` · <b style="color:${OBL_CLR}">${esc(r.의무분류)}</b> ${esc(oblOf(r.의무분류)?.이름 || '')}` : ''}${RV.group === '고시' ? '' : ''}</div></div></div>`)(x0))).join('') + (RV.group === '의무' && /^C\d+ /.test(g) && (!RV.kind || RV.kind === '규칙') ? (t0 => { const t = oblTop(g.split(' ')[0]); if (!t) return ''; const miss = (t.세부 || []).filter(s0 => s0.상태 !== '폐지' && !rulesOf(s0.코드).length); return miss.length ? `<div class="muted small" style="padding:2px 10px 8px">규칙 없는 세부 업무 ${miss.length}개: ${miss.map(s0 => `<span title="${esc(s0.이름)} (${esc(s0.유형)})" style="${s0.유형 === '판정형' ? 'color:var(--red)' : ''}">${esc(s0.코드)}</span>`).join(' ')}</div>` : ''; })() : '')).join('') || '<p class="muted">해당 상태의 규칙이 없습니다.</p>';
  applyFold();
  const isP = RV.sel && RV.sel.startsWith('P|'), isE = RV.sel && RV.sel.startsWith('E|'), isK = RV.sel && RV.sel.startsWith('K|');
  if (!RV.sel || (isK ? !(['K|NEW', 'K|I:NEW'].includes(RV.sel) || kItems().some(x => 'K|' + x.k.id === RV.sel)) : isP ? !PI.some(x => x.key === RV.sel) : isE ? !S.approvals[+RV.sel.slice(2)]?.대기 : !K.규칙.some(r => r.id === RV.sel))) { const e0 = pel[0], p0 = pl.find(x => !x.st); RV.sel = e0 ? 'E|' + e0.i : p0 ? p0.key : (!list.length && kitems.length) ? 'K|' + kitems[0].k.id : (list.find(x => x.rv.상태 !== '확정') || list[0] || all[0]).r.id; }
  if (RV.sel.startsWith('P|')) renderPropDetail(RV.sel); else if (RV.sel.startsWith('E|')) renderEditDetail(+RV.sel.slice(2));
  else if (RV.sel.startsWith('K|')) { const nid = RV.sel.slice(2); if (ED.sel !== nid) { ED.sel = nid; ED.mode = 'view'; ED.draft = null; } const kb = !['NEW', 'I:NEW'].includes(nid) ? `<div class="result" style="background:#fff;padding:8px 12px"><div class="row" style="align-items:center"><b class="small">의무 분류</b>${oblSelect('kObl', kobl(nid), true)}<button class="btn ghost sm" data-kobl="${esc(nid)}">분류 저장</button><span class="small muted">${S.kobl?.[nid] ? '담당자 지정' : '연결된 규칙·문서 유형에서 자동'}${kobl(nid) ? ' · 미이행 시: ' + esc((oblOf(kobl(nid))?.벌칙?.종류 || []).join('·') || '직접 벌칙 없음') : ''}</span></div></div>` : '';
    const dr = nid.startsWith('D:') ? (t => `<div class="result" style="background:#fff;padding:8px 12px"><b class="small">관련 규칙</b> <span class="small muted">(인용 조문이 겹치면 자동 · 직접 추가·제외 가능)</span><div class="chips" style="margin:6px 0 0">${docRules(t).map(id => { const r0 = K.규칙.find(x => x.id === id); return linkChip(`${id} ${r0?.이름 || ''}`, id, docRulesAuto(t).includes(id), `${t}|${id}`); }).join('') || '<span class="muted small">연결된 규칙 없음</span>'}
      <select id="drAdd" style="margin-left:6px"><option value="">+ 규칙 연결</option>${K.규칙.filter(r0 => !docRules(t).includes(r0.id)).map(r0 => `<option value="${r0.id}">${esc(r0.id + ' ' + r0.이름)}</option>`).join('')}</select><button class="btn ghost sm" data-dradd="${t}">연결</button></div></div>`)(nid.slice(2)) : '';
    $('rvDetail').innerHTML = `${kb}${dr}<div id="kx"><div id="kxDetail">${detailHtml()}</div></div>`; bindKX(); }
  else { renderRvDetail(); if ($('kx')) bindKX(); }
}
function renderRvDetail() {
  const r = K.규칙.find(x => x.id === RV.sel), v = latest(r), rv = rvOf(r), M = v.검토 || {};
  const issues = M.쟁점 || [], cases = rvCases(r);
  const allChecked = issues.every((_, i) => rv.체크?.[i]);
  const locked = rv.상태 === '확정';
  $('rvDetail').innerHTML = `
    <div class="result" style="background:#fff">
      <div class="row between"><h3 style="margin:0">${esc(r.id)} ${esc(r.이름)} <span class="pill gray">${esc(r.유형)}</span> <span class="pill ${RV_ST[rv.상태]}">${rv.상태}</span></h3>
        <div class="row">${ED.mode === 'edit' && ED.sel === r.id ? '' : `<button class="btn blue" data-rvact="edit">✎ 수정하기</button>`}<button class="btn ghost sm" data-rvgo="${r.id}">관계도에서 보기</button></div></div>
      ${(pe => pe.length ? `<div class="small" style="margin:6px 0 0;padding:6px 10px;background:#FFF4E5;border:1px solid var(--orange);border-radius:8px">수정안 ${pe.length}건 확정 대기 — ${pe.map(x => `<a href="#" data-rvsel="E|${x.i}">${esc(x.a.승인자)} ${esc(x.a.일시.slice(0, 10))} (시행 ${esc(x.a.시행일)})</a>`).join(', ')}</div>` : '')(pendEdits().filter(x => x.a.규칙 === r.id))}
      ${ED.mode === 'edit' && ED.sel === r.id ? `<div id="kx" style="margin-top:10px;border:2px solid var(--blue);border-radius:10px;padding:10px;background:#F7FAFF"><div class="row between" style="margin-bottom:6px"><span class="small"><b style="color:var(--blue)">수정 중</b> — 저장하면 <b>수정안</b>으로 등록되고, 확정해야 판정에 적용됩니다.</span><span class="row"><button class="btn green sm" data-act="save">수정안 저장</button><button class="btn ghost sm" data-act="cancel">취소</button></span></div><div id="kxDetail">${detailHtml()}</div></div>` : ''}
      <p class="muted" style="margin:6px 0">${esc(r.설명)}</p>
      <div class="kv"><b>의무 분류</b><span>${oblSelect('rvObl', r.의무분류, true)}
          <span class="small muted">연관 의무</span> ${(K.의무 || []).filter(o => o.상태 !== '폐지').map(o => `<label class="small" style="white-space:nowrap" title="${esc(o.이름)}"><input type="checkbox" data-rvrel="${o.코드}" ${(r.연관분류 || []).includes(o.코드) ? 'checked' : ''}>${esc(o.코드)}</label>`).join(' ')}
          <button class="btn ghost sm" data-rvact="obl">분류 저장</button></span>
        <b>미이행 시 벌칙</b><span>${r.의무분류 ? penHtml(oblOf(r.의무분류)) : '<span class="muted small">의무 분류를 지정하세요</span>'}</span>
        <b>출처 고시</b><span>${(l => `${esc(l.법령명)} ${esc(l.공포번호 || '')} · <b>고시(공포) ${esc(l.공포일 || '-')}</b> · 시행 ${esc(l.시행일 || '-')}`)(ruleSrc(r))}</span><b>작성</b><span>${esc(M.작성 || '-')} · ${esc(M.작성일 || '')} · v${v.버전} (시행 ${v.시행일})</span><b>AI 요약</b><span>${esc(M.요약 || '-')}</span></div>
    </div>
    <div class="result" style="background:#fff"><h3>규칙 내용</h3>${ruleBody(r, v, false)}</div>
    <div class="result" style="background:#fff"><h3>관련 사내 문서 <span class="muted small">— 규칙을 바꾸면 함께 검토할 문서 (인용 조문이 겹치면 자동 연결)</span></h3>
      <div class="chips" style="margin:0">${ruleDocs(r.id).map(d => linkChip(d.이름, 'K|D:' + d.유형, docRulesAuto(d.유형).includes(r.id), `${d.유형}|${r.id}`)).join('') || '<span class="muted small">연결된 문서 없음</span>'}
        <select id="rdAdd" style="margin-left:6px"><option value="">+ 문서 연결</option>${DOC_TYPES.filter(d => !ruleDocs(r.id).includes(d)).map(d => `<option value="${d.유형}">${esc(d.이름)}</option>`).join('')}</select><button class="btn ghost sm" data-rdadd="${r.id}">연결</button></div></div>
    <div class="result" style="background:#fff"><h3>근거 원문 (고시·법령) <span class="muted small">— 📄 원문 페이지를 누르면 원본 문서의 해당 쪽을 표시</span></h3>${citeHtml(cite0(v.근거))}</div>
    <div class="result ${issues.length && !allChecked ? 'hit' : ''}" style="${issues.length && !allChecked ? '' : 'background:#fff'}"><h3>쟁점·확인 필요 사항 ${issues.length ? `<span class="muted small">(${issues.filter((_, i) => rv.체크?.[i]).length}/${issues.length} 확인)</span>` : ''}</h3>
      ${issues.length ? issues.map((t, i) => `<label class="chk" style="align-items:flex-start"><input type="checkbox" data-rvchk="${i}" ${rv.체크?.[i] ? 'checked' : ''} ${locked ? 'disabled' : ''}> <span>${esc(t)}</span></label>`).join('') : '<p class="muted small">AI가 표시한 쟁점이 없습니다.</p>'}
      </div>
    <div class="result" style="background:#fff"><h3>검증 사례 (지금 엔진으로 실행)</h3>
      ${cases.length ? `<table><tr><th>사례</th><th>입력</th><th>기대</th><th>실제</th><th>결과</th></tr>${cases.map(({ c, act, ok }) => `<tr><td class="small">${esc(c.설명)}</td><td class="small"><code>${esc(JSON.stringify(c.입력))}</code></td><td class="small">${esc(JSON.stringify(c.기대))}</td><td class="small">${esc(Object.keys(c.기대).map(k => `${k}: ${act[k] ?? '-'}`).join(', '))}</td><td><span class="pill ${ok ? 'green' : 'red'}">${ok ? '통과' : '불일치'}</span>${r.유형 === '수량판정' ? `<br><button class="btn ghost sm srcbtn" data-src="${act.표 === '별표3' ? 'QTY-B3-일반' : 'QTY-B2-일반'}" data-extra="${encodeURIComponent('<p><b>이 사례에 해당하는 원문 행</b> (노란 행이 적용된 값)</p>' + qtyRowsHtml(c.입력.CAS, act.행))}">📄 별표 원문 행</button>` : ''}</td></tr>`).join('')}</table>` : '<p class="muted small">등록된 검증 사례가 없습니다.</p>'}
      ${intOf(r.id).length ? `<h3>연결된 해석·판단</h3>${intCards(intOf(r.id))}` : ''}</div>
    <div class="result" style="background:#fff;border-color:var(--blue)"><h3>전문가 검토</h3>
      ${locked ? `<p><span class="pill green">확정</span> ${esc(rv.검토자 || '')} · ${esc(rv.일시 || '')} ${rv.의견 ? `— ${esc(rv.의견)}` : ''}</p><button class="btn ghost sm" data-rvact="reopen">확정 취소 (재검토)</button>` : `
      <div class="row" style="align-items:flex-end"><label class="field"><span>검토자</span><select id="rvWho">${personOpts(rv.검토자 || '박정민', 'HQ')}</select></label>
        <label class="field" style="flex:1;min-width:240px"><span>검토 의견</span><input type="text" id="rvMemo" value="${esc(rv.의견 || '')}" placeholder="예: 고시 원문과 일치 확인, 복수 구분 최소값 적용 동의" style="width:100%"></label></div>
      <div class="row"><button class="btn green" data-rvact="확정" ${allChecked && cases.every(x => x.ok) ? '' : 'disabled title="쟁점 확인과 검증 사례 통과가 필요합니다"'}>✔ 확정 저장</button>
        <button class="btn ghost" data-rvact="검토 중">검토 중으로 표시</button><button class="btn orange" data-rvact="수정 요청">수정 요청</button><button class="btn ghost" data-rvact="반려" style="color:var(--red)">반려</button></div>`}
      ${rv.이력?.length ? `<details style="margin-top:8px"><summary>검토 이력 ${rv.이력.length}건</summary>${rv.이력.map(h => `<div class="small">${esc(h.t)} · ${esc(h.who)} · <b>${esc(h.상태)}</b> ${esc(h.의견 || '')}</div>`).join('')}</details>` : ''}</div>`;
}
function cite0(ids) { return [...new Set(ids)].map(id => { const vs = K.조문[id] || []; const a = vs.find(x => !x.폐지일) || vs[vs.length - 1]; return a ? { id, 조문: label(a), 법령: a.법령명, 시행일: a.시행일, 내용: a.내용 } : { id, 조문: id, 법령: '', 시행일: '', 내용: '(조문 없음)' }; }); }
// 목록 묶음 접기·펼치기 (브라우저에 기억)
const FOLD = new Set((() => { try { return JSON.parse(localStorage.getItem('regai-fold')) || []; } catch (e) { return []; } })());
const saveFold = () => { try { localStorage.setItem('regai-fold', JSON.stringify([...FOLD])); } catch (e) { /* 저장 불가 */ } };
function applyFold() {
  let hide = false;
  [...$('rvList').children].forEach(el => { if (el.classList.contains('kxh')) { hide = FOLD.has(el.dataset.fold); const n = el.nextElementSibling; return; } if (el.dataset.foldall === undefined && !el.querySelector('[data-foldall]')) el.style.display = hide ? 'none' : ''; });
}
$('rvList') && ($('rvList').onclick = e => {
  const fa = e.target.closest('[data-foldall]'); if (fa) { e.preventDefault(); const all = [...$('rvList').querySelectorAll('.kxh')].map(h => h.dataset.fold); if (fa.dataset.foldall === '1') all.forEach(k => FOLD.add(k)); else all.forEach(k => FOLD.delete(k)); saveFold(); return renderReview(); }
  const f = e.target.closest('[data-fold]'); if (f) { const k = f.dataset.fold; FOLD.has(k) ? FOLD.delete(k) : FOLD.add(k); saveFold(); f.querySelector('.fic').textContent = FOLD.has(k) ? '▸' : '▾'; return applyFold(); }
  const x = e.target.closest('[data-rv]'); if (x) { RV.sel = x.dataset.rv; renderReview(); } });
document.querySelectorAll('[data-rvview]').forEach(b => b.onclick = () => { RV.view = b.dataset.rvview; if (RV.view === '목록' && ED.mode === 'edit' && !K.규칙.some(r => r.id === ED.sel)) { ED.mode = 'view'; ED.draft = null; } renderReview(); });
$('rvGroup') && ($('rvGroup').onchange = e => { RV.group = e.target.value; renderReview(); });
$('rvKind') && ($('rvKind').onchange = e => { RV.kind = e.target.value; RV.sel = null; renderReview(); });
$('rvSort') && ($('rvSort').onchange = e => { RV.sort = e.target.value; renderReview(); });
$('rvFilter') && ($('rvFilter').onchange = e => { RV.filter = e.target.value; RV.sel = null; renderReview(); });
$('rvDetail') && ($('rvDetail').onchange = e => {
  if (e.target.id === 'ppv' || e.target.id === 'ppd') { const [, nid, si] = RV.sel.split('|'), n = NOTICES.find(x => x.id === nid), p = n.규칙제안[+si];
    $('ppImpact').innerHTML = propImpact(n, +si, p.종류 === '필수항목추가' ? $('ppv').value : Number($('ppv')?.value), $('ppd').value); return; }
  const c = e.target.dataset.rvchk; if (c === undefined) return;
  const r = K.규칙.find(x => x.id === RV.sel), rv = rvOf(r);
  rv.체크 = { ...rv.체크, [c]: e.target.checked }; if (rv.상태 === 'AI 초안') rv.상태 = '검토 중';
  S.review[r.id] = rv; save(); renderReview();
});
$('rvDetail') && ($('rvDetail').onclick = e => {
  if (e.target.closest('#kx')) return;
  const go = e.target.closest('[data-rvgo]'); if (go) { ED.sel = go.dataset.rvgo; ED.mode = 'view'; ED.draft = null; RV.view = '관계도'; return renderReview(); }
  const nd = e.target.closest('[data-node]'); if (nd) { e.preventDefault(); return selectNode(nd.dataset.node); }
  const g4 = e.target.closest('[data-pgo4]'); if (g4) return openCmp(g4.dataset.pgo4);
  const dd = e.target.closest('[data-drdel]'); if (dd) { e.preventDefault(); const [t, id] = dd.dataset.drdel.split('|'); docRuleEdit(t, id, false); toast(`${docOf(t)?.이름} ↔ ${id} 연결 제외`); return renderReview(); }
  const ra = e.target.closest('[data-rdadd]'); if (ra) { const t = $('rdAdd').value; if (!t) return toast('연결할 문서를 고르세요'); docRuleEdit(t, ra.dataset.rdadd, true); return renderReview(); }
  const da = e.target.closest('[data-dradd]'); if (da) { const id = $('drAdd').value; if (!id) return toast('연결할 규칙을 고르세요'); docRuleEdit(da.dataset.dradd, id, true); return renderReview(); }
  const kb = e.target.closest('[data-kobl]'); if (kb) { const id = kb.dataset.kobl, c = $('kObl').value; S.kobl ||= {}; if (c) S.kobl[id] = c; else delete S.kobl[id]; log(`지식 의무 분류: ${id} → ${c || '미분류'}`); save(); toast(`${id} → ${c} ${oblOf(c)?.이름 || ''}`); return renderReview(); }
  const rs = e.target.closest('[data-rvsel]'); if (rs) { e.preventDefault(); RV.sel = rs.dataset.rvsel; return renderReview(); }
  const ea = e.target.closest('[data-eact]'); if (ea) {
    const v = ea.dataset.v;
    if (ea.dataset.eact === 'view') { RV.sel = v; return renderReview(); }
    const i = +v, a0 = S.approvals[i];
    if (ea.dataset.eact === 'no') { const memo = $('edMemo').value.trim(); S.approvals.splice(i, 1); log(`수정안 반려: ${editTitle(a0)}${memo ? ' — ' + memo : ''}`, $('edWho').value); save(); K = knowledge(); RV.sel = null; toast('수정안을 반려했습니다'); return renderReview(); }
    confirmEdit(i, $('edWho').value, $('edMemo').value.trim()); RV.sel = a0.종류 === '새규칙' ? a0.값.id : a0.규칙 === '수량기준' ? null : a0.규칙; toast(`확정 — ${a0.시행일}부터 판정에 적용됩니다`); return render();
  }
  const pa = e.target.closest('[data-pact]'); if (pa) {
    const [, nid, si] = RV.sel.split('|'), n = NOTICES.find(x => x.id === nid), i = +si, p = n.규칙제안[i];
    if (pa.dataset.pact === 'edit') { const id = p.규칙 === '수량기준' ? 'QTY' : p.규칙; ED.sel = id; ED.mode = 'view'; ED.draft = null; kxAct('edit'); RV.sel = id === 'QTY' ? 'K|QTY' : id; return renderReview(); }
    if (pa.dataset.pact === 'reopen') { delete S.prop[pkey(n, i)]; log(`${n.id} 개정 규칙 반려 취소: ${p.항목}`); save(); return renderReview(); }
    const who = $('ppWho').value, memo = $('ppMemo').value.trim();
    if (pa.dataset.pact === 'no') { if (!memo) return toast('반려 사유를 검토 의견에 입력하세요'); rejectProposal(n, i, who, memo); toast('반려 — 기존 확정 규칙을 유지합니다'); return render(); }
    const 값 = p.종류 === '확인' ? null : (p.종류 === '필수항목추가' ? $('ppv').value : Number($('ppv').value));
    const { a, re } = approveProposal(n, i, { 값, 시행일: $('ppd').value, 승인자: who, 의견: memo });
    ED.sel = p.규칙 === '수량기준' ? 'QTY' : p.규칙; ED.mode = 'view'; ED.draft = null;
    toast(`확정 — ${a.시행일}부터 새 규칙으로 판정합니다${re ? ` · 조치 기한 ${re}건 재계산` : ''}`); return render();
  }
  const a = e.target.closest('[data-rvact]'); if (!a) return;
  const r = K.규칙.find(x => x.id === RV.sel), rv = rvOf(r), act = a.dataset.rvact;
  if (act === 'edit') { ED.sel = r.id; ED.mode = 'view'; ED.draft = null; kxAct('edit'); return renderReview(); }
  if (act === 'obl') {
    const c = $('rvObl').value, rel = [...document.querySelectorAll('[data-rvrel]:checked')].map(x => x.dataset.rvrel).filter(x => x !== topOf(c));
    if (!c) return toast('의무 분류를 선택하세요');
    S.approvals.push({ notice: null, 규칙: r.id, 종류: '규칙분류', 값: { 의무분류: c, 연관분류: rel }, 시행일: base(), 승인자: '김지훈', 일시: nowStr() });
    log(`규칙 ${r.id} 의무 분류 변경: ${r.의무분류 || '미분류'} → ${c}${rel.length ? ` (연관 ${rel.join(', ')})` : ''}`); save(); K = knowledge(); toast(`${r.id} 분류를 ${c} ${oblOf(c)?.이름}(으)로 저장했습니다`); return renderReview();
  }
  if (act === 'reopen') { rv.상태 = '검토 중'; rv.이력 = [...(rv.이력 || []), { t: nowStr(), who: '김지훈', 상태: '확정 취소' }]; S.review[r.id] = rv; log(`규칙 ${r.id} 확정 취소 (재검토)`); save(); K = knowledge(); return renderReview(); }
  const who = $('rvWho').value, memo = $('rvMemo').value.trim();
  if (['수정 요청', '반려'].includes(act) && !memo) return toast('수정 요청·반려 사유를 검토 의견에 입력하세요');
  Object.assign(rv, { 상태: act, 검토자: who, 의견: memo, 일시: nowStr() });
  rv.이력 = [...(rv.이력 || []), { t: nowStr(), who, 상태: act, 의견: memo }];
  S.review[r.id] = rv; log(`규칙 ${r.id} ${act}${memo ? ' — ' + memo : ''}`, who); save(); K = knowledge();
  toast(act === '확정' ? `${r.id} 확정 저장 — 판정 결과에 '확정' 규칙으로 표시됩니다` : `${r.id} ${act}`);
  renderReview();
});
$('rvNewRule') && ($('rvNewRule').onclick = () => { RV.view = '목록'; RV.filter = ''; kxAct('new'); RV.sel = 'K|NEW'; renderReview(); });
$('rvNewInt') && ($('rvNewInt').onclick = () => { RV.view = '목록'; RV.filter = ''; kxAct('new-int'); RV.sel = 'K|I:NEW'; renderReview(); });
$('rvExport') && ($('rvExport').onclick = () => {
  const out = K.규칙.filter(r => rvOf(r).상태 === '확정').map(r => ({ ...r, 검토결과: rvOf(r) }));
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ 내보낸시각: nowStr(), 규칙: out }, null, 2)], { type: 'application/json' }));
  a.download = `확정규칙_${base()}.json`; a.click(); toast(`확정 규칙 ${out.length}개를 내보냈습니다 (운영 시 PR로 저장소에 반영)`);
});
const ruleBadge = id => { const r = K.규칙.find(x => x.id === id); if (!r) return ''; const st = rvOf(r).상태; return st === '확정' ? '<span class="pill green">확정 규칙</span>' : `<span class="pill orange" title="전문가 확정 전 규칙">미확정 (${st})</span>`; };

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
  if (curTab === 't5') renderDash();
  if (curTab === 't6') renderKnowledge();
  if (curTab === 't8') renderReview();
  try { const pend = K.규칙.filter(r => rvOf(r).상태 !== '확정').length; $('rvDot').textContent = pend; $('rvDot').classList.toggle('hidden', !pend); } catch (e) {}
}
$('baseDate').onchange = render;
$('siteSel').innerHTML = `<option value="ALL">전체 (${SITES.length}곳)</option>` + SITES.map(x => `<option value="${x.id}">${esc(x.사업장)}</option>`).join('');
$('siteSel').onchange = e => setSite(e.target.value);
$('resetBtn').onclick = e => { e.preventDefault(); if (confirmBox('시연 데이터를 처음 상태로 되돌릴까요? (이 브라우저에 저장된 분석·승인·이력이 삭제됩니다)')) { seed(); K = knowledge(); render(); toast('시연 데이터를 초기화했습니다'); } };
$('aiCfgBtn').onclick = e => { e.preventDefault(); openAiCfg(); };
render();
