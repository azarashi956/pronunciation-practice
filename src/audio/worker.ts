import { compareUtterances, type RawComparison } from './compare';

export interface WorkerRequest {
    id: number;
    ref: Float32Array;
    att: Float32Array;
}

export type WorkerResponse =
    | { id: number; ok: true; result: RawComparison }
    | { id: number; ok: false; error: string };

addEventListener('message', (e: MessageEvent<WorkerRequest>) => {
    const { id, ref, att } = e.data;
    let res: WorkerResponse;
    try {
        res = { id, ok: true, result: compareUtterances(ref, att) };
    } catch (err) {
        res = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    (self as unknown as Worker).postMessage(res);
});
