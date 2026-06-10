import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import { startHost, type RunningHost } from '../host.ts'

// 경로 탈출 방어 회귀 방지: 인코딩된 ../ 트래버설은 403, distDir 밖 파일을 못 읽는다.

let host: RunningHost | null = null
afterEach(async () => {
  await host?.close()
  host = null
})

function get(port: number, rawPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port, path: rawPath, method: 'GET' }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('정적 서빙 경로 탈출 방어', () => {
  it('인코딩된 ../ 트래버설은 403', async () => {
    host = await startHost({ port: 0 })
    const res = await get(host.port, '/%2e%2e/%2e%2e/package.json')
    expect(res.status).toBe(403)
    expect(res.body).not.toContain('"name": "canvas-forge"') // 실제 파일 내용 노출 안 됨
  })

  it('/api/invite가 초대 URL 목록을 반환한다', async () => {
    host = await startHost({ port: 0 })
    const res = await get(host.port, '/api/invite')
    expect(res.status).toBe(200)
    const { urls } = JSON.parse(res.body) as { urls: string[] }
    expect(Array.isArray(urls)).toBe(true)
    // LAN IP가 있는 머신이면 http://x.x.x.x:port 형태여야 한다
    for (const u of urls) expect(u).toMatch(new RegExp(`^http://\\d+\\.\\d+\\.\\d+\\.\\d+:${host.port}$`))
  })
})
