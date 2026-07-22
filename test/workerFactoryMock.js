function makeCapturingWorker() {
    const worker = {
        onmessage: null,
        onerror: null,
        postMessage: jest.fn(),
        terminate: jest.fn(),
    };
    // Stash the most-recently-created worker so tests can inspect / fire events.
    makeCapturingWorker._last = worker;
    return worker;
}

module.exports = {
    createVideoWorker: () => ({
        onmessage: null,
        onerror: null,
        postMessage: () => {},
        terminate: () => {},
    }),
    createAudioWorker: makeCapturingWorker,
};
