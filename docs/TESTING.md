# 测试与排障

## 分层测试

| 层次 | 测试文件 | 是否调用真实 API |
| --- | --- | --- |
| 后端 | `test-learning-server.py` | 否，隔离临时数据库与模型替身 |
| 合成与缓存 | `test-learning-voice.py` | 否 |
| ASR 生命周期 | `test-learning-realtime.py` | 否，假 WebSocket |
| PCM 播放器 | `test-speech-player.cjs` | 否，虚拟音频时钟 |
| 浏览器实时链路 | `test-realtime-interaction.cjs` | 否，模拟设备与接口 |
| 单句故障恢复 | `test-speech-recovery.cjs` | 否 |
| 角色与布局 | `test-interaction.cjs`、`test-ensemble-layout.cjs`、`test-teacher-motion.cjs` | 否，浏览器测试 |
| 模型样本 | `smoke-live-model.py` | **是，产生费用** |
| 合成音频 ASR | `benchmark-asr.py`、`test-asr-live-stability.py` | **是，产生费用** |

提供的 CI 模板仅执行无真实凭据的测试，目前尚未启用。所有真实 API 测试应手动运行，并使用专门配置和非真实儿童媒体。`smoke-live-model.py` 用临时数据库；ASR 测试读取已有合成缓存，不读取儿童麦克风或写入学习回合。不要把它们误当成完全无网络的单元测试。

## 启用 GitHub Actions

本次上传凭据没有 `workflow` scope。模板保存在 `docs/ci-tests.yml`，未伪装成已运行的 CI。维护者确认权限后，将模板放到 `.github/workflows/tests.yml` 再提交即可；若使用 GitHub CLI，可由维护者交互运行 `gh auth refresh -h github.com -s workflow` 完成授权。启用后必须检查首次云端结果，不能以本地通过替代。

## 本地运行

```powershell
python -m pip install -r requirements.txt
python -m unittest test-learning-server.py test-learning-voice.py test-learning-realtime.py
npm ci
npm test
```

浏览器测试需要独立测试服务，避免操作日常使用中的页面和数据：

```powershell
$env:MYPROFESSOR_DATA = Join-Path $env:TEMP "myprofessor-test-data"
$env:QWEN_API_KEY = "test-only-not-a-real-key"
python learning-server.py --port 8786
```

另一个终端：

```powershell
$env:APP_URL = "http://127.0.0.1:8786/"
$env:PLAYWRIGHT_CHANNEL = "chromium"
npx playwright install chromium
npm run test:realtime
npm run test:recovery
npm run test:interaction
npm run test:layout
npm run test:motion
```

测试模拟就绪状态和角色声音，不要求下载真实音色。公开版不含私有图片，因此几何/交互测试不能证明实际素材已正确绘制；恢复授权素材后仍需人工查看截图。

## 覆盖的关键回归

- 旧请求取消后，新请求不等待旧模型完成；过期文字与声音不重新播放。
- 播音期间继续上传收音；注入 1.4 秒上传卡顿后可顺序排空积压，不立即重启。
- 同一会话发生两次短暂收音故障可恢复；退出停止上传。
- 合成音频截断不写成功缓存；已播部分不自动从头重复。
- 某角色合成失败不拖停其他人，补播不换音色。
- 老师科目、伙伴单聊、同场角色标签、摄像头拒绝后的自动观察暂停。
- 英语老师已知中文谐音错误的播音过滤，字幕默认隐藏，头像无标题遮挡。

这些是确定性代码路径测试，不是对所有自然语言回答、所有设备和长期网络稳定性的保证。

## 排障表

| 现象 | 检查顺序 |
| --- | --- |
| 实时收音反复中断 | 检查麦克风权限/设备；查看错误分类；区分上传积压、云端关闭和 HTTP 错误；重启服务后刷新令牌 |
| 文字快、声音慢 | 分别测首字、首 PCM、缓存命中；检查合成限流和音色模型匹配；不要只加缓存容量 |
| 余额充足仍 403 | 核对 Key 对应账户、地域、模型权限和免费额度用完即停，勿将所有 403 都解释为欠费 |
| 听到声音却答非所问 | 先核对本地最终转写；再看当前角色、上一条引导、是否附了无关图片；不应先假定麦克风坏了 |
| 教师重复要求展示 | 检查用户拒绝语义、自动观察是否暂停；故障和拒绝拍摄不能等于拒绝学习 |
| 已退出却有旧音频 | 核对请求版本、取消事件、播放节点清理，不应通过静音掩盖资源未释放 |
| 角色没有图像 | 公开版未附私人形象，按 SETUP 文档恢复自己的授权素材 |

记录故障时提供浏览器版本、设备、网络、角色、复现步骤和脱敏错误码。不要提供原始语音、完整聊天库或密钥。模拟器成功不等于扬声器外放回声、真实儿童停顿与识别口音已通过验收。
