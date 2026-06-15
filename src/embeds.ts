import { DEFAULT_EMBED_DEFINITIONS, type TLEmbedDefinition } from 'tldraw'
import { t } from './i18n'

// catch-all 웹페이지 임베드 (MVP3b): 알려진 제공자(유튜브 등)에 안 걸리는 모든 http(s) URL을
// iframe으로 띄울 수 있게 한다. 목록 "끝"에 둬서 알려진 제공자가 먼저 매칭되게 함.
// 한계: 상대 사이트가 X-Frame-Options/CSP로 프레이밍을 막으면 빈 화면 — 그 경우 북마크(URL 붙여넣기)를 쓸 것.

const webpageEmbed: TLEmbedDefinition = {
  type: 'webpage',
  title: t('embed.webpage_title'),
  hostnames: ['*'],
  width: 800,
  height: 600,
  doesResize: true,
  toEmbedUrl: (url) => (/^https?:\/\//.test(url) ? url : undefined),
  fromEmbedUrl: (url) => (/^https?:\/\//.test(url) ? url : undefined),
  // CustomEmbedDefinition은 icon 필수 — 단순 지구본 모양 inline svg
  icon:
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23555" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18"/></svg>',
    ),
}

export const embedDefinitions: TLEmbedDefinition[] = [...DEFAULT_EMBED_DEFINITIONS, webpageEmbed]
