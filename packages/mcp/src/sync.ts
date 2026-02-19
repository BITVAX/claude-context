import * as fs from "fs";
import { Context, FileSynchronizer, envManager } from "@zilliz/claude-context-core";
import { SnapshotManager } from "./snapshot.js";

const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_INITIAL_SYNC_DELAY_MS = 5000; // 5 seconds

export class SyncManager {
    private context: Context;
    private snapshotManager: SnapshotManager;
    private isSyncing: boolean = false;

    constructor(context: Context, snapshotManager: SnapshotManager) {
        this.context = context;
        this.snapshotManager = snapshotManager;
    }

    public getIsSyncing(): boolean {
        return this.isSyncing;
    }

    public async handleSyncIndex(): Promise<{ added: number; removed: number; modified: number }> {
        const syncStartTime = Date.now();
        console.log(`[SYNC-DEBUG] handleSyncIndex() called at ${new Date().toISOString()}`);

        const indexedCodebases = this.snapshotManager.getIndexedCodebases();
        const emptyStats = { added: 0, removed: 0, modified: 0 };

        if (indexedCodebases.length === 0) {
            console.log('[SYNC-DEBUG] No codebases indexed. Skipping sync.');
            return emptyStats;
        }

        console.log(`[SYNC-DEBUG] Found ${indexedCodebases.length} indexed codebases:`, indexedCodebases);

        if (this.isSyncing) {
            console.log('[SYNC-DEBUG] Index sync already in progress. Skipping.');
            return emptyStats;
        }

        this.isSyncing = true;
        console.log(`[SYNC-DEBUG] Starting index sync for all ${indexedCodebases.length} codebases...`);

        try {
            let totalStats = { added: 0, removed: 0, modified: 0 };

            for (let i = 0; i < indexedCodebases.length; i++) {
                const codebasePath = indexedCodebases[i];
                const codebaseStartTime = Date.now();

                console.log(`[SYNC-DEBUG] [${i + 1}/${indexedCodebases.length}] Starting sync for codebase: '${codebasePath}'`);

                // Check if codebase path still exists
                try {
                    const pathExists = fs.existsSync(codebasePath);
                    console.log(`[SYNC-DEBUG] Codebase path exists: ${pathExists}`);

                    if (!pathExists) {
                        console.warn(`[SYNC-DEBUG] Codebase path '${codebasePath}' no longer exists. Skipping sync.`);
                        continue;
                    }
                } catch (pathError: any) {
                    console.error(`[SYNC-DEBUG] Error checking codebase path '${codebasePath}':`, pathError);
                    continue;
                }

                try {
                    console.log(`[SYNC-DEBUG] Calling context.reindexByChange() for '${codebasePath}'`);
                    const stats = await this.context.reindexByChange(codebasePath);
                    const codebaseElapsed = Date.now() - codebaseStartTime;

                    console.log(`[SYNC-DEBUG] Reindex stats for '${codebasePath}':`, stats);
                    console.log(`[SYNC-DEBUG] Codebase sync completed in ${codebaseElapsed}ms`);

                    // Accumulate total stats
                    totalStats.added += stats.added;
                    totalStats.removed += stats.removed;
                    totalStats.modified += stats.modified;

                    if (stats.added > 0 || stats.removed > 0 || stats.modified > 0) {
                        console.log(`[SYNC] Sync complete for '${codebasePath}'. Added: ${stats.added}, Removed: ${stats.removed}, Modified: ${stats.modified} (${codebaseElapsed}ms)`);
                    } else {
                        console.log(`[SYNC] No changes detected for '${codebasePath}' (${codebaseElapsed}ms)`);
                    }
                } catch (error: any) {
                    const codebaseElapsed = Date.now() - codebaseStartTime;
                    console.error(`[SYNC-DEBUG] Error syncing codebase '${codebasePath}' after ${codebaseElapsed}ms:`, error);
                    console.error(`[SYNC-DEBUG] Error stack:`, error.stack);

                    if (error.message.includes('Failed to query Milvus')) {
                        // Collection maybe deleted manually, delete the snapshot file
                        await FileSynchronizer.deleteSnapshot(codebasePath);
                    }

                    // Log additional error details
                    if (error.code) {
                        console.error(`[SYNC-DEBUG] Error code: ${error.code}`);
                    }
                    if (error.errno) {
                        console.error(`[SYNC-DEBUG] Error errno: ${error.errno}`);
                    }

                    // Continue with next codebase even if one fails
                }
            }

            const totalElapsed = Date.now() - syncStartTime;
            console.log(`[SYNC-DEBUG] Total sync stats across all codebases: Added: ${totalStats.added}, Removed: ${totalStats.removed}, Modified: ${totalStats.modified}`);
            console.log(`[SYNC-DEBUG] Index sync completed for all codebases in ${totalElapsed}ms`);
            console.log(`[SYNC] Index sync completed for all codebases. Total changes - Added: ${totalStats.added}, Removed: ${totalStats.removed}, Modified: ${totalStats.modified}`);
            return totalStats;
        } catch (error: any) {
            const totalElapsed = Date.now() - syncStartTime;
            console.error(`[SYNC-DEBUG] Error during index sync after ${totalElapsed}ms:`, error);
            console.error(`[SYNC-DEBUG] Error stack:`, error.stack);
            return emptyStats;
        } finally {
            this.isSyncing = false;
            const totalElapsed = Date.now() - syncStartTime;
            console.log(`[SYNC-DEBUG] handleSyncIndex() finished at ${new Date().toISOString()}, total duration: ${totalElapsed}ms`);
        }
    }

    public async syncSingleCodebase(codebasePath: string): Promise<{ added: number; removed: number; modified: number }> {
        if (this.isSyncing) {
            console.log('[SYNC] Sync already in progress. Skipping.');
            throw new Error('Sync already in progress');
        }

        const indexedCodebases = this.snapshotManager.getIndexedCodebases();
        if (!indexedCodebases.includes(codebasePath)) {
            throw new Error(`Codebase '${codebasePath}' is not indexed`);
        }

        if (!fs.existsSync(codebasePath)) {
            throw new Error(`Path '${codebasePath}' does not exist`);
        }

        this.isSyncing = true;
        const startTime = Date.now();

        try {
            console.log(`[SYNC] Manual sync for '${codebasePath}'`);
            const stats = await this.context.reindexByChange(codebasePath);
            const elapsed = Date.now() - startTime;
            console.log(`[SYNC] Sync complete for '${codebasePath}'. Added: ${stats.added}, Removed: ${stats.removed}, Modified: ${stats.modified} (${elapsed}ms)`);
            return stats;
        } catch (error: any) {
            const elapsed = Date.now() - startTime;
            console.error(`[SYNC] Error syncing '${codebasePath}' after ${elapsed}ms:`, error.message);

            if (error.message.includes('Failed to query Milvus')) {
                await FileSynchronizer.deleteSnapshot(codebasePath);
            }

            throw error;
        } finally {
            this.isSyncing = false;
        }
    }

    public startBackgroundSync(): void {
        console.log('[SYNC-DEBUG] startBackgroundSync() called');

        const rawInitialDelay = envManager.get('SYNC_INITIAL_DELAY_MS');
        const rawSyncInterval = envManager.get('SYNC_INTERVAL_MS');

        const initialDelay = parseInt(rawInitialDelay || '') || DEFAULT_INITIAL_SYNC_DELAY_MS;
        const syncIntervalMs = parseInt(rawSyncInterval || '') || DEFAULT_SYNC_INTERVAL_MS;

        // SYNC_INITIAL_DELAY_MS=0 disables initial sync
        if (rawInitialDelay === '0') {
            console.log('[SYNC] Initial sync disabled (SYNC_INITIAL_DELAY_MS=0)');
        } else {
            console.log(`[SYNC-DEBUG] Scheduling initial sync in ${initialDelay}ms...`);
            setTimeout(async () => {
                console.log('[SYNC-DEBUG] Executing initial sync after server startup');
                try {
                    await this.handleSyncIndex();
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    if (errorMessage.includes('Failed to query collection')) {
                        console.log('[SYNC-DEBUG] Collection not yet established, this is expected for new cluster users. Will retry on next sync cycle.');
                    } else {
                        console.error('[SYNC-DEBUG] Initial sync failed with unexpected error:', error);
                        throw error;
                    }
                }
            }, initialDelay);
        }

        // SYNC_INTERVAL_MS=0 disables periodic sync
        if (rawSyncInterval === '0') {
            console.log('[SYNC] Periodic sync disabled (SYNC_INTERVAL_MS=0)');
        } else {
            console.log(`[SYNC-DEBUG] Setting up periodic sync every ${syncIntervalMs}ms (${Math.round(syncIntervalMs / 1000)}s)`);
            const syncInterval = setInterval(() => {
                console.log('[SYNC-DEBUG] Executing scheduled periodic sync');
                this.handleSyncIndex();
            }, syncIntervalMs);
            console.log('[SYNC-DEBUG] Background sync setup complete. Interval ID:', syncInterval);
        }
    }
} 