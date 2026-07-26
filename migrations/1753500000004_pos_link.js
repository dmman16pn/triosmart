/* eslint-disable camelcase */
// Pancake Chat page_customer có trường customer_id trỏ thẳng sang khách POS —
// kênh ghép chính xác nhất (100), cần giá trị match_method riêng.
export const up = (pgm) => {
  pgm.sql(`ALTER TABLE customer_identity DROP CONSTRAINT IF EXISTS customer_identity_match_method_check`)
  pgm.sql(`ALTER TABLE customer_identity ADD CONSTRAINT customer_identity_match_method_check
    CHECK (match_method IN ('phone','fb_id','manual','first_seen','pos_link'))`)
}
export const down = () => { throw new Error('irreversible') }
