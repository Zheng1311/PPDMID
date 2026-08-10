export type WeatherInfo = {
  city: string
  temperature: number | null
  condition: string
  wind: string
  updatedAt: string
  source: 'location' | 'manual' | 'fallback'
  error?: string
}

export type AnhuiCityLocation = { name: string; latitude: number; longitude: number }

export const anhuiCityLocations: AnhuiCityLocation[] = [
  { name: '合肥', latitude: 31.8206, longitude: 117.2272 },
  { name: '芜湖', latitude: 31.3525, longitude: 118.4331 },
  { name: '蚌埠', latitude: 32.9163, longitude: 117.3893 },
  { name: '淮南', latitude: 32.6255, longitude: 116.9998 },
  { name: '马鞍山', latitude: 31.6705, longitude: 118.5068 },
  { name: '淮北', latitude: 33.9558, longitude: 116.7983 },
  { name: '铜陵', latitude: 30.9455, longitude: 117.8115 },
  { name: '安庆', latitude: 30.5319, longitude: 117.1153 },
  { name: '黄山', latitude: 29.7147, longitude: 118.3376 },
  { name: '阜阳', latitude: 32.8901, longitude: 115.8142 },
  { name: '宿州', latitude: 33.6464, longitude: 116.9642 },
  { name: '滁州', latitude: 32.3018, longitude: 118.3171 },
  { name: '六安', latitude: 31.7337, longitude: 116.5077 },
  { name: '宣城', latitude: 30.9408, longitude: 118.7588 },
  { name: '池州', latitude: 30.6648, longitude: 117.4916 },
  { name: '亳州', latitude: 33.8693, longitude: 115.7786 },
]

const weatherText: Record<number, string> = {
  0: '晴', 1: '大部晴朗', 2: '多云', 3: '阴', 45: '有雾', 48: '雾凇',
  51: '小毛毛雨', 53: '毛毛雨', 55: '较强毛毛雨', 56: '冻毛毛雨', 57: '较强冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '较强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '米雪',
  80: '小阵雨', 81: '阵雨', 82: '强阵雨', 85: '小阵雪', 86: '强阵雪',
  95: '雷雨', 96: '雷雨伴小冰雹', 99: '雷雨伴冰雹',
}

const windDirection = (degrees: number) => {
  const directions = ['北风', '东北风', '东风', '东南风', '南风', '西南风', '西风', '西北风']
  return directions[Math.round(degrees / 45) % 8]
}

const distanceSquared = (latitude: number, longitude: number, city: AnhuiCityLocation) => {
  const latitudeDelta = latitude - city.latitude
  const longitudeDelta = (longitude - city.longitude) * Math.cos(latitude * Math.PI / 180)
  return latitudeDelta * latitudeDelta + longitudeDelta * longitudeDelta
}

export const nearestAnhuiCity = (latitude: number, longitude: number) =>
  [...anhuiCityLocations].sort((a, b) => distanceSquared(latitude, longitude, a) - distanceSquared(latitude, longitude, b))[0]

export async function fetchCurrentWeather(
  latitude: number,
  longitude: number,
  city: string,
  source: WeatherInfo['source'],
): Promise<WeatherInfo> {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(latitude))
  url.searchParams.set('longitude', String(longitude))
  url.searchParams.set('current', 'temperature_2m,weather_code,wind_speed_10m,wind_direction_10m')
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('forecast_days', '1')
  const response = await fetch(url)
  if (!response.ok) throw new Error(`气象服务请求失败（${response.status}）`)
  const data = await response.json() as {
    current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number; wind_direction_10m?: number; time?: string }
  }
  if (!data.current || typeof data.current.temperature_2m !== 'number') throw new Error('气象服务没有返回当前天气')
  const code = data.current.weather_code ?? -1
  const speed = Math.round(data.current.wind_speed_10m ?? 0)
  return {
    city,
    temperature: Math.round(data.current.temperature_2m),
    condition: weatherText[code] ?? '天气更新中',
    wind: `${windDirection(data.current.wind_direction_10m ?? 0)} ${speed} km/h`,
    updatedAt: data.current.time ?? new Date().toISOString(),
    source,
  }
}
