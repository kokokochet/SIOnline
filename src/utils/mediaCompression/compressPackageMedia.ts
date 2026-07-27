import JSZip from 'jszip';
import { ContentItem, Package } from '../../model/siquester/package';
import { CompressibleMediaType } from './compressionTypes';

/** Compressed file staged for the atomic apply. */
export interface StagedMediaFile {
    type: CompressibleMediaType;
    oldValue: string;
    /** Final file name after collision resolution (=== oldValue when unchanged). */
    newValue: string;
    data: Uint8Array;
}

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

/** Walks every question's params across all rounds/themes (the package media tree). */
function forEachQuestionParams(pack: Package, fn: (params: unknown) => void): void {
    for (const round of pack.rounds) {
        for (const theme of round.themes) {
            for (const question of theme.questions) {
                fn(question.params);
            }
        }
    }
}

/** Finds a zip entry by referenced name, falling back to its URI-encoded variant. */
export function resolveZipEntry(zip: JSZip, folder: string, name: string): JSZip.JSZipObject | null {
    return zip.file(`${folder}/${name}`) ?? zip.file(`${folder}/${encodeURIComponent(name)}`);
}

/**
 * Resolves a collision-free `newValue` for a single staged file. If the target
 * name already exists in the zip (and isn't the file being replaced), appends
 * `-1`, `-2`, …
 */
export function resolveUniqueMediaValue(
    zip: JSZip,
    type: CompressibleMediaType,
    oldValue: string,
    newValue: string,
): string {
    if (newValue === oldValue) {
        return oldValue;
    }

    const folder = getMediaFolderName(type);
    const dotIndex = newValue.lastIndexOf('.');
    const base = dotIndex > 0 ? newValue.slice(0, dotIndex) : newValue;
    const ext = dotIndex > 0 ? newValue.slice(dotIndex) : '';

    const occupied = (name: string): boolean => {
        if (name === oldValue) {
            return false;
        }

        const entry = zip.file(`${folder}/${name}`) ?? zip.file(`${folder}/${encodeURIComponent(name)}`);

        return Boolean(entry);
    };

    let candidate = newValue;
    let suffix = 0;

    while (occupied(candidate)) {
        suffix += 1;
        candidate = `${base}-${suffix}${ext}`;
    }

    return candidate;
}

/** Rewrites content items in the rename map; walks full params tree (incl. nested answerOptions). Mutates `pack` (Immer). */
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

    forEachQuestionParams(pack, visit);
}

/**
 * Applies a single staged file to the zip with all-or-nothing atomicity. JSZip
 * isn't Immer-draftable (file()/remove() mutate zip.files even on throw), so
 * this snapshots `files` and restores on any error.
 *
 * @returns Rename map `${type}:${oldValue}` → `newValue` (empty when unchanged).
 * @throws Rethrows after restoring the snapshot (caller's Immer draft discarded).
 */
export function applyStagedFileToZip(zip: JSZip, file: StagedMediaFile): Map<string, string> {
    const snapshot = { ...zip.files };

    try {
        const folder = getMediaFolderName(file.type);
        const writeTarget = `${folder}/${file.newValue}`;

        zip.file(writeTarget, file.data);

        // Remove the superseded original (raw + URI-encoded variant), never the just-written target.
        for (const oldPath of [`${folder}/${file.oldValue}`, `${folder}/${encodeURIComponent(file.oldValue)}`]) {
            if (oldPath !== writeTarget) {
                zip.remove(oldPath);
            }
        }

        const renames = new Map<string, string>();

        if (file.newValue !== file.oldValue) {
            renames.set(`${file.type}:${file.oldValue}`, file.newValue);
        }

        return renames;
    } catch (err) {
        // All-or-nothing: leave the zip byte-identical to its pre-call state.
        (zip as unknown as { files: typeof snapshot }).files = snapshot;
        throw err;
    }
}
