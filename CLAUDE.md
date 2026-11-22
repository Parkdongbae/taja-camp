# 타자 훈련소 (중1 정보 수업용 한글·영문 타자 연습)

기획 문서는 `docs/01~05` 에 있다. 구현 전 관련 문서를 읽을 것. 문서와 이 파일이 다르면 이 파일이 우선이다.

## 기술 구성
- Vite + React 19 + TypeScript(strict) + Tailwind v4(`src/index.css` 의 `@theme` 토큰: `mint-50~700`, `ink`, `miss`, `gold`) + react-router-dom v7 + zustand
- Firebase(Auth, Firestore, Realtime Database). **서버 함수·서비스 계정 없음**: 권한은 보안 규칙으로만 강제한다.
- `.env` 에 Firebase 설정이 없으면 데모 모드(`localBackend`)로 동작한다.
- 명령: `npm run dev`, `npm run build`(tsc 포함), `npm test`(vitest)

## 폴더와 소유
| 경로 | 내용 |
|---|---|
| `src/data/types.ts`, `src/data/backend.ts` | 공통 타입·데이터 인터페이스. **합의 없이 바꾸지 말 것**(필요하면 필드 추가만, 보고에 명시) |
| `src/data/index.ts` | `export const backend: Backend` (환경에 따라 firebase/local 선택) |
| `src/engine/` | 순수 로직(React·DOM·Firebase 의존 금지). 자모 분해, 판정, 단계, 점수, 배틀 일정. vitest 테스트 포함 |
| `src/content/` | 내장 기초 콘텐츠(`builtin.ts`)와 콘텐츠 로더 |
| `src/state/` | zustand 스토어(`useAuth`, `useSettings`, `usePrefs`) |
| `src/components/` | 공용 UI (가상 키보드, 손 실루엣, 모달 등) |
| `src/pages/` | 화면 |
| `content-data/` | 교과서 추출 콘텐츠 JSON. **git 에 올리지 않음**. 교사가 선생님 모드에서 업로드 |
| `교과서자료/` | 원본. **git 에 올리지 않음. README 등 공개 파일에 교과서·출판사 이름을 적지 말 것** |

## 핵심 규칙 (docs/01 요약 + 변경 사항)
- 학번은 **4자리**(학년1·반1·번호2). 예 `1315`.
- 자리연습·승급 테스트는 `KeyboardEvent.code` + `shiftKey` 로 물리 글쇠 판정. 낱말·단문·장문·배틀은 입력창 값을 자모열로 풀어 목표 자모열과 접두 비교.
- 타수 = 정타 수 ÷ 분. Shift 조합 2타. 정확도 = 정타 ÷ (정타+오타). 오타는 고쳐도 남는다.
- 자리 단계: 한글 K1~K8, 기호 S1~S2, 영문 E1~E7. 승급 테스트 50문항 90점 통과. 배틀 개방 = K8 + S2 통과.
- 배틀 점수(정수): **기본자리 낱말 1점, 한 단어 2점, 두 단어 4점**. 방 정원 16명, 같은 계급끼리. 반 전체 동시 접속은 30명 기준.
- 계급: 훈련병 0 / 이등병 100 / 일병 300 / 상병 600 / 병장 1000 / 예비역 1500 RP. 강등 없음.
- 키보드 종류(`KeyboardKind`: desktop / laptop / surface(서피스 고3 타입 커버))를 사용자가 고를 수 있다. 가상 키보드 그림만 달라지고 판정은 같다.
- UI 문구는 모두 한국어. 마우스 없이 Enter/Esc 로 진행 가능해야 한다. 소리는 기본 꺼짐.
- 붙여넣기 차단, `autocomplete/spellcheck/autocapitalize off`.

## 코드 규칙
- 주석은 한국어, 짧게. 파일 맨 위에 공개 API 를 요약하는 주석을 둔다.
- 다른 담당 영역의 파일은 수정하지 않는다. 필요하면 보고서에 요청 사항으로 적는다.
- 새 패키지를 추가하지 않는다.

## 이미 만들어진 공용 코드 (새로 만들지 말고 쓸 것)
- `src/engine` (index.ts 로 묶어 내보냄): 각 파일 맨 위 주석이 공개 API. 테스트 458건 통과 상태를 유지할 것.
- `src/data/index.ts` 의 `backend`, `src/state/auth.ts` 의 `useAuth()`({ready,user,student,settings}), `src/state/prefs.ts` 의 `usePrefs()`, `src/content/index.ts`(useContent, pickWords 등).
- `src/state/record.ts`: 연습이 끝나면 반드시 `finishSession(rec, extra?)` 로 저장(배틀은 `finishBattle`). 학생 문서를 화면에서 직접 고치지 않는다(자리 연습 단계 완료 표시 `stageDrill` 만 예외로 `backend.updateStudent`).
- `src/components/ui.tsx`(Modal, Btn, Card, Stat, Spinner, Kbd), `TierBadge.tsx`, `AppShell.tsx`(상단 바는 이미 있으므로 화면은 본문만 그린다. 본문 영역 높이는 `h-full`).
- 그림: `/mascot-login.png`, `/mascot-promote.png`(승급·진급 축하 창용, 정사각형).
- 라우트는 `src/App.tsx` 에 이미 등록됨. 각 화면 파일은 default export.
- 학생 문서에는 `quizPoints`(뜻 맞추기 퀴즈 누적 점수)가 있고, 옛 문서에는 없을 수 있으니 `?? 0` 으로 읽는다.
