import { judgeChange, inspectionSchedule, checkLabel, activeVersion, daysBetween, label, addDays, impact } from './engine.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const B = await (await fetch('data/bundle.json', { cache: 'no-store' })).json();
const SITE = B.사업장;
const NOTICES = B.고시 || [];
const PEOPLE = SITE.담당자;
const ST = ['대기', '진행 중', '완료'];

// ---------------------------------------------------------------- 상태 저장 (브라우저 localStorage)
const KEY = 'regai-demo-v2';
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
const personOpts = sel => PEOPLE.map(p => `<option value="${esc(p.이름)}" ${p.이름 === sel ? 'selected' : ''}>${esc(p.이름)} (${esc(p.부서)})</option>`).join('');
const pickPerson = 부서 => (PEOPLE.find(p => p.부서 === 부서 && p.직책 !== '팀장') || PEOPLE.find(p => p.부서 === 부서) || PEOPLE[0]).이름;
const shash = s => { let h = 2166136261; for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, '0') + '····'; };

// ---------------------------------------------------------------- 지식 = 저장소 지식 + 전문가 승인 내역
function knowledge() {
  const K = { ...B, 규칙: clone(B.규칙), 조문: clone(B.조문), 수량: {} };
  const approvedNotices = new Set();
  for (const a of S.approvals) {
    if (a.notice) approvedNotices.add(a.notice);
    if (a.종류 === '확인') continue;
    if (a.종류 === '수량기준') { (K.수량[a.CAS] ||= []).push({ 시행일: a.시행일, 하위: Number(a.값), 승인: a.승인자 }); continue; }
    if (a.종류 === '새규칙') { K.규칙.push(clone(a.값)); continue; }
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
  return { 취급시설_용량_증가: t.includes('용량'), 함량_농도_성상_변경: t.includes('함량'), 위험도_증가: t.includes('위험 증가'), 시설_위치_변경: t.includes('위치') };
}

// ---------------------------------------------------------------- AI 영향 분석 (시연: 미리 만든 AI 결과 + 사업장 데이터 대조)
function fill(tpl, v) { return tpl.replace(/\{(\S+?)\}/g, (_, k) => v[k] ?? ''); }
function analyze(n) {
  const items = [];
  const due = (spec, v = {}) => spec.기준 === '시행일' ? addDays(n.시행일, spec.일수) : addDays(v[spec.기준] || n.시행일, spec.일수);
  const changedCAS = (n.수량변경 || []).map(q => q.CAS);
  const prop = (n.규칙제안 || []).find(p => p.종류 === '기한일수');
  for (const r of n.영향규칙 || []) {
    let ents = [];
    if (r.대상 === '변경관리') {
      ents = SITE.변경관리.filter(m => m.상태 === '진행' && m.계획서_제출예정).map(m => ({
        구분: '설비 변경', 대상: `${m.id} ${m.이름}`, 담당자: m.담당자,
        v: { ...m, 기존기한: m.계획서_제출예정, 신기한: addDays(m.변경완료_예정일, prop ? prop.제안 : -60) },
      }));
    } else if (r.대상 === '물질') {
      ents = SITE.물질.filter(m => r.조건.전체 || (r.조건.수량변경 && changedCAS.includes(m.CAS))).map(m => {
        const q = (n.수량변경 || []).find(x => x.CAS === m.CAS) || {};
        return { 구분: '물질', 대상: `${m.이름} (CAS ${m.CAS})`, 담당자: pickPerson(r.부서),
          v: { ...m, 보유량: m.최대보유량_t, ...q, 배수_구: q.하위_구 ? (m.최대보유량_t / q.하위_구).toFixed(1) : '', 배수_신: q.하위_신 ? (m.최대보유량_t / q.하위_신).toFixed(1) : '' } };
      });
    } else if (r.대상 === '시설') {
      ents = SITE.시설.filter(f => (r.조건.유형 && r.조건.유형.includes(f.유형))
        || (r.조건.물질수량변경 && f.물질.some(id => changedCAS.includes(SITE.물질.find(m => m.id === id)?.CAS)))
        || (r.조건.연장후보 && f.연속적합_횟수 >= 2))
        .map(f => ({ 구분: '시설', 대상: f.이름, 담당자: f.담당자, v: f }));
    } else {
      ents = [{ 구분: r.대상 === '교육' ? '교육' : '신고·제출', 대상: r.대상명, 담당자: pickPerson(r.부서), v: {} }];
    }
    for (const e of ents) items.push({ 구분: e.구분, 대상: e.대상, 영향: fill(r.영향, e.v), 조치: r.조치, 담당자: e.담당자, 기한: due(r.기한, e.v), 신뢰도: r.신뢰도, 근거: n.변경조문.map(c => c.조문) });
  }
  // 문서: 관련 조문이 바뀐 조문과 연결된 사내 문서
  const ids = n.변경조문.map(c => c.id);
  for (const d of SITE.문서) {
    const hit = d.관련조문.some(x => ids.some(id => id === x || id.startsWith(x + '-')));
    if (!hit) continue;
    const recs = (n.문서수정 || []).filter(x => x.문서 === d.id).map(x => ({ ...x, 채택: null, 최종: x.수정안 }));
    items.push({ 구분: '문서', 대상: `${d.이름} (${d.번호})`, 문서: d.id, 담당자: d.담당자, 기한: addDays(n.시행일, -30), 신뢰도: recs.length ? 0.9 : 0.62,
      영향: recs.length ? `개정 조문을 인용하는 문서 — 수정 위치 ${recs.length}곳 식별, 수정 문구 제안` : '관련 조문이 연결된 문서 — 수정 필요 여부 검토',
      조치: recs.length ? '수정안 검토·채택 후 문서 개정' : '문서 검토 (변경 불필요 시 확인 기록)', 수정안: recs, 근거: n.변경조문.map(c => c.조문) });
  }
  // 지식: 규칙 수정과 지적·조치 가이드
  const seen = new Set();
  for (const p of n.규칙제안 || []) {
    if (seen.has(p.규칙)) continue; seen.add(p.규칙);
    const rule = B.규칙.find(r => r.id === p.규칙);
    items.push({ 구분: '지식(규칙)', 대상: rule ? `판정 규칙 ${rule.id} ${rule.이름}` : '물질별 규정수량 표', 담당자: '김지훈', 기한: addDays(n.시행일, -21), 신뢰도: 0.95,
      영향: p.종류 === '확인' ? '판정 값 변경 없음 — 근거 문구 확인' : `${p.항목}: ${p.현행} → ${p.제안}`, 조치: '④ 신·구 비교 화면에서 전문가 확인·승인', 근거: [p.근거], 규칙키: p.규칙 });
  }
  for (const g of impact(B, ids).가이드) {
    items.push({ 구분: '지식(가이드)', 대상: `지적·조치 가이드 ${g.코드} ${g.지적유형}`, 담당자: '이수진', 기한: addDays(n.시행일, -21), 신뢰도: 0.82,
      영향: '권고 조치 문구에 개정 전 기준이 들어 있을 수 있음', 조치: '권고 조치 문구 갱신', 근거: ids });
  }
  return items.map((x, i) => ({ id: `${n.id}-${String(i + 1).padStart(2, '0')}`, 출처: 'AI', 상태: '대기', 판단: '확인 전', ...x }));
}

// ---------------------------------------------------------------- 초기 상태 (시연용: 일부 고시는 이미 진행 중)
function seed() {
  S = { v: 3, notices: {}, approvals: [], prop: {}, log: [], checked: null };
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
      const na = (st.비대상 || []).find(x => x.i === i);
      if (na) { t.판단 = '비대상'; t.판단사유 = na.사유; return; }
      if (st.완료 === 'all' || (st.완료 || []).includes(i)) t.상태 = '완료';
      else if ((st.진행 || []).includes(i)) t.상태 = '진행 중';
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
if (!S || S.v !== 3) seed();
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
  const insp = inspectionSchedule(K, SITE, base());
  const near = insp.filter(r => r.상태 !== '정상').length;
  const acc = SITE.물질.filter(m => m.구분.includes('사고대비')).length;
  const mocs = SITE.변경관리.filter(m => m.상태 === '진행');
  $('siteKpi').innerHTML = [
    [SITE.사업장군, '사업장 군 (정기검사 주기 기준)'], [SITE.물질.length + '종', `취급 유해화학물질 (사고대비 ${acc}종)`], [SITE.시설.length + '개', '취급시설'],
    [near + '개', '정기검사 임박·경과', near > 0], [mocs.length + '건', '진행 중 변경관리'], [SITE.문서.length + '건', '관리 문서 (조문 연결)'],
  ].map(([v, l, a]) => `<div class="kpi ${a ? 'alert' : ''}"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('');
  const bi = SITE.기본정보;
  $('siteBasic').innerHTML = [['회사', bi.회사], ['사업장', SITE.사업장], ['업종', bi.업종], ['소재지', bi.소재지], ['종업원', bi.종업원], ['유해화학물질관리자', bi.유해화학물질관리자], ['취급자 교육', bi.취급자_교육_이수율]]
    .map(([k, v]) => `<b>${k}</b><span>${esc(v)}</span>`).join('');
  $('permitTable').innerHTML = `<tr><th>허가 종류</th><th>허가번호</th><th>최근 변경</th></tr>` + SITE.영업허가.map(p => `<tr><td>${esc(p.종류)}</td><td class="small">${esc(p.번호)}</td><td>${p.최근변경}</td></tr>`).join('');
  const pl = SITE.계획서;
  $('planInfo').innerHTML = [['최초 제출', pl.최초제출], ['최근 변경 제출', pl.최근변경제출], ['이행점검', pl.이행점검], ['결과', pl.결과], ['총괄영향범위', pl.총괄영향범위]].map(([k, v]) => `<b>${k}</b><span>${esc(v)}</span>`).join('');
  $('chemTable').innerHTML = `<tr><th>물질</th><th>CAS</th><th>UN</th><th>구분</th><th class="num">최대 보유량</th><th class="num">하위 규정수량</th><th class="num">배수</th><th class="num">상위 규정수량</th><th>취급시설</th><th>MSDS 개정</th></tr>` +
    SITE.물질.map(m => {
      const q = qtyAt(m, base());
      const mul = m.최대보유량_t / q.하위;
      return `<tr><td><b>${esc(m.이름)}</b></td><td>${m.CAS}</td><td>${m.UN}</td><td class="small">${esc(m.구분)}</td><td class="num">${m.최대보유량_t} t</td>
        <td class="num">${q.하위} t${q.예정 ? `<br><span class="pill orange">${q.예정.시행일}부터 ${q.예정.하위} t</span>` : ''}</td>
        <td class="num"><b>${mul.toFixed(1)}</b>${q.예정 ? `<br><span class="muted">→ ${(m.최대보유량_t / q.예정.하위).toFixed(1)}</span>` : ''}</td><td class="num">${q.상위} t</td><td>${m.시설.join(', ')}</td><td>${m.MSDS개정}</td></tr>`;
    }).join('');
  const r242 = activeVersion(K.규칙.find(r => r.id === 'R-24-2'), base());
  $('facDesc').textContent = `다음 검사 기한은 규칙 R-24-2 v${r242.버전}(${SITE.사업장군} 결정표)으로 기준일 ${base()}에 계산`;
  const st = s => s === '기한 경과' ? 'red' : s === '임박' ? 'orange' : 'green';
  $('facTable').innerHTML = `<tr><th>시설</th><th>유형</th><th>취급 물질</th><th>용량</th><th>위험도</th><th>방류벽</th><th>누출감지</th><th>최근 검사</th><th>주기</th><th>다음 기한</th><th>상태</th><th>담당</th></tr>` +
    SITE.시설.map((f, i) => { const r = insp[i]; return `<tr><td><b>${esc(f.이름)}</b></td><td>${esc(f.유형)}</td><td class="small">${f.물질.map(id => esc(SITE.물질.find(m => m.id === id)?.이름)).join(', ')}</td><td>${esc(f.용량)}</td><td>${f.위험도}</td><td class="small">${esc(f.방류벽)}</td><td>${esc(f.누출감지)}</td><td>${f.최근_검사일}</td><td>${r.주기_년}년${r.연장_년 ? ` +${r.연장_년}` : ''}</td><td><b>${r.기한}</b> <span class="muted">${dday(r.기한)}</span></td><td><span class="pill ${st(r.상태)}">${r.상태}</span></td><td>${esc(f.담당자)}</td></tr>`; }).join('');
  $('mocTable').innerHTML = `<tr><th>변경 건</th><th>변경 유형</th><th>완료 예정</th><th>계획서 제출 기한</th><th>상태</th></tr>` +
    SITE.변경관리.map(m => { const d = m.상태 === '진행' ? mocDue(m, base()) : null; const chg = d && m.계획서_제출예정 && d !== m.계획서_제출예정;
      return `<tr><td><b>${m.id}</b><br>${esc(m.이름)}<div class="muted">${esc(m.담당자)}</div></td><td class="small">${esc(m.변경유형)}</td><td>${m.변경완료_예정일}</td>
      <td>${d ? `<b>${d}</b> <span class="small" style="${d < base() ? 'color:var(--red);font-weight:700' : 'color:var(--sub)'}">${dday(d)}</span>${chg ? `<br><span class="pill red">기존 계획 ${m.계획서_제출예정}</span>` : ''}` : '-'}</td><td>${m.상태 === '진행' ? '<span class="pill orange">진행</span>' : '<span class="pill gray">완료</span>'}</td></tr>`; }).join('');
  $('docTable').innerHTML = `<tr><th>문서</th><th>개정</th><th>담당</th><th>연결 조문</th></tr>` +
    SITE.문서.map(d => `<tr><td><b>${esc(d.이름)}</b><div class="muted">${d.번호}</div></td><td class="small">${esc(d.개정)}</td><td style="white-space:nowrap">${esc(d.담당자)}</td><td class="small">${d.관련조문.map(x => x === 'QTY' ? '수량기준 고시' : x).join(', ')}</td></tr>`).join('');
}

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
const STEPS = n => [`바뀐 조문 ${n.변경조문.length}건 읽기 · 변경 요지 추출`, `사업장 데이터와 대조 (물질 ${SITE.물질.length}종 · 시설 ${SITE.시설.length}개 · 변경관리 ${SITE.변경관리.length}건)`,
  `조문이 연결된 사내 문서 ${SITE.문서.length}건에서 수정 위치 탐색 · 수정 문구 작성`, '판정 규칙 · 지적·조치 가이드 연결 추적', '조치 목록 · 담당자 · 기한 제안'];
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
  const t = s.tasks, ta = t.filter(act);
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
    <div class="prog"><span class="d" style="width:${ta.length ? done / ta.length * 100 : 0}%"></span><span class="p" style="width:${ta.length ? prog / ta.length * 100 : 0}%"></span></div>
    <div class="legend"><span><i style="background:var(--green)"></i>완료 ${done}</span><span><i style="background:var(--orange)"></i>진행 중 ${prog}</span><span><i style="background:#E3E9F2"></i>대기 ${ta.length - done - prog}</span><span>(비대상 ${jn}건 제외)</span>${over ? `<span style="color:var(--red);font-weight:700">기한 경과 ${over}</span>` : ''}</div>
    <div class="scroll" style="margin-top:12px"><table class="tasks" id="taskTable">
      <tr><th>구분</th><th style="min-width:300px">영향 대상 · 내용</th><th>조치</th><th style="min-width:150px">담당자 판단</th><th>담당자</th><th>기한</th><th>상태</th><th class="noprint"></th></tr>
      ${t.map((x, i) => taskRow(x, i)).join('')}
    </table></div>
  </div>
  <div class="card noprint">
    <h2>조치 항목 직접 추가</h2>
    <div class="row" style="align-items:flex-end">
      <label class="field"><span>구분</span><select id="adKind">${['설비 변경', '시설', '물질', '문서', '교육', '신고·제출', '지식(규칙)', '기타'].map(k => `<option>${k}</option>`).join('')}</select></label>
      <label class="field" style="flex:1;min-width:180px"><span>대상</span><input type="text" id="adTarget" style="width:100%" placeholder="예: P-301 벤젠 이송배관"></label>
      <label class="field" style="flex:1.4;min-width:200px"><span>조치 내용</span><input type="text" id="adAction" style="width:100%" placeholder="예: 배관 표지 교체"></label>
      <label class="field"><span>담당자</span><select id="adOwner">${personOpts('이수진')}</select></label>
      <label class="field"><span>기한</span><input type="date" id="adDue" value="${addDays(n.시행일, -14)}"></label>
      <div class="field"><button class="btn blue" id="adBtn">추가</button></div>
    </div>
  </div>`;
  $('taskTable').onchange = onTaskChange;
  $('taskTable').onclick = onTaskClick;
  $('reBtn').onclick = () => { if (confirmBox('다시 분석하면 AI 제안 항목의 담당자·기한·상태가 초기화됩니다. (직접 추가한 항목은 유지)')) { const manual = s.tasks.filter(x => x.출처 !== 'AI'); delete S.notices[n.id]; runAnalysis(() => S.notices[n.id].tasks.push(...manual)); } };
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
    t.push({ id: `${n.id}-M${t.filter(x => x.출처 !== 'AI').length + 1}`, 출처: '직접', 상태: '대기', 판단: '조치 대상', 판단자: '김지훈', 구분: $('adKind').value, 대상, 영향: '담당자 직접 추가', 조치, 담당자: $('adOwner').value, 기한: $('adDue').value, 근거: [] });
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
    <td><span class="pill line">${esc(x.구분)}</span><br>${src}</td>
    <td><b>${esc(x.대상)}</b><div class="muted">${esc(x.영향)}</div>${recs}</td>
    <td class="small">${esc(x.조치)}${link}</td>
    <td>${judge}</td>
    <td><select data-f="담당자">${personOpts(x.담당자)}</select></td>
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
  const rows = [['번호', '구분', '대상', '영향', '조치', '담당자 판단', '비대상 사유', '판단자', '담당자', '기한', '상태', '출처', '근거']].concat(t.map(x => [x.id, x.구분, x.대상, x.영향, x.조치, x.판단, x.판단사유 || '', x.판단자 || '', x.담당자, x.기한, x.판단 === '비대상' ? '해당 없음' : x.상태, x.출처 === 'AI' ? `AI(${Math.round(x.신뢰도 * 100)}%)` : '직접', (x.근거 || []).join(' ')]));
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
      <div class="row between"><h3>${rule ? `${esc(rule.id)} ${esc(rule.이름)}` : '물질별 규정수량 표'} <span class="ai">AI 추출</span></h3>${st ? `<span class="pill ${st === '승인' ? 'green' : 'red'}">${st}</span>` : '<span class="pill orange">전문가 확인 대기</span>'}</div>
      <p class="muted" style="margin:0 0 8px">${esc(p.설명)}</p>
      <div class="kv"><b>변경 항목</b><span>${esc(p.항목)}</span><b>현행 값</b><span>${esc(p.현행)}</span><b>${p.종류 === '필수항목추가' ? '추가 항목' : '제안 값'}</b><span>${field}</span>
        <b>적용 시행일</b><span><input type="date" id="pd-${i}" value="${p.시행일}" ${st ? 'disabled' : ''}></span><b>근거 조문</b><span><code>${esc(p.근거)}</code></span>
        <b>승인자</b><span><select id="pa-${i}" ${st ? 'disabled' : ''}>${personOpts('김지훈')}</select></span><b>검토 의견</b><span><input type="text" id="pc-${i}" style="width:100%" placeholder="예: 개정 조문과 일치 확인" ${st ? 'disabled' : ''}></span></div>
      ${st ? '' : `<div class="row"><button class="btn green" data-ok="${i}">승인 · 지식에 반영</button><button class="btn ghost" data-no="${i}">반려</button></div>`}</div>`;
  }).join('') || '<p class="muted">규칙 변경 제안이 없습니다.</p>';
  renderEditor();
}
$('selN4').onchange = e => { cur = e.target.value; renderCmp(); };
$('propOut').onclick = e => {
  const n = N(), ok = e.target.dataset.ok, no = e.target.dataset.no;
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
  save(); K = knowledge(); renderCmp(); showYaml(a);
  toast(`승인 완료 — ${a.시행일}부터 새 규칙 버전으로 판정합니다`);
};

// ---- 지식 직접 편집
function renderEditor() {
  const opts = K.규칙.map(r => `<option value="${r.id}">${r.id} ${esc(r.이름)} (${r.유형})</option>`).join('') + '<option value="QTY">물질별 규정수량 표</option>';
  const prev = $('edRule').value;
  $('edRule').innerHTML = opts; if (prev) $('edRule').value = prev;
  const id = $('edRule').value, r = K.규칙.find(x => x.id === id);
  const v = r ? (r.버전.find(x => !x.폐지일) || r.버전[r.버전.length - 1]) : null;
  let body = '';
  if (id === 'QTY') body = `<div class="field"><span>물질</span><select id="edCas">${SITE.물질.map(m => `<option value="${m.CAS}">${esc(m.이름)} (현재 ${qtyAt(m, base()).하위} t)</option>`).join('')}</select></div><div class="field"><span>하위 규정수량 (t)</span><input type="number" id="edVal" value="10"></div>`;
  else if (r.유형 === '조건판정') body = `<div class="field"><span>제출 기한 (변경완료 예정일 기준 일수) · 최신 v${v.버전}: ${v.결과.기한.일수}</span><input type="number" id="edVal" value="${v.결과.기한.일수}"></div>`;
  else if (r.유형 === '체크리스트') body = `<div class="field"><span>필수 항목 (한 줄에 하나) · 최신 v${v.버전}</span><textarea id="edVal" style="min-height:150px">${esc(v.필수항목.join('\n'))}</textarea></div>`;
  else if (r.유형 === '결정표') body = `<div class="field"><span>결정표 (검사 주기 · 년) · 최신 v${v.버전}</span><table>${v.결정표.map((t, k) => `<tr><td>${t.사업장군} ${t.위험도 || ''}</td><td><input type="number" data-k="${k}" class="edRow" value="${t.주기_년}" style="width:70px"> 년</td></tr>`).join('')}<tr><td>연장 최대</td><td><input type="number" id="edExt" value="${v.연장.최대_년}" style="width:70px"> 년</td></tr></table></div>`;
  const cites = Object.keys(K.조문).map(x => `<option>${x}</option>`).join('');
  $('edForm').innerHTML = body + `<div class="row" style="align-items:flex-end"><label class="field"><span>시행일</span><input type="date" id="edDate" value="${base()}"></label>
    <label class="field"><span>근거 조문</span><select id="edCite"><option value="">(유지)</option>${cites}</select></label><label class="field"><span>승인자</span><select id="edBy">${personOpts('김지훈')}</select></label>
    <div class="field"><button class="btn blue" id="edBtn">새 버전으로 반영</button></div></div>`;
  $('edBtn').onclick = () => {
    const a = { notice: null, 규칙: id, 시행일: $('edDate').value, 근거: $('edCite').value || null, 승인자: $('edBy').value, 일시: nowStr(), 의견: '직접 편집' };
    if (id === 'QTY') Object.assign(a, { 종류: '수량기준', CAS: $('edCas').value, 값: Number($('edVal').value) });
    else if (r.유형 === '조건판정') Object.assign(a, { 종류: '기한일수', 값: Number($('edVal').value) });
    else if (r.유형 === '체크리스트') Object.assign(a, { 종류: '필수항목편집', 값: $('edVal').value.split('\n').map(s => s.trim()).filter(Boolean) });
    else Object.assign(a, { 종류: '결정표편집', 값: { 결정표: v.결정표.map((t, k) => ({ ...t, 주기_년: Number(document.querySelector(`.edRow[data-k="${k}"]`).value) })), 연장_최대: Number($('edExt').value) } });
    if (a.종류 !== '수량기준' && a.시행일 <= v.시행일) return toast(`시행일은 현재 버전 시행일(${v.시행일}) 이후여야 합니다`);
    S.approvals.push(a); log(`지식 직접 편집: ${id} 새 버전 (시행 ${a.시행일})`, a.승인자); save(); K = knowledge(); renderEditor(); showYaml(a); toast('새 규칙 버전을 만들었습니다');
  };
}
$('edRule').onchange = renderEditor;
$('nrDate').value = today;
$('nrCite').innerHTML = Object.keys(B.조문).map(x => `<option>${x}</option>`).join('');
$('nrBtn').onclick = () => {
  const name = $('nrName').value.trim(), items = $('nrItems').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!name || !items.length) return toast('규칙 이름과 점검 항목을 입력하세요');
  const id = `R-NEW-${S.approvals.filter(a => a.종류 === '새규칙').length + 1}`;
  const rule = { id, 이름: name, 유형: '체크리스트', 대상: '점검', 설명: '전문가가 직접 추가한 점검 규칙', 버전: [{ 버전: 1, 시행일: $('nrDate').value, 폐지일: null, 승인: '김지훈 승인 (직접 추가)', 근거: [$('nrCite').value], 필수항목: items, 결과: { 조치: '미충족 항목 보완' } }] };
  S.approvals.push({ notice: null, 규칙: id, 종류: '새규칙', 값: rule, 시행일: rule.버전[0].시행일, 승인자: '김지훈', 일시: nowStr() });
  log(`새 점검 규칙 추가: ${id} ${name} (${items.length}개 항목)`); save(); K = knowledge(); renderEditor(); showYaml({ 종류: '새규칙', 값: rule });
  $('nrName').value = ''; $('nrItems').value = ''; toast(`${id} 규칙을 추가했습니다 (⑥ 지식 기반에서 확인)`);
};
function toYaml(o, ind = '') {
  if (Array.isArray(o)) return o.map(x => typeof x === 'object' && x ? `${ind}- ${toYaml(x, ind + '  ').trimStart()}` : `${ind}- ${x}`).join('\n');
  return Object.entries(o).map(([k, v]) => v && typeof v === 'object' ? `${ind}${k}:\n${toYaml(v, ind + '  ')}` : `${ind}${k}: ${v ?? 'null'}`).join('\n');
}
function showYaml(a) {
  let y;
  if (a.종류 === '새규칙') y = `# rules/${a.값.id}.yaml (신규)\n` + toYaml(a.값);
  else if (a.종류 === '수량기준') y = `# data/knowledge/thresholds.yaml (행 추가)\n` + toYaml([{ CAS: a.CAS, 하위_규정수량_t: a.값, 시행일: a.시행일, 승인: a.승인자 }]);
  else if (a.종류 === '확인') y = '# 판정 값 변경 없음 — 근거 조문 버전만 갱신';
  else { const r = K.규칙.find(x => x.id === a.규칙); y = `# rules/${r.id}.yaml — '버전' 목록에 추가 (이전 버전은 폐지일 ${a.시행일}로 보존)\n버전:\n` + toYaml([r.버전[r.버전.length - 1]], '  '); }
  $('yamlOut').textContent = y; $('yamlBox').classList.remove('hidden');
}

// ================================================================ ⑤ 대시보드
function renderDash() {
  const raw = NOTICES.flatMap(n => (S.notices[n.id]?.tasks || []).map(t => ({ ...t, n })));
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
    const tr = S.notices[n.id]?.tasks || [], t = tr.filter(act), w = tr.filter(x => x.판단 === '확인 전').length, d = t.filter(x => x.상태 === '완료').length, p = t.filter(x => x.상태 === '진행 중').length;
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
  const own = {}; all.forEach(t => { own[t.담당자] ||= { a: 0, d: 0, o: 0, p: 0 }; const x = own[t.담당자]; x.a++; if (t.상태 === '완료') x.d++; else if (t.기한 < base()) x.o++; if (t.상태 === '진행 중') x.p++; });
  $('ownerTable').innerHTML = `<tr><th>담당자</th><th class="num">배정</th><th class="num">진행 중</th><th class="num">완료</th><th class="num">기한 경과</th><th style="width:30%">완료율</th></tr>` +
    PEOPLE.filter(p => own[p.이름]).map(p => { const x = own[p.이름]; return `<tr><td>${esc(p.이름)} <span class="muted">${esc(p.부서)}</span></td><td class="num">${x.a}</td><td class="num">${x.p}</td><td class="num">${x.d}</td><td class="num" style="${x.o ? 'color:var(--red);font-weight:700' : ''}">${x.o}</td><td><div class="prog"><span class="d" style="width:${x.d / x.a * 100}%"></span></div></td></tr>`; }).join('');
  const dues = [...over, ...soon].sort((a, b) => a.기한 < b.기한 ? -1 : 1).slice(0, 12);
  $('dueTable').innerHTML = `<tr><th>기한</th><th>조치</th><th>담당</th><th>상태</th></tr>` + (dues.map(t => `<tr class="${t.기한 < base() ? 'over' : ''}"><td><b>${t.기한}</b><br><span class="small" style="${t.기한 < base() ? 'color:var(--red);font-weight:700' : ''}">${dday(t.기한)}</span></td><td><b>${esc(t.대상)}</b><div class="muted">${esc(t.조치)} · ${t.n.id}</div></td><td>${esc(t.담당자)}</td><td>${taskPill(t.상태)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">30일 이내 마감 항목이 없습니다. 기준일을 바꿔 보세요.</td></tr>');
  $('logTable').innerHTML = `<tr><th>일시</th><th>처리자</th><th>내용</th></tr>` + S.log.slice(0, 25).map(l => `<tr><td class="small">${esc(l.t)}</td><td>${esc(l.who)}</td><td class="small">${esc(l.msg)}</td></tr>`).join('');
}
$('dashCards').onclick = e => { const c = e.target.closest('[data-n]'); if (!c) return; goNotice(c.dataset.n, 't3'); if (!S.notices[c.dataset.n]) runAnalysis(); };

// ================================================================ ⑥ 지식 기반·판정
const citeHtml = list => list.map(c => `<div class="cite"><b>${esc(c.조문)}</b> <span class="muted">(${esc(c.법령)}, 시행 ${esc(c.시행일)})</span><br>${esc(c.내용)}</div>`).join('');
const CHANGE = [['취급량_증가', '취급량 증가'], ['취급시설_용량_증가', '취급시설 용량 증가'], ['신규_취급시설', '새로운 취급시설 설치'], ['물질_변경_추가', '유해화학물질 변경·추가'],
  ['함량_농도_성상_변경', '함량·농도·성상 변경'], ['위험도_증가', '위 변경으로 위험 증가'], ['시설_위치_변경', '사업장 내 취급시설 위치 변경']];
$('facility').innerHTML = SITE.시설.map(f => `<option>${esc(f.이름)}</option>`).join('');
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
      <details><summary>근거 조문 원문 보기</summary>${citeHtml(r.근거)}</details></div>`;
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
       <details><summary>근거 조문</summary>${citeHtml(r.근거)}</details></div>`;
};
function renderKnowledge() {
  renderLabelChecks();
  if ($('judgeOut').innerHTML) runJudge();
  $('rulesOut').innerHTML = K.규칙.map(r => `<div class="result"><h3>${esc(r.id)} ${esc(r.이름)} <span class="pill gray">${esc(r.유형)}</span></h3><p class="muted" style="margin:0 0 6px">${esc(r.설명)}</p>
    <div class="scroll"><table><tr><th>버전</th><th>시행일</th><th>폐지일</th><th>상태</th><th>승인</th><th>근거 조문</th><th>핵심 값</th></tr>
    ${r.버전.map(v => { const act = activeVersion(r, base()) === v; return `<tr><td>v${v.버전}</td><td>${v.시행일}</td><td>${v.폐지일 || '-'}</td><td>${act ? '<span class="pill green">기준일 시행 중</span>' : v.시행일 > base() ? '<span class="pill orange">시행 예정</span>' : '<span class="pill gray">이력</span>'}</td><td class="small">${esc(v.승인)}</td><td class="small">${v.근거.join(', ')}</td>
      <td class="small">${v.결과?.기한 ? `기한 ${v.결과.기한.일수}일` : v.결정표 ? `결정표 ${v.결정표.map(t => t.주기_년).join('/')}년 · 연장 ${v.연장?.최대_년}년` : v.필수항목 ? `필수 ${v.필수항목.length}항목` : ''}</td></tr>`; }).join('')}</table></div></div>`).join('');
  $('qtyTable').innerHTML = `<tr><th>물질</th><th>CAS</th><th class="num">하위 (기본)</th><th>개정 이력</th><th class="num">기준일 적용 값</th></tr>` +
    SITE.물질.map(m => `<tr><td>${esc(m.이름)}</td><td>${m.CAS}</td><td class="num">${m.규정수량_하위_t} t</td><td class="small">${(K.수량[m.CAS] || []).map(x => `${x.시행일}부터 ${x.하위} t (${esc(x.승인)} 승인)`).join('<br>') || '-'}</td><td class="num"><b>${qtyAt(m, base()).하위} t</b></td></tr>`).join('');
  const arts = Object.values(K.조문).flat();
  $('lawTable').innerHTML = `<tr><th>ID</th><th>조문</th><th>제목</th><th>시행일</th><th>폐지일</th><th>해시</th><th>내용</th></tr>` +
    arts.map(a => `<tr><td>${a.id}</td><td>${esc(label(a))}</td><td>${esc(a.제목)}</td><td>${a.시행일}</td><td>${a.폐지일 || '-'}</td><td><code>${a.해시}</code></td><td class="small">${esc(a.내용)}</td></tr>`).join('');
  $('guideTable').innerHTML = `<tr><th>코드</th><th>지적 유형</th><th>연결 규칙</th><th>근거 조문</th><th>권고 조치</th></tr>` +
    K.가이드.map(g => `<tr><td>${g.코드}</td><td>${esc(g.지적유형)}</td><td>${g.규칙}</td><td>${g.근거.join(', ')}</td><td>${esc(g.권고조치)}</td></tr>`).join('');
  const results = K.정답셋.map(c => {
    let act;
    if (c.유형 === '변경판정') { const r = judgeChange(K, c.입력, c.기준일); act = { 규칙: r.map(x => x.규칙), 기한: r[0]?.기한 }; }
    else if (c.유형 === '정기검사') act = inspectionSchedule(K, { ...SITE, 시설: SITE.시설.filter(f => f.id === c.입력.시설) }, c.기준일)[0];
    else act = checkLabel(K, c.입력.항목, c.기준일);
    return { c, ok: Object.entries(c.기대).every(([k, v]) => JSON.stringify(v) === JSON.stringify(act[k])) };
  });
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
$('resetBtn').onclick = e => { e.preventDefault(); if (confirmBox('시연 데이터를 처음 상태로 되돌릴까요? (이 브라우저에 저장된 분석·승인·이력이 삭제됩니다)')) { seed(); K = knowledge(); render(); toast('시연 데이터를 초기화했습니다'); } };
render();
