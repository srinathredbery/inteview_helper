const displayPanel = document.getElementById('display-panel');
const transcriptionBox = document.getElementById('transcription-box');
const llmBox = document.getElementById('llm-box');

let hideTimeout = null;

function resetHideTimer() {
    clearTimeout(hideTimeout);
    // Hide panel if no activity for 30 seconds
    hideTimeout = setTimeout(() => {
        displayPanel.style.display = 'none';
    }, 30000);
}

window.api.onTranscription((data) => {
    displayPanel.style.display = 'block';
    
    // Formatting: Label whose voice it is
    const label = data.source === 'mic' ? 'Me' : 'Interviewer';
    const colorClass = data.source === 'mic' ? 'color: var(--text); opacity: 0.7;' : 'color: var(--accent);';
    
    transcriptionBox.innerHTML = `<span style="${colorClass} font-weight: 500;">${label}:</span> "${data.text}"`;
    
    // Dim the LLM box while we wait for new answer IF the interviewer is speaking
    if (data.source === 'system') {
        llmBox.style.opacity = '0.5';
    }
    
    resetHideTimer();
});

let currentHighlightInterval = null;

function animateText(text) {
    if (currentHighlightInterval) {
        clearInterval(currentHighlightInterval);
        currentHighlightInterval = null;
    }

    // Prepare text: strip markdown bullets, then split by whitespace
    const cleanText = text.replace(/^[*-]\s/gm, "").replace(/\n/g, " ");
    const words = cleanText.split(/\s+/).filter(w => w.length > 0);
    
    llmBox.innerHTML = '';
    const spans = [];

    words.forEach(word => {
        const span = document.createElement('span');
        span.className = 'word-span';
        span.textContent = word + ' ';
        llmBox.appendChild(span);
        spans.push(span);
    });

    let index = 0;
    const wpm = 120; // 120 Words per minute is a slower, more deliberate reading pace
    const delay = (60 / wpm) * 1000;

    currentHighlightInterval = setInterval(() => {
        if (index < spans.length) {
            // Keep previous highlighted, just dim them or mark as done?
            // "Karoke song" usually means current is active. Let's make current ACTIVE.
            if (index > 0) spans[index - 1].classList.remove('active');
            spans[index].classList.add('active');
            
            // Auto scroll container
            spans[index].scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });

            index++;
        } else {
            clearInterval(currentHighlightInterval);
            // Optionally leave the last one highlighted
        }
    }, delay);
}

window.api.onLlmResult((data) => {
    displayPanel.style.display = 'block';
    llmBox.style.opacity = '1';
    
    // Animate the text karaoke style
    animateText(data.text);
    
    resetHideTimer();
});

// Positioning controls
const dragHandle = document.getElementById('drag-handle');
const editInfo = document.getElementById('edit-info');

window.api.onOverlayStatus((data) => {
    if (data.locked) {
        dragHandle.style.display = 'none';
        editInfo.style.display = 'none';
        displayPanel.classList.remove('editable');
        resetHideTimer();
    } else {
        clearTimeout(hideTimeout);
        dragHandle.style.display = 'flex';
        editInfo.style.display = 'block';
        displayPanel.style.display = 'block';
        displayPanel.classList.add('editable');
    }
});

window.api.onShowEditMode(() => {
    clearTimeout(hideTimeout);
    displayPanel.style.display = 'block';
    displayPanel.classList.add('editable');
    dragHandle.style.display = 'flex';
    editInfo.style.display = 'block';
});
