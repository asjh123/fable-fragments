import { z } from 'zod'

const dangerousMarkup = /<\s*\/?\s*(script|iframe|object|embed|svg|img|style|link|meta)[\s>]/i

export const safeText = (max: number) =>
  z.string().trim().min(1).max(max).refine((value) => !dangerousMarkup.test(value), {
    message: '内容包含不允许的网页标签'
  })

export const contentKey = (contentId: string, version: number) => `${contentId}@${version}`

export const fragmentKindSchema = z.enum([
  'opening',
  'conflict',
  'clue',
  'reveal',
  'explanation',
  'mapping',
  'quiz'
])

export const fragmentSchema = z.object({
  fragmentId: z.string().regex(/^[a-z0-9-]{2,64}$/i),
  kind: fragmentKindSchema,
  eyebrow: safeText(40),
  title: safeText(80),
  body: safeText(4000),
  estimatedMinutes: z.number().int().min(1).max(10)
}).strict()

export const sourceSchema = z.object({
  title: safeText(240),
  publisher: safeText(120),
  url: z.string().url().max(1000),
  sourceType: z.enum(['论文', '官方技术资料', '标准机构资料', '大学教材', '专利原文']),
  patentPublicationNumber: z.string().trim().max(120).optional(),
  retrievedAt: z.string().date().optional()
}).strict()

export const quizSchema = z.object({
  question: safeText(500),
  options: z.array(safeText(300)).min(2).max(6),
  correctIndex: z.number().int().nonnegative(),
  explanation: safeText(1000)
}).strict().refine((quiz) => quiz.correctIndex < quiz.options.length, {
  message: '正确答案序号超出选项范围',
  path: ['correctIndex']
})

export const contentPackSchema = z.object({
  contentId: z.string().regex(/^[a-z0-9-]{3,80}$/i),
  version: z.number().int().positive(),
  schemaVersion: z.literal(1).default(1),
  status: z.enum(['draft', 'reviewed', 'published', 'rejected', 'retired']),
  hiddenTitle: safeText(80),
  revealedTitle: safeText(120),
  domain: safeText(80),
  subdomain: safeText(80),
  difficulty: z.enum(['入门', '进阶', '研究生']),
  estimatedMinutes: z.number().int().min(3).max(90),
  forbiddenBeforeReveal: z.array(safeText(60)).min(1).max(20),
  fragments: z.array(fragmentSchema).length(7),
  conceptExplanation: safeText(5000),
  metaphorMappings: z.array(z.object({ metaphor: safeText(200), meaning: safeText(500) }).strict()).min(2).max(12),
  applicableBoundaries: z.array(safeText(500)).min(1).max(12),
  commonMisunderstandings: z.array(safeText(500)).min(1).max(12),
  engineeringTransfer: safeText(3000),
  quiz: quizSchema,
  sources: z.array(sourceSchema).min(1).max(12),
  sourceReferences: z.array(sourceSchema).max(20).default([]),
  factClaims: z.array(safeText(1000)).max(50).default([]),
  inferences: z.array(safeText(1000)).max(50).default([]),
  factCheckStatus: z.enum(['【事实】', '【推论】', '【建议】', '【未经核实】']),
  generatedAt: z.string().datetime().default('1970-01-01T00:00:00.000Z'),
  reviewedAt: z.string().datetime().nullable().default(null),
  publishedAt: z.string().datetime().nullable().default(null),
  contentHash: z.string().regex(/^$|^[a-f0-9]{64}$/).default(''),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict().superRefine((pack, context) => {
  const kinds = pack.fragments.map((fragment) => fragment.kind)
  const expected = ['opening', 'conflict', 'clue', 'reveal', 'explanation', 'mapping', 'quiz']
  if (kinds.some((kind, index) => kind !== expected[index])) {
    context.addIssue({ code: 'custom', path: ['fragments'], message: '七个片段的顺序不符合内容规范' })
  }
})

export type ContentPack = z.infer<typeof contentPackSchema>
export type FragmentKind = z.infer<typeof fragmentKindSchema>

export function assertNoPrematureReveal(pack: ContentPack): string[] {
  const revealIndex = pack.fragments.findIndex((fragment) => fragment.kind === 'reveal')
  const visibleBeforeReveal = [pack.hiddenTitle, ...pack.fragments.slice(0, revealIndex).flatMap((fragment) => [fragment.eyebrow, fragment.title, fragment.body])]
  return pack.forbiddenBeforeReveal.filter((word) =>
    visibleBeforeReveal.some((text) => text.toLocaleLowerCase('zh-CN').includes(word.toLocaleLowerCase('zh-CN')))
  )
}

export function parseContentPack(input: unknown): ContentPack {
  const pack = contentPackSchema.parse(input)
  const leakedWords = assertNoPrematureReveal(pack)
  if (leakedWords.length > 0) {
    throw new Error(`揭晓前出现了答案关键词：${leakedWords.join('、')}`)
  }
  return pack
}

