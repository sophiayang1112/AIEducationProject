# myProfessor | AI Learning Companion

A local-first learning application combining multiple AI characters, real-time speech interaction, camera-assisted tutoring, and persistent learning memory.

**Stack:** Python 3.10+, JavaScript, HTML/CSS, SQLite, WebSocket, AudioWorklet, Qwen APIs, optional DeepSeek text generation.

## About this project

A personal assignment completed with collaboration, presented in Sophia Yang's portfolio.

No open-source license has been added. Public availability does not grant unrestricted reuse of the code, voices, images, or third-party materials.

## Features

- Multiple learning companions and subject-specific tutors for English, Chinese, and mathematics.
- Microphone capture using AudioWorklet and 16 kHz PCM, with a server-side bridge to real-time speech recognition.
- Speech interruption, cancellation, and bounded recovery from transient failures.
- Per-character speech synthesis, streamed PCM playback, and local audio caching.
- User-enabled camera snapshots for visual questions and homework assistance.
- SQLite conversation history, relevant-memory retrieval, profile versioning, and local backups.
- Basic practice activities, including multiplication exercises.

## Architecture

The browser handles interaction, audio capture, playback, and character animation. A local Python service coordinates model requests, speech sessions, and SQLite persistence. Cloud APIs provide speech recognition, language/vision responses, and speech synthesis.

See [Architecture](docs/ARCHITECTURE.md), [API reference](docs/API.md), and the [original Chinese README](README.zh-CN.md) for detailed implementation notes.

## Run locally on Windows

Clone this portfolio repository or download and extract its ZIP, then open PowerShell in the project folder:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
New-Item -ItemType Directory "$env:LOCALAPPDATA\MyProfessor" -Force
Copy-Item .env.example "$env:LOCALAPPDATA\MyProfessor\.env"
```

Check for an existing configuration before copying. Add your own API credentials to that private `.env` file. Never commit real credentials. See [Setup](docs/SETUP.md) for model, voice, and asset configuration.

```powershell
.\START_MYPROFESSOR.cmd
```

The Windows launcher opens an available local port. Alternatively:

```powershell
.\.venv\Scripts\python.exe learning-server.py --port 8765
```

Open http://127.0.0.1:8765. Enable microphone or camera access only when needed. GitHub Pages cannot run the Python backend.

## Tests

Backend and audio-player checks do not require live API credentials:

```powershell
python -m unittest test-learning-server.py test-learning-voice.py test-learning-realtime.py
npm ci
npm test
```

Additional browser integration tests and live API test requirements are documented in [Testing](docs/TESTING.md). The CI configuration in `docs/ci-tests.yml` is a template; its presence does not mean GitHub Actions is enabled or passing.

## Privacy and limitations

Conversation records, profiles, and audio caches are stored locally. Relevant text, microphone audio, or camera snapshots are sent to the configured API provider when those features are used. Local storage is not encrypted by the application.

This is a learning application prototype, with no production reliability claim. It does not provide multi-user isolation, public-internet deployment authentication, complete offline AI, or validated academic assessment. Private images, recordings, voice IDs, learning records, and API credentials are not included in this distribution.

See [Privacy](docs/PRIVACY.md) and [Security](SECURITY.md).
