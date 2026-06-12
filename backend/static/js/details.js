// details.js - Handles transcript details page

let radarChartInstance = null;

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const historyId = urlParams.get('id');

    if (!historyId) {
        notify.error('No transcript ID provided');
        window.location.href = '/history-page';
        return;
    }

    loadTranscriptDetails(historyId);
});

async function loadTranscriptDetails(id) {
    try {
        // Use the dedicated single-item endpoint — no need to fetch all history
        const response = await fetch(`/history/${id}`);
        if (!response.ok) {
            notify.error('Transcript not found');
            setTimeout(() => window.location.href = '/history-page', 1500);
            return;
        }
        const item = await response.json();
        displayDetails(item);
    } catch (error) {
        console.error('Error loading details:', error);
        notify.error('Failed to load transcript details');
    }
}

function displayDetails(item) {
    // Hide loading, show content
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('details-content').classList.remove('hidden');

    // Header
    document.getElementById('filename').textContent = item.filename;
    document.getElementById('timestamp').textContent = new Date(item.timestamp).toLocaleString();

    // Audio
    const audioPlayer = document.getElementById('audio-player');
    const audioSource = document.getElementById('audio-source');
    audioSource.src = `/uploads/${item.audio_filename || item.filename}`;
    audioPlayer.load();

    // Initialize custom audio player
    initializeAudioPlayer(item);

    // Transcript
    document.getElementById('transcript').textContent = item.transcript || 'No transcript available';

    // Summary
    document.getElementById('summary').textContent = item.summary || 'No summary available';

    // Keywords
    const keywordsContainer = document.getElementById('keywords');
    if (item.keywords && item.keywords.length > 0) {
        keywordsContainer.innerHTML = item.keywords.map(keyword =>
            `<span class="px-3 py-1 bg-[#00f2ff]/20 text-[#00f2ff] rounded-full text-xs font-bold uppercase tracking-widest">${keyword}</span>`
        ).join('');
    } else {
        keywordsContainer.innerHTML = '<span class="text-slate-500 text-sm">No keywords available</span>';
    }

    // Bullet Points
    const bulletPointsContainer = document.getElementById('bullet-points');
    if (item.bullet_points && item.bullet_points.length > 0) {
        bulletPointsContainer.innerHTML = item.bullet_points.map(point =>
            `<li class="flex items-start gap-2">
                <span class="material-symbols-outlined text-[#00f2ff] text-sm mt-0.5">arrow_right</span>
                <span>${point}</span>
            </li>`
        ).join('');
    } else {
        bulletPointsContainer.innerHTML = '<li class="text-slate-500">No key points available</li>';
    }

    // Stats
    document.getElementById('word-count').textContent = item.word_count || 0;

    // Sonic DNA
    const dna = item.sonic_dna || {};

    // Display values directly - simple and clean
    document.getElementById('energy').textContent = Math.round(dna.energy || 0);
    document.getElementById('pace').textContent = Math.round(dna.pace || 0);
    document.getElementById('clarity').textContent = Math.round(dna.clarity || 0);
    document.getElementById('duration').textContent = Math.round(dna.duration || 0);

    // Audio duration display
    const durationSecs = dna.duration || 0;
    document.getElementById('audio-duration').textContent = `${durationSecs}s`;

    // Render Radar Chart with exact same logic as upload page
    renderRadarChart(dna);

    // Store transcript and summary for copying
    window.currentTranscript = item.transcript;
    window.currentSummary = item.summary;
    // Store full item for PDF export
    window.currentDetailItem = item;
}

function renderRadarChart(dna) {
    const canvas = document.getElementById('radarChart');
    if (!canvas) {
        console.error('Radar chart canvas not found!');
        return;
    }

    const ctx = canvas.getContext('2d');

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

function copyTranscript() {
    if (window.currentTranscript) {
        navigator.clipboard.writeText(window.currentTranscript).then(() => {
            notify.success('Transcript copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy:', err);
            notify.error('Failed to copy transcript');
        });
    }
}

function initializeAudioPlayer(item) {
    const audio = document.getElementById('audio-player');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const skipBackBtn = document.getElementById('skip-back');
    const skipForwardBtn = document.getElementById('skip-forward');
    const progressBar = document.getElementById('progress-bar');
    const seekBar = document.getElementById('seek-bar');
    const currentTimeEl = document.getElementById('current-time');
    const durationTimeEl = document.getElementById('duration-time');
    const waveformContainer = document.getElementById('waveform-container');

    // Set player info
    document.getElementById('player-filename').textContent = item.filename;
    document.getElementById('player-words').textContent = item.word_count || 0;

    // Confidence stored as % (e.g. 85.3) — display directly
    const confidence = item.confidence_score || 0;
    document.getElementById('player-confidence').textContent = `${parseFloat(confidence).toFixed(1)}%`;

    // Generate waveform bars
    generateWaveform(waveformContainer);

    // Play/Pause
    playPauseBtn.addEventListener('click', () => {
        if (audio.paused) {
            audio.play();
            playPauseBtn.innerHTML = '<span class="material-symbols-outlined text-black text-4xl font-bold">pause</span>';
            animateWaveform(true);
        } else {
            audio.pause();
            playPauseBtn.innerHTML = '<span class="material-symbols-outlined text-black text-4xl font-bold">play_arrow</span>';
            animateWaveform(false);
        }
    });

    // Skip controls
    skipBackBtn.addEventListener('click', () => {
        audio.currentTime = Math.max(0, audio.currentTime - 10);
    });

    skipForwardBtn.addEventListener('click', () => {
        audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
    });

    // Update progress
    audio.addEventListener('timeupdate', () => {
        const progress = (audio.currentTime / audio.duration) * 100;
        progressBar.style.width = `${progress}%`;
        seekBar.value = progress;
        currentTimeEl.textContent = formatTime(audio.currentTime);
    });

    // Seek
    seekBar.addEventListener('input', (e) => {
        const seekTo = (e.target.value / 100) * audio.duration;
        audio.currentTime = seekTo;
    });

    // Duration loaded
    audio.addEventListener('loadedmetadata', () => {
        durationTimeEl.textContent = formatTime(audio.duration);
    });

    // Audio ended
    audio.addEventListener('ended', () => {
        playPauseBtn.innerHTML = '<span class="material-symbols-outlined text-black text-4xl font-bold">play_arrow</span>';
        animateWaveform(false);
    });
}

function generateWaveform(container) {
    container.innerHTML = '';
    const barCount = 50;
    const heights = [40, 70, 55, 85, 60, 90, 50, 75, 65, 80, 45, 70, 60, 85, 55, 90, 50, 75, 70, 80,
        60, 85, 55, 75, 65, 80, 50, 90, 60, 75, 55, 85, 60, 70, 50, 80, 65, 75, 55, 85,
        60, 90, 50, 75, 65, 80, 55, 70, 60, 85];

    for (let i = 0; i < barCount; i++) {
        const bar = document.createElement('div');
        bar.className = 'waveform-bar';
        bar.style.cssText = `
            width: 3px;
            height: ${heights[i] || 60}%;
            background: linear-gradient(to top, #00f2ff, #bc13fe);
            border-radius: 2px;
            transition: all 0.3s ease;
            opacity: 0.5;
        `;
        container.appendChild(bar);
    }
}

function animateWaveform(play) {
    const bars = document.querySelectorAll('.waveform-bar');
    bars.forEach((bar, index) => {
        if (play) {
            bar.style.animation = `wave 0.8s ease-in-out ${index * 0.02}s infinite alternate`;
            bar.style.opacity = '1';
        } else {
            bar.style.animation = 'none';
            bar.style.opacity = '0.5';
        }
    });
}

function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function copySummary() {
    if (window.currentSummary) {
        navigator.clipboard.writeText(window.currentSummary).then(() => {
            notify.success('Summary copied to clipboard!');
        }).catch(err => {
            console.error('Failed to copy:', err);
            notify.error('Failed to copy summary');
        });
    }
}

function triggerDetailsPDFExport() {
    const item = window.currentDetailItem;
    if (!item) {
        notify.warning('No transcript loaded yet.');
        return;
    }
    const dna = item.sonic_dna || {};
    exportToPDF({
        filename:    item.filename || 'transcript',
        transcript:  item.transcript || '',
        summary:     item.summary || '',
        bulletPoints: item.bullet_points || [],
        keywords:    item.keywords || [],
        sonicDna: {
            energy:  Math.round(dna.energy  || 0),
            pace:    Math.round(dna.pace    || 0),
            clarity: Math.round(dna.clarity || 0),
        },
        wordCount:  item.word_count,
        confidence: item.confidence_score || null,  // already a %
        duration:   dna.duration || null,
        speakers:   item.num_speakers || 1,
    });
}
