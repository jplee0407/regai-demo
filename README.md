# 법규 개정 영향 진단 및 조치계획 자동 수립 · 시연 저장소

화학물질관리법 개정을 감지하고, 영향을 받는 판정 규칙을 찾아 갱신안을 만들고, 전문가 승인 후 배포하는 흐름을 **GitHub 기능만으로** 보여주는 시연용 저장소입니다.

> ⚠️ 시연용입니다. 조문은 법제처 공개 법령의 발췌·요약본이고, 사업장·시설·사례는 모두 가상 데이터입니다. 실제 법률 자문이나 판정 결과로 사용할 수 없습니다.

## 무엇을 보여주나

| 제안 내용 | 이 저장소에서 |
|---|---|
| 법령을 조·항·호 단위 데이터로 관리 | `data/laws/*.json` (시행일·폐지일로 버전 관리) |
| 판정 기준을 규칙(결정표)으로 관리 | `rules/*.yaml` (근거 조문 ID 연결) |
| 지적사항·조치 가이드 | `guides/guides.yaml` |
| 판정 엔진 (AI가 아닌 규칙으로 판정) | `src/engine.js` |
| 매일 개정 감시 → 갱신안 | `.github/workflows/law-watch.yml` → Pull Request |
| 전문가 승인 | PR Review → Approve |
| 회귀 테스트 | `tests/golden.yaml` 정답셋 |
| 배포·롤백 | Merge → GitHub Pages / Revert |

## 시연 방법

1. **Actions → 법령 개정 감시 → Run workflow → mode: `simulate`** 실행
2. **Pull requests**에 "[가상 개정] … 30일 → 60일" 갱신안이 생성됨 (신·구 대조, 영향 분석, AI 규칙 초안, 판정 변화, 테스트 결과)
3. 검토 후 **Approve → Merge**
4. 시연 화면(GitHub Pages)에서 기준일을 `2027-01-15`로 두고 변경 판정 → 기한이 60일 전으로 계산됨
5. 되돌리려면 병합된 PR에서 **Revert**

## 실제 법령 수집 켜기

1. [법제처 국가법령정보 공동활용](https://open.law.go.kr)에서 Open API 인증값(OC) 신청
2. 저장소 **Settings → Secrets and variables → Actions → New repository secret**: 이름 `LAW_OC`, 값 = 인증값
3. 매일 06시(한국시간) 자동 실행되며, 바뀐 조문이 있으면 PR이 생성됩니다. 첫 실행에서는 요약본이 원문으로 교체되는 PR이 올라옵니다.
4. GitHub 서버(해외)에서 법제처 접속이 막히면 사내 PC에서 `LAW_OC=… npm run watch-law` 실행 후 결과를 커밋하세요.

## 로컬 실행

```bash
npm install
npm test          # 정답셋 회귀 테스트
npm run build     # web/data/bundle.json 생성
npx serve web     # 또는 아무 정적 웹서버로 web 폴더 열기
```

## 참고

- 법령 출처: 국가법령정보센터 (화학물질관리법 법률 제21531호, 2026.10.8 시행 / 시행규칙 기후에너지환경부령 제1호, 2025.10.1 시행)
- 실제 시스템에서는 AI 초안 단계가 사내 서버의 sLLM으로, 저장소는 사내 Git 서버로 대체됩니다.
