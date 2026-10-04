import type { ReviewSessionDetail, ReviewTurn } from './types'

export type TurnVisionVerify = {
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN'
  reason: string
}

export function scoreTextClass(score: number): string {
  if (score >= 8) return 'text-green-500'
  if (score >= 6) return 'text-blue-500'
  if (score >= 4) return 'text-yellow-500'
  return 'text-red-500'
}

export function normalizeCompareText(value: string | null | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export function getTurnVisionVerify(turn: ReviewTurn): TurnVisionVerify | null {
  const raw = turn.evidence?.vision_verify
  if (!raw || typeof raw !== 'object') return null
  const data = raw as { verdict?: unknown; reason?: unknown }
  const verdict = String(data.verdict || '').toUpperCase()
  if (verdict !== 'PASS' && verdict !== 'FAIL' && verdict !== 'UNKNOWN') return null
  return {
    verdict,
    reason: String(data.reason ?? '').trim(),
  }
}

export function getTurnAvgScore(turn: ReviewTurn): number | null {
  if (!turn.scorecard || Object.keys(turn.scorecard).length === 0) return null
  const values = Object.values(turn.scorecard)
    .map(parseScoreValue)
    .filter((score): score is number => score !== null)
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function buildScoreDimensions(detail: ReviewSessionDetail) {
  const byName = new Map<string, { total: number; count: number }>()
  for (const turn of detail.turns ?? []) {
    for (const [name, rawScore] of Object.entries(turn.scorecard ?? {})) {
      const score = parseScoreValue(rawScore)
      if (score === null) continue
      const current = byName.get(name) ?? { total: 0, count: 0 }
      current.total += score
      current.count += 1
      byName.set(name, current)
    }
  }
  return [...byName.entries()]
    .map(([name, value]) => ({ name, avg: value.total / value.count, count: value.count }))
    .sort((a, b) => a.avg - b.avg)
}

export function buildFollowUpDrills(detail: ReviewSessionDetail) {
  const drills: { seq: number; question: string; advice: string; tags: string[] }[] = []
  for (const turn of detail.turns ?? []) {
    const evidence = turn.evidence ?? {}
    const followUps = getStringList(evidence.follow_up_questions)
    const advice = getStringValue(evidence.improvement_advice)
    const tags = getStringList(evidence.tags).slice(0, 3)
    const avgScore = getTurnAvgScore(turn)
    const fallbackNeeded = avgScore !== null && avgScore < 6
    const questions = followUps.length > 0
      ? followUps
      : fallbackNeeded
        ? [`请重新回答第 ${turn.seq} 题，并补充一个可落地的项目例子。`]
        : []
    for (const question of questions) {
      if (drills.length >= 6) return drills
      drills.push({
        seq: turn.seq,
        question,
        advice,
        tags,
      })
    }
  }
  return drills
}

export function getStringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function getStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function parseScoreValue(value: unknown): number | null {
  let score: number | null = null
  if (typeof value === 'number' && Number.isFinite(value)) {
    score = value
  } else if (typeof value === 'string') {
    const match = value.trim().match(/-?\d+(?:\.\d+)?/)
    if (match) {
      const parsed = Number(match[0])
      if (Number.isFinite(parsed)) score = parsed
    }
  }
  if (score === null || score < 0 || score > 10) return null
  return score
}

export function dimensionTone(score: number) {
  if (score >= 8) return 'text-green-500'
  if (score >= 6) return 'text-blue-500'
  if (score >= 4) return 'text-yellow-500'
  return 'text-red-500'
}

export function dimensionBarTone(score: number) {
  if (score >= 8) return 'bg-green-500'
  if (score >= 6) return 'bg-blue-500'
  if (score >= 4) return 'bg-yellow-500'
  return 'bg-red-500'
}

export function buildNextActions(detail: ReviewSessionDetail): string[] {
  const actions: string[] = []
  for (const point of detail.weak_points ?? []) {
    if (actions.length >= 4) break
    actions.push(point)
  }
  const lowTurns = [...(detail.turns ?? [])]
    .map((turn) => ({ turn, avg: getTurnAvgScore(turn) }))
    .filter((item): item is { turn: ReviewTurn; avg: number } => item.avg !== null && item.avg < 6)
    .sort((a, b) => a.avg - b.avg)
  for (const item of lowTurns) {
    if (actions.length >= 4) break
    actions.push(`复练第 ${item.turn.seq} 题：${item.turn.question_text.slice(0, 42)}${item.turn.question_text.length > 42 ? '...' : ''}`)
  }
  return actions
}
