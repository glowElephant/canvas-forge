import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 프론트엔드 빌드 설정. 출력은 dist/ — host 프로세스가 이 정적 파일을 서빙한다.
export default defineConfig({
  plugins: [react()],
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
