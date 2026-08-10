# PPD-MID 安徽省农业智能决策平台

这是原 `PPD-MID.html` 的第一阶段重构版本。项目已从单文件页面拆分为 React 网页端与 FastAPI 后端，并预留 LangGraph 多智能体、Skills 调用和 Supabase 数据层。

## 项目结构

```text
ah-ppdmid/
├─ frontend/              React 19 + TypeScript + Vite
│  ├─ src/                页面、地图、API 与 Supabase 客户端
│  └─ public/assets/      安徽省 16 地市 GeoJSON
├─ backend/               FastAPI + LangGraph
│  ├─ app/graph.py        多智能体工作流
│  └─ skills/*/SKILL.md   可发现、可调用的本地技能
└─ supabase/schema.sql    表结构与 RLS 策略
```

当前 LangGraph 流程：

```text
用户问题 → 调度智能体 ─┬→ 作物生育专家 ─────┐
                       ├→ 病虫诊断专家 ─────┤
                       ├→ 区域风险分析师 ───┼→ 综合研判智能体 → 安全审校 → 返回前端
                       └→ Skills 工具智能体 ─┘
```

未填写任何密钥时，网页会显示安徽本地演示数据，后端会返回安全的离线建议，因此可以先完成界面与交互验收。

## 启动前端

```powershell
cd frontend
Copy-Item .env.example .env.local
npm install
npm run dev
```

访问 `http://localhost:5173`。如需接入 Supabase，在 `.env.local` 填写：

```dotenv
VITE_SUPABASE_URL=https://你的项目.supabase.co
VITE_SUPABASE_ANON_KEY=你的公开-anon-key
```

浏览器端严禁填写 `service_role` 密钥。

## 启动后端

推荐 Python 3.11 或 3.12：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
Copy-Item .env.example .env
uvicorn app.main:app --reload --port 8000
```

接口文档为 `http://127.0.0.1:8000/docs`。模型与 Supabase 的服务端密钥只填入 `backend/.env`。

### 配置千问

在 `backend/.env` 中填写以下配置。API Key 只能存在后端，不能放进任何 `VITE_*` 变量：

```dotenv
LLM_PROVIDER=qwen
DASHSCOPE_API_KEY=你的阿里云百炼API-Key
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus
```

保存后重启 Uvicorn。访问 `http://127.0.0.1:8000/api/v1/health`，当
`llm_configured` 为 `true` 时表示配置已被后端读取。

## Supabase

1. 新建 Supabase 项目。
2. 在 SQL Editor 执行 `supabase/schema.sql`。该脚本会一次性创建表、RLS 策略，并写入安徽页面首批数据；可重复执行。
3. 前端仅填写 URL 和 Publishable key。
4. 后端填写 URL 和 Secret key，用于受信任的数据写入。

脚本执行成功后，最后一行应返回：`1 / 16 / 3 / 5 / 25 / 15`，依次代表仪表盘、地市、预警、作物、生育期和预防要点记录数。

## Skills 扩展方式

每个技能使用独立目录：

```text
backend/skills/<skill-name>/SKILL.md
```

`app/skill_registry.py` 会扫描技能元数据。需要执行能力时，再为技能绑定 handler，随后即可在 LangGraph 中作为节点或工具调用。当前内置 `crop-calendar`、`field-scouting`、`safety-review` 三个示例。

## 后续移动端

当前页面已做响应式适配。后续可复用同一 FastAPI 接口与 Supabase Auth，通过 Capacitor 封装 Web 端，或新增 React Native 客户端；业务数据与智能体编排无需重写。
