// Free Trial Mode Handler
// This file manages the free trial upload limit functionality

class TrialModeManager {
    constructor() {
        this.MAX_TRIALS = 2;
        this.isLoggedIn = false;
        this.trialCount = 0;
    }

    async initialize() {
        // ONLY show trial UI when the page was explicitly loaded with ?trial=true
        // The upload page auth guard already ensures authenticated users are here
        // so if isTrial is not set, the user is logged in — no trial UI needed.
        if (window.isTrial === true) {
            this.isLoggedIn = false;
            this.loadTrialCount();
            this.showTrialUI();
        } else {
            // Authenticated user — ensure trial counter stays hidden
            this.isLoggedIn = true;
            this.showLoggedInUI();
        }
    }

    loadTrialCount() {
        this.trialCount = parseInt(localStorage.getItem('trial_uploads') || '0');
    }

    saveTrialCount() {
        localStorage.setItem('trial_uploads', this.trialCount.toString());
    }

    getRemainingTrials() {
        return Math.max(0, this.MAX_TRIALS - this.trialCount);
    }

    canUpload() {
        if (this.isLoggedIn) return true;
        return this.trialCount < this.MAX_TRIALS;
    }

    incrementTrial() {
        if (!this.isLoggedIn) {
            this.trialCount++;
            this.saveTrialCount();
            this.updateTrialDisplay();
        }
    }

    showLoggedInUI() {
        // Hide trial counter if exists
        const trialCounter = document.getElementById('trial-counter');
        if (trialCounter) trialCounter.classList.add('hidden');

        // Show user profile if exists
        const userProfile = document.getElementById('user-profile');
        if (userProfile) userProfile.classList.remove('hidden');
    }

    showTrialUI() {
        const remaining = this.getRemainingTrials();

        // Update trial counter if exists
        const trialCounter = document.getElementById('trial-counter');
        if (trialCounter) {
            trialCounter.classList.remove('hidden');
            this.updateTrialDisplay();
        }

        // Hide user profile
        const userProfile = document.getElementById('user-profile');
        if (userProfile) userProfile.classList.add('hidden');

        // Show limit banner if no trials left
        if (remaining === 0) {
            this.showLimitBanner();
            this.disableUpload();
        }
    }

    updateTrialDisplay() {
        const used = this.trialCount;
        const remaining = this.getRemainingTrials();
        const pct = Math.round((used / this.MAX_TRIALS) * 100);
        const isOut = remaining === 0;

        // Text counter: "1/2"
        const remainingEl = document.getElementById('trial-remaining');
        if (remainingEl) {
            remainingEl.textContent = `${used}/${this.MAX_TRIALS}`;
            remainingEl.classList.toggle('text-red-400', isOut);
            remainingEl.classList.toggle('text-[#00f2ff]', !isOut);
        }

        // Progress bar
        const bar = document.getElementById('trial-progress-bar');
        if (bar) {
            bar.style.width = `${pct}%`;
            // Turn red when limit hit
            bar.classList.toggle('bg-red-500', isOut);
            bar.classList.toggle('bg-[#00f2ff]', !isOut);
        }
    }

    showLimitBanner() {
        const banner = document.getElementById('trial-limit-banner');
        if (banner) banner.classList.remove('hidden');
    }

    disableUpload() {
        const fileInput = document.getElementById('fileInput');
        const uploadBtn = document.getElementById('uploadBtn');
        if (fileInput) fileInput.disabled = true;
        if (uploadBtn) {
            uploadBtn.disabled = true;
            uploadBtn.classList.add('opacity-50', 'cursor-not-allowed');
        }
    }

    getUploadMode() {
        return this.isLoggedIn ? 'authenticated' : 'trial';
    }
}

// Export singleton instance
window.trialManager = new TrialModeManager();
