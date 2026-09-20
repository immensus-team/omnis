# Gate: A1-⑥ Outlook Graph delta

- **질문**: `/me/mailFolders/inbox/messages/delta` 폴링이 문서대로 `@odata.nextLink`/`@odata.deltaLink`/410을 돌려주는가?
- **소유 부록**: A1 §2.4
- **Owner**: agent
- **Host**: mini
- **실행일**: PENDING — B-D5(실계정 연결은 나중에 한 번에, Logan 2026-09-20 결정) 이후
- **결과(Pass/Fail)**: PENDING
- **측정치/근거**: `probe.ts`를 실제 access token으로 실행해 채운다
- **decided_by**: PENDING
- **비고**: 이 플랜(US-B37)의 어댑터 구현은 fixture/mock으로 이미 인수됨 — 이 스파이크는 실연결 검증용이지 구현 게이트가 아니다
