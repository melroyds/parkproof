/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Vitest configuration.
 *
 * Test strategy: see docs/testing.md. TL;DR — we don't chase 100% coverage,
 * we cover the *failure surface that would actually hurt users*: the time
 * math that drives every countdown, the localStorage quota recovery, the
 * timezone-aware formatting, the Lambda's text-only refresh-mode reasoning.
 * React component rendering details + Claude API call paths are deliberately
 * out of scope — they have low signal-to-test-noise ratio at this stage.
 *
 * Two environments:
 *   - happy-dom for src/* (lightweight DOM impl; faster than jsdom)
 *   - node for lambda/* tests (no DOM, mirrors Lambda runtime)
 *
 * Vitest picks the env per-test-file based on a `// @vitest-environment`
 * comment at the top, or falls back to the global default below.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    // happy-dom is enough for everything in src/; Lambda tests opt out via
    // an in-file directive when they don't need a DOM at all.
    environment: 'happy-dom',
    globals: true,
    // Co-located *.test.ts files next to source — Vite/Vitest convention.
    // Tests in /lambda are also picked up so the Lambda's refresh-mode
    // logic gets the same exercise.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'lambda/**/*.test.ts', 'lambda/**/*.test.js'],
    // Reset between tests — keeps localStorage / timers clean.
    clearMocks: true,
    restoreMocks: true,
    // Coverage is opt-in via `npm run test:coverage`. Don't run it on every
    // push — slow + noisy. The headline metric we care about is "do critical
    // paths pass", not "what's the line %".
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**', 'lambda/index.js'],
      exclude: ['**/*.d.ts', '**/*.test.*'],
    },
  },
})
