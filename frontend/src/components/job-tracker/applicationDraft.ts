import dayjs from 'dayjs'
import type { Application, ApplicationReviewSummary, TodoItem } from './types'
import { getStageOrderIndex, isRejectedStage, isTerminalStage, STAGE_LABELS } from './stageConfig'

export type EditorDraft = {
  company: string
  position: string
  city: string
  stage: string
  appliedAtInput: string
  nextFollowupInput: string
  notes: string
  todoText: string
}

export const CORE_PATCH_KEYS = ['company', 'position', 'city', 'stage', 'applied_at', 'next_followup_at'] as const

export const EXTRA_PATCH_KEYS = ['notes', 'todos'] as const

export function toDateInput(unix: number | null): string {
  return unix != null ? dayjs.unix(Math.floor(unix)).format('YYYY-MM-DD') : ''
}

export function fromDateInput(value: string): number | null {
  return value ? dayjs(value).startOf('day').unix() : null
}

export function createDraft(app: Application): EditorDraft {
  return {
    company: app.company,
    position: app.position,
    city: app.city,
    stage: app.stage,
    appliedAtInput: toDateInput(app.applied_at),
    nextFollowupInput: toDateInput(app.next_followup_at),
    notes: app.notes,
    todoText: app.todos.map((todo) => todo.title).join('\n'),
  }
}

let fallbackIdSequence = 0

export function createTodoId(): string {
  const rng = globalThis.crypto
  if (typeof rng?.randomUUID === 'function') return rng.randomUUID()
  if (typeof rng?.getRandomValues === 'function') {
    const bytes = rng.getRandomValues(new Uint8Array(16))
    return `todo-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
  }
  return `todo-${Date.now()}-${++fallbackIdSequence}-${Math.random().toString(36).slice(2)}`
}

export function todosFromText(text: string, currentTodos: TodoItem[]): TodoItem[] {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const existingByTitle = new Map(currentTodos.map((todo) => [todo.title, todo]))
  return lines.map((title, index) => {
    const indexed = currentTodos[index]
    const matched = indexed?.title === title ? indexed : existingByTitle.get(title)
    return {
      id: matched?.id ?? createTodoId(),
      title,
      done: matched?.done ?? false,
      due: matched?.due,
    }
  })
}

export function serializeTodos(todos: TodoItem[]): string {
  return JSON.stringify(
    todos.map((todo) => ({
      title: todo.title,
      done: Boolean(todo.done),
      due: todo.due ?? null,
    })),
  )
}

export function buildPatch(app: Application, draft: EditorDraft): Partial<Application> {
  const nextTodos = todosFromText(draft.todoText, app.todos)
  const patch: Partial<Application> = {}
  if (draft.company !== app.company) patch.company = draft.company
  if (draft.position !== app.position) patch.position = draft.position
  if (draft.city !== app.city) patch.city = draft.city
  if (draft.stage !== app.stage) patch.stage = draft.stage

  const appliedAt = fromDateInput(draft.appliedAtInput)
  if (draft.appliedAtInput !== toDateInput(app.applied_at)) patch.applied_at = appliedAt

  const nextFollowupAt = fromDateInput(draft.nextFollowupInput)
  if (draft.nextFollowupInput !== toDateInput(app.next_followup_at)) patch.next_followup_at = nextFollowupAt

  if (draft.notes !== app.notes) patch.notes = draft.notes
  if (serializeTodos(nextTodos) !== serializeTodos(app.todos)) patch.todos = nextTodos
  return patch
}

export function pickPatchKeys(
  patch: Partial<Application>,
  keys: readonly (keyof Partial<Application>)[],
): Partial<Application> {
  const next: Partial<Application> = {}
  for (const key of keys) {
    if (key in patch) {
      ;(next as Record<string, unknown>)[String(key)] = patch[key] as unknown
    }
  }
  return next
}

export function compareApplications(a: Application, b: Application): number {
  const rankA = getStageOrderIndex(a.stage)
  const rankB = getStageOrderIndex(b.stage)
  if (rankA !== rankB) return rankA - rankB

  const appliedA = a.applied_at ?? 0
  const appliedB = b.applied_at ?? 0
  if (appliedA !== appliedB) return appliedB - appliedA

  return (b.updated_at ?? 0) - (a.updated_at ?? 0)
}

export function formatDate(unix: number | null, fallback = '--') {
  return unix != null ? dayjs.unix(Math.floor(unix)).format('YYYY-MM-DD') : fallback
}

export function getScheduleMeta(app: Application) {
  if (isTerminalStage(app.stage)) {
    const reviewAt = latestLinkedReviewAt(app.review_summary)
    const isRejected = isRejectedStage(app.stage)
    const stageLabel = STAGE_LABELS[app.stage] ?? app.stage
    const tone = isRejected ? 'text-red-500' : 'text-text-muted'
    if (reviewAt != null) {
      const target = dayjs.unix(Math.floor(reviewAt))
      return {
        label: `复盘 ${target.format('MM-DD')}`,
        tone,
      }
    }
    return {
      label: isRejected ? stageLabel : '已放弃',
      tone,
    }
  }
  if (app.next_followup_at == null) {
    return {
      label: '跟进 未设',
      tone: 'text-text-muted',
    }
  }
  const target = dayjs.unix(Math.floor(app.next_followup_at))
  const now = dayjs()
  if (target.isBefore(now.startOf('day'))) {
    return {
      label: `跟进 ${target.format('MM-DD')}`,
      tone: 'text-red-500',
    }
  }
  if (target.isBefore(now.add(3, 'day').endOf('day'))) {
    return {
      label: `跟进 ${target.format('MM-DD')}`,
      tone: 'text-amber-500',
    }
  }
  return {
    label: `跟进 ${target.format('MM-DD')}`,
    tone: 'text-text-secondary',
  }
}

export function getSaveErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '保存失败，请重试'
}

export function linkedReviewCount(summary: ApplicationReviewSummary | null | undefined): number {
  return Number(summary?.linked_review_count ?? summary?.review_count ?? 0)
}

export function latestLinkedReviewAt(summary: ApplicationReviewSummary | null | undefined): number | null {
  return summary?.latest_linked_review_at ?? summary?.latest_review_at ?? null
}

export function reviewSummaryText(app: Application) {
  const summary = app.review_summary
  const linkedCount = linkedReviewCount(summary)
  const shortCount = Math.max(0, linkedCount - summary.review_count)
  if (summary.review_count <= 0) {
    if (linkedCount > 0) {
      return { label: linkedCount > 1 ? `${linkedCount} 短样本` : '短样本', tone: 'text-amber-500' }
    }
    return { label: '暂无', tone: 'text-text-muted' }
  }
  const countLabel = shortCount > 0 ? `${summary.review_count} 场 +${shortCount} 短` : `${summary.review_count} 场`
  if (summary.latest_avg_score == null) {
    return { label: countLabel, tone: 'text-text-secondary' }
  }
  if (summary.latest_avg_score < 6) {
    return { label: `${countLabel} · ${summary.latest_avg_score.toFixed(1)}`, tone: 'text-yellow-500' }
  }
  if (summary.latest_avg_score >= 8) {
    return { label: `${countLabel} · ${summary.latest_avg_score.toFixed(1)}`, tone: 'text-green-500' }
  }
  return { label: `${countLabel} · ${summary.latest_avg_score.toFixed(1)}`, tone: 'text-blue-500' }
}

export function hasReviewTimeline(app: Application) {
  return linkedReviewCount(app.review_summary) > 0
}

export function reviewShortcutLabel(app: Application) {
  const count = linkedReviewCount(app.review_summary)
  if (count <= 0) return '暂无复盘'
  if (app.review_summary.review_count <= 0) return count > 1 ? `看 ${count} 条短样本` : '看短样本'
  return count > 1 ? `看 ${count} 场复盘` : '看复盘'
}

export function reviewShortcutClass(app: Application) {
  const latestScore = app.review_summary.latest_avg_score
  if (app.review_summary.review_count <= 0 && linkedReviewCount(app.review_summary) > 0) {
    return 'border-amber-500/20 bg-amber-500/10 text-amber-500 hover:bg-amber-500/15'
  }
  if (latestScore == null) return 'border-bg-hover bg-bg-secondary text-text-secondary hover:text-text-primary'
  if (latestScore < 6) return 'border-yellow-500/20 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/15'
  if (latestScore >= 8) return 'border-green-500/20 bg-green-500/10 text-green-500 hover:bg-green-500/15'
  return 'border-accent-blue/20 bg-accent-blue/8 text-accent-blue hover:bg-accent-blue/12'
}

export function hiddenPreviewLabel(app: Application) {
  const stageLabel = STAGE_LABELS[app.stage] ?? app.stage
  const reviewCount = linkedReviewCount(app.review_summary)
  if (reviewCount > 1) return `${stageLabel} · ${reviewCount} 场复盘`
  if (reviewCount === 1) return `${stageLabel} · 1 场复盘`
  return stageLabel
}
