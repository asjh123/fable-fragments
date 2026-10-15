import { describe, expect, it } from 'vitest'
import { isAllowedOwnerEmail, normalizePublicAppUrl } from './supabase'

describe('公开网址规范化', () => {
  it.each([
    [undefined, 'http://localhost:5173/settings', '/', 'http://localhost:5173/'],
    [undefined, 'https://name.github.io/repo/settings', '/repo/', 'https://name.github.io/repo/'],
    ['https://example.com/app', 'https://ignored.test/', '/', 'https://example.com/app/'],
    ['https://example.com/', 'https://ignored.test/', '/repo/', 'https://example.com/']
  ])('保留根路径或GitHub Pages子路径', (configured, href, base, expected) => {
    expect(normalizePublicAppUrl(configured, href, base)).toBe(expected)
  })
  it('拒绝非HTTP协议', () => expect(() => normalizePublicAppUrl('javascript:alert(1)', 'https://example.com/', '/')).toThrow('http或https'))
  it('拒绝无法解析的配置', () => expect(() => normalizePublicAppUrl('not a url', 'https://example.com/', '/')).toThrow())
  it('只允许配置的唯一邮箱且忽略大小写和首尾空格', () => {
    expect(isAllowedOwnerEmail(' Owner@Example.com ', 'owner@example.com')).toBe(true)
    expect(isAllowedOwnerEmail('other@example.com', 'owner@example.com')).toBe(false)
    expect(isAllowedOwnerEmail('owner@example.com', '')).toBe(false)
  })
})
