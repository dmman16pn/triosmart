import { backfillPos } from './backfill.js'
export const initialSyncPos = (connectionId) => backfillPos(connectionId, { full: true })
