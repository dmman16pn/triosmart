import { describe, it, expect } from 'vitest'
import { normalizePhone } from '../src/core/phone.js'

describe('normalizePhone', () => {
  it('giữ nguyên số 10 chữ số bắt đầu bằng 0', () => {
    expect(normalizePhone('0912345678')).toEqual({ normalized: '0912345678', valid: true })
  })
  it('bỏ ký tự không phải số', () => {
    expect(normalizePhone('091 234-5678')).toEqual({ normalized: '0912345678', valid: true })
  })
  it('chuyển 84xxxxxxxxx (11 số) thành 0xxxxxxxxx', () => {
    expect(normalizePhone('84912345678')).toEqual({ normalized: '0912345678', valid: true })
  })
  it('chuyển +84 thành 0', () => {
    expect(normalizePhone('+84 912 345 678')).toEqual({ normalized: '0912345678', valid: true })
  })
  it('thêm 0 cho số 9 chữ số không bắt đầu bằng 0', () => {
    expect(normalizePhone('912345678')).toEqual({ normalized: '0912345678', valid: true })
  })
  it('trả valid=false cho số quá ngắn', () => {
    expect(normalizePhone('12345')).toEqual({ normalized: null, valid: false })
  })
  it('trả valid=false cho số 11 chữ số không phải 84', () => {
    expect(normalizePhone('09123456789')).toEqual({ normalized: null, valid: false })
  })
  it('trả valid=false cho chuỗi rỗng / null / undefined', () => {
    expect(normalizePhone('')).toEqual({ normalized: null, valid: false })
    expect(normalizePhone(null)).toEqual({ normalized: null, valid: false })
    expect(normalizePhone(undefined)).toEqual({ normalized: null, valid: false })
  })
})
