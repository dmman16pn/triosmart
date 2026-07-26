import { createApp } from './app.js'
import { config } from '../config.js'

createApp().listen(config.receiverPort, config.bindHost, () =>
  console.log(`[receiver] listening :${config.receiverPort}`))
