import { makeFft } from './fft';

export const SAMPLE_RATE = 16000;
export const HOP = 160;
const FRAME = 400;
const NFFT = 512;
const NMEL = 40;
const NCEP = 12;
const FMIN = 80;
const FMAX = 7600;
const PREEMPH = 0.97;

const fft = makeFft(NFFT);
const hamming = Float64Array.from({ length: FRAME }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));

const hzToMel = (f: number) => 2595 * Math.log10(1 + f / 700);
const melToHz = (m: number) => 700 * (10 ** (m / 2595) - 1);

function buildMelBank(): Float64Array[] {
    const points = Array.from({ length: NMEL + 2 }, (_, i) =>
        melToHz(hzToMel(FMIN) + ((hzToMel(FMAX) - hzToMel(FMIN)) * i) / (NMEL + 1)),
    );
    const bins = points.map((f) => (f * NFFT) / SAMPLE_RATE);
    return Array.from({ length: NMEL }, (_, m) => {
        const filter = new Float64Array(NFFT / 2 + 1);
        const [lo, mid, hi] = [bins[m], bins[m + 1], bins[m + 2]];
        for (let k = Math.ceil(lo); k <= Math.floor(hi); k++) {
            filter[k] = k <= mid ? (k - lo) / (mid - lo) : (hi - k) / (hi - mid);
        }
        return filter;
    });
}

const melBank = buildMelBank();
// Row q holds the DCT-II basis for cepstral coefficient q+1 (c0 is dropped to ignore loudness).
const dctTable = Array.from({ length: NCEP }, (_, q) =>
    Float64Array.from({ length: NMEL }, (_, m) => Math.cos((Math.PI * (q + 1) * (m + 0.5)) / NMEL)),
);

export function frameCount(length: number): number {
    return length < FRAME ? 1 : Math.floor((length - FRAME) / HOP) + 1;
}

function mfcc(x: Float32Array): Float32Array[] {
    const n = frameCount(x.length);
    const re = new Float64Array(NFFT);
    const im = new Float64Array(NFFT);
    const logMel = new Float64Array(NMEL);
    const out: Float32Array[] = [];

    for (let t = 0; t < n; t++) {
        const start = t * HOP;
        re.fill(0);
        im.fill(0);
        for (let j = 0; j < FRAME; j++) {
            const i = start + j;
            const cur = i < x.length ? x[i] : 0;
            const prev = i > 0 && i - 1 < x.length ? x[i - 1] : 0;
            re[j] = (cur - PREEMPH * prev) * hamming[j];
        }
        fft(re, im);
        for (let m = 0; m < NMEL; m++) {
            const f = melBank[m];
            let e = 0;
            for (let k = 0; k <= NFFT / 2; k++) if (f[k] !== 0) e += f[k] * (re[k] * re[k] + im[k] * im[k]);
            logMel[m] = Math.log(Math.max(e, 1e-10));
        }
        const c = new Float32Array(NCEP);
        for (let q = 0; q < NCEP; q++) {
            let s = 0;
            for (let m = 0; m < NMEL; m++) s += logMel[m] * dctTable[q][m];
            c[q] = s;
        }
        out.push(c);
    }
    return out;
}

function addDeltas(c: Float32Array[]): Float32Array[] {
    const n = c.length;
    const at = (t: number) => c[Math.min(n - 1, Math.max(0, t))];
    return c.map((frame, t) => {
        const out = new Float32Array(NCEP * 2);
        out.set(frame);
        for (let d = 0; d < NCEP; d++) {
            let num = 0;
            for (let k = 1; k <= 2; k++) num += k * (at(t + k)[d] - at(t - k)[d]);
            out[NCEP + d] = num / 10;
        }
        return out;
    });
}

// Per-utterance mean/variance normalization reduces speaker and microphone differences.
function cmvn(frames: Float32Array[]): void {
    const dim = frames[0].length;
    const n = frames.length;
    for (let d = 0; d < dim; d++) {
        let mean = 0;
        for (const f of frames) mean += f[d];
        mean /= n;
        let v = 0;
        for (const f of frames) v += (f[d] - mean) ** 2;
        const std = Math.max(Math.sqrt(v / n), 1e-4);
        for (const f of frames) f[d] = (f[d] - mean) / std;
    }
}

export function buildFeatures(x: Float32Array): Float32Array[] {
    const frames = addDeltas(mfcc(x));
    cmvn(frames);
    return frames;
}
