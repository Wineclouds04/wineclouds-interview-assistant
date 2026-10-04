import { type ModelFullInfo } from '@/stores/configStore'

export const EMPTY_MODEL: ModelFullInfo = {
  name: '',
  api_base_url: 'https://api.openai.com/v1',
  api_key: '',
  model: '',
  supports_think: false,
  supports_vision: false,
  enabled: true,
  think_enabled_params: {},
  think_disabled_params: {},
  has_key: false,
}

export interface ModelRow {
  id: string
  originalIndex: number
  model: ModelFullInfo
}

export type RemoteModelListState = {
  loading: boolean
  models: RemoteModel[]
  error: string | null
  loaded: boolean
  requestKey?: string
}

export type RemoteModel = {
  id: string
  owned_by?: string | null
}

export const EMPTY_REMOTE_MODEL_LIST: RemoteModelListState = {
  loading: false,
  models: [],
  error: null,
  loaded: false,
}

export const KEEP_EXISTING_API_KEY = '__IA_KEEP_EXISTING_API_KEY__'

export const DEFAULT_TEMPERATURE = 0.5

export const DEFAULT_MAX_TOKENS = 4096

export function normalizeApiBaseUrl(value: string): string {
  return value.trim().replace(/\/chat\/completions\/?$/i, '')
}

export function clampNumberInput(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

export function clampIntegerInput(value: unknown, min: number, max: number, fallback: number): number {
  return Math.floor(clampNumberInput(value, min, max, fallback))
}

export function toModelRow(model: ModelFullInfo, index: number): ModelRow {
  return {
    id: `${index}:${model.name}:${model.model}:${model.api_base_url}`,
    originalIndex: index,
    model,
  }
}

export function buildModelPayloadFromRows(rows: ModelRow[]) {
  return rows.map(({ model: m, originalIndex }) => ({
    name: m.name.trim(),
    api_base_url: normalizeApiBaseUrl(m.api_base_url) || 'https://api.openai.com/v1',
    api_key: m.api_key.trim() ? m.api_key : m.has_key ? KEEP_EXISTING_API_KEY : '',
    model_original_index: originalIndex,
    model: m.model.trim() || 'gpt-4o-mini',
    supports_think: m.supports_think,
    supports_vision: m.supports_vision,
    enabled: m.enabled,
    think_enabled_params: m.think_enabled_params ?? {},
    think_disabled_params: m.think_disabled_params ?? {},
  }))
}

export function resolveActiveIndexForRows(rows: ModelRow[], activeOriginalIndex = 0) {
  const nextActiveIndex = rows.findIndex((row) => row.originalIndex === activeOriginalIndex)
  return nextActiveIndex >= 0 ? nextActiveIndex : 0
}

export function buildQueueSnapshot(rows: ModelRow[], maxParallel: number, activeOriginalIndex = 0) {
  return {
    models: buildModelPayloadFromRows(rows),
    active_model: resolveActiveIndexForRows(rows, activeOriginalIndex),
    max_parallel_answers: maxParallel,
  }
}

export function groupRemoteModels(models: RemoteModel[]) {
  const groups = new Map<string, RemoteModel[]>()
  models.forEach((model) => {
    const owner = model.owned_by?.trim() || '其他'
    groups.set(owner, [...(groups.get(owner) ?? []), model])
  })
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
}

export function remoteModelRequestKey(model: ModelFullInfo) {
  return `${normalizeApiBaseUrl(model.api_base_url || '')}\n${model.api_key || ''}`
}

export function apiKeyPayloadValue(model: ModelFullInfo) {
  return model.api_key.trim() ? model.api_key : model.has_key ? KEEP_EXISTING_API_KEY : ''
}

export function apiKeyPlaceholder(model: ModelFullInfo) {
  if (model.has_key && !model.api_key.trim()) return '已保存，留空则保留现有 API Key'
  return '填入你的 API Key'
}

export function normalizeLlmForm(form: {
  temperature: unknown
  max_tokens: unknown
  think_mode: boolean
  think_effort: string
}) {
  return {
    temperature: clampNumberInput(form.temperature, 0, 2, DEFAULT_TEMPERATURE),
    max_tokens: clampIntegerInput(form.max_tokens, 256, 32768, DEFAULT_MAX_TOKENS),
    think_mode: form.think_mode,
    think_effort: form.think_effort,
  }
}

export function formatRemoteModelError(error: unknown): string {
  const raw = error instanceof Error && error.message
    ? error.message
    : typeof error === 'string' && error.trim()
      ? error
      : '获取模型列表失败'
  const lower = raw.toLowerCase()
  if (lower.includes('request blocked') || lower.includes('blocked') || raw.includes('请求被阻止')) {
    return `请求被上游拦截：${raw}`
  }
  if (raw.includes('401') || raw.includes('403') || lower.includes('invalid token') || lower.includes('unauthorized')) {
    return `认证失败：请检查 API Key。${raw}`
  }
  if (raw.includes('HTTP 404') || raw.includes('HTTP 405') || lower.includes('all candidates failed') || raw.includes('未找到可用')) {
    return `模型列表接口不可用：当前 Base URL 推导出的 /models 地址不可用，可手动填写 Model ID。${raw}`
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return `获取模型列表超时：${raw}`
  }
  if (lower.includes('parse') || raw.includes('不是 JSON')) {
    return `模型列表响应格式不兼容：${raw}`
  }
  return raw
}
