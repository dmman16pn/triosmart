import { drainOnce } from './dispatch.js'

const INTERVAL_MS = 1000
console.log('[worker] started')
async function loop() {
  try {
    const n = await drainOnce()
    if (n > 0) console.log(`[worker] processed ${n} events`)
  } catch (e) { console.error('[worker] drain failed', e) }
  setTimeout(loop, INTERVAL_MS)
}
loop()
