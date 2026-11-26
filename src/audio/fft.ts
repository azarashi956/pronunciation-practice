export function makeFft(n: number): (re: Float64Array, im: Float64Array) => void {
    const bits = Math.round(Math.log2(n));
    if (1 << bits !== n) throw new Error('FFT size must be a power of two');

    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
        cos[i] = Math.cos((2 * Math.PI * i) / n);
        sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
        let r = 0;
        for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
        rev[i] = r;
    }

    return (re, im) => {
        for (let i = 0; i < n; i++) {
            const j = rev[i];
            if (j > i) {
                [re[i], re[j]] = [re[j], re[i]];
                [im[i], im[j]] = [im[j], im[i]];
            }
        }
        for (let size = 2; size <= n; size *= 2) {
            const half = size / 2;
            const step = n / size;
            for (let i = 0; i < n; i += size) {
                for (let j = i, k = 0; j < i + half; j++, k += step) {
                    const l = j + half;
                    const tre = re[l] * cos[k] + im[l] * sin[k];
                    const tim = -re[l] * sin[k] + im[l] * cos[k];
                    re[l] = re[j] - tre;
                    im[l] = im[j] - tim;
                    re[j] += tre;
                    im[j] += tim;
                }
            }
        }
    };
}
