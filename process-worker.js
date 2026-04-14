const { ipcRenderer } = require('electron');
const { pipeline, env } = require('@huggingface/transformers');

// Optimize for Node runtime inside Electron
env.allowLocalModels = false; // Force Hub download initially
env.useBrowserCache = false; // FIX: Prevent Electron DOM Cache.put NetworkError
env.useCustomCache = false;

let transcriber = null;
const buffers = {
    mic: [],
    system: []
};
const processing = {
    mic: false,
    system: false
};
const SAMPLE_RATE = 16000;

async function init() {
    console.log("Initializing STT Pipeline...");
    // Load tiny whisper model for speed
    transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
        progress_callback: data => {
            if (data.status === 'progress') {
                console.log(`Downloading ${data.file}: ${data.progress.toFixed(2)}%`);
            }
        }
    });
    console.log("Whisper Pipeline ready.");
    ipcRenderer.send('worker-ready');
}

init();

// Simple check to prevent sending pure silence
function containsSpeech(audioArr) {
    let max = 0;
    for (let i = 0; i < audioArr.length; i++) {
        if (Math.abs(audioArr[i]) > max) max = Math.abs(audioArr[i]);
    }
    // Lowered threshold to 0.01 for better sensitivity with system audio
    return max > 0.01; 
}

ipcRenderer.on('audio-chunk-worker', async (event, data) => {
    const { chunk, source } = data;
    if (!buffers[source]) return;

    // Reconstruct Float32Array from IPC data
    let chunkArray;
    if (chunk instanceof Float32Array) {
        chunkArray = chunk;
    } else if (chunk.buffer) {
        chunkArray = new Float32Array(chunk.buffer);
    } else {
        chunkArray = Object.values(chunk);
    }

    buffers[source].push(...chunkArray);
    
    // Signal main process that we are ready for the next chunk (Backpressure)
    ipcRenderer.send('worker-ready');

    // Process every ~3 seconds (48000 samples)
    if (buffers[source].length >= 48000 && !processing[source]) {
        const bufferToProcess = new Float32Array(buffers[source]);
        buffers[source] = []; 
        
        if (containsSpeech(bufferToProcess)) {
            console.log(`[Worker] Detected speech on ${source}, starting STT...`);
            processBuffer(bufferToProcess, source); 
        } else {
            // Optional: console.log(`[Worker] Silence on ${source}`);
        }
    }
});

async function processBuffer(float32ArrayData, source) {
    if (!transcriber) return;
    processing[source] = true;
    try {
        const output = await transcriber(float32ArrayData);
        if (output && output.text && output.text.trim().length > 2) {
             const cleanedText = output.text.trim();
             console.log(`[${source}] Transcribed:`, cleanedText);
             // Send back to main process with source
             ipcRenderer.send('transcription-result', { 
                 text: cleanedText, 
                 source: source,
                 time: Date.now() 
             });
        }
    } catch(err) {
        console.error(`STT Error [${source}]`, err);
    }
    processing[source] = false;
}
