import { createApp } from './app.js'
import { config } from '../config.js'

createApp().listen(config.receiverPort, () =>
  console.log(`[receiver] listening :${config.receiverPort}`))
