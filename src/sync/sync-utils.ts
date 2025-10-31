import { consoleError, consoleLog } from "@/logging";
import { getFileBlob, putFile, readDir, removeFile, removeIndexes, upsertIndexes } from "../api";
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
    }
}
