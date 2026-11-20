// 저장소의 조문·규칙·가이드를 웹 화면용 묶음으로 만들고 엔진을 복사
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadBundle, writeJson, readYaml } from './lib.mjs';

const bundle = loadBundle();
bundle.정답셋 = readYaml('tests/golden.yaml');
bundle.고시 = readYaml('data/notices/notices.yaml');
bundle.빌드 = { 시각: new Date().toISOString(), 커밋: process.env.GITHUB_SHA?.slice(0, 7) || 'local', 저장소: process.env.GITHUB_REPOSITORY || '' };
writeJson('web/data/bundle.json', bundle);
fs.copyFileSync(path.join(ROOT, 'src/engine.js'), path.join(ROOT, 'web/engine.js'));
console.log(`빌드 완료: 조문 ${Object.keys(bundle.조문).length}개, 규칙 ${bundle.규칙.length}개, 가이드 ${bundle.가이드.length}개, 고시 ${bundle.고시.length}건`);
