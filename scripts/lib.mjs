import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const readYaml = f => yaml.load(fs.readFileSync(path.join(ROOT, f), 'utf8'), { schema: yaml.JSON_SCHEMA });
export const readJson = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
export const writeJson = (f, o) => { fs.mkdirSync(path.dirname(path.join(ROOT, f)), { recursive: true }); fs.writeFileSync(path.join(ROOT, f), JSON.stringify(o, null, 2) + '\n'); };
export const hash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
export const LAW_FILES = ['data/laws/act.json', 'data/laws/rule.json', 'data/laws/notice-plan.json', 'data/laws/notice-qty.json'];

// 저장소의 모든 지식을 하나의 묶음으로 로드
export function loadBundle() {
  const 조문 = {};
  const 법령 = [];
  for (const f of LAW_FILES) {
    const law = readJson(f);
    법령.push({ 법령명: law.법령명, 구분: law.구분, 공포번호: law.공포번호, 시행일: law.시행일, 출처: law.출처, 비고: law.비고 });
    for (const a of law.조문) {
      (조문[a.id] ||= []).push({ ...a, 법령명: law.법령명, 약칭: law.약칭, 해시: hash(a.내용) });
    }
  }
  for (const list of Object.values(조문)) list.sort((x, y) => (x.시행일 < y.시행일 ? -1 : 1));
  const 규칙 = fs.readdirSync(path.join(ROOT, 'rules')).filter(f => f.endsWith('.yaml')).sort().map(f => readYaml('rules/' + f));
  const 가이드 = readYaml('guides/guides.yaml');
  const 사업장 = readJson('data/sites/oo-plant.json');
  const 규정수량표 = readJson('data/knowledge/qty-table.json');
  return { 법령, 조문, 규칙, 가이드, 사업장, 규정수량표 };
}
