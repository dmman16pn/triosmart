import { createApiApp } from './app.js'
import { config } from '../config.js'

createApiApp().listen(config.apiPort, config.bindHost, () =>
  console.log(`[api] listening :${config.apiPort}`))
