import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

function applyParsed(parsed: Record<string, string> | undefined): string[] {
  if (!parsed) return []
  // Some local dev tools (e.g. vestauth) wrap dotenv and stop it from
  // populating process.env — assign parsed values explicitly to be safe.
  for (const [k, v] of Object.entries(parsed)) {
    process.env[k] = v
  }
  return Object.keys(parsed)
}

function loadDotenv(): { source: string; keys: string[] } | null {
  // 1) Default cwd-based lookup
  const cwdResult = dotenv.config()
  const cwdKeys = applyParsed(cwdResult.parsed)
  if (cwdKeys.length) return { source: 'cwd', keys: cwdKeys }

  // 2) Walk upwards from this file (Vite compiles to node_modules/.vite-temp/,
  //    so the project root is a few levels up).
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, '.env')
    if (existsSync(candidate)) {
      const r = dotenv.config({ path: candidate })
      const keys = applyParsed(r.parsed)
      if (keys.length) return { source: candidate, keys }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

const loaded = loadDotenv()
if (loaded) {
  console.log(`[ParkProof] .env loaded from ${loaded.source}: ${loaded.keys.join(', ')}`)
} else {
  console.warn('[ParkProof] .env not found — ANTHROPIC_API_KEY will be missing')
}
console.log(
  `[ParkProof] ANTHROPIC_API_KEY present: ${!!process.env.ANTHROPIC_API_KEY}` +
    (process.env.ANTHROPIC_API_KEY ? ` (len=${process.env.ANTHROPIC_API_KEY.length})` : ''),
)

function signTranslateApi(): Plugin {
  return {
    name: 'parkproof-sign-translate',
    configureServer(server) {
      server.middlewares.use('/api/sign-translate', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        try {
          const { translateSign } = await import('./lambda/index.js')

          const chunks: Buffer[] = []
          for await (const chunk of req) {
            chunks.push(chunk as Buffer)
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))

          const result = await translateSign(body)
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(result))
        } catch (err) {
          const e = err as Error & { status?: number }
          console.error('[/api/sign-translate]', e)
          res.statusCode = e.status || 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: e.message || String(err) }))
        }
      })

      server.middlewares.use('/api/sign-session', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        try {
          const lambda = await import('./lambda/index.js')
          const chunks: Buffer[] = []
          for await (const chunk of req) {
            chunks.push(chunk as Buffer)
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          const result = await lambda.handler({
            requestContext: { http: { method: 'POST', path: '/sign-session' } },
            body: JSON.stringify(body),
          })
          res.statusCode = result.statusCode
          if (result.headers) {
            for (const [k, v] of Object.entries(result.headers)) {
              res.setHeader(k, v as string)
            }
          }
          res.end(result.body)
        } catch (err) {
          const e = err as Error & { status?: number }
          console.error('[/api/sign-session]', e)
          res.statusCode = e.status || 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: e.message || String(err) }))
        }
      })

      server.middlewares.use('/api/draft-appeal', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        try {
          const lambda = await import('./lambda/index.js')
          const chunks: Buffer[] = []
          for await (const chunk of req) {
            chunks.push(chunk as Buffer)
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          // The Lambda dispatches by path; emulate that by hand-calling handler
          // with a synthetic event so we exercise the same code path as prod.
          const result = await lambda.handler({
            requestContext: { http: { method: 'POST', path: '/draft-appeal' } },
            body: JSON.stringify(body),
          })
          res.statusCode = result.statusCode
          if (result.headers) {
            for (const [k, v] of Object.entries(result.headers)) {
              res.setHeader(k, v as string)
            }
          }
          res.end(result.body)
        } catch (err) {
          const e = err as Error & { status?: number }
          console.error('[/api/draft-appeal]', e)
          res.statusCode = e.status || 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: e.message || String(err) }))
        }
      })

      // ── Auth-required routes (cloud sync) ──
      // In production, API Gateway's JWT authorizer validates the JWT and
      // injects claims at event.requestContext.authorizer.jwt.claims. In dev,
      // we decode the JWT WITHOUT verifying its signature — the user is hitting
      // their own localhost with their own token; trusting the bearer locally
      // is reasonable for development speed. Production code path is unchanged.
      const decodeDevJwt = (req: import('node:http').IncomingMessage) => {
        const auth = req.headers['authorization']
        if (!auth || Array.isArray(auth)) return null
        const m = /^Bearer\s+(.+)$/i.exec(auth)
        if (!m) return null
        try {
          const parts = m[1].split('.')
          if (parts.length !== 3) return null
          const payload = Buffer.from(parts[1], 'base64url').toString('utf8')
          return JSON.parse(payload)
        } catch {
          return null
        }
      }

      const authRoutes: Array<{ path: string; methods: readonly string[] }> = [
        { path: '/api/sessions/upload', methods: ['POST'] },
        { path: '/api/sessions/list',   methods: ['GET', 'POST'] },
        { path: '/api/sessions/delete', methods: ['POST'] },
        { path: '/api/photos/presign',  methods: ['POST'] },
        { path: '/api/me/export',       methods: ['GET', 'POST'] },
        { path: '/api/me/delete',       methods: ['POST'] },
      ]
      for (const route of authRoutes) {
        server.middlewares.use(route.path, async (req, res) => {
          if (req.method === 'OPTIONS') {
            res.statusCode = 204
            res.end()
            return
          }
          if (!route.methods.includes(req.method ?? 'POST')) {
            res.statusCode = 405
            res.end()
            return
          }
          try {
            const claims = decodeDevJwt(req)
            if (!claims) {
              res.statusCode = 401
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Missing or unreadable Authorization header' }))
              return
            }
            const chunks: Buffer[] = []
            for await (const chunk of req) chunks.push(chunk as Buffer)
            const bodyStr = chunks.length ? Buffer.concat(chunks).toString('utf8') : ''
            const lambda = await import('./lambda/index.js')
            const result = await lambda.handler({
              requestContext: {
                http: { method: req.method, path: route.path.replace(/^\/api/, '') },
                authorizer: { jwt: { claims } },
              },
              body: bodyStr,
            })
            res.statusCode = result.statusCode
            if (result.headers) {
              for (const [k, v] of Object.entries(result.headers)) {
                res.setHeader(k, v as string)
              }
            }
            res.end(result.body)
          } catch (err) {
            console.error(`[${route.path}]`, err)
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: (err as Error)?.message || String(err) }))
          }
        })
      }

      server.middlewares.use('/api/feedback', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) {
            chunks.push(chunk as Buffer)
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          const { verdict, feedback_id } = body as {
            verdict?: string
            feedback_id?: string
          }
          if (verdict !== 'correct' && verdict !== 'retake') {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'verdict must be "correct" or "retake"' }))
            return
          }
          if (typeof feedback_id !== 'string' || !feedback_id) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'feedback_id required' }))
            return
          }
          console.log(
            `[parkproof.feedback] ${JSON.stringify({
              verdict,
              feedback_id,
              timestamp: new Date().toISOString(),
            })}`,
          )
          res.statusCode = 204
          res.end()
        } catch (err) {
          console.error('[/api/feedback]', err)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: String(err) }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    signTranslateApi(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'ParkProof',
        short_name: 'ParkProof',
        description:
          'Aussie parking, decoded. Photograph a sign, get a plain-English answer, save evidence in case of a wrongful ticket.',
        theme_color: '#275BFF',
        background_color: '#F2F4F7',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Don't cache API responses — the sign translator should always hit Lambda live.
        navigateFallbackDenylist: [/^\/sign-translate/, /^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
    }),
  ],
})
