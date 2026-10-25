// A small concurrency limit for photo transfers (T0b4): uploads, cloud
// fetches and PDF materialisation each run at most a few at a time, so a
// fresh device opening History, or a full export, doesn't fire one request
// per photo at once.

/** Runs the tasks it is given, at most `limit` at a time, in the order they arrive. */
export type Limiter = <T>(task: () => Promise<T>) => Promise<T>

export function createLimiter(limit: number): Limiter {
  const max = Math.max(1, Math.floor(limit))
  let active = 0
  const waiting: Array<() => void> = []
  const next = () => {
    if (active >= max) return
    const start = waiting.shift()
    if (start) {
      active++
      start()
    }
  }
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        let result: Promise<T>
        try {
          result = Promise.resolve(task())
        } catch (err) {
          result = Promise.reject(err)
        }
        result.then(resolve, reject).finally(() => {
          active--
          next()
        })
      })
      next()
    })
}
