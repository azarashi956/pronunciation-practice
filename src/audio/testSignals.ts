import { SAMPLE_RATE } from './features';

export interface Segment {
    f0: number;
    formants: number[];
    seconds: number;
}

// Source-filter vowel synth: harmonic series shaped by Gaussian resonances.
export function synth(segments: Segment[], stretch = 1, formantScale = 1): Float32Array {
    const parts: Float32Array[] = [];
    for (const seg of segments) {
        const n = Math.round(seg.seconds * stretch * SAMPLE_RATE);
        const out = new Float32Array(n);
        for (let h = 1; h * seg.f0 < 5000; h++) {
            const f = h * seg.f0;
            let amp = 0;
            for (const fm of seg.formants) amp += Math.exp(-(((f - fm * formantScale) / 120) ** 2));
            amp /= h ** 0.5;
            for (let i = 0; i < n; i++) out[i] += amp * Math.sin((2 * Math.PI * f * i) / SAMPLE_RATE);
        }
        const fade = Math.min(200, n >> 2);
        for (let i = 0; i < fade; i++) {
            out[i] *= i / fade;
            out[n - 1 - i] *= i / fade;
        }
        parts.push(out);
    }
    const all = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) {
        all.set(p, o);
        o += p.length;
    }
    const peak = all.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    return all.map((v) => (v / peak) * 0.5);
}

export const silence = (seconds: number) => new Float32Array(Math.round(seconds * SAMPLE_RATE));

export function concat(...xs: Float32Array[]): Float32Array {
    const out = new Float32Array(xs.reduce((s, x) => s + x.length, 0));
    let o = 0;
    for (const x of xs) {
        out.set(x, o);
        o += x.length;
    }
    return out;
}

const A = [800, 1200];
const I = [300, 2300];
const U = [320, 800];
const E = [550, 1900];

export const wordA = (f0: number): Segment[] => [
    { f0, formants: A, seconds: 0.2 },
    { f0, formants: I, seconds: 0.2 },
    { f0, formants: U, seconds: 0.2 },
];
export const wordB = (f0: number): Segment[] => [
    { f0, formants: U, seconds: 0.2 },
    { f0, formants: E, seconds: 0.2 },
    { f0, formants: A, seconds: 0.2 },
];
