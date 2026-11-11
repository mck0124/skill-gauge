# skill-gauge

> LLM Skill·프롬프트를 **테스트 케이스로 반복 실행**해서 통과율·점수·분산·회귀를 숫자로 보여주는 CLI

[![CI](https://github.com/mck0124/skill-gauge/actions/workflows/ci.yml/badge.svg)](https://github.com/mck0124/skill-gauge/actions/workflows/ci.yml)

## 왜 만들었나

Claude Code의 Skill이나 시스템 프롬프트를 고칠 때, 대부분 이렇게 확인합니다.

1. 프롬프트를 고친다
2. 한두 번 돌려 보고 "괜찮아 보인다"고 판단한다
3. 다른 입력에서 조용히 깨진다

여기에는 세 가지 문제가 있습니다.

- **한 번 실행한 결과는 신뢰할 수 없습니다.** LLM 출력은 확률적이라 같은 입력도 성공했다가 실패합니다. 한 번 통과했다는 건 "통과율 100%"가 아니라 "표본 1개"입니다.
- **좋아졌는지 알 수 없습니다.** 수정 전후를 같은 기준으로 비교하지 않으면, 개선과 회귀를 구분할 수 없습니다.
- **기준이 머릿속에만 있습니다.** "커밋 메시지는 72자 이하, Conventional Commits 형식"처럼 명확한 규칙조차 매번 눈으로 확인합니다.

`skill-gauge`은 이 기준을 YAML 테스트 케이스로 옮기고, 케이스마다 **N번 반복 실행**해서 통과율과 점수의 흔들림(σ)까지 측정합니다. 두 실행 결과를 비교해서 회귀를 잡고, CI에서 품질 게이트로도 쓸 수 있습니다.

> 배경: 실시간 GPS 이상행동 탐지 시스템을 만들면서 "자동 판정 점수가 사람 평가와 얼마나 가까운가"를 MAE/RMSE로 측정하고 개선한 경험이 있습니다. 그때 배운 점은 **측정하지 않으면 개선했다고 말할 수 없다**는 것이었고, 같은 원칙을 LLM Skill에 적용했습니다.

## 빠른 시작

```bash
pnpm install && pnpm build

# API 키 없이 동작하는 예제
node dist/cli.js run examples/offline/suite.yaml

# Claude Code로 실제 Skill 평가 (claude CLI 필요)
node dist/cli.js run examples/commit-message/suite.yaml
```

```
case                pass  score  σ     note   avg time
------------------  ----  -----  ----  -----  --------
bugfix              100%  1.00   0.00         6951ms
feature-with-scope  100%  0.99   0.01         5420ms
no-chatter          100%  1.00   0.00         6496ms
commit-message: pass 100% · score 1.00 · flaky 0/3
```

위는 `claude` CLI로 실제 실행한 결과입니다(케이스당 3회). `flaky`는 "같은 입력인데 어떤 시도는 통과하고 어떤 시도는 실패했다"는 뜻이고, 이 예제처럼 규칙이 명확한 Skill에서는 0이 나옵니다. 모호한 Skill일수록 σ와 `flaky`가 올라갑니다.

## 테스트 스위트 작성

```yaml
name: commit-message
provider:
  # 케이스 input이 stdin으로 들어가고, stdout이 출력으로 쓰입니다
  command: claude -p --append-system-prompt "$(cat SKILL.md)"
  timeoutMs: 90000
judge: # llm-rubric을 쓸 때만 필요
  command: claude -p --model haiku
repeat: 3 # 케이스당 반복 횟수
concurrency: 3

cases:
  - id: bugfix
    input: Fixed a crash when the GPX file has no timestamps.
    assert:
      - { type: regex, pattern: "^fix(\\([\\w-]+\\))?: " }
      - { type: max-length, value: 200 }
      - type: llm-rubric
        rubric: The subject uses imperative mood.
        threshold: 0.8
        weight: 2
```

provider는 **쉘 명령**입니다. 그래서 Claude Code, 다른 LLM CLI, 직접 만든 스크립트를 SDK 연동 없이 모두 평가할 수 있습니다. 명령은 스위트 파일이 있는 디렉터리에서 실행되고, `SKILL_GAUGE_CASE_ID`와 `SKILL_GAUGE_TRIAL` 환경변수를 받습니다.

> 좋은 케이스 작성법, `repeat`·`threshold` 정하는 법, CI에서 PR 게이트로 쓰는 법은 [docs/guide.md](docs/guide.md)를 보세요.

### Assertion 레퍼런스

| type           | 필드                                | 통과 조건                                      |
| -------------- | ----------------------------------- | ---------------------------------------------- |
| `contains`     | `value`, `ignoreCase?`              | 출력에 `value`가 들어 있음                     |
| `not-contains` | `value`, `ignoreCase?`              | 출력에 `value`가 없음                          |
| `regex`        | `pattern`, `flags?`                 | 정규식이 매칭됨 (잘못된 정규식은 로드 시 에러) |
| `max-length`   | `value`                             | 출력 길이 ≤ `value`                            |
| `json`         | –                                   | 출력이 유효한 JSON                             |
| `llm-rubric`   | `rubric`, `threshold?` (기본 `0.7`) | judge가 매긴 0~1 점수 ≥ `threshold`            |

모든 assertion에 `weight`(기본 `1`)를 지정할 수 있습니다.

### 점수 계산

- **시도(trial)**: 모든 assertion이 통과하면 pass. 점수는 assertion 점수의 가중 평균입니다.
- **케이스**: 통과율 = 통과한 시도 / 전체 시도. σ는 시도별 점수의 표준편차입니다.
- **스위트**: 케이스 통과율의 평균입니다. 케이스마다 같은 비중을 줘서, 반복 횟수가 많은 케이스가 결과를 좌우하지 않게 했습니다.

## 명령어

```bash
skill-gauge run <suite.yaml> [--repeat N] [--case ID]... [--out DIR] [--min-pass-rate R]
skill-gauge report [run.json] [--dir DIR] [--json] [--min-pass-rate R]
skill-gauge compare <base.json> <head.json> [--threshold T]
skill-gauge calibrate <calibration.yaml> [--max-mae X] [--json]
```

| 종료 코드 | 의미                                      |
| --------- | ----------------------------------------- |
| `0`       | 성공                                      |
| `1`       | 품질 게이트 실패 (통과율 미달, 회귀 발견) |
| `2`       | 사용법·설정 오류                          |

품질 게이트 실패(1)와 설정 오류(2)를 구분했기 때문에, CI에서 "Skill이 나빠졌다"와 "설정이 깨졌다"를 다르게 처리할 수 있습니다.

### Skill 수정 전후 비교

```bash
skill-gauge run suite.yaml --out runs/base     # 수정 전
# ... SKILL.md 수정 ...
skill-gauge run suite.yaml --out runs/head     # 수정 후
skill-gauge compare runs/base/*.json runs/head/*.json --threshold 0.1
```

```
case                change      Δpass  Δscore
------------------  ----------  -----  ------
bugfix              regression  -100%  -1.00
feature-with-scope  regression  -100%  -0.49
no-chatter          regression  -100%  -1.00

overall: Δpass -100% · Δscore -0.83 · regressions 3
```

위 출력은 SKILL.md에 "친절하게 설명부터 시작하라"는 지시를 넣어 일부러 망가뜨린 뒤 실제로 비교한 결과이고, 종료 코드는 `1`입니다. 통과율은 0%여도 점수가 0이 아닌 케이스가 있는 것은(`feature-with-scope`) assertion 일부만 통과했기 때문이며, 그래서 통과/실패 외에 점수도 함께 봅니다.
`--threshold`보다 작은 변화는 무시합니다. LLM 출력에는 원래 노이즈가 있어서, 작은 흔들림까지 회귀로 잡으면 경보가 의미를 잃기 때문입니다.

### 채점 LLM 검증 (`calibrate`)

`llm-rubric`은 LLM이 LLM을 채점하는 방식이라, **채점기 자체가 틀릴 수 있습니다.** 채점기를 검증하지 않으면 "통과율 90%"가 채점기가 후해서 나온 숫자인지 알 수 없습니다. `calibrate`는 사람이 매긴 점수를 기준으로 채점기가 얼마나 가까운지 측정합니다.

```yaml
name: commit-judge
judge: { command: claude -p --model haiku }
repeat: 3 # 샘플당 채점 횟수. 평균과 흔들림(σ)을 봅니다
threshold: 0.7 # 통과/실패 기준 (일치율 계산용)
tolerance: 0.1 # 사람과 이 차이 이내면 "가깝다"
samples:
  - id: s1
    input: Fixed a crash when GPX has no timestamps.
    output: "fix(gpx): skip points without timestamps"
    rubric: The subject is imperative mood and describes the fix.
    human: 0.95 # 직접 매긴 0~1 점수
  # ... 최소 2개, 보통 20~50개
```

```bash
skill-gauge calibrate calibration.yaml --max-mae 0.15
```

```
sample  human  judge  error  note
------  -----  -----  -----  ----
s6      0.80   0.10   -0.70
s5      0.00   0.10   +0.10
...
offline-calibration-demo: MAE 0.19 · RMSE 0.30 · bias -0.09 (+ = judge more lenient than human)
within ±0.1: 83% · agreement @0.7: 83% · r 0.61
```

> 위 출력은 `examples/calibration/offline.yaml`(가짜 채점 스크립트 + 데모용 점수)의 실제 실행 결과이며, 형식을 보여 주기 위한 것입니다. 실제 채점기를 검증한 결과가 아닙니다.

| 지표        | 의미                                                                             |
| ----------- | -------------------------------------------------------------------------------- |
| MAE / RMSE  | 채점기와 사람 점수의 평균 차이. RMSE는 크게 틀린 샘플에 더 민감합니다            |
| bias        | `채점기 − 사람`의 평균. 양수면 채점기가 사람보다 후합니다                        |
| within ±tol | 사람과 `tolerance` 이내인 샘플 비율                                              |
| agreement   | 채점기와 사람이 `threshold`의 같은 쪽(통과/실패)에 있는 비율                     |
| r           | 피어슨 상관계수. 순위는 맞는데 점수 눈금이 다른지 구분합니다 (정의 불가면 `n/a`) |

- 채점 호출이 한 번이라도 실패하거나 점수 JSON이 없으면 그 샘플은 **채점 불가**로 표시하고 지표에서 제외합니다. 일부만 성공한 값을 평균내서 일치율을 부풀리지 않기 위해서입니다.
- `--max-mae`를 주면 MAE 초과 또는 채점 불가 샘플이 있을 때 종료 코드 `1`로 끝납니다. 옵션이 없으면 보고만 합니다.
- 오차가 큰 샘플이 표 맨 위에 나오므로, 어떤 종류의 출력에서 채점기가 틀리는지 바로 볼 수 있습니다.

## 설계 결정

- **Provider를 쉘 명령으로**: 특정 SDK에 묶이지 않고, 어떤 CLI든 평가할 수 있게 했습니다. 테스트에서는 같은 `Provider` 함수 타입으로 가짜 구현을 주입합니다.
- **설정 오류는 실행 전에 잡기**: zod 스키마로 중복 id, 잘못된 정규식, `llm-rubric`인데 judge가 없는 경우를 **API를 호출하기 전에** 거부합니다. 비용이 드는 실행이 중간에 설정 문제로 실패하지 않게 하기 위해서입니다.
- **judge 실패는 fail-closed**: judge가 에러를 내거나 점수 JSON을 돌려주지 않으면 통과가 아니라 실패로 기록합니다. 평가 도구가 조용히 통과시키는 게 가장 위험하다고 봤습니다.
- **실행 결과는 JSON으로 저장**: 모든 시도의 원본 출력과 assertion별 이유를 남겨서, 점수만이 아니라 _왜_ 실패했는지 다시 볼 수 있습니다.
- **TypeScript 6 고정**: TS 7이 나왔지만 typescript-eslint가 아직 지원하지 않습니다. 컴파일러를 최신으로 올리는 것보다 `strictTypeChecked` 린트를 유지하는 쪽을 선택했습니다.

## 개발

```bash
pnpm check   # typecheck + lint + format:check + test
```

```
src/
├── cli.ts            # 진입점 (bin)
├── main.ts           # 인자 파싱, 명령 디스패치, 종료 코드
├── index.ts          # 라이브러리로 쓸 때의 공개 API
├── config/           # YAML 로딩 + zod 스키마
├── providers/        # Provider 타입, 쉘 명령 provider
├── assertions/       # assertion 평가, LLM judge 프롬프트·파싱
├── core/             # 실행(동시성 풀), 통계, 비교, 채점기 검증(calibrate)
├── store/            # 실행 결과 저장·로드
└── format/           # 터미널 표 출력
```

- TypeScript `strict` + `noUncheckedIndexedAccess`, ESLint `strictTypeChecked`
- 테스트: 단위 테스트(스키마, assertion, 통계, 비교, 동시성)와 실제 서브프로세스를 띄우는 CLI E2E 테스트
- CI: Node 22/24에서 typecheck → lint → format → test → build → 빌드된 CLI 스모크 테스트

## 라이선스

MIT
