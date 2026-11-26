import { SAMPLE_RATE } from './features';

export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): ArrayBuffer {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const text = (offset: number, s: string) => {
        for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
    };
    text(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
}

export function sliceSeconds(samples: Float32Array, start: number, end: number, padSeconds = 0.15): Float32Array {
    const from = Math.max(0, Math.round((start - padSeconds) * SAMPLE_RATE));
    const to = Math.min(samples.length, Math.round((end + padSeconds) * SAMPLE_RATE));
    return samples.slice(from, Math.max(from, to));
}
