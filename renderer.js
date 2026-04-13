const deviceSelect = document.getElementById('device-select');
const btnSelectFiles = document.getElementById('btn-select-files');
const fileList = document.getElementById('file-list');
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const statusBar = document.getElementById('status-bar');
const mcpInput = document.getElementById('mcp-input');
const btnAddMcp = document.getElementById('btn-add-mcp');
const mcpList = document.getElementById('mcp-list');

let audioContext;
let processor;
let mediaStream;

// 1. Populate Devices
async function loadDevices() {
    try {
        // Need to ask for permission first to get labels
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioDevices = devices.filter(d => d.kind === 'audioinput');
        
        deviceSelect.innerHTML = '<option value="">Select your Microphone...</option>';
        audioDevices.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.textContent = d.label || `Microphone ${deviceSelect.length + 1}`;
            deviceSelect.appendChild(opt);
        });
    } catch (e) {
        console.error("Error getting devices:", e);
        deviceSelect.innerHTML = '<option value="">Permission denied / No device</option>';
    }
}
loadDevices();

// 2. File Selection
btnSelectFiles.addEventListener('click', async () => {
    const files = await window.api.selectContextFiles();
    fileList.innerHTML = '';
    if (files && files.length > 0) {
        files.forEach(f => {
            const li = document.createElement('li');
            // Show basename
            li.textContent = f.split('\\').pop().split('/').pop();
            li.title = f;
            fileList.appendChild(li);
        });
    } else {
        fileList.innerHTML = '<li>No files selected.</li>';
    }
});

// 3. Audio Capture Logic
let micStream;
let systemStream;
let micProcessor;
let systemProcessor;

btnStart.addEventListener('click', async () => {
    const micDeviceId = deviceSelect.value;
    if (!micDeviceId) return alert("Please select a Microphone for your voice (Candidate). System audio will be captured automatically.");

    try {
        // 1. Capture Candidate Voice (Microphone)
        micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: { exact: micDeviceId },
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        // 2. Capture Interviewer Voice (System Audio)
        const sourceId = await window.api.getDesktopSource();
        if (!sourceId) throw new Error("Could not get desktop source");
        
        systemStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: 'desktop'
                }
            },
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: sourceId
                }
            }
        });

        console.log("System Stream Tracks:", systemStream.getTracks().map(t => `${t.kind}: ${t.label}`));
        if (systemStream.getAudioTracks().length === 0) {
            console.warn("No audio track found in system stream! System audio capture might fail.");
        }

        // We MUST KEEP the video track alive for system audio
        let hiddenVideo = document.getElementById('hidden-screen-video');
        if (!hiddenVideo) {
            hiddenVideo = document.createElement('video');
            hiddenVideo.id = 'hidden-screen-video';
            hiddenVideo.style.display = 'none';
            hiddenVideo.muted = true;
            document.body.appendChild(hiddenVideo);
        }
        hiddenVideo.srcObject = systemStream;
        hiddenVideo.play().catch(e => console.error("Playback failed for dummy video", e));

        // Use AudioContext to extract raw PCM chunks for BOTH
        audioContext = new AudioContext({ sampleRate: 16000 });
        
        // --- Setup MIC Processor ---
        const micSource = audioContext.createMediaStreamSource(micStream);
        micProcessor = audioContext.createScriptProcessor(16384, 1, 1);
        micSource.connect(micProcessor);
        micProcessor.connect(audioContext.destination);
        
        micProcessor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const chunk = new Float32Array(inputData);
            window.api.sendAudioChunk({ chunk, source: 'mic' }, 16000);
        };

        // --- Setup SYSTEM Processor ---
        const sysSource = audioContext.createMediaStreamSource(systemStream);
        systemProcessor = audioContext.createScriptProcessor(16384, 1, 1);
        sysSource.connect(systemProcessor);
        systemProcessor.connect(audioContext.destination);
        
        systemProcessor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const chunk = new Float32Array(inputData);
            window.api.sendAudioChunk({ chunk, source: 'system' }, 16000);
        };

        window.api.startCapture(deviceSelect.options[deviceSelect.selectedIndex].text);
        
        btnStart.style.display = 'none';
        btnStop.style.display = 'flex';
        statusBar.style.display = 'flex';
        statusBar.innerHTML = '<span class="pulse"></span> Recording: Candidate (Mic) + Interviewer (System)';
        
    } catch (e) {
        console.error("Failed to start dual recording:", e);
        alert("Failed to access audio devices. Ensure permissions are granted.");
    }
});

btnStop.addEventListener('click', () => {
    if (micProcessor) {
        micProcessor.disconnect();
        micProcessor = null;
    }
    if (systemProcessor) {
        systemProcessor.disconnect();
        systemProcessor = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    if (micStream) {
        micStream.getTracks().forEach(t => t.stop());
        micStream = null;
    }
    if (systemStream) {
        systemStream.getTracks().forEach(t => t.stop());
        systemStream = null;
    }

    window.api.stopCapture();
    
    btnStop.style.display = 'none';
    btnStart.style.display = 'flex';
    statusBar.style.display = 'none';
});

// MCP Management
async function refreshMcpList() {
    const servers = await window.api.getMcpServers();
    mcpList.innerHTML = '';
    if (servers.length === 0) {
        mcpList.innerHTML = '<li>No MCP servers connected.</li>';
        return;
    }
    servers.forEach(s => {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.alignItems = 'center';
        li.innerHTML = `
            <span>${s}</span>
            <button class="danger" style="padding: 2px 8px; font-size: 10px;">Remove</button>
        `;
        li.querySelector('button').onclick = async () => {
            await window.api.removeMcpServer(s);
            refreshMcpList();
        };
        mcpList.appendChild(li);
    });
}

btnAddMcp.addEventListener('click', async () => {
    const config = mcpInput.value.trim();
    if (config) {
        const success = await window.api.addMcpServer(config);
        if (success) {
            mcpInput.value = '';
            refreshMcpList();
        } else {
            alert("Failed to connect to MCP server. Check console for details.");
        }
    }
});

// 4. Overlay Repositioning
const btnReposition = document.getElementById('btn-reposition-overlay');
let overlayLocked = true;

btnReposition.addEventListener('click', () => {
    overlayLocked = !overlayLocked;
    
    // Send to main process
    window.api.toggleOverlayLock(overlayLocked);
    
    // Update UI
    if (overlayLocked) {
        btnReposition.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"></path><path d="M9 21H3v-6"></path><path d="M21 3l-7 7"></path><path d="M3 21l7-7"></path></svg>
            Unlock & Reposition Overlay
        `;
        btnReposition.style.borderColor = 'var(--glass-border)';
        btnReposition.style.background = 'rgba(15, 23, 42, 0.8)';
    } else {
        btnReposition.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            Lock Overlay Position
        `;
        btnReposition.style.borderColor = 'var(--accent)';
        btnReposition.style.background = 'rgba(139, 92, 246, 0.2)';
    }
});

refreshMcpList();

// Tone Adjustments listener
const toneCasual = document.getElementById('tone-casual');
const toneShort = document.getElementById('tone-short');
const toneTechnical = document.getElementById('tone-technical');
const tonePersonality = document.getElementById('tone-personality');

function sendToneUpdate() {
    window.api.updateToneSettings({
        casual: toneCasual.checked,
        short: toneShort.checked,
        technical: toneTechnical.checked,
        personality: tonePersonality.checked
    });
}

[toneCasual, toneShort, toneTechnical, tonePersonality].forEach(el => {
    if (el) el.addEventListener('change', sendToneUpdate);
});

// Search Settings
const searchPriority = document.getElementById('search-priority');
const searchShowBoth = document.getElementById('search-show-both');

function sendSearchSettings() {
    window.api.updateSearchSettings({
        searchPriority: searchPriority.checked,
        showBoth: searchShowBoth.checked
    });
}

[searchPriority, searchShowBoth].forEach(el => {
    if (el) el.addEventListener('change', sendSearchSettings);
});
sendSearchSettings();

// 5. Content Protection
const btnToggleProtection = document.getElementById('btn-toggle-protection');
const protectionStatus = document.getElementById('protection-status');
let contentProtected = true;

function updateProtectionUI(enabled) {
    contentProtected = enabled;
    if (enabled) {
        btnToggleProtection.textContent = 'Disable Protection';
        protectionStatus.innerHTML = '<div class="status-dot" style="background: #4ade80;"></div> PROTECTED';
        protectionStatus.style.background = 'rgba(34, 197, 94, 0.2)';
        protectionStatus.style.borderColor = 'rgba(34, 197, 94, 0.3)';
        protectionStatus.style.color = '#4ade80';
    } else {
        btnToggleProtection.textContent = 'Enable Protection';
        protectionStatus.innerHTML = '<div class="status-dot" style="background: #ef4444;"></div> VISIBLE';
        protectionStatus.style.background = 'rgba(239, 68, 68, 0.2)';
        protectionStatus.style.borderColor = 'rgba(239, 68, 68, 0.3)';
        protectionStatus.style.color = '#f87171';
    }
}

btnToggleProtection.addEventListener('click', () => {
    window.api.toggleContentProtection(!contentProtected);
});

window.api.onContentProtectionStatus(({ enabled }) => {
    updateProtectionUI(enabled);
});

// Sync initial status
(async () => {
    const status = await window.api.getContentProtectionStatus();
    updateProtectionUI(status);
})();
