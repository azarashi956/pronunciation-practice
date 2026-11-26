import { HOP, SAMPLE_RATE } from './features';

const WIN = 480;
const FMIN = 70;
const FMAX = 600;
const THRESHOLD = 0.15;

// YIN pitch tracker; returns F0 in Hz per frame, 0 when unvoiced.
export function yinPitch(x: Float32Array, nFrames: number): Float32Array {
    const tauMin = Math.floor(SAMPLE_RATE / FMAX);
    const tauMax = Math.ceil(SAMPLE_RATE / FMIN);
    const out = new Float32Array(nFrames);
    const d = new Float64Array(tauMax + 1);
    const cmnd = new Float64Array(tauMax + 1);

    for (let t = 0; t < nFrames; t++) {
        const s = t * HOP;
        if (s + WIN + tauMax > x.length) continue;

        for (let tau = 1; tau <= tauMax; tau++) {
            let sum = 0;
            for (let j = 0; j < WIN; j++) {
                const diff = x[s + j] - x[s + j + tau];
                sum += diff * diff;
            }
            d[tau] = sum;
        }
        cmnd[0] = 1;
        let running = 0;
        let silent = false;
        for (let tau = 1; tau <= tauMax; tau++) {
            running += d[tau];
            if (running === 0) {
                silent = true;
                break;
            }
            cmnd[tau] = (d[tau] * tau) / running;
        }
        if (silent) continue;

        let tau = tauMin;
        while (tau <= tauMax && cmnd[tau] >= THRESHOLD) tau++;
        if (tau > tauMax) continue;
        while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;

        let better = tau;
        if (tau > 1 && tau < tauMax) {
            const [a, b, c] = [cmnd[tau - 1], cmnd[tau], cmnd[tau + 1]];
            const denom = a - 2 * b + c;
            if (denom !== 0) better = tau + (a - c) / (2 * denom);
        }
        out[t] = SAMPLE_RATE / better;
    }
    return out;
}

// Semitones relative to the utterance median, so adult and child registers are comparable. NaN = unvoiced.
export function toRelativeSemitones(f0: Float32Array): Float32Array {
    const voiced = Array.from(f0).filter((f) => f > 0).sort((a, b) => a - b);
    const out = new Float32Array(f0.length).fill(NaN);
    if (voiced.length === 0) return out;
    const median = voiced[Math.floor(voiced.length / 2)];
    for (let i = 0; i < f0.length; i++) if (f0[i] > 0) out[i] = 12 * Math.log2(f0[i] / median);
    return out;
}
