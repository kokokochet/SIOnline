import JSZip from 'jszip';
import { ContentItem, Package } from '../../model/siquester/package';
import { CompressibleMediaType } from './compressionTypes';

/** Compressed file staged for the all-or-nothing bulk apply. */
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

/** Collects media-folder file names keyed `${type}:${name}` (raw + URI-decoded, to match MediaItem's lookup). */
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
 * Builds a collision-safe rename plan keyed `${type}:${oldValue}`. Pass 1
 * reserves identity renames; pass 2 appends `-1`, `-2`, … while a candidate
 * exists in the zip or this run. Existing names always block — freed names are
 * NOT reused (keeps apply safe). Precondition: every staged `oldValue` is in
 * `existingNames` (staged via `resolveZipEntry` against the same zip).
 */
export function planRenames(staged: StagedMediaFile[], existingNames: Set<string>): Map<string, string> {
    const renames = new Map<string, string>();
    const taken = new Set<string>();

    const isTaken = (type: CompressibleMediaType, name: string): boolean =>
        taken.has(`${type}:${name}`) || existingNames.has(`${type}:${name}`);

    for (const file of staged) {
        if (file.newValue === file.oldValue) {
            taken.add(`${file.type}:${file.oldValue}`);
            renames.set(`${file.type}:${file.oldValue}`, file.oldValue);
        }
    }

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
 * Applies staged files to a zip with all-or-nothing atomicity. JSZip isn't
 * Immer-draftable (file()/remove() mutate zip.files even on throw), so this
 * snapshots `files` and restores on any error (shallow clone suffices — JSZip
 * replaces, never mutates, ZipObject entries).
 *
 * @returns Rename map `${type}:${oldValue}` → `newValue` (identity excluded).
 * @throws Rethrows after restoring the snapshot (caller's Immer draft discarded).
 */
export function applyStagedFilesToZip(
    zip: JSZip,
    files: StagedMediaFile[],
): Map<string, string> {
    const snapshot = { ...zip.files };

    try {
        for (const file of files) {
            const folder = getMediaFolderName(file.type);
            zip.file(`${folder}/${file.newValue}`, file.data);
        }

        // Then remove the superseded originals (raw + URI-encoded variant),
        // never the just-written target. Identity renames also remove the
        // URI-encoded original so no duplicate is left behind.
        const renames = new Map<string, string>();

        for (const file of files) {
            const folder = getMediaFolderName(file.type);

            const writeTarget = `${folder}/${file.newValue}`;

            for (const oldPath of [`${folder}/${file.oldValue}`, `${folder}/${encodeURIComponent(file.oldValue)}`]) {
                if (oldPath !== writeTarget) {
                    zip.remove(oldPath);
                }
            }

            if (file.newValue !== file.oldValue) {
                renames.set(`${file.type}:${file.oldValue}`, file.newValue);
            }
        }

        return renames;
    } catch (err) {
        // All-or-nothing: leave the zip byte-identical to its pre-call state.
        (zip as unknown as { files: typeof snapshot }).files = snapshot;
        throw err;
    }
}

