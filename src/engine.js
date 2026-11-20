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
  return { ok, matched: ok ? [{ 설명: cond.설명, 근거: cond.근거 }] : [] };
}

function cite(bundle, ids, date) {
  return [...new Set(ids)].map(id => {
    const a = article(bundle, id, date);
    return a ? { id, 법령: a.법령명, 조문: label(a), 내용: a.내용, 시행일: a.시행일 } : { id, 조문: id, 내용: '(조문 없음)' };
  });
}

export function label(a) {
  const short = a.법령명.includes('시행규칙') ? '시행규칙' : a.법령명.includes('시행령') ? '시행령' : '법';
  return `${short} 제${a.조}조` + (a.항 ? `제${a.항}항` : '') + (a.호 ? `제${a.호}호` : '');
}

// ① 변경 요청 판정 (조건판정 규칙)
export function judgeChange(bundle, change, date) {
  const out = [];
  for (const rule of bundle.규칙.filter(r => r.유형 === '조건판정')) {
    const v = activeVersion(rule, date);
    if (!v) continue;
    const r = evalCond(v.조건, change);
    if (!r.ok) continue;
    const 기한 = v.결과.기한 && change[v.결과.기한.기준필드]
      ? addDays(change[v.결과.기한.기준필드], v.결과.기한.일수) : null;
    out.push({
      규칙: rule.id, 규칙명: rule.이름, 버전: v.버전, 시행일: v.시행일,
      조치: v.결과.조치, 제출처: v.결과.제출처, 서식: v.결과.서식, 기한,
      기한설명: v.결과.기한 ? `${v.결과.기한.기준필드} ${v.결과.기한.일수}일` : null,
      사유: r.matched,
      근거: cite(bundle, [...v.근거, ...r.matched.map(m => m.근거), v.결과.기한?.근거].filter(Boolean), date),
    });
  }
  return out;
}

// ② 정기검사 일정 (결정표 규칙)
export function inspectionSchedule(bundle, site, date) {
  const rule = bundle.규칙.find(r => r.유형 === '결정표');
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
  const rule = bundle.규칙.find(r => r.유형 === '체크리스트');
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
