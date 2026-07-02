var BgUtils = (function (exports) {
    'use strict';

    const GOOG_BASE_URL = 'https://jnn-pa.googleapis.com';
    const YT_BASE_URL = 'https://www.youtube.com';
    const GOOG_API_KEY = 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw';
    const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36(KHTML, like Gecko)';

    const base64urlCharRegex = /[-_.]/g;
    const base64urlToBase64Map = {
        '-': '+',
        _: '/',
        '.': '='
    };
    class DeferredPromise {
        constructor() {
            this.promise = new Promise((resolve, reject) => {
                this.resolve = resolve;
                this.reject = reject;
            });
        }
    }
    class BGError extends TypeError {
        constructor(code, message, info) {
            super(message);
            this.name = 'BGError';
            this.code = code;
            if (info)
                this.info = info;
        }
    }
    function base64ToU8(base64) {
        let base64Mod;
        if (base64urlCharRegex.test(base64)) {
            base64Mod = base64.replace(base64urlCharRegex, function (match) {
                return base64urlToBase64Map[match];
            });
        }
        else {
            base64Mod = base64;
        }
        base64Mod = atob(base64Mod);
        return new Uint8Array([...base64Mod].map((char) => char.charCodeAt(0)));
    }
    function u8ToBase64(u8, base64url = false) {
        const result = btoa(String.fromCharCode(...u8));
        if (base64url) {
            return result
                .replace(/\+/g, '-')
                .replace(/\//g, '_');
        }
        return result;
    }
    function isBrowser() {
        const isBrowser = typeof window !== 'undefined'
            && typeof window.document !== 'undefined'
            && typeof window.document.createElement !== 'undefined'
            && typeof window.HTMLElement !== 'undefined'
            && typeof window.navigator !== 'undefined'
            && typeof window.getComputedStyle === 'function'
            && typeof window.requestAnimationFrame === 'function'
            && typeof window.matchMedia === 'function';
        const hasValidWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')?.get?.toString().includes('[native code]') ?? false;
        return isBrowser && hasValidWindow;
    }
    function getHeaders() {
        const headers = {
            'content-type': 'application/json+protobuf',
            'x-goog-api-key': GOOG_API_KEY,
            'x-user-agent': 'grpc-web-javascript/0.1'
        };
        if (!isBrowser()) {
            headers['user-agent'] = USER_AGENT;
        }
        return headers;
    }
    function buildURL(endpointName, useYouTubeAPI) {
        return `${useYouTubeAPI ? YT_BASE_URL : GOOG_BASE_URL}/${useYouTubeAPI ? 'api/jnn/v1' : '$rpc/google.internal.waa.v1.Waa'}/${endpointName}`;
    }

    /**
     * Creates a challenge.
     * @param bgConfig - The config.
     * @param interpreterHash - The ID of the challenge script. If provided, the server will assume that
     * the client already has the script and will not return it.
     * @returns The challenge data.
     */
    async function create(bgConfig, interpreterHash) {
        const requestKey = bgConfig.requestKey;
        if (!bgConfig.fetch)
            throw new BGError('BAD_CONFIG', 'No fetch function provided');
        const payload = [requestKey];
        if (interpreterHash)
            payload.push(interpreterHash);
        const response = await bgConfig.fetch(buildURL('Create', bgConfig.useYouTubeAPI), {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });
        if (!response.ok)
            throw new BGError('REQUEST_FAILED', 'Failed to fetch challenge', { status: response.status });
        const rawData = await response.json();
        return parseChallengeData(rawData);
    }
    /**
     * Parses the challenge data from the provided response data.
     */
    function parseChallengeData(rawData) {
        let challengeData = [];
        if (rawData.length > 1 && typeof rawData[1] === 'string') {
            const descrambled = descramble(rawData[1]);
            challengeData = JSON.parse(descrambled || '[]');
        }
        else if (rawData.length && typeof rawData[0] === 'object') {
            challengeData = rawData[0];
        }
        const [messageId, wrappedScript, wrappedUrl, interpreterHash, program, globalName, , clientExperimentsStateBlob] = challengeData;
        const privateDoNotAccessOrElseSafeScriptWrappedValue = Array.isArray(wrappedScript) ? wrappedScript.find((value) => value && typeof value === 'string') : null;
        const privateDoNotAccessOrElseTrustedResourceUrlWrappedValue = Array.isArray(wrappedUrl) ? wrappedUrl.find((value) => value && typeof value === 'string') : null;
        return {
            messageId,
            interpreterJavascript: {
                privateDoNotAccessOrElseSafeScriptWrappedValue,
                privateDoNotAccessOrElseTrustedResourceUrlWrappedValue
            },
            interpreterHash,
            program,
            globalName,
            clientExperimentsStateBlob
        };
    }
    /**
     * Descrambles the given challenge data.
     */
    function descramble(scrambledChallenge) {
        const buffer = base64ToU8(scrambledChallenge);
        if (buffer.length)
            return new TextDecoder().decode(buffer.map((b) => b + 97));
    }

    var challengeFetcher = /*#__PURE__*/Object.freeze({
        __proto__: null,
        create: create,
        descramble: descramble,
        parseChallengeData: parseChallengeData
    });

    class BotGuardClient {
        constructor(options) {
            this.deferredVmFunctions = new DeferredPromise();
            this.defaultTimeout = 3000;
            this.userInteractionElement = options.userInteractionElement;
            this.vm = options.globalObj[options.globalName];
            this.program = options.program;
        }
        /**
         * Factory method to create and load a BotGuardClient instance.
         * @param options - Configuration options for the BotGuardClient.
         * @returns A promise that resolves to a loaded BotGuardClient instance.
         */
        static async create(options) {
            return await new BotGuardClient(options).load();
        }
        async load() {
            if (!this.vm)
                throw new BGError('VM_INIT', 'VM not found');
            if (!this.vm.a)
                throw new BGError('VM_INIT', 'VM init function not found');
            const vmFunctionsCallback = (asyncSnapshotFunction, shutdownFunction, passEventFunction, checkCameraFunction) => {
                this.deferredVmFunctions.resolve({
                    asyncSnapshotFunction,
                    shutdownFunction,
                    passEventFunction,
                    checkCameraFunction
                });
            };
            try {
                this.syncSnapshotFunction = await this.vm.a(this.program, vmFunctionsCallback, true, this.userInteractionElement, () => { }, [[], []])[0];
            }
            catch (error) {
                throw new BGError('VM_ERROR', 'Could not load program', { error });
            }
            return this;
        }
        /**
         * Takes a snapshot asynchronously.
         * @returns The snapshot result.
         * @example
         * ```ts
         * const result = await botguard.snapshot({
         *   contentBinding: {
         *     c: "a=6&a2=10&b=SZWDwKVIuixOp7Y4euGTgwckbJA&c=1729143849&d=1&t=7200&c1a=1&c6a=1&c6b=1&hh=HrMb5mRWTyxGJphDr0nW2Oxonh0_wl2BDqWuLHyeKLo",
         *     e: "ENGAGEMENT_TYPE_VIDEO_LIKE",
         *     encryptedVideoId: "P-vC09ZJcnM"
         *    }
         * });
         *
         * console.log(result);
         * ```
         */
        async snapshot(args, timeout = 3000) {
            return await Promise.race([
                new Promise(async (resolve, reject) => {
                    const vmFunctions = await this.deferredVmFunctions.promise;
                    if (!vmFunctions.asyncSnapshotFunction)
                        return reject(new BGError('ASYNC_SNAPSHOT', 'Asynchronous snapshot function not found'));
                    await vmFunctions.asyncSnapshotFunction((response) => resolve(response), [
                        args.contentBinding,
                        args.signedTimestamp,
                        args.webPoSignalOutput,
                        args.skipPrivacyBuffer
                    ]);
                }),
                new Promise((_, reject) => setTimeout(() => reject(new BGError('TIMEOUT', 'VM operation timed out')), timeout))
            ]);
        }
        /**
         * Passes an event to the VM.
         * @throws Error Throws an error if the pass event function is not found.
         */
        async passEvent(args, timeout = this.defaultTimeout) {
            return await Promise.race([
                (async () => {
                    const vmFunctions = await this.deferredVmFunctions.promise;
                    if (!vmFunctions.passEventFunction)
                        throw new BGError('PASS_EVENT', 'Pass event function not found');
                    vmFunctions.passEventFunction(args);
                })(),
                new Promise((_, reject) => setTimeout(() => reject(new BGError('TIMEOUT', 'VM operation timed out')), timeout))
            ]);
        }
        /**
         * Checks the "camera".
         * @throws Error Throws an error if the check camera function is not found.
         */
        async checkCamera(args, timeout = this.defaultTimeout) {
            return await Promise.race([
                (async () => {
                    const vmFunctions = await this.deferredVmFunctions.promise;
                    if (!vmFunctions.checkCameraFunction)
                        throw new BGError('CHECK_CAMERA', 'Check camera function not found');
                    vmFunctions.checkCameraFunction(args);
                })(),
                new Promise((_, reject) => setTimeout(() => reject(new BGError('TIMEOUT', 'VM operation timed out')), timeout))
            ]);
        }
        /**
         * Shuts down the VM. Taking a snapshot after this will throw an error.
         * @throws Error Throws an error if the shutdown function is not found.
         */
        async shutdown(timeout = this.defaultTimeout) {
            return await Promise.race([
                (async () => {
                    const vmFunctions = await this.deferredVmFunctions.promise;
                    if (!vmFunctions.shutdownFunction)
                        throw new BGError('SHUTDOWN', 'Shutdown function not found');
                    vmFunctions.shutdownFunction();
                })(),
                new Promise((_, reject) => setTimeout(() => reject(new BGError('TIMEOUT', 'VM operation timed out')), timeout))
            ]);
        }
        /**
         * Takes a snapshot synchronously.
         * @returns The snapshot result.
         * @throws Error Throws an error if the synchronous snapshot function is not found.
         */
        async snapshotSynchronous(args) {
            if (!this.syncSnapshotFunction)
                throw new BGError('SYNC_SNAPSHOT', 'Synchronous snapshot function not found');
            return this.syncSnapshotFunction([
                args.contentBinding,
                args.signedTimestamp,
                args.webPoSignalOutput,
                args.skipPrivacyBuffer
            ]);
        }
    }

    class WebPoMinter {
        constructor(mintCallback) {
            this.mintCallback = mintCallback;
        }
        static async create(integrityTokenResponse, webPoSignalOutput) {
            const getMinter = webPoSignalOutput[0];
            if (!getMinter)
                throw new BGError('VM_ERROR', 'PMD:Undefined');
            if (!integrityTokenResponse.integrityToken)
                throw new BGError('INTEGRITY_ERROR', 'No integrity token provided', { integrityTokenResponse });
            const mintCallback = await getMinter(base64ToU8(integrityTokenResponse.integrityToken));
            if (!(mintCallback instanceof Function))
                throw new BGError('VM_ERROR', 'APF:Failed');
            return new WebPoMinter(mintCallback);
        }
        async mintAsWebsafeString(identifier) {
            const result = await this.mint(identifier);
            return u8ToBase64(result, true);
        }
        async mint(identifier) {
            const result = await this.mintCallback(new TextEncoder().encode(identifier));
            if (!result)
                throw new BGError('VM_ERROR', 'YNJ:Undefined');
            if (!(result instanceof Uint8Array))
                throw new BGError('VM_ERROR', 'ODM:Invalid');
            return result;
        }
    }

    /**
     * Generates a Proof of Origin Token.
     * @param args - The arguments for generating the token.
     */
    async function generate(args) {
        const { program, bgConfig, globalName } = args;
        const { identifier } = bgConfig;
        const botguard = await BotGuardClient.create({ program, globalName, globalObj: bgConfig.globalObj });
        const webPoSignalOutput = [];
        const botguardResponse = await botguard.snapshot({ webPoSignalOutput });
        const payload = [bgConfig.requestKey, botguardResponse];
        const integrityTokenResponse = await bgConfig.fetch(buildURL('GenerateIT', bgConfig.useYouTubeAPI), {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });
        const integrityTokenJson = await integrityTokenResponse.json();
        const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = integrityTokenJson;
        const integrityTokenData = {
            integrityToken,
            estimatedTtlSecs,
            mintRefreshThreshold,
            websafeFallbackToken
        };
        const webPoMinter = await WebPoMinter.create(integrityTokenData, webPoSignalOutput);
        const poToken = await webPoMinter.mintAsWebsafeString(identifier);
        return { poToken, integrityTokenData };
    }
    /**
     * Creates a cold start token. This can be used while `sps` (StreamProtectionStatus) is 2, but will not work once it changes to 3.
     * @param identifier - Visitor ID or Data Sync ID.
     * @param clientState - The client state.
     */
    function generateColdStartToken(identifier, clientState) {
        const encodedIdentifier = new TextEncoder().encode(identifier);
        if (encodedIdentifier.length > 118)
            throw new BGError('BAD_INPUT', 'Content binding is too long.', { identifierLength: encodedIdentifier.length });
        const timestamp = Math.floor(Date.now() / 1000);
        const randomKeys = [Math.floor(Math.random() * 256), Math.floor(Math.random() * 256)];
        // NOTE: The "0" value before the client state is supposed to be someVal & 0xFF.
        // It is always 0 though, so I didn't bother investigating further.
        const header = randomKeys.concat([
            0, (clientState ?? 1)
        ], [
            (timestamp >> 24) & 0xFF,
            (timestamp >> 16) & 0xFF,
            (timestamp >> 8) & 0xFF,
            timestamp & 0xFF
        ]);
        const packet = new Uint8Array(2 + header.length + encodedIdentifier.length);
        packet[0] = 34;
        packet[1] = header.length + encodedIdentifier.length;
        packet.set(header, 2);
        packet.set(encodedIdentifier, 2 + header.length);
        const payload = packet.subarray(2);
        const keyLength = randomKeys.length;
        for (let i = keyLength; i < payload.length; i++) {
            payload[i] ^= payload[i % keyLength];
        }
        return u8ToBase64(packet, true);
    }
    /**
     * @deprecated Use `generateColdStartToken` instead.
     */
    function generatePlaceholder(identifier, clientState) {
        return generateColdStartToken(identifier, clientState);
    }
    /**
     * Decodes a cold start webpo token.
     * @throws Error if the packet length is invalid.
     */
    function decodeColdStartToken(token) {
        const packet = base64ToU8(token);
        const payloadLength = packet[1];
        const totalPacketLength = 2 + payloadLength;
        if (packet.length !== totalPacketLength)
            throw new BGError('BAD_INPUT', 'Invalid packet length.', { packetLength: packet.length, expectedLength: totalPacketLength });
        const payload = packet.subarray(2);
        // Decrypt the payload by reversing the XOR operation
        const keyLength = 2;
        for (let i = keyLength; i < payload.length; ++i) {
            payload[i] ^= payload[i % keyLength];
        }
        const keys = [payload[0], payload[1]];
        const unknownVal = payload[2]; // The masked property I mentioned in the function above
        const clientState = payload[3];
        const timestamp = (payload[4] << 24) |
            (payload[5] << 16) |
            (payload[6] << 8) |
            payload[7];
        const date = new Date(timestamp * 1000);
        const identifier = new TextDecoder().decode(payload.subarray(8));
        return {
            identifier,
            timestamp,
            unknownVal,
            clientState,
            keys,
            date
        };
    }

    var webPoClient = /*#__PURE__*/Object.freeze({
        __proto__: null,
        decodeColdStartToken: decodeColdStartToken,
        generate: generate,
        generateColdStartToken: generateColdStartToken,
        generatePlaceholder: generatePlaceholder
    });

    var BG = /*#__PURE__*/Object.freeze({
        __proto__: null,
        BotGuardClient: BotGuardClient,
        Challenge: challengeFetcher,
        PoToken: webPoClient,
        WebPoMinter: WebPoMinter
    });

    exports.BG = BG;
    exports.BGError = BGError;
    exports.DeferredPromise = DeferredPromise;
    exports.GOOG_API_KEY = GOOG_API_KEY;
    exports.GOOG_BASE_URL = GOOG_BASE_URL;
    exports.USER_AGENT = USER_AGENT;
    exports.YT_BASE_URL = YT_BASE_URL;
    exports.base64ToU8 = base64ToU8;
    exports.buildURL = buildURL;
    exports.default = BG;
    exports.getHeaders = getHeaders;
    exports.isBrowser = isBrowser;
    exports.u8ToBase64 = u8ToBase64;

    Object.defineProperty(exports, '__esModule', { value: true });

    return exports;

})({});
