import { useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts'
import {
  Activity, BellRing, Bot, ChevronDown, ChevronRight, CloudSun, Database,
  History, ImagePlus, KeyRound, LayoutDashboard, Leaf, LocateFixed, LockKeyhole, LogIn, MapPinned, Menu,
  Mic, MicOff, RefreshCw, Search, Send, Settings2, ShieldCheck, Sparkles, Sprout,
  Stethoscope, UserRound, X, Zap,
  Volume2,
} from 'lucide-react'
import {
  alerts as demoAlerts, cities as demoCities, cropPlans as demoCropPlans,
  dashboardStats as demoDashboardStats, preventionTips as demoPreventionTips,
  type AlertItem, type CityRisk, type CropPlanMap, type DashboardStats,
} from './data'
import { askAgent } from './lib/api'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { anhuiCityLocations, fetchCurrentWeather, nearestAnhuiCity, type WeatherInfo } from './lib/weather'

type Page = 'overview' | 'prevention' | 'copilot' | 'alerts' | 'history' | 'settings'
type ChatMessage = { role: 'user' | 'assistant'; text: string; meta?: string; imageUrl?: string }
type PendingImage = { name: string; dataUrl: string }
type GeneratedPlan = { crop: string; stage: string; answer: string; meta: string }
type SpeechRecognitionEventLike = { results: ArrayLike<{ 0: { transcript: string } }> }
type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike
type AppUser = { id: number; username: string; sessionToken: string }
type AppSettings = { weatherMode: 'auto' | 'manual'; manualCity: string; refreshSeconds: number }
type DiagnosisRecord = {
  id: number | string
  conversation_id?: string | null
  crop: string
  growth_stage: string
  question: string
  answer: string
  created_at: string
}

const USER_STORAGE_KEY = 'ah-ppdmid-user'
const SETTINGS_STORAGE_KEY = 'ah-ppdmid-settings'
const alertReadStorageKey = (userId: number) => `ah-ppdmid-alert-reads-${userId}`
const getLocalAlertReads = (userId: number) => {
  try { return new Set<string>(JSON.parse(localStorage.getItem(alertReadStorageKey(userId)) ?? '[]') as string[]) }
  catch { return new Set<string>() }
}
const saveLocalAlertReads = (userId: number, alertIds: Array<number | string>) =>
  localStorage.setItem(alertReadStorageKey(userId), JSON.stringify(alertIds.map(String)))
const historySeenStorageKey = (userId: number) => `ah-ppdmid-history-seen-${userId}`
const getHistorySeenAt = (userId: number) => Date.parse(localStorage.getItem(historySeenStorageKey(userId)) ?? '') || 0
const saveHistorySeenAt = (userId: number) => localStorage.setItem(historySeenStorageKey(userId), new Date().toISOString())
const defaultSettings: AppSettings = { weatherMode: 'auto', manualCity: '合肥', refreshSeconds: 10 }
const defaultWeather: WeatherInfo = {
  city: '合肥', temperature: null, condition: '正在获取实时天气', wind: '请稍候',
  updatedAt: '', source: 'fallback',
}
const anhuiToday = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
const normalizeStats = (value: DashboardStats): DashboardStats => ({
  ...value,
  today_consults: value.consult_date === anhuiToday() ? value.today_consults : 0,
})

const getSpeechRecognition = () => {
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
}

function useSpeechInput(onText: (text: string) => void) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const [listening, setListening] = useState(false)
  const supported = typeof window !== 'undefined' && Boolean(getSpeechRecognition())

  const toggle = () => {
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }
    const Recognition = getSpeechRecognition()
    if (!Recognition) return
    const recognition = new Recognition()
    recognition.lang = 'zh-CN'
    recognition.interimResults = false
    recognition.continuous = false
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim()
      if (transcript) onText(transcript)
    }
    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)
    recognitionRef.current = recognition
    setListening(true)
    recognition.start()
  }

  useEffect(() => () => recognitionRef.current?.stop(), [])
  return { supported, listening, toggle }
}

async function optimizeImage(file: File): Promise<PendingImage> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('仅支持 JPG、PNG 或 WebP 图片')
  if (file.size > 12 * 1024 * 1024) throw new Error('图片不能超过 12MB')
  const source = URL.createObjectURL(file)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('图片读取失败，请换一张试试'))
      image.src = source
    })
    const maxSide = 1600
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法处理该图片')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return { name: file.name, dataUrl: canvas.toDataURL('image/jpeg', 0.86) }
  } finally {
    URL.revokeObjectURL(source)
  }
}

function speak(text: string) {
  if (!('speechSynthesis' in window) || !text.trim()) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text.replace(/[#*_`>-]/g, ' '))
  utterance.lang = 'zh-CN'
  utterance.rate = 0.95
  window.speechSynthesis.speak(utterance)
}

const pageMeta: Record<Page, { title: string; eyebrow: string }> = {
  overview: { title: '农情态势总览', eyebrow: 'ANHUI AGRICULTURAL OVERVIEW' },
  prevention: { title: '生育期预防方案', eyebrow: 'GROWTH-STAGE PREVENTION' },
  copilot: { title: '智能诊断中心', eyebrow: 'DIFY AGRICULTURAL COPILOT' },
  alerts: { title: '病虫害预警中心', eyebrow: 'RISK EARLY WARNING' },
  history: { title: '诊断历史记录', eyebrow: 'DIAGNOSIS HISTORY' },
  settings: { title: '系统设置', eyebrow: 'SYSTEM PREFERENCES' },
}

const levelText = { high: '高风险', medium: '中风险', low: '关注' } as const
const pageNav = [
  { id: 'overview' as const, label: '态势总览', icon: LayoutDashboard },
  { id: 'prevention' as const, label: '生育期预防', icon: Sprout },
  { id: 'copilot' as const, label: '智能诊断', icon: Bot },
  { id: 'alerts' as const, label: '预警中心', icon: BellRing },
]

function BrandLogo() {
  const [missing, setMissing] = useState(false)
  return <div className="brand-mark">
    {!missing && <img src="/assets/ppd-mid-logo.png" alt="PPD-MID" onError={() => setMissing(true)} />}
    {missing && <Leaf size={25} />}
  </div>
}

function RiskMap({ cities }: { cities: CityRisk[] }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    const cityLookup = new globalThis.Map(cities.map((item) => [item.city.replace('市', ''), item]))
    fetch('/assets/anhui.json')
      .then((response) => response.json())
      .then((geoJson) => {
        echarts.registerMap('anhui', geoJson)
        chart.setOption({
          tooltip: {
            trigger: 'item',
            backgroundColor: '#173e2f',
            borderWidth: 0,
            textStyle: { color: '#fff' },
            formatter: (params: { name: string; value?: number }) => {
              const item = cityLookup.get(params.name.replace('市', ''))
              return item ? `<b>${params.name}</b><br/>风险指数 ${item.score}<br/>重点关注：${item.focus}` : params.name
            },
          },
          visualMap: {
            show: false,
            min: 20,
            max: 85,
            inRange: { color: ['#dcebdd', '#9fc99f', '#e4bc65', '#d96a53'] },
          },
          series: [{
            type: 'map',
            map: 'anhui',
            roam: false,
            zoom: 1.08,
            label: { show: true, color: '#244638', fontSize: 10, formatter: (p: { name: string }) => p.name.replace('市', '') },
            emphasis: { label: { color: '#173e2f', fontWeight: 'bold' }, itemStyle: { areaColor: '#e5cf81', borderColor: '#fff', borderWidth: 1.5 } },
            itemStyle: { borderColor: 'rgba(255,255,255,.85)', borderWidth: 1.2 },
            data: cities.map((item) => ({ name: `${item.city}市`, value: item.score })),
          }],
        })
      })
      .catch(() => chart.setOption({ title: { text: '安徽地图数据加载中', left: 'center', top: 'middle', textStyle: { color: '#789084', fontSize: 13 } } }))
    const resize = () => chart.resize()
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); chart.dispose() }
  }, [cities])

  return <div className="risk-map" ref={ref} aria-label="安徽省十六地市病虫害风险地图" />
}

function App() {
  const [user, setUser] = useState<AppUser | null>(() => {
    try {
      const saved = localStorage.getItem(USER_STORAGE_KEY)
      return saved ? JSON.parse(saved) as AppUser : null
    } catch { return null }
  })
  const [page, setPage] = useState<Page>('overview')
  const [navOpen, setNavOpen] = useState(false)
  const [cities, setCities] = useState<CityRisk[]>(demoCities)
  const [alerts, setAlerts] = useState<AlertItem[]>(demoAlerts)
  const [cropPlans, setCropPlans] = useState<CropPlanMap>(demoCropPlans)
  const [preventionTips, setPreventionTips] = useState<Record<string, string[]>>(demoPreventionTips)
  const [stats, setStats] = useState<DashboardStats>(demoDashboardStats)
  const [crop, setCrop] = useState('水稻')
  const [stage, setStage] = useState<string>(demoCropPlans.水稻.stages[1])
  const [city, setCity] = useState('合肥')
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string>()
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedPlan | null>(null)
  const [preventionLoading, setPreventionLoading] = useState(false)
  const [history, setHistory] = useState<DiagnosisRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [unreadHistoryCount, setUnreadHistoryCount] = useState(0)
  const [unreadAlertCount, setUnreadAlertCount] = useState(0)
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY)
      return saved ? { ...defaultSettings, ...JSON.parse(saved) as Partial<AppSettings> } : defaultSettings
    } catch { return defaultSettings }
  })
  const [weather, setWeather] = useState<WeatherInfo>(defaultWeather)
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [locationRequestKey, setLocationRequestKey] = useState(0)
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', text: '你好，我是“小皖”农业智能助手。请选择作物、生育期和所在城市，再描述田间症状或想了解的防控问题。', meta: 'Dify 农事助手' },
  ])

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    const load = async () => {
      const [cityResult, alertResult, cropResult, stageResult, tipResult, statsResult] = await Promise.all([
        client.from('city_risk').select('city,zone,score,level,focus').order('score', { ascending: false }),
        client.from('alerts').select('id,level,date,title,summary,crop,region').order('created_at', { ascending: false }).limit(20),
        client.from('crops').select('code,name,icon,season').eq('enabled', true).order('sort_order'),
        client.from('crop_stages').select('crop_code,name,sort_order').order('sort_order'),
        client.from('prevention_tips').select('crop_code,content,sort_order').order('sort_order'),
        client.from('dashboard_stats').select('overall_risk,risk_label,today_consults,crop_count,city_count,login_count,consult_date').eq('id', 1).maybeSingle(),
      ])
      if (cityResult.data?.length) setCities(cityResult.data as CityRisk[])
      if (alertResult.data) setAlerts(alertResult.data as AlertItem[])
      if (cropResult.data?.length && stageResult.data?.length) {
        const rows = cropResult.data as Array<{ code: string; name: string; icon: string; season: string }>
        const stages = stageResult.data as Array<{ crop_code: string; name: string; sort_order: number }>
        const nextPlans: CropPlanMap = {}
        rows.forEach((item) => {
          nextPlans[item.name] = {
            code: item.code,
            icon: item.icon,
            season: item.season,
            stages: stages.filter((stageItem) => stageItem.crop_code === item.code).map((stageItem) => stageItem.name),
          }
        })
        setCropPlans(nextPlans)
      }
      if (cropResult.data?.length && tipResult.data?.length) {
        const nameByCode = new Map((cropResult.data as Array<{ code: string; name: string }>).map((item) => [item.code, item.name]))
        const nextTips: Record<string, string[]> = {}
        ;(tipResult.data as Array<{ crop_code: string; content: string }>).forEach((item) => {
          const cropName = nameByCode.get(item.crop_code)
          if (cropName) (nextTips[cropName] ??= []).push(item.content)
        })
        setPreventionTips(nextTips)
      }
      if (statsResult.data) setStats(normalizeStats(statsResult.data as DashboardStats))
    }
    void load()
  }, [])

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    const refreshStats = async () => {
      const { data } = await client
        .from('dashboard_stats')
        .select('overall_risk,risk_label,today_consults,crop_count,city_count,login_count,consult_date')
        .eq('id', 1)
        .maybeSingle()
      if (data) setStats(normalizeStats(data as DashboardStats))
    }
    const timer = window.setInterval(() => { void refreshStats() }, settings.refreshSeconds * 1000)
    return () => window.clearInterval(timer)
  }, [settings.refreshSeconds])

  useEffect(() => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    let cancelled = false
    const loadManualWeather = async (error?: string) => {
      const target = anhuiCityLocations.find((item) => item.name === settings.manualCity) ?? anhuiCityLocations[0]
      if (!cancelled) setCity(target.name)
      try {
        const next = await fetchCurrentWeather(target.latitude, target.longitude, target.name, error ? 'fallback' : 'manual')
        if (!cancelled) setWeather(error ? { ...next, error } : next)
      } catch (caught) {
        if (!cancelled) setWeather({ ...defaultWeather, city: target.name, condition: '天气暂不可用', wind: '稍后自动重试', error: caught instanceof Error ? caught.message : String(caught) })
      }
    }
    const refreshWeather = () => {
      setWeatherLoading(true)
      if (settings.weatherMode === 'manual') {
        void loadManualWeather().finally(() => { if (!cancelled) setWeatherLoading(false) })
        return
      }
      if (!navigator.geolocation) {
        void loadManualWeather('当前浏览器不支持定位，已使用手选城市').finally(() => { if (!cancelled) setWeatherLoading(false) })
        return
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords
          const nearest = nearestAnhuiCity(latitude, longitude)
          const outsideAnhui = Math.abs(latitude - nearest.latitude) > 1.8 || Math.abs(longitude - nearest.longitude) > 1.8
          void fetchCurrentWeather(latitude, longitude, outsideAnhui ? '当前位置' : nearest.name, 'location')
            .then((next) => {
              if (cancelled) return
              setWeather(next)
              // 诊断上下文与天气定位保持一致；平台服务范围外时回退到手选城市。
              setCity(outsideAnhui ? settings.manualCity : nearest.name)
            })
            .catch((caught) => loadManualWeather(caught instanceof Error ? caught.message : String(caught)))
            .finally(() => { if (!cancelled) setWeatherLoading(false) })
        },
        () => {
          void loadManualWeather('未获得定位权限，已使用手选城市')
            .finally(() => { if (!cancelled) setWeatherLoading(false) })
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 15 * 60 * 1000 },
      )
    }
    refreshWeather()
    const timer = window.setInterval(refreshWeather, 15 * 60 * 1000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [settings.weatherMode, settings.manualCity, locationRequestKey])

  useEffect(() => {
    if (!supabase || !user?.sessionToken) return
    const client = supabase
    const refreshAlerts = async () => {
      const [alertResult, unreadResult] = await Promise.all([
        client.from('alerts').select('id,level,date,title,summary,crop,region').order('created_at', { ascending: false }).limit(100),
        client.rpc('get_unread_alert_count', { p_session_token: user.sessionToken }),
      ])
      const latestAlerts = (alertResult.data ?? []) as AlertItem[]
      if (alertResult.data) setAlerts(latestAlerts)
      if (page === 'alerts' && latestAlerts.length > 0) {
        saveLocalAlertReads(user.id, latestAlerts.map((item) => item.id))
        if (!unreadResult.error) await client.rpc('mark_alerts_read', { p_session_token: user.sessionToken })
        setUnreadAlertCount(0)
      } else if (!unreadResult.error) {
        const nextCount = Number(unreadResult.data ?? 0)
        setUnreadAlertCount(nextCount)
      } else if (alertResult.data) {
        const localReads = getLocalAlertReads(user.id)
        setUnreadAlertCount(latestAlerts.filter((item) => !localReads.has(String(item.id))).length)
      }
    }
    void refreshAlerts()
    const timer = window.setInterval(() => { void refreshAlerts() }, settings.refreshSeconds * 1000)
    return () => window.clearInterval(timer)
  }, [user, settings.refreshSeconds, page])

  useEffect(() => {
    if (!supabase || !user?.sessionToken) return
    const client = supabase
    const loadHistory = async () => {
      setHistoryLoading(true)
      const { data, error } = await client.rpc('get_diagnosis_history', {
        p_session_token: user.sessionToken,
        p_limit: 30,
      })
      if (error) {
        if (/失效|invalid|expired/i.test(error.message)) {
          localStorage.removeItem(USER_STORAGE_KEY)
          setUser(null)
        }
      } else if (data) {
        setHistory(data as DiagnosisRecord[])
      }
      setHistoryLoading(false)
    }
    void loadHistory()
  }, [user])

  useEffect(() => {
    if (!user) return
    if (page === 'history') {
      saveHistorySeenAt(user.id)
      setUnreadHistoryCount(0)
      return
    }
    const seenAt = getHistorySeenAt(user.id)
    setUnreadHistoryCount(history.filter((record) => Date.parse(record.created_at) > seenAt).length)
  }, [history, page, user])

  const selectCrop = (nextCrop: string) => {
    setCrop(nextCrop)
    setStage(cropPlans[nextCrop].stages[0])
  }

  const markAlertsRead = async () => {
    setUnreadAlertCount(0)
    if (!user) return
    saveLocalAlertReads(user.id, alerts.map((item) => item.id))
    if (!supabase || !user.sessionToken) return
    await supabase.rpc('mark_alerts_read', { p_session_token: user.sessionToken })
    setUnreadAlertCount(0)
  }

  const markHistoryRead = () => {
    setUnreadHistoryCount(0)
    if (user) saveHistorySeenAt(user.id)
  }

  const switchPage = (next: Page) => {
    setPage(next)
    setNavOpen(false)
    if (next === 'alerts') void markAlertsRead()
    if (next === 'history') markHistoryRead()
  }

  const submitQuestion = async (preset?: string, image?: PendingImage | null) => {
    const typedMessage = (preset ?? question).trim()
    const message = typedMessage || (image ? '请分析这张田间图片，判断可见症状并告诉我下一步怎么查。' : '')
    if (!message || loading) return
    setMessages((current) => [...current, { role: 'user', text: message, imageUrl: image?.dataUrl }])
    setQuestion('')
    setLoading(true)
    let answerText = ''
    let answerMeta = ''
    let conversationId = sessionId
    try {
      const result = await askAgent({
        message,
        crop,
        growthStage: stage,
        city,
        sessionId,
        imageDataUrl: image?.dataUrl,
        imageName: image?.name,
      })
      setSessionId(result.session_id)
      conversationId = result.session_id
      answerText = result.answer
      const trace = result.agent_trace?.length ? ` · ${result.agent_trace.join(' → ')}` : ''
      answerMeta = `${result.agent}${trace}`
    } catch {
      answerText = `针对${city}${crop}${stage}：建议先进行五点取样，记录病株率、虫量与叶片症状；重点排查${preventionTips[crop]?.[1] ?? '当地主要病虫害'}。当前为离线演示建议，具体药剂与剂量请依据农药登记标签、田间调查结果及当地植保部门意见执行。`
      answerMeta = '本地应急研判 · 后端未连接'
    } finally {
      setMessages((current) => [...current, { role: 'assistant', text: answerText, meta: answerMeta }])
      setLoading(false)
    }
    if (supabase && user?.sessionToken && answerText) {
      const { data: recordId } = await supabase.rpc('save_diagnosis_history', {
        p_session_token: user.sessionToken,
        p_conversation_id: conversationId ?? '',
        p_crop: crop,
        p_growth_stage: stage,
        p_question: message,
        p_answer: answerText,
      })
      if (recordId) {
        const today = anhuiToday()
        setStats((current) => ({
          ...current,
          today_consults: current.consult_date === today ? current.today_consults + 1 : 1,
          consult_date: today,
        }))
        setHistory((current) => [{
          id: recordId as number,
          conversation_id: conversationId,
          crop,
          growth_stage: stage,
          question: message,
          answer: answerText,
          created_at: new Date().toISOString(),
        }, ...current])
      }
    }
  }

  const generatePreventionPlan = async () => {
    if (preventionLoading || loading) return
    const targetCrop = crop
    const targetStage = stage
    const prompt = `请生成安徽省${city}市${targetCrop}${targetStage}的生育期预防方案。请覆盖田间管理、重点病虫监测、天气风险、巡田频次和安全注意事项，并给出未来7天可执行清单。`
    setPreventionLoading(true)
    try {
      const result = await askAgent({ message: prompt, crop: targetCrop, growthStage: targetStage, city, sessionId })
      setSessionId(result.session_id)
      const trace = result.agent_trace?.length ? result.agent_trace.join(' → ') : result.agent
      setGeneratedPlan({ crop: targetCrop, stage: targetStage, answer: result.answer, meta: trace })
      setStats((current) => ({
        ...current,
        today_consults: current.consult_date === anhuiToday() ? current.today_consults + 1 : 1,
        consult_date: anhuiToday(),
      }))
      if (supabase && user?.sessionToken) {
        const { data: recordId } = await supabase.rpc('save_diagnosis_history', {
          p_session_token: user.sessionToken,
          p_conversation_id: result.session_id,
          p_crop: targetCrop,
          p_growth_stage: targetStage,
          p_question: prompt,
          p_answer: result.answer,
        })
        if (recordId) {
          setHistory((current) => [{
            id: recordId as number,
            conversation_id: result.session_id,
            crop: targetCrop,
            growth_stage: targetStage,
            question: prompt,
            answer: result.answer,
            created_at: new Date().toISOString(),
          }, ...current])
        }
      }
    } catch (error) {
      setGeneratedPlan({
        crop: targetCrop,
        stage: targetStage,
        answer: `暂时没有生成成功：${error instanceof Error ? error.message : 'Dify 服务暂不可用'}。请检查 Dify 配置后重试。`,
        meta: 'Dify 生成失败',
      })
    } finally {
      setPreventionLoading(false)
    }
  }

  const handleLogin = (nextUser: AppUser) => {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUser))
    setStats((current) => ({ ...current, login_count: current.login_count + 1 }))
    setUser(nextUser)
  }

  const logout = async () => {
    if (supabase && user?.sessionToken) {
      await supabase.rpc('logout_app_user', { p_session_token: user.sessionToken })
    }
    localStorage.removeItem(USER_STORAGE_KEY)
    setUser(null)
    setHistory([])
    setUnreadHistoryCount(0)
  }

  if (!user) return <AuthScreen onLogin={handleLogin} />

  return (
    <div className="app-shell">
      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <div className="brand">
          <BrandLogo />
          <div><strong>PPD-MID</strong><span>皖农智诊</span></div>
          <button className="close-nav" onClick={() => setNavOpen(false)} aria-label="关闭菜单"><X /></button>
        </div>

        <div className="region-chip"><MapPinned size={15} /><div><span>服务区域</span><strong>安徽省 · 16 地市</strong></div><ChevronDown size={14} /></div>
        <nav>
          <small>决策工作台</small>
          {pageNav.map((item) => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => switchPage(item.id)}><item.icon size={18} /><span>{item.label}</span>{item.id === 'alerts' && unreadAlertCount > 0 && <b>{Math.min(unreadAlertCount, 99)}</b>}</button>)}
          <small>数据与系统</small>
          <button><Database size={18} /><span>监测数据</span><i>即将开放</i></button>
          <button className={page === 'history' ? 'active' : ''} onClick={() => switchPage('history')}><History size={18} /><span>诊断记录</span>{unreadHistoryCount > 0 && <b>{Math.min(unreadHistoryCount, 99)}</b>}</button>
        </nav>
        <div className="sidebar-foot">
          <div className="service-state"><span /><div><strong>系统运行正常</strong><small>{isSupabaseConfigured ? '数据库连接正常' : '当前为演示数据'}</small></div></div>
          <button className={page === 'settings' ? 'active' : ''} onClick={() => switchPage('settings')}><Settings2 size={17} />系统设置</button>
        </div>
      </aside>
      {navOpen && <button className="nav-backdrop" onClick={() => setNavOpen(false)} aria-label="关闭菜单" />}

      <main className="workspace">
        <header className="topbar">
          <button className="menu-trigger" onClick={() => setNavOpen(true)}><Menu /></button>
          <div><span>{pageMeta[page].eyebrow}</span><h1>{pageMeta[page].title}</h1></div>
          <div className="topbar-actions">
            <button className="weather" onClick={() => switchPage('settings')} title="打开天气与系统设置"><CloudSun size={22} /><div><strong>{weather.city} {weather.temperature === null ? '--' : weather.temperature}°C</strong><span>{weatherLoading ? '正在更新 · ' : ''}{weather.condition} · {weather.wind}</span></div></button>
            <button className="icon-button" onClick={() => switchPage('alerts')} aria-label={`未读预警 ${unreadAlertCount} 条`}><BellRing size={19} />{unreadAlertCount > 0 && <b>{Math.min(unreadAlertCount, 99)}</b>}</button>
            <div className="user-brief"><div className="avatar">{user.username.slice(0, 1).toUpperCase()}</div><div><strong>{user.username}</strong><button onClick={() => void logout()}>退出登录</button></div></div>
          </div>
        </header>

        <div className="content">
          {page === 'overview' && <Overview cities={cities} alerts={alerts} stats={stats} onNavigate={switchPage} />}
          {page === 'prevention' && <Prevention crop={crop} stage={stage} cropPlans={cropPlans} preventionTips={preventionTips} generatedPlan={generatedPlan} loading={preventionLoading} onCrop={selectCrop} onStage={setStage} onGenerate={() => void generatePreventionPlan()} onAsk={() => switchPage('copilot')} />}
          {page === 'copilot' && <Copilot crop={crop} stage={stage} cropPlans={cropPlans} cities={cities} city={city} question={question} messages={messages} loading={loading} onCrop={selectCrop} onStage={setStage} onCity={setCity} onQuestion={setQuestion} onSubmit={submitQuestion} />}
          {page === 'alerts' && <AlertsPage alerts={alerts} stats={stats} />}
          {page === 'history' && <HistoryPage history={history} loading={historyLoading} onOpen={(record) => { setCrop(record.crop); setStage(record.growth_stage); setMessages([{ role: 'user', text: record.question }, { role: 'assistant', text: record.answer, meta: `历史诊断 · ${new Date(record.created_at).toLocaleString('zh-CN')}` }]); switchPage('copilot') }} />}
          {page === 'settings' && <SettingsPage settings={settings} weather={weather} weatherLoading={weatherLoading} unreadAlertCount={unreadAlertCount} onSettings={setSettings} onLocate={() => { setSettings((current) => ({ ...current, weatherMode: 'auto' })); setLocationRequestKey((current) => current + 1) }} />}
        </div>
      </main>
      <FloatingXiaowan
        crop={crop}
        stage={stage}
        city={city}
        messages={messages}
        loading={loading}
        onSubmit={(message) => void submitQuestion(message)}
        onOpenWorkbench={() => switchPage('copilot')}
      />
    </div>
  )
}

function Overview({ cities, alerts, stats, onNavigate }: { cities: CityRisk[]; alerts: AlertItem[]; stats: DashboardStats; onNavigate: (page: Page) => void }) {
  const topCities = [...cities].sort((a, b) => b.score - a.score).slice(0, 5)
  return <>
    <section className="hero">
      <div className="hero-copy">
        <span className="eyebrow"><Sparkles size={15} /> 安徽省农业病虫害数智防控· 皖农智诊</span>
        <h2>让风险早发现，<br /><em>让防控更精准。</em></h2>
        <p>围绕江淮丘陵、淮北平原、沿江平原与皖南山区，汇聚监测数据与 Dify 农事对话，为安徽主要农作物提供分生育期决策支持。</p>
        <div className="hero-actions"><button className="primary" onClick={() => onNavigate('copilot')}>开始智能诊断 <ChevronRight size={17} /></button><button className="secondary" onClick={() => onNavigate('prevention')}>查看预防方案</button></div>
      </div>
      <div className="hero-visual" aria-hidden="true">
        <span className="orbit orbit-one" /><span className="orbit orbit-two" />
        <div className="hero-seal"><Sprout size={34} /><strong>{stats.city_count}</strong><span>地市联防</span></div>
        <div className="crop-badge rice">🌾<small>水稻</small></div><div className="crop-badge wheat">🌿<small>小麦</small></div><div className="crop-badge rape">🌼<small>油菜</small></div>
      </div>
    </section>

    <section className="stats-grid">
      <Stat icon={<Activity />} label="综合风险指数" value={String(stats.overall_risk)} suffix={stats.risk_label} trend="较昨日 -3.2%" />
      <Stat icon={<Stethoscope />} label="今日智能研判" value={String(stats.today_consults)} suffix="次" trend="每次智能输出实时累加" />
      <Stat icon={<MapPinned />} label="联网监测区域" value={String(stats.city_count)} suffix="地市" trend="全省数据联动" />
      <Stat icon={<ShieldCheck />} label="平台登录人次" value={String(stats.login_count)} suffix="人次" trend="每次登录实时累加" />
    </section>

    <section className="dashboard-grid">
      <article className="panel map-panel">
        <PanelHeader icon={<MapPinned />} title="安徽省病虫害风险分布" note="16 地市动态态势" />
        <RiskMap cities={cities} />
        <div className="map-legend"><span><i className="high" />高风险 70+</span><span><i className="medium" />中风险 40–69</span><span><i className="low" />关注 0–39</span></div>
      </article>
      <article className="panel ranking-panel">
        <PanelHeader icon={<Activity />} title="地市风险排行" note="实时风险指数" />
        <div className="rank-list">{topCities.map((item, index) => <div className="rank-item" key={item.city}><b>{String(index + 1).padStart(2, '0')}</b><div><strong>{item.city}</strong><span>{item.zone} · {item.focus}</span><div className="risk-track"><i className={item.level} style={{ width: `${item.score}%` }} /></div></div><em>{item.score}</em></div>)}</div>
        <button className="text-button" onClick={() => onNavigate('alerts')}>查看全部地市风险 <ChevronRight size={15} /></button>
      </article>
      <article className="panel alert-panel">
        <PanelHeader icon={<BellRing />} title="最新监测预警" note="近 24 小时" />
        <div className="alert-list">{alerts.slice(0, 3).map((item) => <AlertCard item={item} compact key={item.id} />)}</div>
        <button className="text-button" onClick={() => onNavigate('alerts')}>进入预警中心 <ChevronRight size={15} /></button>
      </article>
    </section>
  </>
}

function Prevention({ crop, stage, cropPlans, preventionTips, generatedPlan, loading, onCrop, onStage, onGenerate, onAsk }: { crop: string; stage: string; cropPlans: CropPlanMap; preventionTips: Record<string, string[]>; generatedPlan: GeneratedPlan | null; loading: boolean; onCrop: (crop: string) => void; onStage: (stage: string) => void; onGenerate: () => void; onAsk: () => void }) {
  const stages = cropPlans[crop].stages
  const currentGeneratedPlan = generatedPlan?.crop === crop && generatedPlan.stage === stage ? generatedPlan : null
  return <div className="prevention-page">
    <section className="page-intro"><div><span className="eyebrow"><Sprout size={15} /> 因地 · 因苗 · 因时施策</span><h2>选择作物与生育期，生成当前阶段预防清单</h2><p>内置安徽主要作物基础知识，并可通过 Dify 农事助手生成个性化的预防建议。</p></div><div className="intro-stamp"><strong>AH</strong><span>安徽农防</span></div></section>
    <div className="section-label"><span>01</span><div><strong>选择作物</strong><small>安徽省主要粮油作物</small></div></div>
    <section className="crop-selector">{Object.keys(cropPlans).map((name) => <button className={crop === name ? 'active' : ''} onClick={() => onCrop(name)} key={name}><span>{cropPlans[name].icon}</span><strong>{name}</strong><small>{cropPlans[name].season}</small>{crop === name && <i>已选择</i>}</button>)}</section>
    <div className="section-label"><span>02</span><div><strong>当前生育期</strong><small>点击切换阶段</small></div></div>
    <section className="stage-line">{stages.map((item, index) => <button key={item} className={stage === item ? 'active' : ''} onClick={() => onStage(item)}><i>{index + 1}</i><span>{item}</span></button>)}</section>
    <section className="plan-result">
      <div className="plan-head"><div><span>{cropPlans[crop].icon}</span><div><small>{crop} · {stage}</small><h3>当前阶段田间预防要点</h3></div></div><span className="generated"><Zap size={14} /> 基础知识库</span></div>
      <div className="tips-grid">{(preventionTips[crop] ?? []).map((tip, index) => <article key={tip}><b>0{index + 1}</b><div><strong>{['田间管理', '监测重点', '科学作业'][index]}</strong><p>{tip}</p></div></article>)}</div>
      <div className="ai-plan-actions"><div><Sparkles /><span><strong>让小皖生成专属方案</strong><small>结合{crop}·{stage}、安徽农情和 Dify 对话实时生成</small></span></div><button onClick={onGenerate} disabled={loading}>{loading ? <><RefreshCw className="spinning" /> 小皖正在生成…</> : <><Zap /> 生成智能预防方案</>}</button></div>
      {currentGeneratedPlan && <section className="generated-plan"><header><div><img src="/assets/xiaowan-mascot.png" alt="小皖" /><span><strong>小皖生成结果</strong><small>{currentGeneratedPlan.meta}</small></span></div><button onClick={() => speak(currentGeneratedPlan.answer)} title="朗读方案"><Volume2 /></button></header><p>{currentGeneratedPlan.answer}</p><footer><ShieldCheck /> 内容为辅助决策；用药请遵循登记标签与当地植保部门指导。</footer></section>}
      <div className="safety-note"><ShieldCheck size={19} /><p><strong>安全提示</strong>建议仅用于辅助决策。农药使用必须遵循登记标签、当地植保部门意见和安全间隔期要求。</p><button onClick={onAsk}>继续问小皖 <ChevronRight size={16} /></button></div>
    </section>
  </div>
}

function Copilot({ crop, stage, cropPlans, cities, city, question, messages, loading, onCrop, onStage, onCity, onQuestion, onSubmit }: { crop: string; stage: string; cropPlans: CropPlanMap; cities: CityRisk[]; city: string; question: string; messages: ChatMessage[]; loading: boolean; onCrop: (crop: string) => void; onStage: (stage: string) => void; onCity: (city: string) => void; onQuestion: (value: string) => void; onSubmit: (preset?: string, image?: PendingImage | null) => void }) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [image, setImage] = useState<PendingImage | null>(null)
  const [imageError, setImageError] = useState('')
  const { supported: speechSupported, listening, toggle: toggleSpeech } = useSpeechInput((text) => onQuestion(`${question}${question ? ' ' : ''}${text}`))
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])
  const chooseImage = async (file?: File) => {
    if (!file) return
    setImageError('')
    try { setImage(await optimizeImage(file)) }
    catch (error) { setImageError(error instanceof Error ? error.message : '图片处理失败') }
  }
  const sendMessage = (preset?: string) => {
    if (loading || (!(preset ?? question).trim() && !image)) return
    onSubmit(preset, image)
    setImage(null)
    if (fileRef.current) fileRef.current.value = ''
  }
  const presets = [
    `我在${city}种植的${crop}正处于${stage}，叶片出现褐色斑点并有部分黄化，应该重点排查哪些病害或管理问题？`,
    `最近${city}连续降雨，${crop}${stage}田间湿度大、局部可能积水，需要重点预防哪些病虫害？巡田时该看什么？`,
    `帮我看看${crop}${stage}重点防什么`,
  ]
  const capabilityPrompts = {
    symptoms: `请作为田间症状诊断专家，针对安徽省${city}市${crop}${stage}，引导我按“受害部位、症状形态、田间分布、发生比例、近期管理”逐项排查。先告诉我需要观察和补充什么，再列出可能原因及区分特征；信息不足时不要直接确诊。`,
    risk: `请评估安徽省${city}市${crop}${stage}当前阶段的综合风险。分别分析主要病害、虫害、天气与田间管理风险，说明还缺少哪些实时信息，并按高、中、低给出风险分级和优先巡查顺序。`,
    checklist: `请为安徽省${city}市${crop}${stage}生成一份未来7天田间行动清单，按“今天检查、3天内处理、本周持续监测、需要联系植保部门的情况”组织，要求简明、可执行并包含安全提醒。`,
  }
  return <div className="xiaowan-workbench">
    <aside className="xiaowan-companion panel">
      <div className="companion-heading"><span><i /> 小皖在线</span><strong>有农事问题，直接跟我说</strong><p>描述作物、症状和发生范围，我会把建议说清楚、列明白。</p></div>
      <div className="mascot-stage"><i className="mascot-orbit one" /><i className="mascot-orbit two" /><img src="/assets/xiaowan-mascot.png" alt="小皖农业智能助手" /><div className="mascot-speech">你好呀，我是小皖<br />今天田里怎么样？</div></div>
      <div className="context-picker">
        <div className="context-title"><MapPinned size={15} /><span><strong>当前农情</strong><small>选好后直接提问</small></span></div>
        <label><span>所在地区</span><select value={city} onChange={(e) => onCity(e.target.value)}>{cities.map((item) => <option key={item.city}>{item.city}</option>)}</select></label>
        <label><span>种植作物</span><select value={crop} onChange={(e) => onCrop(e.target.value)}>{Object.keys(cropPlans).map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>当前阶段</span><select value={stage} onChange={(e) => onStage(e.target.value)}>{cropPlans[crop].stages.map((item) => <option key={item}>{item}</option>)}</select></label>
      </div>
      <div className="xiaowan-capabilities">
        <button disabled={loading} onClick={() => onSubmit(capabilityPrompts.symptoms)} title="让 Dify 小皖开始症状排查"><Stethoscope /><strong>看症状</strong><small>分步排查</small></button>
        <button disabled={loading} onClick={() => onSubmit(capabilityPrompts.risk)} title="让 Dify 小皖开始风险研判"><Activity /><strong>判风险</strong><small>综合分级</small></button>
        <button disabled={loading} onClick={() => onSubmit(capabilityPrompts.checklist)} title="让 Dify 小皖生成田间行动清单"><ShieldCheck /><strong>给清单</strong><small>7天行动</small></button>
      </div>
    </aside>

    <section className="xiaowan-chat panel">
      <header className="xiaowan-chat-head"><div><span>小皖农事对话</span><h2>把田里的情况告诉我吧</h2></div><div className="chat-context"><span>{city}</span><span>{crop}</span><span>{stage}</span></div></header>
      <div className="chat-stream">
        {messages.map((message, index) => <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
          <div className={`message-avatar ${message.role === 'assistant' ? 'xiaowan-avatar' : ''}`}>{message.role === 'assistant' ? <img src="/assets/xiaowan-mascot.png" alt="" /> : '我'}</div>
          <div><small>{message.role === 'assistant' ? (message.meta ?? '小皖') : '我'}</small>{message.imageUrl && <img className="message-image" src={message.imageUrl} alt="用户上传的田间图片" />}<p>{message.text}</p>{message.role === 'assistant' && <button className="read-answer" onClick={() => speak(message.text)} title="朗读这条回答"><Volume2 /> 朗读</button>}</div>
        </div>)}
        {loading && <div className="message assistant"><div className="message-avatar xiaowan-avatar"><img src="/assets/xiaowan-mascot.png" alt="" /></div><div><small>小皖正在研判</small><p className="typing"><i /><i /><i /></p></div></div>}
        <div ref={bottomRef} />
      </div>
      <div className="conversation-dock">
        <div className="quick-prompts"><span>可以这样问</span>{presets.map((item) => <button key={item} onClick={() => sendMessage(item)}>{item}</button>)}</div>
        {image && <div className="image-preview"><img src={image.dataUrl} alt="待诊断田间图片" /><span><strong>{image.name}</strong><small>将由千问视觉模型分析</small></span><button onClick={() => setImage(null)} aria-label="移除图片"><X /></button></div>}
        {imageError && <div className="image-error">{imageError}</div>}
        <form className="composer" onSubmit={(event) => { event.preventDefault(); sendMessage() }}>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => void chooseImage(event.target.files?.[0])} />
          <button type="button" className="attach" aria-label="上传田间图片" title="上传田间图片" onClick={() => fileRef.current?.click()}><ImagePlus size={19} /></button>
          <button type="button" className={`voice ${listening ? 'listening' : ''}`} aria-label="语音输入" title={speechSupported ? '语音输入' : '当前浏览器不支持语音识别'} disabled={!speechSupported} onClick={toggleSpeech}>{listening ? <MicOff size={18} /> : <Mic size={18} />}</button>
          <textarea value={question} onChange={(e) => onQuestion(e.target.value)} placeholder={`例如：我在${city}种的${crop}，可以打字、说话或上传照片……`} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }} />
          <button className="send" disabled={(!question.trim() && !image) || loading}><Send size={18} /><span>发送</span></button>
        </form>
        <small className="chat-disclaimer"><ShieldCheck /> 小皖提供辅助研判，具体用药请遵循农药登记标签和当地植保部门指导。</small>
      </div>
    </section>
  </div>
}

function FloatingXiaowan({ crop, stage, city, messages, loading, onSubmit, onOpenWorkbench }: { crop: string; stage: string; city: string; messages: ChatMessage[]; loading: boolean; onSubmit: (message: string) => void; onOpenWorkbench: () => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const streamRef = useRef<HTMLDivElement>(null)
  const { supported, listening, toggle } = useSpeechInput((text) => setDraft((current) => `${current}${current ? ' ' : ''}${text}`))
  const recentMessages = messages.slice(-4)
  const latestAnswer = [...messages].reverse().find((message) => message.role === 'assistant')?.text ?? ''

  useEffect(() => {
    if (open) streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading, open])

  const send = () => {
    const message = draft.trim()
    if (!message || loading) return
    onSubmit(message)
    setDraft('')
  }

  return <div className={`floating-xiaowan ${open ? 'open' : ''}`}>
    {open && <section className="floating-chat" aria-label="小皖快捷对话">
      <header><div className="floating-avatar"><img src="/assets/xiaowan-mascot.png" alt="" /><i /></div><div><strong>小皖</strong><span>全站农事助手 · 在线</span></div><button onClick={() => setOpen(false)} aria-label="收起小皖"><X /></button></header>
      <div className="floating-context"><span>{city}</span><span>{crop}</span><span>{stage}</span><button onClick={onOpenWorkbench}>进入诊断中心 <ChevronRight /></button></div>
      <div className="floating-stream" ref={streamRef}>
        {recentMessages.map((message, index) => <div className={message.role} key={`${message.role}-${index}-${message.text.slice(0, 12)}`}><small>{message.role === 'assistant' ? '小皖' : '我'}</small>{message.imageUrl && <img src={message.imageUrl} alt="田间图片" />}<p>{message.text}</p></div>)}
        {loading && <div className="assistant"><small>小皖正在研判</small><p className="typing"><i /><i /><i /></p></div>}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); send() }}><button type="button" className={listening ? 'listening' : ''} onClick={toggle} disabled={!supported} title={supported ? '按下说话' : '当前浏览器不支持语音识别'}>{listening ? <MicOff /> : <Mic />}</button><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="随时问小皖…" /><button className="floating-send" disabled={!draft.trim() || loading}><Send /></button></form>
      <footer><button onClick={() => speak(latestAnswer)} disabled={!latestAnswer}><Volume2 />朗读最近回答</button><span>辅助研判，不替代现场植保意见</span></footer>
    </section>}
    {!open && <div className="floating-tip">有问题，随时问小皖</div>}
    <button className="floating-mascot" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-label={open ? '收起小皖' : '打开小皖快捷对话'}><span className="floating-ring" /><img src="/assets/xiaowan-mascot.png" alt="小皖" /><i /></button>
  </div>
}

function SettingsPage({ settings, weather, weatherLoading, unreadAlertCount, onSettings, onLocate }: {
  settings: AppSettings
  weather: WeatherInfo
  weatherLoading: boolean
  unreadAlertCount: number
  onSettings: React.Dispatch<React.SetStateAction<AppSettings>>
  onLocate: () => void
}) {
  const weatherSource = weather.source === 'location' ? '浏览器定位' : weather.source === 'manual' ? '手选城市' : '定位回退'
  return <div className="settings-page">
    <section className="page-intro settings-intro"><div><span className="eyebrow"><Settings2 size={15} /> 个人偏好保存在当前浏览器</span><h2>让系统按你的所在地与使用习惯工作</h2><p>天气优先使用浏览器定位；数据刷新频率、手选城市等设置会自动保存。</p></div><div className="intro-stamp"><Settings2 /><span>设置中心</span></div></section>

    <section className="settings-grid">
      <article className="settings-card weather-settings">
        <div className="settings-card-head"><i><CloudSun /></i><div><strong>所在地与实时天气</strong><span>气象数据由 Open-Meteo 获取</span></div></div>
        <div className="weather-preview"><div><small>{weatherSource}</small><strong>{weather.city} {weather.temperature === null ? '--' : weather.temperature}°C</strong><span>{weather.condition} · {weather.wind}</span></div><CloudSun /></div>
        {weather.error && <p className="setting-warning">{weather.error}</p>}
        <div className="segmented-setting"><button className={settings.weatherMode === 'auto' ? 'active' : ''} onClick={onLocate}><LocateFixed />自动定位</button><button className={settings.weatherMode === 'manual' ? 'active' : ''} onClick={() => onSettings((current) => ({ ...current, weatherMode: 'manual' }))}><MapPinned />手选城市</button></div>
        <label className="setting-field"><span>定位失败时使用手动切换</span><select value={settings.manualCity} onChange={(event) => onSettings((current) => ({ ...current, manualCity: event.target.value, weatherMode: 'manual' }))}>{anhuiCityLocations.map((item) => <option key={item.name}>{item.name}</option>)}</select></label>
        <button className="setting-action" onClick={onLocate} disabled={weatherLoading}><RefreshCw className={weatherLoading ? 'spinning' : ''} />{weatherLoading ? '正在定位并更新…' : '重新定位并更新天气'}</button>
      </article>

      <article className="settings-card">
        <div className="settings-card-head"><i><RefreshCw /></i><div><strong>数据同步频率</strong><span>统计、预警和未读数量自动刷新</span></div></div>
        <label className="setting-field"><span>自动刷新间隔</span><select value={settings.refreshSeconds} onChange={(event) => onSettings((current) => ({ ...current, refreshSeconds: Number(event.target.value) }))}><option value={5}>5 秒</option><option value={10}>10 秒</option><option value={30}>30 秒</option><option value={60}>60 秒</option></select></label>
        <div className="setting-status"><span className="online" /><div><strong>实时同步已开启</strong><small>数据库新增预警后，红标会在下一次刷新时变化。</small></div></div>
      </article>

      <article className="settings-card">
        <div className="settings-card-head"><i><BellRing /></i><div><strong>预警已读同步</strong><span>按当前登录账户分别记录</span></div></div>
        <div className="setting-metric"><strong>{unreadAlertCount}</strong><span>条未读预警</span></div>
        <p className="setting-note">预警信息是信号，主动预防是良方</p>
      </article>

      <article className="settings-card">
        <div className="settings-card-head"><i><Database /></i><div><strong>系统连接</strong><span>前后端与资源状态</span></div></div>
        <div className="connection-list"><span><i className={isSupabaseConfigured ? 'ok' : 'off'} />Supabase 数据库<b>{isSupabaseConfigured ? '已配置' : '未配置'}</b></span><span><i className="ok" />天气服务<b>自动更新</b></span><span><i className="ok" />Logo 资源路径<b>/assets/ppd-mid-logo.png</b></span></div>
      </article>
    </section>
  </div>
}

function AlertsPage({ alerts, stats }: { alerts: AlertItem[]; stats: DashboardStats }) {
  const [filter, setFilter] = useState<'all' | AlertItem['level']>('all')
  const visible = useMemo(() => filter === 'all' ? alerts : alerts.filter((item) => item.level === filter), [alerts, filter])
  return <div className="alerts-page">
    <section className="page-intro alert-intro"><div><span className="eyebrow"><BellRing size={15} /> 省 · 市 · 田三级风险联动</span><h2>安徽省病虫害监测预警</h2><p>集中呈现重点作物、重点区域与关键窗口风险，支持后续接入植保监测和气象数据源。</p></div><div className="alert-score"><small>全省风险指数</small><strong>{stats.overall_risk}</strong><span>{stats.risk_label} · 趋势下降</span></div></section>
    <div className="filter-row"><div>{([['all', '全部预警'], ['high', '高风险'], ['medium', '中风险'], ['low', '关注']] as const).map(([value, label]) => <button className={filter === value ? 'active' : ''} onClick={() => setFilter(value)} key={value}>{label}</button>)}</div><label><Search size={16} /><input placeholder="搜索作物、区域或病虫害" /></label></div>
    <section className="alerts-list-full">{visible.map((item) => <AlertCard item={item} key={item.id} />)}</section>
  </div>
}

function HistoryPage({ history, loading, onOpen }: { history: DiagnosisRecord[]; loading: boolean; onOpen: (record: DiagnosisRecord) => void }) {
  return <div className="history-page">
    <section className="page-intro history-intro"><div><span className="eyebrow"><History size={15} /> Web 与未来移动端同步</span><h2>你的智能诊断记录</h2><p>诊断记录按账户保存在 Supabase，重新登录或更换设备后仍可继续查看。</p></div><div className="intro-stamp"><strong>{history.length}</strong><span>已保存</span></div></section>
    {loading ? <div className="history-empty"><i className="history-loader" /><strong>正在加载诊断记录…</strong></div> : history.length === 0 ? <div className="history-empty"><History size={34} /><strong>还没有诊断记录</strong><p>前往智能诊断中心提出第一个田间问题，回答会自动保存在这里。</p></div> : <section className="history-list">{history.map((record) => <article key={record.id}>
      <div className="history-date"><strong>{new Date(record.created_at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</strong><span>{new Date(record.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span></div>
      <div className="history-body"><div><span>{record.crop}</span><span>{record.growth_stage}</span></div><h3>{record.question}</h3><p>{record.answer}</p></div>
      <button onClick={() => onOpen(record)}>继续查看 <ChevronRight size={15} /></button>
    </article>)}</section>}
  </div>
}

function AuthScreen({ onLogin }: { onLogin: (user: AppUser) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('使用账号登录后进入系统')
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)

  const switchMode = (next: 'login' | 'signup') => {
    setMode(next)
    setError(false)
    setMessage(next === 'signup' ? '填写用户名和密码即可注册' : '请输入用户名和密码登录')
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const normalized = username.trim().toLowerCase()
    if (!/^[\u4e00-\u9fa5a-z0-9_]{2,16}$/i.test(normalized)) {
      setError(true); setMessage('用户名须为 2–16 位中文、英文、数字或下划线。'); return
    }
    if (password.length < 6) {
      setError(true); setMessage('密码至少需要 6 位。'); return
    }
    if (!supabase) {
      setError(true); setMessage('Supabase 尚未配置，请检查 frontend/.env.local。'); return
    }
    setLoading(true)
    setError(false)
    try {
      if (mode === 'signup') {
        const { error: rpcError } = await supabase.rpc('register_app_user', { p_username: normalized, p_password: password })
        if (rpcError) throw rpcError
        setPassword('')
        setMode('login')
        setMessage('注册成功，请使用用户名和密码登录。')
      } else {
        const { data, error: rpcError } = await supabase.rpc('login_app_user', { p_username: normalized, p_password: password })
        if (rpcError) throw rpcError
        const result = data as { id: number; username: string; session_token: string }
        onLogin({ id: result.id, username: result.username, sessionToken: result.session_token })
      }
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : String(caught)
      setError(true)
      setMessage(text || '操作失败，请稍后再试。')
    } finally {
      setLoading(false)
    }
  }

  return <main className="auth-screen">
    <section className="auth-showcase">
      <div className="auth-glow one" /><div className="auth-glow two" />
      <div className="auth-brand"><BrandLogo /><div><strong>PPD-MID</strong><span>皖农智诊</span></div></div>
      <div className="auth-copy">
        <span className="eyebrow"><Sparkles size={15} /> ANHUI AGRI INTELLIGENCE</span>
        <h1>让数据扎根田野，<br /><em>让防控走在风险之前。</em></h1>
        <p>面向安徽省 16 地市的农业病虫害智能决策平台。一个账户，即可在 Web 与移动端同步使用。</p>
      </div>
      <div className="auth-feature-grid">
        <article><MapPinned /><strong>16 地市</strong><span>区域风险联动</span></article>
        <article><Sprout /><strong>5 类作物</strong><span>生育期预防</span></article>
        <article><Bot /><strong>Dify 对话</strong><span>辅助诊断研判</span></article>
      </div>
      <div className="field-lines"><i /><i /><i /><i /><i /></div>
      <p className="auth-caption">江淮沃野 · 从一粒种子到一季丰收</p>
    </section>
    <section className="auth-side">
      <div className="auth-box">
        <div className="auth-box-brand"><i><Sprout size={18} /></i><div><strong>农事智能服务入口</strong><span>安徽农防 · 用户中心</span></div></div>
        <h2>{mode === 'login' ? '欢迎回来' : '创建你的账户'}</h2>
        <p>{mode === 'login' ? '登录后继续查看区域农情与预防方案。' : '注册后可在网页端和 App 使用同一账号。'}</p>
        <div className="auth-tabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>登录</button><button className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')}>注册</button></div>
        <form onSubmit={(event) => void submit(event)}>
          <label><span><UserRound size={14} />用户名</span><input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="2–16 位中文、字母、数字或下划线" autoComplete="username" /></label>
          <label><span><LockKeyhole size={14} />密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 6 位密码" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
          <div className={`auth-message ${error ? 'error' : ''}`}>{message}</div>
          <button className="auth-submit" disabled={loading}><LogIn size={17} />{loading ? '正在处理…' : mode === 'login' ? '登录并进入系统' : '注册账号'}</button>
        </form>
        <div className="auth-points"><span><ShieldCheck />密码哈希保存</span><span><KeyRound />30 天安全会话</span></div>
        <small className="auth-footnote">用户名全平台唯一，我们不会在浏览器或数据库中保存明文密码。</small>
      </div>
    </section>
  </main>
}

function PanelHeader({ icon, title, note }: { icon: React.ReactNode; title: string; note: string }) {
  return <div className="panel-header"><div><i>{icon}</i><span><strong>{title}</strong><small>{note}</small></span></div><button aria-label="更多"><ChevronRight size={16} /></button></div>
}

function Stat({ icon, label, value, suffix, trend }: { icon: React.ReactNode; label: string; value: string; suffix: string; trend: string }) {
  return <article className="stat"><i>{icon}</i><div><span>{label}</span><strong>{value}<small>{suffix}</small></strong><em>{trend}</em></div></article>
}

function AlertCard({ item, compact = false }: { item: AlertItem; compact?: boolean }) {
  return <article className={`alert-card ${compact ? 'compact' : ''}`}><div className={`alert-level ${item.level}`}><i />{levelText[item.level]}</div><div className="alert-content"><small>{item.date} · {item.region}</small><h3>{item.title}</h3>{!compact && <p>{item.summary}</p>}<span>{item.crop}</span></div><button><ChevronRight size={17} /></button></article>
}

export default App
