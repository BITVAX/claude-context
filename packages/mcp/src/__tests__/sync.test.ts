import { jest } from '@jest/globals';

// --- Mock fs and @zilliz/claude-context-core before importing SyncManager ---

const mockExistsSync = jest.fn<(path: string) => boolean>();
const mockDeleteSnapshot = jest.fn<(path: string) => Promise<void>>();

jest.unstable_mockModule('fs', () => ({
    existsSync: mockExistsSync,
    default: { existsSync: mockExistsSync },
}));

jest.unstable_mockModule('@zilliz/claude-context-core', () => ({
    FileSynchronizer: {
        deleteSnapshot: mockDeleteSnapshot,
    },
}));

const { SyncManager } = await import('../sync.js');

beforeEach(() => {
    jest.clearAllMocks();
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

describe('handleSyncIndex', () => {
    it('should skip sync when no codebases are indexed', async () => {
        const context = createMockContext();
        const snapshot = createMockSnapshotManager([]);
        const sync = new SyncManager(context, snapshot);

        await sync.handleSyncIndex();

        expect(context.reindexByChange).not.toHaveBeenCalled();
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

        // Should not throw
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
        // Make reindexByChange slow
        context.reindexByChange.mockImplementation(() =>
            new Promise(resolve => setTimeout(resolve, 100, { added: 0, removed: 0, modified: 0 }))
        );
        const snapshot = createMockSnapshotManager(['/project']);
        const sync = new SyncManager(context, snapshot);

        mockExistsSync.mockReturnValue(true);

        // Start two concurrent syncs
        const first = sync.handleSyncIndex();
        const second = sync.handleSyncIndex();

        await Promise.all([first, second]);

        // Only one should have actually called reindexByChange
        expect(context.reindexByChange).toHaveBeenCalledTimes(1);
    });

    it('should reset isSyncing flag even when an error occurs', async () => {
        const context = createMockContext();
        context.reindexByChange.mockRejectedValue(new Error('Unexpected'));
        const snapshot = createMockSnapshotManager(['/project']);
        const sync = new SyncManager(context, snapshot);

        mockExistsSync.mockReturnValue(true);

        await sync.handleSyncIndex();

        // Should be able to sync again (isSyncing reset)
        context.reindexByChange.mockResolvedValue({ added: 0, removed: 0, modified: 0 });
        await sync.handleSyncIndex();

        expect(context.reindexByChange).toHaveBeenCalledTimes(2);
    });

    it('should accumulate stats across multiple codebases', async () => {
        const context = createMockContext();
        context.reindexByChange
            .mockResolvedValueOnce({ added: 5, removed: 1, modified: 3 })
            .mockResolvedValueOnce({ added: 2, removed: 0, modified: 1 });
        const snapshot = createMockSnapshotManager(['/a', '/b']);
        const sync = new SyncManager(context, snapshot);

        mockExistsSync.mockReturnValue(true);

        await sync.handleSyncIndex();

        // Verify total stats are logged (Added: 7, Removed: 1, Modified: 4)
        const logCalls = (console.log as jest.MockedFunction<typeof console.log>).mock.calls;
        const totalStatsLog = logCalls.find(
            call => typeof call[0] === 'string' && call[0].includes('Total changes')
        );
        expect(totalStatsLog).toBeDefined();
        expect(totalStatsLog![0]).toContain('Added: 7');
        expect(totalStatsLog![0]).toContain('Removed: 1');
        expect(totalStatsLog![0]).toContain('Modified: 4');
    });
});

describe('startBackgroundSync', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('should schedule initial sync after 5 seconds', () => {
        const context = createMockContext();
        const snapshot = createMockSnapshotManager([]);
        const sync = new SyncManager(context, snapshot);

        sync.startBackgroundSync();

        // Timer should be pending
        expect(jest.getTimerCount()).toBeGreaterThanOrEqual(1);
    });

    it('should set up periodic sync every 5 minutes', () => {
        const context = createMockContext();
        const snapshot = createMockSnapshotManager([]);
        const sync = new SyncManager(context, snapshot);

        sync.startBackgroundSync();

        // Should have at least setTimeout + setInterval
        expect(jest.getTimerCount()).toBeGreaterThanOrEqual(2);
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
