import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Settings, Upload, RefreshCw } from 'lucide-react'
import { api, getErrorMessage } from '../../lib/api'
import { useInterviewStore } from '../../stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import { isLightColorScheme } from '@/lib/colorScheme'
import type { ReviewSession, ReviewSessionsResponse } from './types'
import { parseReviewSessionsResponse } from './types'
import { ReviewListFocus, buildSessionGroups, describeTimelinePosition, sessionHasGeneratedAnalysis } from './reviewListModel'
import { ManualImportPanel, ReviewSettingsPanel, ReviewZeroState, SessionTable } from './ReviewListPanels'

const REVIEW_LIST_POLL_MS = 7000

interface Props {
  onViewDetail: (sessionId: number) => void
}

export default function ReviewSessionList({ onViewDetail }: Props) {
  const latestLoadIdRef = useRef(0)
  const reviewConfigSaveSeqRef = useRef(0)
  const reviewToggleSaveSeqRef = useRef(0)
  const reviewModelSaveSeqRef = useRef(0)
  const triggeringIdsRef = useRef<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ReviewSessionsResponse | null>(null)
  const [page, setPage] = useState(1)
  const [showSettings, setShowSettings] = useState(false)
  const [showManualImport, setShowManualImport] = useState(false)
  const [triggeringIds, setTriggeringIds] = useState<Set<number>>(new Set())
  const [focusFilter, setFocusFilter] = useState<ReviewListFocus>('all')
  const [pendingReviewEnabled, setPendingReviewEnabled] = useState<boolean | null>(null)
  const [pendingReviewModelIndex, setPendingReviewModelIndex] = useState<number | null>(null)
  const pageSize = 20

  const config = useInterviewStore((s) => s.config)
  const setConfig = useInterviewStore((s) => s.setConfig)
  const setToastMessage = useInterviewStore((s) => s.setToastMessage)
  const colorScheme = useUiPrefsStore((s) => s.colorScheme)
  const setAppMode = useUiPrefsStore((s) => s.setAppMode)
  const setJobTrackerDeepLink = useUiPrefsStore((s) => s.setJobTrackerDeepLink)
  const isLight = isLightColorScheme(colorScheme)

  const reviewEnabled = config?.review_enabled ?? false
  const reviewModelIndex = config?.review_model_index ?? 0
  const models = config?.models ?? []
  const displayedReviewEnabled = pendingReviewEnabled ?? reviewEnabled
  const displayedReviewModelIndex = pendingReviewModelIndex ?? reviewModelIndex

  const loadSessions = useCallback(async (p: number, options?: { silent?: boolean }) => {
    const loadId = latestLoadIdRef.current + 1
    latestLoadIdRef.current = loadId
    let redirectedToValidPage = false
    if (!options?.silent) setLoading(true)
    try {
      const resp = await api.reviewSessions(p, pageSize)
      if (loadId !== latestLoadIdRef.current) return
      const parsed = parseReviewSessionsResponse(resp)
      const lastPage = Math.max(1, Math.ceil(parsed.total / pageSize))
      if (p > lastPage) {
        redirectedToValidPage = true
        setPage(lastPage)
        return
      }
      setData(parsed)
    } catch (err) {
      if (loadId === latestLoadIdRef.current && !options?.silent) {
        setToastMessage(getErrorMessage(err, '加载复盘列表失败'))
      }
    } finally {
      if (loadId === latestLoadIdRef.current && !options?.silent && !redirectedToValidPage) {
        setLoading(false)
      }
    }
  }, [setToastMessage])

  useEffect(() => {
    loadSessions(page)
  }, [page, loadSessions])

  const toggleManualImport = useCallback(() => {
    setShowManualImport((prev) => {
      const next = !prev
      if (next) setShowSettings(false)
      return next
    })
  }, [])

  const toggleSettings = useCallback(() => {
    setShowSettings((prev) => {
      const next = !prev
      if (next) setShowManualImport(false)
      return next
    })
  }, [])

  const handleToggleReview = async (enabled: boolean) => {
    const saveSeq = reviewConfigSaveSeqRef.current + 1
    reviewConfigSaveSeqRef.current = saveSeq
    const toggleSaveSeq = reviewToggleSaveSeqRef.current + 1
    reviewToggleSaveSeqRef.current = toggleSaveSeq
    setPendingReviewEnabled(enabled)
    try {
      const updated = await api.updateConfig({ review_enabled: enabled })
      if (saveSeq !== reviewConfigSaveSeqRef.current) return
      setConfig(updated)
      setToastMessage(enabled ? '已开启自动生成复盘' : '已关闭自动生成复盘')
    } catch (err) {
      if (saveSeq === reviewConfigSaveSeqRef.current) {
        setToastMessage(getErrorMessage(err, '开关切换失败'))
      }
    } finally {
      if (toggleSaveSeq === reviewToggleSaveSeqRef.current) {
        setPendingReviewEnabled(null)
      }
    }
  }

  const handleChangeModel = async (modelIndex: number) => {
    const saveSeq = reviewConfigSaveSeqRef.current + 1
    reviewConfigSaveSeqRef.current = saveSeq
    const modelSaveSeq = reviewModelSaveSeqRef.current + 1
    reviewModelSaveSeqRef.current = modelSaveSeq
    setPendingReviewModelIndex(modelIndex)
    try {
      const updated = await api.updateConfig({ review_model_index: modelIndex })
      if (saveSeq !== reviewConfigSaveSeqRef.current) return
      setConfig(updated)
      const modelName = updated.models?.[modelIndex]?.name ?? models[modelIndex]?.name ?? '当前模型'
      setToastMessage(`已切换复盘模型为 ${modelName}`)
    } catch (err) {
      if (saveSeq === reviewConfigSaveSeqRef.current) {
        setToastMessage(getErrorMessage(err, '模型切换失败'))
      }
    } finally {
      if (modelSaveSeq === reviewModelSaveSeqRef.current) {
        setPendingReviewModelIndex(null)
      }
    }
  }

  const handleTriggerAnalysis = async (sessionId: number) => {
    if (triggeringIdsRef.current.has(sessionId)) return
    triggeringIdsRef.current.add(sessionId)
    setTriggeringIds(prev => new Set(prev).add(sessionId))
    try {
      const result = await api.reviewTriggerAnalysis(sessionId)
      if (result.status === 'started' || result.status === 'pending') {
        setData(prev => {
          if (!prev) return prev
          return {
            ...prev,
            items: prev.items.map(s =>
              s.id === sessionId ? { ...s, status: 'analyzing' as const } : s
            ),
          }
        })
        setToastMessage('已加入复盘生成队列')
      } else if (result.status === 'done') {
        setToastMessage('复盘已完成')
        void loadSessions(page, { silent: true })
      }
    } catch (err) {
      setToastMessage(getErrorMessage(err, '触发分析失败'))
    } finally {
      triggeringIdsRef.current.delete(sessionId)
      setTriggeringIds(prev => {
        const next = new Set(prev)
        next.delete(sessionId)
        return next
      })
    }
  }

  const handleOpenApplication = useCallback((session: ReviewSession) => {
    if (!session.application?.id) return
    setJobTrackerDeepLink({
      applicationId: session.application.id,
      openReviews: true,
      highlightReviewId: session.id,
    })
    setAppMode('job-tracker')
  }, [setAppMode, setJobTrackerDeepLink])

  // Stable reference so the memos below only recompute when the data changes.
  const sessions = useMemo(() => data?.items ?? [], [data])
  const hasAnalyzingSession = sessions.some((session) => session.status === 'analyzing')
  const total = data?.total ?? 0
  const groups = useMemo(() => buildSessionGroups(sessions, sessionHasGeneratedAnalysis), [sessions])
  const hasSessions = total > 0
  const linkedReviewCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const session of sessions) {
      const applicationId = session.application?.id
      if (applicationId == null) continue
      counts.set(applicationId, (counts.get(applicationId) ?? 0) + 1)
    }
    return counts
  }, [sessions])
  const linkedTimelineLabels = useMemo(() => {
    const grouped = new Map<number, ReviewSession[]>()
    for (const session of sessions) {
      const applicationId = session.application?.id
      if (applicationId == null) continue
      const current = grouped.get(applicationId) ?? []
      current.push(session)
      grouped.set(applicationId, current)
    }
    const labels = new Map<number, string>()
    for (const appSessions of grouped.values()) {
      appSessions.forEach((session, index) => {
        labels.set(session.id, describeTimelinePosition(index, appSessions.length))
      })
    }
    return labels
  }, [sessions])
  const focusOptions = [
    { key: 'all' as ReviewListFocus, label: '全部', count: sessions.length },
    {
      key: 'attention' as ReviewListFocus,
      label: '先处理',
      count: groups.find((group) => group.key === 'attention')?.items.length ?? 0,
    },
    {
      key: 'active' as ReviewListFocus,
      label: '进行中',
      count: groups.find((group) => group.key === 'active')?.items.length ?? 0,
    },
    {
      key: 'done' as ReviewListFocus,
      label: '已完成',
      count: groups.find((group) => group.key === 'done')?.items.length ?? 0,
    },
  ].filter((item) => item.key === 'all' || item.count > 0 || item.key === focusFilter)
  const currentFocusOption = focusOptions.find((item) => item.key === focusFilter) ?? focusOptions[0]
  const configPanels = (showManualImport || showSettings) ? (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
      {showManualImport && (
        <ManualImportPanel
          onCreated={(sessionId) => {
            setShowManualImport(false)
            void loadSessions(1)
            setPage(1)
            onViewDetail(sessionId)
          }}
          onToast={setToastMessage}
        />
      )}
      {showSettings && (
        <ReviewSettingsPanel
          reviewEnabled={displayedReviewEnabled}
          reviewModelIndex={displayedReviewModelIndex}
          reviewToggleSaving={pendingReviewEnabled != null}
          models={models}
          onToggle={handleToggleReview}
          onChangeModel={handleChangeModel}
        />
      )}
    </section>
  ) : null
  const reviewWorkspaceShellClass = isLight
    ? 'border-bg-hover bg-white'
    : 'border-white/[0.08] bg-bg-secondary/42'

  useEffect(() => {
    if (!hasAnalyzingSession) return undefined

    const timer = window.setInterval(() => {
      void loadSessions(page, { silent: true })
    }, REVIEW_LIST_POLL_MS)
    return () => window.clearInterval(timer)
  }, [hasAnalyzingSession, loadSessions, page])

  if (loading && !data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-text-muted text-sm">加载中...</div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 p-5 lg:p-6">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-xl font-semibold text-text-primary">面试复盘</h2>
              {!reviewEnabled ? (
                <span className="text-xs text-text-muted">自动生成未启用</span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadSessions(page)}
              aria-label="刷新复盘列表"
              title="刷新"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-bg-hover bg-bg-secondary text-text-secondary hover:bg-bg-hover"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={toggleManualImport}
              aria-expanded={showManualImport}
              className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors ${
                showManualImport
                  ? 'border-bg-hover bg-transparent text-accent-blue hover:bg-bg-hover'
                  : 'border-bg-hover bg-bg-secondary text-text-secondary hover:bg-bg-hover'
              }`}
            >
              <Upload className="h-3.5 w-3.5" />
              {showManualImport ? '收起导入' : '手动复盘'}
            </button>
            <button
              type="button"
              onClick={toggleSettings}
              aria-expanded={showSettings}
              className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors ${
                showSettings
                  ? 'border-bg-hover bg-transparent text-accent-blue hover:bg-bg-hover'
                  : 'border-bg-hover bg-bg-secondary text-text-primary hover:bg-bg-hover'
              }`}
            >
              <Settings className="h-3.5 w-3.5" />
              {showSettings ? '收起配置' : '配置'}
            </button>
          </div>
        </header>

        {hasSessions ? (
          <div className={`rounded-lg border ${reviewWorkspaceShellClass}`}>
            <div className="min-w-0 space-y-3 p-3 lg:p-4">
              <section className="border-b border-bg-hover/80 px-1 pb-3">
                <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <h3 className="text-sm font-semibold text-text-primary">复盘队列</h3>
                      <span className="text-[11px] text-text-muted">
                        {currentFocusOption.label} · {total} 场
                      </span>
                    </div>
                  </div>
                  <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:max-w-[420px] lg:justify-end lg:overflow-visible lg:px-0 lg:pb-0">
                    {focusOptions.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setFocusFilter(item.key)}
                        className={`inline-flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          focusFilter === item.key
                            ? 'border-bg-hover bg-transparent text-accent-blue'
                            : 'border-bg-hover bg-bg-secondary/50 text-text-secondary hover:bg-bg-hover'
                        }`}
                      >
                        <span>{item.label}</span>
                        <span className={`text-[10px] ${focusFilter === item.key ? 'text-accent-blue' : 'text-text-muted'}`}>
                          {item.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              {configPanels}

              <SessionTable
                sessions={sessions}
                focusFilter={focusFilter}
                linkedReviewCounts={linkedReviewCounts}
                linkedTimelineLabels={linkedTimelineLabels}
                triggeringIds={triggeringIds}
                onViewDetail={onViewDetail}
                onOpenApplication={handleOpenApplication}
                onTriggerAnalysis={handleTriggerAnalysis}
                hasGeneratedAnalysis={sessionHasGeneratedAnalysis}
              />

              {total > pageSize && (
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                    className="h-9 rounded-lg border border-bg-hover bg-bg-secondary px-4 text-sm text-text-primary disabled:cursor-not-allowed disabled:opacity-50 hover:bg-bg-hover"
                  >
                    上一页
                  </button>
                  <span className="text-sm text-text-muted">
                    {page} / {Math.ceil(total / pageSize)}
                  </span>
                  <button
                    type="button"
                    disabled={page >= Math.ceil(total / pageSize)}
                    onClick={() => setPage(page + 1)}
                    className="h-9 rounded-lg border border-bg-hover bg-bg-secondary px-4 text-sm text-text-primary disabled:cursor-not-allowed disabled:opacity-50 hover:bg-bg-hover"
                  >
                    下一页
                  </button>
                </div>
                )}
            </div>
          </div>
        ) : (
          <ReviewZeroState
            reviewEnabled={reviewEnabled}
            showManualImport={showManualImport}
            showSettings={showSettings}
            onManual={toggleManualImport}
            onSettings={toggleSettings}
          />
        )}
        {!hasSessions ? configPanels : null}

      </div>
    </div>
  )
}
