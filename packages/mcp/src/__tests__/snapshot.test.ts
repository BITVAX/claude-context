import { jest } from '@jest/globals';

// --- Mock fs and os before importing SnapshotManager ---

const mockFs = {
    existsSync: jest.fn<(path: string) => boolean>(),
    readFileSync: jest.fn<(path: string, encoding: string) => string>(),
    writeFileSync: jest.fn<(path: string, data: string) => void>(),
    mkdirSync: jest.fn<(path: string, options?: any) => void>(),
};

const mockOs = {
    homedir: jest.fn<() => string>(() => '/mock-home'),
};

jest.unstable_mockModule('fs', () => ({
    ...mockFs,
    default: mockFs,
}));

jest.unstable_mockModule('os', () => ({
    ...mockOs,
    default: mockOs,
}));

// Also mock the config module to avoid its dependency on @zilliz/claude-context-core
jest.unstable_mockModule('../config.js', () => ({}));

const { SnapshotManager } = await import('../snapshot.js');

beforeEach(() => {
    jest.clearAllMocks();
    mockOs.homedir.mockReturnValue('/mock-home');
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('SnapshotManager constructor', () => {
    it('should initialize with snapshot file path based on homedir', () => {
        const manager = new SnapshotManager();
        // Verify indirectly via saveCodebaseSnapshot.
        mockFs.existsSync.mockReturnValue(true);
        manager.saveCodebaseSnapshot();
        expect(mockFs.writeFileSync).toHaveBeenCalledWith(
            expect.stringContaining('/mock-home/.context/mcp-codebase-snapshot.json'),
            expect.any(String)
        );
    });
});

describe('State transitions', () => {
    let manager: InstanceType<typeof SnapshotManager>;

    beforeEach(() => {
        manager = new SnapshotManager();
    });

    it('should return "not_found" for unknown codebase', () => {
        expect(manager.getCodebaseStatus('/unknown')).toBe('not_found');
    });

    it('should transition to "indexing" with setCodebaseIndexing', () => {
        manager.setCodebaseIndexing('/project', 0);
        expect(manager.getCodebaseStatus('/project')).toBe('indexing');
    });

    it('should transition from "indexing" to "indexed" with setCodebaseIndexed', () => {
        manager.setCodebaseIndexing('/project', 50);
        manager.setCodebaseIndexed('/project', {
            indexedFiles: 100,
            totalChunks: 500,
            status: 'completed',
        });
        expect(manager.getCodebaseStatus('/project')).toBe('indexed');
    });

    it('should transition to "indexfailed" with setCodebaseIndexFailed', () => {
        manager.setCodebaseIndexing('/project', 30);
        manager.setCodebaseIndexFailed('/project', 'Connection lost', 30);
        expect(manager.getCodebaseStatus('/project')).toBe('indexfailed');
    });

    it('should track indexing progress', () => {
        manager.setCodebaseIndexing('/project', 0);
        const info = manager.getCodebaseInfo('/project');
        expect(info).toBeDefined();
        expect(info!.status).toBe('indexing');
        if (info!.status === 'indexing') {
            expect(info!.indexingPercentage).toBe(0);
        }
    });

    it('should store indexed stats', () => {
        manager.setCodebaseIndexed('/project', {
            indexedFiles: 200,
            totalChunks: 1000,
            status: 'limit_reached',
        });
        const info = manager.getCodebaseInfo('/project');
        expect(info).toBeDefined();
        expect(info!.status).toBe('indexed');
        if (info!.status === 'indexed') {
            expect(info!.indexedFiles).toBe(200);
            expect(info!.totalChunks).toBe(1000);
            expect(info!.indexStatus).toBe('limit_reached');
        }
    });

    it('should store failed error message and last percentage', () => {
        manager.setCodebaseIndexFailed('/project', 'Disk full', 75);
        const info = manager.getCodebaseInfo('/project');
        expect(info).toBeDefined();
        expect(info!.status).toBe('indexfailed');
        if (info!.status === 'indexfailed') {
            expect(info!.errorMessage).toBe('Disk full');
            expect(info!.lastAttemptedPercentage).toBe(75);
        }
    });
});

describe('Embedding metadata in state transitions', () => {
    let manager: InstanceType<typeof SnapshotManager>;

    beforeEach(() => {
        manager = new SnapshotManager();
    });

    it('should store embeddingInfo when provided to setCodebaseIndexing', () => {
        manager.setCodebaseIndexing('/project', 0, { provider: 'Ollama', model: 'nomic-embed-text' });
        const info = manager.getCodebaseInfo('/project');
        expect(info!.status).toBe('indexing');
        if (info!.status === 'indexing') {
            expect(info!.embeddingProvider).toBe('Ollama');
            expect(info!.embeddingModel).toBe('nomic-embed-text');
        }
    });

    it('should preserve existing embeddingInfo on progress update without explicit info', () => {
        manager.setCodebaseIndexing('/project', 0, { provider: 'OpenAI', model: 'text-embedding-3-small' });
        // Update progress without providing embeddingInfo
        manager.setCodebaseIndexing('/project', 50);
        const info = manager.getCodebaseInfo('/project');
        if (info!.status === 'indexing') {
            expect(info!.embeddingProvider).toBe('OpenAI');
            expect(info!.embeddingModel).toBe('text-embedding-3-small');
        }
    });

    it('should store embedding metadata in setCodebaseIndexed', () => {
        manager.setCodebaseIndexed('/project', {
            indexedFiles: 100,
            totalChunks: 500,
            status: 'completed',
            embeddingProvider: 'VoyageAI',
            embeddingModel: 'voyage-code-3',
            embeddingDimension: 1024,
        });
        const info = manager.getCodebaseInfo('/project');
        if (info!.status === 'indexed') {
            expect(info!.embeddingProvider).toBe('VoyageAI');
            expect(info!.embeddingModel).toBe('voyage-code-3');
            expect(info!.embeddingDimension).toBe(1024);
        }
    });

    it('should omit embedding fields when not provided', () => {
        manager.setCodebaseIndexed('/project', {
            indexedFiles: 10,
            totalChunks: 50,
            status: 'completed',
        });
        const info = manager.getCodebaseInfo('/project');
        if (info!.status === 'indexed') {
            expect(info!.embeddingProvider).toBeUndefined();
            expect(info!.embeddingModel).toBeUndefined();
            expect(info!.embeddingDimension).toBeUndefined();
        }
    });
});

describe('getCodebaseEmbeddingInfo', () => {
    let manager: InstanceType<typeof SnapshotManager>;

    beforeEach(() => {
        manager = new SnapshotManager();
    });

    it('should return embedding info for indexed codebase with metadata', () => {
        manager.setCodebaseIndexed('/project', {
            indexedFiles: 100,
            totalChunks: 500,
            status: 'completed',
            embeddingProvider: 'Ollama',
            embeddingModel: 'nomic-embed-text',
            embeddingDimension: 768,
        });
        const result = manager.getCodebaseEmbeddingInfo('/project');
        expect(result).toEqual({
            provider: 'Ollama',
            model: 'nomic-embed-text',
            dimension: 768,
        });
    });

    it('should return undefined for indexed codebase without embedding metadata', () => {
        manager.setCodebaseIndexed('/project', {
            indexedFiles: 10,
            totalChunks: 50,
            status: 'completed',
        });
        expect(manager.getCodebaseEmbeddingInfo('/project')).toBeUndefined();
    });

    it('should return undefined for non-indexed codebase', () => {
        manager.setCodebaseIndexing('/project', 50);
        expect(manager.getCodebaseEmbeddingInfo('/project')).toBeUndefined();
    });

    it('should return undefined for unknown codebase', () => {
        expect(manager.getCodebaseEmbeddingInfo('/unknown')).toBeUndefined();
    });

    it('should default dimension to 0 when not provided', () => {
        manager.setCodebaseIndexed('/project', {
            indexedFiles: 10,
            totalChunks: 50,
            status: 'completed',
            embeddingProvider: 'OpenAI',
            embeddingModel: 'text-embedding-3-small',
        });
        const result = manager.getCodebaseEmbeddingInfo('/project');
        expect(result).toBeDefined();
        expect(result!.dimension).toBe(0);
    });
});

describe('populateMissingEmbeddingInfo', () => {
    let manager: InstanceType<typeof SnapshotManager>;

    beforeEach(() => {
        manager = new SnapshotManager();
    });

    it('should populate metadata for indexed codebases without it', () => {
        // Simulate a pre-feature index (no embedding metadata)
        manager.setCodebaseIndexed('/old-project', {
            indexedFiles: 50,
            totalChunks: 200,
            status: 'completed',
        });

        mockFs.existsSync.mockReturnValue(true);
        const changed = manager.populateMissingEmbeddingInfo('OpenAI', 'text-embedding-3-small', 1536);

        expect(changed).toBe(true);
        const embInfo = manager.getCodebaseEmbeddingInfo('/old-project');
        expect(embInfo).toEqual({
            provider: 'OpenAI',
            model: 'text-embedding-3-small',
            dimension: 1536,
        });
    });

    it('should not overwrite existing embedding metadata', () => {
        manager.setCodebaseIndexed('/new-project', {
            indexedFiles: 100,
            totalChunks: 500,
            status: 'completed',
            embeddingProvider: 'Ollama',
            embeddingModel: 'nomic-embed-text',
            embeddingDimension: 768,
        });

        mockFs.existsSync.mockReturnValue(true);
        const changed = manager.populateMissingEmbeddingInfo('OpenAI', 'text-embedding-3-small', 1536);

        expect(changed).toBe(false);
        const embInfo = manager.getCodebaseEmbeddingInfo('/new-project');
        expect(embInfo!.provider).toBe('Ollama');
    });

    it('should save snapshot when changes are made', () => {
        manager.setCodebaseIndexed('/old', {
            indexedFiles: 10,
            totalChunks: 50,
            status: 'completed',
        });

        mockFs.existsSync.mockReturnValue(true);
        manager.populateMissingEmbeddingInfo('OpenAI', 'model', 1536);

        expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('should return false when no codebases need updating', () => {
        // No codebases at all
        const changed = manager.populateMissingEmbeddingInfo('OpenAI', 'model', 1536);
        expect(changed).toBe(false);
    });
});

describe('getAllCodebasesInfo', () => {
    it('should return a copy of the codebase info map', () => {
        const manager = new SnapshotManager();
        manager.setCodebaseIndexed('/a', { indexedFiles: 10, totalChunks: 50, status: 'completed' });
        manager.setCodebaseIndexing('/b', 30);

        const allInfo = manager.getAllCodebasesInfo();
        expect(allInfo.size).toBe(2);
        expect(allInfo.has('/a')).toBe(true);
        expect(allInfo.has('/b')).toBe(true);

        // Should be a copy (modifying it shouldn't affect the manager)
        allInfo.delete('/a');
        expect(manager.getCodebaseStatus('/a')).toBe('indexed');
    });
});

describe('removeCodebaseCompletely', () => {
    it('should remove codebase from all tracking', () => {
        const manager = new SnapshotManager();
        manager.setCodebaseIndexed('/project', {
            indexedFiles: 50,
            totalChunks: 200,
            status: 'completed',
        });
        expect(manager.getCodebaseStatus('/project')).toBe('indexed');

        manager.removeCodebaseCompletely('/project');
        expect(manager.getCodebaseStatus('/project')).toBe('not_found');
        expect(manager.getCodebaseInfo('/project')).toBeUndefined();
    });
});

describe('getFailedCodebases', () => {
    it('should return only failed codebases', () => {
        const manager = new SnapshotManager();
        manager.setCodebaseIndexed('/project-a', {
            indexedFiles: 10,
            totalChunks: 50,
            status: 'completed',
        });
        manager.setCodebaseIndexFailed('/project-b', 'Error B');
        manager.setCodebaseIndexing('/project-c', 20);
        manager.setCodebaseIndexFailed('/project-d', 'Error D');

        const failed = manager.getFailedCodebases();
        expect(failed).toHaveLength(2);
        expect(failed).toContain('/project-b');
        expect(failed).toContain('/project-d');
    });
});

describe('loadCodebaseSnapshot', () => {
    it('should handle missing snapshot file gracefully', () => {
        const manager = new SnapshotManager();
        mockFs.existsSync.mockReturnValue(false);

        manager.loadCodebaseSnapshot();
        expect(manager.getCodebaseStatus('/any')).toBe('not_found');
    });

    it('should load v2 format snapshot', () => {
        const manager = new SnapshotManager();
        const v2Snapshot = {
            formatVersion: 'v2',
            codebases: {
                '/project-a': {
                    status: 'indexed',
                    indexedFiles: 100,
                    totalChunks: 500,
                    indexStatus: 'completed',
                    lastUpdated: '2024-01-01T00:00:00.000Z',
                },
                '/project-b': {
                    status: 'indexfailed',
                    errorMessage: 'Network error',
                    lastUpdated: '2024-01-01T00:00:00.000Z',
                },
            },
            lastUpdated: '2024-01-01T00:00:00.000Z',
        };

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(v2Snapshot));

        manager.loadCodebaseSnapshot();

        expect(manager.getCodebaseStatus('/project-a')).toBe('indexed');
        expect(manager.getCodebaseStatus('/project-b')).toBe('indexfailed');
    });

    it('should load v1 format snapshot and migrate to v2', () => {
        const manager = new SnapshotManager();
        const v1Snapshot = {
            indexedCodebases: ['/project-a'],
            indexingCodebases: ['/project-b'],
            lastUpdated: '2024-01-01T00:00:00.000Z',
        };

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(v1Snapshot));

        manager.loadCodebaseSnapshot();

        expect(manager.getCodebaseStatus('/project-a')).toBe('indexed');
        expect(manager.getCodebaseStatus('/project-b')).not.toBe('indexed');

        // Should save in v2 format (migration)
        expect(mockFs.writeFileSync).toHaveBeenCalled();
        const savedData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
        expect(savedData.formatVersion).toBe('v2');
    });

    it('should handle corrupt JSON gracefully', () => {
        const manager = new SnapshotManager();
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue('not valid json {{{');

        manager.loadCodebaseSnapshot();
        expect(manager.getCodebaseStatus('/any')).toBe('not_found');
    });

    it('should skip non-existent codebase paths in v2 format', () => {
        const manager = new SnapshotManager();
        const v2Snapshot = {
            formatVersion: 'v2',
            codebases: {
                '/exists': {
                    status: 'indexed',
                    indexedFiles: 50,
                    totalChunks: 200,
                    indexStatus: 'completed',
                    lastUpdated: '2024-01-01T00:00:00.000Z',
                },
                '/gone': {
                    status: 'indexed',
                    indexedFiles: 30,
                    totalChunks: 100,
                    indexStatus: 'completed',
                    lastUpdated: '2024-01-01T00:00:00.000Z',
                },
            },
            lastUpdated: '2024-01-01T00:00:00.000Z',
        };

        mockFs.existsSync.mockImplementation((p: string) => {
            if (p === '/exists') return true;
            if (p === '/gone') return false;
            return true;
        });
        mockFs.readFileSync.mockReturnValue(JSON.stringify(v2Snapshot));

        manager.loadCodebaseSnapshot();

        expect(manager.getCodebaseStatus('/exists')).toBe('indexed');
        expect(manager.getCodebaseStatus('/gone')).toBe('not_found');
    });

    it('should preserve embedding metadata when loading v2 snapshot', () => {
        const manager = new SnapshotManager();
        const v2Snapshot = {
            formatVersion: 'v2',
            codebases: {
                '/project': {
                    status: 'indexed',
                    indexedFiles: 100,
                    totalChunks: 500,
                    indexStatus: 'completed',
                    embeddingProvider: 'Ollama',
                    embeddingModel: 'nomic-embed-text',
                    embeddingDimension: 768,
                    lastUpdated: '2024-01-01T00:00:00.000Z',
                },
            },
            lastUpdated: '2024-01-01T00:00:00.000Z',
        };

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(v2Snapshot));

        manager.loadCodebaseSnapshot();

        const embInfo = manager.getCodebaseEmbeddingInfo('/project');
        expect(embInfo).toEqual({
            provider: 'Ollama',
            model: 'nomic-embed-text',
            dimension: 768,
        });
    });
});

describe('saveCodebaseSnapshot', () => {
    it('should save in v2 format', () => {
        const manager = new SnapshotManager();
        manager.setCodebaseIndexed('/project', {
            indexedFiles: 10,
            totalChunks: 50,
            status: 'completed',
        });

        mockFs.existsSync.mockReturnValue(true);
        manager.saveCodebaseSnapshot();

        expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
        const savedData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
        expect(savedData.formatVersion).toBe('v2');
        expect(savedData.codebases['/project']).toBeDefined();
        expect(savedData.codebases['/project'].status).toBe('indexed');
    });

    it('should create directory if it does not exist', () => {
        const manager = new SnapshotManager();

        mockFs.existsSync.mockReturnValue(false);
        manager.saveCodebaseSnapshot();

        expect(mockFs.mkdirSync).toHaveBeenCalledWith(
            expect.any(String),
            { recursive: true }
        );
    });

    it('should not throw on write error', () => {
        const manager = new SnapshotManager();
        mockFs.existsSync.mockReturnValue(true);
        mockFs.writeFileSync.mockImplementation(() => {
            throw new Error('Permission denied');
        });

        expect(() => manager.saveCodebaseSnapshot()).not.toThrow();
    });

    it('should include embedding metadata in saved v2 snapshot', () => {
        const manager = new SnapshotManager();
        manager.setCodebaseIndexed('/project', {
            indexedFiles: 100,
            totalChunks: 500,
            status: 'completed',
            embeddingProvider: 'Gemini',
            embeddingModel: 'gemini-embedding-001',
            embeddingDimension: 768,
        });

        mockFs.existsSync.mockReturnValue(true);
        manager.saveCodebaseSnapshot();

        const savedData = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
        const saved = savedData.codebases['/project'];
        expect(saved.embeddingProvider).toBe('Gemini');
        expect(saved.embeddingModel).toBe('gemini-embedding-001');
        expect(saved.embeddingDimension).toBe(768);
    });
});

describe('getIndexedCodebases (from file)', () => {
    it('should return empty array when snapshot file does not exist', () => {
        const manager = new SnapshotManager();
        mockFs.existsSync.mockReturnValue(false);

        expect(manager.getIndexedCodebases()).toEqual([]);
    });

    it('should read indexed codebases from v2 file', () => {
        const manager = new SnapshotManager();
        const v2Snapshot = {
            formatVersion: 'v2',
            codebases: {
                '/proj-a': {
                    status: 'indexed',
                    indexedFiles: 10,
                    totalChunks: 50,
                    indexStatus: 'completed',
                    lastUpdated: '2024-01-01T00:00:00.000Z',
                },
                '/proj-b': {
                    status: 'indexing',
                    indexingPercentage: 50,
                    lastUpdated: '2024-01-01T00:00:00.000Z',
                },
                '/proj-c': {
                    status: 'indexfailed',
                    errorMessage: 'fail',
                    lastUpdated: '2024-01-01T00:00:00.000Z',
                },
            },
            lastUpdated: '2024-01-01T00:00:00.000Z',
        };

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(v2Snapshot));

        const result = manager.getIndexedCodebases();
        expect(result).toEqual(['/proj-a']);
    });

    it('should read indexed codebases from v1 file', () => {
        const manager = new SnapshotManager();
        const v1Snapshot = {
            indexedCodebases: ['/proj-a', '/proj-b'],
            indexingCodebases: [],
            lastUpdated: '2024-01-01T00:00:00.000Z',
        };

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(v1Snapshot));

        const result = manager.getIndexedCodebases();
        expect(result).toEqual(['/proj-a', '/proj-b']);
    });

    it('should fallback to memory on file read error', () => {
        const manager = new SnapshotManager();
        manager.setCodebaseIndexed('/memory-proj', {
            indexedFiles: 5,
            totalChunks: 20,
            status: 'completed',
        });

        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockImplementation(() => {
            throw new Error('Read error');
        });

        const result = manager.getIndexedCodebases();
        expect(result).toContain('/memory-proj');
    });
});

describe('Legacy methods', () => {
    let manager: InstanceType<typeof SnapshotManager>;

    beforeEach(() => {
        manager = new SnapshotManager();
    });

    it('addIndexingCodebase should update both indexing map and info map', () => {
        manager.addIndexingCodebase('/legacy', 25);
        const info = manager.getCodebaseInfo('/legacy');
        expect(info).toBeDefined();
        expect(info!.status).toBe('indexing');
    });

    it('moveFromIndexingToIndexed should transition state', () => {
        manager.addIndexingCodebase('/legacy', 50);
        manager.moveFromIndexingToIndexed('/legacy', 100);
        expect(manager.getCodebaseStatus('/legacy')).toBe('indexed');
    });

    it('addIndexedCodebase should not duplicate entries', () => {
        manager.addIndexedCodebase('/dup', 10);
        manager.addIndexedCodebase('/dup', 20);
        expect(manager.getCodebaseStatus('/dup')).toBe('indexed');
    });
});
