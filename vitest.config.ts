import { defineConfig } from 'vitest/config'

// 서버 측 테스트(node 환경). 프론트는 빌드로 검증한다.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts'],
  },
})
