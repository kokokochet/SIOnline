module.exports = {
    createVideoWorker: () => ({
        onmessage: null,
        onerror: null,
        postMessage: () => {},
        terminate: () => {},
    }),
    createAudioWorker: () => ({
        onmessage: null,
        onerror: null,
        postMessage: () => {},
        terminate: () => {},
    }),
};
