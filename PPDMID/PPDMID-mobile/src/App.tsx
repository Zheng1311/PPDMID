import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Bell, Camera, ChevronRight, CircleUserRound, CloudSun, House, Leaf, LoaderCircle, MapPin, MessageCircle, Mic, Send, ShieldAlert, Sparkles, Sprout, UserRound } from 'lucide-react'
import { askAgent } from './lib/api'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { cityRisks, crops, getStageTips } from './data'

type Page = 'home' | 'diagnose' | 'prevent' | 'profile'
type AppUser = { id: number; username: string; sessionToken: string }
type RecordItem = { id: string | number; conversation_id?: string; crop: string; growth_stage: string; question: string; answer: string; created_at: string }
type ChatMessage = { role: 'assistant' | 'user'; text: string; image?: string }
const USER_STORAGE_KEY = 'ah-ppdmid-user'
const cityCoordinates: Record<string, [number, number]> = {
  合肥: [31.82, 117.23], 芜湖: [31.35, 118.43], 蚌埠: [32.92, 117.39], 淮南: [32.63, 117.02],
  马鞍山: [31.67, 118.51], 淮北: [33.95, 116.79], 铜陵: [30.95, 117.81], 安庆: [30.54, 117.06],
  黄山: [29.72, 118.34], 滁州: [32.30, 118.32], 阜阳: [32.89, 115.81], 宿州: [33.65, 116.96],
  六安: [31.73, 116.52], 亳州: [33.87, 115.78], 池州: [30.66, 117.49], 宣城: [30.95, 118.76],
}

function getStoredUser(): AppUser | null {
  try { return JSON.parse(localStorage.getItem(USER_STORAGE_KEY) || 'null') as AppUser | null } catch { return null }
}
function riskText(score: number) { return score >= 70 ? '高风险' : score >= 40 ? '中风险' : '低风险' }
function riskClass(score: number) { return score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low' }
function formatDate(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [city, setCity] = useState('合肥')
  const [crop, setCrop] = useState('水稻')
  const [stage, setStage] = useState(crops.水稻.stages[1])
  const [user, setUser] = useState<AppUser | null>(getStoredUser)
  const [history, setHistory] = useState<RecordItem[]>([])
  const [unread, setUnread] = useState(0)
  const [notice, setNotice] = useState('')
  const [resumeRecords, setResumeRecords] = useState<RecordItem[]>([])
  const [overallRisk, setOverallRisk] = useState({ score: 62, label: '中风险' })
  const activeRisk = useMemo(() => cityRisks.find((item) => item.city === city) || { city, score: 49, level: 'medium' as const, focus: '关注田间病虫监测' }, [city])

  const updateUser = (next: AppUser | null) => {
    setUser(next)
    if (next) localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(next))
    else localStorage.removeItem(USER_STORAGE_KEY)
  }
  const locate = () => {
    if (!navigator.geolocation) { setNotice('当前设备不支持定位，请手动选择所在地市。'); return }
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const selected = Object.entries(cityCoordinates).reduce((nearest, [name, point]) => {
        const distance = (point[0] - coords.latitude) ** 2 + (point[1] - coords.longitude) ** 2
        return distance < nearest.distance ? { name, distance } : nearest
      }, { name: '合肥', distance: Number.POSITIVE_INFINITY }).name
      setCity(selected); setNotice(`已根据当前位置切换到${selected}市，可手动调整。`)
    }, () => setNotice('定位未成功，请手动选择所在地市。'), { timeout: 8000 })
  }
  const loadHistory = async () => {
    if (!supabase || !user?.sessionToken) return
    const { data, error } = await supabase.rpc('get_diagnosis_history', { p_session_token: user.sessionToken, p_limit: 30 })
    if (!error) setHistory((data || []) as RecordItem[])
  }
  useEffect(() => { void loadHistory() }, [user?.sessionToken])
  useEffect(() => {
    if (!supabase) return
    const client = supabase
    const loadOverallRisk = async () => {
      const { data } = await client.from('dashboard_stats').select('overall_risk,risk_label').eq('id', 1).maybeSingle()
      if (data?.overall_risk != null) setOverallRisk({ score: Number(data.overall_risk), label: data.risk_label || riskText(Number(data.overall_risk)) })
    }
    void loadOverallRisk()
  }, [])
  useEffect(() => { if (page === 'profile') setUnread(0) }, [page])
  const chooseCrop = (next: string) => { setCrop(next); setStage(crops[next].stages[0]) }
  const saveRecord = async (question: string, answer: string, sessionId: string) => {
    if (!supabase || !user?.sessionToken) return
    const { data } = await supabase.rpc('save_diagnosis_history', { p_session_token: user.sessionToken, p_conversation_id: sessionId, p_crop: crop, p_growth_stage: stage, p_question: question, p_answer: answer })
    if (data) {
      const record: RecordItem = { id: data as string | number, conversation_id: sessionId, crop, growth_stage: stage, question, answer, created_at: new Date().toISOString() }
      setHistory((current) => [record, ...current.filter((item) => String(item.id) !== String(record.id))].slice(0, 30))
      setUnread((count) => count + 1)
      void loadHistory()
    }
  }
  const openHistoryRecord = (record: RecordItem) => {
    const records = record.conversation_id
      ? history.filter((item) => item.conversation_id === record.conversation_id).sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
      : [record]
    setResumeRecords(records)
    setPage('diagnose')
  }

  return <main className="phone-shell">
    <header className="topbar"><div className="brand"><img src="/assets/ppd-mid-logo.png" /><span>皖农智诊</span></div><button className="locate" onClick={locate}><MapPin size={15} />{city}</button><button className="icon-button" onClick={() => setPage('profile')} aria-label="个人中心"><Bell size={20} />{unread > 0 && <i />}</button></header>
    {notice && <button className="notice" onClick={() => setNotice('')}>{notice}</button>}
    <section className="content">
      <div hidden={page !== 'home'}><Home city={city} cityRisk={activeRisk} overallRisk={overallRisk} onDiagnose={() => setPage('diagnose')} onPrevent={() => setPage('prevent')} /></div>
      <div hidden={page !== 'diagnose'}><Diagnose city={city} crop={crop} stage={stage} chooseCrop={chooseCrop} setStage={setStage} onSave={saveRecord} resumeRecords={resumeRecords} onResumeLoaded={() => setResumeRecords([])} /></div>
      <div hidden={page !== 'prevent'}><Prevent city={city} crop={crop} stage={stage} chooseCrop={chooseCrop} setStage={setStage} onSave={saveRecord} /></div>
      <div hidden={page !== 'profile'}><Profile user={user} updateUser={updateUser} history={history} configured={isSupabaseConfigured} onOpenRecord={openHistoryRecord} /></div>
    </section>
    <nav className="bottom-nav">
      <NavItem active={page === 'home'} icon={<House />} text="首页" onClick={() => setPage('home')} />
      <NavItem active={page === 'diagnose'} icon={<MessageCircle />} text="智能诊断" onClick={() => setPage('diagnose')} />
      <NavItem active={page === 'prevent'} icon={<Sprout />} text="生育期预防" onClick={() => setPage('prevent')} />
      <NavItem active={page === 'profile'} icon={<UserRound />} text="我的" onClick={() => setPage('profile')} badge={unread} />
    </nav>
  </main>
}

function Home({ city, cityRisk, overallRisk, onDiagnose, onPrevent }: { city: string; cityRisk: { score: number; focus: string }; overallRisk: { score: number; label: string }; onDiagnose: () => void; onPrevent: () => void }) {
  return <>
    <section className="hero-card"><div><p>安徽 · {city}</p><h1>田间风险，一手掌握</h1><span><CloudSun size={15} /> 晴转多云 27℃ · 适宜巡田</span></div><img src="/assets/xiaowan-mascot.png" /></section>
    <section className="risk-card"><div><p>全省综合风险指数</p><strong>{overallRisk.score}</strong><em className={riskClass(overallRisk.score)}>{overallRisk.label}</em></div><div className="risk-circle"><span>{cityRisk.focus}</span><small>{city}当前重点</small></div></section>
    <div className="section-title"><h2>快捷服务</h2><span>为农户而设</span></div>
    <div className="quick-grid"><button onClick={onDiagnose}><span className="quick-icon green"><Camera /></span><b>拍照诊断</b><small>上传叶片或虫害照片</small></button><button onClick={onDiagnose}><span className="quick-icon orange"><MessageCircle /></span><b>在线问诊</b><small>小皖即时为您解答</small></button><button onClick={onPrevent}><span className="quick-icon blue"><Sprout /></span><b>生育期预防</b><small>生成阶段管理建议</small></button><button onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })}><span className="quick-icon red"><ShieldAlert /></span><b>预警中心</b><small>关注本地风险提醒</small></button></div>
    <div className="section-title"><h2>本地预警</h2><span>实时同步</span></div>
    <article className="alert-card"><span className={`risk-dot ${riskClass(cityRisk.score)}`} /><div><b>{city}市病虫害监测提示</b><p>当前重点关注：{cityRisk.focus}。请结合田间长势、近期降雨和虫情开展巡查。</p></div></article>
  </>
}

function getDiagnosticPrompts(city: string, crop: string, stage: string) {
  const focus: Record<string, string> = {
    水稻: '稻瘟病、纹枯病、稻飞虱和螟虫', 小麦: '赤霉病、纹枯病和蚜虫', 玉米: '玉米螟、叶斑病和锈病',
    大豆: '根腐病、蚜虫、食心虫和叶斑病', 油菜: '菌核病、蚜虫和霜霉病',
  }
  const symptom: Record<string, string> = {
    水稻: '叶片褐色斑点、叶鞘病斑或心叶虫孔', 小麦: '叶片黄斑、茎基部褐变或穗部发白', 玉米: '心叶虫孔、叶片条斑或叶片黄化',
    大豆: '叶片斑点、叶片卷曲或根部褐变', 油菜: '茎秆病斑、叶片黄化或花瓣黏附',
  }
  return [
    { label: `${crop}${stage}查什么？`, prompt: `我在${city}种植${crop}，现在是${stage}，田间巡查时应重点查看哪些部位和症状？` },
    { label: `${stage}重点防什么？`, prompt: `安徽省${city}市${crop}正处于${stage}，近期应重点预防哪些病虫害（如${focus[crop]}）？请说明巡查和防控要点。` },
    { label: '出现症状怎么办？', prompt: `我在${city}种植的${crop}正处于${stage}，发现${symptom[crop]}，请帮助判断应先排查什么，并给出处理建议。` },
  ]
}

function Diagnose({ city, crop, stage, chooseCrop, setStage, onSave, resumeRecords, onResumeLoaded }: { city: string; crop: string; stage: string; chooseCrop: (crop: string) => void; setStage: (stage: string) => void; onSave: (q: string, a: string, s: string) => Promise<void>; resumeRecords: RecordItem[]; onResumeLoaded: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: 'assistant', text: `你好，我是小皖。请告诉我${city}的作物、生育期和症状；也可以拍照发来。` }])
  const [input, setInput] = useState('')
  const [image, setImage] = useState<string>()
  const [imageName, setImageName] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversation, setConversation] = useState('')
  const [listening, setListening] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const quickPrompts = getDiagnosticPrompts(city, crop, stage)
  useEffect(() => {
    if (!resumeRecords.length) return
    const latest = resumeRecords[resumeRecords.length - 1]
    chooseCrop(latest.crop)
    setStage(latest.growth_stage)
    setMessages(resumeRecords.flatMap((record) => [{ role: 'user' as const, text: record.question }, { role: 'assistant' as const, text: record.answer }]))
    setConversation(latest.conversation_id || '')
    setInput(''); setImage(undefined); setImageName('')
    onResumeLoaded()
  }, [resumeRecords])
  const send = async (preset?: string) => {
    const text = (preset || input).trim(); if (!text || loading) return
    const sentImage = image; setMessages((current) => [...current, { role: 'user', text, image: sentImage }]); setInput(''); setImage(undefined); setLoading(true)
    try { const result = await askAgent({ message: text, crop, growthStage: stage, city, sessionId: conversation, imageDataUrl: sentImage, imageName }); setConversation(result.sessionId); setMessages((current) => [...current, { role: 'assistant', text: result.answer }]); await onSave(text, result.answer, result.sessionId) }
    catch (error) { setMessages((current) => [...current, { role: 'assistant', text: error instanceof Error ? error.message : '暂时无法连接智能诊断服务，请稍后重试。' }]) }
    finally { setLoading(false) }
  }
  const readFile = (file?: File) => { if (!file) return; setImageName(file.name); const reader = new FileReader(); reader.onload = () => setImage(String(reader.result)); reader.readAsDataURL(file) }
  const toggleVoice = () => {
    if (listening) { recognitionRef.current?.stop(); return }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Recognition) { setMessages((current) => [...current, { role: 'assistant', text: '当前浏览器暂不支持语音输入，请使用手机 Chrome 或 Edge 后重试。' }]); return }
    const recognition = new Recognition()
    recognition.lang = 'zh-CN'; recognition.continuous = false; recognition.interimResults = true
    recognition.onresult = (event) => setInput(Array.from(event.results).map((result) => result[0].transcript).join(''))
    recognition.onerror = () => { setListening(false); setMessages((current) => [...current, { role: 'assistant', text: '语音识别未完成，请检查麦克风权限后再试。' }]) }
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition; setListening(true); recognition.start()
  }
  return <div className="diagnose-page"><section className="diagnose-head"><div><p>小皖智能诊断</p><h1>说症状，拍照片</h1></div><img src="/assets/xiaowan-mascot.png" /></section><Selectors crop={crop} stage={stage} chooseCrop={chooseCrop} setStage={setStage} />
    <div className="prompt-row">{quickPrompts.map((item) => <button key={item.label} onClick={() => void send(item.prompt)}>{item.label}</button>)}</div>
    <div className="messages">{messages.map((item, index) => <div key={index} className={`message ${item.role}`}><span>{item.role === 'assistant' ? '小皖' : '我'}</span>{item.image && <img src={item.image} />}<p>{item.text}</p></div>)}{loading && <div className="xiaowan-thinking" aria-label="小皖正在分析"><img src="/assets/xiaowan-mascot.png" /><div><b>小皖正在田间推演</b><span><i /><i /><i /></span></div></div>}</div>
    <div className="chat-input">{image && <div className="image-preview"><img src={image} /><button onClick={() => setImage(undefined)}>×</button></div>}<input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => readFile(event.target.files?.[0])} /><button className="attach" onClick={() => fileRef.current?.click()} aria-label="拍照或上传图片"><Camera size={20} /></button><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder={listening ? '正在聆听，请说话…' : '描述症状，或拍照上传…'} rows={1} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} /><button className={`voice ${listening ? 'listening' : ''}`} onClick={toggleVoice} aria-label={listening ? '停止语音输入' : '开始语音输入'}><Mic size={19} /></button><button className="send" onClick={() => void send()} disabled={loading || !input.trim()}><Send size={19} /></button></div>
  </div>
}

function Prevent({ city, crop, stage, chooseCrop, setStage, onSave }: { city: string; crop: string; stage: string; chooseCrop: (crop: string) => void; setStage: (stage: string) => void; onSave: (q: string, a: string, s: string) => Promise<void> }) {
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const stageTips = getStageTips(crop, stage)
  const run = async () => { const question = `请为安徽省${city}市${crop}${stage}生成生育期预防管理建议，包含巡查要点、风险和未来7—10天注意事项。`; setLoading(true); try { const result = await askAgent({ message: question, city, crop, growthStage: stage }); setAnswer(result.answer); await onSave(question, result.answer, result.sessionId) } catch (error) { setAnswer(error instanceof Error ? error.message : '生成失败，请稍后再试。') } finally { setLoading(false) } }
  return <><section className="prevent-hero"><Leaf /><p>科学管理，预防在前</p><h1>生育期预防</h1><span>结合地区、作物与阶段生成管理清单</span></section><Selectors crop={crop} stage={stage} chooseCrop={chooseCrop} setStage={setStage} /><section className="tips-card"><h2>{crops[crop].icon} {crop}{stage}巡田要点</h2>{stageTips.map((tip) => <p key={tip}>✓ {tip}</p>)}</section><button className="primary-action" onClick={() => void run()} disabled={loading}>{loading ? <><LoaderCircle className="spin" /> 正在生成…</> : <><Sparkles /> 让小皖生成防控清单</>}</button>{answer && <section className="answer-card"><b>小皖的管理建议</b><p>{answer}</p></section>}</>
}

function Selectors({ crop, stage, chooseCrop, setStage }: { crop: string; stage: string; chooseCrop: (value: string) => void; setStage: (value: string) => void }) { return <div className="selectors"><label>作物<select value={crop} onChange={(event) => chooseCrop(event.target.value)}>{Object.keys(crops).map((item) => <option key={item}>{item}</option>)}</select></label><label>生育期<select value={stage} onChange={(event) => setStage(event.target.value)}>{crops[crop].stages.map((item) => <option key={item}>{item}</option>)}</select></label></div> }

function Profile({ user, updateUser, history, configured, onOpenRecord }: { user: AppUser | null; updateUser: (user: AppUser | null) => void; history: RecordItem[]; configured: boolean; onOpenRecord: (record: RecordItem) => void }) {
  const [signup, setSignup] = useState(false); const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [message, setMessage] = useState(''); const [loading, setLoading] = useState(false)
  const submit = async () => { if (!supabase) { setMessage('数据库尚未配置。'); return } if (!username.trim() || !password) { setMessage('请输入用户名和密码。'); return }; setLoading(true); try { if (signup) { const { error } = await supabase.rpc('register_app_user', { p_username: username.trim(), p_password: password }); if (error) throw error; setSignup(false); setMessage('注册成功，请登录。') } else { const { data, error } = await supabase.rpc('login_app_user', { p_username: username.trim(), p_password: password }); if (error) throw error; const result = data as { id: number; username: string; session_token: string }; updateUser({ id: result.id, username: result.username, sessionToken: result.session_token }); setMessage('') } } catch (error) { setMessage(error instanceof Error ? error.message : '操作失败，请稍后重试。') } finally { setLoading(false) } }
  const logout = async () => { if (supabase && user?.sessionToken) await supabase.rpc('logout_app_user', { p_session_token: user.sessionToken }); updateUser(null) }
  if (!user) return <div className="profile-page"><section className="login-hero"><CircleUserRound /><h1>{signup ? '创建账号' : '登录皖农智诊'}</h1><p>手机端与 Web 端共用同一账号和诊断记录</p></section><div className="login-card"><label>用户名<input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="请输入用户名" /></label><label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" /></label>{message && <p className="form-message">{message}</p>}<button className="primary-action" onClick={() => void submit()} disabled={loading}>{loading ? '处理中…' : signup ? '注册账号' : '登录'}</button><button className="switch-mode" onClick={() => { setSignup(!signup); setMessage('') }}>{signup ? '已有账号？去登录' : '没有账号？立即注册'}</button>{!configured && <small>请先在 .env.local 填写 Supabase 配置。</small>}</div></div>
  return <div className="profile-page"><section className="user-card"><CircleUserRound /><div><b>{user.username}</b><p>已登录 · 数据云端同步</p></div><button onClick={() => void logout()}>退出</button></section><div className="section-title"><h2>诊断记录</h2><span>{history.length} 条</span></div>{history.length ? <div className="history-list">{history.map((item) => <article className="history-record" key={item.id} onClick={() => onOpenRecord(item)}><span>{item.crop} · {item.growth_stage}</span><b>{item.question}</b><p>{item.answer}</p><small>{formatDate(item.created_at)}</small><ChevronRight className="history-open" size={18} /></article>)}</div> : <div className="empty-state"><MessageCircle /><p>还没有诊断记录</p><span>登录后进行问诊，记录将同步到 Web 端</span></div>}</div>
}

function NavItem({ active, icon, text, onClick, badge }: { active: boolean; icon: ReactNode; text: string; onClick: () => void; badge?: number }) { return <button className={active ? 'active' : ''} onClick={onClick}><span>{icon}{badge ? <i>{badge > 9 ? '9+' : badge}</i> : null}</span>{text}</button> }
