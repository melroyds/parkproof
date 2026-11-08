import { describe, expect, it } from 'vitest'
import { createLimiter } from './concurrency'

const tick = () => new Promise((r) => setTimeout(r, 1))

describe('createLimiter', () => {
  it('runs at most `limit` tasks at once, in arrival order, and passes results and errors through', async () => {
    const run = createLimiter(2)
    let active = 0
    let peak = 0
    const started: number[] = []
    const task = (n: number) => async () => {
      started.push(n)
      active++
      peak = Math.max(peak, active)
      await tick()
      active--
      if (n === 3) throw new Error('three')
      return n * 10
    }
    const results = await Promise.allSettled([1, 2, 3, 4, 5].map((n) => run(task(n))))
    expect(peak).toBe(2)
    expect(started).toEqual([1, 2, 3, 4, 5])
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : (r.reason as Error).message))).toEqual([10, 20, 'three', 40, 50])
  })

  it('a task that throws synchronously still frees its slot', async () => {
    const run = createLimiter(1)
    await expect(
      run(() => {
        throw new Error('sync')
      }),
    ).rejects.toThrow('sync')
    await expect(run(async () => 'next')).resolves.toBe('next')
  })
})
