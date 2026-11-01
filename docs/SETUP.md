# 配置与部署

## 环境

核心依赖为 Python 3.10+ 与 `websocket-client`；SQLite、HTTP、WAV 和配置读写使用标准库。推荐 Windows 和桌面 Chrome，麦克风要求 AudioWorklet 与 16 kHz AudioContext 支持。Node.js 20+ 只用于自动化测试，不参与服务运行。

`requirements-dev.txt` 额外包含 numpy/scipy，仅在对已有合成音频做真实 ASR 重采样测试时需要。没有 Docker、Redis、云端数据库或 npm 构建步骤。

## 私有配置

Windows 默认目录为 `%LOCALAPPDATA%\MyProfessor`。`MYPROFESSOR_DATA` 环境变量可覆盖 Python 服务的数据目录；Windows 快捷启动器仍按默认目录放日志，自定义目录建议直接运行 Python 服务。

```dotenv
QWEN_API_KEY=your-private-key
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL_NAME=qwen-vl-max
DEEPSEEK_API_KEY=your-private-key
MYPROFESSOR_TEXT_PROVIDER=deepseek
```

不要把真实值填入仓库的 `.env.example`。ASR 和 TTS 使用 Qwen 密钥；DeepSeek 只替代纯文字聊天。`MYPROFESSOR_TEXT_PROVIDER=qwen` 时不调用 DeepSeek。未明确配置 provider 时，有 DeepSeek 密钥则默认用 DeepSeek，否则走 Qwen。`MYPROFESSOR_MODEL` 可覆盖 Qwen 模型。

Qwen Key、模型权限、API 地域和音色地域必须匹配。账户余额充足并不能排除“免费额度用完即停”的调用限制。确认供应商错误码再处理，不要反复更换模型名或无条件充值。

## 形象素材

公开源码不包含原项目的任何人物图片、截图、照片或照片衍生形象。样式保留素材接口，需自行放入有合法使用权的文件：

| 路径（均位于 `learning-assets/`） | 图集布局 |
| --- | --- |
| `character-atlas.png` | 4 列 × 3 行，伙伴基础状态 |
| `teacher-atlas.png` | 4 列 × 3 行，三位老师基础状态 |
| `challenger-expressions.png` | 4 列 × 1 行，示例伙伴基础表情 |
| `challenger-story-expressions.png` | 4 列 × 2 行，剧情表情 |
| `friend-face.webp` | 主界面伙伴头像 |
| `friend-cheer.webp` | 庆祝形象 |
| `friend-run.webp` | 主界面全身形象 |

具体帧选择以 `avatar.css`、`ensemble.css` 为准。缺少素材时页面控制与基础练习仍可运行，但角色画面不完整；本项目不把缺图状态包装成可完整还原的视觉演示。图片默认被 Git 忽略，不要为提交私人头像使用 `git add -f`。

## 独立音色

私有数据目录根部为 `dark` 音色，其他角色位于 `voices/<角色ID>/`。每个音色目录保存 `voice.json`、可选授权 `voice-reference.wav`、试听和 `speech-cache/`。模型与音色 ID 不可交叉使用。

`setup-myprofessor-voice.py` 对根目录 `voice-reference.wav` 进行克隆；`design-myprofessor-voice.py` 创建设计型 light 音色；`setup-teacher-voices.py` 创建三个原创老师音色。它们会产生真实 API 费用并可能覆盖对应音色配置，运行前自行备份、确认权限和授权。其他角色可使用 `learning_voice.enroll()` / `design()` 与 `voice_directory()` 按同样流程配置。

不随源码分享任何真实声音。儿童声音样本须取得本人及监护人相应授权，不模仿真实学校老师，也不把 AI 合成描述为真人连线。

## 家长档案

可在私有数据目录创建 `parent-profile.json`。服务启动时读取 JSON 对象并按变化写入版本；它是参考数据，不是允许覆盖系统规则的提示词。建议只填写称呼、兴趣和任务相关信息，不填联系方式、住址等。

```json
{
  "learner": {"friends": ["示例朋友"], "interests": ["积木", "绘画"]},
  "subject_teachers": {"chinese": "示例语文角色"}
}
```

公开版使用通用学习者称呼与虚构伙伴，不预置某个真实孩子的姓名、班级或社交关系。当前角色提示与 UI 分布在 `learning-server.py`、`avatar.js`、`chat.js` 和 HTML 中，尚未统一成一个配置中心；二次定制时须同步修改，并跑角色回归测试。

## 旧安装升级

此版统一使用 `MYPROFESSOR_*` 配置变量、`MyProfessor` 数据目录和通用角色 ID。不会自动读取或迁移此前定制安装的私人目录。已有使用者应先备份，按本文配置新目录；角色音色目录按 `dark`、`light`、`challenger`、`chinese`、`english`、`math` 设置。不要直接把旧角色目录互换，以免出现错误音色。私有数据迁移不应通过 Git 提交完成。

## 部署边界

仅运行于回环地址，浏览器和服务应在同一台电脑。不要改为 `0.0.0.0` 后直接开放端口，不要通过公开隧道暴露。手机横竖屏测试指布局测试，不代表已实现手机远程访问鉴权或 HTTPS 部署。

停止服务后才能整体迁移数据；SQLite 在线备份可供数据恢复，但整个目录的音色、配置与素材需要单独保护。恢复步骤见隐私文档。
