// 법령 개정 감시 → 영향 분석 → 규칙 갱신안 작성 → PR 본문 생성
//   실제 모드:  LAW_OC=<법제처 인증값> node scripts/watch-law.mjs
//   가상 모드:  node scripts/watch-law.mjs --simulate simulations/sim-rule19-6.yaml
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { ROOT, LAW_FILES, readJson, writeJson, readYaml, loadBundle, hash } from './lib.mjs';
import { impact, judgeChange, activeVersion, addDays } from '../src/engine.js';

const args = process.argv.slice(2);
const simFile = args[args.indexOf('--simulate') + 1];
const OUT = path.join(ROOT, 'out');
fs.mkdirSync(OUT, { recursive: true });

function findLawFileById(id) {
  return LAW_FILES.find(f => readJson(f).조문.some(a => a.id === id));
}

// 조문 새 버전 추가 (이전 버전은 폐지일만 채워 보존)
function applyArticleChange(id, 새내용, 시행일, meta) {
  const f = findLawFileById(id);
  const law = readJson(f);
  const versions = law.조문.filter(a => a.id === id);
  const last = versions[versions.length - 1];
  if (hash(last.내용) === hash(새내용)) return null;
  last.폐지일 = 시행일;
  law.조문.push({ ...last, 내용: 새내용, 시행일, 폐지일: null });
  (law.개정이력 ||= []).push({ 공포번호: meta.공포번호, 공포일: meta.공포일, 시행일, 조문: id });
  writeJson(f, law);
  return { id, 법령: law.법령명, 구: last.내용, 신: 새내용, 시행일 };
}

// AI 규칙 초안 반영: 새 버전 추가 (승인 전 상태)
function applyRuleDraft(ruleId, change, 시행일, 설명) {
  const file = path.join(ROOT, 'rules', ruleId + '.yaml');
  const rule = yaml.load(fs.readFileSync(file, 'utf8'), { schema: yaml.JSON_SCHEMA });
  const cur = rule.버전[rule.버전.length - 1];
  const next = JSON.parse(JSON.stringify(cur));
  next.버전 = cur.버전 + 1;
  next.시행일 = 시행일;
  next.폐지일 = null;
  next.승인 = '검토 대기 (AI 초안, PR 승인 시 확정)';
  if (change.기한일수 !== undefined) next.결과.기한.일수 = change.기한일수;
  cur.폐지일 = 시행일;
  rule.버전.push(next);
  fs.writeFileSync(file, `# ${rule.이름} (버전 이력은 아래 '버전' 목록, 이전 버전은 폐지일로 보존)\n` + yaml.dump(rule, { lineWidth: -1, schema: yaml.JSON_SCHEMA }));
  return { 규칙: ruleId, 이전버전: cur.버전, 새버전: next.버전, 설명, 이전: cur.결과.기한?.일수, 신규: next.결과.기한?.일수 };
}

function addGolden(cases) {
  const file = path.join(ROOT, 'tests/golden.yaml');
  const all = readYaml('tests/golden.yaml');
  for (const c of cases) if (!all.some(x => x.id === c.id)) all.push(c);
  fs.writeFileSync(file, '# 정답셋: 규칙이 바뀔 때마다 자동으로 다시 돌려 판정이 의도대로인지 확인 (회귀 테스트)\n' + yaml.dump(all, { lineWidth: -1, schema: yaml.JSON_SCHEMA }));
}

function writePR(title, changes, imp, drafts, compare, note) {
  const L = [];
  L.push(`## 법령 개정 감지 → 규칙 갱신안`, '', note, '');
  L.push('### 1. 바뀐 조문 (신·구 대조)');
  for (const c of changes) {
    L.push('', `**${c.법령} ${c.id}** (시행 ${c.시행일})`, '', '| 구 | 신 |', '|---|---|', `| ${c.구} | ${c.신} |`);
  }
  L.push('', '### 2. 영향 분석 (조문 → 규칙·가이드 연결 추적)', '',
    `- 영향 조문: ${imp.조문.join(', ')}`,
    `- 영향 규칙: ${imp.규칙.map(r => `${r.id} ${r.이름}`).join(', ') || '없음'}`,
    `- 영향 지적·조치 가이드: ${imp.가이드.map(g => `${g.코드} ${g.지적유형}`).join(', ') || '없음'}`);
  if (drafts.length) {
    L.push('', '### 3. AI 규칙 수정 초안', '');
    for (const d of drafts) L.push(`- **${d.규칙}** 버전 ${d.이전버전} → ${d.새버전}: 기한 일수 ${d.이전} → ${d.신규}`, `  - ${d.설명}`);
  }
  if (compare) {
    L.push('', '### 4. 판정 변화 미리보기', '', '| 사례 | 현재 규칙 | 갱신 후 |', '|---|---|---|', `| ${compare.사례} | ${compare.전} | ${compare.후} |`);
  }
  L.push('', '### 5. 전문가 검토 체크리스트', '',
    '- [ ] 바뀐 조문 해석이 맞는가 (원문 대조)',
    '- [ ] 규칙 수정 초안(조건·기한)이 맞는가',
    '- [ ] 정답셋 회귀 테스트 결과 확인 (이 PR 본문 맨 아래)',
    '- [ ] 영향받는 가이드 문구 수정 필요 여부',
    '', '> 승인(Approve) 후 병합하면 새 규칙 버전이 시행일부터 자동 적용되고 시연 화면이 갱신됩니다. 문제가 있으면 병합을 되돌리면(Revert) 이전 버전으로 복구됩니다.');
  fs.writeFileSync(path.join(OUT, 'pr-body.md'), L.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'pr-title.txt'), title);
  fs.writeFileSync(path.join(OUT, 'changed'), '1');
  console.log(L.join('\n'));
}

// ---------------------------------------------------------------- 가상 모드
async function simulate(file) {
  const sim = readYaml(file);
  const before = loadBundle();
  const changes = sim.변경조문.map(c => applyArticleChange(c.id, c.새내용, c.시행일, sim)).filter(Boolean);
  if (!changes.length) { console.log('이미 반영된 가상 개정입니다. 변경 없음.'); return; }
  const imp = impact(loadBundle(), changes.map(c => c.id));
  const 시행일 = changes[0].시행일;
  const drafts = (sim.규칙초안 || []).map(d => applyRuleDraft(d.규칙, d.변경, 시행일, d.AI설명));
  addGolden(sim.추가정답 || []);
  const after = loadBundle();
  const 사례 = { 취급량_증가: true, 변경완료_예정일: '2027-03-31' };
  const 기준일 = addDays(시행일, 14);
  const compare = {
    사례: `취급량 증가, 변경완료 2027-03-31 (기준일 ${기준일})`,
    전: `제출 기한 ${judgeChange(before, 사례, 기준일)[0]?.기한}`,
    후: `제출 기한 ${judgeChange(after, 사례, 기준일)[0]?.기한}`,
  };
  writePR(sim.설명, changes, imp, drafts, compare, '> 시연용 **가상 개정** 시나리오입니다. 실제 법령 개정이 아닙니다.');
}

// ---------------------------------------------------------------- 실제 모드 (법제처 Open API)
const arr = x => (x == null ? [] : Array.isArray(x) ? x : [x]);
const clean = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const circled = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮';

async function getJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

// 법제처 조문 JSON → { "23-3-1": "내용" } 형태로 평탄화
function flatten(lawJson) {
  const map = {};
  for (const u of arr(lawJson?.법령?.조문?.조문단위)) {
    if (u.조문여부 && u.조문여부 !== '조문') continue;
    const jo = parseInt(u.조문번호, 10);
    if (u.조문가지번호) continue;
    map[`${jo}`] = clean(u.조문내용);
    for (const h of arr(u.항)) {
      const hn = circled.indexOf(clean(h.항번호)) + 1;
      if (hn > 0) map[`${jo}-${hn}`] = clean(h.항내용);
      for (const ho of arr(h.호)) {
        const n = parseInt(clean(ho.호번호), 10);
        if (n) map[`${jo}-${hn > 0 ? hn : 'x'}-${n}`] = clean(ho.호내용);
      }
    }
  }
  return map;
}

async function real() {
  const OC = process.env.LAW_OC;
  if (!OC) { console.log('LAW_OC(법제처 Open API 인증값)가 없어 실제 수집을 건너뜁니다. 저장소 Settings → Secrets에 LAW_OC를 등록하세요.'); return; }
  const changes = [];
  for (const f of LAW_FILES) {
    const law = readJson(f);
    try {
      const s = await getJson(`https://www.law.go.kr/DRF/lawSearch.do?OC=${OC}&target=law&type=JSON&query=${encodeURIComponent(law.법령명)}`);
      const hit = arr(s?.LawSearch?.law).find(x => clean(x.법령명한글) === law.법령명);
      if (!hit) { console.log(`검색 결과 없음: ${law.법령명}`); continue; }
      console.log(`${law.법령명}: 현행 공포번호 ${hit.공포번호}, 시행일 ${hit.시행일자}`);
      const body = await getJson(`https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=law&type=JSON&MST=${hit.법령일련번호}`);
      const map = flatten(body);
      const 시행일 = String(hit.시행일자).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
      for (const id of [...new Set(law.조문.map(a => a.id))]) {
        const key = id.split('-').slice(1).join('-');
        const text = map[key];
        if (!text) continue;
        const c = applyArticleChange(id, text, 시행일, { 공포번호: hit.공포번호, 공포일: hit.공포일자 });
        if (c) changes.push(c);
      }
    } catch (e) {
      console.log(`수집 실패 (${law.법령명}): ${e.message}. 해외 서버에서 법제처 접속이 막힌 경우 사내 PC에서 실행하세요.`);
    }
  }
  if (!changes.length) { console.log('변경된 조문이 없습니다.'); return; }
  const imp = impact(loadBundle(), changes.map(c => c.id));
  writePR(`법령 개정 감지: ${changes.map(c => c.id).join(', ')}`, changes, imp, [], null,
    '> 법제처 Open API로 수집한 원문과 저장된 조문이 달라 갱신안을 올립니다. 규칙 수정이 필요하면 이 PR에서 함께 수정하세요. (첫 실행 시에는 요약본이 원문으로 교체됩니다.)');
}

if (args.includes('--simulate')) await simulate(simFile); else await real();
