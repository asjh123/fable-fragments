import { describe, expect, it } from 'vitest'
import { bayesianStory } from '../content/bayesian'
import { selfHealingStory } from '../content/selfHealing'
import { assertNoPrematureReveal, contentKey, contentPackSchema, parseContentPack } from './content'

describe('内容包规范', () => {
  it('两个示例内容通过严格校验且揭晓前不泄题', () => {
    for (const pack of [selfHealingStory, bayesianStory]) {
      expect(contentPackSchema.parse(pack)).toEqual(pack)
      expect(assertNoPrematureReveal(pack)).toEqual([])
    }
  })

  it('拒绝未知字段和危险网页标签', () => {
    expect(() => parseContentPack({ ...bayesianStory, unknown: true })).toThrow()
    expect(() => parseContentPack({ ...bayesianStory, hiddenTitle: '<script>alert(1)</script>' })).toThrow()
  })

  it('内容版本形成不同不可变键', () => {
    expect(contentKey('story', 1)).not.toBe(contentKey('story', 2))
  })
})

