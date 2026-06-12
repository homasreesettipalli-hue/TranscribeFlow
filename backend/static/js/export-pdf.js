// TranscribeFlow - PDF Export Utility
// Uses jsPDF (loaded via CDN) to generate a clean structured transcript report

/**
 * Sanitize text for jsPDF's built-in Helvetica font (Latin-1 safe).
 * Replaces smart quotes, em-dashes, and other non-Latin characters.
 */
function sanitizeText(str) {
    if (!str) return '';
    return String(str)
        .replace(/\u2018|\u2019/g, "'")   // smart single quotes
        .replace(/\u201C|\u201D/g, '"')   // smart double quotes
        .replace(/\u2013/g, '-')          // en dash
        .replace(/\u2014/g, '--')         // em dash
        .replace(/\u2026/g, '...')        // ellipsis
        .replace(/\u00B7/g, '*')          // middle dot
        .replace(/[^\x00-\xFF]/g, ' ')   // strip any remaining multi-byte chars
        .replace(/\s+/g, ' ')
        .trim();
}

function exportToPDF(data) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 16;
    const cw = pageW - margin * 2;   // content width
    let y = margin;

    // ─── Colours ────────────────────────────────────────────────────────────
    const COL = {
        bg: [8, 12, 28],
        card: [14, 18, 40],
        bar: [22, 26, 52],
        cyan: [0, 230, 242],
        purple: [180, 30, 240],
        green: [0, 230, 180],
        white: [235, 238, 245],
        muted: [130, 140, 165],
        accent: [0, 242, 255],
    };

    // ─── Helpers ─────────────────────────────────────────────────────────────
    const newPage = () => { doc.addPage(); y = margin; };

    const ensureSpace = (needed) => { if (y + needed > pageH - margin) newPage(); };

    const setFont = (size, style = 'normal', color = COL.white) => {
        doc.setFontSize(size);
        doc.setFont('helvetica', style);
        doc.setTextColor(...color);
    };

    const fillRect = (x, ry, w, h, color) => {
        doc.setFillColor(...color);
        doc.rect(x, ry, w, h, 'F');
    };

    const roundRect = (x, ry, w, h, r, color) => {
        doc.setFillColor(...color);
        doc.roundedRect(x, ry, w, h, r, r, 'F');
    };

    /**
     * Write wrapped text lines and advance y.
     */
    const writeBlock = (text, size, style, color, indent = 0, maxW = cw) => {
        const safe = sanitizeText(text);
        const lines = doc.splitTextToSize(safe, maxW - indent);
        const lineH = size * 0.42;
        ensureSpace(lines.length * lineH + 2);
        setFont(size, style, color);
        doc.text(lines, margin + indent, y);
        y += lines.length * lineH + 2;
        return lines.length;
    };

    /**
     * Draw a section heading bar + label.
     */
    const sectionBar = (label) => {
        ensureSpace(16);
        y += 4;
        fillRect(margin, y - 1, cw, 9, COL.card);
        // Left accent stripe
        fillRect(margin, y - 1, 3, 9, COL.accent);
        setFont(8, 'bold', COL.accent);
        doc.text(label.toUpperCase(), margin + 6, y + 5.5);
        y += 13;
    };

    // ────────────────────────────────────────────────────────────────────────
    // 1.  HEADER BAND
    // ────────────────────────────────────────────────────────────────────────
    fillRect(0, 0, pageW, 34, COL.bg);
    fillRect(0, 0, 5, 34, COL.accent);       // left cyan stripe

    setFont(18, 'bold', COL.accent);
    doc.text('TranscribeFlow', margin + 2, 13);

    setFont(7.5, 'normal', COL.muted);
    doc.text('AI TRANSCRIPTION REPORT', margin + 2, 19);

    // filename right-aligned
    const fname = sanitizeText(data.filename || 'Untitled');
    setFont(8.5, 'bold', COL.white);
    const fnLines = doc.splitTextToSize(fname, 80);
    doc.text(fnLines, pageW - margin, 13, { align: 'right' });

    setFont(7, 'normal', COL.muted);
    doc.text('Generated: ' + new Date().toLocaleString(), pageW - margin, 19, { align: 'right' });

    y = 40;

    // ────────────────────────────────────────────────────────────────────────
    // 2.  STATS ROW
    // ────────────────────────────────────────────────────────────────────────
    const stats = [
        { label: 'WORDS', value: String(data.wordCount || '-') },
        { label: 'CONFIDENCE', value: data.confidence != null ? data.confidence + '%' : '-' },
        { label: 'DURATION', value: data.duration != null ? data.duration + 's' : '-' },
        { label: 'SPEAKERS', value: String(data.speakers || '1') },
    ];
    const boxW = cw / stats.length;
    stats.forEach((s, i) => {
        const bx = margin + i * boxW;
        roundRect(bx, y, boxW - 2, 17, 2, COL.card);
        setFont(6.5, 'normal', COL.muted);
        doc.text(s.label, bx + (boxW - 2) / 2, y + 5.5, { align: 'center' });
        setFont(12, 'bold', COL.accent);
        doc.text(s.value, bx + (boxW - 2) / 2, y + 13, { align: 'center' });
    });
    y += 22;

    // ────────────────────────────────────────────────────────────────────────
    // 3.  SONIC DNA
    // ────────────────────────────────────────────────────────────────────────
    if (data.sonicDna) {
        sectionBar('Sonic DNA');
        const dnaItems = [
            { label: 'Energy', value: Math.round(data.sonicDna.energy || 0), color: COL.green },
            { label: 'Pace', value: Math.round(data.sonicDna.pace || 0), color: COL.cyan },
            { label: 'Clarity', value: Math.round(data.sonicDna.clarity || 0), color: COL.purple },
        ];
        const barTrackW = 100;
        dnaItems.forEach(d => {
            ensureSpace(10);
            setFont(8, 'bold', d.color);
            doc.text(d.label, margin, y);
            // Track
            roundRect(margin + 20, y - 4, barTrackW, 6, 1, COL.bar);
            // Fill
            const fillW = Math.max(1, Math.round((d.value / 100) * barTrackW));
            roundRect(margin + 20, y - 4, fillW, 6, 1, d.color);
            // Number
            setFont(8, 'bold', COL.white);
            doc.text(String(d.value), margin + 20 + barTrackW + 4, y);
            y += 9;
        });
        y += 2;
    }

    // ────────────────────────────────────────────────────────────────────────
    // 4.  AI SUMMARY
    // ────────────────────────────────────────────────────────────────────────
    if (data.summary) {
        sectionBar('AI Summary');
        // Draw background card first
        const summaryText = sanitizeText(data.summary);
        const summLines = doc.splitTextToSize(summaryText, cw - 8);
        const cardH = summLines.length * 4.2 + 8;
        ensureSpace(cardH + 4);
        roundRect(margin, y, cw, cardH, 2, COL.card);
        setFont(8.5, 'normal', COL.white);
        doc.text(summLines, margin + 4, y + 6);
        y += cardH + 6;
    }

    // ────────────────────────────────────────────────────────────────────────
    // 5.  KEY POINTS
    // ────────────────────────────────────────────────────────────────────────
    if (data.bulletPoints && data.bulletPoints.length > 0) {
        sectionBar('Key Points');
        data.bulletPoints.forEach((pt, idx) => {
            const text = sanitizeText(pt);
            const ptLines = doc.splitTextToSize(text, cw - 10);
            const lineH = 4.2;
            const itemH = ptLines.length * lineH + 4;
            ensureSpace(itemH + 2);
            // Row background alternate
            if (idx % 2 === 0) roundRect(margin, y - 2, cw, itemH, 1, COL.card);
            // Bullet dot
            doc.setFillColor(...COL.accent);
            doc.circle(margin + 3, y + 1.5, 1.2, 'F');
            setFont(8, 'normal', COL.white);
            doc.text(ptLines, margin + 8, y + lineH * 0.5);
            y += itemH + 1;
        });
        y += 2;
    }

    // ────────────────────────────────────────────────────────────────────────
    // 6.  KEYWORDS
    // ────────────────────────────────────────────────────────────────────────
    if (data.keywords && data.keywords.length > 0) {
        sectionBar('Keywords');
        ensureSpace(12);
        let kx = margin;
        data.keywords.forEach(kw => {
            const safe = sanitizeText(kw);
            setFont(7.5, 'bold', COL.accent);
            const kwW = doc.getTextWidth(safe) + 8;
            if (kx + kwW > pageW - margin) { kx = margin; y += 9; ensureSpace(10); }
            roundRect(kx, y - 4.5, kwW, 7, 1.5, [0, 45, 58]);
            // Thin border
            doc.setDrawColor(...COL.accent);
            doc.setLineWidth(0.3);
            doc.roundedRect(kx, y - 4.5, kwW, 7, 1.5, 1.5, 'S');
            doc.text(safe, kx + 4, y);
            kx += kwW + 3;
        });
        y += 10;
    }

    // ────────────────────────────────────────────────────────────────────────
    // 7.  FULL TRANSCRIPT
    // ────────────────────────────────────────────────────────────────────────
    if (data.transcript) {
        sectionBar('Full Transcript');
        const transcriptText = sanitizeText(data.transcript);
        const tLines = doc.splitTextToSize(transcriptText, cw);
        const lineH = 4.2;
        tLines.forEach(line => {
            ensureSpace(lineH + 1);
            setFont(8.5, 'normal', [185, 195, 210]);
            doc.text(line, margin, y);
            y += lineH;
        });
    }

    // ────────────────────────────────────────────────────────────────────────
    // 8.  FOOTER on every page
    // ────────────────────────────────────────────────────────────────────────
    const totalPages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        fillRect(0, pageH - 8, pageW, 8, [4, 6, 18]);
        fillRect(0, pageH - 8, pageW, 0.4, COL.accent);
        setFont(6.5, 'normal', [70, 80, 105]);
        doc.text('TranscribeFlow Studio  |  AI Transcription Report', margin, pageH - 3);
        doc.text('Page ' + p + ' / ' + totalPages, pageW - margin, pageH - 3, { align: 'right' });
    }

    // ────────────────────────────────────────────────────────────────────────
    // 9.  SAVE
    // ────────────────────────────────────────────────────────────────────────
    const safeName = sanitizeText(data.filename || 'transcript')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_')
        .toLowerCase();
    doc.save('TranscribeFlow_' + safeName + '.pdf');
}

window.exportToPDF = exportToPDF;
