const fs = require('fs');
const axios = require('axios');
const pdfParse = require('pdf-parse');

// ─── Load secrets from environment variables ─────────────────────────────────
const OPIK_API_KEY = process.env.OPIK_API_KEY || '';
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

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

    async generateResponse(rawTranscribedText, mcpContext = "", toneSettings = {}, customSystemPrompt = null) {
        let fullText = "";
        await this.generateStreamingResponse(rawTranscribedText, (chunk) => {
            fullText += chunk;
        }, mcpContext, toneSettings, customSystemPrompt);
        return fullText;
    }

    async generateStreamingResponse(rawTranscribedText, onChunk, mcpContext = "", toneSettings = {}, customSystemPrompt = null) {
        if (!rawTranscribedText || rawTranscribedText.trim() === "") return;

        // ── STEP 0: Correct STT errors before anything else ──────────────────
        const { corrected: transcribedText, wasChanged } = correctSTT(rawTranscribedText);

        if (wasChanged) {
            console.log(`[STT Correction] "${rawTranscribedText}" → "${transcribedText}"`);
        }

        // ── STEP 1: Validate question — ask to repeat if still garbled ────────
        if (!looksLikeValidQuestion(transcribedText)) {
            console.warn('[STT] Question still unclear after correction, asking to repeat.');
            onChunk("Sorry, I did not catch that clearly. Could you please repeat the question?");
            return;
        }

        const STT_LAYER = `
=== FIX SPEECH-TO-TEXT ERRORS FIRST ===
The question below came from voice input transcribed by Whisper.
Whisper makes mistakes. Common errors:
- "gentic eye" → "agentic AI"
- "jentic" → "agentic"
- "eye" → "AI"
- "maching" → "machine"

Before answering, silently correct any obvious STT errors.
If the question still makes no sense after correction, say:
"Sorry, I didn't catch that clearly. Could you repeat the question?"
Do NOT answer a garbled question with a made-up answer.
Do NOT invent fake project examples, numbers, or accuracy stats.

=== CORRECTED QUESTION ===
${transcribedText}
`.trim();

        let systemPrompt = "";
        let perQuestionPrompt = "";

        if (customSystemPrompt) {
            systemPrompt = STT_LAYER + "\n\n" + customSystemPrompt;
            perQuestionPrompt = `Please answer using the format specified in your system instructions.`;
        } else {
            // ── Default System prompt (who the candidate is) ─────────────────────────────
            systemPrompt = STT_LAYER + "\n\n" + `
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
            const correctionNote = wasChanged
                ? `Note: Whisper transcribed "${rawTranscribedText}" — auto-corrected to "${transcribedText}".`
                : '';

            perQuestionPrompt = `
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
        }

        const opik = await getOpik();
        const trace = opik ? opik.trace({
            name: 'generate_response',
            input: { 
                rawTranscribedText, 
                correctedText: transcribedText, 
                mcpContext, 
                toneSettings,
                systemPrompt,
                perQuestionPrompt 
            }
        }) : null;

        let success = false;
        let finalAnswer = "";

        // ── 1. Mistral AI (Primary) ───────────────────────────────────────────
        if (MISTRAL_API_KEY) {
            const mistralSpan = trace ? trace.span({
                name: 'mistral_call',
                type: 'llm',
                input: { model: 'mistral-small-latest', prompt: perQuestionPrompt }
            }) : null;
            try {
                console.log("Attempting Mistral AI Streaming...");
                const response = await axios({
                    method: 'post',
                    url: 'https://api.mistral.ai/v1/chat/completions',
                    data: {
                        model: 'mistral-small-latest',
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: perQuestionPrompt }
                        ],
                        temperature: 0.7,
                        max_tokens: 400,
                        stream: true
                    },
                    headers: {
                        'Authorization': `Bearer ${MISTRAL_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    responseType: 'stream',
                    timeout: 10000
                });

                await new Promise((resolve, reject) => {
                    response.data.on('data', chunk => {
                        const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
                        for (const line of lines) {
                            if (line.includes('[DONE]')) return;
                            if (line.startsWith('data: ')) {
                                try {
                                    const json = JSON.parse(line.replace('data: ', ''));
                                    const content = json.choices[0]?.delta?.content || "";
                                    if (content) {
                                        finalAnswer += content;
                                        onChunk(content);
                                    }
                                } catch (e) { /* ignore partial json */ }
                            }
                        }
                    });
                    response.data.on('end', () => { success = true; resolve(); });
                    response.data.on('error', err => reject(err));
                });

                if (mistralSpan) mistralSpan.update({ output: { content: finalAnswer } });
            } catch (err) {
                console.warn("Mistral AI streaming failed:", err.message);
                if (mistralSpan) mistralSpan.update({ output: { error: err.message } });
            } finally {
                if (mistralSpan) mistralSpan.end();
                if (success) {
                    if (trace) { trace.update({ output: { content: finalAnswer } }); trace.end(); }
                    if (opik) await opik.flush();
                    return;
                }
            }
        }

        // ── 2. Ollama (Local fallback) ────────────────────────────────────────
        const ollamaSpan = trace ? trace.span({
            name: 'ollama_call',
            type: 'llm',
            input: { model: 'llama3.2:1b', prompt: perQuestionPrompt }
        }) : null;
        try {
            console.log("Trying Ollama Streaming...");
            const response = await axios({
                method: 'post',
                url: 'http://localhost:11434/api/generate',
                data: {
                    model: 'llama3.2:1b',
                    prompt: perQuestionPrompt,
                    system: systemPrompt,
                    stream: true,
                    options: { temperature: 0.7 }
                },
                responseType: 'stream',
                timeout: 15000
            });

            await new Promise((resolve, reject) => {
                response.data.on('data', chunk => {
                    const lines = chunk.toString().split('\n').filter(l => l.trim());
                    for (const line of lines) {
                        try {
                            const json = JSON.parse(line);
                            if (json.response) {
                                finalAnswer += json.response;
                                onChunk(json.response);
                            }
                            if (json.done) resolve();
                        } catch (e) {}
                    }
                });
                response.data.on('error', err => reject(err));
            });
            success = true;
            if (ollamaSpan) ollamaSpan.update({ output: { content: finalAnswer } });
        } catch (error) {
            console.warn("Ollama streaming failed:", error.message);
            if (ollamaSpan) ollamaSpan.update({ output: { error: error.message } });
        } finally {
            if (ollamaSpan) ollamaSpan.end();
            if (success) {
                if (trace) { trace.update({ output: { content: finalAnswer } }); trace.end(); }
                if (opik) await opik.flush();
                return;
            }
        }

        // ── 3. Puter AI (Last resort) ─────────────────────────────────────────
        if (this.puterInvoker) {
            const puterSpan = trace ? trace.span({
                name: 'puter_ai_call',
                type: 'llm',
                input: { userPrompt: perQuestionPrompt, systemPrompt: systemPrompt }
            }) : null;
            try {
                console.log("Trying Puter AI (No streaming support in invoker yet)...");
                const puterResponse = await this.puterInvoker(systemPrompt, perQuestionPrompt);
                if (puterResponse && puterResponse.trim().length > 0) {
                    finalAnswer = puterResponse;
                    onChunk(puterResponse);
                    success = true;
                    if (puterSpan) puterSpan.update({ output: { content: finalAnswer } });
                }
            } catch (err) {
                console.warn("Puter AI failed:", err.message);
                if (puterSpan) puterSpan.update({ output: { error: err.message } });
            } finally {
                if (puterSpan) puterSpan.end();
            }
        }

        if (success) {
            if (trace) { trace.update({ output: { content: finalAnswer } }); trace.end(); }
            if (opik) await opik.flush();
            return;
        }

        const errorMsg = "Error: All LLM options failed (Mistral, Ollama, Puter).";
        onChunk(errorMsg);
        if (trace) { trace.update({ output: { error: errorMsg } }); trace.end(); }
        if (opik) await opik.flush();
    }

    async generateVisionResponse(base64Image) {
        if (!base64Image) return "";

        const opik = await getOpik();
        const imageSizeKb = Math.round(base64Image.length * 0.75 / 1024);
        console.log(`[Vision] Image size: ~${imageSizeKb} KB`);

        const prompt = "You are a senior software engineer helping a candidate. Analyze the screenshot which contains a coding or technical interview question and provide a short, direct, and correct answer.";

        const trace = opik ? opik.trace({
            name: 'vision_request',
            input: { 
                model_preference: 'gemini-2.0-flash -> llava:7b',
                prompt: prompt,
                image_size_kb: imageSizeKb,
                image_full: `data:image/jpeg;base64,${base64Image}`
            }
        }) : null;

        let finalAnswer = "";
        let errorDetails = [];

        // ── 1. Gemini 2.0 Flash (Primary) ────────────────────────────────────
        if (GEMINI_API_KEY) {
            const geminiSpan = trace ? trace.span({
                name: 'gemini_vision_call',
                type: 'llm',
                input: { model: 'gemini-2.0-flash' }
            }) : null;

            try {
                console.log("Attempting Gemini 2.0 Flash Vision...");
                const response = await axios.post(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
                    {
                        contents: [{
                            parts: [
                                { text: prompt },
                                {
                                    inline_data: {
                                        mime_type: "image/jpeg",
                                        data: base64Image
                                    }
                                }
                            ]
                        }]
                    },
                    { timeout: 30000 }
                );

                const answer = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (answer) {
                    console.log("Gemini Vision success.");
                    finalAnswer = answer;
                    if (geminiSpan) geminiSpan.update({ output: { content: finalAnswer } });
                }
            } catch (err) {
                const errMsg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
                console.warn("Gemini Vision failed:", errMsg);
                errorDetails.push(`Gemini: ${errMsg}`);
                if (geminiSpan) geminiSpan.update({ output: { error: errMsg } });
            } finally {
                if (geminiSpan) geminiSpan.end();
            }
        }

        if (finalAnswer) {
            if (trace) { trace.update({ output: { content: finalAnswer } }); trace.end(); }
            if (opik) await opik.flush();
            return finalAnswer;
        }

        // ── 2. LLaVA (Local fallback) ────────────────────────────────────────
        const llavaSpan = trace ? trace.span({
            name: 'llava_call',
            type: 'llm',
            input: { model: 'llava:7b' }
        }) : null;

        try {
            console.log("Attempting Fallback Vision LLM (LLaVA)...");
            const response = await axios.post('http://localhost:11434/api/generate', {
                model: 'llava:7b',
                prompt,
                images: [base64Image],
                stream: false,
                options: { temperature: 0.2 }
            }, { timeout: 180000 });

            if (response.data && response.data.response) {
                const answer = response.data.response;
                console.log("LLaVA Vision success.");
                finalAnswer = answer;
                if (llavaSpan) llavaSpan.update({ output: { content: finalAnswer } });
            }
        } catch (error) {
            const errMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            console.error("LLaVA Vision failed:", errMsg);
            errorDetails.push(`LLaVA: ${errMsg}`);
            if (llavaSpan) llavaSpan.update({ output: { error: errMsg } });
        } finally {
            if (llavaSpan) llavaSpan.end();
        }

        if (finalAnswer) {
            if (trace) { trace.update({ output: { content: finalAnswer } }); trace.end(); }
            if (opik) await opik.flush();
            return finalAnswer;
        }

        const errorMsg = `Error: All Vision LLM options failed.\nDetails:\n${errorDetails.join('\n')}`;
        console.error(errorMsg);
        if (trace) { trace.update({ output: { error: errorMsg } }); trace.end(); }
        if (opik) await opik.flush();
        return errorMsg;
    }
}

module.exports = new RagHelper();
