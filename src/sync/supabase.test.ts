import { describe, expect, it } from 'vitest'
import { isAllowedOwnerEmail, loginEmailErrorMessage, normalizePublicAppUrl, validateNewPassword } from './supabase'

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

describe('登录邮件错误提示', () => {
  it('明确提示邮件发送频率限制', () => {
    expect(loginEmailErrorMessage({ code: 'over_email_send_rate_limit', status: 429 })).toContain('1分钟')
    expect(loginEmailErrorMessage({ status: 429 })).toContain('过于频繁')
  })

  it('区分邮件提供商关闭和未知错误', () => {
    expect(loginEmailErrorMessage({ code: 'email_provider_disabled', status: 422 })).toContain('认证设置')
    expect(loginEmailErrorMessage({ code: 'unexpected', status: 500 })).toContain('检查邮箱')
  })
})

describe('同步密码', () => {
  it('接受一致且包含字母和数字的长密码', () => {
    expect(validateNewPassword('long-sync-pass-2026', 'long-sync-pass-2026')).toBe('long-sync-pass-2026')
  })

  it('拒绝不一致、过短或组成单一的密码', () => {
    expect(() => validateNewPassword('long-sync-pass-2026', 'different-pass-2026')).toThrow('不一致')
    expect(() => validateNewPassword('short1', 'short1')).toThrow('12至128')
    expect(() => validateNewPassword('onlyletterslong', 'onlyletterslong')).toThrow('字母和一个数字')
  })
})
