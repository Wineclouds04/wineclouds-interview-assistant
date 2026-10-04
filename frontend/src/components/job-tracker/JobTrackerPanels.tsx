import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { CalendarDays, Plus, Undo2, X } from 'lucide-react'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import type { Application, Stage } from './types'
import { isLightColorScheme } from '@/lib/colorScheme'
import { ONGOING_STAGES, STAGE_LABELS, StageBadge, isTerminalStage, TERMINAL_STAGES } from './stageConfig'
import { ApplicationReviewItem, CreateApplicationDraft, CreateNotice, describeCreateNotice, describeCreateNoticeNextStep, reviewScoreTone, reviewStatusLabel, reviewStatusTone } from './jobTrackerModel'

export type FocusNotice = {
  applicationId: number
  company: string
  position: string
  openReviews: boolean
}

export type HeaderSnapshotTone = 'neutral' | 'blue' | 'amber' | 'green' | 'red'

export function useCompactLayout(maxWidth = 640) {
  const read = () => {
    if (typeof window === 'undefined') return false
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia(`(max-width: ${Math.max(0, maxWidth - 0.02)}px)`).matches
    }
    return window.innerWidth < maxWidth
  }
  const [compact, setCompact] = useState(read)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const update = (next: boolean) => setCompact((current) => (current === next ? current : next))
    if (typeof window.matchMedia === 'function') {
      const media = window.matchMedia(`(max-width: ${Math.max(0, maxWidth - 0.02)}px)`)
      const onChange = () => update(media.matches)
      onChange()
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', onChange)
        return () => media.removeEventListener('change', onChange)
      }
      media.addListener(onChange)
      return () => media.removeListener(onChange)
    }
    const onResize = () => update(window.innerWidth < maxWidth)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [maxWidth])

  return compact
}

export function HeaderSnapshotPill({
  label,
  value,
  tone,
  isLight,
}: {
  label: string
  value: string
  tone: HeaderSnapshotTone
  isLight: boolean
}) {
  const toneClass = {
    neutral: isLight ? 'text-text-secondary' : 'text-text-secondary',
    blue: isLight ? 'text-accent-blue' : 'text-accent-blue',
    amber: isLight ? 'text-yellow-600' : 'text-yellow-400',
    green: isLight ? 'text-emerald-600' : 'text-emerald-400',
    red: isLight ? 'text-red-600' : 'text-red-400',
  }[tone]

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px]">
      <span className="shrink-0 text-text-muted">{label}</span>
      <span className={`shrink-0 font-semibold ${toneClass}`}>{value}</span>
    </span>
  )
}

export function DesktopOverviewSummary({
  items,
  isLight,
}: {
  items: Array<{ label: string; value: string; tone: HeaderSnapshotTone }>
  isLight: boolean
}) {
  return (
    <div className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-1">
        {items.map((item) => (
          <DesktopOverviewInlineStat
            key={item.label}
            label={item.label}
            value={item.value}
            tone={item.tone}
            isLight={isLight}
          />
        ))}
    </div>
  )
}

export function DesktopOverviewInlineStat({
  label,
  value,
  tone,
  isLight,
}: {
  label: string
  value: string
  tone: HeaderSnapshotTone
  isLight: boolean
}) {
  const toneClass = {
    neutral: isLight ? 'text-text-secondary' : 'text-text-secondary',
    blue: isLight ? 'text-accent-blue' : 'text-accent-blue',
    amber: isLight ? 'text-yellow-600' : 'text-yellow-400',
    green: isLight ? 'text-emerald-600' : 'text-emerald-400',
    red: isLight ? 'text-red-600' : 'text-red-400',
  }[tone]

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px]">
      <span className="shrink-0 text-text-muted">{label}</span>
      <span className={`shrink-0 font-semibold ${toneClass}`}>{value}</span>
    </span>
  )
}

export function JobTrackerZeroState({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="border-l border-bg-hover/80 py-2 pl-3">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary">暂无岗位记录</div>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-accent-blue px-4 text-sm font-semibold text-white transition hover:brightness-110"
        >
          <Plus className="h-4 w-4" />
          新建记录
        </button>
      </div>
    </section>
  )
}

export function CreateSuccessBanner({
  notice,
  continueLabel,
  isLight,
  onContinue,
  onDismiss,
  onUndo,
}: {
  notice: CreateNotice
  continueLabel: string
  isLight: boolean
  onContinue: () => void
  onDismiss: () => void
  onUndo: () => void | Promise<void>
}) {
  const noticeCopy = describeCreateNotice(notice)
  const nextStepCopy = describeCreateNoticeNextStep(notice)
  const identityText = [notice.position || '岗位', notice.city].filter(Boolean).join(' · ')

  return (
    <section
      className={`flex flex-col gap-3 border-l pl-3 lg:flex-row lg:items-center lg:justify-between ${
        isLight ? 'border-bg-hover' : 'border-white/[0.12]'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <div className="text-sm font-semibold text-text-primary">
            已创建 {notice.company}
          </div>
          {identityText ? (
            <span className="text-[11px] text-text-secondary">
              {identityText}
            </span>
          ) : null}
          <span className="text-[11px] font-medium text-accent-blue">
            {noticeCopy.rail}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
          <span>{continueLabel === '补进度' ? '补阶段/跟进' : nextStepCopy.title}</span>
          <span>已定位详情</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
        <button
          type="button"
          onClick={onContinue}
          className="rounded-md bg-accent-blue px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110"
        >
          {continueLabel}
        </button>
        <button
          type="button"
          onClick={() => void onUndo()}
          className="inline-flex items-center gap-1.5 rounded-md border border-bg-hover px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
        >
          <Undo2 className="h-3.5 w-3.5" />
          撤销
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md border border-bg-hover px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
        >
          收起
        </button>
      </div>
    </section>
  )
}

export function FocusArrivalBanner({
  notice,
  isLight,
  onDismiss,
}: {
  notice: FocusNotice
  isLight: boolean
  onDismiss: () => void
}) {
  return (
    <section
      className={`flex flex-col gap-3 border-l pl-3 md:flex-row md:items-center md:justify-between ${
        isLight ? 'border-bg-hover' : 'border-white/[0.12]'
      }`}
    >
      <div>
        <div className="text-sm font-semibold text-text-primary">
          已定位到 {notice.company}{notice.position ? ` · ${notice.position}` : ''}
        </div>
        <div className="mt-1 text-xs text-text-muted">{notice.openReviews ? '已打开复盘时间线' : '已选中详情'}</div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md border border-bg-hover px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
        >
          知道了
        </button>
      </div>
    </section>
  )
}

export function QuickCreatePanel({
  draft,
  creating,
  isLight,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: CreateApplicationDraft
  creating: boolean
  isLight: boolean
  onChange: (draft: CreateApplicationDraft) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const inputClass = `rounded-lg border px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent-blue/40 focus:ring-2 focus:ring-accent-blue/15 ${
    isLight ? 'border-bg-hover bg-white' : 'border-white/[0.08] bg-black/15'
  }`

  return (
    <section
      className={`rounded-lg border p-3.5 ${
        isLight ? 'border-bg-hover bg-white' : 'border-white/[0.08] bg-black/20'
      }`}
    >
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary">快速新增</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-bg-hover px-3 py-2 text-xs font-medium text-text-muted transition-colors hover:text-text-primary"
          >
            取消
          </button>
          <button
            type="button"
            disabled={creating}
            onClick={onSubmit}
            className="rounded-md bg-accent-blue px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
          >
            {creating ? '创建中...' : '创建记录'}
          </button>
        </div>
      </div>

      <div className="mt-3.5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
          投递日期
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input
              type="date"
              value={draft.appliedAtInput}
              onChange={(e) => onChange({ ...draft, appliedAtInput: e.target.value })}
              className={`${inputClass} w-full pl-9`}
            />
          </div>
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
          公司名称
          <input
            autoFocus
            value={draft.company}
            onChange={(e) => onChange({ ...draft, company: e.target.value })}
            placeholder="例如 OpenAI"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
          城市
          <input
            value={draft.city}
            onChange={(e) => onChange({ ...draft, city: e.target.value })}
            placeholder="例如 上海 / Remote"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
          岗位名称
          <input
            value={draft.position}
            onChange={(e) => onChange({ ...draft, position: e.target.value })}
            placeholder="例如 Frontend Engineer"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-text-secondary">
          阶段
          <select
            value={draft.stage}
            onChange={(e) => onChange({ ...draft, stage: e.target.value as Stage })}
            className={inputClass}
          >
            <optgroup label="进行中">
              {ONGOING_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {STAGE_LABELS[stage] ?? stage}
                </option>
              ))}
            </optgroup>
            <optgroup label="已结束">
              {TERMINAL_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {STAGE_LABELS[stage] ?? stage}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>
    </section>
  )
}

export function ApplicationReviewsModal({
  app,
  items,
  loading,
  highlightedReviewId,
  onClose,
  onViewDetail,
}: {
  app: Application
  items: ApplicationReviewItem[]
  loading: boolean
  highlightedReviewId?: number | null
  onClose: () => void
  onViewDetail: (sessionId: number) => void
}) {
  const colorScheme = useUiPrefsStore((s) => s.colorScheme)
  const isLight = isLightColorScheme(colorScheme)
  const latestReviewAt = items[0]?.ended_at ?? items[0]?.started_at ?? null
  const latestScore = items[0]?.avg_score ?? null
  const scoredCount = items.filter((item) => item.avg_score != null).length
  const shortSampleCount = items.filter((item) => item.auto_sync_eligible === false).length
  const closedStage = isTerminalStage(app.stage)
  const latestReviewLabel = latestReviewAt != null
    ? dayjs.unix(Math.floor(latestReviewAt)).format('YYYY-MM-DD HH:mm')
    : '--'
  const latestScoreLabel = latestScore != null ? latestScore.toFixed(1) : '未出分'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-0 sm:p-4">
      <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-none border border-bg-hover bg-bg-secondary shadow-xl sm:h-auto sm:max-h-[82vh] sm:rounded-lg">
        <div className="flex items-start justify-between gap-3 border-b border-bg-hover px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-text-primary">关联复盘</h3>
              <StageBadge stage={app.stage} isLight={isLight} />
            </div>
            <p className="mt-1 truncate text-xs text-text-muted">
              {app.company} · {app.position || '岗位'}
              {app.city ? ` · ${app.city}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-text-muted hover:bg-bg-hover hover:text-text-primary"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          {loading ? (
            <div className="py-10 text-center text-sm text-text-muted">加载中...</div>
          ) : items.length === 0 ? (
            <div className="border-l border-bg-hover/80 py-2 pl-3">
              <div className="text-sm font-semibold text-text-primary">暂无关联复盘</div>
              <div className="mt-1 text-xs text-text-muted">
                {closedStage ? '已结束，可手动补挂。' : '暂无复盘。'}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col gap-1.5 border-b border-bg-hover/80 pb-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                  <span className="font-medium text-text-primary">{items.length} 场复盘</span>
                  {shortSampleCount > 0 ? (
                    <span>短样本 {shortSampleCount}</span>
                  ) : null}
                  <span>最近 {latestReviewLabel}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
                  <span>最近得分 <span className="font-semibold text-text-primary">{latestScoreLabel}</span></span>
                  <span>已出分 <span className="font-semibold text-text-primary">{scoredCount}</span></span>
                </div>
              </div>

              <div>
                {items.map((item, index) => {
                  const reviewAt = item.ended_at ?? item.started_at
                  const highlighted = highlightedReviewId != null && item.id === highlightedReviewId
                  return (
                    <div key={item.id} className="relative pl-6">
                      {index < items.length - 1 ? (
                        <div className="absolute left-[11px] top-8 h-[calc(100%-0.5rem)] w-px bg-bg-hover" aria-hidden />
                      ) : null}
                      <div className={`absolute left-0 top-5 h-3 w-3 rounded-full border-2 bg-bg-secondary ${
                        highlighted ? 'border-accent-blue' : 'border-bg-hover'
                      }`} aria-hidden />
                      <div className="border-b border-bg-hover/70 py-3">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-text-primary">
                                {item.title || item.company || item.role || `复盘 #${item.id}`}
                              </div>
                              <span className={`text-[11px] font-medium ${reviewStatusTone(item.status)}`}>
                                {reviewStatusLabel(item.status)}
                              </span>
                              {highlighted ? (
                                <span className="text-[11px] font-medium text-accent-blue">
                                  当前这场
                                </span>
                              ) : null}
                              {item.auto_sync_eligible === false ? (
                                <span className="text-[11px] font-medium text-amber-500">
                                  短样本
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                              <span>{reviewAt != null ? dayjs.unix(Math.floor(reviewAt)).format('YYYY-MM-DD HH:mm') : '--'}</span>
                              <span>{item.turn_count} 轮</span>
                              <span>{item.role || app.position || '岗位未填写'}</span>
                            </div>
                            {item.summary_preview ? (
                              <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-text-secondary">{item.summary_preview}</p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <div className={`text-xs font-bold ${reviewScoreTone(item.avg_score)}`}>
                              {item.avg_score != null ? item.avg_score.toFixed(1) : '未出分'}
                            </div>
                            <button
                              type="button"
                              onClick={() => onViewDetail(item.id)}
                              className="rounded-md border border-accent-blue/25 bg-transparent px-3 py-2 text-xs font-medium text-accent-blue transition-colors hover:bg-accent-blue/5"
                            >
                              打开复盘
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
