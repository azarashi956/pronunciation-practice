export type WordStatus = 'ok' | 'wrong' | 'missing';

export interface WordResult {
    /** The word as written in the script, with its punctuation. */
    word: string;
    status: WordStatus;
    /** What the recognizer heard instead, when status is 'wrong'. */
    heard?: string;
}

export function normalizeWord(w: string): string {
    return w
        .toLowerCase()
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[^a-z0-9']/g, '')
        .replace(/^'+|'+$/g, '');
}

const split = (text: string) => text.split(/\s+/).filter(Boolean);

/** Aligns the script against what was heard, word by word (edit-distance alignment). */
export function checkWords(script: string, heardText: string): WordResult[] {
    const display = split(script);
    const norm = display.map(normalizeWord);
    const heard = split(heardText).map(normalizeWord).filter(Boolean);
    const targets = norm.flatMap((w, i) => (w ? [i] : []));

    const n = targets.length;
    const m = heard.length;
    const cost: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = 1; i <= n; i++) cost[i][0] = i;
    for (let j = 1; j <= m; j++) cost[0][j] = j;
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            const same = norm[targets[i - 1]] === heard[j - 1] ? 0 : 1;
            cost[i][j] = Math.min(cost[i - 1][j - 1] + same, cost[i - 1][j] + 1, cost[i][j - 1] + 1);
        }
    }

    const results: WordResult[] = display.map((word) => ({ word, status: 'ok' }));
    let i = n;
    let j = m;
    while (i > 0) {
        const t = targets[i - 1];
        const same = j > 0 && norm[t] === heard[j - 1] ? 0 : 1;
        if (j > 0 && cost[i][j] === cost[i - 1][j - 1] + same) {
            if (same) results[t] = { word: display[t], status: 'wrong', heard: heard[j - 1] };
            i--;
            j--;
        } else if (cost[i][j] === cost[i - 1][j] + 1) {
            results[t] = { word: display[t], status: 'missing' };
            i--;
        } else {
            j--;
        }
    }
    return results;
}
