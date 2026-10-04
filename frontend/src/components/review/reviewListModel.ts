import type { ComponentType } from 'react'
import { AlertCircle, CheckCircle, Clock, XCircle, Sparkles, Loader2 } from 'lucide-react'
import type { ReviewSession } from './types'
import { isWrittenExamReview } from './sourceMeta'

export const STATUS_ICONS: Record<ReviewSession['status'], ComponentType<{ className?: string }>> = {
  recording: Clock,
  recorded: Sparkles,
  analyzing: Loader2,
  completed: CheckCircle,
  partial_capture: AlertCircle,
  analysis_failed: XCircle,
}

export const STATUS_COLORS: Record<ReviewSession['status'], string> = {
  recording: 'text-blue-500',
  recorded: 'text-amber-500',
  analyzing: 'text-blue-500',
  completed: 'text-green-500',
  partial_capture: 'text-yellow-500',
  analysis_failed: 'text-red-500',
}

export type ReviewListFocus = 'all' | 'attention' | 'active' | 'done'

export type SessionGroup = {
  key: Exclude<ReviewListFocus, 'all'>
  title: string
  items: ReviewSession[]
}

export type SessionCluster = {
  key: string
  application: ReviewSession['application'] | null
  items: ReviewSession[]
}

export function sessionHasGeneratedAnalysis(session: ReviewSession) {
  return Boolean(session.summary_markdown) || session.avg_score != null
}

export function getSessionUiState(
  session: ReviewSession,
  triggeringIds: Set<number>,
  hasGeneratedAnalysis: (session: ReviewSession) => boolean,
) {
  const StatusIcon = STATUS_ICONS[session.status]
  const statusColor = STATUS_COLORS[session.status]
  const isTriggering = triggeringIds.has(session.id)
  const canTrigger = session.status === 'analysis_failed' ||
    session.status === 'partial_capture' ||
    session.status === 'recorded' ||
    session.status === 'recording' ||
    (session.status === 'completed' && !hasGeneratedAnalysis(session))
  const showTriggerButton = canTrigger && !isTriggering
  return {
    StatusIcon,
    statusColor,
    isTriggering,
    showTriggerButton,
  }
}

export function statusTextTone(status: ReviewSession['status']) {
  switch (status) {
    case 'analysis_failed':
      return 'text-red-500'
    case 'partial_capture':
      return 'text-yellow-500'
    case 'recorded':
      return 'text-amber-500'
    case 'analyzing':
    case 'recording':
      return 'text-blue-500'
    case 'completed':
      return 'text-green-500'
    default:
      return 'text-text-secondary'
  }
}

export function sessionRailTone(status: ReviewSession['status']) {
  switch (status) {
    case 'analysis_failed':
      return 'bg-red-500'
    case 'partial_capture':
    case 'recorded':
      return 'bg-yellow-500'
    case 'analyzing':
    case 'recording':
      return 'bg-blue-500'
    case 'completed':
      return 'bg-emerald-500'
    default:
      return 'bg-zinc-400'
  }
}

export function sessionSummary(session: ReviewSession): string | null {
  const isWrittenExam = isWrittenExamReview(session.source)
  const normalized = String(session.summary_markdown ?? '')
    .replace(/[#>*`_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (normalized) return normalized
  if (session.status === 'analysis_failed') {
    return '生成失败'
  }
  if (session.status === 'partial_capture') {
    return '采集不完整'
  }
  if (session.status === 'recorded') {
    if (isWrittenExam) {
      return session.auto_sync_eligible === false
        ? '短样本笔试记录'
        : '待生成笔试报告'
    }
    return session.auto_sync_eligible === false
      ? '短样本'
      : '待生成'
  }
  if (session.status === 'analyzing') {
    return isWrittenExam ? '整理笔试报告中' : '整理中'
  }
  if (session.status === 'recording') {
    return isWrittenExam ? '笔试记录中' : '录制中'
  }
  return null
}

export function buildSessionClusters(sessions: ReviewSession[]): SessionCluster[] {
  const ordered: SessionCluster[] = []
  const clusterByApplicationId = new Map<number, SessionCluster>()

  for (const session of sessions) {
    const applicationId = session.application?.id
    if (applicationId == null) {
      ordered.push({
        key: `session-${session.id}`,
        application: null,
        items: [session],
      })
      continue
    }

    const existing = clusterByApplicationId.get(applicationId)
    if (existing) {
      existing.items.push(session)
      continue
    }

    const nextCluster: SessionCluster = {
      key: `application-${applicationId}`,
      application: session.application ?? null,
      items: [session],
    }
    clusterByApplicationId.set(applicationId, nextCluster)
    ordered.push(nextCluster)
  }

  return ordered
}

export function describeTimelinePosition(index: number, total: number) {
  if (total <= 1) return '唯一一场'
  if (index === 0) return '最近一场'
  if (index === total - 1) return '更早一场'
  return '中间场'
}

export function buildSessionGroups(
  sessions: ReviewSession[],
  hasGeneratedAnalysis: (session: ReviewSession) => boolean,
): SessionGroup[] {
  return [
    {
      key: 'attention' as const,
      title: '先处理',
      items: sessions.filter((session) =>
        session.status === 'analysis_failed' ||
        session.status === 'partial_capture' ||
        session.status === 'recorded' ||
        (session.status === 'completed' && !hasGeneratedAnalysis(session)),
      ),
    },
    {
      key: 'active' as const,
      title: '进行中',
      items: sessions.filter((session) =>
        session.status === 'analyzing' || session.status === 'recording',
      ),
    },
    {
      key: 'done' as const,
      title: '已完成',
      items: sessions.filter((session) =>
        session.status === 'completed' && hasGeneratedAnalysis(session),
      ),
    },
  ].filter((group) => group.items.length > 0)
}
