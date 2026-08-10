export type ChatRequest = {
  message: string
  crop: string
  growthStage: string
  city?: string
  sessionId?: string
  imageDataUrl?: string
  imageName?: string
}

export type ChatResponse = {
  answer: string
  agent: string
  agent_trace?: string[]
  session_id: string
}

type DifyUploadResponse = { id?: string }
type DifyChatResponse = { answer?: string; conversation_id?: string; message?: string }

const difyBaseUrl = import.meta.env.VITE_DIFY_API_BASE?.replace(/\/$/, '') ?? ''
const difyApiKey = import.meta.env.VITE_DIFY_API_KEY ?? ''
const difyUser = import.meta.env.VITE_DIFY_USER?.trim() || 'ppd-user'

function getHeaders() {
  if (!difyBaseUrl || !difyApiKey) {
    throw new Error('Dify 尚未配置，请检查 frontend/.env.local。')
  }
  return { Authorization: `Bearer ${difyApiKey}` }
}

async function dataUrlToFile(dataUrl: string, name?: string) {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  return new File([blob], name || 'field-image.jpg', { type: blob.type || 'image/jpeg' })
}

async function uploadImage(dataUrl: string, name?: string) {
  const form = new FormData()
  form.append('file', await dataUrlToFile(dataUrl, name))
  form.append('user', difyUser)
  const response = await fetch(`${difyBaseUrl}/files/upload`, {
    method: 'POST',
    headers: getHeaders(),
    body: form,
  })
  if (!response.ok) throw new Error(`图片上传到 Dify 失败（${response.status}）`)
  const result = await response.json() as DifyUploadResponse
  if (!result.id) throw new Error('Dify 未返回图片文件标识')
  return result.id
}

export async function askAgent(payload: ChatRequest): Promise<ChatResponse> {
  const files = payload.imageDataUrl
    ? [{ type: 'image', transfer_method: 'local_file', upload_file_id: await uploadImage(payload.imageDataUrl, payload.imageName) }]
    : undefined
  const context = `地区：安徽省${payload.city || '合肥'}市\n作物：${payload.crop}\n生育期：${payload.growthStage}`
  const response = await fetch(`${difyBaseUrl}/chat-messages`, {
    method: 'POST',
    headers: { ...getHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inputs: {},
      query: `${context}\n\n农户问题：${payload.message}`,
      response_mode: 'blocking',
      user: difyUser,
      conversation_id: payload.sessionId || '',
      ...(files ? { files } : {}),
    }),
  })
  if (!response.ok) throw new Error(`Dify 对话服务暂不可用（${response.status}）`)
  const result = await response.json() as DifyChatResponse
  if (!result.answer) throw new Error(result.message || 'Dify 未返回有效回答')
  return {
    answer: result.answer,
    agent: 'Dify 农事智能助手',
    agent_trace: ['Dify 对话服务'],
    session_id: result.conversation_id || payload.sessionId || crypto.randomUUID(),
  }
}
