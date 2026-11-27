// 판정 엔진 (브라우저·Node 공용, 외부 의존성 없음)
// 원칙: 법정 의무 판정은 규칙(결정표)으로만 수행하고, 모든 결과에 규칙 버전과 근거 조문을 붙인다.

export function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function addYears(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

const inForce = (v, date) => v.시행일 <= date && (!v.폐지일 || date < v.폐지일);

// 기준일에 시행 중인 규칙 버전
export function activeVersion(rule, date) {
  return rule.버전.find(v => inForce(v, date)) || null;
}

// 기준일에 시행 중인 조문 (같은 id의 여러 버전 중)
export function article(bundle, id, date) {
  const list = bundle.조문[id] || [];
  return list.find(a => inForce(a, date)) || list[list.length - 1] || null;
}

// 조건식 평가: {any:[...]}, {all:[...]}, {필드, 같음}
export function evalCond(cond, input) {
  if (cond.any) {
    const parts = cond.any.map(c => evalCond(c, input));
    return { ok: parts.some(p => p.ok), matched: parts.filter(p => p.ok).flatMap(p => p.matched) };
  }
  if (cond.all) {
    const parts = cond.all.map(c => evalCond(c, input));
    const ok = parts.every(p => p.ok);
    return { ok, matched: ok ? parts.flatMap(p => p.matched) : [] };
  }
  const ok = input[cond.필드] === cond.같음;
  return { ok, matched: ok ? [{ 설명: cond.설명, 근거: cond.근거, 필드: cond.필드, ...(cond.판단 ? { 판단: cond.판단 } : {}) }] : [] };
}
// 판단 질문형 조건 중 아직 답(확정값)이 없는 것
export function pendingJudgements(cond, input, out = []) {
  if (!cond) return out;
  if (cond.any) cond.any.forEach(c => pendingJudgements(c, input, out));
  else if (cond.all) cond.all.forEach(c => pendingJudgements(c, input, out));
  else if (cond.판단 && input[cond.필드] === undefined) out.push(cond);
  return out;
}

function cite(bundle, ids, date) {
  return [...new Set(ids)].map(id => {
    const a = article(bundle, id, date);
    return a ? { id, 법령: a.법령명, 조문: label(a), 내용: a.내용, 시행일: a.시행일 } : { id, 조문: id, 내용: '(조문 없음)' };
  });
}

export function label(a) {
  const short = a.약칭 || (a.법령명.includes('시행규칙') ? '시행규칙' : a.법령명.includes('시행령') ? '시행령' : '법');
  if (!a.조) return `${short} ${a.제목}`;
  return `${short} 제${a.조}조` + (a.항 ? `제${a.항}항` : '') + (a.호 ? `제${a.호}호` : '');
}

export function addMonths(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
// 기한 계산: {기준필드, 일수?, 개월?, 년?}
export function calcDue(spec, input) {
  const b = input[spec.기준필드];
  if (!b) return null;
  let d = b;
  if (spec.년) d = addYears(d, spec.년);
  if (spec.개월) d = addMonths(d, spec.개월);
  if (spec.일수) d = addDays(d, spec.일수);
  return d;
}
const dueText = s => [s.년 && `${s.년 > 0 ? '+' : ''}${s.년}년`, s.개월 && `${s.개월 > 0 ? '+' : ''}${s.개월}개월`, s.일수 && `${s.일수 > 0 ? '+' : ''}${s.일수}일`].filter(Boolean).join(' ');

// ① 변경 요청 판정 (조건판정 규칙)
export function judgeChange(bundle, change, date) {
  const out = [], wait = [];
  for (const rule of bundle.규칙.filter(r => r.유형 === '조건판정')) {
    const v = activeVersion(rule, date);
    if (!v) continue;
    const r = evalCond(v.조건, change);
    if (!r.ok) {
      // 판단 질문이 남아 있으면 '예'로 가정했을 때 대상이 되는지 보고 판단 대기로 표시 (공식 판정에는 넣지 않음)
      const pend = pendingJudgements(v.조건, change);
      if (pend.length) {
        const r2 = evalCond(v.조건, { ...change, ...Object.fromEntries(pend.map(c => [c.필드, true])) });
        if (r2.ok) wait.push({ 규칙: rule.id, 규칙명: rule.이름, 버전: v.버전, 조치: v.결과.조치, 기한: v.결과.기한 ? calcDue(v.결과.기한, change) : null,
          질문: pend.filter(c => r2.matched.some(m => m.필드 === c.필드)), 다른조건: r2.matched.filter(m => !m.판단).map(m => m.설명) });
      }
      continue;
    }
    const 기한 = v.결과.기한 ? calcDue(v.결과.기한, change) : null;
    out.push({
      규칙: rule.id, 규칙명: rule.이름, 버전: v.버전, 시행일: v.시행일,
      조치: v.결과.조치, 제출처: v.결과.제출처, 서식: v.결과.서식, 기한,
      기한설명: v.결과.기한 ? `${v.결과.기한.기준필드} ${dueText(v.결과.기한)}` : null,
      사유: r.matched,
      근거: cite(bundle, [...v.근거, ...r.matched.map(m => m.근거), v.결과.기한?.근거].filter(Boolean), date),
    });
  }
  out.대기 = wait; // 판단 질문 확정이 필요한 규칙
  return out;
}

// ② 정기검사 일정 (결정표 규칙)
export function inspectionSchedule(bundle, site, date) {
  const rule = bundle.규칙.find(r => r.id === 'R-24-2') || bundle.규칙.find(r => r.유형 === '결정표');
  const v = activeVersion(rule, date);
  return site.시설.map(f => {
    const row = v.결정표.find(t => t.사업장군 === site.사업장군 && (!t.위험도 || t.위험도 === f.위험도))
      || v.결정표.find(t => t.사업장군 === '기타');
    let 연장 = 0;
    if (v.연장 && f.연속적합_횟수 >= v.연장.조건.연속적합_횟수_이상 && f.검사기관수 >= v.연장.조건.검사기관수_이상) 연장 = v.연장.최대_년;
    const 기한 = addYears(f[v.결과.기준필드], row.주기_년 + 연장);
    const 남은일수 = daysBetween(date, 기한);
    return {
      시설: f.이름, 위험도: f.위험도, 주기_년: row.주기_년, 연장_년: 연장, 최근_검사일: f[v.결과.기준필드], 기한, 남은일수,
      상태: 남은일수 < 0 ? '기한 경과' : 남은일수 <= 60 ? '임박' : '정상',
      규칙: rule.id, 버전: v.버전, 근거: cite(bundle, v.근거, date),
    };
  });
}

// ③ 표시 항목 점검 (체크리스트 규칙)
export function checkLabel(bundle, items, date) {
  const rule = bundle.규칙.find(r => r.id === 'R-16-1') || bundle.규칙.find(r => r.유형 === '체크리스트');
  const v = activeVersion(rule, date);
  const 누락 = v.필수항목.filter(x => !items.includes(x));
  const guide = bundle.가이드.find(g => g.코드 === v.결과.지적유형);
  return { 규칙: rule.id, 버전: v.버전, 필수항목: v.필수항목, 누락, 적합: 누락.length === 0,
           조치: 누락.length ? v.결과.조치 : null, 가이드: 누락.length ? guide : null, 근거: cite(bundle, v.근거, date) };
}

// ④ 영향 분석: 바뀐 조문 id → 영향받는 규칙·가이드 (위임 관계 포함)
export function impact(bundle, changedIds) {
  const ids = new Set(changedIds);
  // 바뀐 조문에 위임한 상위 조문도 영향 범위에 포함
  for (const [id, versions] of Object.entries(bundle.조문)) {
    if (versions.some(a => (a.위임 || []).some(x => changedIds.includes(x)))) ids.add(id);
  }
  const refs = r => r.버전.flatMap(v => [...v.근거, ...JSON.stringify(v).matchAll(/"근거":"([^"]+)"/g)].map(m => (typeof m === 'string' ? m : m[1])));
  const 규칙 = bundle.규칙.filter(r => refs(r).some(x => ids.has(x))).map(r => ({ id: r.id, 이름: r.이름 }));
  const 가이드 = bundle.가이드.filter(g => g.근거.some(x => ids.has(x))).map(g => ({ 코드: g.코드, 지적유형: g.지적유형 }));
  return { 조문: [...ids], 규칙, 가이드 };
}

// ⑤ 물질별 규정수량 구간 판정 (수량판정 규칙 + 규정수량 표)
// 입력 m: {CAS, 함량(%), 보유량(톤), 성상('기체'|'액체'|'고체')}
export function qtyJudge(bundle, m, date) {
  const rule = bundle.규칙.find(r => r.유형 === '수량판정');
  const v = activeVersion(rule, date);
  // 별표 행 버전: 행.시행일(추가)·폐지일(삭제)·개정[](값 변경)을 판정 기준일로 적용
  const eff = r => { if (!r.개정) return r; const o = r.개정.filter(x => x.시행일 <= date).sort((a, b) => a.시행일 < b.시행일 ? -1 : 1).pop(); return o ? { ...r, ...o.값, _개정: o.시행일 } : r; };
  const live = r => (!r.시행일 || r.시행일 <= date) && (!r.폐지일 || r.폐지일 > date);
  const T0 = bundle.규정수량표, T = { 별표2: T0.별표2.filter(live).map(eff), 별표3: T0.별표3.filter(live).map(eff) };
  const ov = (bundle.수량 || {})[m.CAS] || [];
  const 성상 = m.성상 || '액체';
  const 함량 = Number(m.함량 ?? 100);
  let 표 = null, 후보 = [], 메모 = [];
  const b3 = T.별표3.filter(r => r.CAS.includes(m.CAS));
  if (b3.length && v.옵션.사고대비우선) {
    표 = '별표3';
    후보 = b3.filter(r => 성상 === '액체' ? true : !r.액체적용);
    const liq = 후보.filter(r => r.액체적용);
    if (성상 === '액체' && liq.length) { 후보 = liq; 메모.push('별표 3 일반기준 가: 액체 → *표시 값 적용'); }
    else 후보 = 후보.filter(r => !r.액체적용);
  } else {
    const b2 = T.별표2.filter(r => r.CAS.includes(m.CAS));
    if (!b2.length) return { 해당: false, 사유: '규정수량 표에 없는 물질 (유해화학물질 아님 또는 CAS 미등재)', 규칙: rule.id, 버전: v.버전, 근거: cite(bundle, v.근거, date) };
    표 = '별표2';
    const low = b2.filter(r => r.구분 === '저확산');
    const sol = b2.filter(r => r.구분 === '용액');
    if (low.length && v.옵션.저확산적용 && ['액체', '고체'].includes(성상)) { 후보 = low; 메모.push('별표 2 일반기준 다: 액체·고체 취급 → 저확산 값 적용'); }
    else if (sol.length && 성상 === '액체') { 후보 = sol; 메모.push('별표 2 일반기준 나: 액체 → 용액 값 적용'); }
    else 후보 = b2.filter(r => !['저확산', '용액'].includes(r.구분));
  }
  const 함량OK = 후보.filter(r => r.함량 == null || 함량 >= r.함량);
  if (!함량OK.length) {
    const minPct = Math.min(...후보.map(r => r.함량 ?? 0));
    return { 해당: false, 표, 사유: `함량 ${함량}% < 함량기준 ${minPct}% — 유해화학물질 규정수량 적용 대상 아님`, 규칙: rule.id, 버전: v.버전, 근거: cite(bundle, v.근거, date), 메모 };
  }
  // 복수 구분(급성·만성·생태 등)이면 옵션에 따라 가장 엄격한(낮은) 값 적용
  const pick = 함량OK.slice().sort((a, b) => (a.하위 ?? 1e9) - (b.하위 ?? 1e9))[0];
  if (함량OK.length > 1) 메모.push(`복수 구분 ${함량OK.map(r => r.구분 || r.물질명).join('·')} 중 ${v.옵션.복수구분 === '최소값' ? '가장 낮은 규정수량' : '첫 번째'} 적용`);
  let { 최하위, 하위, 상위 } = pick;
  if (pick._개정) 메모.push(`별표 개정 반영 (시행 ${pick._개정})`);
  const o = ov.filter(x => x.시행일 <= date).sort((a, b) => a.시행일 < b.시행일 ? -1 : 1).pop();
  if (o) { 하위 = o.하위; 메모.push(`승인된 개정 반영: 하위 ${o.하위} t (시행 ${o.시행일})`); }
  const q = Number(m.보유량);
  const 구간 = 상위 != null && q >= 상위 ? '상위 이상' : 하위 != null && q >= 하위 ? '하위 이상' : 최하위 != null && q >= 최하위 ? '최하위 이상' : '최하위 미만';
  return { 해당: true, 표, 행: pick, 물질명: pick.물질명, 구분: pick.구분 || '사고대비물질', 함량기준: pick.함량, 최하위, 하위, 상위, 보유량: q,
    배수_하위: 하위 ? +(q / 하위).toFixed(2) : null, 배수_상위: 상위 ? +(q / 상위).toFixed(2) : null, 구간, 메모, 규칙: rule.id, 버전: v.버전, 근거: cite(bundle, v.근거, date) };
}

// ⑥ 사업장 작성수준(1군·2군) 판정 (사업장판정 규칙)
export function siteGroup(bundle, site, date) {
  const rule = bundle.규칙.find(r => r.유형 === '사업장판정');
  const v = activeVersion(rule, date);
  const res = site.물질.map(m => ({ 물질: m.이름, id: m.id, ...qtyJudge(bundle, { CAS: m.CAS, 함량: m.함량, 보유량: m.최대보유량_t, 성상: m.성상 }, date) }));
  const has = g => res.some(r => r.구간 === g);
  let 결과 = v.기본, 사유 = '';
  for (const d of v.결정) {
    if (!has(d.구간)) continue;
    if (d.조건 && !site[d.조건]) continue;
    결과 = d.결과; 사유 = d.설명; break;
  }
  return { 결과, 사유, 물질: res, 규칙: rule.id, 버전: v.버전, 근거: cite(bundle, v.근거, date) };
}
