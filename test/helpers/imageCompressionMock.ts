// test/helpers/imageCompressionMock.ts
/**
 * Test-only mock for the browser image-compression pipeline.
 *
 * The Jest test environment is `node` (no jsdom), so `document`,
 * `HTMLCanvasElement`, and `createImageBitmap` are all absent. This helper
 * installs minimal fakes that let `compressImage()` exercise its real canvas
 * path so tests can assert on bitmap options, toBlob MIME, and fill/draw calls.
 *
 * Install with `installImageCompressionMock()` (typically in `beforeEach`);
 * remove with `uninstallImageCompressionMock()` (in `afterEach`).
 */

export interface ImageCompressionMockConfig {
    /** Decoded bitmap width. Default 100. */
    bitmapWidth?: number;
    /** Decoded bitmap height. Default 100. */
    bitmapHeight?: number;
    /**
     * Bytes the fake `canvas.toBlob` yields. Default `new Uint8Array([1])`
     * (1 byte — smaller than typical originals so the size guard passes).
     * Pass `null` to simulate a `toBlob` failure (null Blob).
     */
    toBlobBytes?: Uint8Array | null;
}

export interface CreateImageBitmapCall {
    file: File;
    options?: ImageBitmapOptions;
}

export interface ToBlobCall {
    mimeType: string;
    quality?: number;
}

export interface ImageCompressionMockHandle {
    readonly bitmap: { width: number; height: number; close: jest.Mock };
    /** Every call to `createImageBitmap`, capturing `(file, options)`. */
    readonly createImageBitmapCalls: CreateImageBitmapCall[];
    /** Every call to `canvas.toBlob`, capturing `(mimeType, quality)`. */
    readonly toBlobCalls: ToBlobCall[];
    /** Every call to `ctx.fillRect`. */
    readonly fillRectCalls: Array<{ x: number; y: number; w: number; h: number }>;
    /** Every call to `ctx.drawImage`. */
    readonly drawImageCalls: Array<unknown[]>;
    /** Replace the bytes the next `toBlob` call yields (or null to fail). */
    setToBlobBytes(bytes: Uint8Array | null): void;
}

interface FakeCanvas {
    width: number;
    height: number;
    getContext: jest.Mock;
    toBlob: jest.Mock;
}

interface SavedGlobals {
    createImageBitmap: typeof createImageBitmap | undefined;
    document: typeof document | undefined;
}

let saved: SavedGlobals | null = null;
let activeHandle: ImageCompressionMockHandle | null = null;

export function installImageCompressionMock(
    config: ImageCompressionMockConfig = {},
): ImageCompressionMockHandle {
    if (activeHandle) {
        throw new Error('installImageCompressionMock called twice without uninstall');
    }

    const bitmap = {
        width: config.bitmapWidth ?? 100,
        height: config.bitmapHeight ?? 100,
        close: jest.fn(),
    };
    let toBlobBytes: Uint8Array | null = config.toBlobBytes ?? new Uint8Array([1]);

    const createImageBitmapCalls: CreateImageBitmapCall[] = [];
    const toBlobCalls: ToBlobCall[] = [];
    const fillRectCalls: ImageCompressionMockHandle['fillRectCalls'] = [];
    const drawImageCalls: ImageCompressionMockHandle['drawImageCalls'] = [];

    const fakeCtx = {
        fillStyle: 'rgba(0,0,0,1)',
        fillRect: jest.fn((x: number, y: number, w: number, h: number) => {
            fillRectCalls.push({ x, y, w, h });
        }),
        drawImage: jest.fn((...args: unknown[]) => {
            drawImageCalls.push(args);
        }),
    };

    const fakeCanvas: FakeCanvas = {
        width: 0,
        height: 0,
        getContext: jest.fn(() => fakeCtx),
        toBlob: jest.fn((resolve: (b: Blob | null) => void, mimeType: string, quality?: number) => {
            toBlobCalls.push({ mimeType, quality });
            resolve(toBlobBytes === null ? null : new Blob([toBlobBytes.buffer as ArrayBuffer]));
        }),
    };

    saved = {
        createImageBitmap: globalThis.createImageBitmap,
        document: globalThis.document,
    };

    globalThis.createImageBitmap = jest.fn(async (file: File, options?: ImageBitmapOptions) => {
        createImageBitmapCalls.push({ file, options });
        return bitmap;
    }) as unknown as typeof createImageBitmap;

    globalThis.document = {
        createElement: jest.fn(() => fakeCanvas),
    } as unknown as typeof document;

    activeHandle = {
        bitmap,
        createImageBitmapCalls,
        toBlobCalls,
        fillRectCalls,
        drawImageCalls,
        setToBlobBytes: (bytes: Uint8Array | null) => {
            toBlobBytes = bytes;
        },
    };
    return activeHandle;
}

export function uninstallImageCompressionMock(): void {
    if (!saved) {
        return;
    }
    if (saved.createImageBitmap !== undefined) {
        globalThis.createImageBitmap = saved.createImageBitmap;
    } else {
        delete (globalThis as Record<string, unknown>).createImageBitmap;
    }
    if (saved.document !== undefined) {
        globalThis.document = saved.document;
    } else {
        delete (globalThis as Record<string, unknown>).document;
    }
    saved = null;
    activeHandle = null;
}
