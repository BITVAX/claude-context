import { jest } from '@jest/globals';

// --- Mock fs, envManager, and FileSynchronizer before importing SyncManager ---

const mockExistsSync = jest.fn<(path: string) => boolean>();
const mockDeleteSnapshot = jest.fn<(path: string) => Promise<void>>();
const mockEnvGet = jest.fn<(name: string) => string | undefined>();

jest.unstable_mockModule('fs', () => ({
    existsSync: mockExistsSync,
    default: { existsSync: mockExistsSync },
}));

jest.unstable_mockModule('@zilliz/claude-context-core', () => ({
    FileSynchronizer: {
        deleteSnapshot: mockDeleteSnapshot,
    },
    envManager: {
        get: mockEnvGet,
    },
}));

const { SyncManager } = await import('../sync.js');

beforeEach(() => {
    jest.clearAllMocks();
    mockEnvGet.mockReturnValue(undefined);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

function createMockContext(overrides: Record<string, any> = {}) {
    return {
        reindexByChange: jest.fn<(path: string) => Promise<{ added: number; removed: number; modified: number }>>()
            .mockResolvedValue({ added: 0, removed: 0, modified: 0 }),
        ...overrides,
    } as any;
}

function createMockSnapshotManager(indexedCodebases: string[] = []) {
    return {
        getIndexedCodebases: jest.fn<() => string[]>().mockReturnValue(indexedCodebases),
    } as any;
}

describe('getIsSyncing', () => {
    it('should return false initially', () => {
        const context = createMockContext();
        const snapshot = createMockSnapshotManager();
        const sync = new SyncManager(context, snapshot);
        expect(sync.getIsSyncing()).toBe(false);
    });
});

describe('handleSyncIndex', () => {
    it('should return empty stats when no codebases are indexed', async () => {
        const context = createMockContext();
        const snapshot = createMockSnapshotManager([]);
        const sync = new SyncManager(context, snapshot);

        const result = await sync.handleSyncIndex();

        expect(context.reindexByChange).not.toHaveBeenCalled();
        expect(result).toEqual({ added: 0, removed: 0, modified: 0 });
    });

    it('should call reindexByChange for each indexed codebase', async () => {
        const context = createMockContext();
        context.reindexByChange.mockResolvedValue({ added: 1, removed: 0, modified: 2 });
        const snapshot = createMockSnapshotManager(['/proj-a', '/proj-b']);
        const sync = new SyncManager(context, snapshot);

        mockExistsSync.mockReturnValue(true);

        await sync.handleSyncIndex();

        expect(context.reindexByChange).toHaveBeenCalledTimes(2);
        expect(context.reindexByChange).toHaveBeenCalledWith('/proj-a');
        expect(context.reindexByChange).toHaveBeenCalledWith('/proj-b');
    });

    it('should return accumulated stats across multiple codebases', async () => {
        const context = createMockContext();
        context.reindexByChange
            .mockResolvedValueOnce({ added: 5, removed: 1, modified: 3 })
            .mockResolvedValueOnce({ added: 2, removed: 0, modified: 1 });
        const snapshot = createMockSnapshotManager(['/a', '/b']);
        const sync = new SyncManager(context, snapshot);

        mockExistsSync.mockReturnValue(true);

        const result = await sync.handleSyncIndex();

        expect(result).toEqual({ added: 7, removed: 1, modified: 4 });
    });

    it('should skip codebases whose paths no longer exist', async () => {
        const context = createMockContext();
        const snapshot = createMockSnapshotManager(['/exists', '/gone']);
        const sync = new SyncManager(context, snapshot);

        mockExistsSync.mockImplementation((p: string) => p === '/exists');

        await sync.handleSyncIndex();

        expect(context.reindexByChange).toHaveBeenCalledTimes(1);
        expect(context.reindexByChange).toHaveBeenCalledWith('/exists');
    });

    it('should continue processing remaining codebases when one fails', async () => {
        const context = createMockContext();
        context.reindexByChange
            .mockRejectedValueOnce(new Error('Network error'))
            .mockResolvedValueOnce({ added: 3, removed: 0, modified: 0 });
        const snapshot = createMockSnapshotManager(['/fail', '/succeed']);
        const sync = new SyncManager(context, snapshot);

        mockExistsSync.mockReturnValue(true);

        await sync.handleSyncIndex();

        expect(context.reindexByChange).toHaveBeenCalledTimes(2);
    });

    it('should delete snapshot when Milvus query fails', async () => {
        const context = createMockContext();
        context.reindexByChange.mockRejectedValue(new Error('Failed to query Milvus collection'));
        const snapshot = createMockSnapshotManager(['/project']);
        const sync = new SyncManager(context, snapshot);

        mockExistsSync.mockReturnValue(true);

        await sync.handleSyncIndex();

        expect(mockDeleteSnapshot).toHaveBeenCalledWith('/project');
    });

    it('should guard against concurrent sync calls', async () => {
        const context = createMockContext();
        context.reindexByChange.mockImplementation(() =>
            new Promise(resolve => setTimeout(resolve, 100, { added: 0, removed: 0, modified: 0 }))
        );
        const snapshot = createMockSnapshotManager(['/project']);
        const sync = new SyncManager(context, snapshot);

        mockExistsSync.mockReturnValue(true);

        const first = sync.handleSyncIndex();
        const second = sync.handleSyncIndex();

        await Promise.all([first, second]);

        expect(context.reindexByChange).toHaveBeenCalledTimes(1);
    });

    it('should reset isSyncing flag even when an error occurs', async () => {
        const context = createMockContext();
        context.reindexByChange.mockRejectedValue(new Error('Unexpected'));
        const snapshot = createMockSnapshotManager(['/project']);
        const sync = new SyncManager(context, snapshot);

        mockExistsSync.mockReturnValue(true);

        await sync.handleSyncIndex();
        expect(sync.getIsSyncing()).toBe(false);

        // Should be able to sync again
        context.reindexByChange.mockResolvedValue({ added: 0, removed: 0, modified: 0 });
        await sync.handleSyncIndex();
        expect(context.reindexByChange).toHaveBeenCalledTimes(2);
    });
});

describe('syncSingleCodebase', () => {
    it('should sync a single indexed codebase and return stats', async () => {
        const context = createMockContext();
        context.reindexByChange.mockResolvedValue({ added: 3, removed: 1, modified: 2 });
        const snapshot = createMockSnapshotManager(['/project']);
        const sync = new SyncManager(context, snapshot);

        mockExistsSync.mockReturnValue(true);

        const result = await sync.syncSingleCodebase('/project');

        expect(result).toEqual({ added: 3, removed: 1, modified: 2 });
        expect(context.reindexByChange).toHaveBeenCalledWith('/project');
    });

    it('should throw if codebase is not indexed', async () => {
        const context = createMockContext();
        const snapshot = createMockSnapshotManager(['/other']);
        const sync = new SyncManager(context, snapshot);

        await expect(sync.syncSingleCodebase('/not-indexed')).rejects.toThrow('not indexed');
    });

    it('should throw if codebase path does not exist', async () => {
        const context = createMockContext();
        const snapshot = createMockSnapshotManager(['/project']);
        const sync = new SyncManager(context, snapshot);

        mockExistsSync.mockReturnValue(false);

        await expect(sync.syncSingleCodebase('/project')).rejects.toThrow('does not exist');
    });

    it('should throw if sync is already in progress', async () => {
        const context = createMockContext();
        context.reindexByChange.mockImplementation(() =>
            new Promise(resolve => setTimeout(resolve, 200, { added: 0, removed: 0, modified: 0 }))
        );
        const snapshot = createMockSnapshotManager(['/project']);
        const sync = new SyncManager(context, snapshot);

        mockExistsSync.mockReturnValue(true);

        const first = sync.syncSingleCodebase('/project');
        await expect(sync.syncSingleCodebase('/project')).rejects.toThrow('already in progress');
        await first;
    });

    it('should reset isSyncing after error', async () => {
        const context = createMockContext();
        context.reindexByChange.mockRejectedValue(new Error('Reindex failed'));
        const snapshot = createMockSnapshotManager(['/project']);
        const sync = new SyncManager(context, snapshot);

        mockExistsSync.mockReturnValue(true);

        await expect(sync.syncSingleCodebase('/project')).rejects.toThrow('Reindex failed');
        expect(sync.getIsSyncing()).toBe(false);
    });

    it('should delete snapshot on Milvus query failure', async () => {
        const context = createMockContext();
        context.reindexByChange.mockRejectedValue(new Error('Failed to query Milvus'));
        const snapshot = createMockSnapshotManager(['/project']);
        const sync = new SyncManager(context, snapshot);

        mockExistsSync.mockReturnValue(true);

        await expect(sync.syncSingleCodebase('/project')).rejects.toThrow();
        expect(mockDeleteSnapshot).toHaveBeenCalledWith('/project');
    });
});

describe('startBackgroundSync', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('should schedule initial sync after 5 seconds by default', () => {
        const context = createMockContext();
        const snapshot = createMockSnapshotManager([]);
        const sync = new SyncManager(context, snapshot);

        sync.startBackgroundSync();

        expect(jest.getTimerCount()).toBeGreaterThanOrEqual(1);
    });

    it('should set up periodic sync every 5 minutes by default', () => {
        const context = createMockContext();
        const snapshot = createMockSnapshotManager([]);
        const sync = new SyncManager(context, snapshot);

        sync.startBackgroundSync();

        // Should have both setTimeout + setInterval
        expect(jest.getTimerCount()).toBeGreaterThanOrEqual(2);
    });

    it('should disable initial sync when SYNC_INITIAL_DELAY_MS=0', () => {
        mockEnvGet.mockImplementation((name: string) => {
            if (name === 'SYNC_INITIAL_DELAY_MS') return '0';
            return undefined;
        });

        const context = createMockContext();
        const snapshot = createMockSnapshotManager(['/project']);
        const sync = new SyncManager(context, snapshot);

        sync.startBackgroundSync();

        // Advance past any timers - initial sync should NOT fire
        jest.advanceTimersByTime(10000);

        // Only setInterval should exist (periodic), NOT the initial setTimeout
        // The reindexByChange should NOT have been called via initial sync
        // (periodic interval hasn't fired yet at 10s, it fires at 300s)
        expect(context.reindexByChange).not.toHaveBeenCalled();
    });

    it('should disable periodic sync when SYNC_INTERVAL_MS=0', () => {
        mockEnvGet.mockImplementation((name: string) => {
            if (name === 'SYNC_INTERVAL_MS') return '0';
            return undefined;
        });

        const context = createMockContext();
        const snapshot = createMockSnapshotManager([]);
        const sync = new SyncManager(context, snapshot);

        sync.startBackgroundSync();

        // Should only have setTimeout (initial), no setInterval
        // Only 1 timer (the initial setTimeout)
        expect(jest.getTimerCount()).toBe(1);
    });

    it('should use custom interval from SYNC_INTERVAL_MS', () => {
        mockEnvGet.mockImplementation((name: string) => {
            if (name === 'SYNC_INITIAL_DELAY_MS') return '0'; // disable initial
            if (name === 'SYNC_INTERVAL_MS') return '10000'; // 10s
            return undefined;
        });

        const context = createMockContext();
        const snapshot = createMockSnapshotManager(['/project']);
        const sync = new SyncManager(context, snapshot);

        mockExistsSync.mockReturnValue(true);

        sync.startBackgroundSync();

        // Advance 10s - should trigger periodic sync
        jest.advanceTimersByTime(10000);

        // The periodic interval should have fired (handleSyncIndex is called)
        expect(snapshot.getIndexedCodebases).toHaveBeenCalled();
    });

    it('should execute initial sync when timer fires', async () => {
        const context = createMockContext();
        const snapshot = createMockSnapshotManager(['/project']);
        const sync = new SyncManager(context, snapshot);

        mockExistsSync.mockReturnValue(true);

        sync.startBackgroundSync();

        // Advance past the 5s initial delay
        jest.advanceTimersByTime(5000);

        // Allow the async handleSyncIndex to resolve
        await jest.advanceTimersByTimeAsync(0);

        expect(context.reindexByChange).toHaveBeenCalledWith('/project');
    });
});
