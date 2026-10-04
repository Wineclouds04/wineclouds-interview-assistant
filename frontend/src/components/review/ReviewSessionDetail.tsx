import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Edit2, Sparkles, RotateCw, Loader2 } from 'lucide-react'
import dayjs from 'dayjs'
import ReactMarkdown from 'react-markdown'
import { api, getErrorMessage } from '../../lib/api'
import type { ReviewSessionDetail, ReviewTurn } from './types'
import { parseReviewSessionDetail } from './types'
import { getReviewSourceMeta, isWrittenExamReview } from './sourceMeta'
import type { Application } from '../job-tracker/types'
import { parseApplication } from '../job-tracker/types'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import { buildFollowUpDrills, buildNextActions, buildScoreDimensions, dimensionBarTone, dimensionTone, getTurnAvgScore, normalizeCompareText, scoreTextClass } from './reviewDetailModel'
import { ApplicationLinkPanel, CollapsibleSection, HeaderCompactMetric, InlineNotice, InlineNoticeBanner, PendingSummaryWorkspace, SectionPanel, TakeawaysPanel, TurnCard } from './ReviewDetailPanels'

interface Props {
  sessionId: number
  onBack: () => void
}

const REVIEW_STATUS_META: Record<ReviewSessionDetail['status'], { label: string }> = {
  recording: {
    label: '录制中',
  },
  recorded: {
    label: '已记录',
  },
  analyzing: {
    label: '分析中',
  },
  completed: {
    label: '已完成',
  },
  partial_capture: {
    label: '采集不完整',
  },
  analysis_failed: {
    label: '分析失败',
  },
}

const REVIEW_ANALYSIS_POLL_MS = 5000

export default function ReviewSessionDetail({ sessionId, onBack }: Props) {
  const activeSessionIdRef = useRef(sessionId)
  activeSessionIdRef.current = sessionId
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReviewSessionDetail | null>(null)
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ title: '', company: '', role: '' })
  const [savingEdit, setSavingEdit] = useState(false)
  const [triggering, setTriggering] = useState(false)
  const [applications, setApplications] = useState<Application[]>([])
  const [applicationSearch, setApplicationSearch] = useState('')
  const [binding, setBinding] = useState(false)
  const [inlineNotice, setInlineNotice] = useState<InlineNotice | null>(null)
  const triggerAnalysisRef = useRef(false)
  const saveEditRef = useRef(false)
  const bindApplicationRef = useRef(false)
  const setAppMode = useUiPrefsStore((s) => s.setAppMode)
  const setJobTrackerDeepLink = useUiPrefsStore((s) => s.setJobTrackerDeepLink)
  const isActiveSession = (targetSessionId: number) => activeSessionIdRef.current === targetSessionId

  useEffect(() => {
    let cancelled = false
    const targetSessionId = sessionId
    async function load() {
      setLoading(true)
      setError(null)
      setInlineNotice(null)
      setEditing(false)
      setSavingEdit(false)
      saveEditRef.current = false
      setTriggering(false)
      triggerAnalysisRef.current = false
      setBinding(false)
      bindApplicationRef.current = false
      setExpandedTurns(new Set())
      try {
        const data = parseReviewSessionDetail(await api.reviewSessionDetail(targetSessionId) as Record<string, unknown>)
        if (cancelled || !isActiveSession(targetSessionId)) return
        setDetail(data)
        setEditForm({
          title: data.title || '',
          company: data.company || '',
          role: data.role || '',
        })
        if (data.turns && data.turns.length > 0) {
          setExpandedTurns(new Set([data.turns[0].id]))
        }
      } catch (err) {
        if (cancelled || !isActiveSession(targetSessionId)) return
        setError(getErrorMessage(err, '加载详情失败'))
      } finally {
        if (!cancelled && isActiveSession(targetSessionId)) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  useEffect(() => {
    if (detail?.status !== 'analyzing') return undefined

    let cancelled = false
    const targetSessionId = sessionId
    const pollDetail = async () => {
      try {
        const data = parseReviewSessionDetail(await api.reviewSessionDetail(targetSessionId) as Record<string, unknown>)
        if (cancelled || !isActiveSession(targetSessionId)) return
        setDetail(data)
        if (data.status === 'completed') {
          setInlineNotice({ tone: 'success', message: '复盘分析已完成' })
        } else if (data.status === 'analysis_failed') {
          setInlineNotice({ tone: 'error', message: '复盘分析失败，可重试生成' })
        }
      } catch {
        // Keep the existing detail visible; the manual refresh/trigger actions remain available.
      }
    }

    const timer = window.setInterval(pollDetail, REVIEW_ANALYSIS_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [detail?.status, sessionId])

  useEffect(() => {
    let cancelled = false
    async function loadApplications() {
      try {
        const res = await api.jobTrackerApplications()
        if (!cancelled) {
          setApplications((res.items as Record<string, unknown>[]).map(parseApplication))
        }
      } catch {
        if (!cancelled) setApplications([])
      }
    }
    loadApplications()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!inlineNotice) return undefined
    const timer = window.setTimeout(() => setInlineNotice(null), 3600)
    return () => window.clearTimeout(timer)
  }, [inlineNotice])

  const toggleTurn = (turnId: number) => {
    setExpandedTurns((prev) => {
      const next = new Set(prev)
      if (next.has(turnId)) {
        next.delete(turnId)
      } else {
        next.add(turnId)
      }
      return next
    })
  }

  const handleSaveEdit = async () => {
    if (saveEditRef.current) return
    const targetSessionId = sessionId
    const nextForm = { ...editForm }
    saveEditRef.current = true
    setSavingEdit(true)
    try {
      await api.reviewUpdateSession(targetSessionId, nextForm)
      if (!isActiveSession(targetSessionId)) return
      setDetail((prev) => prev?.id === targetSessionId ? { ...prev, ...nextForm } : prev)
      setEditing(false)
      setInlineNotice({ tone: 'success', message: '已保存复盘标题与岗位信息' })
    } catch (err) {
      if (!isActiveSession(targetSessionId)) return
      setInlineNotice({ tone: 'error', message: getErrorMessage(err, '保存失败') })
    } finally {
      if (isActiveSession(targetSessionId)) {
        saveEditRef.current = false
        setSavingEdit(false)
      }
    }
  }

  const handleTriggerAnalysis = async () => {
    if (triggerAnalysisRef.current) return
    const targetSessionId = sessionId
    triggerAnalysisRef.current = true
    setTriggering(true)
    try {
      const result = await api.reviewTriggerAnalysis(targetSessionId)
      if (!isActiveSession(targetSessionId)) return
      if (result.status === 'started' || result.status === 'pending') {
        setDetail((prev) => prev?.id === targetSessionId ? { ...prev, status: 'analyzing' } : prev)
        setInlineNotice({ tone: 'info', message: '复盘分析已开始，请稍后刷新查看结果' })
      } else if (result.status === 'done') {
        const data = parseReviewSessionDetail(await api.reviewSessionDetail(targetSessionId) as Record<string, unknown>)
        if (!isActiveSession(targetSessionId)) return
        setDetail(data)
        setEditForm({
          title: data.title || '',
          company: data.company || '',
          role: data.role || '',
        })
        setInlineNotice({ tone: 'success', message: '复盘已完成' })
      }
    } catch (err) {
      if (!isActiveSession(targetSessionId)) return
      setInlineNotice({ tone: 'error', message: getErrorMessage(err, '触发分析失败') })
    } finally {
      if (isActiveSession(targetSessionId)) {
        triggerAnalysisRef.current = false
        setTriggering(false)
      }
    }
  }

  const handleBindApplication = async (applicationId: number | null) => {
    if (bindApplicationRef.current) return
    const targetSessionId = sessionId
    bindApplicationRef.current = true
    setBinding(true)
    try {
      const result = await api.reviewUpdateSession(targetSessionId, { application_id: applicationId }) as {
        auto_sync_eligible?: boolean
      }
      const data = parseReviewSessionDetail(await api.reviewSessionDetail(targetSessionId) as Record<string, unknown>)
      if (!isActiveSession(targetSessionId)) return
      setDetail(data)
      if (applicationId == null) {
        setInlineNotice({ tone: 'info', message: '已解除求职记录关联' })
      } else if (result?.auto_sync_eligible === false) {
        setInlineNotice({ tone: 'warning', message: '已关联求职记录；当前复盘少于 5 轮，暂不自动同步待办和复盘摘要' })
      } else {
        setInlineNotice({ tone: 'success', message: '已关联求职记录，并同步复盘待办' })
      }
    } catch (err) {
      if (!isActiveSession(targetSessionId)) return
      setInlineNotice({ tone: 'error', message: getErrorMessage(err, '关联求职记录失败') })
    } finally {
      if (isActiveSession(targetSessionId)) {
        bindApplicationRef.current = false
        setBinding(false)
      }
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-text-muted text-sm">加载中...</div>
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="text-text-muted text-sm">{error || '未找到该记录'}</div>
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 text-sm rounded-lg bg-bg-tertiary text-text-primary hover:bg-bg-hover transition-colors"
        >
          返回列表
        </button>
      </div>
    )
  }

  const avgScoreDisplay = detail.avg_score != null ? detail.avg_score.toFixed(1) : '—'
  const sourceMeta = getReviewSourceMeta(detail.source)
  const isWrittenExam = isWrittenExamReview(detail.source)

  const hasGeneratedAnalysis = Boolean(detail.summary_markdown) || detail.avg_score != null ||
    detail.turns?.some((turn) =>
      turn.analysis_status === 'completed' &&
      ((turn.strengths?.length ?? 0) > 0 || (turn.risks?.length ?? 0) > 0 || Object.keys(turn.scorecard ?? {}).length > 0),
    )
  const canTrigger = detail.status === 'analysis_failed' ||
    detail.status === 'recorded' ||
    detail.status === 'recording' ||
    detail.status === 'partial_capture' ||
    (detail.status === 'completed' && !hasGeneratedAnalysis)
  const isAnalyzing = detail.status === 'analyzing'
  const correctedCount = detail.turns?.filter((turn) =>
    Boolean(turn.original_candidate_answer_text && turn.original_candidate_answer_text !== turn.candidate_answer_text),
  ).length ?? 0
  const scoredTurns = detail.turns
    ?.map((turn) => ({ turn, avg: getTurnAvgScore(turn) }))
    .filter((item): item is { turn: ReviewTurn; avg: number } => item.avg !== null) ?? []
  const nextActions = buildNextActions(detail)
  const scoreDimensions = buildScoreDimensions(detail)
  const followUpDrills = buildFollowUpDrills(detail)
  const hasTakeaways = (detail.strong_points?.length ?? 0) > 0 || (detail.weak_points?.length ?? 0) > 0
  const summaryMissing = !detail.summary_markdown
  const autoExpandTurns = summaryMissing && detail.turns.length > 0 && detail.turns.length <= 3
  const applicationQuery = applicationSearch.trim().toLowerCase()
  const linkedApplicationSummary = detail.application
    ? applications.find((app) => app.id === detail.application?.id) ?? null
    : null
  const filteredApplications = applications
    .filter((app) => {
      if (!applicationQuery) return true
      return `${app.company} ${app.position} ${app.city}`.toLowerCase().includes(applicationQuery)
    })
    .slice(0, 8)
  const titleText = detail.title || (detail.company && detail.role
    ? `${detail.company} - ${detail.role}`
    : detail.company || detail.role || sourceMeta.detailLabel)
  const detailIdentityText = `${detail.company ?? ''}${detail.company && detail.role ? ' - ' : ''}${detail.role ?? ''}`.trim()
  const subtitleText = detail.title && (detail.company || detail.role) && normalizeCompareText(detail.title) !== normalizeCompareText(detailIdentityText)
    ? detailIdentityText
    : null
  const reviewStatusMeta = REVIEW_STATUS_META[detail.status]
  const sessionDurationMinutes = detail.ended_at
    ? Math.max(1, Math.floor((detail.ended_at - detail.started_at) / 60))
    : null

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <section className="border-b border-bg-hover/80 pb-4">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={onBack}
              className="mt-1 rounded-md p-1.5 text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary"
              title="返回列表"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <div className="min-w-0 flex-1">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.78fr)]">
                <div className="min-w-0">
                  {editing ? (
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={editForm.title}
                        onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                        disabled={savingEdit}
                        placeholder="面试标题（可选）"
                        className="w-full rounded-xl border border-bg-hover bg-bg-secondary px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-blue/15 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <input
                          type="text"
                          value={editForm.company}
                          onChange={(e) => setEditForm({ ...editForm, company: e.target.value })}
                          disabled={savingEdit}
                          placeholder="公司名称"
                          className="w-full rounded-xl border border-bg-hover bg-bg-secondary px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-blue/15 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                        <input
                          type="text"
                          value={editForm.role}
                          onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                          disabled={savingEdit}
                          placeholder="岗位名称"
                          className="w-full rounded-xl border border-bg-hover bg-bg-secondary px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-blue/15 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleSaveEdit}
                          disabled={savingEdit}
                          className="inline-flex items-center gap-2 rounded-xl bg-accent-blue px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          {savingEdit ? '保存中' : '保存信息'}
                        </button>
                        <button
                          type="button"
                          disabled={savingEdit}
                          onClick={() => {
                            setEditing(false)
                            setEditForm({
                              title: detail.title || '',
                              company: detail.company || '',
                              role: detail.role || '',
                            })
                          }}
                          className="rounded-xl border border-bg-hover px-4 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-2xl font-bold tracking-tight text-text-primary md:text-[28px]">
                          {titleText}
                        </h2>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${sourceMeta.badgeClassName}`}>
                          {sourceMeta.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => setEditing(true)}
                          className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                          title="编辑信息"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                      </div>
                      {subtitleText ? (
                        <div className="mt-1 text-sm text-text-secondary">
                          {subtitleText}
                        </div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-text-muted">
                        <span>{reviewStatusMeta.label}</span>
                        {detail.application ? <span>已绑定求职记录</span> : null}
                        {detail.auto_sync_eligible === false ? <span>测试片段</span> : null}
                        <span>{dayjs.unix(Math.floor(detail.started_at)).format('YYYY-MM-DD HH:mm')}</span>
                        {sessionDurationMinutes != null ? <span>时长 {sessionDurationMinutes} 分钟</span> : null}
                        <span>{detail.turn_count} {sourceMeta.unit}</span>
                        <span>{scoredTurns.length} {sourceMeta.unit}已评分</span>
                      </div>
                    </>
                  )}
                </div>

                {!editing ? (
                  <div className="space-y-3">
                    <div className="flex w-full flex-wrap items-center gap-2 xl:justify-end">
                      {canTrigger && !isAnalyzing ? (
                        <button
                          type="button"
                          onClick={handleTriggerAnalysis}
                          disabled={triggering}
                          className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                            detail.status === 'analysis_failed'
                              ? 'bg-red-500/12 text-red-500 hover:bg-red-500/18 disabled:opacity-50'
                              : 'bg-accent-blue text-white hover:brightness-110 disabled:opacity-50'
                          }`}
                        >
                          {triggering ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              处理中
                            </>
                          ) : detail.status === 'analysis_failed' ? (
                            <>
                              <RotateCw className="h-4 w-4" />
                              重新生成复盘
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-4 w-4" />
                              生成复盘
                            </>
                          )}
                        </button>
                      ) : null}
                      {isAnalyzing ? (
                        <div className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-500/10 px-4 py-2.5 text-sm font-medium text-blue-500">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          分析中
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-bg-hover/60 pt-3">
                      <HeaderCompactMetric
                        label="评分"
                        value={avgScoreDisplay}
                        valueClass={detail.avg_score != null ? scoreTextClass(detail.avg_score) : 'text-text-primary'}
                      />
                      {isWrittenExam ? (
                        <HeaderCompactMetric
                          label="模式"
                          value="笔试"
                          valueClass="text-cyan-500"
                        />
                      ) : (
                        <HeaderCompactMetric
                          label="纠错"
                          value={String(correctedCount)}
                          valueClass={correctedCount > 0 ? 'text-blue-500' : 'text-text-secondary'}
                        />
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {inlineNotice ? (
          <InlineNoticeBanner notice={inlineNotice} />
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_340px]">
          <div className="space-y-4">
            <SectionPanel
              title={summaryMissing ? '当前状态' : '整体评价'}
            >
              {detail.summary_markdown ? (
                <div className="prose prose-sm prose-invert max-w-none text-text-primary leading-relaxed">
                  <ReactMarkdown>{detail.summary_markdown}</ReactMarkdown>
                </div>
              ) : (
                <PendingSummaryWorkspace
                  detail={detail}
                  scoredTurnsCount={scoredTurns.length}
                  correctedCount={correctedCount}
                  isAnalyzing={isAnalyzing}
                  sourceMeta={sourceMeta}
                />
              )}
            </SectionPanel>

            {nextActions.length > 0 ? (
              <SectionPanel title="下一轮补强">
                <ol className="divide-y divide-bg-hover/70">
                  {nextActions.map((item, idx) => (
                    <li key={`${item}-${idx}`} className="grid gap-2 py-2 text-sm leading-relaxed text-text-primary sm:grid-cols-[2rem_minmax(0,1fr)]">
                      <span className="text-xs font-semibold text-text-muted">{idx + 1}</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ol>
              </SectionPanel>
            ) : null}

            {detail.turns.length > 0 ? (
              <CollapsibleSection
                title={`逐题分析 · ${detail.turns.length} 题`}
                subtitle={autoExpandTurns ? '短记录，已展开。' : undefined}
                defaultOpen={autoExpandTurns}
              >
                <div className="space-y-3">
                  {detail.turns.map((turn) => (
                    <TurnCard
                      key={turn.id}
                      turn={turn}
                      expanded={expandedTurns.has(turn.id)}
                      sourceMeta={sourceMeta}
                      onToggle={() => toggleTurn(turn.id)}
                    />
                  ))}
                </div>
              </CollapsibleSection>
            ) : (
              <SectionPanel title="逐题分析">
                <div className="border-l border-bg-hover/80 py-1 pl-3 text-sm text-text-secondary">
                  {isWrittenExam ? '有截图题后会显示生成答案、自检和评分。' : '有问答后会显示原文、纠错和评分。'}
                </div>
              </SectionPanel>
            )}
          </div>

          <div className="space-y-4 xl:sticky xl:top-3 xl:self-start">
            <ApplicationLinkPanel
              detail={detail}
              linkedApplicationSummary={linkedApplicationSummary}
              applications={filteredApplications}
              search={applicationSearch}
              binding={binding}
              onSearch={setApplicationSearch}
              onBind={handleBindApplication}
              onGoJobTracker={(applicationId) => {
                setJobTrackerDeepLink({
                  applicationId,
                  openReviews: false,
                })
                setAppMode('job-tracker')
              }}
              onOpenReviewTimeline={(applicationId) => {
                setJobTrackerDeepLink({
                  applicationId,
                  openReviews: true,
                  highlightReviewId: sessionId,
                })
                setAppMode('job-tracker')
              }}
            />

            {hasTakeaways ? (
              <TakeawaysPanel
                strongPoints={detail.strong_points ?? []}
                weakPoints={detail.weak_points ?? []}
              />
            ) : null}

            {scoreDimensions.length > 0 ? (
              <CollapsibleSection title="能力维度">
                <div className="space-y-3">
                  {scoreDimensions.map((item) => (
                    <div key={item.name}>
                      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium text-text-secondary">{item.name}</span>
                        <span className={`font-semibold ${dimensionTone(item.avg)}`}>{item.avg.toFixed(1)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-bg-tertiary">
                        <div
                          className={`h-full rounded-full ${dimensionBarTone(item.avg)}`}
                          style={{ width: `${Math.max(4, Math.min(100, item.avg * 10))}%` }}
                        />
                      </div>
                      <div className="mt-1 text-[10px] text-text-muted">{item.count} 题覆盖</div>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            ) : null}

            {followUpDrills.length > 0 ? (
              <CollapsibleSection
                title={`追问训练 · ${followUpDrills.length}`}
              >
                <ol className="divide-y divide-bg-hover/70">
                  {followUpDrills.map((item) => (
                    <li key={`${item.seq}-${item.question}`} className="py-2.5">
                      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-muted">
                        <span className="font-semibold">第 {item.seq} 题</span>
                        {item.tags.length > 0 ? <span>{item.tags.join(' / ')}</span> : null}
                      </div>
                      <div className="text-sm leading-relaxed text-text-primary">{item.question}</div>
                      {item.advice ? (
                        <div className="mt-2 text-xs leading-relaxed text-text-muted">{item.advice}</div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </CollapsibleSection>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
