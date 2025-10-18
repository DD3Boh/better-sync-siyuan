import { getFileBlob, putFile, readDir, removeFile, removeIndexes, upsertIndexes } from "../api";
import { Remote } from "@/sync";

export class SyncUtils {
    /**
     * Recursively retrieves all files in a directory.
     * @param path The base path to start searching from.
     * @param remote The remote information containing URL and key.
     * @param skipSymlinks Whether to skip symbolic links.
     * @param excludedItems Array of file/directory names to exclude from sync.
     * @returns A map of file paths to their metadata.
     */
    static async getDirFilesRecursively(
        path: string,
        remote: Remote,
        skipSymlinks: boolean = true,
        excludedItems: string[] = []
    ): Promise<Map<string, IResReadDir>> {
        const filesMap = new Map<string, IResReadDir>();

        const dirResponse = await readDir(path, remote.url, SyncUtils.getHeaders(remote.key));

        if (!dirResponse) {
            console.log("No files found or invalid response for path:", path);
            return filesMap;
        }

        const dir = dirResponse
            .filter(file => !(skipSymlinks && file.isSymlink))
            .filter(file => !excludedItems.includes(file.name));

        if (!dir || dir.length === 0) {
            console.log("No files found or invalid response for path:", path);
            return filesMap;
        }

        // Add current level files to the map
        dir.forEach(file => {
            filesMap.set(`${path}/${file.name}`, file);
        });

        // Collect all promises for subdirectories
        const promises = dir
            .filter(file => file.isDir)
            .map(file => SyncUtils.getDirFilesRecursively(`${path}/${file.name}`, remote, skipSymlinks, excludedItems));

        // Wait for all promises to resolve
        const results = await Promise.all(promises);

        // Merge all result maps into the main map
        results.forEach(resultMap => {
            for (const [filePath, file] of resultMap.entries()) {
                filesMap.set(filePath, file);
            }
        });

        return filesMap;
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
            console.log(`Deleting ${filePath} from remote ${remote.name}`);
            await removeFile(filePath, remote.url, SyncUtils.getHeaders(remote.key));
            await removeIndexes([filePath.replace("data/", "")], remote.url, SyncUtils.getHeaders(remote.key));
        } catch (error) {
            console.error(`Error deleting file ${filePath}:`, error);
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
            console.log(`File ${file.name} (${filePath}) with timestamp ${timestamp} synced successfully.`);
            return true;
        } catch (error) {
            console.error(`Error putting file ${filePath} to ${url}:`, error);
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
     * Get the last sync time from the status file.
     * @param remote The remote information containing URL and key.
     * @returns The last sync time as a timestamp, or 0 if not found.
     */
    static async getLastSyncTime(remote: Remote = Remote.default()): Promise<number> {
        let dir = await readDir(`/data/.siyuan/sync/`, remote.url, SyncUtils.getHeaders(remote.key));

        if (!dir || dir.length === 0) {
            console.log("No sync directory found.");
            return 0;
        }

        let file = dir.find(file => file.name === "status");
        if (!file) {
            console.log("No status file found.");
            return 0;
        }

        return file.updated;
    }

    /**
     * Set the sync status file with the provided remotes or URL-to-key mapping.
     */
    static async setSyncStatus(
        remotes: [Remote, Remote],
        timestamp: number = Date.now()
    ): Promise<void> {
        let filePath = `/data/.siyuan/sync/status`;
        let file = new File([], "status", { lastModified: timestamp });

        SyncUtils.checkRemotes(remotes);
        await SyncUtils.putFile(filePath, file, remotes[0].url, remotes[0].key, timestamp);
        await SyncUtils.putFile(filePath, file, remotes[1].url, remotes[1].key, timestamp);
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
        const blob = await getFileBlob("/data/.siyuan/sync/instance-id", remote.url, SyncUtils.getHeaders(remote.key));
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
        const filePath = "/data/.siyuan/sync/instance-id";
        const file = new File([instanceId], "instance-id", { lastModified: Date.now() });
        await SyncUtils.putFile(filePath, file, remote.url, remote.key);
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
}
