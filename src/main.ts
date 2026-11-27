import './style.css';
import teacherSampleAudioUrl from './assets/teacher-2026-wbc.m4a?url';
import teacherSampleTranscript from './assets/teacher-2026-wbc.txt?raw';
import { compareInWorker, decodeTo16kMono } from './audio/analyze';
import { SAMPLE_RATE } from './audio/features';
import { encodeWav, sliceSeconds } from './audio/wav';
import { transcribe } from './audio/whisper';
import { classify, planImport, type ImportEntry } from './import';
import { Recorder } from './recorder';
import { evaluate, LENIENCIES, type Evaluation } from './scoring';
import { addItem, deleteItem, getAudioBlob, listItems, recordAttempt, requestPersistence, type ItemMeta } from './store';
import { checkWords, type WordResult } from './words';
import type { RawComparison } from './audio/compare';

const app = document.getElementById('app')!;
const MAX_RECORD_MS = 60000;
const TEACHER_SAMPLE_NAME = 'Teacher sample · 2026 WBC';
const TEACHER_SAMPLE_SEEDED_KEY = 'teacherSample2026WbcSeeded';

function h<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
    ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
    const { class: cls, ...rest } = props;
    const el = Object.assign(document.createElement(tag), rest);
    if (cls) el.className = cls;
    el.append(...children);
    return el;
}

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

function getLeniencyId(): string {
    const saved = localStorage.getItem('leniency');
    return LENIENCIES.some((l) => l.id === saved) ? saved! : 'normal';
}

const wordCheckEnabled = () => localStorage.getItem('wordCheck') === '1';

function render(...nodes: Node[]) {
    app.replaceChildren(...nodes);
}

async function importFiles(files: File[]): Promise<string> {
    const entries: (ImportEntry & { file: File })[] = [];
    for (const file of files) {
        const kind = classify(file.name, file.type);
        if (!kind) continue;
        entries.push({ name: file.name, kind, text: kind === 'text' ? await file.text() : undefined, file });
    }
    const plan = planImport(entries);
    const fileOf = (name: string) => entries.find((e) => e.name === name)!.file;
    const warnings = [...plan.warnings];
    let count = 0;
    let skipped = 0;

    for (const pair of plan.pairs) {
        const file = fileOf(pair.audioName);
        await addItem(pair.text, file.name, file.type || 'audio/mp4', await file.arrayBuffer());
        count++;
    }
    for (const cut of plan.cuts) {
        const samples = await decodeTo16kMono(await fileOf(cut.audioName).arrayBuffer());
        for (const [order, cue] of cut.cues.entries()) {
            const clip = sliceSeconds(samples, cue.start, cue.end);
            if (clip.length < SAMPLE_RATE * 0.3) {
                skipped++;
                continue;
            }
            await addItem(cue.text, `${cut.audioName} #${order + 1}`, 'audio/wav', encodeWav(clip), { group: cut.group, order });
            count++;
        }
    }
    if (skipped) warnings.push(`Skipped ${skipped} subtitle line(s) that were too short or outside the recording.`);
    return `Imported ${count} item(s)${warnings.length ? `\n${warnings.join('\n')}` : ''}`;
}

async function showHome(message = '') {
    let items = await listItems();
    if (localStorage.getItem(TEACHER_SAMPLE_SEEDED_KEY) !== '1') {
        try {
            const response = await fetch(teacherSampleAudioUrl);
            if (!response.ok) throw new Error(`Audio request failed (${response.status})`);
            const item = await addItem(
                teacherSampleTranscript.trim(),
                TEACHER_SAMPLE_NAME,
                'audio/mp4',
                await response.arrayBuffer(),
            );
            localStorage.setItem(TEACHER_SAMPLE_SEEDED_KEY, '1');
            items = [...items, item];
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            message = [message, `Teacher sample unavailable: ${reason}`].filter(Boolean).join('\n');
        }
    }

    const picker = h('input', {
        type: 'file',
        multiple: true,
        accept: 'audio/*,.m4a,.mp3,.wav,.aac,.ogg,.flac,.caf,.txt,.csv,.srt,.vtt',
        hidden: true,
    });
    picker.addEventListener('change', async () => {
        const files = Array.from(picker.files ?? []);
        if (!files.length) return;
        try {
            void requestPersistence();
            await showHome('Importing… long recordings can take a moment.');
            await showHome(await importFiles(files));
        } catch (err) {
            await showHome(`Import failed: ${err instanceof Error ? err.message : err}`);
        }
    });

    const leniency = h('select', {}, ...LENIENCIES.map((l) => h('option', { value: l.id, textContent: l.label })));
    leniency.value = getLeniencyId();
    leniency.addEventListener('change', () => localStorage.setItem('leniency', leniency.value));

    const wordCheck = h('input', { type: 'checkbox', checked: wordCheckEnabled() });
    wordCheck.addEventListener('change', () => localStorage.setItem('wordCheck', wordCheck.checked ? '1' : '0'));

    const groups = new Map<string, ItemMeta[]>();
    for (const item of items) groups.set(item.group ?? '', [...(groups.get(item.group ?? '') ?? []), item]);

    const sections = Array.from(groups, ([group, members]) => {
        const cards = h(
            'ul',
            { class: 'cards' },
            ...members.map((item, i) => {
                const label = group ? `${i + 1}. ${item.text}` : item.text;
                const btn = h('button', { class: 'card' }, h('span', { class: 'card-text', textContent: label }), h('span', { class: 'card-stars', textContent: stars(item.bestStars) }));
                btn.addEventListener('click', () => showPractice(item, members));
                return h('li', {}, btn);
            }),
        );
        if (!group) return h('section', {}, cards);

        const remove = h('button', { class: 'danger small', textContent: 'Delete' });
        remove.addEventListener('click', async () => {
            if (!confirm(`Delete "${group}" and its ${members.length} sentences?`)) return;
            for (const m of members) await deleteItem(m.id);
            await showHome();
        });
        return h('section', {}, h('div', { class: 'group-head' }, h('h2', { textContent: group }), remove), cards);
    });

    const list = items.length
        ? h('div', {}, ...sections)
        : h('p', { class: 'empty', textContent: 'No items yet. Tap Import and choose one long recording of a native speaker plus its .srt subtitle file. It is cut into one sentence per subtitle line. You can also import short recordings with matching .txt files.' });

    const importBtn = h('button', { class: 'primary', textContent: 'Import' });
    importBtn.addEventListener('click', () => picker.click());
    const teacherSample = items.find((item) => item.name === TEACHER_SAMPLE_NAME);
    let sampleBtn: HTMLButtonElement | null = null;
    if (teacherSample) {
        sampleBtn = h('button', { textContent: 'Try teacher sample' });
        sampleBtn.addEventListener('click', () => void showPractice(teacherSample));
    }

    render(
        h(
            'header',
            {},
            h('h1', { textContent: 'Pronunciation Practice' }),
            h(
                'div',
                { class: 'settings' },
                h('label', { class: 'leniency' }, 'Scoring ', leniency),
                h('label', { class: 'leniency' }, wordCheck, ' Word check (one-time download of about 70 MB)'),
            ),
        ),
        h('div', { class: 'toolbar' }, importBtn, ...(sampleBtn ? [sampleBtn] : []), picker),
        message ? h('p', { class: 'notice', textContent: message }) : h('span'),
        list,
    );
}

function drawPitch(canvas: HTMLCanvasElement, raw: RawComparison) {
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const hgt = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = hgt * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, hgt);

    const n = raw.refPitch.length;
    const range = 12;
    const x = (i: number) => (i / Math.max(1, n - 1)) * w;
    const y = (st: number) => hgt / 2 - (Math.max(-range, Math.min(range, st)) / range) * (hgt / 2 - 6);

    ctx.strokeStyle = '#e5ddd0';
    ctx.beginPath();
    ctx.moveTo(0, hgt / 2);
    ctx.lineTo(w, hgt / 2);
    ctx.stroke();

    const line = (data: Float32Array, color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        let pen = false;
        data.forEach((v, i) => {
            if (Number.isNaN(v)) {
                pen = false;
                return;
            }
            if (pen) ctx.lineTo(x(i), y(v));
            else ctx.moveTo(x(i), y(v));
            pen = true;
        });
        ctx.stroke();
    };
    line(raw.refPitch, '#2f80ed');
    line(raw.attPitch, '#ff8a3d');
}

function scoreChip(label: string, value: number | null): HTMLElement {
    return h('div', { class: 'score-chip' }, h('div', { class: 'chip-value', textContent: value === null ? '–' : `${value}` }), h('div', { class: 'chip-label', textContent: label }));
}

function resultView(raw: RawComparison, ev: Evaluation): HTMLElement {
    const soundBar = h(
        'div',
        { class: 'segments' },
        ...ev.segmentScores.map((s) => h('span', { class: s >= 70 ? 'seg good' : s >= 45 ? 'seg mid' : 'seg bad', title: `${s}` })),
    );
    const paceBar = h('div', { class: 'segments' }, ...ev.segmentPace.map((p) => h('span', { class: `seg pace-${p}` })));
    const canvas = h('canvas', { class: 'pitch' });
    const hint = (text: string) => h('p', { class: 'hint', textContent: text });
    const hasPitch = ev.intonationScore !== null;

    const view = h(
        'section',
        { class: 'result' },
        h('div', { class: 'big-stars', textContent: stars(ev.stars) }),
        h('div', { class: 'score', textContent: `${ev.score} points` }),
        h('div', { class: 'score-chips' }, scoreChip('Sound', ev.soundScore), scoreChip('Intonation', ev.intonationScore), scoreChip('Rhythm', ev.rhythmScore)),
        hint('Sound over time: green is close to the example, red is far.'),
        soundBar,
        hint('Rhythm over time: orange means you lingered, blue means you rushed.'),
        paceBar,
        ...(hasPitch ? [hint('Pitch: blue is the example, orange is you.'), canvas] : []),
        h('ul', { class: 'notes' }, ...ev.notes.map((n) => h('li', { textContent: n }))),
    );
    if (hasPitch) requestAnimationFrame(() => drawPitch(canvas, raw));
    return view;
}

const errorText: Record<string, string> = {
    TOO_SHORT: 'Recording too short. Try again.',
    TOO_LONG: 'Recording too long (60 seconds max).',
};

async function showPractice(item: ItemMeta, queue: ItemMeta[] = [item]) {
    const index = Math.max(0, queue.findIndex((q) => q.id === item.id));
    let current = item;
    let refPlayer: HTMLAudioElement | null = null;
    let myUrl: string | null = null;
    const recorder = new Recorder();
    let recording = false;
    let timer: number | undefined;
    let attempt = 0;

    const resultBox = h('div', { class: 'result-box' });
    const status = h('p', { class: 'status' });
    const wordsLine = h('p', { class: 'status' });
    const starsLine = h('div', { class: 'card-stars', textContent: `Best: ${stars(current.bestStars)}` });

    const sentence = h('div', { class: `sentence ${item.text.length > 70 ? 'xl' : item.text.length > 30 ? 'l' : 'm'}` });
    const renderSentence = (results: WordResult[] | null) => {
        const chips: { word: string; status?: WordResult['status']; heard?: string }[] =
            results ?? item.text.split(/\s+/).filter(Boolean).map((word) => ({ word }));
        sentence.replaceChildren(
            ...chips.map((c) => h('span', { class: `w ${c.status ?? ''}`.trim() }, c.word, ...(c.heard ? [h('small', { textContent: c.heard })] : []))),
        );
    };
    renderSentence(null);

    const leave = () => {
        attempt++;
        window.clearTimeout(timer);
        if (recording) void recorder.stop().catch(() => undefined);
        refPlayer?.pause();
        if (myUrl) URL.revokeObjectURL(myUrl);
    };

    const back = h('button', { class: 'link', textContent: '← Back' });
    back.addEventListener('click', () => {
        leave();
        void showHome();
    });

    const step = (delta: number, label: string) => {
        const btn = h('button', { class: 'link', textContent: label, disabled: !queue[index + delta] });
        btn.addEventListener('click', () => {
            leave();
            void showPractice(queue[index + delta], queue);
        });
        return btn;
    };

    const play = async (rate: number) => {
        refPlayer?.pause();
        const url = URL.createObjectURL(await getAudioBlob(item.id));
        refPlayer = new Audio(url);
        refPlayer.preservesPitch = true;
        refPlayer.playbackRate = rate;
        refPlayer.addEventListener('ended', () => URL.revokeObjectURL(url));
        await refPlayer.play();
    };

    const playRef = h('button', { class: 'primary', textContent: '▶ Listen' });
    playRef.addEventListener('click', () => void play(1));
    const playSlow = h('button', { textContent: '▶ Slow' });
    playSlow.addEventListener('click', () => void play(0.7));

    const playMine = h('button', { textContent: '▶ My recording', hidden: true });
    playMine.addEventListener('click', () => {
        if (myUrl) void new Audio(myUrl).play();
    });

    const recBtn = h('button', { class: 'record', textContent: '● Record' });
    const fileInput = h('input', { type: 'file', accept: 'audio/*', hidden: true });
    const fileBtn = h('button', { textContent: 'Use a file' });
    fileBtn.addEventListener('click', () => fileInput.click());

    const checkSpoken = async (att: Float32Array, token: number) => {
        wordsLine.textContent = 'Checking words…';
        try {
            const text = await transcribe(att, (pct) => {
                if (token === attempt) wordsLine.textContent = pct >= 100 ? 'Checking words…' : `Loading the speech model… ${pct}% (first time only)`;
            });
            if (token !== attempt) return;
            const results = checkWords(item.text, text);
            renderSentence(results);
            const ok = results.filter((r) => r.status === 'ok').length;
            wordsLine.textContent = `Words: ${ok} of ${results.length} matched. Heard: "${text.trim()}"`;
        } catch {
            if (token === attempt) wordsLine.textContent = 'Word check unavailable. The speech model needs an internet connection the first time.';
        }
    };

    const analyze = async (getBlob: () => Promise<Blob>) => {
        const token = ++attempt;
        recBtn.disabled = true;
        fileBtn.disabled = true;
        status.textContent = 'Analyzing…';
        wordsLine.textContent = '';
        renderSentence(null);
        try {
            const blob = await getBlob();
            if (myUrl) URL.revokeObjectURL(myUrl);
            myUrl = URL.createObjectURL(blob);
            playMine.hidden = false;

            const [ref, att] = await Promise.all([
                getAudioBlob(item.id).then((b) => b.arrayBuffer()).then(decodeTo16kMono),
                blob.arrayBuffer().then(decodeTo16kMono),
            ]);
            const raw = await compareInWorker(ref, att);
            const ev = evaluate(raw, LENIENCIES.find((l) => l.id === getLeniencyId())!);
            current = await recordAttempt(item.id, ev.score, ev.stars);
            starsLine.textContent = `Best: ${stars(current.bestStars)}`;
            resultBox.replaceChildren(resultView(raw, ev));
            status.textContent = '';
            if (wordCheckEnabled()) void checkSpoken(att, token);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            status.textContent = errorText[msg] ?? `Analysis failed: ${msg}`;
        } finally {
            recBtn.disabled = false;
            fileBtn.disabled = false;
        }
    };

    const finish = () => {
        window.clearTimeout(timer);
        recording = false;
        recBtn.textContent = '● Record';
        recBtn.classList.remove('active');
        return analyze(() => recorder.stop());
    };

    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (file) void analyze(async () => file);
    });

    recBtn.addEventListener('click', async () => {
        if (recording) {
            await finish();
            return;
        }
        try {
            refPlayer?.pause();
            await recorder.start();
            recording = true;
            recBtn.textContent = '■ Stop';
            recBtn.classList.add('active');
            status.textContent = 'Recording…';
            resultBox.replaceChildren();
            timer = window.setTimeout(() => void finish(), MAX_RECORD_MS);
        } catch (err) {
            const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
            status.textContent = `Cannot record (${reason}). Allow microphone access for this site, and use https or localhost.`;
        }
    });

    const del = h('button', { class: 'danger', textContent: 'Delete this item' });
    del.addEventListener('click', async () => {
        if (!confirm(`Delete "${item.text}"?`)) return;
        await deleteItem(item.id);
        await showHome();
    });

    render(
        h('header', {}, back, queue.length > 1 ? h('div', { class: 'pager' }, step(-1, '‹ Prev'), h('span', { textContent: `${index + 1} / ${queue.length}` }), step(1, 'Next ›')) : h('span')),
        sentence,
        wordsLine,
        starsLine,
        h('div', { class: 'actions' }, playRef, playSlow, recBtn, fileBtn, playMine, fileInput),
        status,
        resultBox,
        del,
    );
}

void showHome();
