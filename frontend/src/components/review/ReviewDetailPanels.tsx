import { useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown, ChevronRight, Link2, Unlink, ExternalLink, Shield, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { ReviewSessionDetail, ReviewTurn } from './types'
import { isWrittenExamReview, type ReviewSourceMeta } from './sourceMeta'
import type { Application } from '../job-tracker/types'
import { STAGE_LABELS, isTerminalStage } from '../job-tracker/stageConfig'
import { TurnVisionVerify, getStringList, getStringValue, getTurnAvgScore, getTurnVisionVerify, parseScoreValue, scoreTextClass } from './reviewDetailModel'

export type InlineNotice = {
  tone: 'success' | 'info' | 'warning' | 'error'
  message: string
}

export function SectionPanel({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <section className="border-t border-bg-hover/80 py-4">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-text-primary">{title}</h3>
        {subtitle ? <p className="mt-1 text-xs text-text-secondary">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  )
}

export function CollapsibleSection({
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="border-t border-bg-hover/80 py-1">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 py-3 text-left"
      >
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-text-primary">{title}</h3>
          {subtitle ? <p className="mt-1 text-xs text-text-secondary">{subtitle}</p> : null}
        </div>
        <span className="p-1.5 text-text-muted">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>
      {open ? <div className="border-t border-bg-hover/70 py-3">{children}</div> : null}
    </section>
  )
}

export function TakeawaysPanel({
  strongPoints,
  weakPoints,
}: {
  strongPoints: string[]
  weakPoints: string[]
}) {
  return (
    <SectionPanel
      title="亮点与风险"
    >
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-1">
        {strongPoints.length > 0 ? (
          <section className="min-w-0">
            <div className="text-sm font-semibold text-green-500">高频亮点</div>
            <ul className="mt-2 space-y-1.5 border-l border-green-500/25 pl-3">
              {strongPoints.map((point, idx) => (
                <li key={`${point}-${idx}`} className="text-sm leading-relaxed text-text-primary">
                  {point}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {weakPoints.length > 0 ? (
          <section className="min-w-0">
            <div className="text-sm font-semibold text-yellow-500">待改进点</div>
            <ul className="mt-2 space-y-1.5 border-l border-yellow-500/25 pl-3">
              {weakPoints.map((point, idx) => (
                <li key={`${point}-${idx}`} className="text-sm leading-relaxed text-text-primary">
                  {point}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </SectionPanel>
  )
}

export function HeaderCompactMetric({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string
  valueClass: string
}) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5 text-xs">
      <span className="font-medium text-text-muted">{label}</span>
      <span className={`font-semibold ${valueClass}`}>{value}</span>
    </span>
  )
}

export function PendingSummaryWorkspace({
  detail,
  scoredTurnsCount,
  correctedCount,
  isAnalyzing,
  sourceMeta,
}: {
  detail: ReviewSessionDetail
  scoredTurnsCount: number
  correctedCount: number
  isAnalyzing: boolean
  sourceMeta: ReviewSourceMeta
}) {
  const unitLabel = isWrittenExamReview(detail.source) ? '题目' : '问答'
  const headline = isAnalyzing
    ? '整理中'
    : detail.status === 'analysis_failed'
      ? '生成失败'
      : detail.auto_sync_eligible === false
        ? '短样本'
        : detail.status === 'recorded' || detail.status === 'recording' || detail.status === 'partial_capture'
          ? '原始记录'
          : '未生成复盘'

  const description = isAnalyzing
    ? `${detail.turn_count} ${sourceMeta.unit}`
    : detail.status === 'analysis_failed'
      ? '可重试'
      : detail.auto_sync_eligible === false
        ? `${detail.turn_count} ${sourceMeta.unit} · 不回写看板`
      : detail.turn_count <= 0
          ? `暂无${unitLabel}`
          : `${detail.turn_count} ${sourceMeta.unit}${correctedCount > 0 ? ` · ${correctedCount} 处纠错` : ''}`

  return (
    <div className="flex flex-col gap-2 border-l border-bg-hover/80 pl-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0 text-sm text-text-secondary">
        <span className="font-semibold text-text-primary">{headline}</span>
        <span className="mx-2 text-text-muted">·</span>
        <span>{description}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        <span>{unitLabel} <span className="font-semibold text-text-primary">{detail.turn_count}</span></span>
        <span>已评分 <span className="font-semibold text-text-primary">{scoredTurnsCount}</span></span>
        {detail.application ? (
          <span>主线 <span className="font-semibold text-text-primary">已绑定</span></span>
        ) : null}
        {detail.auto_sync_eligible === false ? (
          <span className="text-yellow-500">不回写看板</span>
        ) : null}
      </div>
    </div>
  )
}

export function TurnCard({
  turn,
  expanded,
  sourceMeta,
  onToggle,
}: {
  turn: ReviewTurn
  expanded: boolean
  sourceMeta: ReviewSourceMeta
  onToggle: () => void
}) {
  const isWrittenExam = sourceMeta.kind === 'written_exam'
  const answerText = isWrittenExam
    ? (turn.reference_answer_text || turn.candidate_answer_text || '')
    : turn.candidate_answer_text
  const visionVerify = getTurnVisionVerify(turn)
  const improvementAdvice = getStringValue(turn.evidence?.improvement_advice)
  const followUpQuestions = getStringList(turn.evidence?.follow_up_questions).slice(0, 2)
  const evidenceTags = getStringList(turn.evidence?.tags).slice(0, 3)
  const hasActionEvidence = Boolean(improvementAdvice || followUpQuestions.length > 0 || evidenceTags.length > 0)
  const hasAnalysis =
    (turn.strengths && turn.strengths.length > 0) ||
    (turn.risks && turn.risks.length > 0) ||
    (turn.scorecard && Object.keys(turn.scorecard).length > 0) ||
    hasActionEvidence

  const avgScore = getTurnAvgScore(turn)
  const hasAsrCorrection = Boolean(
    !isWrittenExam &&
    turn.original_candidate_answer_text &&
    turn.original_candidate_answer_text !== turn.candidate_answer_text,
  )

  const scoreColor = avgScore !== null
    ? avgScore >= 8 ? 'text-green-500'
      : avgScore >= 6 ? 'text-blue-500'
      : avgScore >= 4 ? 'text-yellow-500'
      : 'text-red-500'
    : 'text-text-muted'

  return (
    <div className="border-t border-bg-hover/70">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 py-3 text-left transition-colors hover:bg-bg-tertiary/15"
      >
        <div className="mt-1 flex-shrink-0">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-text-muted" />
          ) : (
            <ChevronRight className="h-4 w-4 text-text-muted" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs font-semibold text-text-muted">第 {turn.seq} 题</span>
            {turn.is_partial && (
              <span className="text-[10px] font-medium text-yellow-500">
                部分录制
              </span>
            )}
            {visionVerify?.verdict === 'FAIL' && (
              <span className="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-500">
                截图自检风险
              </span>
            )}
          </div>
          <div className="text-sm text-text-primary leading-relaxed">{turn.question_text}</div>
        </div>
        {avgScore !== null && (
          <div className="flex-shrink-0 text-right">
            <span className={`text-xs font-semibold ${scoreColor}`}>{avgScore.toFixed(1)}</span>
          </div>
        )}
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-bg-hover/40 py-3">
          {visionVerify && <TurnVisionVerifyNotice verify={visionVerify} />}
          <div>
            <h4 className="mb-2 text-xs font-semibold text-text-muted">{sourceMeta.answerHeading}</h4>
            {hasAsrCorrection && (
              <details className="mb-2 rounded-md border border-accent-blue/20 bg-accent-blue/5 px-3 py-2 text-xs">
                <summary className="cursor-pointer select-none font-semibold text-accent-blue">
                  ASR 已纠错，当前显示纠错后回答
                </summary>
                <div className="mt-2 whitespace-pre-wrap border-l border-bg-hover/80 pl-3 leading-relaxed text-text-muted">
                  原始转写：{turn.original_candidate_answer_text}
                </div>
              </details>
            )}
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
              {answerText || sourceMeta.emptyAnswer}
            </div>
          </div>

          {turn.code_text && (
            <div>
              <h4 className="mb-2 text-xs font-semibold text-text-muted">代码</h4>
              <pre className="overflow-x-auto rounded-md border border-bg-hover/40 bg-bg-tertiary/80 p-3 text-xs">
                <code>{turn.code_text}</code>
              </pre>
            </div>
          )}

          {hasAnalysis && (
            <>
              {turn.scorecard && Object.keys(turn.scorecard).length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold text-text-muted">评分详情</h4>
                  <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                    {Object.entries(turn.scorecard).map(([key, score]) => {
                      const parsedScore = parseScoreValue(score)
                      const scoreTone = parsedScore !== null ? scoreTextClass(parsedScore) : 'text-text-muted'
                      const scoreLabel = parsedScore !== null ? parsedScore.toFixed(1) : String(score ?? '—')

                      return (
                        <div
                          key={key}
                          className="flex min-w-0 items-center justify-between gap-3 border-b border-bg-hover/50 py-1.5"
                        >
                          <span className="min-w-0 truncate text-xs text-text-secondary">{key}</span>
                          <span className={`text-sm font-semibold ${scoreTone}`}>{scoreLabel}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {turn.strengths && turn.strengths.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold text-green-500">亮点</h4>
                  <ul className="space-y-1.5 border-l border-green-500/25 pl-3">
                    {turn.strengths.map((s, idx) => (
                      <li key={idx} className="text-sm leading-relaxed text-text-primary">
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {turn.risks && turn.risks.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold text-yellow-500">待改进</h4>
                  <ul className="space-y-1.5 border-l border-yellow-500/25 pl-3">
                    {turn.risks.map((r, idx) => (
                      <li key={idx} className="text-sm leading-relaxed text-text-primary">
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {hasActionEvidence && (
                <div className="rounded-md border border-bg-hover/70 bg-bg-tertiary/35 px-3 py-2.5">
                  <h4 className="mb-2 text-xs font-semibold text-text-muted">复练建议</h4>
                  {improvementAdvice && (
                    <div className="text-sm leading-relaxed text-text-primary">{improvementAdvice}</div>
                  )}
                  {followUpQuestions.length > 0 && (
                    <ul className="mt-2 space-y-1.5 border-l border-accent-blue/25 pl-3">
                      {followUpQuestions.map((question, idx) => (
                        <li key={idx} className="text-sm leading-relaxed text-text-primary">
                          {question}
                        </li>
                      ))}
                    </ul>
                  )}
                  {evidenceTags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {evidenceTags.map((tag) => (
                        <span key={tag} className="rounded border border-bg-hover bg-bg-primary/60 px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {!hasAnalysis && (
            <div className="border-l border-bg-hover/80 pl-3 text-xs text-text-muted">
              {turn.analysis_status === 'pending'
                ? '等待分析'
                : turn.analysis_status === 'analyzing'
                  ? '分析中...'
                  : '暂无分析'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function TurnVisionVerifyNotice({ verify }: { verify: TurnVisionVerify }) {
  const meta = verify.verdict === 'PASS'
    ? {
        icon: ShieldCheck,
        label: '截图自检通过',
        className: 'border-green-500/25 bg-green-500/5 text-green-500',
      }
    : verify.verdict === 'FAIL'
      ? {
          icon: ShieldAlert,
          label: '截图自检不一致，请人工复核',
          className: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-500',
        }
      : {
          icon: Shield,
          label: '截图自检无定论',
          className: 'border-bg-hover/70 bg-bg-tertiary/30 text-text-muted',
        }
  const Icon = meta.icon
  return (
    <div
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed ${meta.className}`}
      role={verify.verdict === 'FAIL' ? 'alert' : 'status'}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <div className="min-w-0">
        <div className="font-semibold">{meta.label}</div>
        {verify.reason && (
          <div className="mt-0.5 break-words opacity-85">{verify.reason}</div>
        )}
      </div>
    </div>
  )
}

export function ApplicationLinkPanel({
  detail,
  linkedApplicationSummary,
  applications,
  search,
  binding,
  onSearch,
  onBind,
  onGoJobTracker,
  onOpenReviewTimeline,
}: {
  detail: ReviewSessionDetail
  linkedApplicationSummary: Application | null
  applications: Application[]
  search: string
  binding: boolean
  onSearch: (value: string) => void
  onBind: (applicationId: number | null) => void
  onGoJobTracker: (applicationId: number) => void
  onOpenReviewTimeline: (applicationId: number) => void
}) {
  const linked = detail.application
  const [changing, setChanging] = useState(false)
  const selecting = !linked || changing
  const isClosedStage = linked ? isTerminalStage(linked.stage) : false
  const linkedReviewSummary = linkedApplicationSummary?.review_summary
  const linkedReviewCount = linkedReviewSummary?.review_count ?? 0
  const isLatestLinkedReview = linkedReviewSummary?.latest_review_id != null && linkedReviewSummary.latest_review_id === detail.id
  const linkedStageLabel = linked ? STAGE_LABELS[linked.stage] ?? linked.stage : ''
  const reviewRelationshipLabel = linkedReviewCount <= 1
    ? '唯一一场'
    : isLatestLinkedReview
      ? '最近一场'
      : '更早一场'
  const syncNote = detail.auto_sync_eligible === false
    ? '短样本'
    : isClosedStage
      ? '已结束'
      : '同步待办'
  return (
    <section className="border-l border-bg-hover/80 pl-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Link2 className="h-4 w-4 text-text-muted" />
            关联求职记录
          </h3>
        </div>
        {linked ? (
          <button
            type="button"
            onClick={() => onGoJobTracker(linked.id)}
            className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-accent-blue hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            去求职看板
          </button>
        ) : null}
      </div>

      {linked && !changing ? (
        <div className="space-y-3 border-t border-bg-hover/70 pt-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text-primary">
                {linked.company || '未命名公司'} · {linked.position || '岗位'}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                <span>{linkedStageLabel}</span>
                {linked.city ? <span>{linked.city}</span> : null}
                <span>{syncNote}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-baseline gap-1.5 text-xs text-text-muted">
              <span className="font-semibold text-text-primary">{linkedReviewCount}</span>
              <span>场复盘</span>
              <span>{reviewRelationshipLabel}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-2 text-[11px]">
            {linkedReviewSummary && linkedReviewSummary.review_count > 0 ? (
              <button
                type="button"
                disabled={binding}
                onClick={() => onOpenReviewTimeline(linked.id)}
                className="inline-flex items-center justify-center gap-1.5 font-semibold text-accent-blue hover:underline disabled:opacity-60"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                全部复盘
              </button>
            ) : null}
            <button
              type="button"
              disabled={binding}
              onClick={() => setChanging(true)}
              className="inline-flex items-center justify-center gap-1.5 font-medium text-text-secondary hover:text-text-primary disabled:opacity-60"
            >
              <Link2 className="h-3.5 w-3.5" />
              改绑
            </button>
            <button
              type="button"
              disabled={binding}
              onClick={() => onBind(null)}
              className="inline-flex items-center justify-center gap-1.5 font-medium text-red-400 hover:underline disabled:opacity-60"
            >
              <Unlink className="h-3.5 w-3.5" />
              解绑
            </button>
          </div>
        </div>
      ) : null}

      {selecting && (
        <div className="space-y-3">
          {linked ? (
            <div className="flex items-center justify-between gap-3 border-l border-bg-hover/80 pl-3 text-xs text-text-muted">
              <span>当前关联：{linked.company || '未命名公司'} · {linked.position || '岗位'}</span>
              <button type="button" onClick={() => setChanging(false)} className="text-accent-blue hover:underline">取消改绑</button>
            </div>
          ) : (
            <div className="text-xs text-text-muted">绑定到岗位主线</div>
          )}
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="搜索公司、岗位、城市"
            className="w-full rounded-lg border border-bg-hover bg-bg-tertiary/45 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-blue/50 focus:outline-none"
          />
          <div className="grid gap-2 md:grid-cols-2">
            {applications.map((app) => (
              <button
                key={app.id}
                type="button"
                disabled={binding}
                onClick={() => {
                  setChanging(false)
                  onBind(app.id)
                }}
                className="rounded-lg border border-bg-hover bg-bg-tertiary/30 px-3 py-2 text-left hover:border-accent-blue/35 hover:bg-accent-blue/5 disabled:opacity-60"
              >
                <div className="text-sm font-semibold text-text-primary">{app.company || '未命名公司'}</div>
                <div className="mt-1 text-xs text-text-muted">
                  {app.position || '岗位'}{app.city ? ` · ${app.city}` : ''} · {STAGE_LABELS[app.stage] ?? app.stage}
                </div>
              </button>
            ))}
          </div>
          {applications.length === 0 ? (
            <div className="border-l border-bg-hover/80 py-1 pl-3 text-xs text-text-muted">
              暂无可绑定岗位
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

export function InlineNoticeBanner({ notice }: { notice: InlineNotice }) {
  const toneClass = {
    success: 'border-green-500/20 bg-green-500/8 text-green-500',
    info: 'border-accent-blue/20 bg-accent-blue/8 text-accent-blue',
    warning: 'border-yellow-500/20 bg-yellow-500/8 text-yellow-500',
    error: 'border-red-500/20 bg-red-500/8 text-red-500',
  }[notice.tone]

  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${toneClass}`}>
      {notice.message}
    </div>
  )
}
