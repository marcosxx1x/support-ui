# Lnkr Support UI


```
lnkr-support-ui/
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx           # Your main and only page
├── components/
│   └── voice-assistant/
│       ├── CallControls.tsx     # (e.g., Mute, End Call buttons)
│       ├── StatusIndicator.tsx  # (e.g., Connecting, Connected, Error)
│       └── Transcript.tsx       # To display the speech-to-text result
├── lib/
│   └── api.ts               # Functions for communicating with your FastAPI backend
├── store/
│   └── callStore.ts         # Global state management for the call (Zustand)
├── .env.local               # For environment variables (API URL)
├── next.config.mjs
├── package.json
└── tsconfig.json
```