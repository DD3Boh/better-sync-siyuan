import { getFileBlob, readDir } from "@/api";
import { consoleError, consoleLog, consoleWarn } from "@/logging";
import { Remote, SYNC_CONFIG_DIR, SYNC_HISTORY_FILE, SyncUtils } from "@/sync";

export class SyncHistory {
    /**
     * Load sync history from disk for a specific remote.
     * The sync history stores when this remote last synced with other remotes.
     *
     * @param remote The remote information containing URL and key.
     * @returns A Map of remote URLs to their last sync timestamps.
     */
    static async loadSyncHistory(remote: Remote): Promise<Map<string, number>> {
        try {
            const dir = await readDir(SYNC_CONFIG_DIR, remote.url, SyncUtils.getHeaders(remote.key));

            if (!dir || dir.length === 0) {
                consoleLog(`No sync directory found for ${remote.name}`);
                return new Map();
            }

            const historyFile = dir.find(file => file.name === SYNC_HISTORY_FILE);
            if (!historyFile) {
                consoleLog(`No sync history file found for ${remote.name}`);
                return new Map();
            }

            // Fetch the file content
            const path = `${SYNC_CONFIG_DIR}${SYNC_HISTORY_FILE}`;
            const blob = await getFileBlob(path, remote.url, SyncUtils.getHeaders(remote.key));

            if (!blob) {
                consoleWarn(`Failed to fetch sync history for ${remote.name}`);
                return new Map();
            }

            const text = await blob.text();
            const historyData = JSON.parse(text);

            // Convert plain object to Map
            return new Map(Object.entries(historyData));
        } catch (error) {
            consoleError(`Error loading sync history for ${remote.name}:`, error);
            return new Map();
        }
    }

    /**
     * Save sync history to disk for a specific remote.
     *
     * @param remote The remote information containing URL and key.
     * @param syncHistory A Map of remote instance ids to their last sync timestamps.
     */
    static async saveSyncHistory(remote: Remote, syncHistory: Map<string, number>): Promise<void> {
        try {
            const path = `${SYNC_CONFIG_DIR}${SYNC_HISTORY_FILE}`;

            // Convert Map to plain object for JSON serialization
            const historyObj: Record<string, number> = {};
            syncHistory.forEach((timestamp, instanceId) => {
                historyObj[instanceId] = timestamp;
            });

            const jsonContent = JSON.stringify(historyObj, null, 2);
            const file = new File([jsonContent], SYNC_HISTORY_FILE, { lastModified: Date.now() });

            await SyncUtils.putFile(path, file, remote.url, remote.key);
            consoleLog(`Saved sync history for ${remote.name}`);
        } catch (error) {
            consoleError(`Error saving sync history for ${remote.name}:`, error);
        }
    }

    /**
     * Update sync history to record that we synced with a specific remote.
     *
     * @param remotes The pair of remotes involved in the sync.
     * @param timestamp The timestamp of the sync.
     */
    static async updateSyncHistories(
        remotes: [Remote, Remote]
    ): Promise<void> {
        await Promise.allSettled([
            SyncHistory.saveSyncHistory(remotes[0], remotes[0].syncHistory),
            SyncHistory.saveSyncHistory(remotes[1], remotes[1].syncHistory)
        ]);
    }

    /**
     * Get the last time a remote synced with another specific remote.
     *
     * @param remote The remote whose history we're checking.
     * @param instanceId The instance ID of the other remote.
     * @returns The last sync timestamp, or 0 if never synced.
     */
    static getLastSyncWithRemote(remote: Remote, instanceId: string): number {
        if (!remote.syncHistory)
            return 0;

        return remote.syncHistory.get(instanceId) || 0;
    }

    /**
     * Get the most recent sync time across all remotes in the history.
     *
     * @param remote The remote whose history we're checking.
     * @returns The most recent sync timestamp, or 0 if no syncs recorded.
     */
    static getMostRecentSyncTime(remote: Remote): number {
        if (!remote.syncHistory || remote.syncHistory.size === 0)
            return 0;

        return Math.max(...Array.from(remote.syncHistory.values()));
    }
}
