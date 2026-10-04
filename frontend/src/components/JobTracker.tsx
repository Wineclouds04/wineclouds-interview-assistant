import { lazy, Suspense, startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { Briefcase, ChevronDown, Plus, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react'
import { api } from '@/lib/api'
import { useInterviewStore } from '@/stores/configStore'
import { useUiPrefsStore } from '@/stores/uiPrefsStore'
import ApplicationsTable from './job-tracker/ApplicationsTable'
import type { Application, Offer } from './job-tracker/types'
import { parseApplication, parseOffer } from './job-tracker/types'
import { isLightColorScheme } from '@/lib/colorScheme'
import { STAGE_LABELS, isRejectedStage, isTerminalStage } from './job-tracker/stageConfig'
import { ApplicationReviewItem, CreateApplicationDraft, CreateNotice, DetailIntent, FocusFilter, createInitialDraft, describeCreateContinueAction, fromDateInput, getFocusFilterForStage, matchesFocusFilter, parseApplicationResponse, parseApplicationReviewItem, sortApplicationReviewItems } from './job-tracker/jobTrackerModel'
import { ApplicationReviewsModal, CreateSuccessBanner, DesktopOverviewSummary, FocusArrivalBanner, FocusNotice, HeaderSnapshotPill, HeaderSnapshotTone, JobTrackerZeroState, QuickCreatePanel, useCompactLayout } from './job-tracker/JobTrackerPanels'

const KanbanBoard = lazy(() => import('./job-tracker/KanbanBoard'))
const OfferEditModal = lazy(() => import('./job-tracker/OfferEditModal'))

const SHOW_TERMINAL_STORAGE_KEY = 'ia-jobtracker-show-terminal'

const PRIMARY_FOCUS_FILTERS: FocusFilter[] = ['active', 'due', 'interview', 'all']
const COMPACT_PRIMARY_FILTERS_WITH_REJECTED: FocusFilter[] = ['active', 'due', 'rejected', 'all']

export default function JobTracker() {
  const setToastMessage = useInterviewStore((s) => s.setToastMessage)
  const colorScheme = useUiPrefsStore((s) => s.colorScheme)
  const appMode = useUiPrefsStore((s) => s.appMode)
  const setAppMode = useUiPrefsStore((s) => s.setAppMode)
  const jobTrackerDeepLink = useUiPrefsStore((s) => s.jobTrackerDeepLink)
  const clearJobTrackerDeepLink = useUiPrefsStore((s) => s.clearJobTrackerDeepLink)
  const setReviewDeepLinkSessionId = useUiPrefsStore((s) => s.setReviewDeepLinkSessionId)
  const isLight = isLightColorScheme(colorScheme)
  const [applications, setApplications] = useState<Application[]>([])
  const [offers, setOffers] = useState<Offer[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'table' | 'kanban'>('table')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [focusFilter, setFocusFilter] = useState<FocusFilter>('active')
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null)
  const [highlightedAppId, setHighlightedAppId] = useState<number | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createDraft, setCreateDraft] = useState<CreateApplicationDraft>(createInitialDraft)
  const [createNotice, setCreateNotice] = useState<CreateNotice | null>(null)
  const [focusNotice, setFocusNotice] = useState<FocusNotice | null>(null)
  const [detailIntent, setDetailIntent] = useState<DetailIntent | null>(null)
  const [offerModalApp, setOfferModalApp] = useState<Application | null>(null)
  const [reviewModalApp, setReviewModalApp] = useState<Application | null>(null)
  const [reviewItems, setReviewItems] = useState<ApplicationReviewItem[]>([])
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewModalHighlightId, setReviewModalHighlightId] = useState<number | null>(null)
  const listLoadSeqRef = useRef(0)
  const listMutationSeqRef = useRef(0)
  const applicationPatchSeqRef = useRef<Map<number, number>>(new Map())
  const reviewRequestSeqRef = useRef(0)
  const createApplicationRef = useRef(false)
  const [showSecondaryFilters, setShowSecondaryFilters] = useState(false)
  const isCompactLayout = useCompactLayout()
  const isNarrowDetailLayout = useCompactLayout(1024)
  const [showTerminalStages, setShowTerminalStages] = useState(() => {
    try {
      const v = localStorage.getItem(SHOW_TERMINAL_STORAGE_KEY)
      if (v === null) return false
      return v === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_TERMINAL_STORAGE_KEY, showTerminalStages ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [showTerminalStages])

  useEffect(() => {
    if (highlightedAppId == null) return undefined
    const timer = window.setTimeout(() => setHighlightedAppId(null), 2400)
    return () => window.clearTimeout(timer)
  }, [highlightedAppId])

  useEffect(() => {
    if (focusNotice == null) return undefined
    const timer = window.setTimeout(() => setFocusNotice(null), 3600)
    return () => window.clearTimeout(timer)
  }, [focusNotice])

  useEffect(() => {
    if (!isCompactLayout) return
    if (view !== 'table') setView('table')
  }, [isCompactLayout, view])

  const markListMutated = useCallback(() => {
    listMutationSeqRef.current += 1
  }, [])

  const load = useCallback(async () => {
    const requestSeq = listLoadSeqRef.current + 1
    listLoadSeqRef.current = requestSeq
    const mutationSeq = listMutationSeqRef.current
    const isCurrentLoad = () =>
      listLoadSeqRef.current === requestSeq &&
      listMutationSeqRef.current === mutationSeq

    setLoading(true)
    try {
      const [aRes, oRes] = await Promise.all([
        api.jobTrackerApplications(),
        api.jobTrackerListOffers(),
      ])
      if (!isCurrentLoad()) return
      const nextApplications = (aRes.items as Record<string, unknown>[]).map(parseApplication)
      const nextOffers = (oRes.items as Record<string, unknown>[]).map(parseOffer)
      startTransition(() => {
        if (!isCurrentLoad()) return
        setApplications(nextApplications)
        setOffers(nextOffers)
      })
    } catch (e) {
      if (isCurrentLoad()) {
        setToastMessage(e instanceof Error ? e.message : '加载失败')
      }
    } finally {
      if (listLoadSeqRef.current === requestSeq) {
        setLoading(false)
      }
    }
  }, [setToastMessage])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (applications.length === 0) {
      setSelectedAppId(null)
      return
    }
    if (selectedAppId == null || !applications.some((app) => app.id === selectedAppId)) {
      setSelectedAppId(applications[0].id)
    }
  }, [applications, selectedAppId])

  const offerByAppId = useMemo(() => {
    const m = new Map<number, Offer>()
    for (const offer of offers) m.set(offer.application_id, offer)
    return m
  }, [offers])

  const onPatch = useCallback(
    async (id: number, patch: Partial<Application>) => {
      const patchSeq = (applicationPatchSeqRef.current.get(id) ?? 0) + 1
      applicationPatchSeqRef.current.set(id, patchSeq)
      const isCurrentPatch = () => applicationPatchSeqRef.current.get(id) === patchSeq
      try {
        const raw = await api.jobTrackerPatchApplication(id, patch as Record<string, unknown>)
        if (!isCurrentPatch()) return false
        const rawRecord = raw as Record<string, unknown>
        markListMutated()
        startTransition(() => {
          if (!isCurrentPatch()) return
          setApplications((prev) => prev.map((item) => (
            item.id === id ? parseApplicationResponse(rawRecord, item.review_summary) : item
          )))
        })
        return true
      } catch (e) {
        if (isCurrentPatch()) {
          setToastMessage(e instanceof Error ? e.message : '保存失败')
          load()
        }
        return false
      }
    },
    [load, markListMutated, setToastMessage],
  )

  const onDelete = useCallback(
    async (id: number) => {
      try {
        await api.jobTrackerDeleteApplication(id)
        applicationPatchSeqRef.current.delete(id)
        markListMutated()
        startTransition(() => {
          setApplications((prev) => prev.filter((item) => item.id !== id))
          setOffers((prev) => prev.filter((offer) => offer.application_id !== id))
        })
      } catch (e) {
        setToastMessage(e instanceof Error ? e.message : '删除失败')
      }
    },
    [markListMutated, setToastMessage],
  )

  const onStageChange = useCallback(
    async (appId: number, stage: string) => {
      const ok = await onPatch(appId, { stage })
      if (ok) {
        setToastMessage(`已移至 ${STAGE_LABELS[stage] ?? stage}`)
      }
    },
    [onPatch, setToastMessage],
  )

  const onReorderInStage = useCallback(
    async (stage: string, orderedIds: number[]) => {
      markListMutated()
      setApplications((prev) =>
        prev.map((app) => {
          const index = orderedIds.indexOf(app.id)
          if (index < 0 || app.stage !== stage) return app
          return { ...app, sort_order: index }
        }),
      )
      try {
        await api.jobTrackerReorderStage(stage, orderedIds)
      } catch (e) {
        setToastMessage(e instanceof Error ? e.message : '排序失败')
        load()
      }
    },
    [load, markListMutated, setToastMessage],
  )

  const terminalApplicationsCount = useMemo(() => applications.filter((app) => isTerminalStage(app.stage)).length, [applications])
  const rejectedCount = useMemo(() => applications.filter((app) => isRejectedStage(app.stage)).length, [applications])
  const withdrawnCount = useMemo(() => applications.filter((app) => app.stage === 'withdrawn').length, [applications])
  const dueSoonCutoff = useMemo(() => dayjs().add(3, 'day').endOf('day').unix(), [])
  const offerCount = useMemo(
    () => applications.filter((app) => app.stage === 'offer' || offerByAppId.has(app.id)).length,
    [applications, offerByAppId],
  )
  const ongoingApplicationsCount = useMemo(
    () => applications.filter((app) => !isTerminalStage(app.stage) && app.stage !== 'offer' && !offerByAppId.has(app.id)).length,
    [applications, offerByAppId],
  )
  const dueSoonCount = useMemo(
    () =>
      applications.filter(
        (app) =>
          !isTerminalStage(app.stage) &&
          app.stage !== 'offer' &&
          !offerByAppId.has(app.id) &&
          app.next_followup_at != null &&
          app.next_followup_at <= dueSoonCutoff,
      ).length,
    [applications, dueSoonCutoff, offerByAppId],
  )
  const interviewCount = useMemo(
    () => applications.filter((app) => ['written', 'interview1', 'interview2', 'interview3', 'hr'].includes(app.stage)).length,
    [applications],
  )
  const filteredApplications = useMemo(
    () => applications.filter((app) => matchesFocusFilter(app, focusFilter, offerByAppId, dueSoonCutoff)),
    [applications, dueSoonCutoff, focusFilter, offerByAppId],
  )

  const createApplication = useCallback(async () => {
    const company = createDraft.company.trim()
    if (!company) {
      setToastMessage('先填公司名，再创建记录')
      return
    }
    if (createApplicationRef.current) return
    createApplicationRef.current = true
    setCreating(true)
    try {
      const raw = await api.jobTrackerCreateApplication({
        company,
        city: createDraft.city.trim(),
        position: createDraft.position.trim() || '岗位',
        stage: createDraft.stage,
        applied_at: fromDateInput(createDraft.appliedAtInput),
      })
      const row = parseApplicationResponse(raw as Record<string, unknown>)
      markListMutated()
      setApplications((prev) => [row, ...prev])
      setSearch('')
      setSelectedAppId(row.id)
      setHighlightedAppId(row.id)
      setFocusFilter(getFocusFilterForStage(row.stage))
      setShowSecondaryFilters(false)
      setView('table')
      setComposerOpen(false)
      setCreateDraft(createInitialDraft())
      setCreateNotice({
        id: row.id,
        company: row.company,
        position: row.position,
        city: row.city,
        appliedAt: row.applied_at,
        stage: row.stage,
      })
      setToastMessage(`已新建 ${row.company}`)
    } catch (e) {
      setToastMessage(e instanceof Error ? e.message : '新增失败')
    } finally {
      createApplicationRef.current = false
      setCreating(false)
    }
  }, [createDraft, markListMutated, setToastMessage])

  const openOfferModal = useCallback((app: Application) => {
    setOfferModalApp(app)
  }, [])

  const openReviewsModal = useCallback(
    async (app: Application, highlightedReviewId: number | null = null) => {
      const requestSeq = reviewRequestSeqRef.current + 1
      reviewRequestSeqRef.current = requestSeq
      setReviewModalApp(app)
      setReviewModalHighlightId(highlightedReviewId)
      setReviewItems([])
      setReviewLoading(true)
      try {
        const res = await api.jobTrackerApplicationReviews(app.id)
        if (reviewRequestSeqRef.current !== requestSeq) return
        const items = (res.items as Record<string, unknown>[])
          .map(parseApplicationReviewItem)
          .filter((item): item is ApplicationReviewItem => item !== null)
        setReviewItems(sortApplicationReviewItems(items))
      } catch (e) {
        if (reviewRequestSeqRef.current !== requestSeq) return
        setToastMessage(e instanceof Error ? e.message : '加载关联复盘失败')
      } finally {
        if (reviewRequestSeqRef.current === requestSeq) {
          setReviewLoading(false)
        }
      }
    },
    [setToastMessage],
  )

  const openReviewDetail = useCallback((sessionId: number) => {
    setReviewDeepLinkSessionId(sessionId)
    if (reviewModalApp) {
      setToastMessage(`已打开 ${reviewModalApp.company}${reviewModalApp.position ? ` · ${reviewModalApp.position}` : ''} 的复盘详情`)
    } else {
      setToastMessage('已打开复盘详情')
    }
    setAppMode('review')
  }, [reviewModalApp, setAppMode, setReviewDeepLinkSessionId, setToastMessage])

  useEffect(() => {
    if (appMode !== 'job-tracker' || !jobTrackerDeepLink || applications.length === 0) return
    const targetApp = applications.find((app) => app.id === jobTrackerDeepLink.applicationId)
    if (!targetApp) return
    setSelectedAppId(targetApp.id)
    setHighlightedAppId(targetApp.id)
    setFocusFilter(getFocusFilterForStage(targetApp.stage))
    setShowSecondaryFilters(false)
    setView('table')
    setFocusNotice({
      applicationId: targetApp.id,
      company: targetApp.company,
      position: targetApp.position,
      openReviews: Boolean(jobTrackerDeepLink.openReviews),
    })
    clearJobTrackerDeepLink()
    if (jobTrackerDeepLink.openReviews) {
      void openReviewsModal(targetApp, jobTrackerDeepLink.highlightReviewId ?? null)
    }
  }, [appMode, applications, clearJobTrackerDeepLink, jobTrackerDeepLink, openReviewsModal])

  const saveOffer = useCallback(
    async (payload: Record<string, unknown>) => {
      const raw = await api.jobTrackerUpsertOffer(payload)
      const offer = parseOffer(raw as Record<string, unknown>)
      markListMutated()
      startTransition(() => {
        setOffers((prev) => {
          const index = prev.findIndex((item) => item.application_id === offer.application_id)
          if (index < 0) return [...prev, offer]
          const next = [...prev]
          next[index] = offer
          return next
        })
      })
      setToastMessage('Offer 已保存')
    },
    [markListMutated, setToastMessage],
  )

  const offerForModal = offerModalApp ? offerByAppId.get(offerModalApp.id) ?? null : null
  const visibleCount = filteredApplications.length
  const focusFilterOptions: { key: FocusFilter; label: string; count: number }[] = [
    { key: 'active', label: '进行中', count: ongoingApplicationsCount },
    { key: 'due', label: '待跟进', count: dueSoonCount },
    { key: 'interview', label: '面试中', count: interviewCount },
    { key: 'offer', label: 'Offer', count: offerCount },
    { key: 'rejected', label: '挂了', count: rejectedCount },
    ...(withdrawnCount > 0
      ? [{ key: 'withdrawn' as FocusFilter, label: '已放弃', count: withdrawnCount }]
      : []),
    { key: 'all', label: '全部', count: applications.length },
  ]
  const primaryFocusFilterKeys = isCompactLayout && rejectedCount > 0
    ? COMPACT_PRIMARY_FILTERS_WITH_REJECTED
    : PRIMARY_FOCUS_FILTERS
  const primaryFocusFilterOptions = focusFilterOptions.filter((item) => primaryFocusFilterKeys.includes(item.key))
  const secondaryFocusFilterOptions = focusFilterOptions.filter((item) => !primaryFocusFilterKeys.includes(item.key))
  const visibleSecondaryFocusFilterOptions = secondaryFocusFilterOptions.filter((item) => item.count > 0 || item.key === focusFilter)
  const selectedSecondaryFilter = secondaryFocusFilterOptions.find((item) => item.key === focusFilter) ?? null
  const currentFocusOption = focusFilterOptions.find((item) => item.key === focusFilter) ?? focusFilterOptions[focusFilterOptions.length - 1]
  const snapshotItems = applications.length === 0
    ? []
    : [
        {
          label: focusFilter === 'all' ? '当前' : currentFocusOption.label,
          value: `${visibleCount} 条`,
          tone: focusFilter === 'all' ? 'blue' : 'green',
        },
        {
          label: '待跟进',
          value: dueSoonCount > 0 ? `${dueSoonCount} 条` : '已清空',
          tone: dueSoonCount > 0 ? 'amber' : 'neutral',
        },
        terminalApplicationsCount > 0
          ? {
              label: '已结束',
              value: `${terminalApplicationsCount} 条`,
              tone: rejectedCount > 0 ? 'red' : 'neutral',
            }
          : {
              label: 'Offer',
              value: offerCount > 0 ? `${offerCount} 条` : '暂无',
              tone: offerCount > 0 ? 'green' : 'neutral',
            },
      ] satisfies Array<{ label: string; value: string; tone: HeaderSnapshotTone }>

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-bg-primary">
      <div
        className={`flex-shrink-0 border-b px-3 py-2.5 md:px-4 ${
          isLight ? 'border-bg-hover bg-white/95' : 'border-white/[0.06] bg-bg-secondary/20'
        }`}
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-bg-hover bg-bg-secondary text-accent-blue">
                <Briefcase className="h-4.5 w-4.5" strokeWidth={2} />
              </div>
              <div className="space-y-0.5">
                <h2 className="text-base font-bold tracking-tight text-text-primary">求职进度</h2>
              </div>
            </div>

            <div className="flex w-full flex-col gap-2 lg:max-w-3xl">
              <div className="relative w-full lg:ml-auto lg:max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                <input
                  type="search"
                  placeholder="搜索公司 / 岗位 / 城市 / 待办"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && search) {
                      e.preventDefault()
                      setSearch('')
                    }
                  }}
                  className={`w-full rounded-lg border py-2 pl-9 ${search ? 'pr-9' : 'pr-3'} text-sm text-text-primary placeholder:text-text-muted/70 focus:border-accent-blue/40 focus:outline-none focus:ring-2 focus:ring-accent-blue/15 ${
                    isLight ? 'border-bg-hover bg-white' : 'border-white/[0.08] bg-black/15'
                  }`}
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-1/2 rounded-md p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
                    aria-label="清空搜索"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>

              {isCompactLayout ? (
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={load}
                    disabled={loading}
                    className={`rounded-lg border p-2 text-text-muted transition-colors hover:border-accent-blue/25 hover:text-accent-blue disabled:opacity-50 ${
                      isLight ? 'border-bg-hover bg-white' : 'border-white/[0.08] bg-black/15'
                    }`}
                    title="刷新"
                  >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  </button>

                  <button
                    type="button"
                    onClick={() => setComposerOpen((prev) => !prev)}
                    className="flex items-center gap-1.5 rounded-lg bg-accent-blue px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110"
                  >
                    <Plus className="h-4 w-4" strokeWidth={2.2} />
                    {composerOpen ? '收起新增' : '新增记录'}
                  </button>
                </div>
              ) : (
                <div className="flex w-full flex-wrap items-center gap-2 lg:justify-end">
                  <button
                    type="button"
                    onClick={load}
                    disabled={loading}
                    className={`rounded-lg border p-2 text-text-muted transition-colors hover:border-accent-blue/25 hover:text-accent-blue disabled:opacity-50 ${
                      isLight ? 'border-bg-hover bg-white' : 'border-white/[0.08] bg-black/15'
                    }`}
                    title="刷新"
                  >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  </button>

                  <button
                    type="button"
                    onClick={() => setComposerOpen((prev) => !prev)}
                    className="flex items-center gap-1.5 rounded-lg bg-accent-blue px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110"
                  >
                    <Plus className="h-4 w-4" strokeWidth={2.2} />
                    {composerOpen ? '收起新增' : '新增记录'}
                  </button>
                  {applications.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setView((prev) => prev === 'table' ? 'kanban' : 'table')}
                      className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                        isLight
                          ? 'border-bg-hover bg-white text-text-secondary hover:text-text-primary'
                          : 'border-white/[0.08] bg-black/10 text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {view === 'table' ? '整理模式' : '返回表格'}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          {applications.length > 0 ? (
            <div className="text-[11px] leading-relaxed text-text-muted">
              {isCompactLayout ? (
                <div className="flex flex-wrap gap-2">
                  {snapshotItems.map((item) => (
                    <HeaderSnapshotPill
                      key={item.label}
                      label={item.label}
                      value={item.value}
                      tone={item.tone}
                      isLight={isLight}
                    />
                  ))}
                </div>
              ) : (
                <DesktopOverviewSummary
                  items={snapshotItems}
                  isLight={isLight}
                />
              )}
            </div>
          ) : null}

          {applications.length > 0 ? (
            isCompactLayout ? (
              <div className="space-y-2">
                <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
                  {primaryFocusFilterOptions.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setFocusFilter(item.key)
                        setShowSecondaryFilters(false)
                      }}
                      className={`shrink-0 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        focusFilter === item.key
                          ? 'border-bg-hover bg-transparent text-accent-blue'
                          : isLight
                            ? 'border-bg-hover bg-white text-text-secondary hover:text-text-primary'
                            : 'border-white/[0.08] bg-black/10 text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {item.label} · {item.count}
                    </button>
                  ))}
                  {visibleSecondaryFocusFilterOptions.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowSecondaryFilters((prev) => !prev)}
                      className={`shrink-0 inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        selectedSecondaryFilter
                          ? 'border-bg-hover bg-transparent text-accent-blue'
                          : isLight
                            ? 'border-bg-hover bg-white text-text-secondary hover:text-text-primary'
                            : 'border-white/[0.08] bg-black/10 text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      {selectedSecondaryFilter ? `${selectedSecondaryFilter.label} · ${selectedSecondaryFilter.count}` : '更多状态'}
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showSecondaryFilters ? 'rotate-180' : ''}`} />
                    </button>
                  ) : null}
                </div>

                {showSecondaryFilters ? (
                  <div className={`grid gap-2 rounded-lg border p-2 ${
                    isLight ? 'border-bg-hover bg-white/90' : 'border-white/[0.08] bg-black/12'
                  }`}>
                    {visibleSecondaryFocusFilterOptions.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setFocusFilter(item.key)
                          setShowSecondaryFilters(false)
                        }}
                        className={`rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors ${
                          focusFilter === item.key
                            ? 'border-bg-hover bg-transparent text-accent-blue'
                            : isLight
                              ? 'border-bg-hover bg-bg-secondary text-text-secondary hover:text-text-primary'
                              : 'border-white/[0.08] bg-black/10 text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        {item.label} · {item.count}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap">
                  {primaryFocusFilterOptions.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setFocusFilter(item.key)
                        setShowSecondaryFilters(false)
                      }}
                      className={`shrink-0 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        focusFilter === item.key
                          ? 'border-bg-hover bg-transparent text-accent-blue'
                          : isLight
                            ? 'border-bg-hover bg-white text-text-secondary hover:text-text-primary'
                            : 'border-white/[0.08] bg-black/10 text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {item.label} · {item.count}
                    </button>
                  ))}
                  {visibleSecondaryFocusFilterOptions.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowSecondaryFilters((prev) => !prev)}
                      className={`shrink-0 inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                        selectedSecondaryFilter
                          ? 'border-bg-hover bg-transparent text-accent-blue'
                          : isLight
                            ? 'border-bg-hover bg-white text-text-secondary hover:text-text-primary'
                            : 'border-white/[0.08] bg-black/10 text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      {selectedSecondaryFilter ? `${selectedSecondaryFilter.label} · ${selectedSecondaryFilter.count}` : '更多状态'}
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showSecondaryFilters ? 'rotate-180' : ''}`} />
                    </button>
                  ) : null}
                </div>

                {showSecondaryFilters && visibleSecondaryFocusFilterOptions.length > 0 ? (
                  <div className={`flex flex-wrap gap-2 rounded-lg border p-2 ${
                    isLight ? 'border-bg-hover bg-white/90' : 'border-white/[0.08] bg-black/12'
                  }`}>
                    {visibleSecondaryFocusFilterOptions.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setFocusFilter(item.key)
                          setShowSecondaryFilters(false)
                        }}
                        className={`rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors ${
                          focusFilter === item.key
                            ? 'border-bg-hover bg-transparent text-accent-blue'
                            : isLight
                              ? 'border-bg-hover bg-bg-secondary text-text-secondary hover:text-text-primary'
                              : 'border-white/[0.08] bg-black/10 text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        {item.label} · {item.count}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          ) : null}

          {composerOpen && (
            <QuickCreatePanel
              draft={createDraft}
              creating={creating}
              isLight={isLight}
              onChange={setCreateDraft}
              onCancel={() => {
                setComposerOpen(false)
                setCreateDraft(createInitialDraft())
              }}
              onSubmit={createApplication}
            />
          )}

          {createNotice != null && (
            <CreateSuccessBanner
              notice={createNotice}
              continueLabel={describeCreateContinueAction(createNotice).label}
              isLight={isLight}
              onDismiss={() => setCreateNotice(null)}
              onContinue={() => {
                const continueAction = describeCreateContinueAction(createNotice)
                setView('table')
                setSelectedAppId(createNotice.id)
                setHighlightedAppId(createNotice.id)
                setFocusFilter(getFocusFilterForStage(createNotice.stage))
                setShowSecondaryFilters(false)
                setDetailIntent({ applicationId: createNotice.id, mode: continueAction.mode })
                setCreateNotice(null)
              }}
              onUndo={async () => {
                await onDelete(createNotice.id)
                if (selectedAppId === createNotice.id) {
                  setSelectedAppId(null)
                }
                setCreateNotice(null)
                setToastMessage(`已撤销 ${createNotice.company}`)
              }}
            />
          )}

          {focusNotice != null && (
            <FocusArrivalBanner
              notice={focusNotice}
              isLight={isLight}
              onDismiss={() => setFocusNotice(null)}
            />
          )}
        </div>
      </div>

      <div
        className={`p-3 md:p-4 ${
          view === 'kanban'
            ? isLight
              ? 'bg-bg-secondary'
              : 'bg-bg-primary'
            : ''
        }`}
      >
        {loading && applications.length === 0 ? (
          <div className="space-y-2 px-1 py-2" aria-busy="true" aria-live="polite">
            <span className="sr-only">正在加载求职数据…</span>
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-12 animate-pulse rounded-xl bg-bg-tertiary/50"
                style={{ animationDelay: `${index * 70}ms`, opacity: 1 - index * 0.08 }}
              />
            ))}
          </div>
        ) : view === 'table' && applications.length === 0 ? (
          <JobTrackerZeroState
            onCreate={() => setComposerOpen(true)}
          />
        ) : view === 'table' ? (
          <ApplicationsTable
            applications={filteredApplications}
            offerByAppId={offerByAppId}
            onPatch={onPatch}
            onDelete={onDelete}
            onOpenOffer={openOfferModal}
            onOpenReviews={openReviewsModal}
            search={deferredSearch}
            selectedId={selectedAppId}
            onSelect={setSelectedAppId}
            highlightedId={highlightedAppId}
            compactDetailLayout={isNarrowDetailLayout}
            detailIntent={detailIntent}
            onConsumeDetailIntent={() => setDetailIntent(null)}
            hiddenApplicationsCount={Math.max(0, applications.length - filteredApplications.length)}
            hiddenApplicationsPreview={applications.filter((app) => !matchesFocusFilter(app, focusFilter, offerByAppId, dueSoonCutoff)).slice(0, 3)}
            onShowAll={() => setFocusFilter('all')}
          />
        ) : (
          <div>
            <Suspense fallback={<div className="flex h-48 items-center justify-center text-sm text-text-muted">加载看板中…</div>}>
              <KanbanBoard
                applications={filteredApplications}
                onStageChange={onStageChange}
                onReorderInStage={onReorderInStage}
                search={deferredSearch}
                showTerminalStages={showTerminalStages}
                onShowTerminalStagesChange={setShowTerminalStages}
                terminalApplicationsCount={terminalApplicationsCount}
              />
            </Suspense>
          </div>
        )}
      </div>

      {offerModalApp != null && (
        <Suspense fallback={null}>
          <OfferEditModal
            open={offerModalApp != null}
            application={offerModalApp}
            offer={offerForModal}
            onClose={() => setOfferModalApp(null)}
            onSave={saveOffer}
          />
        </Suspense>
      )}

      {reviewModalApp != null && (
        <ApplicationReviewsModal
          app={reviewModalApp}
          items={reviewItems}
          loading={reviewLoading}
          highlightedReviewId={reviewModalHighlightId}
          onClose={() => {
            reviewRequestSeqRef.current += 1
            setReviewModalApp(null)
            setReviewModalHighlightId(null)
            setReviewItems([])
            setReviewLoading(false)
          }}
          onViewDetail={openReviewDetail}
        />
      )}
    </div>
  )
}
