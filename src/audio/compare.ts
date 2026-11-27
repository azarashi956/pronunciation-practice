import { dtw, localDistance } from './dtw';
import { buildFeatures, frameCount, SAMPLE_RATE } from './features';
import { toRelativeSemitones, yinPitch } from './pitch';
import { comparePauses, findPauses, localSpeed, pearson, pitchRange, rhythmDeviation, type PauseComparison } from './prosody';
import { trimSilence } from './trim';

export const MIN_SECONDS = 0.15;
export const MAX_SECONDS = 60;

export interface RawComparison {
    /** Mean feature distance along the DTW path; 0 = identical. */
    distance: number;
    /** Mean feature distance per equal slice of the reference. */
    segmentDistances: number[];
    /** Mean absolute pitch-contour difference in semitones, or null when too little voiced speech. */
    pitchDistance: number | null;
    /** Pearson correlation of the aligned pitch contours, or null when too little voiced speech. */
    pitchCorrelation: number | null;
    /** Attempt pitch spread divided by reference pitch spread; below 1 = flatter. */
    pitchRangeRatio: number | null;
    pauses: PauseComparison;
    /** Local speed per reference segment relative to the attempt's own pace (above 1 = lingered). */
    segmentSpeed: number[];
    /** RMS of ln(segmentSpeed); 0 = identical rhythm. */
    rhythmDeviation: number;
    /** Attempt duration divided by reference duration (silence trimmed). */
    speedRatio: number;
    refDuration: number;
    attDuration: number;
    /** Relative semitone contours on the reference timeline (NaN = unvoiced). */
    refPitch: Float32Array;
    attPitch: Float32Array;
}

const MIN_PITCH_FRAMES = 8;

function median(values: number[]): number {
    const s = [...values].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
}

export function compareUtterances(refRaw: Float32Array, attRaw: Float32Array): RawComparison {
    const ref = trimSilence(refRaw);
    const att = trimSilence(attRaw);
    const refDuration = ref.length / SAMPLE_RATE;
    const attDuration = att.length / SAMPLE_RATE;
    if (refDuration < MIN_SECONDS || attDuration < MIN_SECONDS) throw new Error('TOO_SHORT');
    if (refDuration > MAX_SECONDS || attDuration > MAX_SECONDS) throw new Error('TOO_LONG');

    const fr = buildFeatures(ref);
    const fa = buildFeatures(att);
    const path = dtw(fr, fa);

    const bins = Math.min(fr.length, Math.max(4, Math.min(40, Math.round(fr.length / 10))));
    const sums = new Float64Array(bins);
    const counts = new Uint32Array(bins);
    let total = 0;
    for (const [i, j] of path) {
        const d = localDistance(fr[i], fa[j]);
        const bin = Math.min(bins - 1, Math.floor((i * bins) / fr.length));
        sums[bin] += d;
        counts[bin]++;
        total += d;
    }
    const segmentDistances = Array.from(sums, (s, b) => (counts[b] ? s / counts[b] : 0));

    const refPitchFull = toRelativeSemitones(yinPitch(ref, frameCount(ref.length)));
    const attPitchFull = toRelativeSemitones(yinPitch(att, frameCount(att.length)));

    const matches: number[][] = Array.from({ length: fr.length }, () => []);
    for (const [i, j] of path) if (!Number.isNaN(attPitchFull[j])) matches[i].push(attPitchFull[j]);
    const attPitch = Float32Array.from(matches, (m) => (m.length ? median(m) : NaN));

    let diff = 0;
    const refVoiced: number[] = [];
    const attVoiced: number[] = [];
    for (let i = 0; i < fr.length; i++) {
        if (!Number.isNaN(refPitchFull[i]) && !Number.isNaN(attPitch[i])) {
            diff += Math.abs(refPitchFull[i] - attPitch[i]);
            refVoiced.push(refPitchFull[i]);
            attVoiced.push(attPitch[i]);
        }
    }
    const paired = refVoiced.length;
    const refRange = pitchRange(refPitchFull);
    const attRange = pitchRange(attPitchFull);

    const pauses = comparePauses(findPauses(ref), findPauses(att), path, fr.length, fa.length);
    const segmentSpeed = localSpeed(path, fr.length, fa.length, bins);

    return {
        distance: total / path.length,
        segmentDistances,
        pitchDistance: paired >= MIN_PITCH_FRAMES ? diff / paired : null,
        pitchCorrelation: paired >= MIN_PITCH_FRAMES ? pearson(refVoiced, attVoiced) : null,
        pitchRangeRatio: refRange !== null && attRange !== null && refRange > 0.5 ? attRange / refRange : null,
        pauses,
        segmentSpeed,
        rhythmDeviation: rhythmDeviation(segmentSpeed),
        speedRatio: attDuration / refDuration,
        refDuration,
        attDuration,
        refPitch: refPitchFull,
        attPitch,
    };
}
