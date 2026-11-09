# UPI Payments Analytics Copilot

An interactive dashboard for exploring PhonePe Pulse UPI transaction data across Indian regions, years, quarters, and payment categories. The dashboard includes an AI Copilot powered by Gemini for natural-language analytics questions.

## Features

- Filter transaction summaries by year and state or union territory.
- Explore transaction volume and value, state rankings, quarterly trends, and category share.
- Compare all available years or focus on an individual year.
- Ask the AI Copilot questions about the available data and request charts or tables.
- Switch between dark and light themes.

## Tech stack

- Frontend: Next.js, React, TypeScript, Tailwind CSS, Recharts
- Backend: FastAPI, Python, pandas
- AI: Google Gemini API
- Dataset: PhonePe Pulse

## Run locally

You need Python 3.10 or later and Node.js installed.

### 1. Start the backend

In PowerShell:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install fastapi uvicorn pandas python-dotenv google-genai
```

Create `backend/.env` and add your Gemini API key:

```text
GEMINI_API_KEY=your_gemini_api_key
```

Start the API:

```powershell
uvicorn main:app --reload --port 8000
```

The dashboard data endpoints work from the included CSV files. A Gemini API key is needed for AI Copilot responses.

### 2. Start the frontend

Open another PowerShell window:

```powershell
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The frontend expects the backend at `http://127.0.0.1:8000`.

## Data

The dashboard uses the PhonePe Pulse state transaction and category CSV files in `backend/data/`. Values shown by the app are calculated from those included datasets and may reflect only the periods present in the CSV files.

## Security

Keep API keys in `backend/.env`. Do not commit `.env` files or paste API keys into source code.
