import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 프론트엔드 빌드 설정. 출력은 dist/ — host 프로세스가 이 정적 파일을 서빙한다.
export default defineConfig({
  plugins: [react()],
  // 화면에 표시되는 빌드 스탬프 — 탭이 옛 번들을 돌리는지 즉시 판별용 (로컬 시간, UTC 아님)
  define: {
    __BUILD_ID__: JSON.stringify(
      new Date().toLocaleString('sv-SE', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
    ),
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'index.html',
        stock: 'stock.html', // 진단용 순정 tldraw 페이지
      },
    },
  },
})
