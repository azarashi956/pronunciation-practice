import { env, pipeline } from '@huggingface/transformers';

export interface TranscribeRequest {
    id: number;
    audio: Float32Array;
}

export type TranscribeResponse =
    | { type: 'progress'; percent: number }
    | { type: 'result'; id: number; text: string }
    | { type: 'error'; id: number; error: string };

const MODEL = 'onnx-community/whisper-base.en';

env.allowLocalModels = false;

type Recognizer = (audio: Float32Array, options: { chunk_length_s: number; stride_length_s: number }) => Promise<{ text: string }>;

const post = (m: TranscribeResponse) => (self as unknown as Worker).postMessage(m);
const files = new Map<string, { loaded: number; total: number }>();
let recognizer: Promise<Recognizer> | null = null;

function load(): Promise<Recognizer> {
    recognizer ??= (
        pipeline('automatic-speech-recognition', MODEL, {
            dtype: 'q8',
            progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
                if (p.status !== 'progress' || !p.file || !p.total) return;
                files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
                let loaded = 0;
                let total = 0;
                for (const f of files.values()) {
                    loaded += f.loaded;
                    total += f.total;
                }
                post({ type: 'progress', percent: Math.round((loaded / total) * 100) });
            },
        }) as unknown as Promise<Recognizer>
    ).catch((err) => {
        recognizer = null;
        throw err;
    });
    return recognizer;
}

addEventListener('message', async (e: MessageEvent<TranscribeRequest>) => {
    const { id, audio } = e.data;
    try {
        const run = await load();
        const out = await run(audio, { chunk_length_s: 30, stride_length_s: 5 });
        post({ type: 'result', id, text: out.text });
    } catch (err) {
        post({ type: 'error', id, error: err instanceof Error ? err.message : String(err) });
    }
});
