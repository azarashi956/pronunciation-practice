import type { RawComparison } from './audio/compare';

export interface Leniency {
    id: string;
    label: string;
    /** Feature distance at which the spectral score is 50. */
    d0: number;
}

// Starting values; tune against real adult/child recordings.
export const LENIENCIES: Leniency[] = [
    { id: 'strict', label: 'Strict', d0: 0.85 },
    { id: 'normal', label: 'Normal', d0: 1.05 },
    { id: 'easy', label: 'Easy', d0: 1.3 },
];

const PITCH_D0 = 4;
const RHYTHM_D0 = 0.5;

const toScore = (d: number, d0: number) => 100 / (1 + (d / d0) ** 2);

export type SegmentPace = 'slow' | 'fast' | 'ok';

export interface Evaluation {
    score: number;
    stars: number;
    /** How close the sounds are to the example. */
    soundScore: number;
    /** Pitch movement; null when there was too little voiced speech to judge. */
    intonationScore: number | null;
    /** Timing pattern and pauses. */
    rhythmScore: number;
    segmentScores: number[];
    segmentPace: SegmentPace[];
    speed: 'slow' | 'fast' | 'ok';
    notes: string[];
}

export function starsFor(score: number): number {
    return score >= 80 ? 3 : score >= 60 ? 2 : score >= 40 ? 1 : 0;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function evaluate(raw: RawComparison, leniency: Leniency): Evaluation {
    const soundScore = toScore(raw.distance, leniency.d0);

    let intonationScore: number | null = null;
    if (raw.pitchDistance !== null) {
        const shape = toScore(raw.pitchDistance, PITCH_D0);
        intonationScore =
            raw.pitchCorrelation === null ? shape : shape * 0.6 + Math.max(0, raw.pitchCorrelation) * 100 * 0.4;
    }

    const p = raw.pauses;
    const pauseScore = p.refCount + p.extra === 0 ? 100 : 100 * (1 - (p.missed + p.extra) / (p.refCount + p.extra));
    const rhythmScore = toScore(raw.rhythmDeviation, RHYTHM_D0) * 0.7 + pauseScore * 0.3;

    const score = Math.round(
        intonationScore === null
            ? soundScore * 0.8 + rhythmScore * 0.2
            : soundScore * 0.6 + intonationScore * 0.25 + rhythmScore * 0.15,
    );

    const speed = raw.speedRatio > 1.4 ? 'slow' : raw.speedRatio < 0.7 ? 'fast' : 'ok';
    const segmentPace = raw.segmentSpeed.map((s): SegmentPace => (s > 1.6 ? 'slow' : s < 0.6 ? 'fast' : 'ok'));

    const notes: string[] = [];
    notes.push({ ok: 'Overall pace is good.', slow: 'Overall you are a little slow. Try a bit faster.', fast: 'Overall you are a little fast. Try a bit slower.' }[speed]);
    if (raw.pitchRangeRatio !== null && raw.pitchRangeRatio < 0.6) notes.push('Your voice is flatter than the example. Use more pitch movement.');
    if (raw.pitchRangeRatio !== null && raw.pitchRangeRatio > 1.6) notes.push('Your pitch moves more than the example. Try to be a little calmer.');
    if (p.missed > 0) notes.push(`You skipped ${plural(p.missed, 'pause')} that the example makes.`);
    if (p.extra > 0) notes.push(`You added ${plural(p.extra, 'extra pause')}.`);
    if (segmentPace.includes('slow')) notes.push('Orange spots: you lingered longer than the example.');
    if (segmentPace.includes('fast')) notes.push('Blue spots: you rushed through these parts.');

    return {
        score,
        stars: starsFor(score),
        soundScore: Math.round(soundScore),
        intonationScore: intonationScore === null ? null : Math.round(intonationScore),
        rhythmScore: Math.round(rhythmScore),
        segmentScores: raw.segmentDistances.map((d) => Math.round(toScore(d, leniency.d0))),
        segmentPace,
        speed,
        notes,
    };
}
