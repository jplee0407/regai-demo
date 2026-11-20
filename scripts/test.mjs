// 정답셋 회귀 테스트 (CI와 PR 검사에서 실행)
import fs from 'node:fs';
import { loadBundle, readYaml } from './lib.mjs';
import { runCase } from './runcase.mjs';

const bundle = loadBundle();
const cases = readYaml('tests/golden.yaml');
const results = cases.map(c => runCase(bundle, c));
const fail = results.filter(r => !r.통과);
const lines = ['## 정답셋 회귀 테스트', '', `통과 ${results.length - fail.length} / ${results.length}`, '', '| 사례 | 내용 | 결과 |', '|---|---|---|',
  ...results.map(r => `| ${r.id} | ${r.설명} | ${r.통과 ? '✅ 통과' : '❌ ' + r.diffs.join('; ')} |`)];
const md = lines.join('\n') + '\n';
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
fs.mkdirSync('out', { recursive: true });
fs.writeFileSync('out/test-report.md', md);
process.exit(fail.length ? 1 : 0);
