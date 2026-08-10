export type RiskLevel = 'high' | 'medium' | 'low'
export type CityRisk = { city: string; zone: string; score: number; level: RiskLevel; focus: string }
export type AlertItem = { id: number | string; level: RiskLevel; date: string; title: string; summary: string; crop: string; region: string }
export type CropPlan = { code: string; icon: string; season: string; stages: string[] }
export type CropPlanMap = Record<string, CropPlan>
export type DashboardStats = {
  overall_risk: number
  risk_label: string
  today_consults: number
  crop_count: number
  city_count: number
  login_count: number
  consult_date: string
}

export const cities: CityRisk[] = [
  { city: '阜阳', zone: '淮北平原', score: 82, level: 'high', focus: '小麦赤霉病' },
  { city: '亳州', zone: '淮北平原', score: 76, level: 'high', focus: '小麦纹枯病' },
  { city: '六安', zone: '江淮丘陵', score: 71, level: 'high', focus: '水稻稻瘟病' },
  { city: '滁州', zone: '江淮丘陵', score: 67, level: 'medium', focus: '稻纵卷叶螟' },
  { city: '安庆', zone: '沿江平原', score: 64, level: 'medium', focus: '水稻纹枯病' },
  { city: '宿州', zone: '淮北平原', score: 61, level: 'medium', focus: '玉米螟' },
  { city: '蚌埠', zone: '淮河沿岸', score: 58, level: 'medium', focus: '麦蚜' },
  { city: '淮南', zone: '淮河沿岸', score: 55, level: 'medium', focus: '水稻二化螟' },
  { city: '合肥', zone: '江淮丘陵', score: 49, level: 'medium', focus: '水稻稻曲病' },
  { city: '芜湖', zone: '沿江平原', score: 46, level: 'medium', focus: '稻飞虱' },
  { city: '马鞍山', zone: '沿江平原', score: 42, level: 'low', focus: '油菜菌核病' },
  { city: '宣城', zone: '皖南山区', score: 39, level: 'low', focus: '水稻稻瘟病' },
  { city: '池州', zone: '皖南山区', score: 36, level: 'low', focus: '茶小绿叶蝉' },
  { city: '铜陵', zone: '沿江平原', score: 34, level: 'low', focus: '水稻纹枯病' },
  { city: '淮北', zone: '淮北平原', score: 31, level: 'low', focus: '玉米南方锈病' },
  { city: '黄山', zone: '皖南山区', score: 27, level: 'low', focus: '茶炭疽病' },
]

export const alerts: AlertItem[] = [
  { id: 1, level: 'high', date: '08月02日', title: '沿淮及淮北小麦病虫害监测提示', summary: '近期降水与田间湿度条件利于赤霉病、纹枯病扩展，请加强田间调查并关注关键防控窗口。', crop: '小麦', region: '阜阳 · 亳州 · 宿州' },
  { id: 2, level: 'medium', date: '08月01日', title: '江淮中部水稻“两迁”害虫风险提示', summary: '水稻进入分蘖至拔节期，建议结合灯诱、田间虫量和天气过程开展动态监测。', crop: '水稻', region: '合肥 · 滁州 · 六安' },
  { id: 3, level: 'medium', date: '07月31日', title: '沿江稻区纹枯病扩展风险提示', summary: '高温高湿、群体郁闭田块风险较高，及时排水露田，避免偏施氮肥。', crop: '水稻', region: '芜湖 · 安庆 · 铜陵' },
]

export const cropPlans: CropPlanMap = {
  水稻: { code: 'rice', icon: '🌾', season: '皖中及沿江主栽', stages: ['育秧期', '分蘖期', '拔节孕穗期', '抽穗扬花期', '灌浆成熟期'] },
  小麦: { code: 'wheat', icon: '🌿', season: '沿淮及淮北主栽', stages: ['播种出苗期', '越冬分蘖期', '返青拔节期', '抽穗扬花期', '灌浆成熟期'] },
  玉米: { code: 'corn', icon: '🌽', season: '淮北夏玉米区', stages: ['播种出苗期', '苗期', '拔节期', '大喇叭口期', '抽雄灌浆期'] },
  大豆: { code: 'soybean', icon: '🫘', season: '皖北及沿淮产区', stages: ['播种出苗期', '苗期', '分枝期', '开花结荚期', '鼓粒成熟期'] },
  油菜: { code: 'rapeseed', icon: '🌼', season: '江淮及沿江产区', stages: ['播种育苗期', '越冬期', '蕾薹期', '开花期', '角果成熟期'] },
}

export const preventionTips: Record<string, string[]> = {
  水稻: ['查苗情与田间水层，保持浅水勤灌', '重点监测稻瘟病、纹枯病及“两迁”害虫', '依据田间调查和登记标签确定防控窗口'],
  小麦: ['关注赤霉病气象风险，落实“见花打药”原则', '返青拔节期调查纹枯病、茎基腐病与麦蜘蛛', '避免盲目混配，严格执行安全间隔期'],
  玉米: ['大喇叭口期重点调查玉米螟与草地贪夜蛾', '雨后及时排涝，关注南方锈病和穗腐病', '优先采用绿色防控和统防统治'],
  大豆: ['花荚期监测食心虫、豆荚螟和蚜虫', '高温高湿年份关注大豆锈病与霜霉病', '保护天敌，轮换不同作用机制药剂'],
  油菜: ['开花期重点预防菌核病，清沟理墒', '监测蚜虫与霜霉病，及时清除病残株', '花期施药注意保护授粉昆虫'],
}

export const dashboardStats: DashboardStats = {
  overall_risk: 62,
  risk_label: '中风险',
  today_consults: 128,
  crop_count: 5,
  city_count: 16,
  login_count: 0,
  consult_date: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10),
}
