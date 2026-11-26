import { SAMPLE_RATE } from './features';

const WINDOW = Math.round(SAMPLE_RATE * 0.02);

export function trimSilence(x: Float32Array, padSeconds = 0.05): Float32Array {
    const n = Math.floor(x.length / WINDOW);
    if (n === 0) return x;

    const rms = new Float32Array(n);
    for (let w = 0; w < n; w++) {
        let s = 0;
        for (let i = w * WINDOW; i < (w + 1) * WINDOW; i++) s += x[i] * x[i];
        rms[w] = Math.sqrt(s / WINDOW);
    }
    const sorted = Float32Array.from(rms).sort();
    const loud = sorted[Math.min(n - 1, Math.floor(n * 0.95))];
    // Below roughly -50 dBFS there is no speech, only room noise.
    if (loud < 0.003) return x.slice(0, 0);
    const threshold = loud * 0.1;

    let first = 0;
    while (first < n && rms[first] < threshold) first++;
    let last = n - 1;
    while (last > first && rms[last] < threshold) last--;
    if (first >= n) return x;

    const pad = Math.round(SAMPLE_RATE * padSeconds);
    return x.slice(Math.max(0, first * WINDOW - pad), Math.min(x.length, (last + 1) * WINDOW + pad));
}
