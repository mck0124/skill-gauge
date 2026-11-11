# 좋은 테스트 케이스 쓰는 법

## 1. 규칙 기반 assertion을 먼저, `llm-rubric`은 보조로

| 확인하고 싶은 것         | 쓸 assertion                         |
| ------------------------ | ------------------------------------ |
| 형식 (`feat(cli): ...`)  | `regex`                              |
| 길이 제한                | `max-length`                         |
| 금지 문구 ("Here is...") | `not-contains`                       |
| 구조화 출력              | `json`                               |
| 어조, 의도, 의미         | `llm-rubric` (규칙으로 못 잡을 때만) |

규칙 기반은 무료이고 결정적이라 흔들리지 않습니다. `llm-rubric`은 비용이 들고, 채점 모델 자체도 흔들립니다. 그래서 "형식은 규칙으로, 의미만 rubric으로" 나누면 어느 쪽이 실패했는지 바로 알 수 있습니다.

rubric은 하나의 기준만 묻도록 쓰세요. `"좋은 커밋 메시지인가?"`보다 `"제목이 명령형이고 --json 플래그를 언급하는가?"`가 일관된 점수를 줍니다.

규칙으로 못 잡아 `llm-rubric`을 쓰기로 했다면, 그 채점기를 **먼저 `calibrate`로 검증**하세요. 직접 점수를 매긴 20~50개 출력과 비교해서 MAE가 크거나 bias가 한쪽으로 치우쳐 있으면 rubric 문장을 고치거나 `threshold`를 조정해야 합니다. 검증하지 않은 채점기의 통과율은 참고용일 뿐입니다.

## 2. `repeat` 정하기

- 규칙이 명확한 Skill: `3`이면 충분합니다.
- 출력이 모호하거나 `flaky`가 보이는 Skill: `5~10`으로 늘리세요.
- 반복할수록 시간과 비용이 선형으로 늘어납니다. 먼저 `--case ID --repeat 10`으로 의심스러운 케이스만 깊게 돌리세요.

통과율 `67%`(3회 중 2회)는 표본이 작아서 실제로는 40%일 수도 90%일 수도 있습니다. 작은 `repeat`의 결과로 미세한 차이를 주장하지 마세요.

## 3. `threshold`와 `compare --threshold`

- `llm-rubric`의 `threshold` 기본값 `0.7`은 출발점입니다. 통과해야 할 출력과 실패해야 할 출력을 몇 개 직접 채점해 보고, 둘을 가르는 값으로 조정하세요.
- `compare --threshold`(기본 `0.1`)는 노이즈 허용치입니다. `repeat`가 작을수록 크게 잡아야 합니다. 너무 작으면 우연한 흔들림이 회귀로 보고됩니다.

## 4. 케이스 설계 팁

- 쉬운 케이스만 두면 항상 100%라서 개선도 회귀도 보이지 않습니다. **과거에 실제로 실패했던 입력**을 케이스로 추가하세요.
- 케이스 하나는 한 가지 행동만 검증하세요. 실패했을 때 원인이 바로 보입니다.
- `id`는 바꾸지 마세요. `compare`는 id로 전후를 맞춥니다.

## 5. CI에서 PR 게이트로 쓰기

```yaml
# .github/workflows/skill-gauge.yml
name: skill-gauge
on: pull_request

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile && pnpm build
      # base 브랜치의 Skill로 기준선 측정
      - run: |
          git checkout origin/${{ github.base_ref }} -- skills/
          node dist/cli.js run suite.yaml --out runs/base
          git checkout ${{ github.sha }} -- skills/
      # PR의 Skill 측정 후 비교. 회귀가 있으면 종료 코드 1로 실패
      - run: |
          node dist/cli.js run suite.yaml --out runs/head
          node dist/cli.js compare runs/base/*.json runs/head/*.json
```

종료 코드 `1`은 회귀(품질 문제), `2`는 설정 오류입니다. 워크플로에서 둘을 다르게 알리고 싶다면 코드를 확인하세요. 모델 API 키는 저장소 secret으로 넘기고, 비용이 신경 쓰이면 `--case`로 대표 케이스만 돌리세요.
