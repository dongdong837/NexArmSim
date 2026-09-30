# NexArmSim

NexArm 机械臂虚拟仿真开发工程，使用 React + Three.js 展示机械臂三维模型，使用 Python + MuJoCo 验证物理场景。

项目目前处于开发阶段。网页三维展示与 MuJoCo 物理测试分别运行，尚未实现前后端状态同步。

## 当前功能

- 加载 NexArm 的 11 个 STL 模型部件。
- 按父子坐标系组织机械臂模型。
- 使用滑块控制 joint1～joint5 的旋转。
- 限制各关节的角度范围。
- 使用滑块展示抓夹开合。
- 展示跟随机械臂末端运动的虚拟相机视角。
- 使用鼠标拖动相机画面窗口。
- 使用 MuJoCo 创建地面、桌面和红色方块。
- 执行方块下落与桌面碰撞的最小物理测试。

当前关节滑块只改变浏览器中的模型姿态，不控制真实机械臂，也不驱动 MuJoCo 中的机械臂。

相机小窗由 Three.js 渲染，尚未接入真实相机或 ROS 2 图像话题。

## 技术组成

| 部分         | 技术                  | 用途                           |
| ------------ | --------------------- | ------------------------------ |
| 网页界面     | React + TypeScript    | 控制面板、滑块和状态显示       |
| 三维展示     | Three.js + WebGL      | STL 模型、关节姿态和虚拟相机   |
| 前端开发工具 | Vite                  | 本地开发服务和构建             |
| 物理仿真     | Python + MuJoCo 3.5.0 | 重力、碰撞和物体运动           |
| 模型文件     | STL                   | 机械臂各部件的三维外形         |
| 物理场景文件 | MJCF XML              | 刚体、质量、碰撞形状和场景参数 |

## 目录结构

```text
NexArmSim/
├─ backend/
│  ├─ requirements.txt
│  ├─ app/
│  │  ├─ __init__.py
│  │  └─ simulation.py
│  └─ models/
│     └─ minimal_scene.xml
├─ web/
│  ├─ public/
│  │  └─ models/
│  │     └─ nexarm/
│  │        └─ *.STL
│  ├─ src/
│  │  ├─ App.tsx
│  │  ├─ App.css
│  │  ├─ index.css
│  │  └─ main.tsx
│  ├─ package.json
│  ├─ package-lock.json
│  └─ vite.config.ts
├─ .gitignore
└─ README.md
```

主要文件的作用：

- `web/src/App.tsx`：创建三维场景、加载模型、组织关节层级、处理滑块和相机窗口操作。
- `web/src/App.css`：网页布局、关节面板和相机窗口样式。
- `web/src/main.tsx`：React 页面入口。
- `web/public/models/nexarm/`：浏览器加载的 STL 模型。
- `web/package.json`：前端依赖与启动、构建命令。
- `backend/requirements.txt`：Python 依赖及版本。
- `backend/models/minimal_scene.xml`：MuJoCo 最小物理场景。
- `backend/app/simulation.py`：执行两秒仿真，并检查方块最终高度。

## 开发环境

以下命令以 Windows PowerShell 为例。

- Git
- Node.js：本工程使用 Node.js 24 开发
- npm：随 Node.js 安装
- Python 3.12，64 位
- 支持 WebGL 的浏览器
- VS Code 或其他代码编辑器

检查安装：

```powershell
git --version
node --version
npm.cmd --version
python --version
```

使用 `npm.cmd` 可以避免 PowerShell 对 `npm.ps1` 的脚本执行策略限制。

## 获取工程

```powershell
git clone https://github.com/dongdong837/NexArmSim.git
cd NexArmSim
```

私有仓库需要使用有访问权限的 GitHub 账号登录。

后续命令中的相对路径均以工程根目录为起点；请根据自己的下载位置切换目录。

## 启动网页

进入前端目录并安装依赖：

```powershell
cd web
npm.cmd ci
```

启动开发服务：

```powershell
npm.cmd run dev
```

根据终端显示的地址打开网页，通常为：

```text
http://localhost:5173/
```

如果端口已被占用，以终端实际显示的地址为准。保持终端运行，按 `Ctrl+C` 停止服务。

网页操作：

- 鼠标左键拖动：旋转观察视角。
- 鼠标右键拖动：平移观察视角。
- 鼠标滚轮：缩放。
- 关节滑块：调整各关节姿态。
- 抓夹滑块：调整夹爪开合。
- 复位按钮：恢复关节和抓夹的初始姿态。
- 按住相机窗口顶部标题栏：移动相机画框。

生产构建：

```powershell
npm.cmd run build
```

构建结果位于 `web/dist/`。

## 安装 MuJoCo 环境

在工程根目录进入后端目录：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

确认版本：

```powershell
.\.venv\Scripts\python.exe -c "import mujoco; print(mujoco.__version__)"
```

预期输出：

```text
3.5.0
```

这些命令直接使用虚拟环境中的 Python，不需要执行 `Activate.ps1`。

## 执行物理测试

在 `backend` 目录执行：

```powershell
.\.venv\Scripts\python.exe -m app.simulation
```

程序会在不打开图形窗口的情况下计算两秒仿真，然后输出测试结果并退出。

默认场景的预期结果接近：

```text
initial_z=0.5000 m
final_z=0.4350 m
simulation_time=2.000 s
RESULT=PASS
```

方块中心初始高度为 0.5 米，落到桌面后的中心高度约为 0.435 米。

实际数值可能存在少量接触计算误差，程序允许最终高度误差在 0.01 米以内。

## 打开 MuJoCo Viewer

在 `backend` 目录执行：

```powershell
.\.venv\Scripts\python.exe -m mujoco.viewer --mjcf=models\minimal_scene.xml
```

Viewer 用于查看和调试物理场景：

- `Pause`：暂停仿真。
- `Reset`：恢复初始物理状态。
- `Run`：运行仿真。
- `Reload`：重新加载保存后的 XML。

默认方块距离桌面很近，下落过程很短。观察时先暂停、复位，再运行。

Viewer 与网页是两个独立程序，当前没有共享运行状态。在 Viewer 中点击 Run，不会使网页中的模型运动。

## 坐标与单位

- MuJoCo 场景使用米作为长度单位。
- MuJoCo 当前场景使用 Z 轴向上。
- Three.js 当前网页使用 Y 轴向上。
- 网页通过机器人根节点旋转，将机械臂的 Z 向上坐标转换为显示坐标。
- 网页滑块使用角度制，Three.js 旋转计算使用弧度制。

后续同步物理状态时，需要统一坐标转换、模型比例和四元数顺序。

## 后续开发计划

1. 创建持续运行的 MuJoCo 后端服务。
2. 提供读取状态和运行、暂停、复位的 HTTP 接口。
3. 将桌面与方块的物理状态同步到网页。
4. 将 NexArm 关节、限位和夹爪加入 MuJoCo。
5. 实现关节控制与碰撞、抓取验证。
6. 开发兼容现有控制接口的 ROS 2 仿真驱动。
7. 接入虚拟相机图像和 ROS 2 玩法程序。

这些功能尚未完成，不属于当前可运行功能。

## 常见问题

### npm 提示禁止运行脚本

在 PowerShell 中使用：

```powershell
npm.cmd ci
npm.cmd run dev
```

### 网页提示模型加载失败

检查 `web/public/models/nexarm/` 中是否存在代码引用的 STL 文件，文件名和大小写是否一致。

通过 Vite 开发服务访问网页，并查看浏览器开发者工具中的 Console 和 Network 报错。

### Python 提示找不到 mujoco

确认使用的是后端虚拟环境中的解释器：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

### 点击 Run 后看不到方块运动

方块可能已经落到桌面。先点击 Pause，再点击 Reset，最后点击 Run 观察。

### GitHub 中没有虚拟环境和 node_modules

这些目录由 `.gitignore` 排除。下载工程后，需要分别安装前端和后端依赖。

## 提交修改

在工程根目录执行：

```powershell
git add .
git status
git commit -m "描述本次修改内容"
git push
```

提交前检查文件列表，避免上传依赖目录、缓存和敏感配置。

## 授权说明

源码、第三方依赖和三维模型应分别遵循其对应授权。

当前仓库尚未包含项目许可证文件。添加许可证前，应确认 NexArm 模型及引用源码的使用和分发权限。