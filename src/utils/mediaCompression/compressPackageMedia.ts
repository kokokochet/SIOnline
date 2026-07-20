import JSZip from 'jszip';
import { ContentItem, Package } from '../../model/siquester/package';
import { CompressibleMediaType } from './compressionTypes';

/** A media file referenced by at least one question in the package. */
export interface MediaReference {
    type: CompressibleMediaType;
    /** Referenced file name (as stored in the content item value). */
    value: string;
}

/** A compressed file staged for the all-or-nothing bulk apply. */
export interface StagedMediaFile {
    type: CompressibleMediaType;
    /** Referenced file name before compression. */
    oldValue: string;
    /** Final file name after collision resolution (=== oldValue when unchanged). */
    newValue: string;
    /** Compressed bytes. */
    data: Uint8Array;
}

const COMPRESSIBLE_TYPES: ReadonlySet<string> = new Set(['image', 'audio', 'video']);

/** Maps a compressible media type to its package zip folder. */
export function getMediaFolderName(type: CompressibleMediaType): string {
    switch (type) {
        case 'image':
            return 'Images';
        case 'audio':
            return 'Audio';
        case 'video':
            return 'Video';
        default:
            throw new Error(`Unknown compressible media type: ${type}`);
    }
}

function isCompressibleReference(item: unknown): item is ContentItem & { type: CompressibleMediaType } {
    if (!item || typeof item !== 'object') {
        return false;
    }

    const candidate = item as Partial<ContentItem>;

    return candidate.isRef === true
        && typeof candidate.type === 'string'
        && COMPRESSIBLE_TYPES.has(candidate.type)
        && typeof candidate.value === 'string'
        && candidate.value.length > 0
        // Pathological names: never touch entries that could escape the media folder.
        && !candidate.value.includes('/')
        && !candidate.value.includes('\\');
}

function collectFromValue(value: unknown, add: (ref: MediaReference) => void): void {
    if (!value || typeof value !== 'object') {
        return;
    }

    if (Array.isArray(value)) {
        value.forEach(item => collectFromValue(item, add));
        return;
    }

    if (isCompressibleReference(value)) {
        add({ type: value.type, value: value.value });
        return;
    }

    Object.values(value).forEach(item => collectFromValue(item, add));
}

/**
 * Collects all media files referenced by at least one question in the package,
 * deduplicated by `${type}:${value}`. Orphan zip entries (not referenced) and
 * HTML/text/external-URL content are excluded by design.
 */
export function collectMediaReferences(pack: Package): MediaReference[] {
    const seen = new Set<string>();
    const refs: MediaReference[] = [];

    const add = (ref: MediaReference) => {
        const key = `${ref.type}:${ref.value}`;

        if (!seen.has(key)) {
            seen.add(key);
            refs.push(ref);
        }
    };

    for (const round of pack.rounds) {
        for (const theme of round.themes) {
            for (const question of theme.questions) {
                collectFromValue(question.params, add);
            }
        }
    }

    return refs;
}

/** Distinct referenced file counts per media type (drives the dialog confirm screen). */
export function selectReferencedMediaCounts(pack: Package | undefined): Record<CompressibleMediaType, number> {
    const counts: Record<CompressibleMediaType, number> = { image: 0, audio: 0, video: 0 };

    if (!pack) {
        return counts;
    }

    for (const ref of collectMediaReferences(pack)) {
        counts[ref.type] += 1;
    }

    return counts;
}

/** Finds a zip entry by referenced name, falling back to its URI-encoded variant. */
export function resolveZipEntry(zip: JSZip, folder: string, name: string): JSZip.JSZipObject | null {
    return zip.file(`${folder}/${name}`) ?? zip.file(`${folder}/${encodeURIComponent(name)}`);
}

/**
 * Collects all file names present in the media folders of the zip, keyed
 * `${type}:${name}`. Both raw and URI-decoded variants are included so rename
 * collision checks match MediaItem's raw-then-encoded lookup semantics.
 */
export function collectExistingMediaNames(zip: JSZip): Set<string> {
    const folderTypes: Record<string, CompressibleMediaType> = {
        Images: 'image',
        Audio: 'audio',
        Video: 'video',
    };
    const names = new Set<string>();

    zip.forEach((relativePath, entry) => {
        if (entry.dir) {
            return;
        }

        const [folder, ...rest] = relativePath.split('/');
        const type = folderTypes[folder];

        if (!type || rest.length !== 1) {
            return;
        }

        names.add(`${type}:${rest[0]}`);

        try {
            names.add(`${type}:${decodeURIComponent(rest[0])}`);
        } catch {
            // Keep the raw variant only.
        }
    });

    return names;
}

/**
 * Builds a collision-safe rename plan for staged files, keyed `${type}:${oldValue}`.
 *
 * Pass 1 reserves identity renames (a file compressed in place keeps its name,
 * so no other file may take it). Pass 2 assigns rename candidates, appending
 * `-1`, `-2`, … before the extension while the candidate exists in the zip or
 * is already assigned in this run. Existing names always block — names freed
 * by renames are NOT reused as targets, which keeps the apply safe.
 *
 * Precondition: every staged `oldValue` must be present in `existingNames`
 * (guaranteed when files are staged via `resolveZipEntry` against the same zip).
 */
export function planRenames(staged: StagedMediaFile[], existingNames: Set<string>): Map<string, string> {
    const renames = new Map<string, string>();
    const taken = new Set<string>();

    const isTaken = (type: CompressibleMediaType, name: string): boolean =>
        taken.has(`${type}:${name}`) || existingNames.has(`${type}:${name}`);

    // Pass 1: identity renames keep their names.
    for (const file of staged) {
        if (file.newValue === file.oldValue) {
            taken.add(`${file.type}:${file.oldValue}`);
            renames.set(`${file.type}:${file.oldValue}`, file.oldValue);
        }
    }

    // Pass 2: renames get collision-free candidates.
    for (const file of staged) {
        if (file.newValue === file.oldValue) {
            continue;
        }

        const dotIndex = file.newValue.lastIndexOf('.');
        const base = dotIndex > 0 ? file.newValue.slice(0, dotIndex) : file.newValue;
        const ext = dotIndex > 0 ? file.newValue.slice(dotIndex) : '';
        let candidate = file.newValue;
        let suffix = 0;

        while (isTaken(file.type, candidate)) {
            suffix += 1;
            candidate = `${base}-${suffix}${ext}`;
        }

        taken.add(`${file.type}:${candidate}`);
        renames.set(`${file.type}:${file.oldValue}`, candidate);
    }

    return renames;
}

/**
 * Rewrites the value of every content item whose `${type}:${value}` key is in
 * the rename map. Walks the full question params tree (including nested
 * answerOptions). Mutates `pack` — intended for use inside an Immer reducer.
 */
export function renameMediaReferences(pack: Package, renames: Map<string, string>): void {
    const visit = (value: unknown): void => {
        if (!value || typeof value !== 'object') {
            return;
        }

        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }

        const item = value as Partial<ContentItem>;

        if (typeof item.type === 'string' && typeof item.value === 'string' && 'isRef' in item) {
            if (item.isRef === true) {
                const newName = renames.get(`${item.type}:${item.value}`);

                if (newName !== undefined) {
                    (item as ContentItem).value = newName;
                }
            }

            return;
        }

        Object.values(value).forEach(visit);
    };

    for (const round of pack.rounds) {
        for (const theme of round.themes) {
            for (const question of theme.questions) {
                visit(question.params);
            }
        }
    }
}

/**
 * Returns the `${type}:${value}` keys of referenced media files missing from
 * the zip. An empty result means the package media is intact. Used by tests to
 * assert package integrity after a bulk apply.
 */
export function validateMediaReferences(pack: Package, zip: JSZip): string[] {
    const missing: string[] = [];

    for (const ref of collectMediaReferences(pack)) {
        if (!resolveZipEntry(zip, getMediaFolderName(ref.type), ref.value)) {
            missing.push(`${ref.type}:${ref.value}`);
        }
    }

    return missing;
}
