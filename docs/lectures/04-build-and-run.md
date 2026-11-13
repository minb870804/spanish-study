# 4. 구조와 실행 — 강의 학습

기술 구성은 기존 Minb 그대로(HTML + 바닐라 JS, Firebase 로그인·Firestore, Vercel). 새 의존성 없음.

## 결정 로그
| # | 항목 | 선택 | 대안 | 이유 |
|---|---|---|---|---|
| 1 | 위치 | Minb 새 페이지 `lectures.html` + 하단 메뉴 "강의" | 별도 사이트 | 로그인·디자인·메뉴 재사용 |
| 2 | 강의 내용 저장 | Firestore(내 계정 전용, 쓰기는 관리자 도구만) | 저장소에 HTML | 저장소가 공개 — 정답이 노출됨 |
| 3 | 올리는 방법 | 공부 폴더 `_src/web/publish.mjs` (Claude가 "웹에 올려줘" 때 실행) | 스킬 끝에 자동 업로드 | 관련 없는 강의가 섞이지 않게 |
| 4 | 교육자료 표시 | PDF와 같은 HTML·CSS를 iframe에 그대로 | 앱 디자인으로 다시 그리기 | 원본 하나, 인쇄하면 PDF와 같은 모양 |
| 5 | 문제 뽑기 | 미리 만든 100문항에서 장별 비율 + 덜 본 문제 우선, 보기 순서 섞기 | 실시간 AI 생성 | 비용 0, 품질 검수 가능 |
| 6 | 주관식 점수 | 채점표 체크 합 ÷ 뽑힌 문항 만점 합 × 60 | 고정 배점 | 문항마다 배점이 달라도 공정 |
| 7 | 풀던 시험지 | 기기(localStorage) 즉시 + Firestore 0.8초 모아 쓰기 | Firestore만 | 새로고침·연결 끊김에도 유지 |

## 파일
- `lectures.html` — 화면 전부(목록·교육자료·시험). 위에서 아래로 읽으면 흐름이 보인다.
- `js/lecture-exam.js` — 계산만(뽑기·섞기·점수·HTML 정리). 화면과 저장을 모른다.
- `js/app-shell.js` — 하단 메뉴에 "강의" 추가.
- `firestore.rules` — `lectureCourses`, `lectures`, `lectureContent`(읽기만), `lectureState`, `lectureAttempts`(본인).
- `tests/lectures.cjs` — 가짜 Firebase로 화면 전체를 돌려 보는 테스트. 실제 강의 내용은 넣지 않는다.

## 테스트
```sh
MINB_PLAYWRIGHT=<playwright 경로> node tests/lectures.cjs
```

## 새 강의 올리기 (공부 폴더 `~/Documents/MINB/study/_src`)
1. `/lecture-study-pack`으로 PDF 3종 + `L{N}_bank.json`(100문항) 만들기
2. `web/courses.json`의 강좌 `lectures`에 번호와 주제 추가
3. `node web/publish.mjs N --dry` 로 검사 → `node web/publish.mjs N` 으로 올리기
4. 앱의 강의 메뉴 새로고침
