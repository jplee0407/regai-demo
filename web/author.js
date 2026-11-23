// 화관법 규칙 저작 도구 (시연) — 조문 → AI 초안 → 규칙 작성 → 검증 → 검토·확정 → 패키지 배포
// 판정 엔진(engine.js)과 지식 묶음(bundle.json)은 시연 시스템과 공용. 저작 데이터는 이 브라우저 localStorage에만 저장.
import { evalCond, calcDue, label, activeVersion } from './engine.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const nowStr = () => new Date().toLocaleString('sv-SE').slice(0, 16);
const today = () => new Date().toISOString().slice(0, 10);
const B = await (await fetch('data/bundle.json', { cache: 'no-store' })).json();
const OBL = B.의무 || [];
const SUBS = OBL.flatMap(o => (o.세부 || []).map(s => ({ ...s, 상위: o })));
const oblName = c => { const s = SUBS.find(x => x.코드 === c); return s ? `${s.코드} ${s.이름}` : c || '미분류'; };
const PEOPLE = [...(B.본사?.담당자 || [])];
const AKEY = 'regai-author-v1', MAIN_KEY = 'regai-demo-v8';
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2800); }

// ---------------------------------------------------------------- 상태
let A;
function seedA() { A = { v: 1, rules: [], log: [], pkgs: [], seq: 0 }; saveA(); }
function saveA() { try { localStorage.setItem(AKEY, JSON.stringify(A)); } catch (e) { /* 저장 불가 */ } }
try { A = JSON.parse(localStorage.getItem(AKEY)); } catch (e) { A = null; }
if (!A || A.v !== 1) seedA();
const ME = () => $('who').value;
function logA(msg) { A.log.unshift({ t: nowStr(), who: ME(), msg }); if (A.log.length > 200) A.log.length = 200; }
$('who').innerHTML = PEOPLE.map(p => `<option>${esc(p.이름)}</option>`).join('') || '<option>김지훈</option>';
$('who').value = PEOPLE.find(p => p.이름 === '박정민') ? '박정민' : $('who').value;

// ---------------------------------------------------------------- 조문
const ART = Object.entries(B.조문).map(([id, vs]) => { const a = vs.find(x => !x.폐지일) || vs[vs.length - 1]; return { id, a, lab: label(a) }; });
const artLab = id => ART.find(x => x.id === id)?.lab || id;
const LAWS = [...new Set(ART.map(x => x.a.법령명))];
const lawMeta = n => (B.법령 || []).find(l => l.법령명 === n) || {};
const citeSel = (sid, cur = '') => `<select id="${sid}" style="max-width:260px"><option value="">근거 조문</option>${ART.map(x => `<option value="${x.id}" ${x.id === cur ? 'selected' : ''}>${esc(x.lab)} (${x.id})</option>`).join('')}</select>`;
const citeSelB = (bind, cur = '') => `<select data-b="${bind}" style="max-width:220px"><option value="">근거 조문</option>${ART.map(x => `<option value="${x.id}" ${x.id === cur ? 'selected' : ''}>${esc(x.lab)}</option>`).join('')}</select>`;
const oblSel = (bind, cur) => `<select data-b="${bind}">${OBL.map(o => `<optgroup label="${esc(o.코드 + ' ' + o.이름)}">${(o.세부 || []).map(s => `<option value="${s.코드}" ${s.코드 === cur ? 'selected' : ''}>${esc(s.코드 + ' ' + s.이름)}</option>`).join('')}</optgroup>`).join('')}</select>`;

// ---------------------------------------------------------------- 규칙 초안 모델
const TYPES = { 조건판정: 'P1 조건 → 의무 (+기한·제출처)', 기준표: 'P2 기준표·수치', 체크리스트: 'P4 필수 항목', 해석: 'P7 해석·판단 (텍스트)' };
const ST_CLR = { '작성 중': 'gray', '검토 요청': 'orange', '수정 요청': 'red', '확정': 'green', '반려': 'red', '배포됨': 'navy' };
function blank(type = '조건판정') {
  A.seq++;
  return { key: 'D' + A.seq, id: `R-NEW-${String(A.seq).padStart(3, '0')}`, base: null, 이름: '', 설명: '', 유형: type, 의무분류: 'C02-3', 연관분류: [], 출처고시: '', 시행일: today(), 근거: [],
    조건: { mode: 'any', 항목: [] }, 결과: { 조치: '', 제출처: '', 서식: '', 기한: { 기준필드: '', 일수: '', 개월: '', 년: '', 근거: '' } },
    필수항목: [], 표: { 열: [{ 이름: '구분', 종류: '조건' }, { 이름: '결과', 종류: '결과' }], 행: [] },
    해석: { 구분: '컨설턴트 판단', 제목: '', 질의: '', 판단: '', 출처: '', 신뢰수준: '내부', 관련조문: [], 적용규칙: [], 적용방법: '' },
    쟁점: [], 사례: [], 상태: '작성 중', AI: false, 작성자: ME(), 검토자: '', 이력: [{ t: nowStr(), who: ME(), 상태: '작성 중', 의견: '새로 작성' }] };
}
const D = () => A.rules.find(r => r.key === UI.sel);
// 초안 → 저장소 규칙 형식
function toRule(d) {
  const base = d.base ? B.규칙.find(r => r.id === d.base) : null;
  const v = { 버전: base ? Math.max(...base.버전.map(x => x.버전)) + 1 : 1, 시행일: d.시행일, 폐지일: null, 승인: d.상태 === '확정' || d.상태 === '배포됨' ? `${d.검토자} 확정 (${(d.확정일 || today()).slice(0, 10)})` : `검토 대기 (${d.AI ? 'AI 초안' : '작성'})`,
    근거: [...new Set([...d.근거, ...d.조건.항목.map(c => c.근거), d.결과.기한?.근거, ...d.필수항목.map(i => i.근거), ...d.표.행.map(r => r._근거)].filter(Boolean))],
    검토: { 작성: d.작성자, 작성일: d.이력[0]?.t?.slice(0, 10), 상태: d.상태 === '배포됨' ? '확정' : d.상태, 요약: d.설명, 쟁점: d.쟁점.map(x => x.t), 사례: d.사례.map(c => ({ 설명: c.설명, 입력: c.입력, 기대: c.기대 })) } };
  if (d.유형 === '조건판정') {
    v.조건 = { [d.조건.mode]: d.조건.항목.map(c => ({ 필드: c.필드, 같음: true, 설명: c.설명, 근거: c.근거 || undefined })) };
    const k = d.결과.기한, due = k.기준필드 ? Object.fromEntries(Object.entries({ 기준필드: k.기준필드, 일수: num(k.일수), 개월: num(k.개월), 년: num(k.년), 근거: k.근거 || undefined }).filter(([, x]) => x !== undefined && x !== null && x !== '')) : undefined;
    v.결과 = Object.fromEntries(Object.entries({ 조치: d.결과.조치, 제출처: d.결과.제출처, 서식: d.결과.서식, 기한: due }).filter(([, x]) => x));
  }
  if (d.유형 === '체크리스트') { v.필수항목 = d.필수항목.map(i => i.이름); v.결과 = { 조치: d.결과.조치 || '미충족 항목 보완' }; }
  if (d.유형 === '기준표') { v.열 = d.표.열; v.행 = d.표.행.map(r => { const { _근거, ...rest } = r; return rest; }); v.결과 = { 조치: d.결과.조치 }; }
  return { id: d.id, 이름: d.이름, 유형: d.유형, 의무분류: d.의무분류, 연관분류: d.연관분류, 대상: '저작도구', 설명: d.설명, ...(d.출처고시 ? { 출처고시: d.출처고시 } : {}), 버전: [v] };
}
function toInt(d) { return { id: d.id.replace(/^R-/, 'I-'), ...d.해석, 확인자: d.검토자 || d.작성자, 상태: d.상태 === '확정' || d.상태 === '배포됨' ? '유효' : '검토 중', 일자: today(), 관련조문: d.해석.관련조문.length ? d.해석.관련조문 : d.근거 }; }
const num = x => x === '' || x == null ? undefined : Number(x);
function toYaml(o, ind = '') {
  if (Array.isArray(o)) return o.length ? o.map(x => typeof x === 'object' && x ? `${ind}- ${toYaml(x, ind + '  ').trimStart()}` : `${ind}- ${x}`).join('\n') : `${ind}[]`;
  return Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => v && typeof v === 'object' ? (Array.isArray(v) && !v.length ? `${ind}${k}: []` : `${ind}${k}:\n${toYaml(v, ind + '  ')}`) : `${ind}${k}: ${v ?? 'null'}`).join('\n');
}
// 기존 확정 규칙 불러오기 → 새 버전 초안
function fromRule(r) {
  const d = blank(r.유형 === '체크리스트' ? '체크리스트' : '조건판정'); const v = r.버전.find(x => !x.폐지일) || r.버전[r.버전.length - 1];
  Object.assign(d, { id: r.id, base: r.id, 이름: r.이름, 설명: r.설명, 의무분류: r.의무분류 || 'C02-3', 연관분류: r.연관분류 || [], 출처고시: r.출처고시 || '', 근거: [...(v.근거 || [])], 시행일: v.시행일 > today() ? v.시행일 : today() });
  if (r.유형 === '조건판정') { const mode = v.조건.any ? 'any' : 'all'; d.조건 = { mode, 항목: v.조건[mode].flatMap(c => c.all ? c.all : [c]).map(c => ({ 필드: c.필드, 설명: c.설명, 근거: c.근거 || '' })) }; const k = v.결과.기한 || {}; d.결과 = { 조치: v.결과.조치, 제출처: v.결과.제출처 || '', 서식: v.결과.서식 || '', 기한: { 기준필드: k.기준필드 || '', 일수: k.일수 ?? '', 개월: k.개월 ?? '', 년: k.년 ?? '', 근거: k.근거 || '' } }; }
  if (r.유형 === '체크리스트') { d.필수항목 = v.필수항목.map(n => ({ 이름: n, 근거: v.근거[0] || '' })); d.결과.조치 = v.결과?.조치 || ''; }
  d.사례 = (v.검토?.사례 || []).map(c => ({ ...c }));
  if (!d.사례.length) autoCases(d);
  d.이력 = [{ t: nowStr(), who: ME(), 상태: '작성 중', 의견: `${r.id} v${v.버전} 불러옴` }];
  return d;
}

// ---------------------------------------------------------------- AI 초안 (조문 → 규칙)
const slug = t => t.replace(/「[^」]*」/g, '').replace(/(규칙|법|영|시행규칙)?\s*(별표\s*\d+(\s*비고\s*제\s*\d+\s*호)?|제\s*\d+\s*조(의\d+)?(제\s*\d+\s*항)?(제\s*\d+\s*호)?)\s*(에\s*따른|에\s*따라|의)?/g, '').replace(/\([^)]*\)/g, '').replace(/[「」『』"'.,·ㆍ]/g, ' ').trim().split(/\s+/).slice(0, 4).join('_').replace(/[^가-힣A-Za-z0-9_]/g, '').slice(0, 24) || '조건';
const OBL_KW = [[/변경.*(계획서|제출)|변경된 화학사고/, 'C02-3'], [/계획서.*(신규|제출)|화학사고예방관리계획서/, 'C02-2'], [/재제출|5년/, 'C02-2'], [/규정수량|최대보유량/, 'C01-2'], [/표시|그림문자|신호어/, 'C06-3'], [/정기검사/, 'C04-2'], [/수시검사/, 'C04-3'], [/설치검사/, 'C04-1'], [/안전진단/, 'C04-4'], [/영업허가|변경허가/, 'C03-4'], [/교육/, 'C08-3'], [/관리자/, 'C08-1'], [/즉시.*신고|화학사고.*신고/, 'C10-3'], [/자체점검/, 'C05-2'], [/운반/, 'C06-4'], [/보호구|보호장구/, 'C07-1'], [/통계조사/, 'C09-2'], [/배출량/, 'C09-3']];
function heuristicDraft(ids) {
  const arts = ids.map(id => ART.find(x => x.id === id)).filter(Boolean);
  const text = arts.map(x => x.a.내용).join('\n'), first = arts[0];
  const d = blank(); d.AI = true; d.근거 = [...ids];
  d.출처고시 = first ? `${first.a.법령명}${lawMeta(first.a.법령명).공포번호 ? ' (' + lawMeta(first.a.법령명).공포번호 + ')' : ''}` : '';
  // 항목 (1. 2. 3.)
  const parts = text.split(/\s(?=\d{1,2}\.\s)/).slice(1).map(s => s.replace(/^\d{1,2}\.\s*/, '').replace(/\s+/g, ' ').trim()).filter(s => s.length > 3);
  const inl = text.match(/에\s+([^.。]+?)(?:이|가)\s*포함/), inlItems = inl ? inl[1].split(/\s*,\s*/).map(x => x.trim()).filter(x => x && x.length < 20) : [];
  const isCheck = (/표시|기재|포함하여야|다음 사항/.test(text) && parts.length >= 2 && !/경우/.test(parts.join(' '))) || inlItems.length >= 3;
  d.유형 = isCheck ? '체크리스트' : '조건판정';
  // 기한
  let m;
  const k = d.결과.기한;
  const rcv = text.match(/([가-힣]+)\s*([가-힣]+)?(?:을|를)\s*받은\s*날(?:로)?부터\s*(\d+)\s*(일|개월|년)/);
  if (rcv) { k.기준필드 = [rcv[1], rcv[2]].filter(Boolean).join('_') + '일'; k[{ 일: '일수', 개월: '개월', 년: '년' }[rcv[4]]] = Number(rcv[3]); }
  else if ((m = text.match(/([가-힣ㆍ·\s]{2,24}?일)\s*(\d+)\s*일\s*(이전|전)/))) { const tk = m[1].trim().split(/\s+/); k.기준필드 = (tk.at(-1).length >= 3 ? [tk.at(-1)] : tk.slice(-2)).join('_'); k.일수 = -Number(m[2]); }
  else if ((m = text.match(/(\d+)\s*일\s*이내/))) { k.기준필드 = '기준일'; k.일수 = Number(m[1]); }
  else if ((m = text.match(/(\d+)\s*개월\s*이내/))) { k.기준필드 = '기준일'; k.개월 = Number(m[1]); }
  else if ((m = text.match(/(\d+)\s*년(마다|이\s*지나|\s*이내)?/))) { k.기준필드 = '기준일'; k.년 = Number(m[1]); }
  if (k.기준필드) k.근거 = ids.find(id => /\d+\s*(일|개월|년)/.test(ART.find(x => x.id === id)?.a.내용 || '')) || ids[0];
  if ((m = text.match(/([가-힣]+(?:원장|장관|청장|시장|군수|구청장|도지사|지사))에게/))) d.결과.제출처 = m[1];
  if ((m = text.match(/별지\s*제\s*\d+\s*호\s*서식/))) d.결과.서식 = m[0].replace(/\s+/g, '');
  if ((m = text.match(/([가-힣ㆍ·]+(?:를|을)\s*[가-힣ㆍ·\s]{0,20}?(?:제출|신고|수검|교육|표시|선임|보완))(?:해야|하여야)/))) d.결과.조치 = m[1].replace(/\s+/g, ' ');
  else if ((m = text.match(/([가-힣]+(?:제출|신고|허가|검사|교육|표시))/))) d.결과.조치 = m[1];
  if (isCheck && inlItems.length >= 3) { d.필수항목 = inlItems.map(p => ({ 이름: p, 근거: ids[0] })); }
  else if (isCheck) { d.필수항목 = parts.map(p => ({ 이름: p.replace(/[.。]$/, '').slice(0, 40), 근거: ids[0] })); }
  else {
    const conds = parts.length ? parts : [((text.match(/([^.。]{4,80}?)\s*경우/) || [])[1] || (first?.a.제목 || '해당 요건')).replace(/^.*?\)\s*/, '')];
    const seen = {}; d.조건.항목 = conds.slice(0, 8).map(t => { let f = slug(t); seen[f] = (seen[f] || 0) + 1; if (seen[f] > 1) f += '_' + seen[f]; return { 필드: f, 설명: t.length > 60 ? t.slice(0, 58) + '…' : t, 근거: ids[0] }; });
  }
  d.이름 = (first?.a.제목 ? first.a.제목 : '규칙') + (d.결과.조치 && !first?.a.제목?.includes(d.결과.조치) ? ` — ${d.결과.조치}` : '');
  d.설명 = `${first ? first.lab : ''} 원문에서 추출한 ${TYPES[d.유형].split(' ')[0]} 초안`;
  const hit = OBL_KW.find(([re]) => re.test(text)); if (hit) d.의무분류 = hit[1];
  d.쟁점 = [{ t: 'AI가 원문에서 자동 추출한 초안 — 조건·항목 문구와 필드명을 원문과 대조', ok: false }];
  if (k.기준필드) d.쟁점.push({ t: `기한 기준일 '${k.기준필드}'과 일수·개월·년 값이 원문과 맞는지 확인`, ok: false });
  if (/"[^"]+"\s*이?란|이란\s/.test(text)) d.쟁점.push({ t: '용어 정의 조문 — 판정 규칙보다 분류·기준 데이터(P5)나 해석으로 두는 것이 맞는지 확인', ok: false });
  if (/규칙\s*제\d+조|법\s*제\d+조|별표/.test(text)) d.쟁점.push({ t: '다른 조문·별표를 인용함 — 인용 조문도 근거로 연결할지 확인', ok: false });
  autoCases(d);
  return d;
}
function autoCases(d) {
  if (d.유형 === '조건판정' && d.조건.항목.length) {
    const k = d.결과.기한, f0 = d.조건.항목[0].필드, inp = { [f0]: true };
    if (k.기준필드) inp[k.기준필드] = '2027-03-31';
    const due = k.기준필드 ? calcDue({ 기준필드: k.기준필드, 일수: num(k.일수), 개월: num(k.개월), 년: num(k.년) }, inp) : undefined;
    d.사례 = [{ 설명: `${d.조건.항목[0].설명.slice(0, 20)} → 대상`, 입력: inp, 기대: due ? { 대상: true, 기한: due } : { 대상: true } },
      { 설명: '해당 조건 없음 → 대상 아님', 입력: k.기준필드 ? { [k.기준필드]: '2027-03-31' } : {}, 기대: { 대상: false } }];
  } else if (d.유형 === '체크리스트' && d.필수항목.length) {
    d.사례 = [{ 설명: '모든 항목 있음 → 누락 0', 입력: { 항목: d.필수항목.map(i => i.이름) }, 기대: { 누락: 0 } },
      { 설명: '첫 항목 없음 → 누락 1', 입력: { 항목: d.필수항목.slice(1).map(i => i.이름) }, 기대: { 누락: 1 } }];
  }
}
// 생성형 AI (시연 화면 'AI 설정'과 같은 설정 사용)
function aiCfg() { try { return JSON.parse(localStorage.getItem('regai-ai')) || {}; } catch (e) { return {}; } }
const aiOn = () => { const c = aiCfg(); return c.종류 && c.종류 !== '지식' && (c.종류 === '사내' ? !!c.주소 : !!c.키); };
async function llm(system, user) {
  const c = aiCfg();
  if (c.종류 === 'Claude') {
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': c.키, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: c.모델 || 'claude-sonnet-4-5', max_tokens: 2500, system, messages: [{ role: 'user', content: user }] }) });
    const j = await res.json(); if (!res.ok) throw new Error(j.error?.message || res.status); return j.content.map(b => b.text || '').join('');
  }
  const url = c.주소.replace(/\/$/, '') + (/\/chat\/completions$/.test(c.주소) ? '' : '/v1/chat/completions');
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(c.키 ? { authorization: `Bearer ${c.키}` } : {}) }, body: JSON.stringify({ model: c.모델 || 'default', temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
  const j = await res.json(); if (!res.ok) throw new Error(j.error?.message || res.status); return j.choices[0].message.content;
}
async function aiDraft(ids) {
  const base = heuristicDraft(ids);
  if (!aiOn()) return base;
  const sys = `너는 화학물질관리법 규칙 작성 전문가다. 주어진 조문만 근거로 판정 규칙 초안을 JSON 하나로만 답한다(설명 문장, 코드펜스 금지).
스키마: {"유형":"조건판정|체크리스트","이름":"","설명":"","의무분류":"코드","조건":{"mode":"any|all","항목":[{"필드":"영문자·한글_밑줄","설명":"","근거":"조문ID"}]},"결과":{"조치":"","제출처":"","서식":"","기한":{"기준필드":"","일수":null,"개월":null,"년":null,"근거":"조문ID"}},"필수항목":[{"이름":"","근거":"조문ID"}],"쟁점":["원문에 없는 기준·애매한 점"]}
규칙: 원문에 없는 수치는 넣지 않고 쟁점에 적는다. 기한 일수는 '~일 이전'이면 음수. 의무분류는 다음 중 하나: ${SUBS.map(s => s.코드 + ' ' + s.이름).join(', ')}`;
  const user = ids.map(id => { const x = ART.find(y => y.id === id); return `[${id}] ${x.lab} (${x.a.법령명})\n${x.a.내용}`; }).join('\n\n');
  try {
    const raw = await llm(sys, user), j = JSON.parse(raw.replace(/^```(json)?|```$/gm, '').trim());
    const d = base; Object.assign(d, { 유형: j.유형 === '체크리스트' ? '체크리스트' : '조건판정', 이름: j.이름 || d.이름, 설명: j.설명 || d.설명, 의무분류: SUBS.some(s => s.코드 === j.의무분류) ? j.의무분류 : d.의무분류 });
    if (j.조건?.항목?.length) d.조건 = { mode: j.조건.mode === 'all' ? 'all' : 'any', 항목: j.조건.항목.map(c => ({ 필드: c.필드 || slug(c.설명 || ''), 설명: c.설명 || '', 근거: ids.includes(c.근거) ? c.근거 : ids[0] })) };
    if (j.결과) { const k = j.결과.기한 || {}; d.결과 = { 조치: j.결과.조치 || '', 제출처: j.결과.제출처 || '', 서식: j.결과.서식 || '', 기한: { 기준필드: k.기준필드 || '', 일수: k.일수 ?? '', 개월: k.개월 ?? '', 년: k.년 ?? '', 근거: ids.includes(k.근거) ? k.근거 : (k.기준필드 ? ids[0] : '') } }; }
    if (j.필수항목?.length) d.필수항목 = j.필수항목.map(i => ({ 이름: i.이름, 근거: ids.includes(i.근거) ? i.근거 : ids[0] }));
    d.쟁점 = [{ t: '생성형 AI 초안 — 원문과 대조 필요', ok: false }, ...(j.쟁점 || []).map(t => ({ t, ok: false }))];
    autoCases(d); d.AI = 'LLM'; return d;
  } catch (err) { toast('생성형 AI 응답을 쓰지 못해 규칙 기반 추출로 초안을 만들었습니다: ' + String(err.message || err).slice(0, 60)); return base; }
}

// ---------------------------------------------------------------- 검증 (초안 그대로 엔진 실행)
function runCase(d, c) {
  let act = {};
  if (d.유형 === '조건판정') {
    const r = toRule(d), v = r.버전[0], res = v.조건 ? evalCond(v.조건, c.입력 || {}) : { ok: false };
    act = res.ok ? { 대상: true, 기한: v.결과.기한 ? calcDue(v.결과.기한, c.입력 || {}) : undefined } : { 대상: false };
  } else if (d.유형 === '체크리스트') {
    const have = (c.입력?.항목 || []).map(s => s.replace(/\s/g, ''));
    act = { 누락: d.필수항목.filter(i => !have.includes(i.이름.replace(/\s/g, ''))).length };
  } else if (d.유형 === '기준표') {
    const conds = d.표.열.filter(x => x.종류 === '조건'), outs = d.표.열.filter(x => x.종류 === '결과');
    const row = d.표.행.find(r => conds.every(cl => !r[cl.이름] || r[cl.이름] === '*' || r[cl.이름] === '기타' || String(r[cl.이름]) === String(c.입력?.[cl.이름] ?? '')));
    act = row ? Object.fromEntries(outs.map(o => [o.이름, row[o.이름]])) : { 결과: '해당 행 없음' };
  }
  const ok = Object.entries(c.기대 || {}).every(([k, v]) => String(v) === String(act[k]));
  return { act, ok };
}

// ---------------------------------------------------------------- 화면
const UI = { tab: 'a1', sel: null, art: null, artSel: [], q: '', law: '' };
function showTab(t) { UI.tab = t; document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t)); ['a1', 'a2', 'a3', 'a4', 'a5'].forEach(x => $(x).classList.toggle('hidden', x !== t)); render(); window.scrollTo({ top: 0 }); }
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.t));
const pill = s => `<span class="pill ${ST_CLR[s] || 'gray'}">${esc(s)}</span>`;
const kpi = (v, l, a) => `<div class="kpi ${a ? 'alert' : ''}"><div class="v">${v}</div><div class="l">${l}</div></div>`;

// ① 지식 현황
function renderA1() {
  const cnt = s => A.rules.filter(r => r.상태 === s).length;
  const covered = c => [...B.규칙.filter(r => r.의무분류 === c).map(r => r.id), ...A.rules.filter(r => r.유형 !== '해석' && r.의무분류 === c && ['확정', '배포됨'].includes(r.상태)).map(r => r.id)];
  const drafts = c => A.rules.filter(r => r.의무분류 === c && !['확정', '배포됨', '반려'].includes(r.상태));
  const subsCov = SUBS.filter(s => covered(s.코드).length).length;
  $('a1').innerHTML = `<div class="grid6">${kpi(`${subsCov}/${SUBS.length}`, '규칙이 있는 세부 업무')}${kpi(cnt('작성 중'), '작성 중')}${kpi(cnt('검토 요청'), '검토 요청', cnt('검토 요청'))}${kpi(cnt('수정 요청'), '수정 요청', cnt('수정 요청'))}${kpi(cnt('확정'), '확정 (배포 대기)', cnt('확정'))}${kpi(cnt('배포됨'), '배포됨')}</div>
    <div class="card"><div class="row between"><div><h2 style="margin:0">의무별 지식 현황</h2><p class="desc" style="margin:2px 0 0">판정형 세부 업무에 규칙이 없으면 빨간색 · 작성 중인 초안을 누르면 ③에서 열림</p></div><button class="btn blue" data-go="a2">조문에서 규칙 만들기 →</button></div>
      <div class="scroll"><table><tr><th>의무</th><th>세부 업무</th><th>유형</th><th>규칙 (기존·확정)</th><th>작성 중 초안</th></tr>${OBL.map(o => (o.세부 || []).map((s, i) => { const cv = covered(s.코드), dr = drafts(s.코드);
        return `<tr>${i === 0 ? `<td rowspan="${o.세부.length}" style="vertical-align:top"><b>${esc(o.코드)}</b><br><span class="small">${esc(o.이름)}</span></td>` : ''}<td class="small"><b>${esc(s.코드)}</b> ${esc(s.이름)}</td><td class="small">${esc(s.유형 || '')}</td>
          <td class="small">${cv.length ? cv.map(esc).join(', ') : `<span style="color:${s.유형 === '판정형' ? 'var(--red)' : 'var(--sub)'}">없음</span>`}</td><td class="small">${dr.map(r => `<a href="#" data-open="${r.key}">${esc(r.id)}</a> ${pill(r.상태)}`).join(' ') || '-'}</td></tr>`; }).join('')).join('')}</table></div></div>
    <div class="card"><h2>작업 이력</h2>${A.log.slice(0, 15).map(l => `<div class="small">${esc(l.t)} · ${esc(l.who)} · ${esc(l.msg)}</div>`).join('') || '<p class="muted small">아직 없습니다.</p>'}</div>`;
}

// ② 조문
function renderA2() {
  const q = UI.q.trim(), list = ART.filter(x => (!UI.law || x.a.법령명 === UI.law) && (!q || (x.lab + x.a.제목 + x.a.내용).includes(q)));
  const cur = UI.art && ART.find(x => x.id === UI.art);
  const usedBy = id => [...B.규칙.filter(r => r.버전.some(v => (v.근거 || []).includes(id) || JSON.stringify(v).includes(`"${id}"`))).map(r => r.id), ...A.rules.filter(r => toRule(r).버전[0].근거.includes(id)).map(r => r.id + '(초안)')];
  $('a2').innerHTML = `<div class="card"><div class="row between"><div><h2 style="margin:0">조문</h2><p class="desc" style="margin:2px 0 0">조문을 고르고 'AI 규칙 초안'을 누르면 원문에서 조건·기한·제출처·항목을 뽑아 초안을 만듭니다 ${aiOn() ? '· <b>생성형 AI 연결됨</b>' : '· 생성형 AI 미연결 (규칙 기반 추출)'}</p></div>
      <div class="row"><select id="lawSel"><option value="">전체 법령·고시</option>${LAWS.map(n => `<option ${n === UI.law ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select><input type="text" id="artQ" value="${esc(UI.q)}" placeholder="검색 (예: 60일, 표시, 재제출)" style="width:220px"></div></div>
    <div class="grid2" style="grid-template-columns:340px 1fr;margin-top:12px"><div style="max-height:720px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:8px">
      ${LAWS.filter(n => list.some(x => x.a.법령명 === n)).map(n => { const m = lawMeta(n); return `<div class="kxh">${esc(n)}<div class="small" style="font-weight:400;color:var(--sub)">${esc(m.공포번호 || '')}${m.공포일 ? ' · 공포 ' + esc(m.공포일) : ''}</div></div>` + list.filter(x => x.a.법령명 === n).map(x => `<div class="kxi ${UI.art === x.id ? 'on' : ''}" data-art="${x.id}"><input type="checkbox" data-pick="${x.id}" ${UI.artSel.includes(x.id) ? 'checked' : ''} title="초안에 함께 쓸 조문 선택"><div style="flex:1"><b class="small">${esc(x.lab)}</b><div class="muted small">${esc(x.a.제목 || '')}</div></div>${usedBy(x.id).length ? `<span class="pill green" style="font-size:10.5px;white-space:nowrap;align-self:center">규칙 ${usedBy(x.id).length}</span>` : ''}</div>`).join(''); }).join('') || '<p class="muted small">검색 결과가 없습니다.</p>'}</div>
      <div>${cur ? `<div class="result" style="background:#fff"><div class="row between"><h3 style="margin:0">${esc(cur.lab)} <span class="muted small">${esc(cur.a.제목 || '')}</span></h3><code>${esc(cur.id)}</code></div>
        <div class="small muted" style="margin:4px 0 8px">${esc(cur.a.법령명)} · 시행 ${esc(cur.a.시행일)}</div><div class="arttext">${esc(cur.a.내용)}</div>
        <div class="kv" style="margin-top:10px"><b>이 조문을 쓰는 규칙</b><span>${usedBy(cur.id).map(esc).join(', ') || '<span style="color:var(--red)">없음 — 규칙화 대상</span>'}</span></div></div>` : '<p class="muted">왼쪽에서 조문을 고르세요.</p>'}
        <div class="result" style="background:#fff;border-color:var(--blue)"><h3>AI 규칙 초안 만들기</h3><p class="small" style="margin:0 0 8px">선택한 조문 ${UI.artSel.length || (cur ? 1 : 0)}개: ${(UI.artSel.length ? UI.artSel : cur ? [cur.id] : []).map(id => `<span class="chip">${esc(artLab(id))}</span>`).join('') || '-'}</p>
          <div class="row"><button class="btn blue" id="draftBtn" ${UI.artSel.length || cur ? '' : 'disabled'}>✨ AI 규칙 초안</button><button class="btn ghost" id="blankBtn">빈 규칙으로 시작</button><select id="loadRule"><option value="">기존 규칙 불러와 새 버전 작성</option>${B.규칙.filter(r => ['조건판정', '체크리스트'].includes(r.유형)).map(r => `<option value="${r.id}">${esc(r.id + ' ' + r.이름)}</option>`).join('')}</select></div></div></div></div></div>`;
}

// ③ 규칙 작성
function listHtml(filter) {
  const xs = A.rules.filter(filter);
  return xs.map(r => `<div class="kxi ${UI.sel === r.key ? 'on' : ''}" data-open="${r.key}"><i style="background:var(--${r.상태 === '확정' || r.상태 === '배포됨' ? 'green' : r.상태 === '검토 요청' ? 'orange' : 'blue'})"></i><div style="flex:1"><div class="row between"><b class="small">${esc(r.id)}</b>${pill(r.상태)}</div><div class="small">${esc(r.이름 || '(이름 없음)')}</div><div class="muted small">${esc(r.유형)} · ${esc(r.의무분류)}${r.base ? ' · 새 버전' : ''}${r.AI ? ' · AI 초안' : ''}</div></div></div>`).join('') || '<p class="muted small">초안이 없습니다. ② 조문에서 AI 초안을 만들거나 빈 규칙으로 시작하세요.</p>';
}
function renderA3() {
  if (!D() || !['작성 중', '수정 요청'].includes(D().상태)) { const f = A.rules.find(r => ['작성 중', '수정 요청'].includes(r.상태)); UI.sel = f ? f.key : (D() ? UI.sel : null); }
  const d = D();
  $('a3').innerHTML = `<div class="card"><div class="row between"><div><h2 style="margin:0">규칙 작성</h2><p class="desc" style="margin:2px 0 0">패턴을 고르면 그 패턴의 입력 폼이 나옵니다 · 값마다 근거 조문 · 검증 사례 통과 후 검토 요청</p></div><div class="row"><button class="btn ghost sm" id="newBlank">+ 빈 규칙</button><button class="btn blue sm" data-go="a2">+ 조문에서 AI 초안</button></div></div>
    <div class="grid2" style="grid-template-columns:280px 1fr;margin-top:12px"><div style="max-height:900px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:8px">${listHtml(r => r.상태 !== '배포됨')}</div><div id="ed">${d ? editorHtml(d) : '<p class="muted">초안을 고르거나 새로 만드세요.</p>'}</div></div></div>`;
}
const inp = (b, v, w = 260, ph = '') => `<input type="text" data-b="${b}" value="${esc(v ?? '')}" placeholder="${esc(ph)}" style="width:${w}px">`;
function editorHtml(d) {
  const ro = !['작성 중', '수정 요청'].includes(d.상태);
  const cases = d.사례.map(c => ({ c, ...runCase(d, c) })), pass = cases.filter(x => x.ok).length;
  const ruleOrInt = d.유형 === '해석' ? toInt(d) : toRule(d);
  let body = '';
  if (d.유형 === '조건판정') {
    body = `<div class="result" style="background:#fff"><div class="row between"><h3 style="margin:0"><span class="step"><b>IF</b></span> 조건</h3><span class="small">${['any', 'all'].map(m => `<label><input type="radio" name="mode" data-mode="${m}" ${d.조건.mode === m ? 'checked' : ''}> ${m === 'any' ? '하나라도 해당' : '모두 해당'}</label>`).join(' ')}</span></div>
      <div class="condrow small muted"><span>조건 (화면에 보이는 문구)</span><span>필드명 (입력 데이터 키)</span><span>근거 조문</span><span></span></div>
      ${d.조건.항목.map((c, i) => `<div class="condrow"><input type="text" data-b="조건.항목.${i}.설명" value="${esc(c.설명)}"><input type="text" data-b="조건.항목.${i}.필드" value="${esc(c.필드)}">${citeSelB(`조건.항목.${i}.근거`, c.근거)}<a href="#" data-del="조건.항목.${i}" style="color:var(--red)">✕</a></div>`).join('')}
      <button class="btn ghost sm" data-add="cond">+ 조건 추가</button></div>
    <div class="result" style="background:#fff"><h3><span class="step"><b>→</b></span> THEN 결과</h3><div class="kv"><b>조치</b><span>${inp('결과.조치', d.결과.조치, 380, '예: 변경된 계획서 제출')}</span><b>제출처</b><span>${inp('결과.제출처', d.결과.제출처, 220, '예: 화학물질안전원장')}</span><b>서식</b><span>${inp('결과.서식', d.결과.서식, 220, '예: 별지 제32호서식')}</span>
      <b>기한</b><span class="row" style="gap:6px">${inp('결과.기한.기준필드', d.결과.기한.기준필드, 160, '기준일 필드 (예: 변경완료_예정일)')} <input type="number" data-b="결과.기한.일수" value="${esc(d.결과.기한.일수)}" placeholder="일" style="width:70px">일 <input type="number" data-b="결과.기한.개월" value="${esc(d.결과.기한.개월)}" style="width:60px">개월 <input type="number" data-b="결과.기한.년" value="${esc(d.결과.기한.년)}" style="width:60px">년 ${citeSelB('결과.기한.근거', d.결과.기한.근거)}</span></div>
      <p class="small muted" style="margin:4px 0 0">음수 = 기준일 이전 (예: -30 = 30일 전) · 기한이 없으면 기준필드를 비워 둡니다</p></div>`;
  } else if (d.유형 === '체크리스트') {
    body = `<div class="result" style="background:#fff"><h3>필수 항목 ${d.필수항목.length}개</h3>${d.필수항목.map((it, i) => `<div class="condrow" style="grid-template-columns:1fr 220px 30px"><input type="text" data-b="필수항목.${i}.이름" value="${esc(it.이름)}">${citeSelB(`필수항목.${i}.근거`, it.근거)}<a href="#" data-del="필수항목.${i}" style="color:var(--red)">✕</a></div>`).join('')}
      <button class="btn ghost sm" data-add="item">+ 항목 추가</button><div class="kv" style="margin-top:8px"><b>미충족 시 조치</b><span>${inp('결과.조치', d.결과.조치, 360, '예: 누락 항목 보완')}</span></div></div>`;
  } else if (d.유형 === '기준표') {
    const cols = d.표.열;
    body = `<div class="result" style="background:#fff"><h3>기준표 <span class="muted small">— 위에서부터 처음 맞는 행 적용 · 빈칸·'*'·'기타' = 모두</span></h3>
      <div class="row small" style="margin-bottom:6px">${cols.map((c, j) => `<span class="chip"><input type="text" data-b="표.열.${j}.이름" value="${esc(c.이름)}" style="width:100px"><select data-b="표.열.${j}.종류"><option ${c.종류 === '조건' ? 'selected' : ''}>조건</option><option ${c.종류 === '결과' ? 'selected' : ''}>결과</option></select><a href="#" data-del="표.열.${j}" style="color:var(--red)">✕</a></span>`).join('')}<button class="btn ghost sm" data-add="col">+ 열</button></div>
      <table><tr>${cols.map(c => `<th>${esc(c.이름)} <span class="small" style="font-weight:400">(${esc(c.종류)})</span></th>`).join('')}<th>근거</th><th></th></tr>${d.표.행.map((r, i) => `<tr>${cols.map(c => `<td><input type="text" data-b="표.행.${i}.${c.이름}" value="${esc(r[c.이름] ?? '')}" style="width:100%"></td>`).join('')}<td>${citeSelB(`표.행.${i}._근거`, r._근거)}</td><td><a href="#" data-del="표.행.${i}" style="color:var(--red)">✕</a></td></tr>`).join('')}</table>
      <button class="btn ghost sm" data-add="row">+ 행 추가</button><div class="kv" style="margin-top:8px"><b>조치</b><span>${inp('결과.조치', d.결과.조치, 360, '예: 정기검사 수검')}</span></div></div>`;
  } else {
    const h = d.해석;
    body = `<div class="result" style="background:#fff"><h3>해석·판단</h3><div class="kv"><b>구분</b><span><select data-b="해석.구분">${['유권해석', '질의회신', '컨설턴트 판단', '판례·심판', '내부 기준'].map(x => `<option ${x === h.구분 ? 'selected' : ''}>${x}</option>`).join('')}</select> <select data-b="해석.신뢰수준">${['공식', '내부'].map(x => `<option ${x === h.신뢰수준 ? 'selected' : ''}>${x}</option>`).join('')}</select></span>
      <b>제목</b><span>${inp('해석.제목', h.제목, 420)}</span><b>질의</b><span><textarea data-b="해석.질의" style="width:100%;min-height:50px">${esc(h.질의)}</textarea></span><b>판단</b><span><textarea data-b="해석.판단" style="width:100%;min-height:60px">${esc(h.판단)}</textarea></span>
      <b>출처</b><span>${inp('해석.출처', h.출처, 420, '기관·일자·문서번호')}</span><b>적용 규칙</b><span>${inp('해석.적용규칙', h.적용규칙.join(', '), 260, 'R-23-3, ...')}</span><b>적용 방법</b><span>${inp('해석.적용방법', h.적용방법, 420, '판정에서 어떻게 쓰는지 한 줄')}</span></div></div>`;
  }
  const caseForm = d.유형 === '조건판정' ? `<div class="row small" style="margin-top:6px;align-items:flex-end">${d.조건.항목.map(c => `<label><input type="checkbox" data-cf="${esc(c.필드)}"> ${esc(c.설명.slice(0, 14))}</label>`).join('')}${d.결과.기한.기준필드 ? `<label>${esc(d.결과.기한.기준필드)} <input type="date" id="cfDate" value="2027-03-31"></label>` : ''}<label>기대 <select id="cfExp"><option value="1">대상</option><option value="0">대상 아님</option></select></label><button class="btn ghost sm" data-add="case">+ 사례 추가 (기대 기한은 자동 계산)</button></div>`
    : d.유형 === '체크리스트' ? `<div class="row small" style="margin-top:6px"><label>빠진 항목 수 <input type="number" id="cfMiss" value="1" min="0" style="width:60px"></label><button class="btn ghost sm" data-add="case">+ 사례 추가</button></div>`
    : d.유형 === '기준표' ? `<div class="row small" style="margin-top:6px">${d.표.열.filter(c => c.종류 === '조건').map(c => `<label>${esc(c.이름)} <input type="text" data-cfin="${esc(c.이름)}" style="width:80px"></label>`).join('')}${d.표.열.filter(c => c.종류 === '결과').map(c => `<label>기대 ${esc(c.이름)} <input type="text" data-cfout="${esc(c.이름)}" style="width:70px"></label>`).join('')}<button class="btn ghost sm" data-add="case">+ 사례 추가</button></div>` : '';
  return `<fieldset ${ro ? 'disabled' : ''} style="border:0;padding:0;margin:0">
    <div class="result ${d.AI ? 'hit' : ''}" style="${d.AI ? '' : 'background:#fff'}"><div class="row between"><h3 style="margin:0">${esc(d.id)} ${pill(d.상태)} ${d.AI ? `<span class="ai">${d.AI === 'LLM' ? '생성형 AI 초안' : 'AI 추출 초안'}</span>` : ''} ${d.base ? `<span class="pill navy">${esc(d.base)} 새 버전</span>` : ''}</h3><span class="row"><button class="btn green sm" data-act="save">저장</button><button class="btn blue sm" data-act="request" ${(d.유형 === '해석' ? d.이름 && d.해석.제목 && d.해석.판단 : pass === cases.length && cases.length && d.이름) ? '' : `disabled title="${d.유형 === '해석' ? '이름·제목·판단 입력이 필요합니다' : '이름 입력과 검증 사례 통과가 필요합니다'}"`}>검토 요청 →</button><button class="btn ghost sm" data-act="delete" style="color:var(--red)">삭제</button></span></div>
      <div class="kv" style="margin-top:8px"><b>패턴</b><span><select data-b="유형" ${d.base ? 'disabled' : ''}>${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${k === d.유형 ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></span>
        <b>ID · 이름</b><span>${inp('id', d.id, 140)} ${inp('이름', d.이름, 380, '판정하는 내용을 한 줄로')}</span><b>설명</b><span>${inp('설명', d.설명, 520)}</span>
        <b>의무 (세부 업무)</b><span>${oblSel('의무분류', d.의무분류)}</span><b>시행일</b><span><input type="date" data-b="시행일" value="${esc(d.시행일)}"> <span class="small muted">${esc(d.출처고시 || '')}</span></span>
        <b>근거 조문</b><span><div class="chips">${d.근거.map(id => `<span class="chip"><b>${esc(artLab(id))}</b> <a href="#" data-delcite="${id}" style="color:var(--red)">✕</a></span>`).join('')}${citeSel('addCite')}<button class="btn ghost sm" data-add="cite">연결</button></div></span></div></div>
    ${d.근거.length ? `<details style="margin:6px 0"><summary class="small">근거 원문 보기 (${d.근거.length})</summary>${d.근거.map(id => { const x = ART.find(y => y.id === id); return x ? `<div class="cite"><b>${esc(x.lab)}</b> <span class="muted small">${esc(x.a.법령명)}</span><br>${esc(x.a.내용)}</div>` : ''; }).join('')}</details>` : ''}
    ${body}
    <div class="result" style="background:#fff"><h3>쟁점 · 확인할 점 <span class="muted small">(확정 전 검토자가 모두 체크)</span></h3>${d.쟁점.map((x, i) => `<div class="condrow" style="grid-template-columns:1fr 30px"><input type="text" data-b="쟁점.${i}.t" value="${esc(x.t)}"><a href="#" data-del="쟁점.${i}" style="color:var(--red)">✕</a></div>`).join('') || '<p class="muted small">없음</p>'}<button class="btn ghost sm" data-add="issue">+ 쟁점</button></div>
    ${d.유형 !== '해석' ? `<div class="result" style="background:#fff"><h3>검증 사례 <span class="pill ${pass === cases.length && cases.length ? 'green' : 'red'}">${pass}/${cases.length} 통과</span></h3>
      ${cases.length ? `<table><tr><th>사례</th><th>입력</th><th>기대</th><th>실제 (엔진)</th><th></th></tr>${cases.map(({ c, act, ok }, i) => `<tr><td class="small">${esc(c.설명)}</td><td class="small"><code>${esc(JSON.stringify(c.입력))}</code></td><td class="small">${esc(JSON.stringify(c.기대))}</td><td class="small"><span class="pill ${ok ? 'green' : 'red'}">${ok ? '통과' : '불일치'}</span> ${esc(JSON.stringify(act))}</td><td><a href="#" data-del="사례.${i}" style="color:var(--red)">✕</a></td></tr>`).join('')}</table>` : '<p class="muted small">사례가 없습니다. 아래에서 추가하세요.</p>'}${caseForm}${cases.some(x => !x.ok) && ['조건판정', '체크리스트'].includes(d.유형) ? `<div class="small" style="margin-top:6px;color:var(--red)">기대값이 지금 규칙과 다릅니다 — 규칙을 의도대로 고쳤다면 <a href="#" data-act="recase">사례 기대값 다시 만들기</a></div>` : ''}</div>` : ''}
    </fieldset>
    <details><summary class="small">저장소에 들어갈 형태 (YAML)</summary><pre style="max-height:360px;overflow:auto">${esc(`# ${d.유형 === '해석' ? 'data/knowledge/interpretations.yaml (항목 추가)' : `rules/${d.id}.yaml${d.base ? ' (새 버전)' : ' (신규)'}`}\n` + toYaml(ruleOrInt))}</pre></details>
    <details><summary class="small">이력 ${d.이력.length}건</summary>${d.이력.map(h => `<div class="small">${esc(h.t)} · ${esc(h.who)} · <b>${esc(h.상태)}</b> ${esc(h.의견 || '')}</div>`).join('')}</details>`;
}
function setPath(o, p, v) { const ks = p.split('.'); let x = o; ks.slice(0, -1).forEach(k => { x = x[k]; }); x[ks.at(-1)] = v; }
function getPath(o, p) { return p.split('.').reduce((x, k) => x?.[k], o); }
$('a3').addEventListener('change', e => {
  const d = D(); if (!d) return; const t = e.target;
  if (t.dataset.b) { let v = t.value; if (t.dataset.b === '해석.적용규칙') v = v.split(',').map(s => s.trim()).filter(Boolean); setPath(d, t.dataset.b, v); if (t.dataset.b === '유형') { autoCases(d); } saveA(); return renderA3(); }
  if (t.dataset.mode) { d.조건.mode = t.dataset.mode; saveA(); return renderA3(); }
});
$('a3').addEventListener('click', e => {
  const o = e.target.closest('[data-open]'); if (o) { e.preventDefault(); UI.sel = o.dataset.open; return renderA3(); }
  const g = e.target.closest('[data-go]'); if (g) return showTab(g.dataset.go);
  if (e.target.id === 'newBlank') { const d = blank(); A.rules.unshift(d); UI.sel = d.key; logA(`빈 규칙 ${d.id} 생성`); saveA(); return renderA3(); }
  const d = D(); if (!d) return;
  const del = e.target.closest('[data-del]'); if (del) { e.preventDefault(); const p = del.dataset.del.split('.'), idx = +p.pop(), arr = getPath(d, p.join('.')); const rm = arr.splice(idx, 1)[0]; if (p.join('.') === '표.열') d.표.행.forEach(r => delete r[rm.이름]); saveA(); return renderA3(); }
  const dc = e.target.closest('[data-delcite]'); if (dc) { e.preventDefault(); d.근거 = d.근거.filter(x => x !== dc.dataset.delcite); saveA(); return renderA3(); }
  const add = e.target.closest('[data-add]'); if (add) {
    const k = add.dataset.add;
    if (k === 'cond') d.조건.항목.push({ 필드: `조건_${d.조건.항목.length + 1}`, 설명: '', 근거: d.근거[0] || '' });
    if (k === 'item') d.필수항목.push({ 이름: '', 근거: d.근거[0] || '' });
    if (k === 'col') d.표.열.push({ 이름: `열${d.표.열.length + 1}`, 종류: '조건' });
    if (k === 'row') d.표.행.push({});
    if (k === 'issue') d.쟁점.push({ t: '', ok: false });
    if (k === 'cite') { const c = $('addCite').value; if (!c) return toast('연결할 조문을 고르세요'); if (d.근거.includes(c)) return toast('이미 연결된 조문입니다'); d.근거.push(c); }
    if (k === 'case') {
      if (d.유형 === '조건판정') {
        const inpv = {}; document.querySelectorAll('[data-cf]').forEach(c => { if (c.checked) inpv[c.dataset.cf] = true; });
        if (d.결과.기한.기준필드 && $('cfDate')) inpv[d.결과.기한.기준필드] = $('cfDate').value;
        const exp = $('cfExp').value === '1'; const kk = d.결과.기한;
        const due = exp && kk.기준필드 ? calcDue({ 기준필드: kk.기준필드, 일수: num(kk.일수), 개월: num(kk.개월), 년: num(kk.년) }, inpv) : undefined;
        const names = d.조건.항목.filter(c => inpv[c.필드]).map(c => c.설명.slice(0, 12));
        d.사례.push({ 설명: `${names.join('+') || '조건 없음'} → ${exp ? '대상' : '대상 아님'}`, 입력: inpv, 기대: exp ? (due ? { 대상: true, 기한: due } : { 대상: true }) : { 대상: false } });
      } else if (d.유형 === '체크리스트') { const n = Math.max(0, Math.min(d.필수항목.length, +$('cfMiss').value || 0)); d.사례.push({ 설명: `${n}개 항목 누락`, 입력: { 항목: d.필수항목.slice(n).map(i => i.이름) }, 기대: { 누락: n } }); }
      else if (d.유형 === '기준표') { const i0 = {}, o0 = {}; document.querySelectorAll('[data-cfin]').forEach(x => { if (x.value) i0[x.dataset.cfin] = x.value; }); document.querySelectorAll('[data-cfout]').forEach(x => { if (x.value) o0[x.dataset.cfout] = x.value; }); if (!Object.keys(o0).length) return toast('기대 결과를 입력하세요'); d.사례.push({ 설명: Object.values(i0).join('·') + ' → ' + Object.values(o0).join('·'), 입력: i0, 기대: o0 }); }
    }
    saveA(); return renderA3();
  }
  const act = e.target.closest('[data-act]'); if (!act) return;
  if (act.dataset.act === 'recase') { e.preventDefault(); autoCases(d); d.이력.unshift({ t: nowStr(), who: ME(), 상태: d.상태, 의견: '검증 사례 기대값 재생성' }); saveA(); return renderA3(); }
  if (act.dataset.act === 'save') { d.이력.unshift({ t: nowStr(), who: ME(), 상태: d.상태, 의견: '저장' }); logA(`${d.id} 저장`); saveA(); toast('저장했습니다'); return renderA3(); }
  if (act.dataset.act === 'delete') { if (!confirm(`${d.id} 초안을 삭제할까요?`)) return; A.rules = A.rules.filter(r => r !== d); logA(`${d.id} 삭제`); UI.sel = null; saveA(); return renderA3(); }
  if (act.dataset.act === 'request') {
    if (B.규칙.some(r => r.id === d.id) && d.base !== d.id) return toast(`${d.id}는 이미 있는 규칙 ID입니다. 다른 ID를 쓰세요`);
    d.상태 = '검토 요청'; d.작성자 = ME(); d.이력.unshift({ t: nowStr(), who: ME(), 상태: '검토 요청', 의견: '' }); logA(`${d.id} 검토 요청`); saveA(); toast('검토 요청했습니다 — ④ 검토·확정에서 다른 사용자가 확정합니다'); UI.rsel = d.key; return renderA3();
  }
});

// ② 이벤트
$('a2').addEventListener('click', async e => {
  const g = e.target.closest('[data-go]'); if (g) return showTab(g.dataset.go);
  const pk = e.target.closest('[data-pick]'); if (pk) { const id = pk.dataset.pick; UI.artSel = pk.checked ? [...new Set([...UI.artSel, id])] : UI.artSel.filter(x => x !== id); return renderA2(); }
  const a = e.target.closest('[data-art]'); if (a) { UI.art = a.dataset.art; return renderA2(); }
  if (e.target.id === 'draftBtn') {
    const ids = UI.artSel.length ? UI.artSel : [UI.art]; e.target.disabled = true; e.target.textContent = aiOn() ? '생성형 AI가 초안을 쓰는 중…' : '원문에서 추출 중…';
    const d = await aiDraft(ids); A.rules.unshift(d); UI.sel = d.key; UI.artSel = []; logA(`${ids.map(artLab).join(', ')} → AI 초안 ${d.id}`); saveA(); toast(`${d.id} 초안을 만들었습니다 — 원문과 대조해 고치세요`); return showTab('a3');
  }
  if (e.target.id === 'blankBtn') { const d = blank(); if (UI.art) d.근거 = [UI.art]; A.rules.unshift(d); UI.sel = d.key; saveA(); return showTab('a3'); }
});
$('a2').addEventListener('change', e => {
  if (e.target.id === 'lawSel') { UI.law = e.target.value; return renderA2(); }
  if (e.target.id === 'loadRule' && e.target.value) { const r = B.규칙.find(x => x.id === e.target.value); const d = fromRule(r); A.rules.unshift(d); UI.sel = d.key; logA(`${r.id} 불러와 새 버전 작성`); saveA(); return showTab('a3'); }
});
$('a2').addEventListener('input', e => { if (e.target.id === 'artQ') { UI.q = e.target.value; const pos = e.target.selectionStart; renderA2(); const q = $('artQ'); q.focus(); q.setSelectionRange(pos, pos); } });
$('a1').addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) return showTab(g.dataset.go); const o = e.target.closest('[data-open]'); if (o) { e.preventDefault(); UI.sel = o.dataset.open; showTab(['검토 요청'].includes(D()?.상태) ? 'a4' : 'a3'); } });

// ④ 검토·확정
function renderA4() {
  const q = A.rules.filter(r => r.상태 === '검토 요청');
  if (!q.some(r => r.key === UI.rsel)) UI.rsel = q[0]?.key || null;
  const d = A.rules.find(r => r.key === UI.rsel);
  let det = '<p class="muted">검토 요청된 규칙이 없습니다.</p>';
  if (d) {
    const cases = d.사례.map(c => ({ c, ...runCase(d, c) })), pass = cases.filter(x => x.ok).length, allIss = d.쟁점.every(x => x.ok), self = d.작성자 === ME();
    const r = d.유형 === '해석' ? toInt(d) : toRule(d), v = r.버전?.[0];
    det = `<div class="result" style="background:#fff"><div class="row between"><h3 style="margin:0">${esc(d.id)} ${esc(d.이름)} ${pill(d.상태)} ${d.base ? `<span class="pill navy">${esc(d.base)} 새 버전</span>` : ''}</h3><span class="small muted">작성 ${esc(d.작성자)}</span></div>
        <div class="kv" style="margin-top:6px"><b>패턴</b><span>${esc(TYPES[d.유형])}</span><b>의무</b><span>${esc(oblName(d.의무분류))}</span><b>시행일</b><span>${esc(d.시행일)}</span><b>설명</b><span>${esc(d.설명)}</span></div></div>
      ${d.유형 === '조건판정' ? `<div class="result" style="background:#fff"><h3>IF ${d.조건.mode === 'any' ? '하나라도' : '모두'}</h3><ul style="margin:0">${d.조건.항목.map(c => `<li>${esc(c.설명)} <code class="small">${esc(c.필드)}</code> <span class="small muted">${esc(artLab(c.근거))}</span></li>`).join('')}</ul><h3 style="margin-top:8px">THEN</h3><p class="small" style="margin:0">${esc(d.결과.조치)} · ${esc(d.결과.제출처)} · ${esc(d.결과.서식)}${v?.결과?.기한 ? ` · 기한: ${esc(v.결과.기한.기준필드)} ${[v.결과.기한.년 && v.결과.기한.년 + '년', v.결과.기한.개월 && v.결과.기한.개월 + '개월', v.결과.기한.일수 && v.결과.기한.일수 + '일'].filter(Boolean).join(' ')}` : ''}</p></div>` : ''}
      ${d.유형 === '체크리스트' ? `<div class="result" style="background:#fff"><h3>필수 항목 ${d.필수항목.length}개</h3><div class="chips">${d.필수항목.map((i, k) => `<span class="chip">${k + 1}. ${esc(i.이름)}</span>`).join('')}</div></div>` : ''}
      ${d.유형 === '기준표' ? `<div class="result" style="background:#fff"><h3>기준표</h3><table><tr>${d.표.열.map(c => `<th>${esc(c.이름)}</th>`).join('')}</tr>${d.표.행.map(rw => `<tr>${d.표.열.map(c => `<td>${esc(rw[c.이름] ?? '')}</td>`).join('')}</tr>`).join('')}</table></div>` : ''}
      ${d.유형 === '해석' ? `<div class="result" style="background:#fff"><h3>${esc(d.해석.구분)}: ${esc(d.해석.제목)}</h3><p class="small">${esc(d.해석.판단)}</p><p class="small muted">${esc(d.해석.출처)} · 적용: ${esc(d.해석.적용방법)}</p></div>` : ''}
      <div class="result" style="background:#fff"><h3>근거 원문</h3>${(r.버전 ? v.근거 : r.관련조문).map(id => { const x = ART.find(y => y.id === id); return x ? `<div class="cite"><b>${esc(x.lab)}</b> <span class="muted small">${esc(x.a.법령명)}</span><br>${esc(x.a.내용)}</div>` : ''; }).join('') || '<p class="muted small">없음</p>'}</div>
      <div class="result ${allIss ? '' : 'hit'}" style="${allIss ? 'background:#fff' : ''}"><h3>쟁점 확인 ${d.쟁점.filter(x => x.ok).length}/${d.쟁점.length}</h3>${d.쟁점.map((x, i) => `<label class="chk"><input type="checkbox" data-iss="${i}" ${x.ok ? 'checked' : ''}> ${esc(x.t)}</label>`).join('') || '<p class="muted small">없음</p>'}</div>
      ${d.유형 !== '해석' ? `<div class="result" style="background:#fff"><h3>검증 사례 <span class="pill ${pass === cases.length ? 'green' : 'red'}">${pass}/${cases.length} 통과</span></h3>${cases.map(({ c, act, ok }) => `<div class="small"><span class="pill ${ok ? 'green' : 'red'}">${ok ? '통과' : '불일치'}</span> ${esc(c.설명)} — 기대 ${esc(JSON.stringify(c.기대))} / 실제 ${esc(JSON.stringify(act))}</div>`).join('')}</div>` : ''}
      <div class="result" style="background:#fff;border-color:var(--blue)"><h3>검토 의견</h3>${self ? '<p class="small" style="color:var(--red)">작성자와 검토자는 달라야 합니다 — 오른쪽 위에서 사용자를 바꾸세요.</p>' : ''}
        <input type="text" id="rvMemo" style="width:100%" placeholder="예: 원문과 일치 확인 / 수정 요청 사유">
        <div class="row" style="margin-top:8px"><button class="btn green" data-rv="ok" ${!self && allIss && pass === cases.length ? '' : 'disabled title="쟁점 확인·사례 통과·작성자와 다른 검토자가 필요합니다"'}>✔ 확정</button><button class="btn orange" data-rv="fix" ${self ? 'disabled' : ''}>수정 요청</button><button class="btn ghost" data-rv="no" style="color:var(--red)" ${self ? 'disabled' : ''}>반려</button></div></div>`;
  }
  $('a4').innerHTML = `<div class="card"><h2 style="margin:0">검토·확정</h2><p class="desc" style="margin:2px 0 0">작성자와 다른 검토자가 원문 대조 · 쟁점 확인 · 사례 통과 후 확정 · 확정한 규칙은 ⑤ 배포로 넘어갑니다</p>
    <div class="grid2" style="grid-template-columns:280px 1fr;margin-top:12px"><div style="border:1px solid var(--line);border-radius:10px;padding:8px">${q.map(r => `<div class="kxi ${UI.rsel === r.key ? 'on' : ''}" data-rsel="${r.key}"><i style="background:var(--orange)"></i><div style="flex:1"><b class="small">${esc(r.id)}</b><div class="small">${esc(r.이름)}</div><div class="muted small">${esc(r.작성자)} · ${esc(r.이력[0]?.t || '')}</div></div></div>`).join('') || '<p class="muted small">대기 없음</p>'}</div><div>${det}</div></div></div>`;
}
$('a4').addEventListener('click', e => {
  const s = e.target.closest('[data-rsel]'); if (s) { UI.rsel = s.dataset.rsel; return renderA4(); }
  const b = e.target.closest('[data-rv]'); if (!b) return;
  const d = A.rules.find(r => r.key === UI.rsel), memo = $('rvMemo').value.trim(), act = b.dataset.rv;
  if (act !== 'ok' && !memo) return toast('수정 요청·반려 사유를 입력하세요');
  d.상태 = act === 'ok' ? '확정' : act === 'fix' ? '수정 요청' : '반려'; d.검토자 = ME(); if (act === 'ok') d.확정일 = nowStr();
  d.이력.unshift({ t: nowStr(), who: ME(), 상태: d.상태, 의견: memo }); logA(`${d.id} ${d.상태}${memo ? ' — ' + memo : ''}`); saveA();
  toast(act === 'ok' ? `${d.id} 확정 — ⑤ 배포에서 패키지로 내보낼 수 있습니다` : `${d.id} ${d.상태}`); render();
});
$('a4').addEventListener('change', e => { const i = e.target.dataset.iss; if (i === undefined) return; const d = A.rules.find(r => r.key === UI.rsel); d.쟁점[+i].ok = e.target.checked; saveA(); renderA4(); });

// ⑤ 배포
function nextVer() { const d = new Date(); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}-${String(A.pkgs.length + 1).padStart(3, '0')}`; }
function renderA5() {
  const ready = A.rules.filter(r => r.상태 === '확정');
  $('a5').innerHTML = `<div class="card"><h2 style="margin:0">배포 — 규칙 패키지</h2><p class="desc" style="margin:2px 0 0">확정한 규칙만 묶어 버전 번호를 붙여 내보냅니다 · 고객사 시스템은 패키지를 받아 적용 (폐쇄망은 파일 전달)</p>
    ${ready.length ? `<table style="margin-top:10px"><tr><th>ID</th><th>이름</th><th>구분</th><th>의무</th><th>시행일</th><th>작성 · 확정</th></tr>${ready.map(r => `<tr><td><b>${esc(r.id)}</b></td><td>${esc(r.이름)}</td><td>${r.유형 === '해석' ? '해석 추가' : r.base ? `새 버전 (${esc(r.base)})` : '신규 규칙'}</td><td class="small">${esc(oblName(r.의무분류))}</td><td>${esc(r.시행일)}</td><td class="small">${esc(r.작성자)} → ${esc(r.검토자)}</td></tr>`).join('')}</table>
      <div class="row" style="margin-top:10px;align-items:flex-end"><label class="field"><span>패키지 버전</span><input type="text" id="pkgVer" value="${nextVer()}" style="width:140px"></label><label class="field" style="flex:1"><span>변경 요약</span><input type="text" id="pkgNote" style="width:100%" placeholder="예: 작성규정 제10조 신규 제출 규칙 추가"></label></div>
      <div class="row" style="margin-top:8px"><button class="btn blue" id="pkgDl">📦 패키지 내보내기 (JSON)</button><button class="btn green" id="pkgApply">시연 시스템에 배포 (이 브라우저)</button></div>` : '<p class="muted" style="margin-top:10px">배포할 확정 규칙이 없습니다.</p>'}</div>
    <div class="card"><h2>배포 이력</h2>${A.pkgs.length ? `<table><tr><th>버전</th><th>일시</th><th>배포자</th><th>규칙</th><th>방식</th><th>요약</th></tr>${A.pkgs.map(p => `<tr><td><b>${esc(p.버전)}</b></td><td>${esc(p.일시)}</td><td>${esc(p.배포자)}</td><td class="small">${esc(p.규칙.join(', '))}</td><td>${esc(p.방식)}</td><td class="small">${esc(p.요약)}</td></tr>`).join('')}</table>` : '<p class="muted small">아직 없습니다.</p>'}</div>`;
}
function buildPkg() {
  const ready = A.rules.filter(r => r.상태 === '확정');
  return { 패키지: 'regai-화관법-규칙', 버전: $('pkgVer').value, 생성: nowStr(), 배포자: ME(), 요약: $('pkgNote').value, 엔진호환: 'engine.js v1',
    규칙: ready.filter(r => r.유형 !== '해석').map(r => ({ 구분: r.base ? '새버전' : '신규', 규칙: toRule(r) })), 해석: ready.filter(r => r.유형 === '해석').map(toInt) };
}
function markDeployed(pkg, how) { const ids = [...pkg.규칙.map(x => x.규칙.id), ...pkg.해석.map(x => x.id)]; A.rules.filter(r => r.상태 === '확정').forEach(r => { r.상태 = '배포됨'; r.이력.unshift({ t: nowStr(), who: ME(), 상태: '배포됨', 의견: `패키지 ${pkg.버전}` }); }); A.pkgs.unshift({ 버전: pkg.버전, 일시: nowStr(), 배포자: ME(), 규칙: ids, 방식: how, 요약: pkg.요약 }); logA(`패키지 ${pkg.버전} ${how} (${ids.length}건)`); saveA(); }
$('a5').addEventListener('click', e => {
  if (e.target.id === 'pkgDl') { const pkg = buildPkg(); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' })); a.download = `regai-rules-${pkg.버전}.json`; a.click(); markDeployed(pkg, '파일 내보내기'); toast(`패키지 ${pkg.버전}을 내보냈습니다`); return render(); }
  if (e.target.id === 'pkgApply') {
    let S; try { S = JSON.parse(localStorage.getItem(MAIN_KEY)); } catch (err) { S = null; }
    if (!S) return toast('시연 화면을 이 브라우저에서 한 번 연 뒤 다시 배포하세요');
    const pkg = buildPkg(), t = nowStr();
    pkg.규칙.forEach(({ 구분, 규칙 }) => {
      const v = 규칙.버전[0];
      if (구분 === '신규') S.approvals.push({ notice: null, 규칙: 규칙.id, 종류: '새규칙', 값: 규칙, 시행일: v.시행일, 승인자: ME(), 일시: t, 의견: `규칙 저작 도구 패키지 ${pkg.버전}` });
      else S.approvals.push({ notice: null, 규칙: 규칙.id, 종류: '버전교체', 값: { 이름: 규칙.이름, 설명: 규칙.설명, 버전: v }, 시행일: v.시행일, 승인자: ME(), 일시: t, 의견: `규칙 저작 도구 패키지 ${pkg.버전}` });
      S.review ||= {}; const d = A.rules.find(r => r.id === 규칙.id && r.상태 === '확정');
      S.review[규칙.id] = { 상태: '확정', 검토자: d?.검토자 || ME(), 의견: `저작 도구 확정 · 패키지 ${pkg.버전}`, 일시: t, 체크: Object.fromEntries((v.검토?.쟁점 || []).map((_, i) => [i, true])), 이력: [{ t, who: ME(), 상태: '확정', 의견: `패키지 ${pkg.버전} 배포` }] };
    });
    pkg.해석.forEach(x => S.approvals.push({ notice: null, 종류: '해석편집', 값: x, 시행일: today(), 승인자: ME(), 일시: t }));
    S.log.unshift({ t, who: ME(), msg: `규칙 패키지 ${pkg.버전} 배포: ${[...pkg.규칙.map(x => x.규칙.id), ...pkg.해석.map(x => x.id)].join(', ')}` });
    try { localStorage.setItem(MAIN_KEY, JSON.stringify(S)); } catch (err) { return toast('시연 화면 저장소에 쓰지 못했습니다'); }
    markDeployed(pkg, '시연 시스템 배포'); toast(`패키지 ${pkg.버전} 배포 완료 — 시연 화면 ② 지식·규칙 관리에서 확인하세요`); return render();
  }
});

// ---------------------------------------------------------------- 공통
function render() {
  ({ a1: renderA1, a2: renderA2, a3: renderA3, a4: renderA4, a5: renderA5 })[UI.tab]();
  const n = s => A.rules.filter(r => r.상태 === s).length;
  [['d3', n('작성 중') + n('수정 요청')], ['d4', n('검토 요청')], ['d5', n('확정')]].forEach(([id, c]) => { $(id).textContent = c; $(id).classList.toggle('hidden', !c); });
}
$('who').onchange = () => render();
$('resetA').onclick = e => { e.preventDefault(); if (confirm('저작 도구의 초안·이력·배포 기록을 모두 지울까요? (시연 화면 데이터는 그대로)')) { seedA(); UI.sel = null; render(); toast('초기화했습니다'); } };
render();
