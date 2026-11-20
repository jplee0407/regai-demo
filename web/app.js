import { judgeChange, inspectionSchedule, checkLabel, activeVersion, daysBetween, label } from './engine.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const B = await (await fetch('data/bundle.json', { cache: 'no-store' })).json();

// ---- 기본 설정
const today = new Date().toISOString().slice(0, 10);
$('baseDate').value = today;
const base = () => $('baseDate').value || today;
const repo = B.빌드.저장소;
$('buildinfo').textContent = `화학물질관리법·시행규칙 발췌 기반 · 가상 사업장 · 빌드 ${B.빌드.커밋} (${B.빌드.시각.slice(0, 16).replace('T', ' ')} UTC)`;

document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  ['t1', 't2', 't3', 't4', 't5'].forEach(t => $(t).classList.toggle('hidden', t !== b.dataset.t));
});

const citeHtml = list => list.map(c => `<div class="cite"><b>${esc(c.조문)}</b> <span class="muted">(${esc(c.법령)}, 시행 ${esc(c.시행일)})</span><br>${esc(c.내용)}</div>`).join('');

// ---- ① 변경 판정
const CHANGE = [
  ['취급량_증가', '취급량 증가'], ['취급시설_용량_증가', '취급시설 용량 증가'], ['신규_취급시설', '새로운 취급시설 설치'],
  ['물질_변경_추가', '유해화학물질 변경·추가'], ['함량_농도_성상_변경', '함량·농도·성상 변경'], ['위험도_증가', '위 변경으로 위험 증가'],
  ['시설_위치_변경', '사업장 내 취급시설 위치 변경'],
];
$('facility').innerHTML = B.사업장.시설.map(f => `<option>${esc(f.이름)}</option>`).join('');
$('changeChecks').innerHTML = CHANGE.map(([k, t]) => `<label class="chk"><input type="checkbox" data-k="${k}"> ${t}</label>`).join('');

function runJudge() {
  const input = { 변경완료_예정일: $('doneDate').value };
  document.querySelectorAll('#changeChecks input').forEach(c => { if (c.checked) input[c.dataset.k] = true; });
  const res = judgeChange(B, input, base());
  $('judgeHint').textContent = `기준일 ${base()} 시행 규칙으로 판정 · 대상: ${$('facility').value}`;
  if (!res.length) {
    $('judgeOut').innerHTML = `<div class="result"><h3><span class="pill green">해당 없음</span> 계획서 변경 제출 대상이 아님</h3><p class="muted">선택한 변경 사항이 법 제23조제3항 및 시행규칙 제19조제7항의 요건에 해당하지 않습니다.</p></div>`;
    return;
  }
  $('judgeOut').innerHTML = res.map(r => {
    const d = r.기한 ? daysBetween(base(), r.기한) : null;
    return `<div class="result hit">
      <h3><span class="pill red">대상</span> ${esc(r.조치)}</h3>
      <div class="kv"><b>제출 기한</b><span><b style="color:var(--red)">${esc(r.기한)}</b> ${d !== null ? `(D${d >= 0 ? '-' + d : '+' + -d})` : ''} · ${esc(r.기한설명)}</span>
      <b>제출처</b><span>${esc(r.제출처)}</span><b>서식</b><span>${esc(r.서식)}</span>
      <b>해당 사유</b><span>${r.사유.map(m => esc(m.설명)).join(', ')}</span>
      <b>적용 규칙</b><span><span class="pill navy">${esc(r.규칙)} v${r.버전}</span> 시행 ${esc(r.시행일)}</span></div>
      <details><summary>근거 조문 원문 보기</summary>${citeHtml(r.근거)}</details>
      <p class="muted" style="margin:8px 0 0">→ 실제 시스템에서는 이 결과가 조치계획 과업으로 등록되고 담당자에게 알림이 발송됩니다.</p>
    </div>`;
  }).join('');
}
$('judgeBtn').onclick = runJudge;

// ---- ② 정기검사
function runInsp() {
  const rows = inspectionSchedule(B, B.사업장, base());
  $('siteInfo').textContent = `${B.사업장.사업장} · 사업장 ${B.사업장.사업장군} · 기준일 ${base()} (규칙 R-24-2 v${rows[0].버전})`;
  const st = s => s === '기한 경과' ? 'red' : s === '임박' ? 'orange' : 'green';
  $('inspTable').innerHTML = `<tr><th>시설</th><th>위험도</th><th>주기</th><th>연장</th><th>최근 검사</th><th>다음 기한</th><th>남은 일수</th><th>상태</th></tr>` +
    rows.map(r => `<tr><td>${esc(r.시설)}</td><td>${esc(r.위험도)}</td><td>${r.주기_년}년</td><td>${r.연장_년 ? '+' + r.연장_년 + '년' : '-'}</td><td>${r.최근_검사일}</td><td><b>${r.기한}</b></td><td>${r.남은일수}</td><td><span class="pill ${st(r.상태)}">${r.상태}</span></td></tr>`).join('');
  $('inspCite').innerHTML = citeHtml(rows[0].근거);
}

// ---- ③ 표시 점검
const ITEMS = activeVersion(B.규칙.find(r => r.유형 === '체크리스트'), today).필수항목;
$('labelChecks').innerHTML = ITEMS.map(t => `<label class="chk"><input type="checkbox" checked data-v="${esc(t)}"> ${esc(t)}</label>`).join('');
$('labelBtn').onclick = () => {
  const items = [...document.querySelectorAll('#labelChecks input')].filter(c => c.checked).map(c => c.dataset.v);
  const r = checkLabel(B, items, base());
  $('labelOut').innerHTML = r.적합
    ? `<div class="result"><h3><span class="pill green">적합</span> 필수 표시 항목이 모두 있음</h3>${citeHtml(r.근거)}</div>`
    : `<div class="result hit"><h3><span class="pill red">표시 미흡</span> 누락: ${r.누락.map(esc).join(', ')}</h3>
       <div class="kv"><b>조치</b><span>${esc(r.조치)}</span><b>지적 유형</b><span>${esc(r.가이드?.코드)} ${esc(r.가이드?.지적유형)}</span>
       <b>권고 조치</b><span>${esc(r.가이드?.권고조치)}</span><b>과거 사례</b><span>${(r.가이드?.사례 || []).map(s => `${s.연도} ${esc(s.시설)}: ${esc(s.내용)}`).join('<br>')}</span></div>
       <details><summary>근거 조문</summary>${citeHtml(r.근거)}</details></div>`;
};

// ---- ④ 지식 기반
function renderKnowledge() {
  $('rulesOut').innerHTML = B.규칙.map(r => `<div class="result"><h3>${esc(r.id)} ${esc(r.이름)} <span class="pill gray">${esc(r.유형)}</span></h3><p class="muted" style="margin:0 0 6px">${esc(r.설명)}</p>
    <table><tr><th>버전</th><th>시행일</th><th>폐지일</th><th>상태</th><th>근거 조문</th><th>핵심 값</th></tr>
    ${r.버전.map(v => `<tr><td>v${v.버전}</td><td>${v.시행일}</td><td>${v.폐지일 || '-'}</td><td>${esc(v.승인)}</td><td>${v.근거.join(', ')}</td>
      <td>${v.결과?.기한 ? `기한 ${v.결과.기한.일수}일` : v.결정표 ? `결정표 ${v.결정표.length}행` : v.필수항목 ? `필수 ${v.필수항목.length}항목` : ''}</td></tr>`).join('')}</table></div>`).join('');
  const arts = Object.values(B.조문).flat();
  $('lawTable').innerHTML = `<tr><th>ID</th><th>조문</th><th>제목</th><th>시행일</th><th>폐지일</th><th>해시</th><th>내용</th></tr>` +
    arts.map(a => `<tr><td>${a.id}</td><td>${esc(label(a))}</td><td>${esc(a.제목)}</td><td>${a.시행일}</td><td>${a.폐지일 || '-'}</td><td><code>${a.해시}</code></td><td>${esc(a.내용)}</td></tr>`).join('');
  $('guideTable').innerHTML = `<tr><th>코드</th><th>지적 유형</th><th>연결 규칙</th><th>근거 조문</th><th>권고 조치</th></tr>` +
    B.가이드.map(g => `<tr><td>${g.코드}</td><td>${esc(g.지적유형)}</td><td>${g.규칙}</td><td>${g.근거.join(', ')}</td><td>${esc(g.권고조치)}</td></tr>`).join('');
  const results = B.정답셋.map(c => {
    let ok, act;
    if (c.유형 === '변경판정') { const r = judgeChange(B, c.입력, c.기준일); act = { 규칙: r.map(x => x.규칙), 기한: r[0]?.기한 }; }
    else if (c.유형 === '정기검사') { const r = inspectionSchedule(B, { ...B.사업장, 시설: B.사업장.시설.filter(f => f.id === c.입력.시설) }, c.기준일)[0]; act = r; }
    else { act = checkLabel(B, c.입력.항목, c.기준일); }
    ok = Object.entries(c.기대).every(([k, v]) => JSON.stringify(v) === JSON.stringify(act[k]));
    return { c, ok };
  });
  $('testTable').innerHTML = `<tr><th>사례</th><th>유형</th><th>기준일</th><th>내용</th><th>결과</th></tr>` +
    results.map(({ c, ok }) => `<tr><td>${c.id}</td><td>${c.유형}</td><td>${c.기준일}</td><td>${esc(c.설명)}</td><td><span class="pill ${ok ? 'green' : 'red'}">${ok ? '통과' : '실패'}</span></td></tr>`).join('');
}

// ---- ⑤ 개정 반영 흐름
const gh = p => repo ? `https://github.com/${repo}${p}` : '#';
$('lnkActions').href = gh('/actions'); $('lnkPulls').href = gh('/pulls');
const FLOW = [
  ['수집', '매일 06시 법제처 Open API로 화학물질관리법·시행규칙 조회', 'GitHub Actions 예약 실행', '/actions'],
  ['신·구 비교', '조문별 해시를 비교해 바뀐 조항만 추출', 'scripts/watch-law.mjs', '/blob/main/scripts/watch-law.mjs'],
  ['영향 분석', '바뀐 조문을 근거로 쓰는 규칙·가이드를 연결 관계로 추적', '근거 조문 ID 연결', '/tree/main/rules'],
  ['AI 초안', 'LLM이 바뀐 원문을 읽고 규칙 수정안 작성 (시연은 미리 만든 결과 재생)', 'Pull Request 자동 생성', '/pulls'],
  ['전문가 승인', '컨설턴트가 신·구 대조와 수정안을 검토하고 승인', 'PR Review → Approve', '/pulls'],
  ['회귀 테스트', '정답셋을 다시 돌려 의도하지 않은 판정 변화 확인', 'PR 본문 테스트 결과', '/actions'],
  ['배포', '병합하면 새 규칙 버전이 시행일부터 적용, 화면 자동 갱신', 'Merge → GitHub Pages', '/deployments'],
  ['재판정·롤백', '진행 중 조치계획 재판정, 문제 시 이전 버전 복구', 'Revert', '/commits/main'],
];
$('flow').innerHTML = FLOW.map(([t, d, g, p], i) => `<div class="step"><span class="n">${i + 1}</span><b>${t}</b><p>${d}</p><div class="gh">${repo ? `<a href="${gh(p)}" target="_blank">${g} ↗</a>` : g}</div></div>`).join('');

function rerender() { runInsp(); renderKnowledge(); if ($('judgeOut').innerHTML) runJudge(); }
$('baseDate').onchange = rerender;
rerender();
