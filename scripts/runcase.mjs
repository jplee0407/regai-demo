import { judgeChange, inspectionSchedule, checkLabel, qtyJudge, siteGroup } from '../src/engine.js';

// 정답셋 한 건을 실행하고 기대값과 비교
export function runCase(bundle, c) {
  let 실제;
  if (c.유형 === '변경판정') {
    const r = judgeChange(bundle, c.입력, c.기준일);
    실제 = { 규칙: r.map(x => x.규칙), 기한: r[0]?.기한 };
  } else if (c.유형 === '정기검사') {
    const site = { ...bundle.사업장, 시설: bundle.사업장.시설.filter(f => f.id === c.입력.시설) };
    const r = inspectionSchedule(bundle, site, c.기준일)[0];
    실제 = { 주기_년: r.주기_년, 기한: r.기한, 상태: r.상태 };
  } else if (c.유형 === '수량판정') {
    실제 = qtyJudge(bundle, c.입력, c.기준일);
  } else if (c.유형 === '사업장판정') {
    실제 = siteGroup(bundle, bundle.사업장, c.기준일);
  } else {
    const r = checkLabel(bundle, c.입력.항목, c.기준일);
    실제 = { 누락: r.누락 };
  }
  const diffs = Object.entries(c.기대).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(실제[k]))
    .map(([k, v]) => `${k}: 기대 ${JSON.stringify(v)} / 실제 ${JSON.stringify(실제[k])}`);
  return { id: c.id, 설명: c.설명, 통과: diffs.length === 0, diffs, 실제 };
}
