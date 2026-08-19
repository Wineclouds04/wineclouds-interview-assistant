# API 密钥与模型配置

本助手使用 **OpenAI 兼容** 的 Chat Completions API，任一兼容该格式的服务均可接入。

## 配置多个模型

在 `backend/config.json` 的 `models` 数组中添加多个模型，界面顶部会出现下拉选择器，可实时切换。`active_model` 为默认选中的下标（从 0 开始）。

```json
{
  "models": [
    { "name": "GPT-4o", "api_base_url": "...", "api_key": "...", "model": "gpt-4o", "supports_think": false, "supports_vision": true },
    { "name": "DeepSeek", "api_base_url": "...", "api_key": "...", "model": "deepseek-chat", "supports_think": true, "supports_vision": false }
  ],
  "active_model": 0
}
```

- `supports_vision: true`：支持截图识题，选择器中会显示 👁
- `supports_think: true`：可启用 Think 深度思考模式

---

## 各厂商配置示例

### OpenAI (GPT-4o / GPT-4o-mini)

- **API Key**：[https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)

```json
{
  "name": "GPT-4o",
  "api_base_url": "https://api.openai.com/v1",
  "api_key": "sk-proj-xxxxxxxxxxxx",
  "model": "gpt-4o",
  "supports_think": false,
  "supports_vision": true
}
```

### DeepSeek (V3 / R1)

- **API Key**：[https://platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys)

```json
{
  "name": "DeepSeek-V3",
  "api_base_url": "https://api.deepseek.com",
  "api_key": "sk-xxxxxxxxxxxx",
  "model": "deepseek-chat",
  "supports_think": true,
  "supports_vision": false
}
```

### SiliconFlow（OpenAI 兼容接口）

- **API Key**：在 [SiliconFlow API Keys](https://cloud.siliconflow.cn/account/ak) 创建，使用 `sk-...` 密钥。
- **API Base URL 必须填写** `https://api.siliconflow.cn/v1`。
- 不要把完整的 `https://api.siliconflow.cn/v1/chat/completions` 填入 Base URL；本项目和 OpenAI SDK 会自动追加 `/chat/completions`。
- **Model ID** 建议点击设置里的“获取模型”，从 SiliconFlow 返回的 `id` 中选择完整值。模型名会随平台上下线变化，不要只凭显示名称猜测。

```json
{
  "name": "SiliconFlow-DeepSeek-V4-Flash",
  "api_base_url": "https://api.siliconflow.cn/v1",
  "api_key": "sk-xxxxxxxxxxxx",
  "model": "deepseek-ai/DeepSeek-V4-Flash",
  "supports_think": true,
  "supports_vision": false
}
```

SiliconFlow 的 `deepseek-ai/DeepSeek-V4-Flash` 思考强度只接受 `high` 或 `max`；项目会把 Think 设置中的 `low/medium/high` 映射为 `high`，把 `xhigh` 映射为 `max`。视觉模型则只勾选“支持识图”，并以“获取模型”列表和平台模型详情为准。

如果使用 `Qwen3-VL` 等视觉模型，配置结构相同：把 `model` 替换为“获取模型”返回的完整 ID，确认模型确实支持视觉后勾选 `supports_vision`。若该模型支持 `enable_thinking`，再勾选 `supports_think`；不支持时保持关闭。

### 通义千问 (Qwen)

- **API Key**：[https://dashscope.console.aliyun.com/apiKey](https://dashscope.console.aliyun.com/apiKey)

```json
{
  "name": "Qwen-Plus",
  "api_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "api_key": "sk-xxxxxxxxxxxx",
  "model": "qwen-plus",
  "supports_think": false,
  "supports_vision": true
}
```

### 智谱 GLM

- **API Key**：[智谱 AI 开放平台](https://www.bigmodel.cn/)（免费注册即送 token）

```json
{
  "name": "GLM-4.7-Flash",
  "api_base_url": "https://open.bigmodel.cn/api/paas/v4",
  "api_key": "your-zhipu-api-key",
  "model": "GLM-4.7-Flash",
  "supports_think": false,
  "supports_vision": false
}
```

多模态可用 `GLM-4.6V-Flash`，设置 `"supports_vision": true`。

### 本地部署 (Ollama)

无需 API Key，先在本机运行：`ollama serve`

```json
{
  "name": "Ollama-Qwen",
  "api_base_url": "http://localhost:11434/v1",
  "api_key": "ollama",
  "model": "qwen2.5:14b",
  "supports_think": false,
  "supports_vision": false
}
```

### Claude（通过第三方兼容 API）

需使用兼容 OpenAI 格式的 Claude 代理服务，按服务商要求填写 `api_base_url` 和 `api_key`。

```json
{
  "name": "Claude-3.5-Sonnet",
  "api_base_url": "https://your-claude-proxy.com/v1",
  "api_key": "sk-xxxxxxxxxxxx",
  "model": "claude-3-5-sonnet-20241022",
  "supports_think": false,
  "supports_vision": true
}
```
