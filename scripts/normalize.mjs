import fs from 'node:fs';
import yaml from 'js-yaml';
const root = process.argv[2] || '.';
const rj = f => JSON.parse(fs.readFileSync(root + '/' + f, 'utf8'));
for (const f of ['data/laws/act.json', 'data/laws/rule.json']) fs.writeFileSync(root + '/' + f, JSON.stringify(rj(f), null, 2) + '\n');
for (const f of fs.readdirSync(root + '/rules')) {
  const p = root + '/rules/' + f; const r = yaml.load(fs.readFileSync(p, 'utf8'), { schema: yaml.JSON_SCHEMA });
  fs.writeFileSync(p, `# ${r.이름} (버전 이력은 아래 '버전' 목록, 이전 버전은 폐지일로 보존)\n` + yaml.dump(r, { lineWidth: -1, schema: yaml.JSON_SCHEMA }));
}
const g = yaml.load(fs.readFileSync(root + '/tests/golden.yaml', 'utf8'), { schema: yaml.JSON_SCHEMA });
fs.writeFileSync(root + '/tests/golden.yaml', '# 정답셋: 규칙이 바뀔 때마다 자동으로 다시 돌려 판정이 의도대로인지 확인 (회귀 테스트)\n' + yaml.dump(g, { lineWidth: -1, schema: yaml.JSON_SCHEMA }));
