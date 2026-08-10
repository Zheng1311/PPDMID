#  PPD-MID· 皖农智诊

面向安徽省农业生产场景的病虫害智能诊断与生育期预防平台，包含 Web 管理端与手机端，支持同一套账号、数据与智能诊断服务协同使用。

## 项目亮点

- Dify 多智能体协同：围绕病虫害识别、风险研判、生育期管理与防控建议组织智能服务流程。
- 安徽区域化服务：重点面向水稻、小麦、玉米、大豆、油菜等作物，结合皖北、江淮、沿江和皖南生产条件。
- Web 与手机端互通：两端共享 Supabase 数据库、用户账号、预警信息和诊断历史。
- 多模态智能诊断：支持文字问诊、田间图片上传和手机端中文语音输入。
- 连续对话：诊断过程中切换页面不影响后台处理；可从历史记录恢复原会话并继续咨询。
- 动态生育期预防：作物和生育期切换后，巡田要点、预防风险和建议同步更新。

## 目录结构

```text
ppd-mid-github/
├─ ppd-mid-web/              # Web 端项目
│  ├─ frontend/              # React + Vite 前端
│  ├─ backend/               # FastAPI 后端服务
│  └─ supabase/schema.sql    # Supabase 建表、RLS 与 RPC 初始化脚本
├─ ppd-mid-mobile/           # React + Vite 手机端
├─ README.md
└─ .gitignore
```

## 技术栈

- React 19、TypeScript、Vite
- Supabase：账号、数据、诊断记录、预警与统计
- Dify：多智能体工作流、连续对话和图文诊断
- FastAPI：后端服务接口
- Web Speech API：手机端中文语音输入

## 环境要求

| 项目 | 要求 | 说明 |
| --- | --- | --- |
| 操作系统 | Windows 10/11、macOS 或 Linux | 推荐 Windows 10/11 |
| Node.js | 20 LTS 或更高 | Web 端和手机端运行、构建 |
| npm | 10 或更高 | 随 Node.js 安装 |
| Python | 3.11 或更高 | 运行 FastAPI 后端时需要 |
| 浏览器 | Chrome 或 Edge 最新版 | 手机语音输入建议使用 Chrome/Edge |
| Supabase | 已创建项目 | 需执行本仓库提供的 SQL 脚本 |
| Dify | 已配置的多智能体应用 | 需在本地环境变量中配置访问地址与密钥 |

检查本地版本：

```powershell
node -v
npm -v
python --version
```

## 本地启动

### Web 端前端

```powershell
cd ppd-mid-web/frontend
Copy-Item .env.example .env.local
npm install
npm run dev
```

### 手机端

```powershell
cd ppd-mid-mobile
Copy-Item .env.example .env.local
npm install
npm run dev
```

如需在同一 Wi-Fi 下用手机测试，可执行：

```powershell
npm run dev -- --host 0.0.0.0
```

然后在手机浏览器访问终端显示的局域网地址。

### 后端服务

```powershell
cd ppd-mid-web/backend
Copy-Item .env.example .env
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## 环境变量配置

环境变量只在本地创建。请从 `.env.example` 复制生成 `.env.local` 或 `.env`，并填写自己的项目配置。

前端示例：

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_DIFY_API_BASE=
VITE_DIFY_API_KEY=
VITE_DIFY_USER=ppd-user
```

后端示例：

```env
APP_ENV=development
APP_HOST=127.0.0.1
APP_PORT=8000
FRONTEND_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_MODEL=

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

## Supabase 初始化

首次使用时，在 Supabase SQL Editor 执行：

```text
ppd-mid-web/supabase/schema.sql
```

脚本会创建用户、会话、诊断历史、预警、统计所需的表，以及 RLS 策略和 RPC 函数。

## 构建

分别进入 Web 前端或手机端目录执行：

```powershell
npm run build
```

构建产物会生成到 `dist/` 目录。
