import { describe, expect, it } from 'vitest';
import { compareUtterances } from './compare';
import { dtw } from './dtw';
import { yinPitch, toRelativeSemitones } from './pitch';
import { frameCount } from './features';
import { findPauses } from './prosody';
import { trimSilence } from './trim';
import { encodeWav, sliceSeconds } from './wav';
import { SAMPLE_RATE } from './features';
import { concat, silence, synth, wordA, wordB } from './testSignals';

describe('trimSilence', () => {
    it('removes leading and trailing silence', () => {
        const tone = synth(wordA(120));
        const padded = concat(silence(0.5), tone, silence(0.5));
        const trimmed = trimSilence(padded);
        expect(trimmed.length).toBeLessThan(padded.length - 0.6 * SAMPLE_RATE);
        expect(trimmed.length).toBeGreaterThanOrEqual(tone.length);
    });
});

describe('yinPitch', () => {
    it('tracks a 200 Hz tone', () => {
        const x = synth([{ f0: 200, formants: [250], seconds: 0.5 }]);
        const f0 = yinPitch(x, frameCount(x.length));
        const voiced = Array.from(f0).filter((f) => f > 0);
        expect(voiced.length).toBeGreaterThan(20);
        for (const f of voiced) expect(Math.abs(f - 200)).toBeLessThan(5);
    });

    it('returns NaN semitones for unvoiced frames', () => {
        const st = toRelativeSemitones(new Float32Array([0, 100, 200]));
        expect(Number.isNaN(st[0])).toBe(true);
    });
});

describe('dtw', () => {
    it('aligns identical sequences on the diagonal', () => {
        const seq = Array.from({ length: 10 }, (_, i) => new Float32Array([i, i * 2]));
        const path = dtw(seq, seq);
        expect(path.every(([i, j]) => i === j)).toBe(true);
    });
});

describe('compareUtterances', () => {
    const adultA = concat(silence(0.3), synth(wordA(120)), silence(0.3));

    it('scores identical audio as near-zero distance', () => {
        const r = compareUtterances(adultA, adultA);
        expect(r.distance).toBeLessThan(0.05);
        expect(r.speedRatio).toBeCloseTo(1, 1);
    });

    it('prefers the same word from a child voice over a different word', () => {
        const childSame = synth(wordA(300), 1.3, 1.15);
        const childOther = synth(wordB(300), 1.3, 1.15);
        const same = compareUtterances(adultA, childSame);
        const other = compareUtterances(adultA, childOther);
        expect(same.distance).toBeLessThan(other.distance);
        expect(same.speedRatio).toBeGreaterThan(1.05);
    });

    it('prefers a slightly slower repeat over a different word', () => {
        const slower = synth(wordA(120), 1.2);
        const other = synth(wordB(120));
        expect(compareUtterances(adultA, slower).distance).toBeLessThan(compareUtterances(adultA, other).distance);
    });

    it('rejects empty recordings', () => {
        expect(() => compareUtterances(adultA, silence(1))).toThrow('TOO_SHORT');
    });

    it('finds a skipped pause and a rhythm difference', () => {
        const phrase = synth(wordA(120));
        const withPause = concat(phrase, silence(0.5), phrase);
        const noPause = concat(phrase, phrase);
        const r = compareUtterances(withPause, noPause);
        expect(r.pauses.refCount).toBe(1);
        expect(r.pauses.missed).toBe(1);
        expect(r.pauses.extra).toBe(0);

        const same = compareUtterances(withPause, withPause);
        expect(same.pauses).toMatchObject({ refCount: 1, matched: 1, missed: 0, extra: 0 });
        expect(same.rhythmDeviation).toBeLessThan(r.rhythmDeviation);
    });

    it('reports a flatter pitch contour', () => {
        const moving = synth([
            { f0: 100, formants: [250], seconds: 0.3 },
            { f0: 200, formants: [250], seconds: 0.3 },
            { f0: 100, formants: [250], seconds: 0.3 },
        ]);
        const flat = synth([{ f0: 140, formants: [250], seconds: 0.9 }]);
        const r = compareUtterances(moving, flat);
        expect(r.pitchRangeRatio).not.toBeNull();
        expect(r.pitchRangeRatio!).toBeLessThan(0.5);
    });
});

describe('findPauses', () => {
    it('ignores silence at the edges', () => {
        const tone = synth(wordA(120));
        expect(findPauses(concat(silence(0.4), tone, silence(0.4)))).toEqual([]);
    });
    it('finds a pause between phrases', () => {
        const tone = synth(wordA(120));
        const spans = findPauses(concat(tone, silence(0.4), tone));
        expect(spans).toHaveLength(1);
        expect(spans[0].end - spans[0].start).toBeGreaterThanOrEqual(35);
    });
});

describe('wav', () => {
    it('writes a 16 kHz mono PCM header and samples', () => {
        const buf = encodeWav(new Float32Array([0, 0.5, -0.5]));
        const view = new DataView(buf);
        expect(String.fromCharCode(...new Uint8Array(buf, 0, 4))).toBe('RIFF');
        expect(view.getUint32(24, true)).toBe(16000);
        expect(view.getUint16(22, true)).toBe(1);
        expect(buf.byteLength).toBe(44 + 6);
        expect(view.getInt16(46, true)).toBeCloseTo(16383, -1);
    });
    it('slices with padding and clamps to the recording', () => {
        const x = new Float32Array(SAMPLE_RATE * 2);
        expect(sliceSeconds(x, 0.5, 1, 0.25).length).toBe(SAMPLE_RATE);
        expect(sliceSeconds(x, 0, 2, 0.5).length).toBe(2 * SAMPLE_RATE);
    });
});
