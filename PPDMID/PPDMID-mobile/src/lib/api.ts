export type ChatRequest = {
  message: string
  crop: string
  growthStage: string
  city: string
  sessionId?: string
  imageDataUrl?: string
  imageName?: string
}

export type ChatResponse = { answer: string; sessionId: string }
type DifyUploadResponse = { id?: string }
type DifyChatResponse = { answer?: string; conversation_id?: string; message?: string }

const baseUrl = import.meta.env.VITE_DIFY_API_BASE?.replace(/\/$/, '') ?? ''
const apiKey = import.meta.env.VITE_DIFY_API_KEY?.trim() ?? ''
const difyUser = import.meta.env.VITE_DIFY_USER?.trim() || 'ppd-user'

function headers() {
  if (!baseUrl || !apiKey) throw new Error('智能诊断服务尚未配置，请检查 .env.local。')
  return { Authorization: `Bearer ${apiKey}` }
}

async function uploadImage(dataUrl: string, name?: string) {
  const blob = await (await fetch(dataUrl)).blob()
  const form = new FormData()
  form.append('file', new File([blob], name || 'field-image.jpg', { type: blob.type || 'image/jpeg' }))
  form.append('user', difyUser)
  const response = await fetch(`${baseUrl}/files/upload`, { method: 'POST', headers: headers(), body: form })
  if (!response.ok) throw new Error(`图片上传失败（${response.status}）`)
  const result = await response.json() as DifyUploadResponse
  if (!result.id) throw new Error('图片上传后未返回文件标识。')
  return result.id
}

export async function askAgent(payload: ChatRequest): Promise<ChatResponse> {
  const files = payload.imageDataUrl
    ? [{ type: 'image', transfer_method: 'local_file', upload_file_id: await uploadImage(payload.imageDataUrl, payload.imageName) }]
    : undefined
  const context = `地区：安徽省${payload.city}市\n作物：${payload.crop}\n生育期：${payload.growthStage}`
  const response = await fetch(`${baseUrl}/chat-messages`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: {}, query: `${context}\n\n农户问题：${payload.message}`, response_mode: 'blocking', user: difyUser, conversation_id: payload.sessionId || '', ...(files ? { files } : {}) }),
  })
  if (!response.ok) throw new Error(`智能诊断服务暂不可用（${response.status}）`)
  const result = await response.json() as DifyChatResponse
  if (!result.answer) throw new Error(result.message || '服务没有返回有效回答。')
  return { answer: result.answer, sessionId: result.conversation_id || payload.sessionId || crypto.randomUUID() }
}
