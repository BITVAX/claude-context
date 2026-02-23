import { jest } from '@jest/globals';
import { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';

// ── Mock SDK transports ──────────────────────────────────────────────
const mockSSEStart = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockSSESend = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockSSEClose = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockSSEHandlePostMessage = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

let sseSessionCounter = 0;

jest.unstable_mockModule('@modelcontextprotocol/sdk/server/sse.js', () => ({
    SSEServerTransport: jest.fn().mockImplementation((_endpoint: any, _res: any) => {
        sseSessionCounter++;
        return {
            sessionId: `sse-session-${sseSessionCounter}`,
            start: mockSSEStart,
            send: mockSSESend,
            close: mockSSEClose,
            handlePostMessage: mockSSEHandlePostMessage,
            onclose: null as (() => void) | null,
            onmessage: null,
            onerror: null,
        };
    }),
}));

const mockStreamableHandleRequest = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockStreamableClose = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

let streamableOnsessioninitialized: ((sid: string) => void) | null = null;

jest.unstable_mockModule('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
    StreamableHTTPServerTransport: jest.fn().mockImplementation((opts: any) => {
        if (opts?.onsessioninitialized) {
            streamableOnsessioninitialized = opts.onsessioninitialized;
        }
        return {
            sessionId: null as string | null,
            handleRequest: mockStreamableHandleRequest,
            close: mockStreamableClose,
            onclose: null as (() => void) | null,
            onmessage: null,
            onerror: null,
            start: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        };
    }),
}));

jest.unstable_mockModule('@modelcontextprotocol/sdk/server/index.js', () => ({
    Server: jest.fn().mockImplementation(() => ({
        setRequestHandler: jest.fn(),
        connect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        close: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    })),
}));

jest.unstable_mockModule('@modelcontextprotocol/sdk/server/stdio.js', () => ({
    StdioServerTransport: jest.fn(),
}));

jest.unstable_mockModule('@modelcontextprotocol/sdk/types.js', () => ({
    ListToolsRequestSchema: {},
    CallToolRequestSchema: {},
    isInitializeRequest: jest.fn((body: any) => {
        return body?.method === 'initialize';
    }),
}));

// Mock core dependencies
jest.unstable_mockModule('@zilliz/claude-context-core', () => ({
    Context: jest.fn().mockImplementation(() => ({})),
    Embedding: jest.fn(),
    MilvusVectorDatabase: jest.fn().mockImplementation(() => ({})),
    envManager: { get: jest.fn() },
}));

jest.unstable_mockModule('../config.js', () => ({
    createMcpConfig: jest.fn(),
    logConfigurationSummary: jest.fn(),
    showHelpMessage: jest.fn(),
    ContextMcpConfig: {},
}));

jest.unstable_mockModule('../embedding.js', () => ({
    createEmbeddingInstance: jest.fn(() => ({
        getDimension: () => 1024,
        detectDimension: jest.fn<() => Promise<number>>().mockResolvedValue(1024),
    })),
    logEmbeddingProviderInfo: jest.fn(),
}));

jest.unstable_mockModule('../snapshot.js', () => ({
    SnapshotManager: jest.fn().mockImplementation(() => ({
        loadCodebaseSnapshot: jest.fn(),
        populateMissingEmbeddingInfo: jest.fn(),
    })),
}));

jest.unstable_mockModule('../sync.js', () => ({
    SyncManager: jest.fn().mockImplementation(() => ({
        startBackgroundSync: jest.fn(),
    })),
}));

jest.unstable_mockModule('../handlers.js', () => ({
    ToolHandlers: jest.fn().mockImplementation(() => ({})),
}));

jest.unstable_mockModule('../embedding-registry.js', () => ({
    EmbeddingRegistry: jest.fn().mockImplementation(() => ({})),
}));

// ── Import readBody (it's a module-level function in index.ts) ────────
// Since readBody is not exported, we test it indirectly via the HTTP handler.
// Instead, we recreate the function here for unit testing.
function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString()));
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

// Suppress console output during tests
beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    sseSessionCounter = 0;
    streamableOnsessioninitialized = null;
    mockSSEHandlePostMessage.mockClear();
    mockStreamableHandleRequest.mockClear();
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ── Helper: create a fake IncomingMessage ──────────────────────────
function createFakeRequest(options: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
}): IncomingMessage {
    const emitter = new EventEmitter() as IncomingMessage;
    emitter.method = options.method;
    emitter.url = options.url;
    emitter.headers = options.headers || {};
    // Simulate body streaming
    if (options.body !== undefined) {
        process.nextTick(() => {
            emitter.emit('data', Buffer.from(options.body!));
            emitter.emit('end');
        });
    } else {
        process.nextTick(() => {
            emitter.emit('end');
        });
    }
    return emitter;
}

// ── Helper: create a fake ServerResponse ──────────────────────────
function createFakeResponse(): ServerResponse & {
    _statusCode: number;
    _headers: Record<string, string>;
    _body: string;
    _ended: boolean;
} {
    const res = new EventEmitter() as any;
    res._statusCode = 200;
    res._headers = {};
    res._body = '';
    res._ended = false;
    res.headersSent = false;
    res.writableEnded = false;
    res.destroyed = false;
    res.writeHead = jest.fn((code: number, headers?: Record<string, string>) => {
        res._statusCode = code;
        res.headersSent = true;
        if (headers) Object.assign(res._headers, headers);
        return res;
    });
    res.setHeader = jest.fn((name: string, value: string) => {
        res._headers[name] = value;
    });
    res.end = jest.fn((body?: string) => {
        if (body) res._body = body;
        res._ended = true;
        res.writableEnded = true;
    });
    res.write = jest.fn((data: string) => {
        res._body += data;
        return true;
    });
    return res;
}


// ══════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════

describe('readBody helper', () => {
    it('should parse valid JSON body', async () => {
        const req = createFakeRequest({
            method: 'POST',
            url: '/mcp',
            body: '{"method":"initialize","id":1}',
        });
        const body = await readBody(req);
        expect(body).toEqual({ method: 'initialize', id: 1 });
    });

    it('should reject on invalid JSON', async () => {
        const req = createFakeRequest({
            method: 'POST',
            url: '/mcp',
            body: 'not-json',
        });
        await expect(readBody(req)).rejects.toThrow();
    });

    it('should reject on request error', async () => {
        const emitter = new EventEmitter() as IncomingMessage;
        emitter.method = 'POST';
        emitter.url = '/mcp';
        emitter.headers = {};
        process.nextTick(() => {
            emitter.emit('error', new Error('connection reset'));
        });
        await expect(readBody(emitter)).rejects.toThrow('connection reset');
    });

    it('should handle empty JSON object', async () => {
        const req = createFakeRequest({
            method: 'POST',
            url: '/mcp',
            body: '{}',
        });
        const body = await readBody(req);
        expect(body).toEqual({});
    });
});


describe('Dual transport HTTP handler', () => {
    let httpHandler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
    let sessions: Map<string, any>;
    let sseResponses: Map<string, ServerResponse>;

    // We reconstruct a simplified version of the handler for testing
    // since the real one is inside start() and tightly coupled
    beforeEach(async () => {
        const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
        const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
        const { isInitializeRequest } = await import('@modelcontextprotocol/sdk/types.js');
        const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
        const { randomUUID } = await import('node:crypto');

        sessions = new Map();
        sseResponses = new Map();

        httpHandler = async (req: IncomingMessage, res: ServerResponse) => {
            const url = new URL(req.url || '', 'http://localhost:8001');
            const pathname = url.pathname;

            try {
                if (pathname === '/mcp') {
                    if (req.method === 'POST') {
                        let body: Record<string, unknown>;
                        try {
                            body = await readBody(req);
                        } catch {
                            res.writeHead(400, { 'Content-Type': 'text/plain' });
                            res.end('Invalid JSON');
                            return;
                        }

                        const sessionId = req.headers['mcp-session-id'] as string | undefined;
                        let transport = sessionId ? sessions.get(sessionId) : undefined;

                        if (transport && !(transport instanceof (StreamableHTTPServerTransport as any))) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({
                                jsonrpc: '2.0',
                                error: { code: -32000, message: 'Session uses a different transport protocol' },
                                id: null,
                            }));
                            return;
                        }

                        if (!transport && (isInitializeRequest as any)(body)) {
                            const newTransport = new (StreamableHTTPServerTransport as any)({
                                sessionIdGenerator: () => randomUUID(),
                                onsessioninitialized: (sid: string) => {
                                    sessions.set(sid, newTransport);
                                },
                            });
                            newTransport.onclose = () => {
                                const sid = newTransport.sessionId;
                                if (sid) sessions.delete(sid);
                            };
                            const server = new (Server as any)({ name: 'test', version: '1.0' }, { capabilities: { tools: {} } });
                            await server.connect(newTransport);
                            transport = newTransport;
                        }

                        if (transport) {
                            await transport.handleRequest(req, res, body);
                        } else {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({
                                jsonrpc: '2.0',
                                error: { code: -32000, message: 'Bad Request: No valid session' },
                                id: null,
                            }));
                        }
                    } else if (req.method === 'GET' || req.method === 'DELETE') {
                        const sessionId = req.headers['mcp-session-id'] as string | undefined;
                        const transport = sessionId ? sessions.get(sessionId) : undefined;
                        if (transport) {
                            await transport.handleRequest(req, res);
                        } else {
                            res.writeHead(404, { 'Content-Type': 'text/plain' });
                            res.end('Session not found');
                        }
                    } else {
                        res.writeHead(405, { 'Content-Type': 'text/plain' });
                        res.end('Method not allowed');
                    }
                } else if (req.method === 'GET' && pathname === '/sse') {
                    const transport = new (SSEServerTransport as any)('/message', res);
                    sessions.set(transport.sessionId, transport);
                    sseResponses.set(transport.sessionId, res);

                    transport.onclose = () => {
                        sessions.delete(transport.sessionId);
                        sseResponses.delete(transport.sessionId);
                    };

                    res.on('close', () => {
                        sessions.delete(transport.sessionId);
                        sseResponses.delete(transport.sessionId);
                    });
                } else if (req.method === 'POST' && pathname === '/message') {
                    const sessionId = url.searchParams.get('sessionId');
                    const transport = sessionId ? sessions.get(sessionId) : undefined;
                    if (transport) {
                        await transport.handlePostMessage(req, res);
                    } else {
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        res.end('Session not found');
                    }
                } else {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('Not found');
                }
            } catch (error) {
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Internal server error');
                }
            }
        };
    });

    // ── Route matching ───────────────────────────────────────────────

    describe('route matching', () => {
        it('should return 404 for unknown routes', async () => {
            const req = createFakeRequest({ method: 'GET', url: '/unknown' });
            const res = createFakeResponse();
            await httpHandler(req, res);
            expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'text/plain' });
            expect(res.end).toHaveBeenCalledWith('Not found');
        });

        it('should return 405 for PUT /mcp', async () => {
            const req = createFakeRequest({ method: 'PUT', url: '/mcp' });
            const res = createFakeResponse();
            await httpHandler(req, res);
            expect(res.writeHead).toHaveBeenCalledWith(405, { 'Content-Type': 'text/plain' });
            expect(res.end).toHaveBeenCalledWith('Method not allowed');
        });
    });

    // ── Streamable HTTP transport ─────────────────────────────────────

    describe('Streamable HTTP (POST /mcp)', () => {
        it('should create a new session on initialize request', async () => {
            const req = createFakeRequest({
                method: 'POST',
                url: '/mcp',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'initialize',
                    id: 1,
                    params: {
                        protocolVersion: '2025-03-26',
                        capabilities: {},
                        clientInfo: { name: 'test', version: '1.0' },
                    },
                }),
            });
            const res = createFakeResponse();

            await httpHandler(req, res);

            expect(mockStreamableHandleRequest).toHaveBeenCalled();
        });

        it('should reject non-initialize POST without session ID', async () => {
            const req = createFakeRequest({
                method: 'POST',
                url: '/mcp',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'tools/list',
                    id: 2,
                    params: {},
                }),
            });
            const res = createFakeResponse();

            await httpHandler(req, res);

            expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
            const body = JSON.parse(res._body);
            expect(body.error.message).toBe('Bad Request: No valid session');
        });

        it('should return 400 for invalid JSON body', async () => {
            const req = createFakeRequest({
                method: 'POST',
                url: '/mcp',
                body: 'not-json-at-all',
            });
            const res = createFakeResponse();

            await httpHandler(req, res);

            expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'text/plain' });
            expect(res.end).toHaveBeenCalledWith('Invalid JSON');
        });
    });

    describe('Streamable HTTP (GET/DELETE /mcp)', () => {
        it('should return 404 for GET /mcp without valid session', async () => {
            const req = createFakeRequest({
                method: 'GET',
                url: '/mcp',
                headers: { 'mcp-session-id': 'nonexistent-id' },
            });
            const res = createFakeResponse();

            await httpHandler(req, res);

            expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'text/plain' });
            expect(res.end).toHaveBeenCalledWith('Session not found');
        });

        it('should return 404 for DELETE /mcp without valid session', async () => {
            const req = createFakeRequest({
                method: 'DELETE',
                url: '/mcp',
                headers: { 'mcp-session-id': 'nonexistent-id' },
            });
            const res = createFakeResponse();

            await httpHandler(req, res);

            expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'text/plain' });
            expect(res.end).toHaveBeenCalledWith('Session not found');
        });
    });

    // ── Legacy SSE transport ──────────────────────────────────────────

    describe('Legacy SSE (GET /sse)', () => {
        it('should create SSE session and register in sessions map', async () => {
            const req = createFakeRequest({ method: 'GET', url: '/sse' });
            const res = createFakeResponse();

            await httpHandler(req, res);

            expect(sessions.size).toBe(1);
            expect(sseResponses.size).toBe(1);
            const sessionId = [...sessions.keys()][0];
            expect(sessionId).toMatch(/^sse-session-/);
        });

        it('should clean up session on res close event', async () => {
            const req = createFakeRequest({ method: 'GET', url: '/sse' });
            const res = createFakeResponse();

            await httpHandler(req, res);

            expect(sessions.size).toBe(1);

            // Simulate connection close
            res.emit('close');

            expect(sessions.size).toBe(0);
            expect(sseResponses.size).toBe(0);
        });

        it('should clean up session on transport.onclose', async () => {
            const req = createFakeRequest({ method: 'GET', url: '/sse' });
            const res = createFakeResponse();

            await httpHandler(req, res);

            const transport = [...sessions.values()][0];
            expect(transport.onclose).toBeTruthy();

            // Trigger transport close callback
            transport.onclose();

            expect(sessions.size).toBe(0);
            expect(sseResponses.size).toBe(0);
        });
    });

    describe('Legacy SSE (POST /message)', () => {
        it('should route message to existing SSE session', async () => {
            // First create an SSE session
            const sseReq = createFakeRequest({ method: 'GET', url: '/sse' });
            const sseRes = createFakeResponse();
            await httpHandler(sseReq, sseRes);

            const sessionId = [...sessions.keys()][0];

            // Now send a message to that session
            const msgReq = createFakeRequest({
                method: 'POST',
                url: `/message?sessionId=${sessionId}`,
                body: '{"jsonrpc":"2.0","method":"tools/list","id":1}',
            });
            const msgRes = createFakeResponse();
            await httpHandler(msgReq, msgRes);

            expect(mockSSEHandlePostMessage).toHaveBeenCalled();
        });

        it('should return 404 for unknown session ID', async () => {
            const req = createFakeRequest({
                method: 'POST',
                url: '/message?sessionId=unknown',
                body: '{"jsonrpc":"2.0","method":"tools/list","id":1}',
            });
            const res = createFakeResponse();

            await httpHandler(req, res);

            expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'text/plain' });
            expect(res.end).toHaveBeenCalledWith('Session not found');
        });
    });
});


// ── Heartbeat tests ──────────────────────────────────────────────────

describe('Heartbeat logic', () => {
    it('should detect and remove sessions with destroyed responses', () => {
        const sessions = new Map<string, any>();
        const sseResponses = new Map<string, any>();

        // Simulate a zombie session
        const fakeRes = createFakeResponse();
        fakeRes.destroyed = true;
        sessions.set('zombie-1', { sessionId: 'zombie-1' });
        sseResponses.set('zombie-1', fakeRes);

        // Simulate heartbeat logic
        for (const [sessionId, sseRes] of sseResponses) {
            if (sseRes.writableEnded || sseRes.destroyed) {
                sessions.delete(sessionId);
                sseResponses.delete(sessionId);
            }
        }

        expect(sessions.size).toBe(0);
        expect(sseResponses.size).toBe(0);
    });

    it('should detect and remove sessions with writableEnded responses', () => {
        const sessions = new Map<string, any>();
        const sseResponses = new Map<string, any>();

        const fakeRes = createFakeResponse();
        Object.defineProperty(fakeRes, 'writableEnded', { value: true, writable: true });
        sessions.set('ended-1', { sessionId: 'ended-1' });
        sseResponses.set('ended-1', fakeRes);

        for (const [sessionId, sseRes] of sseResponses) {
            if (sseRes.writableEnded || sseRes.destroyed) {
                sessions.delete(sessionId);
                sseResponses.delete(sessionId);
            }
        }

        expect(sessions.size).toBe(0);
        expect(sseResponses.size).toBe(0);
    });

    it('should keep alive sessions whose responses are still writable', () => {
        const sessions = new Map<string, any>();
        const sseResponses = new Map<string, any>();

        const fakeRes = createFakeResponse();
        // Default: writableEnded=false, destroyed=false
        sessions.set('alive-1', { sessionId: 'alive-1' });
        sseResponses.set('alive-1', fakeRes);

        for (const [sessionId, sseRes] of sseResponses) {
            if (sseRes.writableEnded || sseRes.destroyed) {
                sessions.delete(sessionId);
                sseResponses.delete(sessionId);
                continue;
            }
            try {
                sseRes.write(':ping\n\n');
            } catch {
                sessions.delete(sessionId);
                sseResponses.delete(sessionId);
            }
        }

        expect(sessions.size).toBe(1);
        expect(sseResponses.size).toBe(1);
        expect(fakeRes.write).toHaveBeenCalledWith(':ping\n\n');
    });

    it('should remove sessions when write throws', () => {
        const sessions = new Map<string, any>();
        const sseResponses = new Map<string, any>();

        const fakeRes = createFakeResponse();
        (fakeRes.write as jest.Mock).mockImplementation(() => {
            throw new Error('write after end');
        });
        sessions.set('broken-1', { sessionId: 'broken-1' });
        sseResponses.set('broken-1', fakeRes);

        for (const [sessionId, sseRes] of sseResponses) {
            if (sseRes.writableEnded || sseRes.destroyed) {
                sessions.delete(sessionId);
                sseResponses.delete(sessionId);
                continue;
            }
            try {
                sseRes.write(':ping\n\n');
            } catch {
                sessions.delete(sessionId);
                sseResponses.delete(sessionId);
            }
        }

        expect(sessions.size).toBe(0);
        expect(sseResponses.size).toBe(0);
    });
});