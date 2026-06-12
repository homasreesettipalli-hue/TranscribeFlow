import os
import re
import shutil
import time
import json
import uuid
import imageio_ffmpeg
from collections import Counter
from functools import wraps
from flask import Flask, request, jsonify, send_from_directory, render_template
from flask_cors import CORS
from clerk_backend_api import Clerk
from deep_translator import GoogleTranslator

# Speaker diarization — pure librosa + sklearn, no HuggingFace needed
try:
    import librosa
    import numpy as np
    from sklearn.cluster import AgglomerativeClustering
    from sklearn.preprocessing import StandardScaler
    from sklearn.feature_extraction.text import TfidfVectorizer
    DIARIZATION_AVAILABLE = True
except ImportError:
    DIARIZATION_AVAILABLE = False
    print("Warning: librosa or sklearn not installed. Speaker diarization disabled.")

# -------------------- FFMPEG Configuration --------------------
ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
ffmpeg_dir = os.path.dirname(ffmpeg_exe)
target_ffmpeg = os.path.join(ffmpeg_dir, "ffmpeg.exe")

if not os.path.exists(target_ffmpeg):
    try:
        shutil.copy(ffmpeg_exe, target_ffmpeg)
        print(f"Created ffmpeg.exe at {target_ffmpeg}")
    except Exception as e:
        print(f"Failed to create ffmpeg.exe: {e}")

os.environ["PATH"] += os.pathsep + ffmpeg_dir

import whisper
from transformers import pipeline as hf_pipeline

# -------------------- Configuration --------------------
basedir = os.path.dirname(os.path.abspath(__file__))
template_dir = os.path.join(basedir, "templates")
static_dir   = os.path.join(basedir, "static")

app = Flask(__name__, template_folder=template_dir, static_folder=static_dir)
CORS(app)

UPLOAD_FOLDER = os.path.join(basedir, "uploads")
HISTORY_FILE  = os.path.join(basedir, "history.json")
MAX_FILE_SIZE = 100 * 1024 * 1024   # 100 MB
MAX_HISTORY   = 100                  # cap history at 100 entries
ALLOWED_EXTS  = {'.mp3', '.wav', '.mp4', '.mov', '.m4a', '.ogg', '.flac', '.webm'}

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

# -------------------- Clerk Authentication --------------------
CLERK_SECRET_KEY = os.environ.get("CLERK_SECRET_KEY", "sk_test_VZJlwKWegCCcq6SftOAp5fXDJcMXSEZDmIUr1Zs2TL")
clerk_client = Clerk(bearer_auth=CLERK_SECRET_KEY)

def require_auth(f):
    """Decorator to protect routes — requires valid Clerk session."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header  = request.headers.get('Authorization', '')
        session_token = (
            auth_header.replace('Bearer ', '')
            if auth_header else
            request.cookies.get('__session')
        )
        if not session_token:
            return jsonify({"error": "Unauthorized — No session token"}), 401
        try:
            session = clerk_client.sessions.verify_token(session_token)
            if not session:
                return jsonify({"error": "Invalid session"}), 401
            request.user_id = session.get('sub')
            return f(*args, **kwargs)
        except Exception as e:
            print(f"Auth error: {e}")
            return jsonify({"error": "Authentication failed"}), 401
    return decorated_function

# -------------------- AI Models --------------------
print("Loading Whisper model (tiny)...")
asr_model = whisper.load_model("tiny")

print("Loading BART summarization model...")
summarizer = hf_pipeline("summarization", model="facebook/bart-large-cnn")

# -------------------- Google Cloud Storage --------------------
from google.cloud import storage

# Initialize the client (No keys needed! It uses the VM's identity)
storage_client = storage.Client()
BUCKET_NAME = "transcribeflow-storage-balaji" # Replace with your bucket name

def upload_to_gcs(local_path, filename):
    bucket = storage_client.bucket(BUCKET_NAME)
    blob = bucket.blob(filename)
    blob.upload_from_filename(local_path)
    return f"gs://{BUCKET_NAME}/{filename}"

# -------------------- Helper Functions --------------------

STOPWORDS = {
    'the','a','an','and','or','but','in','on','at','to','for','of','with',
    'is','it','its','this','that','was','be','are','as','by','from','have',
    'has','had','not','we','our','they','their','you','your','he','she','his',
    'her','which','who','will','would','could','should','been','were','do',
    'did','does','just','also','about','than','then','when','where','there',
    'so','if','up','out','all','no','can','may','each','both','into','more',
    'some','over','after','i','me','my','am','what','how','any',
}

def calculate_sonic_dna(audio_path, transcript):
    """Calculates Energy, Pace, and Clarity from audio."""
    try:
        y, sr = librosa.load(audio_path)
        duration_seconds = librosa.get_duration(y=y, sr=sr)

        # Energy (RMS) → 0-100
        rms     = librosa.feature.rms(y=y)[0]
        avg_rms = float(np.mean(rms))
        energy  = max(min(int(avg_rms * 1000), 100), 10)

        # Pace — true WPM from transcript
        word_count = len(transcript.split())
        pace       = int(word_count / (duration_seconds / 60)) if duration_seconds > 0 else 0
        pace_score = min(int((pace / 200) * 100), 100)

        # Clarity — Spectral Centroid proxy
        centroid     = librosa.feature.spectral_centroid(y=y, sr=sr)
        avg_centroid = float(np.mean(centroid))
        clarity      = min(int(avg_centroid / 50), 100)

        return {
            "energy":   energy,
            "pace":     pace_score,
            "clarity":  clarity,
            "duration": int(duration_seconds),
            "rms":      int(avg_rms * 100),
            "raw_pace": pace,
        }
    except Exception as e:
        print(f"Sonic DNA error: {e}")
        return {"energy": 50, "pace": 50, "clarity": 50, "duration": 0, "rms": 50, "raw_pace": 0}


def extract_key_highlights(text, n=3):
    """
    TF-IDF extractive sentence scoring — picks the n most information-dense
    sentences directly from the transcript. Completely separate from BART summary.
    """
    raw_sents = re.split(r'(?<=[.!?])\s+', text.strip())
    sents     = [s.strip() for s in raw_sents if len(s.split()) >= 5]
    if not sents:
        return [text.strip()] if text.strip() else []
    if len(sents) <= n:
        return sents
    try:
        vec          = TfidfVectorizer(stop_words='english', ngram_range=(1, 2))
        tfidf_matrix = vec.fit_transform(sents)
        scores       = np.asarray(tfidf_matrix.mean(axis=1)).flatten()
        top_indices  = sorted(
            sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:n]
        )
        return [sents[i] for i in top_indices]
    except Exception:
        return sents[:n]


def extract_keywords(transcript, n=8):
    """Extract top-n meaningful keywords from transcript using frequency + stopword filter."""
    words    = re.findall(r'\b[a-zA-Z]{4,}\b', transcript.lower())
    filtered = [w for w in words if w not in STOPWORDS]
    freq     = Counter(filtered)
    return [word.title() for word, _ in freq.most_common(n)]


def translate_texts(transcript, summary, target_lang):
    """Translate transcript and summary using GoogleTranslator."""
    if not target_lang or target_lang in ('en', 'original'):
        return transcript, summary
    try:
        translator = GoogleTranslator(source='auto', target=target_lang)
        # Handle Google's 5000 char limit: translate in chunks if needed
        def translate_long(text):
            if len(text) <= 4999:
                return translator.translate(text)
            # Split at sentence boundaries and translate chunks
            sentences = re.split(r'(?<=[.!?])\s+', text)
            chunks, current = [], ""
            for s in sentences:
                if len(current) + len(s) < 4900:
                    current += " " + s
                else:
                    chunks.append(current.strip())
                    current = s
            if current:
                chunks.append(current.strip())
            translated_chunks = [translator.translate(c) for c in chunks if c]
            return " ".join(translated_chunks)

        return translate_long(transcript), translator.translate(summary)
    except Exception as e:
        print(f"Translation error: {e}")
        return transcript, summary


def perform_diarization(audio_file_path):
    """
    Speaker diarization using MFCC + Agglomerative Clustering.
    No HuggingFace / pyannote required — only librosa and sklearn.
    """
    if not DIARIZATION_AVAILABLE:
        print("Diarization unavailable — skipping.")
        return None

    try:
        print(f"Loading audio for diarization: {audio_file_path}")
        y, sr    = librosa.load(audio_file_path, sr=16000, mono=True)
        duration = librosa.get_duration(y=y, sr=sr)

        if duration < 2.0:
            print("Audio too short for diarization.")
            return None

        # 1. Feature Extraction
        window_len = int(0.5  * sr)
        hop_len    = int(0.25 * sr)

        mfcc     = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, n_fft=window_len, hop_length=hop_len)
        features = StandardScaler().fit_transform(mfcc.T)  # (n_frames, 13)
        n_frames = features.shape[0]

        if n_frames < 4:
            print("Too few frames for clustering.")
            return None

        # 2. Auto-detect number of speakers (2–4)
        best_n, best_score = 2, float('inf')
        max_speakers       = min(4, n_frames // 4)

        for n in range(2, max_speakers + 1):
            labels = AgglomerativeClustering(n_clusters=n, linkage='ward').fit_predict(features)
            score  = 0.0
            for c in range(n):
                pts = features[labels == c]
                if len(pts) > 1:
                    score += float(np.mean(np.linalg.norm(pts - pts.mean(axis=0), axis=1)))
            score /= n
            if score < best_score:
                best_score, best_n = score, n

        print(f"Diarization: detected {best_n} speaker(s).")
        if best_n <= 1:
            return None

        # 3. Final clustering
        labels      = AgglomerativeClustering(n_clusters=best_n, linkage='ward').fit_predict(features)
        frame_times = librosa.frames_to_time(np.arange(n_frames), sr=sr, hop_length=hop_len)

        # 4. Build segments (merge consecutive same-speaker frames)
        segments        = []
        current_speaker = int(labels[0])
        seg_start       = float(frame_times[0])

        for i in range(1, n_frames):
            if int(labels[i]) != current_speaker:
                seg_end = float(frame_times[i])
                if seg_end - seg_start >= 0.3:
                    segments.append({
                        "start":   round(seg_start, 3),
                        "end":     round(seg_end,   3),
                        "speaker": f"SPEAKER_{current_speaker:02d}",
                    })
                current_speaker = int(labels[i])
                seg_start       = float(frame_times[i])

        if float(frame_times[-1]) - seg_start >= 0.3:
            segments.append({
                "start":   round(seg_start,             3),
                "end":     round(float(frame_times[-1]), 3),
                "speaker": f"SPEAKER_{current_speaker:02d}",
            })

        if not segments:
            print("No valid segments after filtering.")
            return None

        unique_speakers = len(set(s["speaker"] for s in segments))
        print(f"Diarization complete: {unique_speakers} speaker(s), {len(segments)} segment(s).")
        return {"num_speakers": unique_speakers, "segments": segments}

    except Exception as e:
        print(f"Diarization error: {e}")
        import traceback; traceback.print_exc()
        return None


def format_transcript_with_speakers(transcript_text, diarization_result, whisper_segments):
    """Map Whisper word segments to diarization speaker labels."""
    if not diarization_result or not whisper_segments:
        return transcript_text

    formatted_lines = []
    current_speaker = None

    for w_seg in whisper_segments:
        seg_start = w_seg.get('start', 0)
        seg_text  = w_seg.get('text', '').strip()
        if not seg_text:
            continue

        speaker_label = None
        for d_seg in diarization_result['segments']:
            if d_seg['start'] <= seg_start <= d_seg['end']:
                speaker_label = d_seg['speaker']
                break

        if speaker_label and speaker_label != current_speaker:
            current_speaker = speaker_label
            speaker_num     = int(speaker_label.split('_')[-1]) + 1
            formatted_lines.append(f"\n\nSpeaker {speaker_num}: {seg_text}")
        else:
            formatted_lines.append(seg_text)

    return ' '.join(formatted_lines)


def save_to_history(filename, transcript, summary, dna, bullet_points, keywords,
                    confidence_score, word_count, num_speakers=1, audio_filename=None):
    """Persist record to history.json, capped at MAX_HISTORY entries."""
    history_item = {
        "id":               int(time.time() * 1000),
        "filename":         filename,                           # original display name
        "audio_filename":   audio_filename or filename,        # uuid file on disk
        "timestamp":        time.strftime("%Y-%m-%d %H:%M:%S"),
        "transcript":       transcript,
        "summary":          summary,
        "sonic_dna":        dna,
        "bullet_points":    bullet_points,
        "keywords":         keywords,
        "confidence_score": confidence_score,
        "word_count":       word_count,
        "num_speakers":     num_speakers,
    }

    current_history = []
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                current_history = json.load(f)
        except Exception:
            current_history = []

    current_history.insert(0, history_item)
    current_history = current_history[:MAX_HISTORY]   # cap

    with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
        json.dump(current_history, f, indent=2, ensure_ascii=False)

    return current_history


# -------------------- Routes --------------------

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/login")
def login():
    return render_template("login.html")

@app.route("/home")
def home_page():
    return render_template("home.html")

@app.route("/upload-page")
def upload_page():
    return render_template("upload.html")

@app.route("/history-page")
def history_page():
    return render_template("history.html")

@app.route("/details")
def details_page():
    return render_template("details.html")

@app.route("/profile")
def profile_page():
    return render_template("profile.html")

@app.route("/favicon.ico")
def favicon():
    return send_from_directory(static_dir, "favicon.ico", mimetype="image/vnd.microsoft.icon") if \
           os.path.exists(os.path.join(static_dir, "favicon.ico")) else ("", 204)

@app.route("/health")
def health():
    return jsonify({"status": "ok", "service": "TranscribeFlow", "version": "2.0"})

# -------------------- Upload Endpoint --------------------

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'audio' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['audio']
    if not file.filename:
        return jsonify({'error': 'No file selected'}), 400

    # File type validation
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTS:
        return jsonify({'error': f'Unsupported file type "{ext}". Allowed: {", ".join(ALLOWED_EXTS)}'}), 400

    # File size validation (read into memory first, then check)
    file.seek(0, 2)          # seek to end
    file_size = file.tell()
    file.seek(0)             # reset
    if file_size > MAX_FILE_SIZE:
        return jsonify({'error': f'File too large ({file_size // (1024*1024)}MB). Max 100MB.'}), 413

    # Safe unique filename to avoid collisions
    safe_name = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(app.config["UPLOAD_FOLDER"], safe_name)
    original_filename = file.filename
    file.save(file_path)

    target_lang        = request.form.get('target_lang', 'original')
    enable_diarization = request.form.get('enable_diarization', 'false').lower() == 'true'
    upload_mode        = request.form.get('upload_mode', 'authenticated')

    try:
        # Step 1 — Transcribe
        print("Transcribing...")
        result           = asr_model.transcribe(file_path)
        transcript       = result["text"].strip()
        whisper_segments = result.get('segments', [])

        # Step 2 — Confidence score (from whisper segments BEFORE overwriting)
        if whisper_segments:
            avg_logprobs    = [s.get('avg_logprob', -1.0) for s in whisper_segments]
            confidence_score = float(np.mean([np.exp(lp) for lp in avg_logprobs]))
        else:
            confidence_score = 0.95

        # Step 3 — Speaker Diarization
        diarization_result = None
        if enable_diarization:
            print("Performing speaker diarization...")
            diarization_result = perform_diarization(file_path)

        if diarization_result:
            transcript = format_transcript_with_speakers(transcript, diarization_result, whisper_segments)
            print(f"Formatted transcript with {diarization_result['num_speakers']} speakers.")
        else:
            print("Single speaker — no diarization applied.")

        num_speakers = diarization_result['num_speakers'] if diarization_result else 1

        # Step 4 — Summarize
        print("Summarizing...")
        word_count = len(transcript.split())

        if word_count > 50:
            summary_res = summarizer(transcript[:3000], max_length=150, min_length=40, do_sample=False)
            summary     = summary_res[0]['summary_text']
        else:
            summary = transcript  # short audio: use transcript as summary

        # Step 5 — Sonic DNA
        print("Analyzing Sonic DNA...")
        dna = calculate_sonic_dna(file_path, transcript)

        # Step 6 — Key Highlights (TF-IDF extractive from transcript)
        bullet_points = extract_key_highlights(transcript, n=3)

        # Step 7 — Keywords
        keywords = extract_keywords(transcript, n=8)

        # Step 8 — Translation
        final_transcript, final_summary = transcript, summary
        if target_lang and target_lang != 'original':
            print(f"Translating to {target_lang}...")
            final_transcript, final_summary = translate_texts(transcript, summary, target_lang)

        # Step 9 — Save to history (skip for trial)
        if upload_mode != 'trial':
            print("Saving to history...")
            save_to_history(
                original_filename, final_transcript, final_summary,
                dna, bullet_points, keywords,
                round(confidence_score * 100, 2), word_count, num_speakers,
                audio_filename=safe_name          # store uuid filename for audio playback
            )
        else:
            print("Trial mode — skipping history save.")
            # Delete file for trial users (no persistence needed)
            try: os.remove(file_path)
            except: pass

        audio_url = f"/uploads/{safe_name}" if upload_mode != 'trial' else None

        return jsonify({
            "transcript":          final_transcript,
            "summary":             final_summary,
            "original_transcript": transcript,
            "original_summary":    summary,
            "sonic_dna":           dna,
            "word_count":          word_count,
            "bullet_points":       bullet_points,
            "keywords":            keywords,
            "confidence_score":    round(confidence_score * 100, 2),
            "num_speakers":        num_speakers,
            "audio_url":           audio_url,
        })

    except Exception as e:
        print(f"Upload error: {e}")
        import traceback; traceback.print_exc()
        # Cleanup on error too
        if os.path.exists(file_path):
            try: os.remove(file_path)
            except: pass
        return jsonify({"error": str(e)}), 500


# -------------------- History Endpoints --------------------

@app.route('/history', methods=['GET'])
def get_history():
    if not os.path.exists(HISTORY_FILE):
        return jsonify([])
    try:
        with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
            return jsonify(json.load(f))
    except Exception:
        return jsonify([])


@app.route('/history/<int:history_id>', methods=['GET'])
def get_history_item(history_id):
    """Fetch a single history item by ID — used by details page."""
    if not os.path.exists(HISTORY_FILE):
        return jsonify({"error": "Not found"}), 404
    try:
        with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
            history = json.load(f)
        item = next((h for h in history if h.get('id') == history_id), None)
        if not item:
            return jsonify({"error": "Item not found"}), 404
        return jsonify(item)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/history/<int:history_id>', methods=['DELETE'])
def delete_history_item(history_id):
    """Delete a single history item by ID."""
    if not os.path.exists(HISTORY_FILE):
        return jsonify({"success": False, "error": "History not found"}), 404
    try:
        with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
            history = json.load(f)
        updated = [h for h in history if h.get('id') != history_id]
        if len(updated) == len(history):
            return jsonify({"success": False, "error": "Item not found"}), 404
        with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
            json.dump(updated, f, indent=2, ensure_ascii=False)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/history/delete-all', methods=['DELETE'])
def delete_all_history():
    """Wipe all history."""
    try:
        with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
            json.dump([], f)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/uploads/<filename>')
def serve_upload(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)


# Kept for backward compatibility with older history entries that may have audio_url
@app.route('/delete/<filename>', methods=['DELETE'])
def delete_file_by_name(filename):
    try:
        if os.path.exists(HISTORY_FILE):
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                history = json.load(f)
            updated = [h for h in history if h.get('filename') != filename]
            with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
                json.dump(updated, f, indent=2, ensure_ascii=False)
        fp = os.path.join(app.config["UPLOAD_FOLDER"], filename)
        if os.path.exists(fp):
            os.remove(fp)
        return jsonify({"message": "Deleted"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000, use_reloader=False)
