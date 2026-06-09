import { createRoot } from 'react-dom/client'
import App from './App'

// StrictMode는 일부러 쓰지 않는다 — dev에서 onMount가 2번 호출돼 WS가 중복 연결되는 것을 피한다.
createRoot(document.getElementById('root')!).render(<App />)
