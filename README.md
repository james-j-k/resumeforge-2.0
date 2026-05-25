# ResumeForge

An AI-powered resume builder that generates ATS-optimized resumes, tailors them to job descriptions, and exports to DOCX — all from your own API key.

**Your profile grows with you.** Add experience and projects once, keep adding as your career grows, and ResumeForge tailors a fresh resume for every new job — no starting from scratch.

---

## Features

- **AI resume generation** — clean, Calibri-font resume from structured data
- **Job tailoring** — paste a JD and the AI mirrors its exact keywords for a near-100 ATS score
- **ATS keyword match badge** — shows matched keywords, gaps, and score after generation
- **Master profile** — all your experience, skills, and projects persist in your browser forever; just keep adding to them
- **Upload existing resume** — drag in a PDF, DOCX, or TXT to auto-fill all fields via AI
- **Cover letter generator** — one-click personalized letter per job
- **DOCX export** — real Word file with Calibri font and clean formatting
- **Inline bullet polish** — hover any bullet and hit ✨ to rewrite it with AI
- **3 templates** — Minimal, Bold, Compact
- **4 AI providers** — Anthropic Claude, OpenAI GPT-4o, Google Gemini, Groq (Llama 3)

---

## Local Setup

**Requirements:** Node.js 18+

```bash
git clone https://github.com/YOUR_USERNAME/resumeforge.git
cd resumeforge
npm install
npm start
```

Open **http://localhost:3000** in your browser.

> Always use the server URL — do not open `index.html` directly as a file.

---

## Supported AI Providers

Paste any key — the provider is auto-detected.

| Provider  | Key format   | Where to get it                  |
|-----------|--------------|----------------------------------|
| Anthropic | `sk-ant-...` | console.anthropic.com            |
| OpenAI    | `sk-...`     | platform.openai.com              |
| Gemini    | `AIza...`    | aistudio.google.com (free tier)  |
| Groq      | `gsk_...`    | console.groq.com (free tier)     |

---

## Free Hosting on Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New** → **Web Service**
3. Connect your GitHub repo and set:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
4. Click **Deploy** — you get a public URL like `https://resumeforge-xxxx.onrender.com`

> The free tier sleeps after 15 min of inactivity. First request after sleep takes ~30 sec to wake up.

### Other free options

| Platform | Notes |
|----------|-------|
| [Railway](https://railway.app) | $5/month free credit, faster cold starts |
| [Fly.io](https://fly.io) | Free tier, slightly more setup required |

---

## Privacy

- Your API key is **never stored on the server** — it is sent per-request and only used to call the AI provider
- Your resume data (experience, skills, projects) lives in your **browser's localStorage** only — it never leaves your device
- No database, no accounts, no tracking

---

## Stack

- **Backend:** Node.js, Express
- **File parsing:** pdf-parse v1.1.1, mammoth
- **DOCX generation:** docx
- **Frontend:** Vanilla JS — single HTML file, zero build step
