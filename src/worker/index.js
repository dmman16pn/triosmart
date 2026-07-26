import { drainOnce } from './dispatch.js'
import { drainPendingPush } from './drainPendingPush.js'
import { cleanupEchoGuard } from '../core/echoGuard.js'

const INTERVAL_MS = 1000
const SLOW_EVERY = 30            // pending_push + dọn echo_guard mỗi 30 vòng (~30s)
let tick = 0
console.log('[worker] started')
async function loop() {
  try {
    const n = await drainOnce()
    if (n > 0) console.log(`[worker] processed ${n} events`)
    if (++tick % SLOW_EVERY === 0) {
      const r = await drainPendingPush()
      if (r > 0) console.log(`[worker] retried ${r} pending pushes`)
      await cleanupEchoGuard()
    }
  } catch (e) { console.error('[worker] drain failed', e) }
  setTimeout(loop, INTERVAL_MS)
}
loop()
