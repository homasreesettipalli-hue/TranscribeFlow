// Basic Logic to handle drag and drop and file input triggering

let radarChartInstance = null;

// Initialize on load
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize trial mode manager
    if (window.trialManager) {
        await window.trialManager.initialize();
    }
    fetchHistoryCount();
    initializeCustomDropdown();
});

function triggerUpload() {
    document.getElementById('fileInput').click();
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
        uploadFile(file);
    }
}

function handleDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.add('bg-white/10');
}

function handleDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove('bg-white/10');
}

function handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove('bg-white/10');

    const files = event.dataTransfer.files;
    if (files.length > 0) {
        uploadFile(files[0]);
    }
}

function fetchHistoryCount() {
    fetch('/history')
        .then(response => response.json())
        .then(data => {
            const count = Array.isArray(data) ? data.length : 0;
            const historyBadge = document.getElementById('history-count');
            if (historyBadge) {
                historyBadge.innerText = `${count} FILES`;
            }
        })
        .catch(err => console.error("Failed to fetch history:", err));
}


// ─── File Validation ─────────────────────────────────────────────────────────
const ALLOWED_TYPES = ['audio/mpeg','audio/wav','audio/mp4','audio/ogg','audio/flac','audio/webm','video/mp4','video/quicktime','audio/x-m4a','audio/m4a'];
const ALLOWED_EXTS  = ['.mp3','.wav','.mp4','.mov','.m4a','.ogg','.flac','.webm'];
const MAX_SIZE_MB   = 100;

function validateFile(file) {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    const typeOk = ALLOWED_TYPES.includes(file.type) || ALLOWED_EXTS.includes(ext);
    if (!typeOk) {
        notify.error(`Unsupported file type "${ext}". Allowed: MP3, WAV, MP4, MOV, M4A, OGG, FLAC, WEBM`);
        return false;
    }
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > MAX_SIZE_MB) {
        notify.error(`File too large (${sizeMB.toFixed(1)}MB). Max ${MAX_SIZE_MB}MB.`);
        return false;
    }
    return true;
}

function uploadFile(file) {
    // Frontend validation
    if (!validateFile(file)) return;

    // Check trial limit
    if (window.trialManager && !window.trialManager.canUpload()) {
        window.trialManager.showLimitBanner();
        notify.warning('Free trial limit reached! Please sign in to continue.', 5000);
        return;
    }

    const formData = new FormData();
    formData.append('audio', file);

    // Get selected target language
    const targetLang = document.getElementById('target-language')?.value || 'original';
    formData.append('target_lang', targetLang);

    // Get diarization toggle state
    const enableDiarization = document.getElementById('enable-diarization')?.checked || false;
    formData.append('enable_diarization', enableDiarization);

    // Add trial mode parameter
    const uploadMode = window.trialManager ? window.trialManager.getUploadMode() : 'authenticated';
    formData.append('upload_mode', uploadMode);

    // UI Feedback
    const btn = document.getElementById('uploadBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = `Processing... <span class="material-symbols-outlined animate-spin shadow-none">sync</span>`;
    btn.disabled = true;

    // Hide previous results if any
    document.getElementById('results-section').classList.add('hidden');

    // Get session token from Clerk
    const getToken = async () => {
        if (window.Clerk && window.Clerk.session) {
            return await window.Clerk.session.getToken();
        }
        return null;
    };

    getToken().then(token => {
        const headers = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        fetch('/upload', {
            method: 'POST',
            headers: headers,
            body: formData
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (data.error) {
                    notify.error('Error: ' + data.error);
                } else {
                    console.log("Upload Success:", data); // Debug

                    // Increment trial tracking correctly
                    if (window.trialManager) {
                        window.trialManager.incrementTrial();
                    }

                    // Store result globally for PDF export
                    window.currentResult = data;
                    window.currentFilename = file.name;

                    displayResults(data, file.name);
                    fetchHistoryCount(); // Update history count immediately
                }
            })
            .catch(error => {
                console.error('Error:', error);
                notify.error('Upload/Processing failed: ' + error.message);
            })
            .finally(() => {
                btn.innerHTML = originalText;
                btn.disabled = false;
            });
    }).catch(err => {
        console.error('Token error:', err);
        btn.innerHTML = originalText;
        btn.disabled = false;
        notify.error('Authentication error. Please sign in again.');
    });
}

function displayResults(data, filename) {
    // Show results section
    const resultsSection = document.getElementById('results-section');
    resultsSection.classList.remove('hidden');
    resultsSection.scrollIntoView({ behavior: 'smooth' });

    // Update Filename
    document.getElementById('filename-display').innerText = filename;

    // Set Audio Source — only if audio_url provided (authenticated users)
    const audioPlayer = document.getElementById('audio-player');
    if (audioPlayer && data.audio_url) {
        audioPlayer.src = data.audio_url;
        audioPlayer.load();
    } else if (audioPlayer) {
        // Hide player controls if no audio available (trial mode)
        const playerSection = audioPlayer.closest('.audio-player-section');
        if (playerSection) playerSection.classList.add('hidden');
    }

    // Update Scores
    const confidenceVal = data.confidence_score !== undefined ? data.confidence_score + '%' : 'N/A';
    const wordCountVal = data.word_count !== undefined ? data.word_count : '0';

    document.getElementById('confidence-display').innerText = confidenceVal;
    document.getElementById('word-count-display').innerText = wordCountVal;

    // Update Transcript
    const transcriptContainer = document.getElementById('transcript-container');
    transcriptContainer.innerHTML = ''; // Clear previous
    const paragraphs = data.transcript ? data.transcript.split('\n') : ["No transcript generated."];
    paragraphs.forEach(pText => {
        if (pText.trim()) {
            const p = document.createElement('p');
            p.className = 'text-slate-300 leading-relaxed mb-4';
            p.innerText = pText;
            transcriptContainer.appendChild(p);
        }
    });

    // Update Summary
    document.getElementById('summary-text').innerText = data.summary || "No summary available.";

    // Update Highlights
    const highlightsContainer = document.getElementById('highlights-container');
    highlightsContainer.innerHTML = '';
    if (data.bullet_points && data.bullet_points.length > 0) {
        data.bullet_points.forEach(point => {
            const li = document.createElement('li');
            li.className = 'flex items-start gap-3 text-sm text-slate-300';
            li.innerHTML = `<span class="material-symbols-outlined text-[#bc13fe] text-lg mt-0.5 shrink-0">check_circle</span> <span>${point}</span>`;
            highlightsContainer.appendChild(li);
        });
    } else {
        highlightsContainer.innerHTML = '<li class="text-sm text-slate-500 italic">No highlights extracted.</li>';
    }

    // Update Keywords
    const keywordsContainer = document.getElementById('keywords-container');
    keywordsContainer.innerHTML = '';

    if (data.keywords && data.keywords.length > 0) {
        data.keywords.forEach(keyword => {
            const span = document.createElement('span');
            // Randomly pick a color theme for the badge
            const colors = [
                'text-[#00f2ff] bg-[#00f2ff]/10 border-[#00f2ff]/30',
                'text-[#bc13fe] bg-[#bc13fe]/10 border-[#bc13fe]/30',
                'text-[#00ffc3] bg-[#00ffc3]/10 border-[#00ffc3]/30',
                'text-white bg-white/5 border-white/10'
            ];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];

            span.className = `px-3 py-1 border text-[10px] font-bold uppercase rounded-full ${randomColor}`;
            span.innerText = keyword;
            keywordsContainer.appendChild(span);
        });
    } else {
        keywordsContainer.innerHTML = '<span class="text-xs text-slate-500">No keywords found</span>';
    }

    // Render Radar Chart
    if (data.sonic_dna) {
        renderRadarChart(data.sonic_dna);
    }
}

function renderRadarChart(dna) {
    const ctx = document.getElementById('radarChart').getContext('2d');

    if (radarChartInstance) {
        radarChartInstance.destroy();
    }

    // Chart.js Configuration
    radarChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ['Energy', 'Pace', 'Clarity'],
            datasets: [{
                label: 'Sonic DNA',
                data: [dna.energy, dna.pace, dna.clarity],
                backgroundColor: 'rgba(188, 19, 254, 0.2)', // Purple tint
                borderColor: '#00f2ff', // Neon Blue
                pointBackgroundColor: '#fff',
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: '#bc13fe',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    angleLines: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    pointLabels: {
                        color: 'rgba(255, 255, 255, 0.7)',
                        font: {
                            family: "'Space Grotesk', sans-serif",
                            size: 12,
                            weight: 'bold'
                        }
                    },
                    ticks: {
                        display: false, // Hide numbers
                        maxTicksLimit: 5,
                        backdropColor: 'transparent'
                    },
                    suggestedMin: 0,
                    suggestedMax: 100
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });
}

// Audio Control Logic
function togglePlayPause(event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    const audio       = document.getElementById('audio-player');
    const playPauseBtn = document.getElementById('play-pause-btn');
    if (!audio || !playPauseBtn) return;
    if (audio.paused) {
        audio.play();
        playPauseBtn.innerHTML = '<span class="material-symbols-outlined text-3xl">pause</span>';
    } else {
        audio.pause();
        playPauseBtn.innerHTML = '<span class="material-symbols-outlined text-3xl">play_arrow</span>';
    }
}

function seekAudio(seconds, event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    const audio = document.getElementById('audio-player');
    if (audio && audio.duration) {
        audio.currentTime = Math.min(Math.max(audio.currentTime + seconds, 0), audio.duration);
    }
}

// Reset play icon when audio ends
document.addEventListener('DOMContentLoaded', () => {
    const audio       = document.getElementById('audio-player');
    const playPauseBtn = document.getElementById('play-pause-btn');
    if (audio && playPauseBtn) {
        audio.onended = () => {
            playPauseBtn.innerHTML = '<span class="material-symbols-outlined text-3xl">play_arrow</span>';
        };
    }
});

// PDF Export handler for upload page
function triggerPDFExport() {
    const data = window.currentResult;
    if (!data) {
        notify.warning('Upload a file first to generate a PDF report.');
        return;
    }
    const pdfData = {
        filename: window.currentFilename || 'transcript',
        transcript: data.transcript || '',
        summary: data.summary || '',
        bulletPoints: data.bullet_points || [],
        keywords: data.keywords || [],
        sonicDna: data.sonic_dna || null,
        wordCount: data.word_count,
        confidence: data.confidence_score,
        duration: data.sonic_dna ? data.sonic_dna.duration : null,
        speakers: data.num_speakers || 1,
    };
    exportToPDF(pdfData);
}

// ─── Copy Helpers ────────────────────────────────────────────────────────────

function flashCopied(btn) {
    if (!btn) return;
    const icon = btn.querySelector('.material-symbols-outlined');
    if (!icon) return;
    const original = icon.textContent;
    icon.textContent = 'check';
    icon.style.color = '#00ffc3';
    setTimeout(() => {
        icon.textContent = original;
        icon.style.color = '';
    }, 1800);
}

async function copyToClipboard(text, triggerBtn) {
    if (!text || !text.trim()) return;
    try {
        await navigator.clipboard.writeText(text.trim());
    } catch {
        // Fallback for older / non-HTTPS environments
        const ta = document.createElement('textarea');
        ta.value = text.trim();
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }
    flashCopied(triggerBtn);
}

function copyTranscript(event) {
    const btn = event ? event.currentTarget : null;
    const container = document.getElementById('transcript-container');
    const text = container ? container.innerText : '';
    copyToClipboard(text, btn);
}

function copySummary(event) {
    const btn = event ? event.currentTarget : null;
    const summaryEl = document.getElementById('summary-text');
    const text = summaryEl ? summaryEl.innerText : '';
    copyToClipboard(text, btn);
}

