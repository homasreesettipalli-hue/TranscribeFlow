// history.js — History page functionality

// Cache history data to avoid redundant fetches
let _historyCache = [];

document.addEventListener('DOMContentLoaded', () => {
    fetchHistory();
    const deleteAllBtn = document.getElementById('delete-all-btn');
    if (deleteAllBtn) deleteAllBtn.addEventListener('click', deleteAllHistory);
});

async function fetchHistory() {
    try {
        const response = await fetch('/history');
        const history  = await response.json();
        _historyCache  = history || [];

        const container  = document.getElementById('history-container');
        const emptyState = document.getElementById('empty-state');

        if (!history || history.length === 0) {
            container.classList.add('hidden');
            emptyState.classList.remove('hidden');
            return;
        }

        container.classList.remove('hidden');
        emptyState.classList.add('hidden');
        container.innerHTML = history.map(item => createHistoryCard(item)).join('');
        initializeAudioPlayers();

    } catch (error) {
        console.error('Error fetching history:', error);
        if (typeof notify !== 'undefined') notify.error('Failed to load history.');
    }
}

function createHistoryCard(item) {
    const timestamp = new Date(item.timestamp).toLocaleDateString();
    const sonicDNA = item.sonic_dna || {};

    return `
        <div class="glass-panel rounded-2xl p-6 border border-white/10 hover:border-[#00f2ff]/50 transition-colors">
            <!-- Header -->
            <div class="flex items-start justify-between mb-4">
                <div>
                    <h3 class="font-black text-lg text-white mb-1">${item.filename}</h3>
                    <p class="text-xs text-slate-500 font-bold uppercase tracking-widest">${timestamp}</p>
                </div>
                <button onclick="deleteHistory(${item.id})" 
                    class="text-red-400 hover:text-red-500 transition-colors">
                    <span class="material-symbols-outlined text-xl">delete</span>
                </button>
            </div>

            <!-- Audio Player -->
            <div class="mb-4 bg-white/5 rounded-xl p-4">
                <div class="flex items-center gap-3">
                    <button class="play-btn w-10 h-10 bg-[#00f2ff] rounded-full flex items-center justify-center hover:scale-110 transition-transform" 
                        data-audio="${item.filename}">
                        <span class="material-symbols-outlined text-black">play_arrow</span>
                    </button>
                    <div class="flex-1">
                        <div class="waveform-container">
                            <canvas class="waveform" data-audio="${item.filename}" width="300" height="40"></canvas>
                        </div>
                        <input type="range" class="audio-seeker w-full" data-audio="${item.filename}" 
                            min="0" max="100" value="0" 
                            style="accent-color: #00f2ff;">
                    </div>
                    <span class="audio-time text-xs text-slate-400" data-audio="${item.filename}">0:00</span>
                </div>
                <audio class="hidden" data-filename="${item.filename}" src="/uploads/${item.audio_filename || item.filename}"></audio>
            </div>

            <!-- Sonic DNA Stats -->
            <div class="grid grid-cols-3 gap-2 mb-4">
                <div class="bg-white/5 rounded-xl p-3 text-center">
                    <span class="text-[10px] text-slate-400 font-bold uppercase tracking-widest block mb-1">Energy</span>
                    <span class="text-[#00ffc3] font-black text-lg">${sonicDNA.energy || 0}</span>
                </div>
                <div class="bg-white/5 rounded-xl p-3 text-center">
                    <span class="text-[10px] text-slate-400 font-bold uppercase tracking-widest block mb-1">Pace</span>
                    <span class="text-[#00f2ff] font-black text-lg">${sonicDNA.pace || 0}</span>
                </div>
                <div class="bg-white/5 rounded-xl p-3 text-center">
                    <span class="text-[10px] text-slate-400 font-bold uppercase tracking-widest block mb-1">Clarity</span>
                    <span class="text-[#bc13fe] font-black text-lg">${sonicDNA.clarity || 0}</span>
                </div>
            </div>

            <!-- Transcript Preview -->
            <div class="mb-3">
                <h4 class="text-xs text-slate-400 font-bold uppercase tracking-widest mb-2">Transcript</h4>
                <p class="text-sm text-slate-300 line-clamp-3">${item.transcript || 'No transcript available'}</p>
            </div>

            <!-- Summary Preview -->
            <div class="mb-4">
                <h4 class="text-xs text-slate-400 font-bold uppercase tracking-widest mb-2">Summary</h4>
                <p class="text-sm text-slate-300 line-clamp-2">${item.summary || 'No summary available'}</p>
            </div>

            <!-- Actions -->
            <div class="flex gap-2">
                <button onclick="viewDetails(${item.id})" 
                    class="flex-1 bg-[#00f2ff]/20 text-[#00f2ff] px-4 py-2 rounded-xl font-bold uppercase text-xs tracking-widest hover:bg-[#00f2ff]/30 transition-colors border border-[#00f2ff]/30">
                    View Full
                </button>
                <button onclick="copyTranscript('${item.id}')" 
                    class="bg-white/5 text-white px-4 py-2 rounded-xl hover:bg-white/10 transition-colors">
                    <span class="material-symbols-outlined text-sm">content_copy</span>
                </button>
            </div>
        </div>
    `;
}

function initializeAudioPlayers() {
    const playButtons = document.querySelectorAll('.play-btn');

    playButtons.forEach(btn => {
        const filename = btn.getAttribute('data-audio');
        const audio = document.querySelector(`audio[data-filename="${filename}"]`);
        const seeker = document.querySelector(`.audio-seeker[data-audio="${filename}"]`);
        const timeDisplay = document.querySelector(`.audio-time[data-audio="${filename}"]`);

        if (!audio) return;

        // Load audio metadata to get duration
        audio.addEventListener('loadedmetadata', () => {
            if (audio.duration) {
                const minutes = Math.floor(audio.duration / 60);
                const seconds = Math.floor(audio.duration % 60);
                timeDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            }
        });

        // Trigger metadata load
        audio.load();

        // Play/Pause toggle
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (audio.paused) {
                // Pause all other audio
                document.querySelectorAll('audio').forEach(a => a.pause());
                document.querySelectorAll('.play-btn span').forEach(s => s.textContent = 'play_arrow');

                audio.play();
                btn.querySelector('span').textContent = 'pause';
            } else {
                audio.pause();
                btn.querySelector('span').textContent = 'play_arrow';
            }
        });

        // Update seeker as audio plays
        audio.addEventListener('timeupdate', () => {
            const percentage = (audio.currentTime / audio.duration) * 100;
            seeker.value = percentage || 0;

            // Update time display
            const minutes = Math.floor(audio.currentTime / 60);
            const seconds = Math.floor(audio.currentTime % 60);
            timeDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        });

        // Seek functionality
        seeker.addEventListener('input', (e) => {
            const seekTime = (e.target.value / 100) * audio.duration;
            audio.currentTime = seekTime;
        });

        // Reset button when audio ends
        audio.addEventListener('ended', () => {
            btn.querySelector('span').textContent = 'play_arrow';
            seeker.value = 0;
            // Reset to duration display
            if (audio.duration) {
                const minutes = Math.floor(audio.duration / 60);
                const seconds = Math.floor(audio.duration % 60);
                timeDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            }
        });
    });
}

function deleteHistory(id) {
    if (typeof notify !== 'undefined') {
        // Use a custom confirm-style toast with action buttons
        if (!window.confirm('Delete this transcription?')) return;
    }
    fetch(`/history/${id}`, { method: 'DELETE' })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                notify.success('Transcription deleted.');
                fetchHistory();
            } else {
                notify.error('Delete failed: ' + (data.error || 'Unknown error'));
            }
        })
        .catch(() => notify.error('Delete failed — network error.'));
}

function deleteAllHistory() {
    if (!window.confirm('Delete ALL transcriptions? This cannot be undone.')) return;
    fetch('/history/delete-all', { method: 'DELETE' })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                notify.success('All transcriptions deleted.');
                fetchHistory();
            } else {
                notify.error('Failed to delete all items.');
            }
        })
        .catch(() => notify.error('Delete failed — network error.'));
}
function viewDetails(id) {
    window.location.href = `/details?id=${id}`;
}

function copyTranscript(id) {
    // Use cached history data — no extra fetch needed
    const item = _historyCache.find(h => h.id === id);
    if (!item || !item.transcript) {
        notify.warning('No transcript available.');
        return;
    }
    navigator.clipboard.writeText(item.transcript)
        .then(() => notify.success('Transcript copied!'))
        .catch(() => {
            // Fallback
            const ta = document.createElement('textarea');
            ta.value = item.transcript;
            ta.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            notify.success('Transcript copied!');
        });
}
