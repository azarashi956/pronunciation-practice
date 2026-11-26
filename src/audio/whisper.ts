import type { TranscribeRequest, TranscribeResponse } from './whisper.worker';

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>();
let progressListener: ((percent: number) => void) | null = null;

function getWorker(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<TranscribeResponse>) => {
        const m = e.data;
        if (m.type === 'progress') {
            progressListener?.(m.percent);
            return;
        }
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        if (m.type === 'result') p.resolve(m.text);
        else p.reject(new Error(m.error));
    });
    return worker;
}

/** Transcribes 16 kHz mono audio in the browser; the model downloads on first use. */
export function transcribe(audio: Float32Array, onProgress?: (percent: number) => void): Promise<string> {
    progressListener = onProgress ?? null;
    const id = nextId++;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const req: TranscribeRequest = { id, audio };
        getWorker().postMessage(req);
    });
}
