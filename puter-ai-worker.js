const { ipcRenderer } = require('electron');

console.log("Puter AI Worker Initialized");

ipcRenderer.on('puter-ai-request', async (event, { id, systemPrompt, userPrompt }) => {
    try {
        console.log("[PuterAI] Processing request ID:", id);
        
        // Puter AI Chat call
        // The second argument in puter.ai.chat can be a system prompt or options
        const response = await puter.ai.chat(userPrompt, { system_prompt: systemPrompt });
        
        // Puter response handling
        let resultText = "";
        if (typeof response === 'string') {
            resultText = response;
        } else if (response && response.message && response.message.content) {
            resultText = response.message.content;
        } else if (response && response.toString) {
            resultText = response.toString();
        }

        console.log("[PuterAI] Success for ID:", id);
        ipcRenderer.send('puter-ai-response', { 
            id, 
            success: true, 
            text: resultText 
        });
    } catch (error) {
        console.error("[PuterAI] Error for ID:", id, error);
        ipcRenderer.send('puter-ai-response', { 
            id, 
            success: false, 
            error: error.message 
        });
    }
});
