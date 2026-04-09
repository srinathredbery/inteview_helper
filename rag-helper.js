const fs = require('fs');
const axios = require('axios');
const pdfParse = require('pdf-parse');

// ─── Load secrets from environment variables ─────────────────────────────────
const OPIK_API_KEY = process.env.OPIK_API_KEY || '';
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || '';

// ─── Lazy Opik loader ────────────────────────────────────────────────────────
// opik uses ESM-only deps (ansi-escapes) — dynamic import() is required.
let _opikClient = null;
async function getOpik() {
    if (_opikClient) return _opikClient;
    try {
        const { Opik } = await import('opik');
        _opikClient = new Opik({
            apiKey: OPIK_API_KEY,
            projectName: 'interview-assistant'
        });
        console.log('[Opik] Connected to LLM observability platform.');
    } catch (err) {
        console.warn('[Opik] Failed to load — logging disabled:', err.message);
    }
    return _opikClient;
}

// ─── Common STT correction map (Whisper mistakes for tech terms) ─────────────
const STT_CORRECTIONS = [
    [/\bgentic\s*eye\b/gi, 'agentic AI'],
    [/\ba\s*gentic\b/gi, 'agentic'],
    [/\bagentic\s*eye\b/gi, 'agentic AI'],
    [/\bjentic\b/gi, 'agentic'],
    [/\bmaching\b/gi, 'machine'],
    [/\bmachine\s*learning\b/gi, 'machine learning'],
    [/\bm\s*l\s*ops\b/gi, 'MLOps'],
    [/\bray\s*g\b/gi, 'RAG'],
    [/\brag\s*system\b/gi, 'RAG system'],
    [/\bkuberneedies\b/gi, 'Kubernetes'],
    [/\bdoker\b/gi, 'Docker'],
    [/\bpostgree\b/gi, 'Postgres'],
    [/\bmy\s*sequel\b/gi, 'MySQL'],
    [/\bno\s*sequel\b/gi, 'NoSQL'],
    [/\bfast\s*a\s*p\s*i\b/gi, 'FastAPI'],
    [/\blang\s*chain\b/gi, 'LangChain'],
    [/\bopen\s*a\s*i\b/gi, 'OpenAI'],
    [/\bci\s*cd\b/gi, 'CI/CD'],
    [/\bdevops\b/gi, 'DevOps'],
    [/\bapis\b/gi, 'APIs'],
];

/**
 * Applies known STT correction rules to raw Whisper output.
 * Returns { corrected: string, wasChanged: boolean }
 */
function correctSTT(rawText) {
    let corrected = rawText;
    for (const [pattern, replacement] of STT_CORRECTIONS) {
        corrected = corrected.replace(pattern, replacement);
    }
    return {
        corrected: corrected.trim(),
        wasChanged: corrected.trim() !== rawText.trim()
    };
}

/**
 * Very rough check: does the text look like a real interview question?
 * Returns false if it's too short or still looks garbled after correction.
 */
function looksLikeValidQuestion(text) {
    if (!text || text.trim().length < 8) return false;
    // Must have at least one recognisable word (≥3 chars)
    const words = text.trim().split(/\s+/);
    const realWords = words.filter(w => w.length >= 3);
    return realWords.length >= 2;
}

/**
 * Truncates contextText cleanly at a sentence boundary instead of mid-word.
 */
function truncateAtSentence(text, maxChars = 30000) {
    if (text.length <= maxChars) return text;
    const slice = text.substring(0, maxChars);
    const lastPeriod = slice.lastIndexOf('.');
    return lastPeriod > 0
        ? slice.substring(0, lastPeriod + 1) + '\n...[TRUNCATED]'
        : slice + '\n...[TRUNCATED]';
}

class RagHelper {
    constructor() {
        this.contextFiles = [];
        this.contextText = "";
        this.puterInvoker = null; // Set from main.js
        // Opik is loaded lazily via dynamic import() on first use
    }

    async setContextFiles(filePaths) {
        this.contextFiles = filePaths;
        this.contextText = "";

        for (const filePath of filePaths) {
            try {
                if (filePath.endsWith('.txt') || filePath.endsWith('.md')) {
                    const content = fs.readFileSync(filePath, 'utf8');
                    this.contextText += `\n--- Document: ${filePath} ---\n${content}\n`;
                } else if (filePath.toLowerCase().endsWith('.pdf')) {
                    const dataBuffer = fs.readFileSync(filePath);
                    const data = await pdfParse(dataBuffer);
                    this.contextText += `\n--- Document: ${filePath} ---\n${data.text}\n`;
                }
            } catch (err) {
                console.error(`Error reading context file ${filePath}:`, err);
            }
        }

        // Truncate cleanly at sentence boundary
        this.contextText = truncateAtSentence(this.contextText, 30000);
    }

    getContextFiles() {
        return this.contextFiles;
    }

    async generateResponse(rawTranscribedText, mcpContext = "", toneSettings = {}) {
        if (!rawTranscribedText || rawTranscribedText.trim() === "") return "";

        // ── STEP 0: Correct STT errors before anything else ──────────────────
        const { corrected: transcribedText, wasChanged } = correctSTT(rawTranscribedText);

        if (wasChanged) {
            console.log(`[STT Correction] "${rawTranscribedText}" → "${transcribedText}"`);
        }

        // ── STEP 1: Validate question — ask to repeat if still garbled ────────
        if (!looksLikeValidQuestion(transcribedText)) {
            console.warn('[STT] Question still unclear after correction, asking to repeat.');
            return "Sorry, I did not catch that clearly. Could you please repeat the question?";
        }

        const opik = await getOpik();
        const trace = opik ? opik.trace({
            name: 'generate_response',
            input: { rawTranscribedText, correctedText: transcribedText, mcpContext, toneSettings }
        }) : null;

        // ── System prompt (who the candidate is) ─────────────────────────────
        const systemPrompt = `
You are a SENIOR SOFTWARE ENGINEER candidate in a real job interview.
You have 13+ years of experience as a full-stack developer.

Your strengths:
- Backend development, system architecture, microservices
- APIs, databases, CI/CD, cloud systems
- AI / LLM / RAG systems

Your English is limited. Always use SIMPLE words and SHORT sentences.

=== ANSWER STRUCTURE ===
Every answer must follow this pattern:

PART 1 - Who you are (only for introduction questions):
  Use 6 short sentences.
  Example:
  "Hello, my name is Srinath. I have 13 years of experience in software development.
  I work mainly as a full-stack developer. I build ERP systems and enterprise applications.
  Recently I am working on AI integration for ERP systems.
  I enjoy building scalable systems and solving complex technical problems."

PART 2 - What you work on (for technical questions):
  Use: Problem → What I built → Result

PART 3 - End with one lesson or impact sentence.

=== LANGUAGE RULES ===
BAD:  "I was responsible for orchestrating distributed microservice infrastructure."
GOOD: "I designed the microservice architecture."

Use technical terms instead of fancy English words.

=== BRIDGE SENTENCES (use when needed) ===
- "Let me think for a moment."
- "The main idea is this..."
- "Let me rephrase that."
- "It is easier if I explain step by step."

=== STRICT RULES ===
- NEVER act as the interviewer.
- ONLY answer the question asked.
- Keep answers between 5–10 sentences.
- No complex grammar. No long words.
- Simple. Clear. Direct.
- NEVER invent project names, numbers, accuracy scores, or statistics.
  If you do not have a real example, say: "I can explain this conceptually."

*** TECHNICAL CONTEXT ***
${mcpContext}
`.trim();

        // ── Dynamic tone adjustments ──────────────────────────────────────────
        let toneAdjustment = "";
        if (toneSettings.casual) toneAdjustment += "\nMake it 30% more casual. Real person, real words.";
        if (toneSettings.short) toneAdjustment += "\nCut to 45 seconds spoken. Keep the story, cut the detail.";
        if (toneSettings.technical) toneAdjustment += "\nIncrease technical depth. Interviewer is a Staff Engineer or EM.";
        if (toneSettings.personality) toneAdjustment += "\nPrioritise personality over achievement. Show who you are.";

        // ── Per-question prompt ───────────────────────────────────────────────
        //
        // NOTE: We pass the CORRECTED question here.
        // If STT changed the text, we tell the LLM what it corrected FROM so it
        // is transparent and does not second-guess itself.
        const correctionNote = wasChanged
            ? `Note: Whisper transcribed "${rawTranscribedText}" — auto-corrected to "${transcribedText}".`
            : '';

        const perQuestionPrompt = `
${correctionNote}

Interview question: "${transcribedText}"

Candidate background:
${this.contextText || '(No background document loaded)'}

=== YOUR ANSWER STRUCTURE ===
Step 1 - Direct short answer (1–2 sentences)
Step 2 - Real example: Problem → What I built → Result
Step 3 - One clear conclusion (result or lesson learned)

=== LANGUAGE STYLE ===
Use short sentences. Use technical words. Avoid fancy English.

Good answer example:
"I have 13 years experience as a full-stack developer.
I worked mostly with PHP, Java, Angular, and cloud systems.

The problem was our ERP had slow reporting.
I moved reports to a separate microservice using FastAPI and async processing.
Report generation improved by 60%.

I always try to separate heavy tasks from the main system."

=== RULES ===
- 5 to 10 sentences only.
- Simple English only.
- Use only real project examples from the candidate background above.
- If no real example fits, explain the concept simply instead of inventing one.
- End with one clear result or lesson.

${toneAdjustment ? `--- TONE ADJUSTMENTS ---\n${toneAdjustment}` : ''}
`.trim();

        let finalAnswer = "";

        // ── 1. Mistral AI (Primary) ───────────────────────────────────────────
        const mistralSpan = trace ? trace.span({
            name: 'mistral_call',
            type: 'llm',
            input: { model: 'mistral-small-latest' }
        }) : null;
        try {
            console.log("Attempting Mistral AI...");
            const mistralResponse = await axios.post(
                'https://api.mistral.ai/v1/chat/completions',
                {
                    model: 'mistral-small-latest',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: perQuestionPrompt }
                    ],
                    temperature: 0.7,
                    max_tokens: 300
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${MISTRAL_API_KEY}`
                    },
                    timeout: 10000
                }
            );

            const content = mistralResponse.data?.choices?.[0]?.message?.content;
            if (content) {
                console.log("Mistral AI success.");
                finalAnswer = content;
                if (mistralSpan) mistralSpan.update({
                    output: { content: finalAnswer },
                    usage: mistralResponse.data.usage
                });
            }
        } catch (err) {
            console.warn("Mistral AI failed:", err.message);
            if (mistralSpan) mistralSpan.update({ output: { error: err.message } });
        } finally {
            if (mistralSpan) mistralSpan.end();
        }

        if (finalAnswer) {
            if (trace) { trace.update({ output: { content: finalAnswer } }); trace.end(); }
            if (opik) await opik.flush();
            return finalAnswer;
        }
        // ── 2. Ollama (Local fallback) ────────────────────────────────────────
        const ollamaSpan = trace ? trace.span({
            name: 'ollama_call',
            type: 'llm',
            input: { model: 'llama3.2:1b' }
        }) : null;
        try {
            console.log("Trying Ollama...");
            const response = await axios.post('http://localhost:11434/api/generate', {
                model: 'llama3.2:1b',
                prompt: perQuestionPrompt,
                system: systemPrompt,
                stream: false,
                options: { temperature: 0.7 }
            }, { timeout: 15000 });

            const content = response.data?.response;
            if (content) {
                finalAnswer = content;
                if (ollamaSpan) ollamaSpan.update({ output: { content: finalAnswer } });
            }
        } catch (error) {
            console.warn("Ollama failed:", error.message);
            if (ollamaSpan) ollamaSpan.update({ output: { error: error.message } });
        } finally {
            if (ollamaSpan) ollamaSpan.end();
        }

        if (finalAnswer) {
            if (trace) { trace.update({ output: { content: finalAnswer } }); trace.end(); }
            if (opik) await opik.flush();
            return finalAnswer;
        }

        // ── 3. Puter AI (Last resort) ─────────────────────────────────────────
        if (this.puterInvoker) {
            const puterSpan = trace ? trace.span({
                name: 'puter_ai_call',
                type: 'llm',
                input: {}
            }) : null;
            try {
                console.log("Trying Puter AI...");
                const puterResponse = await this.puterInvoker(systemPrompt, perQuestionPrompt);
                if (puterResponse && puterResponse.trim().length > 0) {
                    console.log("Puter AI success.");
                    finalAnswer = puterResponse;
                    if (puterSpan) puterSpan.update({ output: { content: finalAnswer } });
                }
            } catch (err) {
                console.warn("Puter AI failed:", err.message);
                if (puterSpan) puterSpan.update({ output: { error: err.message } });
            } finally {
                if (puterSpan) puterSpan.end();
            }
        }

        if (finalAnswer) {
            if (trace) { trace.update({ output: { content: finalAnswer } }); trace.end(); }
            if (opik) await opik.flush();
            return finalAnswer;
        }

        // ── All options exhausted ─────────────────────────────────────────────
        const errorMsg = "Error: All LLM options failed (Mistral, Ollama, Puter). Please check your connection.";
        if (trace) { trace.update({ output: { error: errorMsg } }); trace.end(); }
        if (opik) await opik.flush();
        return errorMsg;
    }

    async generateVisionResponse(base64Image) {
        if (!base64Image) return "";

        const opik = await getOpik();
        const trace = opik ? opik.trace({
            name: 'vision_request',
            input: { model: 'llava:7b' }
        }) : null;

        const prompt = "You are a senior software engineer helping a candidate. Analyze the screenshot which contains a coding or technical interview question and provide a short, direct, and correct answer.";

        try {
            console.log("Attempting Vision LLM (LLaVA)...");
            const span = trace ? trace.span({
                name: 'llava_call',
                type: 'llm',
                input: { model: 'llava:7b' }
            }) : null;

            const response = await axios.post('http://localhost:11434/api/generate', {
                model: 'llava:7b',
                prompt,
                images: [base64Image],
                stream: false,
                options: { temperature: 0.2 }
            }, { timeout: 70000 });

            if (response.data && response.data.response) {
                const answer = response.data.response;
                if (span) { span.update({ output: { content: answer } }); span.end(); }
                if (trace) { trace.update({ output: { content: answer } }); trace.end(); }
                if (opik) await opik.flush();
                return answer;
            }
        } catch (error) {
            console.error("Vision LLM failed:", error.message);
            if (trace) { trace.update({ output: { error: error.message } }); trace.end(); }
            if (opik) await opik.flush();
        }

        return "Error: Vision LLM (llava:7b) failed to analyze the screenshot.";
    }
}

module.exports = new RagHelper();
