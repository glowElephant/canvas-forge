# MVP3a — 멀티모달 1단계 설계

- 날짜: 2026-06-10
- 상태: 설계 승인 (구현 진행)
- 전제: MVP2(실시간 협업) 완료. MVP3은 3a→3b→3c로 분할 승인됨.

## 1. 목표

보드에 올린 **이미지·텍스트 파일·링크**를 Claude가 제대로 읽게 한다. 원칙: "올리기"는 tldraw 기본 기능을 최대한 쓰고, 우리 작업의 본체는 **read_area의 모달리티별 추출**이다.

범위(3a): ① 이미지 개별 원본 전달 ② 텍스트 파일 카드(json/xml/yml/md 등) ③ 링크/북마크(unfurl + 본문 읽기).
제외(3b/3c): PDF, iframe 임의 URL 임베드, 보드 내/크로스 북마크, 영상 프레임 추출.

## 2. 모달리티별 설계

### 2.1 이미지 — 개별 원본 전달

- 올리기: 이미 동작 (tldraw 이미지 드롭 → `TLAssetStore.upload` → 호스트 `/uploads`).
- 읽기: `read_area`가 프레임 안 `type:'image'` shape들의 asset을 찾아 **원본 파일을 개별 image content로** 추가(스크린샷과 별개). 디스크(`assetsDir`)에서 직접 읽음 — HTTP 왕복 불필요.
- mime 처리: png/jpeg/gif/webp → image content. **svg → 이미지가 아니라 소스 텍스트로** 전달(Claude API image 미지원 형식).
- 외부 URL asset(src가 /uploads가 아님)은 스킵하고 텍스트로 URL만 안내.

### 2.2 텍스트 파일 카드

- 올리기: 커스텀 shape를 만들지 않는다 — **모든 shape가 가진 `meta` 필드**에 파일 정보를 싣는다(스키마 변경 없음 → sync 서버/클라 스키마 불일치 리스크 0).
  - 파일 드롭 시(`registerExternalContentHandler('files')`): 이미지면 기본 동작 위임, 텍스트류면 `/uploads`에 업로드 후 **geo(rectangle) shape + 파일명 라벨 + `meta.cfFile = { url, name, mime }`** 생성.
- 읽기: `read_area`가 `meta.cfFile` 있는 shape를 발견하면 디스크에서 내용을 읽어 텍스트로 포함(최대 길이 제한, 잘리면 표시).
- 대상 확장자: json/xml/yml/yaml/md/txt/csv/js/ts/html/css 등 텍스트 판정은 mime+확장자 화이트리스트.

### 2.3 링크/북마크

- 올리기: URL 붙여넣기 → tldraw 기본 bookmark shape. 제목·썸네일은 `registerExternalAssetHandler('url')` → 호스트 `/api/unfurl?url=` (서버가 HTML fetch해 og:title/description/image 파싱).
- 읽기: `read_area`가 프레임 안 bookmark shape의 URL을 서버에서 fetch(타임아웃·크기 제한, text/html만) → 태그 제거한 본문 발췌를 텍스트로 포함.
- 주의: 호스트가 임의 URL을 fetch하는 구조(SSRF 성격) — 로컬 협업 도구라는 전제로 허용하되 타임아웃 8s·응답 1MB·리다이렉트 3회 제한.

## 3. 구조

```
server/modalities.ts   [신규] 스냅샷→영역 내 모달리티 추출(순수) + 디스크/URL 읽기(IO 분리)
server/host.ts         [수정] /api/unfurl 추가
server/mcp.ts          [수정] read_area에 모달리티 파트 추가
src/external.ts        [신규] registerExternalContentHandler('files') + registerExternalAssetHandler('url')
src/App.tsx            [수정] onMount에서 external 등록
```

read_area 응답 구성(순서): 텍스트 요약 → 프레임 스크린샷 → 개별 이미지들 → 파일 내용들 → 링크 본문들. 각 파트에 출처 헤더(`[이미지: 파일명]`, `[파일: x.json]`, `[링크: url]`)를 달아 Claude가 출처를 구분하게 한다.

## 4. 테스트

- modalities 순수 함수: 가짜 스냅샷(image asset+shape, bookmark, meta.cfFile)에서 추출 정확성.
- e2e: temp uploads에 진짜 png/json 심고 read_area → image content + 파일 텍스트 포함. 테스트용 미니 HTTP 서버로 링크 본문 읽기 + /api/unfurl.
- 실 브라우저: 이미지 드롭/URL 붙여넣기/파일 카드 생성 후 read_area 확인 (가능 시).
