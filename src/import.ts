export interface ImportEntry {
    name: string;
    kind: 'audio' | 'text';
    /** Required for text entries. */
    text?: string;
}

export interface ImportPair {
    audioName: string;
    text: string;
}

export interface ImportPlan {
    pairs: ImportPair[];
    /** Long recordings to cut into one item per timed cue. */
    cuts: ImportCut[];
    warnings: string[];
}

export interface Cue {
    start: number;
    end: number;
    text: string;
}

export interface ImportCut {
    audioName: string;
    group: string;
    cues: Cue[];
}

const AUDIO_EXT = /\.(m4a|mp3|wav|aac|ogg|oga|opus|flac|caf|webm|mp4)$/i;
const TEXT_EXT = /\.(txt|csv|srt|vtt)$/i;

export function classify(name: string, mime: string): 'audio' | 'text' | null {
    if (AUDIO_EXT.test(name) || mime.startsWith('audio/')) return 'audio';
    if (TEXT_EXT.test(name) || mime.startsWith('text/')) return 'text';
    return null;
}

export const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const clean = (s: string) => s.replace(/^\uFEFF/, '');
const lines = (s: string) => clean(s).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

function firstCsvColumn(line: string): string {
    if (line.startsWith('"')) {
        const end = line.indexOf('"', 1);
        return end > 0 ? line.slice(1, end) : line.slice(1);
    }
    return line.split(/[,\t]/)[0].trim();
}

/** One text per line (txt/csv) or per cue (srt/vtt), in file order. */
export function parseListText(fileName: string, content: string): string[] {
    if (/\.(srt|vtt)$/i.test(fileName)) {
        return clean(content)
            .split(/\r?\n\s*\r?\n/)
            .map((block) =>
                lines(block)
                    .filter((l) => !/^\d+$/.test(l) && !l.includes('-->') && !/^WEBVTT/i.test(l))
                    .join(' '),
            )
            .filter(Boolean);
    }
    if (/\.csv$/i.test(fileName)) return lines(content).map(firstCsvColumn).filter(Boolean);
    return lines(content);
}

const fallbackText = (audioName: string) => baseName(audioName).replace(/[_-]+/g, ' ').trim();

function parseTimestamp(token: string): number | null {
    const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d+))?$/.exec(token);
    if (!m) return null;
    return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4] ?? 0}`);
}

/** Timed cues from srt/vtt; empty for other formats or files without timestamps. */
export function parseCues(fileName: string, content: string): Cue[] {
    if (!/\.(srt|vtt)$/i.test(fileName)) return [];
    const cues: Cue[] = [];
    for (const block of clean(content).split(/\r?\n\s*\r?\n/)) {
        const rows = lines(block);
        const at = rows.findIndex((l) => l.includes('-->'));
        if (at < 0) continue;
        const [from, to] = rows[at].split('-->').map((t) => parseTimestamp(t.trim().split(/\s+/)[0]));
        const text = rows
            .slice(at + 1)
            .join(' ')
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (from === null || to === null || to <= from || !text) continue;
        cues.push({ start: from, end: to, text });
    }
    return cues;
}

export function planImport(entries: ImportEntry[]): ImportPlan {
    const warnings: string[] = [];
    const audios = entries.filter((e) => e.kind === 'audio').sort((a, b) => natural(a.name, b.name));
    const texts = entries.filter((e) => e.kind === 'text').sort((a, b) => natural(a.name, b.name));

    const textByBase = new Map(texts.map((t) => [baseName(t.name).toLowerCase(), t]));
    const used = new Set<string>();
    const pairs: ImportPair[] = [];
    const cuts: ImportCut[] = [];
    const unmatched: ImportEntry[] = [];

    // With one recording and one subtitle file, they belong together whatever their names.
    const subtitles = texts.filter((t) => /\.(srt|vtt)$/i.test(t.name));
    const loneSubtitle = audios.length === 1 && subtitles.length === 1 ? subtitles[0] : null;

    for (const a of audios) {
        const t = textByBase.get(baseName(a.name).toLowerCase()) ?? loneSubtitle ?? undefined;
        const cues = t ? parseCues(t.name, t.text ?? '') : [];
        if (t && cues.length > 0) {
            used.add(t.name);
            cuts.push({ audioName: a.name, group: baseName(a.name), cues });
        } else if (t) {
            used.add(t.name);
            pairs.push({ audioName: a.name, text: lines(t.text ?? '').join(' ') || fallbackText(a.name) });
        } else {
            unmatched.push(a);
        }
    }

    const lists = texts.filter((t) => !used.has(t.name));
    let listLines: string[] = [];
    if (unmatched.length > 0 && lists.length > 0) {
        if (lists.length > 1) warnings.push(`Several list files found; using only ${lists[0].name}`);
        listLines = parseListText(lists[0].name, lists[0].text ?? '');
        if (listLines.length !== unmatched.length) {
            warnings.push(`${lists[0].name} has ${listLines.length} line(s) but ${unmatched.length} recording(s) have no matching text`);
        }
    }

    unmatched.forEach((a, i) => {
        pairs.push({ audioName: a.name, text: listLines[i] ?? fallbackText(a.name) });
    });

    return { pairs, cuts, warnings };
}
