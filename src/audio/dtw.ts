export type Path = [number, number][];

export function localDistance(a: Float32Array, b: Float32Array): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
        const d = a[i] - b[i];
        s += d * d;
    }
    return Math.sqrt(s / a.length);
}

// Symmetric DTW with a Sakoe-Chiba band; returns the alignment path of (a index, b index).
export function dtw(a: Float32Array[], b: Float32Array[], bandRatio = 0.35): Path {
    const n = a.length;
    const m = b.length;
    const w = Math.max(Math.abs(n - m), Math.ceil(bandRatio * Math.max(n, m)));
    const stride = m + 1;
    const cost = new Float32Array((n + 1) * stride).fill(Infinity);
    const step = new Uint8Array((n + 1) * stride);
    cost[0] = 0;

    for (let i = 1; i <= n; i++) {
        const center = (i * m) / n;
        const jLo = Math.max(1, Math.floor(center - w));
        const jHi = Math.min(m, Math.ceil(center + w));
        for (let j = jLo; j <= jHi; j++) {
            const d = localDistance(a[i - 1], b[j - 1]);
            const diag = cost[(i - 1) * stride + j - 1] + 2 * d;
            const up = cost[(i - 1) * stride + j] + d;
            const left = cost[i * stride + j - 1] + d;
            let best = diag;
            let s = 0;
            if (up < best) {
                best = up;
                s = 1;
            }
            if (left < best) {
                best = left;
                s = 2;
            }
            cost[i * stride + j] = best;
            step[i * stride + j] = s;
        }
    }

    const path: Path = [];
    let i = n;
    let j = m;
    while (i > 0 && j > 0) {
        path.push([i - 1, j - 1]);
        const s = step[i * stride + j];
        if (s === 0) {
            i--;
            j--;
        } else if (s === 1) i--;
        else j--;
    }
    return path.reverse();
}
