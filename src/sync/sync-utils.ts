import { consoleError, consoleLog } from "@/logging";
import { getFileBlob, moveDocs, putFile, readDir, removeFile, removeIndexes, upsertIndexes } from "../api";
import { INSTANCE_ID_FILE, Remote, StorageItem, SYNC_CONFIG_DIR, SYNC_LOGS_DIR } from "@/sync";

export class SyncUtils {
    /**
     * Recursively retrieves all files in a directory.
     * @param path The base path to start searching from.
     * @param remote The remote information containing URL and key.
     * @param skipSymlinks Whether to skip symbolic links.
     * @param excludedItems Array of file/directory names to exclude from sync.
     * @returns A StorageItem representing the directory and its contents, or null if not found.
     */
    static async getDirFilesRecursively(
        path: string,
        remote: Remote,
        skipSymlinks: boolean = true,
        excludedItems: string[] = []
    ): Promise<StorageItem> {
        let storageItem: StorageItem = new StorageItem(path);

        const dirResponse = await readDir(path, remote.url, SyncUtils.getHeaders(remote.key));

        if (!dirResponse) {
            consoleLog("No files found or invalid response for path:", path);
            return storageItem;
        }

        const dir = dirResponse
            .filter(file => !(skipSymlinks && file.isSymlink))
            .filter(file => !excludedItems.includes(file.name));

        if (!dir || dir.length === 0) {
            consoleLog("No files found or invalid response for path:", path);
            return storageItem;
        }

        // Add current level files to the map
        dir.forEach(file => {
            storageItem.addFileFromItem(file);
        });

        // Collect all promises for subdirectories
        const promises = dir
            .filter(file => file.isDir)
            .map(file => SyncUtils.getDirFilesRecursively(`${path}/${file.name}`, remote, skipSymlinks, excludedItems));

        // Wait for all promises to resolve
        const results = await Promise.all(promises);

        // Collect all items into their respective parents
        results.forEach(item => {
            storageItem.files.find(dirItem => dirItem.path === item.path)?.files.push(...item.files);
        });

        return storageItem;
    }

    /**
     * Delete a file or directory with error handling and logging.
     * @param filePath The path of the file or directory to delete.
     * @param remote The remote information containing URL and key.
     */
    static async deleteFile(
        filePath: string,
        remote: Remote
    ) {
        try {
            consoleLog(`Deleting ${filePath} from remote ${remote.name}`);
            await removeFile(filePath, remote.url, SyncUtils.getHeaders(remote.key));
            await removeIndexes([filePath.replace("data/", "")], remote.url, SyncUtils.getHeaders(remote.key));
        } catch (error) {
            consoleError(`Error deleting file ${filePath}:`, error);
        }
    }

    static async putFile(
        filePath: string,
        file: File,
        url: string = "",
        key: string = "",
        timestamp?: number
    ): Promise<boolean> {
        try {
            await putFile(filePath, false, file, url, SyncUtils.getHeaders(key), timestamp);
            await upsertIndexes([filePath.replace("data/", "")], url, SyncUtils.getHeaders(key));
            consoleLog(`File ${file.name} (${filePath}) with timestamp ${timestamp} synced successfully.`);
            return true;
        } catch (error) {
            consoleError(`Error putting file ${filePath} to ${url}:`, error);
            return false;
        }
    }

    static async moveDocs(
        path: string,
        toPath: string,
        remote: Remote
    ) {
        const matchPath = path.match(/^data\/([^\/]+)\/(.+)$/);
        if (!matchPath) {
            consoleError(`Error moving directory ${path} to ${toPath}: Invalid path format.`);
            return;
        }
        const docPath = matchPath[2].endsWith('.sy') ? `/${matchPath[2]}` : `/${matchPath[2]}.sy`;

        const matchToPath = toPath.match(/^data\/([^\/]+)\/(.+)$/);
        if (!matchToPath) {
            consoleError(`Error moving directory ${path} to ${toPath}: Invalid path format.`);
            return;
        }
        const notebookIdTo = matchToPath[1];
        const docPathTo = matchToPath[2].endsWith('.sy') ? `/${matchToPath[2]}` : `/${matchToPath[2]}.sy`;

        consoleLog(`Moving directory ${path} to ${toPath} on remote ${remote.name}`);

        try {
            await moveDocs([docPath], notebookIdTo, docPathTo, remote.url, SyncUtils.getHeaders(remote.key));
        } catch (error) {
            consoleError(`Error moving directory ${path} to ${toPath}:`, error);
        }
    }

    /**
     * Validate and check the remotes array
     */
    static checkRemotes(remotes: [Remote, Remote]) {
        if (!remotes || !Array.isArray(remotes))
            throw new Error("remotes is not properly initialized");

        if (remotes.length !== 2)
            throw new Error(`Expected remotes to have exactly 2 entries, but found ${remotes.length}`);

        for (let i = 0; i < remotes.length; i++) {
            if ((!remotes[i].url && i != 0) || !remotes[i].key)
                throw new Error(`Siyuan URL or API Key is not set for entry ${i + 1}.`);
        }
    }

    /**
     * Generate headers for API requests
     * @param key The API key to use for authentication.
     * @returns An object containing the Authorization header.
     */
    static getHeaders(key: string = null): Record<string, string> {
        if (!key || key.trim() === "SKIP") return {}

        return { "Authorization": `Token ${key}` }
    }

    /**
     * Get the instance ID from the instance-id file.
     *
     * @param remote The remote information containing URL and key.
     * @returns The instance ID as a string, or an empty string if not found.
     */
    static async getInstanceId(
        remote: Remote
    ): Promise<string> {
        const path = `${SYNC_CONFIG_DIR}${INSTANCE_ID_FILE}`;
        const blob = await getFileBlob(path, remote.url, SyncUtils.getHeaders(remote.key));
        return blob ? await blob.text() : "";
    }

    /**
     * Set the instance ID in the instance-id file.
     *
     * @param remote The remote information containing URL and key.
     * @param instanceId The instance ID to set.
     */
    static async setInstanceId(
        instanceId: string,
        remote: Remote
    ): Promise<void> {
        const path = `${SYNC_CONFIG_DIR}${INSTANCE_ID_FILE}`;
        const file = new File([instanceId], INSTANCE_ID_FILE, { lastModified: Date.now() });
        await SyncUtils.putFile(path, file, remote.url, remote.key);
    }

    /**
     * Generate a new instance ID.
     *
     * @returns A new instance ID string.
     */
    static generateInstanceId(): string {
        return crypto.randomUUID();
    }

    /**
     * Get a file's timestamp.
     *
     * @param parent The parent directory of the file to check.
     * @param fileName The name of the file to check.
     * @param remote The remote information containing URL and key.
     * @returns The timestamp of the file, or 0 if not found.
     */
    static async getFileTimestamp(parent: string, fileName: string, remote: Remote): Promise<number> {
        const dir = await readDir(parent, remote.url, SyncUtils.getHeaders(remote.key));
        const file = dir.find(file => file.name === fileName);

        return file ? file.updated * 1000 : 0;
    }

    /**
     * Write the sync log to a file on the remote
     *
     * @param remote The remote information containing URL and key.
     */
    static async writeSyncLog(content: string, remote: Remote, timestamp: number = Date.now()): Promise<void> {
        const logFilePath = `${SYNC_LOGS_DIR}${timestamp}.log`;

        const file = new File([content], logFilePath, { lastModified: timestamp });
        await SyncUtils.putFile(logFilePath, file, remote.url, remote.key, timestamp);

        // Cleanup old log files after writing
        await SyncUtils.cleanupOldLogs(remote);
    }

    /**
     * Get a list of all sync log files, in descending order by timestamp
     *
     * @param remote The remote information containing URL and key.
     * @returns An array of log file names.
     */
    static async getAllSyncLogFiles(remote: Remote): Promise<IResReadDir[]> {
        const logFiles = await readDir(SYNC_LOGS_DIR, remote.url, SyncUtils.getHeaders(remote.key));

        if (!logFiles || logFiles.length === 0) return [];

        const logFilesOnly = logFiles.filter(file => !file.isDir && file.name.endsWith('.log'));

        // Sort by updated timestamp in descending order
        logFilesOnly.sort((a, b) => b.updated - a.updated);

        return logFilesOnly;
    }

    /**
     * Clean up old log files, keeping only the 10 most recent ones
     *
     * @param remote The remote information containing URL and key.
     */
    static async cleanupOldLogs(remote: Remote) {
        const logFiles = await SyncUtils.getAllSyncLogFiles(remote);

        if (!logFiles || logFiles.length <= 10) return;

        const filesToDelete = logFiles.slice(10);

        for (const file of filesToDelete) {
            const filePath = `${SYNC_LOGS_DIR}${file.name}`;
            await removeFile(filePath, remote.url, SyncUtils.getHeaders(remote.key));
        }

        consoleLog(`Cleaned up ${filesToDelete.length} old log files, keeping the 10 most recent`);
    }

    /**
     * Get the newest sync log contents
     *
     * @param remote The remote information containing URL and key.
     * @returns The contents of the newest sync log file as a string, or null if none found.
     */
    static async getNewestSyncLog(remote: Remote): Promise<string | null> {
        const logFiles = await SyncUtils.getAllSyncLogFiles(remote);

        if (!logFiles || logFiles.length === 0) return null;

        const path = `${SYNC_LOGS_DIR}/${logFiles[0].name}`;
        const blob = await getFileBlob(path, remote.url, SyncUtils.getHeaders(remote.key));
        return blob ? await blob.text() : null;
    }

    /**
     * Compare parent directory timestamps when two remotes have files with
     * the same timestamp but different paths.
     * Iterates up the directory tree until different timestamps are found.
     *
     * @param remotes An array of exactly two Remote objects with file info.
     * @returns An object with inputIndex (source) and outputIndex (destination),
     *          or null if timestamps are equal at all levels (should skip).
     */
    static async compareParentDirectoryTimestamps(
        remotes: [Remote, Remote]
    ): Promise<{
        inputIndex: number;
        outputIndex: number;
    } | null> {
        let currentPaths = [
            remotes[0].file?.parentPath,
            remotes[1].file?.parentPath
        ];

        while (currentPaths[0] && currentPaths[1] && currentPaths[0].length > 0 && currentPaths[1].length > 0) {
            const parentDirNames = currentPaths.map(path => path.split('/').pop());
            const grandparentPaths = currentPaths.map((path, i) => path.replace(parentDirNames[i], ''));

            const dirs = await Promise.all(
                remotes.map((remote, i) =>
                    readDir(grandparentPaths[i], remote.url, SyncUtils.getHeaders(remote.key))
                )
            );

            const dirFiles = dirs.map((dir, i) => dir?.find(it => it.name === parentDirNames[i]));

            if (!dirFiles[0] || !dirFiles[1]) {
                consoleLog(`Parent directory not found in either remote.`);
                return null;
            }

            const updated = dirFiles.map(file => file.updated * 1000);

            if (updated[0] !== updated[1]) {
                const inputIndex = updated[0] > updated[1] ? 0 : 1;
                return {
                    inputIndex,
                    outputIndex: inputIndex === 0 ? 1 : 0
                };
            }

            currentPaths = grandparentPaths;
            consoleLog(`Parent directories have the same timestamp, checking grandparent...`);
        }

        consoleLog(`Reached root with same timestamps, skipping.`);
        return null;
    }

    /**
     * Get the newest sync log File object
     *
     * @param remote The remote information containing URL and key.
     * @returns The File object of the newest sync log file, or null if none found.
     */
    static async getNewestSyncLogFile(remote: Remote = Remote.default()): Promise<File | null> {
        const logFiles = await SyncUtils.getAllSyncLogFiles(remote);

        if (!logFiles || logFiles.length === 0) return null;

        const path = `${SYNC_LOGS_DIR}/${logFiles[0].name}`;
        const blob = await getFileBlob(path, remote.url, SyncUtils.getHeaders(remote.key));
        return blob ? new File([blob], logFiles[0].name, { lastModified: logFiles[0].updated * 1000 }) : null;
    }
}
