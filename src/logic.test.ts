import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { classify, parseCues, parseListText, planImport } from './import';
import { evaluate, LENIENCIES, starsFor } from './scoring';
import { checkWords } from './words';
import type { RawComparison } from './audio/compare';

describe('classify', () => {
    it('detects audio and text files', () => {
        expect(classify('a.M4A', '')).toBe('audio');
        expect(classify('words.srt', '')).toBe('text');
        expect(classify('photo.jpg', 'image/jpeg')).toBeNull();
    });
});

describe('parseListText', () => {
    it('reads txt lines', () => {
        expect(parseListText('a.txt', '\uFEFFone\n\n two \r\nthree')).toEqual(['one', 'two', 'three']);
    });
    it('reads the first csv column', () => {
        expect(parseListText('a.csv', 'apple,蘋果\n"big, red",x')).toEqual(['apple', 'big, red']);
    });
    it('reads srt cues', () => {
        const srt = '1\n00:00:01,000 --> 00:00:02,000\nHello there\n\n2\n00:00:03,000 --> 00:00:04,000\nHow are\nyou\n';
        expect(parseListText('a.srt', srt)).toEqual(['Hello there', 'How are you']);
    });
});

describe('parseCues', () => {
    it('reads srt timestamps and strips tags', () => {
        const srt = '1\n00:00:01,500 --> 00:00:03,000\n<i>Hello</i> there\n\n2\n00:01:03,250 --> 00:01:05,000\nHow are\nyou?\n';
        expect(parseCues('a.srt', srt)).toEqual([
            { start: 1.5, end: 3, text: 'Hello there' },
            { start: 63.25, end: 65, text: 'How are you?' },
        ]);
    });
    it('reads vtt with short timestamps and cue settings', () => {
        const vtt = 'WEBVTT\n\n00:02.000 --> 00:04.500 align:start\nGood morning\n';
        expect(parseCues('a.vtt', vtt)).toEqual([{ start: 2, end: 4.5, text: 'Good morning' }]);
    });
    it('ignores files without timestamps', () => {
        expect(parseCues('a.txt', '00:00:01,000 --> 00:00:02,000\nHi')).toEqual([]);
        expect(parseCues('a.srt', 'just text')).toEqual([]);
    });
});

describe('planImport', () => {
    it('pairs the 2026 WBC sample recording with its transcript', () => {
        const audio = readFileSync(new URL('./assets/teacher-2026-wbc.m4a', import.meta.url));
        const transcript = readFileSync(new URL('./assets/teacher-2026-wbc.txt', import.meta.url), 'utf8');
        expect(audio.byteLength).toBeGreaterThan(0);
        expect(classify('teacher-2026-wbc.m4a', 'audio/mp4')).toBe('audio');
        expect(classify('teacher-2026-wbc.txt', 'text/plain')).toBe('text');
        expect(
            planImport([
                { name: 'teacher-2026-wbc.m4a', kind: 'audio' },
                { name: 'teacher-2026-wbc.txt', kind: 'text', text: transcript },
            ]),
        ).toEqual({
            pairs: [{ audioName: 'teacher-2026-wbc.m4a', text: transcript.trim().split(/\r?\n/).join(' ') }],
            cuts: [],
            warnings: [],
        });
    });

    it('cuts one recording by its subtitle cues', () => {
        const srt = '1\n00:00:00,000 --> 00:00:02,000\nFirst line\n\n2\n00:00:02,500 --> 00:00:05,000\nSecond line\n';
        const plan = planImport([
            { name: 'speech.m4a', kind: 'audio' },
            { name: 'captions.srt', kind: 'text', text: srt },
        ]);
        expect(plan.pairs).toEqual([]);
        expect(plan.cuts).toHaveLength(1);
        expect(plan.cuts[0].group).toBe('speech');
        expect(plan.cuts[0].cues.map((c) => c.text)).toEqual(['First line', 'Second line']);
    });

    it('keeps one-word recordings paired with plain text', () => {
        const plan = planImport([
            { name: 'apple.m4a', kind: 'audio' },
            { name: 'apple.txt', kind: 'text', text: 'apple' },
        ]);
        expect(plan.cuts).toEqual([]);
        expect(plan.pairs).toHaveLength(1);
    });

    it('pairs by matching base name', () => {
        const plan = planImport([
            { name: 'apple.m4a', kind: 'audio' },
            { name: 'apple.txt', kind: 'text', text: 'apple\n' },
        ]);
        expect(plan.pairs).toEqual([{ audioName: 'apple.m4a', text: 'apple' }]);
    });

    it('pairs a list file with audio in natural order', () => {
        const plan = planImport([
            { name: 'w10.mp3', kind: 'audio' },
            { name: 'w2.mp3', kind: 'audio' },
            { name: 'list.txt', kind: 'text', text: 'two\nten' },
        ]);
        expect(plan.pairs.map((p) => p.text)).toEqual(['two', 'ten']);
        expect(plan.warnings).toEqual([]);
    });

    it('warns on count mismatch and falls back to the file name', () => {
        const plan = planImport([
            { name: 'big_dog.wav', kind: 'audio' },
            { name: 'cat.wav', kind: 'audio' },
            { name: 'list.txt', kind: 'text', text: 'only one' },
        ]);
        expect(plan.pairs).toEqual([
            { audioName: 'big_dog.wav', text: 'only one' },
            { audioName: 'cat.wav', text: 'cat' },
        ]);
        expect(plan.warnings).toHaveLength(1);
    });
});

describe('evaluate', () => {
    const raw = (distance: number, pitchDistance: number | null): RawComparison => ({
        distance,
        segmentDistances: [distance],
        pitchDistance,
        pitchCorrelation: pitchDistance === null ? null : 0.8,
        pitchRangeRatio: 1,
        pauses: { refCount: 0, attCount: 0, matched: 0, missed: 0, extra: 0 },
        segmentSpeed: [1],
        rhythmDeviation: 0,
        speedRatio: 1,
        refDuration: 1,
        attDuration: 1,
        refPitch: new Float32Array(),
        attPitch: new Float32Array(),
    });
    const normal = LENIENCIES.find((l) => l.id === 'normal')!;

    it('scores closer audio higher', () => {
        expect(evaluate(raw(0.2, null), normal).score).toBeGreaterThan(evaluate(raw(1.2, null), normal).score);
    });
    it('is more generous when lenient', () => {
        const easy = LENIENCIES.find((l) => l.id === 'easy')!;
        expect(evaluate(raw(1, null), easy).score).toBeGreaterThan(evaluate(raw(1, null), normal).score);
    });
    it('maps scores to stars', () => {
        expect([90, 65, 45, 10].map(starsFor)).toEqual([3, 2, 1, 0]);
    });
    it('reports skipped pauses, flat pitch and rushed spots', () => {
        const r = raw(0.5, 1);
        r.pauses = { refCount: 2, attCount: 1, matched: 1, missed: 1, extra: 1 };
        r.pitchRangeRatio = 0.4;
        r.segmentSpeed = [1, 0.4];
        const ev = evaluate(r, normal);
        const text = ev.notes.join(' ');
        expect(text).toContain('skipped 1 pause');
        expect(text).toContain('1 extra pause');
        expect(text).toContain('flatter');
        expect(text).toContain('rushed');
        expect(ev.segmentPace).toEqual(['ok', 'fast']);
    });
    it('penalizes unmatched pauses in the rhythm score', () => {
        const clean = evaluate(raw(0.5, null), normal);
        const r = raw(0.5, null);
        r.pauses = { refCount: 2, attCount: 0, matched: 0, missed: 2, extra: 0 };
        expect(evaluate(r, normal).rhythmScore).toBeLessThan(clean.rhythmScore);
    });
});

describe('checkWords', () => {
    it('marks every word ok when the transcript matches', () => {
        const r = checkWords("Don't stop, believing!", "don't stop believing");
        expect(r.map((w) => w.status)).toEqual(['ok', 'ok', 'ok']);
    });
    it('flags a wrong word with what was heard', () => {
        const r = checkWords('the cat sat', 'the cut sat');
        expect(r[1]).toEqual({ word: 'cat', status: 'wrong', heard: 'cut' });
    });
    it('flags a missing word without shifting the rest', () => {
        const r = checkWords('I like red apples', 'I like apples');
        expect(r.map((w) => w.status)).toEqual(['ok', 'ok', 'missing', 'ok']);
    });
    it('ignores extra heard words and pure punctuation', () => {
        const r = checkWords('hello — world', 'oh hello world');
        expect(r.map((w) => w.status)).toEqual(['ok', 'ok', 'ok']);
    });
    it('marks everything missing for an empty transcript', () => {
        expect(checkWords('good morning', '').map((w) => w.status)).toEqual(['missing', 'missing']);
    });
});
