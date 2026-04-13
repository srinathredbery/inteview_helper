const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Media/WebRTC specific methods if needed, but standard navigator works
    
    // Config and commands
    selectContextFiles: () => ipcRenderer.invoke('select-context-files'),
    getContextFiles: () => ipcRenderer.invoke('get-context-files'),
    getDesktopSource: () => ipcRenderer.invoke('get-desktop-source'),
    
    // MCP Methods
    addMcpServer: (config) => ipcRenderer.invoke('add-mcp-server', config),
    getMcpServers: () => ipcRenderer.invoke('get-mcp-servers'),
    removeMcpServer: (config) => ipcRenderer.invoke('remove-mcp-server', config),
    
    // Pass audio to main
    sendAudioChunk: (data, sampleRate) => ipcRenderer.send('audio-chunk', { ...data, sampleRate }),
    startCapture: (deviceLabel) => ipcRenderer.send('start-capture', { deviceLabel }),
    stopCapture: () => ipcRenderer.send('stop-capture'),

    // Listen to results
    onTranscription: (callback) => ipcRenderer.on('transcription-result', (_event, data) => callback(data)),
    onLlmResult: (callback) => ipcRenderer.on('llm-result', (_event, data) => callback(data)),
    
    // For worker specifically
    onAudioChunk: (callback) => ipcRenderer.on('audio-chunk-worker', (_event, data) => callback(data)),
    sendTranscriptionResult: (text, audioId) => ipcRenderer.send('transcription-result', { text, audioId }),
    
    // Control and status of the overlay positioning
    toggleOverlayLock: (locked) => ipcRenderer.send('toggle-overlay-lock', { locked }),
    onOverlayStatus: (callback) => ipcRenderer.on('overlay-lock-status', (_event, data) => callback(data)),
    onShowEditMode: (callback) => ipcRenderer.on('show-edit-mode', (_event) => callback()),
    
    // Tone settings
    updateToneSettings: (settings) => ipcRenderer.send('update-tone-settings', settings),

    // Content Protection
    toggleContentProtection: (enabled) => ipcRenderer.send('toggle-content-protection', { enabled }),
    onContentProtectionStatus: (callback) => ipcRenderer.on('content-protection-status', (_event, data) => callback(data)),
    getContentProtectionStatus: () => ipcRenderer.invoke('get-content-protection-status'),

    // Search and AI background work
    updateSearchSettings: (settings) => ipcRenderer.send('update-search-settings', settings),
    onAiActivity: (callback) => ipcRenderer.on('ai-activity', (_event, data) => callback(data)),
    onSearchResult: (callback) => ipcRenderer.on('search-result', (_event, data) => callback(data))
});
