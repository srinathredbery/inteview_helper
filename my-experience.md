# My Experience — Srinath

## Summary
I have 13 years of experience as a full-stack developer.
I work mainly with PHP, Java, Angular, Python, and cloud systems.
Recently I focus on AI integration for ERP systems.
I build scalable enterprise systems and solve complex backend problems.

---

## Project 1 — ERP AI Wrapper (Most Important)

**Problem:**
Our ERP system had no AI capabilities. Users had to manually search reports, generate invoices, and check inventory. It was slow and error-prone.

**What I built:**
I built an AI wrapper layer on top of our existing ERP system.
The wrapper uses LangChain and OpenAI to understand natural language queries.
Users can now type things like "Show me all overdue invoices from last month" in plain English.
The AI converts this to ERP queries and returns structured results.
I used FastAPI for the backend API layer.
I used a vector database (ChromaDB) to store ERP schema context for RAG.
The system routes user intent to the correct ERP module automatically.

**Result:**
Report generation time dropped from 10 minutes to 30 seconds.
User adoption increased — non-technical staff could now query the ERP directly.
We eliminated 3 manual reporting jobs that were done every week.

---

## Project 2 — AI Monitoring and Auto-Healing System

**Problem:**
Engineers were waking up at night to restart failed services.
Alert fatigue was high — too many false alarms.

**What I built:**
I integrated an AI agent into our monitoring pipeline.
The agent reads logs from ELK stack, detects patterns, and decides if auto-restart is safe.
It creates Jira tickets automatically for issues it cannot fix.
I used Python, Celery, and custom rule logic for the agent loop.

**Result:**
The AI handled 80% of simple service failures automatically.
We saved 15 hours of manual on-call work per week.
Engineer sleep was no longer interrupted for simple restarts.

---

## Project 3 — ERP Reporting Microservice

**Problem:**
Our main ERP had slow report generation. Heavy SQL queries blocked the main system.

**What I built:**
I moved all reporting to a separate microservice using FastAPI and async processing.
Reports run in background jobs using Celery and Redis queue.
Results are cached and delivered via webhook when ready.

**Result:**
Report generation improved by 60%.
Main ERP system became faster because heavy queries no longer ran on it.

---

## Project 4 — Cash Flow Prediction System

**Problem:**
Finance team had no way to predict cash flow. Decisions were made on gut feeling.

**What I built:**
I built a machine learning model using Python and scikit-learn.
It trains on 3 years of ERP transaction data.
The model predicts cash flow for the next 30, 60, and 90 days.
I integrated predictions directly into the ERP dashboard.

**Result:**
Finance team could plan purchases and payments 30 days in advance.
Overdue payment incidents dropped by 40%.

---

## Tech Stack
- Languages: PHP, Java, Python, JavaScript, TypeScript
- Frontend: Angular, React
- Backend: FastAPI, Spring Boot, Laravel
- AI/ML: LangChain, OpenAI API, ChromaDB, scikit-learn, Whisper
- Databases: PostgreSQL, MySQL, MongoDB, Redis
- DevOps: Docker, Kubernetes, Jenkins, GitHub Actions
- Cloud: AWS, GCP
- Monitoring: ELK Stack, Grafana, Prometheus

---

## Personal Style
I prefer simple solutions over complex ones.
I always ask: can we solve this with less code?
I enjoy turning manual, repetitive tasks into automated systems.
I believe AI should help real users, not just look impressive in demos.
