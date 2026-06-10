# MVP3b — PDF·iframe 임베드·보드 내 위치 북마크 설계

- 날짜: 2026-06-10
- 상태: 설계 승인 (구현 진행)
- 전제: MVP3a(이미지 원본·파일 카드·링크 읽기) 완료.

## 1. PDF 추출

- **올리기**: PDF 드롭 → MVP3a 파일 카드 경로 재사용(`/uploads` 업로드 + note shape + `meta.cfFile`, mime `application/pdf`). 클라 `isTextLike`에 PDF 분기 추가.
- **읽기**: 서버에서 텍스트 추출 — `unpdf`(pdf.js 기반, Node 서버리스 친화·worker 불필요) 사용. `read_area`가 `meta.cfFile`의 mime이 PDF면 추출 텍스트(16k자 제한)로 반환. 추출 실패 시 실패 사유 텍스트.

## 2. iframe 임베드 (임의 URL)

- tldraw embed shape는 화이트리스트(유튜브 등) 기반 — **catch-all "webpage" 임베드 정의**를 목록 끝에 추가해 임의 http(s) URL을 iframe으로 띄울 수 있게 한다(`<Tldraw embeds={...}>`).
- UX: URL 붙여넣기는 기존대로 **북마크**(unfurl) 유지. iframe은 의도적 행동 — 메뉴의 Insert Embed(임베드 삽입)로 생성.
- 한계(명시): 상대 사이트가 `X-Frame-Options`/CSP로 프레이밍을 막으면 빈 화면 — 임베드 정의로 해결 불가, 그 경우 북마크 사용.
- **읽기**: embed shape의 `props.url`은 MVP3a에서 이미 링크로 읽힌다 — 추가 작업 없음.

## 3. 보드 내 위치 북마크 (영역 내비게이션)

- **영역 패널**: 우상단에 영역(프레임) 목록 패널. 클릭 → 해당 프레임으로 카메라 이동(zoomToBounds). 큰 보드 내비게이션의 기본기.
- **위치 핀 shape**: 패널의 📍 버튼 → 뷰포트 중앙에 핀(note + `meta.cfGoto = { targetId }`, 라벨 "📍 영역명") 생성. 핀 클릭(드래그 아님) → 대상 프레임으로 점프. 스키마 변경 없음(meta 사용, MVP3a와 동일 패턴).
- **읽기**: `read_area`가 핀을 만나면 `[위치 북마크 → '제목' (frameId)]`로 알려 Claude가 해당 영역을 `read_area`로 따라가 읽을 수 있게 한다(자동 인라인은 안 함 — 순환 참조·중복 방지).

## 4. 구조 변화

```
server/modalities.ts   [수정] pdfs·gotoPins 분류 + extractPdfText(unpdf)
server/mcp.ts          [수정] read_area에 PDF 텍스트·핀 안내 추가
src/external.tsx       [수정] PDF 드롭 분기
src/embeds.ts          [신규] catch-all webpage 임베드 정의
src/AreaPanel.tsx      [신규] 영역 목록 패널 + 핀 생성 + 핀 클릭 점프
src/App.tsx            [수정] embeds prop + AreaPanel 장착
```

## 5. 테스트

- PDF: 미니 PDF 픽스처에서 추출 텍스트 확인 + read_area e2e에 PDF 파일 카드 포함.
- 핀: extractAreaModalities가 cfGoto 분류, read_area 출력에 대상 제목 포함.
- 임베드 정의·패널은 실 브라우저 검증 (catch-all URL이 embed shape 생성, 패널 클릭 이동·핀 점프).
