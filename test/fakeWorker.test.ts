import {
    FakeWorker,
    getLastVideoWorker,
    getLastAudioWorker,
    resetFakeWorkerRegistry,
} from './helpers/fakeWorker';

describe('FakeWorker', () => {
    afterEach(() => {
        resetFakeWorkerRegistry();
    });

    describe('postMessage recording', () => {
        test('records each posted message and its transfer list', () => {
            const w = new FakeWorker();
            const buf = new ArrayBuffer(8);
            w.postMessage({ type: 'request', data: 1 });
            w.postMessage({ type: 'request', data: 2 }, [buf]);

            expect(w.postedMessages).toHaveLength(2);
            expect(w.postedMessages[0]).toEqual({ message: { type: 'request', data: 1 }, transfer: [] });
            expect(w.postedMessages[1].message).toEqual({ type: 'request', data: 2 });
            expect(w.postedMessages[1].transfer).toEqual([buf]);
        });

        test('lastMessage returns the most recently posted message', () => {
            const w = new FakeWorker();
            w.postMessage({ hello: 'first' });
            w.postMessage({ hello: 'second' });
            expect(w.lastMessage).toEqual({ hello: 'second' });
        });

        test('lastMessage is undefined when nothing has been posted', () => {
            expect(new FakeWorker().lastMessage).toBeUndefined();
        });
    });

    describe('event emission', () => {
        test('emitMessage fires onmessage with the given data', () => {
            const w = new FakeWorker();
            const received: unknown[] = [];
            w.onmessage = (e) => { received.push(e.data); };
            w.emitMessage({ type: 'done', data: new ArrayBuffer(4) });
            expect(received).toHaveLength(1);
            expect((received[0] as { type: string }).type).toBe('done');
        });

        test('emitMessage is a no-op when onmessage is null', () => {
            const w = new FakeWorker();
            expect(() => w.emitMessage({ type: 'done' })).not.toThrow();
        });

        test('emitError fires onerror with a synthetic ErrorEvent carrying the message', () => {
            const w = new FakeWorker();
            let captured: { message: string; preventDefaultCalled: boolean } | null = null;
            w.onerror = (e) => {
                captured = { message: e.message, preventDefaultCalled: false };
                e.preventDefault();
                captured!.preventDefaultCalled = true;
            };
            w.emitError('boom');
            expect(captured).not.toBeNull();
            expect(captured!.message).toBe('boom');
            expect(captured!.preventDefaultCalled).toBe(true);
        });

        test('emitError defaults the message to "Worker error"', () => {
            const w = new FakeWorker();
            let msg = '';
            w.onerror = (e) => { msg = e.message; };
            w.emitError();
            expect(msg).toBe('Worker error');
        });
    });

    describe('terminate', () => {
        test('marks the worker terminated and is idempotent', () => {
            const w = new FakeWorker();
            expect(w.isTerminated).toBe(false);
            w.terminate();
            expect(w.isTerminated).toBe(true);
            // Second call must not throw.
            expect(() => w.terminate()).not.toThrow();
        });

        test('postMessage after terminate records the call (host is responsible for ordering)', () => {
            // The real Worker does not throw on postMessage after terminate; the host's
            // finally block calls terminate AFTER the promise resolves, so the fake
            // mirrors the browser: it stays recording.
            const w = new FakeWorker();
            w.terminate();
            w.postMessage({ x: 1 });
            expect(w.postedMessages).toHaveLength(1);
        });
    });

    describe('registry', () => {
        test('getLastVideoWorker returns the most recently created video worker', () => {
            resetFakeWorkerRegistry();
            const factory = require('./workerFactoryMock');
            const a = factory.createVideoWorker();
            const b = factory.createVideoWorker();
            expect(getLastVideoWorker()).toBe(b);
            expect(getLastVideoWorker()).not.toBe(a);
        });

        test('getLastAudioWorker returns the most recently created audio worker', () => {
            resetFakeWorkerRegistry();
            const factory = require('./workerFactoryMock');
            factory.createAudioWorker();
            const last = factory.createAudioWorker();
            expect(getLastAudioWorker()).toBe(last);
        });

        test('getLastVideoWorker is undefined after reset', () => {
            resetFakeWorkerRegistry();
            expect(getLastVideoWorker()).toBeUndefined();
        });

        test('resetFakeWorkerRegistry clears both registries', () => {
            const factory = require('./workerFactoryMock');
            factory.createVideoWorker();
            factory.createAudioWorker();
            resetFakeWorkerRegistry();
            expect(getLastVideoWorker()).toBeUndefined();
            expect(getLastAudioWorker()).toBeUndefined();
        });
    });
});
