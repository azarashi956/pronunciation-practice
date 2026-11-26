export class Recorder {
    private stream: MediaStream | null = null;
    private recorder: MediaRecorder | null = null;
    private chunks: Blob[] = [];

    async start(): Promise<void> {
        this.stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
        });
        this.chunks = [];
        this.recorder = new MediaRecorder(this.stream);
        this.recorder.ondataavailable = (e) => {
            if (e.data.size > 0) this.chunks.push(e.data);
        };
        this.recorder.start();
    }

    stop(): Promise<Blob> {
        const recorder = this.recorder;
        if (!recorder) return Promise.reject(new Error('Not recording'));
        return new Promise((resolve) => {
            recorder.onstop = () => {
                this.stream?.getTracks().forEach((t) => t.stop());
                resolve(new Blob(this.chunks, { type: recorder.mimeType }));
            };
            recorder.stop();
        });
    }
}
