import type { Path } from './dtw';
import { HOP, SAMPLE_RATE } from './features';

const FRAME_SECONDS = HOP / SAMPLE_RATE;

export interface Span {
    start: number;
    end: number;
}

/** Internal silences of at least `minSeconds`, as frame ranges (one frame = 10 ms). */
export function findPauses(x: Float32Array, minSeconds = 0.2): Span[] {
    const n = Math.floor(x.length / HOP);
    if (n === 0) return [];

    const rms = new Float32Array(n);
    for (let f = 0; f < n; f++) {
        let s = 0;
        for (let i = f * HOP; i < (f + 1) * HOP; i++) s += x[i] * x[i];
        rms[f] = Math.sqrt(s / HOP);
    }
    const sorted = Float32Array.from(rms).sort();
    const loud = sorted[Math.min(n - 1, Math.floor(n * 0.95))];
    if (loud <= 0) return [];
    const threshold = loud * 0.1;

    const minFrames = Math.round(minSeconds / FRAME_SECONDS);
    const pauses: Span[] = [];
    let start = -1;
    for (let f = 0; f <= n; f++) {
        const quiet = f < n && rms[f] < threshold;
        if (quiet && start < 0) start = f;
        if (!quiet && start >= 0) {
            // Silence touching either edge is lead-in or trail-off, not a pause.
            if (start > 0 && f < n && f - start >= minFrames) pauses.push({ start, end: f });
            start = -1;
        }
    }
    return pauses;
}

export interface PauseComparison {
    refCount: number;
    attCount: number;
    matched: number;
    missed: number;
    extra: number;
}

const mid = (s: Span) => Math.round((s.start + s.end) / 2);
const covers = (spans: Span[], frame: number, tolerance: number) =>
    spans.some((s) => frame >= s.start - tolerance && frame <= s.end + tolerance);

function averageIndex(path: Path, from: 0 | 1, size: number): number[] {
    const to = from === 0 ? 1 : 0;
    const sum = new Float64Array(size);
    const count = new Uint32Array(size);
    for (const step of path) {
        sum[step[from]] += step[to];
        count[step[from]]++;
    }
    return Array.from(sum, (s, i) => (count[i] ? Math.round(s / count[i]) : 0));
}

/** Pauses are "matched" when the other recording also pauses at the aligned moment. */
export function comparePauses(ref: Span[], att: Span[], path: Path, nRef: number, nAtt: number, tolerance = 15): PauseComparison {
    const refToAtt = averageIndex(path, 0, nRef);
    const attToRef = averageIndex(path, 1, nAtt);
    const missed = ref.filter((p) => !covers(att, refToAtt[Math.min(nRef - 1, mid(p))], tolerance)).length;
    const extra = att.filter((p) => !covers(ref, attToRef[Math.min(nAtt - 1, mid(p))], tolerance)).length;
    return { refCount: ref.length, attCount: att.length, matched: ref.length - missed, missed, extra };
}

/**
 * Local speed of the attempt relative to its own overall pace, per slice of the reference.
 * 1 = same rhythm, above 1 = lingered, below 1 = rushed.
 */
export function localSpeed(path: Path, nRef: number, nAtt: number, bins: number): number[] {
    const lo = new Array<number>(bins).fill(Infinity);
    const hi = new Array<number>(bins).fill(-Infinity);
    for (const [i, j] of path) {
        const b = Math.min(bins - 1, Math.floor((i * bins) / nRef));
        lo[b] = Math.min(lo[b], j);
        hi[b] = Math.max(hi[b], j);
    }
    const overall = nAtt / nRef;
    return lo.map((l, b) => {
        const refFrames = nRef / bins;
        const attFrames = Number.isFinite(l) ? hi[b] - l + 1 : refFrames * overall;
        return attFrames / refFrames / overall;
    });
}

/** Root-mean-square of ln(local speed); 0 = identical rhythm. */
export function rhythmDeviation(speeds: number[]): number {
    const sq = speeds.map((s) => Math.log(Math.max(s, 0.05)) ** 2);
    return Math.sqrt(sq.reduce((a, b) => a + b, 0) / Math.max(1, sq.length));
}

export function pearson(a: number[], b: number[]): number | null {
    const n = a.length;
    if (n < 2) return null;
    const ma = a.reduce((s, v) => s + v, 0) / n;
    const mb = b.reduce((s, v) => s + v, 0) / n;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < n; i++) {
        num += (a[i] - ma) * (b[i] - mb);
        da += (a[i] - ma) ** 2;
        db += (b[i] - mb) ** 2;
    }
    return da === 0 || db === 0 ? null : num / Math.sqrt(da * db);
}

/** Spread (p90 - p10) of the voiced semitone values, or null when there is too little voiced speech. */
export function pitchRange(semitones: ArrayLike<number>, minVoiced = 8): number | null {
    const v = Array.from(semitones).filter((s) => !Number.isNaN(s)).sort((a, b) => a - b);
    if (v.length < minVoiced) return null;
    return v[Math.floor(v.length * 0.9)] - v[Math.floor(v.length * 0.1)];
}
