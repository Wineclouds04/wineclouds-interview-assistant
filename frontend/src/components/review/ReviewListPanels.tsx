import { useState, useRef } from 'react'
import type { ComponentType } from 'react'
import dayjs from 'dayjs'
import { AlertCircle, CheckCircle, Settings, Sparkles, RotateCw, Loader2, Upload } from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { StageBadge } from '@/components/job-tracker/stageConfig'
import type { ReviewSession } from './types'
import { getReviewSourceMeta, isWrittenExamReview } from './sourceMeta'
import { ReviewListFocus, SessionCluster, buildSessionClusters, buildSessionGroups, describeTimelinePosition, getSessionUiState, sessionRailTone, sessionSummary, statusTextTone } from './reviewListModel'

export const STATUS_LABELS: Record<ReviewSession['status'], string> = {
  recording: '录制中',
  recorded: '待生成',
  analyzing: '分析中',
  completed: '已完成',
  partial_capture: '部分录制',
  analysis_failed: '分析失败',
}

export const FIELD_CLASS = 'w-full rounded-lg border border-bg-hover bg-bg-tertiary px-3 py-2 text-xs text-text-primary placeholder-text-muted outline-none transition focus:border-accent-blue/60 focus:ring-2 focus:ring-accent-blue/10 disabled:cursor-not-allowed disabled:opacity-50'

export type AsrSelfTestResult = {
  ok: boolean
  model_name: string
  model: string
  original: string
  corrected: string
  changed: boolean
  detail?: string
}

export function ReviewZeroState({
  reviewEnabled,
  showManualImport,
  showSettings,
  onManual,
  onSettings,
}: {
  reviewEnabled: boolean
  showManualImport: boolean
  showSettings: boolean
  onManual: () => void
  onSettings: () => void
}) {
  return (
    <section className="border-l border-bg-hover/80 py-2 pl-3">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary">暂无复盘记录</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <span>自动生成 {reviewEnabled ? '已启用' : '未启用'}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onManual}
            aria-expanded={showManualImport}
            className={`inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-sm font-semibold transition-colors ${
              showManualImport
                ? 'border border-bg-hover bg-transparent text-accent-blue hover:bg-bg-hover'
                : 'bg-accent-blue text-white hover:bg-accent-blue/90'
            }`}
          >
            <Upload className="h-4 w-4" />
            {showManualImport ? '收起导入' : '手动复盘'}
          </button>
          <button
            type="button"
            onClick={onSettings}
            aria-expanded={showSettings}
            className={`inline-flex h-9 items-center gap-2 rounded-md border px-3.5 text-sm font-medium transition-colors ${
              showSettings
                ? 'border-bg-hover bg-transparent text-accent-blue hover:bg-bg-hover'
                : 'border-bg-hover bg-bg-secondary text-text-primary hover:bg-bg-hover'
            }`}
          >
            <Settings className="h-4 w-4" />
            {showSettings ? '收起配置' : '配置'}
          </button>
        </div>
      </div>
    </section>
  )
}

export function ManualImportPanel({
  onCreated,
  onToast,
}: {
  onCreated: (sessionId: number) => void
  onToast: (message: string | null) => void
}) {
  const [form, setForm] = useState({
    title: '',
    company: '',
    role: '',
    transcript: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  const canSubmit = form.transcript.trim().length >= 12

  const handleSubmit = async () => {
    if (!canSubmit) return
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const result = await api.reviewCreateManual({
        title: form.title || undefined,
        company: form.company || undefined,
        role: form.role || undefined,
        transcript: form.transcript,
        analyze: true,
      })
      onToast('已创建手动复盘，并开始分析')
      onCreated(result.session_id)
    } catch (err) {
      onToast(getErrorMessage(err, '创建手动复盘失败'))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-lg border border-bg-hover bg-bg-secondary/35 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text-primary">手动复盘导入</h3>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <input
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          placeholder="标题"
          className={FIELD_CLASS}
        />
        <input
          value={form.company}
          onChange={(event) => setForm({ ...form, company: event.target.value })}
          placeholder="公司"
          className={FIELD_CLASS}
        />
        <input
          value={form.role}
          onChange={(event) => setForm({ ...form, role: event.target.value })}
          placeholder="岗位"
          className={FIELD_CLASS}
        />
      </div>
      <textarea
        value={form.transcript}
        onChange={(event) => setForm({ ...form, transcript: event.target.value })}
        rows={8}
        placeholder={'面试官: 请介绍一下 Redis 缓存穿透。\n候选人: 我会用布隆过滤器和空值缓存...\nQ2: 讲讲索引失效场景。\nA2: ...'}
        className={`${FIELD_CLASS} mt-3 min-h-[180px] resize-y font-mono leading-relaxed`}
      />
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent-blue px-4 text-xs font-medium text-white hover:bg-accent-blue/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {submitting ? '创建中' : '创建并分析'}
        </button>
      </div>
    </div>
  )
}

export function ReviewSettingsPanel({
  reviewEnabled,
  reviewModelIndex,
  reviewToggleSaving,
  models,
  onToggle,
  onChangeModel,
}: {
  reviewEnabled: boolean
  reviewModelIndex: number
  reviewToggleSaving: boolean
  models: { name: string; enabled?: boolean }[]
  onToggle: (enabled: boolean) => void
  onChangeModel: (modelIndex: number) => void
}) {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<AsrSelfTestResult | null>(null)

  const handleSelfTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api.reviewAsrCorrectionTest()
      setTestResult(result)
    } catch (err) {
      setTestResult({
        ok: false,
        model_name: models[reviewModelIndex]?.name ?? '复盘模型',
        model: '',
        original: '',
        corrected: '',
        changed: false,
        detail: getErrorMessage(err, '自检失败'),
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="rounded-lg border border-bg-hover bg-bg-secondary/35 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-text-primary">复盘配置</h3>
          <div className="mt-0.5 text-[11px] text-text-muted">
            {reviewEnabled ? '结束后自动生成分析' : '只保存记录，手动生成分析'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onToggle(!reviewEnabled)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            reviewEnabled ? 'bg-green-500' : 'bg-bg-hover'
          }`}
          role="switch"
          aria-checked={reviewEnabled}
          aria-busy={reviewToggleSaving}
        >
          <span
            className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform ${
              reviewEnabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          >
            {reviewToggleSaving ? <Loader2 className="h-3 w-3 animate-spin text-text-muted" /> : null}
          </span>
        </button>
      </div>
      <label className="mb-2 block text-xs font-medium text-text-secondary">
        复盘分析模型
      </label>
      <select
        value={reviewModelIndex}
        onChange={(event) => onChangeModel(Number(event.target.value))}
        disabled={!reviewEnabled}
        className={FIELD_CLASS}
      >
        {models.map((model, idx) => (
          <option key={idx} value={idx} disabled={!model.enabled}>
            {model.name} {!model.enabled ? '(未启用)' : ''}
          </option>
        ))}
      </select>
      <div className="mt-3 border-t border-bg-hover/80 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-text-primary">ASR 纠错自检</div>
          </div>
          <button
            type="button"
            onClick={handleSelfTest}
            disabled={testing}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-bg-hover bg-transparent px-3 text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {testing ? '检测中' : '检测'}
          </button>
        </div>
        {testResult && (
          <div className={`mt-3 rounded-lg border p-3 ${
            testResult.ok
              ? 'border-green-500/20 bg-green-500/10'
              : 'border-red-500/20 bg-red-500/10'
          }`}>
            <div className="flex items-center gap-2">
              {testResult.ok ? (
                <CheckCircle className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 text-red-500" />
              )}
              <span className={`text-xs font-medium ${testResult.ok ? 'text-green-500' : 'text-red-500'}`}>
                {testResult.ok ? (testResult.changed ? '纠错可用，样例已修正' : '模型可用，样例未变化') : '纠错不可用'}
              </span>
            </div>
            <div className="mt-2 text-[11px] text-text-muted">
              {testResult.model_name}{testResult.model ? ` / ${testResult.model}` : ''}
            </div>
            {testResult.detail && (
              <div className="mt-1 break-words text-[11px] leading-relaxed text-text-secondary">{testResult.detail}</div>
            )}
            {testResult.ok && (
              <div className="mt-3 grid gap-2">
                <div className="rounded-md bg-bg-primary/40 p-2">
                  <div className="mb-1 text-[10px] font-medium text-text-muted">原始样例</div>
                  <div className="text-[11px] leading-relaxed text-text-secondary">{testResult.original}</div>
                </div>
                <div className="rounded-md bg-bg-primary/40 p-2">
                  <div className="mb-1 text-[10px] font-medium text-text-muted">纠错结果</div>
                  <div className="text-[11px] leading-relaxed text-text-primary">{testResult.corrected}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function SessionTable({
  sessions,
  focusFilter,
  linkedReviewCounts,
  linkedTimelineLabels,
  triggeringIds,
  onViewDetail,
  onOpenApplication,
  onTriggerAnalysis,
  hasGeneratedAnalysis,
}: {
  sessions: ReviewSession[]
  focusFilter: ReviewListFocus
  linkedReviewCounts: Map<number, number>
  linkedTimelineLabels: Map<number, string>
  triggeringIds: Set<number>
  onViewDetail: (sessionId: number) => void
  onOpenApplication: (session: ReviewSession) => void
  onTriggerAnalysis: (sessionId: number) => void
  hasGeneratedAnalysis: (session: ReviewSession) => boolean
}) {
  const groups = buildSessionGroups(sessions, hasGeneratedAnalysis)
  const visibleGroups = groups.filter((group) => focusFilter === 'all' || group.key === focusFilter)

  if (visibleGroups.length === 0) {
    return (
      <div className="px-1 py-6 text-sm text-text-muted">
        没有复盘记录
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {visibleGroups.map((group) => (
        <section key={group.key} className="space-y-2">
          <div className="flex items-start justify-between gap-3 px-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-text-primary">{group.title}</h3>
              <span className="text-[11px] text-text-muted">{group.items.length} 场</span>
            </div>
          </div>
          <div className="divide-y divide-bg-hover/70 border-y border-bg-hover/70">
            {buildSessionClusters(group.items).map((cluster) => (
              <ReviewTimelineCluster
                key={cluster.key}
                cluster={cluster}
                linkedReviewCounts={linkedReviewCounts}
                linkedTimelineLabels={linkedTimelineLabels}
                triggeringIds={triggeringIds}
                hasGeneratedAnalysis={hasGeneratedAnalysis}
                onViewDetail={onViewDetail}
                onOpenApplication={onOpenApplication}
                onTriggerAnalysis={onTriggerAnalysis}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export function ReviewTimelineCluster({
  cluster,
  linkedReviewCounts,
  linkedTimelineLabels,
  triggeringIds,
  hasGeneratedAnalysis,
  onViewDetail,
  onOpenApplication,
  onTriggerAnalysis,
}: {
  cluster: SessionCluster
  linkedReviewCounts: Map<number, number>
  linkedTimelineLabels: Map<number, string>
  triggeringIds: Set<number>
  hasGeneratedAnalysis: (session: ReviewSession) => boolean
  onViewDetail: (sessionId: number) => void
  onOpenApplication: (session: ReviewSession) => void
  onTriggerAnalysis: (sessionId: number) => void
}) {
  const timelineCount = cluster.application?.id != null ? linkedReviewCounts.get(cluster.application.id) ?? cluster.items.length : cluster.items.length
  const showTimelineHeader = Boolean(cluster.application?.id) && cluster.items.length > 1

  return (
    <section>
      {showTimelineHeader ? (
        <div className="border-b border-bg-hover px-3 py-2">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-text-primary">
                  {cluster.application?.company || '未命名公司'} · {cluster.application?.position || '岗位未填写'}
                </h4>
                <StageBadge stage={cluster.application?.stage || 'applied'} />
                <span className="text-[11px] text-text-muted">
                  同岗位 {timelineCount} 场复盘
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="divide-y divide-bg-hover/70">
        {cluster.items.map((session, index) => {
          const { statusColor, StatusIcon, isTriggering, showTriggerButton } = getSessionUiState(session, triggeringIds, hasGeneratedAnalysis)
          return (
            <ReviewQueueRow
              key={session.id}
              session={session}
              linkedReviewCount={session.application?.id != null ? linkedReviewCounts.get(session.application.id) ?? 1 : null}
              statusColor={statusColor}
              StatusIcon={StatusIcon}
              isTriggering={isTriggering}
              showTriggerButton={showTriggerButton}
              timelineLabel={linkedTimelineLabels.get(session.id) ?? (showTimelineHeader ? describeTimelinePosition(index, cluster.items.length) : null)}
              compactLinkedApplication={showTimelineHeader}
              onViewDetail={onViewDetail}
              onOpenApplication={onOpenApplication}
              onTriggerAnalysis={onTriggerAnalysis}
            />
          )
        })}
      </div>
    </section>
  )
}

export function ReviewQueueRow({
  session,
  linkedReviewCount,
  statusColor,
  StatusIcon,
  isTriggering,
  showTriggerButton,
  timelineLabel,
  compactLinkedApplication,
  onViewDetail,
  onOpenApplication,
  onTriggerAnalysis,
}: {
  session: ReviewSession
  linkedReviewCount: number | null
  statusColor: string
  StatusIcon: ComponentType<{ className?: string }>
  isTriggering: boolean
  showTriggerButton: boolean
  timelineLabel: string | null
  compactLinkedApplication: boolean
  onViewDetail: (sessionId: number) => void
  onOpenApplication: (session: ReviewSession) => void
  onTriggerAnalysis: (sessionId: number) => void
}) {
  const showLinkedApplication = Boolean(session.application)
  const showScore = session.avg_score != null
  const sourceMeta = getReviewSourceMeta(session.source)
  const isWrittenExam = isWrittenExamReview(session.source)
  const title = session.title || session.company || '未命名复盘'
  const roleText = session.role || (isWrittenExam ? '截图题' : '岗位未填写')
  const timeText = dayjs.unix(Math.floor(session.started_at)).format('MM-DD HH:mm')
  const turnsText = `${session.turn_count}${sourceMeta.unit}`
  const summary = sessionSummary(session)
  const hasPrimaryTrigger = showTriggerButton || isTriggering
  const linkedApplicationName = `${session.application?.company || '未命名公司'} · ${session.application?.position || '岗位'}`
  const metaParts = [
    showScore ? `${session.avg_score?.toFixed(1)}分` : null,
    timeText,
    turnsText,
    session.auto_sync_eligible === false ? '短样本' : null,
  ].filter((item): item is string => Boolean(item))

  return (
    <article
      onClick={() => onViewDetail(session.id)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onViewDetail(session.id)
        }
      }}
      role="button"
      tabIndex={0}
      className={`cursor-pointer px-3 py-2 outline-none transition-colors hover:bg-bg-tertiary/18 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue/30`}
      aria-label={`打开 ${title} 复盘详情`}
    >
      <div className="flex gap-2.5">
        <div className={`hidden w-1 shrink-0 rounded-sm md:block ${sessionRailTone(session.status)}`} />
        <div className="min-w-0 flex-1">
          <div className={`grid gap-2 ${hasPrimaryTrigger ? 'xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start' : ''}`}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h4 className="text-sm font-semibold tracking-tight text-text-primary">{title}</h4>
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${sourceMeta.badgeClassName}`}>
                  {sourceMeta.label}
                </span>
                <span className="text-xs text-text-secondary">{roleText}</span>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-text-muted">
                <span className={`inline-flex items-center gap-1 font-medium ${statusTextTone(session.status)}`}>
                  <StatusIcon className={`h-3.5 w-3.5 ${session.status === 'analyzing' ? 'animate-spin' : ''} ${statusColor}`} />
                  {STATUS_LABELS[session.status]}
                </span>
                {metaParts.map((part) => (
                  <span key={part}>{part}</span>
                ))}
              </div>
              {showLinkedApplication ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
                  <span className="font-medium text-accent-blue">{compactLinkedApplication ? '同岗位' : '岗位'}</span>
                  <span className="font-medium text-text-primary">{linkedApplicationName}</span>
                  <StageBadge stage={session.application?.stage || 'applied'} />
                  {linkedReviewCount != null && linkedReviewCount > 1 ? (
                    <span className="font-medium text-text-muted">
                      {linkedReviewCount} 场
                    </span>
                  ) : null}
                  {timelineLabel ? (
                    <span className="font-medium text-accent-blue">
                      {timelineLabel}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`查看 ${linkedApplicationName} 岗位`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpenApplication(session)
                    }}
                    className="text-[11px] font-medium text-text-muted transition-colors hover:text-accent-blue hover:underline"
                  >
                    岗位
                  </button>
                </div>
              ) : null}

              {summary ? (
                <p className={`text-xs leading-relaxed text-text-secondary ${showLinkedApplication ? 'mt-2 line-clamp-2' : 'mt-1 line-clamp-2'}`}>
                  {summary}
                </p>
              ) : null}
            </div>

            {hasPrimaryTrigger ? (
              <div className="flex flex-wrap items-center gap-2 xl:min-w-[188px] xl:flex-col xl:items-end xl:justify-start">
                {showTriggerButton ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onTriggerAnalysis(session.id)
                    }}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium ${
                      session.status === 'analysis_failed'
                        ? 'border-red-500/20 bg-red-500/10 text-red-500 hover:bg-red-500/15'
                        : 'border-green-500/20 bg-green-500/10 text-green-500 hover:bg-green-500/15'
                    }`}
                  >
                    {session.status === 'analysis_failed' ? <RotateCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {session.status === 'analysis_failed' ? '重试生成' : '生成复盘'}
                  </button>
                ) : null}

                {isTriggering ? (
                  <span className="inline-flex h-9 items-center gap-1.5 px-2 text-xs text-text-muted">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    提交中
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  )
}
