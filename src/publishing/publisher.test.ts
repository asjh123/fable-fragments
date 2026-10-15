import { describe, expect, it } from 'vitest'
import { bayesianStory } from '../content/bayesian'
import { calculateContentHash } from '../domain/contentHash'
import { MemoryContentPublisher } from './publisher'

describe('内容发布接口', () => {
  it('发布幂等，但拒绝同版本不同哈希', async () => {
    const publisher = new MemoryContentPublisher()
    expect((await publisher.publish(bayesianStory)).created).toBe(true)
    expect((await publisher.publish(bayesianStory)).created).toBe(false)
    const changed = { ...bayesianStory, conceptExplanation: `${bayesianStory.conceptExplanation}修订`, contentHash: '' }
    changed.contentHash = await calculateContentHash(changed)
    await expect(publisher.publish(changed)).rejects.toThrow('禁止覆盖')
  })
  it('拒绝未审核草稿', async () => {
    const publisher = new MemoryContentPublisher()
    await expect(publisher.publish({ ...bayesianStory, status: 'draft', contentHash: '' })).rejects.toThrow('只有经过审核')
  })
  it('拒绝正文被修改但仍沿用旧哈希的内容', async () => {
    const publisher = new MemoryContentPublisher()
    await expect(publisher.publish({ ...bayesianStory, conceptExplanation: `${bayesianStory.conceptExplanation}篡改` })).rejects.toThrow('哈希不匹配')
  })
})
