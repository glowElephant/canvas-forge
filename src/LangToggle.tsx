import { setLang, t, useLang } from './i18n'

// KO/EN 토글 버튼. 현재 언어의 반대로 전환.
// TopBar(보드)와 NameGate(입장 전) 양쪽에서 사용 → 입장 전에도 언어를 바꿀 수 있다.
export function LangToggle({ style }: { style?: React.CSSProperties }) {
  const lang = useLang()
  const next = lang === 'ko' ? 'en' : 'ko'
  return (
    <button
      onClick={() => setLang(next)}
      title={t('lang.toggle_hint')}
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        border: 'none',
        background: 'rgba(255,255,255,0.92)',
        color: '#111',
        cursor: 'pointer',
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        font: '12px/1.4 system-ui, sans-serif',
        fontWeight: 600,
        ...style,
      }}
    >
      {lang === 'ko' ? 'EN' : '한'}
    </button>
  )
}
