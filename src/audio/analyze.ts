import { SAMPLE_RATE } from './features';
import type { RawComparison } from './compare';
import type { WorkerRequest, WorkerResponse } from './worker';

export async function decodeTo16kMono(data: ArrayBuffer): Promise<Float32Array> {
    // An offline context decodes straight to its own sample rate, so this also resamples.
    const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
    const buffer = await ctx.decodeAudioData(data.slice(0));
    const mono = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
        const ch = buffer.getChannelData(c);
        for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / buffer.numberOfChannels;
    }
    return mono;
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (r: RawComparison) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<WorkerResponse>) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.ok) p.resolve(e.data.result);
        else p.reject(new Error(e.data.error));
    });
    return worker;
}

export function compareInWorker(ref: Float32Array, att: Float32Array): Promise<RawComparison> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const req: WorkerRequest = { id, ref, att };
        getWorker().postMessage(req);
    });
}
