/* eslint-disable camelcase */
// merge_queue phải sống sót sau khi hồ sơ bị gộp/xóa (giữ 12 tháng — spec §5.6).
// FK CASCADE ban đầu làm dòng hàng đợi biến mất ngay khi xóa hồ sơ được gộp → bỏ FK.
export const up = (pgm) => {
  pgm.sql(`ALTER TABLE merge_queue
    DROP CONSTRAINT IF EXISTS merge_queue_candidate_a_fkey,
    DROP CONSTRAINT IF EXISTS merge_queue_candidate_b_fkey`)
}
export const down = () => { throw new Error('irreversible') }
