# 本机 API

基地址默认 `http://127.0.0.1:8765`。除健康接口外，私有数据接口及 POST 操作需要 `X-Learning-Token`。令牌来自 `/api/health`，服务重启会变化；它不是供应商 API Key，不应分享。

服务检查 `Host` 与有值的 `Origin` 是否属于本机绑定端口。没有开放 CORS。令牌只降低跨站误调用风险，不构成本机其他软件无法读取的安全边界。

## 接口目录

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/health` | 就绪状态、模型、音色是否配置、当前令牌 |
| GET | `/api/history?before=ID` | 30 条已完成回合，按时间返回 |
| GET | `/api/memory` | 当前家长档案与本地提取笔记 |
| GET | `/api/export` | 一致性的 JSON 数据导出，不含 API Key |
| POST | `/api/chat` | 对话、可选摄像头帧、NDJSON 增量 |
| POST | `/api/cancel` | 取消当前模型回合 |
| POST | `/api/asr/start` | 创建实时识别会话 |
| POST | `/api/asr/audio` | 上传有序 PCM 音频 |
| POST | `/api/asr/poll` | 获取识别事件与关闭原因 |
| POST | `/api/asr/stop` | 释放识别会话 |
| POST | `/api/speech` | 完整语音音频 |
| POST | `/api/speech-stream` | NDJSON 音频流 |

## 对话

```json
{
  "request_id": "example-request-00001",
  "message": "我们聊聊今天的事情。",
  "character": "dark",
  "adventure": false,
  "camera_state": "off",
  "kind": "child"
}
```

`request_id` 用于幂等与取消。`character` 为固定角色 ID；`adventure=true` 表示多人模式。`kind` 区分孩子消息与程序发起的开始/观察，不应把自动提示当作孩子真实陈述。可选 `image` 为 `data:image/jpeg;base64,...`，不是远程 URL。

响应为 `application/x-ndjson`，每行一个 JSON：

```json
{"type":"start","id":12,"character":"dark","stage":"","allowed_speakers":["dark"]}
{"type":"delta","text":"好呀，你今天想聊什么？"}
{"type":"done","id":12,"saved":true,"backup":true,"character":"dark","stage":""}
```

流已开始后，HTTP 200 **不代表成功**，必须检查终止的 `done` 或 `error`。`backup=false` 表示回合保存成功但本轮备份未完成。相同 ID 的已完成请求可能直接返回 JSON `reply`，客户端必须兼容非流式幂等响应。

取消请求：`{"request_id":"example-request-00001"}`。取消接口确认不代表供应商一定没有产生费用，也不代表正在播放的音频已经停止；前端必须同步停止 Web Audio。

## 实时 ASR

`start` 使用空对象，返回 `session_id`、`sample_rate=16000` 与句尾静音参数。随后所有请求携带 `session_id`。

```json
{"session_id":"opaque-local-id","audio":"BASE64_INT16_MONO_PCM"}
```

不是 WAV、MP3 或 float32：必须为有序、单声道、16 kHz、小端 Int16 PCM。每次最多 16000 字节，字节数须为偶数。浏览器正常包为 3200 字节，可合并积压包但不得乱序或盲目重发已接受的包。

`poll` 最多等待约一秒并返回：

```json
{
  "events": [{"type":"final","text":"Hello!","id":"provider-item-id"}],
  "closed": false,
  "error_code": ""
}
```

事件包括 `speech_start`、`speech_end`、`partial`、`final`、`error`。只用 final 发起正常对话。`closed=true` 时检查独立 `error_code`，即便事件队列已清空。`audio` 也可能返回 `accepted=false, closed=true`，不能把这当正常接受。

## 语音

```json
{"text":"Hello!","character":"english","streaming":true}
```

`speech-stream` 按行返回 `audio` 事件（`data` 为 base64 PCM，含 `sample_rate`），最后 `done`；失败为 `error`。只有完整成功的结果可当作可缓存音频。角色缺少音色配置时不能假定服务会回退到系统朗读。

## 错误处理

- 400：请求结构、消息、音频或图片无效。
- 403：本机令牌/来源不匹配，或模型提供商拒绝访问；根据响应所在阶段区分。
- 409：请求正在处理、内容与幂等 ID 不一致或容量冲突。
- 503：服务或实时识别不可用。
- 流内 `error`：检查内容，当前回合不能按完成处理。

重启后刷新页面以获取新令牌。不要在公开 issue 中粘贴请求头、完整音视频 base64、导出的记忆库或未经脱敏的聊天内容。
