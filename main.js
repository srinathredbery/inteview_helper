try {
    require('dotenv').config();
    console.log('1. Dotenv loaded');
    const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, globalShortcut } = require('electron');
    const path = require('path');
    const ragHelper = require('./rag-helper');
    console.log('2. RagHelper required');
    const mcpManager = require('./mcp-manager');
    console.log('3. McpManager required');
    const SearchEngine = require('./searchengine');
    const searchEngine = new SearchEngine(path.join(__dirname, 'json', 'hr_interview_questions.json'));
    console.log('3a. SearchEngine initialized');

    let controlWindow;
    let overlayWindow;
    let workerWindow;
    let puterAiWindow;
    let isContentProtected = true;

    function createWindows() {
        console.log('4. createWindows called');
        controlWindow = new BrowserWindow({
            width: 600,
            height: 800,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js')
            },
            autoHideMenuBar: true,
            title: "Interview Assistant Control Panel"
        });
        controlWindow.loadFile('index.html');
        controlWindow.setContentProtection(true);

        overlayWindow = new BrowserWindow({
            width: 600,
            height: 600,
            x: 50,
            y: 50,
            transparent: true,
            frame: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js')
            }
        });
        overlayWindow.setIgnoreMouseEvents(true, { forward: true });
        overlayWindow.loadFile('overlay.html');
        overlayWindow.setContentProtection(true);
        
        overlayWindow.once('ready-to-show', () => {
            overlayWindow.setIgnoreMouseEvents(true, { forward: true });
            console.log("Overlay click-through active.");
        });

        workerWindow = new BrowserWindow({
            show: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                backgroundThrottling: false
            }
        });
        workerWindow.loadFile('process-worker.html');

        puterAiWindow = new BrowserWindow({
            show: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                backgroundThrottling: false
            }
        });
        puterAiWindow.loadFile('puter-ai-worker.html');

        registerShortcuts();
    }

    function registerShortcuts() {
        const nudge = 10;
        globalShortcut.register('Alt+Up',    () => moveOverlay(0, -nudge));
        globalShortcut.register('Alt+Down',  () => moveOverlay(0, nudge));
        globalShortcut.register('Alt+Left',  () => moveOverlay(-nudge, 0));
        globalShortcut.register('Alt+Right', () => moveOverlay(nudge, 0));

        globalShortcut.register('Alt+H', () => {
            if (controlWindow && !controlWindow.isDestroyed()) {
                if (controlWindow.isVisible()) {
                    controlWindow.hide();
                } else {
                    controlWindow.show();
                    controlWindow.restore();
                    controlWindow.focus();
                }
            }
        });

        globalShortcut.register('CommandOrControl+Shift+S', async () => {
            console.log("Vision Capture Triggered");
            try {
                if (overlayWindow && !overlayWindow.isDestroyed()) {
                    overlayWindow.webContents.send('llm-result', { text: "🔍 Capturing screen..." });
                }
                const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } });
                const source = sources[0];
                if (!source.thumbnail || source.thumbnail.isEmpty()) {
                    console.error("Desktop capture failed: Thumbnail is empty.");
                    return;
                }
                const base64Image = source.thumbnail.toJPEG(70).toString('base64');
                
                if (overlayWindow && !overlayWindow.isDestroyed()) {
                    overlayWindow.webContents.send('llm-result', { text: "🧠 Analyzing..." });
                }
                const answer = await ragHelper.generateVisionResponse(base64Image);
                [controlWindow, overlayWindow].forEach(win => {
                    if (win && !win.isDestroyed()) win.webContents.send('llm-result', { text: answer });
                });
            } catch (e) {
                console.error(e);
            }
        });
    }

    function moveOverlay(dx, dy) {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            const [x, y] = overlayWindow.getPosition();
            overlayWindow.setPosition(x + dx, y + dy);
        }
    }

    console.log('5. app.whenReady called');
    app.whenReady().then(() => {
        console.log('6. app is ready');
        createWindows();
    });

    app.on('will-quit', () => globalShortcut.unregisterAll());
    app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

    ipcMain.handle('select-context-files', async () => {
        const result = await dialog.showOpenDialog(controlWindow, {
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: 'Documents', extensions: ['txt', 'md', 'pdf'] }]
        });
        if (!result.canceled) {
            await ragHelper.setContextFiles(result.filePaths);
            return result.filePaths;
        }
        return ragHelper.getContextFiles();
    });

    ipcMain.handle('get-context-files', () => ragHelper.getContextFiles());
    ipcMain.handle('get-desktop-source', async () => {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        return sources.length > 0 ? sources[0].id : null;
    });

    ipcMain.handle('add-mcp-server',    (_, cfg) => mcpManager.addServer(cfg));
    ipcMain.handle('get-mcp-servers',   ()       => mcpManager.getServers());
    ipcMain.handle('remove-mcp-server', (_, cfg) => mcpManager.removeServer(cfg));

    ipcMain.on('start-capture', (_, { deviceLabel }) => console.log("Capture Start:", deviceLabel));
    ipcMain.on('stop-capture',  ()                   => console.log("Capture Stop"));

    ipcMain.on('audio-chunk', (_, data) => {
        if (workerWindow && !workerWindow.isDestroyed()) {
            workerWindow.webContents.send('audio-chunk-worker', data);
        }
    });

    let sessionTone = { casual: false, short: false, technical: false, personality: false };
    let searchSettings = { showBoth: false, searchPriority: true };

    ipcMain.on('update-tone-settings', (_, settings) => sessionTone = settings);
    ipcMain.on('update-search-settings', (_, settings) => searchSettings = settings);

    ipcMain.on('transcription-result', async (_, data) => {
        if (controlWindow && !controlWindow.isDestroyed()) controlWindow.webContents.send('transcription-result', data);
        if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send('transcription-result', data);

        if (data.source === 'system' && data.text.trim().length > 3) {
            let searchResult = searchEngine.search(data.text);
            console.log(`[IPC] Search result for "${data.text}":`, searchResult ? "Found" : "Not Found");
            
            // 1. Send search result immediately if found
            if (searchResult) {
                [controlWindow, overlayWindow].forEach(win => {
                    if (win && !win.isDestroyed()) win.webContents.send('search-result', { 
                        question: searchResult.question, 
                        answer: searchResult.answer 
                    });
                });
            }

            let llmAnswer = "";
            const shouldCallLLM = !searchResult || searchSettings.showBoth || !searchSettings.searchPriority;
            
            if (shouldCallLLM) {
                // Send "Analyzing..." to background UI
                [controlWindow, overlayWindow].forEach(win => {
                    if (win && !win.isDestroyed()) win.webContents.send('ai-activity', { 
                        status: 'analyzing', 
                        query: data.text,
                        isMatchVisible: !!searchResult // Tells UI to show thinking placeholder below match
                    });
                });
                const mcpContext = await mcpManager.getContextFromAll(data.text);
                llmAnswer = await ragHelper.generateResponse(data.text, mcpContext, sessionTone);
            }
            let finalAnswer = "";
            if (searchSettings.showBoth) {
                finalAnswer = searchResult ? `**[MATCHED]** ${searchResult.answer}\n\n**[AI]** ${llmAnswer}` : llmAnswer;
            } else if (searchSettings.searchPriority && searchResult) {
                finalAnswer = searchResult.answer;
            } else {
                finalAnswer = llmAnswer;
            }
            [controlWindow, overlayWindow].forEach(win => {
                if (win && !win.isDestroyed()) win.webContents.send('llm-result', { 
                    text: finalAnswer, 
                    searchMatch: !!searchResult,
                    searchAnswer: searchResult ? searchResult.answer : null,
                    aiResponse: llmAnswer 
                });
            });
        }
    });

    const puterRequests = new Map();
    async function askPuter(system, user) {
        return new Promise((resolve, reject) => {
            if (!puterAiWindow || puterAiWindow.isDestroyed()) return reject(new Error("Worker offline"));
            const id = Math.random().toString(36).substr(2, 9);
            puterRequests.set(id, { resolve, reject, timeout: setTimeout(() => {
                puterRequests.delete(id);
                reject(new Error("Timeout"));
            }, 30000) });
            puterAiWindow.webContents.send('puter-ai-request', { id, systemPrompt: system, userPrompt: user });
        });
    }
    ragHelper.puterInvoker = askPuter;

    ipcMain.handle('ask-puter-ai', (_, data) => askPuter(data.systemPrompt, data.userPrompt));
    ipcMain.on('puter-ai-response', (_, { id, success, text, error }) => {
        const req = puterRequests.get(id);
        if (req) {
            clearTimeout(req.timeout);
            puterRequests.delete(id);
            if (success) req.resolve(text); else req.reject(new Error(error));
        }
    });

    ipcMain.on('toggle-overlay-lock', (_, { locked }) => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.setIgnoreMouseEvents(locked, { forward: locked });
            overlayWindow.webContents.send('overlay-lock-status', { locked });
            if (!locked) overlayWindow.webContents.send('show-edit-mode');
        }
    });

    ipcMain.on('toggle-content-protection', (event, { enabled }) => {
        isContentProtected = enabled;
        [controlWindow, overlayWindow].forEach(win => {
            if (win && !win.isDestroyed()) {
                win.setContentProtection(isContentProtected);
                win.webContents.send('content-protection-status', { enabled: isContentProtected });
            }
        });
    });

    ipcMain.handle('get-content-protection-status', () => isContentProtected);
} catch (err) {
    console.error('FATAL STARTUP ERROR:', err);
    process.exit(1);
}
