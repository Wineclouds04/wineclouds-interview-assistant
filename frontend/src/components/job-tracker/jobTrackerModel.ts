import dayjs from 'dayjs'
import type { Application, Offer, Stage } from './types'
import { parseApplication, parseReviewScore } from './types'
import { isRejectedStage, isTerminalStage } from './stageConfig'

export type ApplicationReviewItem = {
  id: number
  status: string
  started_at: number | null
  ended_at: number | null
  title?: string | null
  company?: string | null
  role?: string | null
  turn_count: number
  avg_score: number | null
  summary_preview?: string | null
  updated_at: number | null
  auto_sync_eligible?: boolean
}

export type CreateApplicationDraft = {
  appliedAtInput: string
  company: string
  city: string
  position: string
  stage: Stage
}

export type FocusFilter = 'all' | 'active' | 'interview' | 'offer' | 'due' | 'rejected' | 'withdrawn'

export type CreateNotice = {
  id: number
  company: string
  position: string
  city: string
  appliedAt: number | null
  stage: string
}

export type DetailIntent = {
  applicationId: number
  mode: 'edit_core' | 'extras' | 'quick_progress'
}

export const INTERVIEW_FOCUS_STAGES = new Set<string>(['written', 'interview1', 'interview2', 'interview3', 'hr'])

export function createInitialDraft(): CreateApplicationDraft {
  return {
    appliedAtInput: dayjs().format('YYYY-MM-DD'),
    company: '',
    city: '',
    position: '',
    stage: 'applied',
  }
}

export function parseApplicationResponse(
  raw: Record<string, unknown>,
  fallbackReviewSummary?: Application['review_summary'],
): Application {
  const parsed = parseApplication(raw)
  const hasReviewSummary = raw.review_summary != null && typeof raw.review_summary === 'object'
  if (!hasReviewSummary && fallbackReviewSummary) {
    return { ...parsed, review_summary: fallbackReviewSummary }
  }
  return parsed
}

export function parseFiniteNumber(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseNonNegativeCount(value: unknown): number {
  return Math.max(0, Math.floor(parseFiniteNumber(value) ?? 0))
}

export function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false
  }
  return undefined
}

export function parseApplicationReviewItem(item: Record<string, unknown>): ApplicationReviewItem | null {
  const id = parseFiniteNumber(item.id)
  if (id == null) return null
  return {
    id,
    status: String(item.status ?? ''),
    started_at: parseFiniteNumber(item.started_at),
    ended_at: parseFiniteNumber(item.ended_at),
    title: item.title != null ? String(item.title) : null,
    company: item.company != null ? String(item.company) : null,
    role: item.role != null ? String(item.role) : null,
    turn_count: parseNonNegativeCount(item.turn_count),
    avg_score: parseReviewScore(item.avg_score),
    summary_preview: item.summary_preview != null ? String(item.summary_preview) : null,
    updated_at: parseFiniteNumber(item.updated_at),
    auto_sync_eligible: parseOptionalBoolean(item.auto_sync_eligible),
  }
}

export function reviewItemSortTime(item: ApplicationReviewItem): number {
  return item.ended_at ?? item.started_at ?? 0
}

export function sortApplicationReviewItems(items: ApplicationReviewItem[]): ApplicationReviewItem[] {
  return [...items].sort((a, b) => {
    const byTime = reviewItemSortTime(b) - reviewItemSortTime(a)
    if (byTime !== 0) return byTime
    return b.id - a.id
  })
}

export function fromDateInput(value: string): number | null {
  return value ? dayjs(value).startOf('day').unix() : null
}

export function matchesFocusFilter(
  app: Application,
  focusFilter: FocusFilter,
  offerByAppId: Map<number, Offer>,
  dueSoonCutoff: number,
): boolean {
  const hasOffer = app.stage === 'offer' || offerByAppId.has(app.id)
  switch (focusFilter) {
    case 'active':
      return !isTerminalStage(app.stage) && !hasOffer
    case 'interview':
      return ['written', 'interview1', 'interview2', 'interview3', 'hr'].includes(app.stage)
    case 'offer':
      return hasOffer
    case 'due':
      return !isTerminalStage(app.stage) && !hasOffer && app.next_followup_at != null && app.next_followup_at <= dueSoonCutoff
    case 'rejected':
      return isRejectedStage(app.stage)
    case 'withdrawn':
      return app.stage === 'withdrawn'
    case 'all':
    default:
      return true
  }
}

export function getFocusFilterForStage(stage: string): FocusFilter {
  if (isRejectedStage(stage)) return 'rejected'
  if (stage === 'withdrawn') return 'withdrawn'
  if (stage === 'offer') return 'offer'
  if (INTERVIEW_FOCUS_STAGES.has(stage)) return 'interview'
  return 'active'
}

export function describeCreateNotice(notice: CreateNotice): { rail: string } {
  if (isRejectedStage(notice.stage)) {
    return {
      rail: '已归到“挂了”',
    }
  }

  if (notice.stage === 'withdrawn') {
    return {
      rail: '已归到“已放弃”',
    }
  }

  if (notice.stage === 'offer') {
    return {
      rail: '已归到“Offer”',
    }
  }

  if (INTERVIEW_FOCUS_STAGES.has(notice.stage)) {
    return {
      rail: '已归到“面试中”',
    }
  }

  return {
    rail: '已归到“进行中”',
  }
}

export function describeCreateNoticeNextStep(notice: CreateNotice): { title: string } {
  if (isRejectedStage(notice.stage)) {
    return {
      title: '结果已记录',
    }
  }

  if (notice.stage === 'withdrawn') {
    return {
      title: '已放弃',
    }
  }

  if (notice.stage === 'offer') {
    return {
      title: '补 Offer 细节',
    }
  }

  if (INTERVIEW_FOCUS_STAGES.has(notice.stage)) {
    return {
      title: '补跟进/待办',
    }
  }

  return {
    title: '补进度',
  }
}

export function describeCreateContinueAction(notice: CreateNotice): { label: string; mode: DetailIntent['mode'] } {
  if (notice.stage === 'offer') {
    return { label: '补 Offer', mode: 'extras' }
  }
  if (isTerminalStage(notice.stage)) {
    return { label: '查看详情', mode: 'quick_progress' }
  }
  return { label: '补进度', mode: 'quick_progress' }
}

export function reviewScoreTone(score: number | null) {
  if (score == null) return 'text-text-muted'
  if (score < 6) return 'text-yellow-500'
  if (score >= 8) return 'text-green-500'
  return 'text-blue-500'
}

export function reviewStatusLabel(status: string) {
  switch (status) {
    case 'recording':
      return '录制中'
    case 'recorded':
      return '待生成'
    case 'analyzing':
      return '分析中'
    case 'completed':
      return '已完成'
    case 'partial_capture':
      return '部分录制'
    case 'analysis_failed':
      return '分析失败'
    default:
      return status
  }
}

export function reviewStatusTone(status: string) {
  switch (status) {
    case 'completed':
      return 'text-green-500'
    case 'analysis_failed':
      return 'text-red-500'
    case 'analyzing':
      return 'text-blue-500'
    case 'partial_capture':
      return 'text-yellow-500'
    case 'recorded':
      return 'text-amber-500'
    default:
      return 'text-text-muted'
  }
}
