import { putFile, readDir, removeFile, removeIndexes, upsertIndexes } from "../api";

export class SyncUtils {
    /**
     * Recursively retrieves all files in a directory.
     * @param path The base path to start searching from.
     * @param dirName The name of the directory to search within.
     * @param url The URL to use for API requests.
     * @param key The API key to use for authentication.
     * @param skipSymlinks Whether to skip symbolic links.
     * @param excludedItems Array of file/directory names to exclude from sync.
     * @returns A map of file paths to their metadata.
     */
    static async getDirFilesRecursively(
        path: string,
        dirName: string,
        url: string = "",
        key: string = "",
        skipSymlinks: boolean = true,
        excludedItems: string[] = []
    ): Promise<Map<string, IResReadDir>> {
        const filesMap = new Map<string, IResReadDir>();

        const fullPath = `${path}/${dirName}`;

        // Read the path itself and add it to the map
        const mainDirResponse = await readDir(path, url, SyncUtils.getHeaders(key));

        // Retrieve the main directory only
        if (!mainDirResponse || !Array.isArray(mainDirResponse)) {
            console.log(`No files found or invalid response for path ${path}:`, mainDirResponse);
            return filesMap;
        }

        const mainDir = mainDirResponse.find(file => file.name === dirName);
        if (!mainDir) {
            console.log(`Directory ${dirName} not found in path ${path}`);
            return filesMap;
        }
        filesMap.set(`${path}/${mainDir.name}`, mainDir);

        const dirResponse = await readDir(fullPath, url, SyncUtils.getHeaders(key));

        if (!dirResponse || !Array.isArray(dirResponse)) {
            console.log(`No files found or invalid response for path ${fullPath}:`, dirResponse);
            return filesMap;
        }

        const dir = dirResponse
            .filter(file => !(skipSymlinks && file.isSymlink))
            .filter(file => !excludedItems.includes(file.name));

        if (!dir || dir.length === 0) {
            console.log("No files found or invalid response:", dir);
            return filesMap;
        }

        // Add current level files to the map
        dir.forEach(file => {
            filesMap.set(`${fullPath}/${file.name}`, file);
        });

        // Collect all promises for subdirectories
        const promises = dir
            .filter(file => file.isDir)
            .map(file => SyncUtils.getDirFilesRecursively(fullPath, file.name, url, key, skipSymlinks, excludedItems));

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
     * @param fileRes The file metadata from the directory listing.
     * @param url The URL to use for API requests.
     * @param key The API key to use for authentication.
     */
    static async deleteFile(
        filePath: string,
        fileRes: IResReadDir,
        url: string = "",
        key: string = ""
    ) {
        try {
            console.log(`Deleting ${fileRes.isDir ? 'directory' : 'file'} ${fileRes.name} (${filePath})`);
            removeFile(filePath, url, SyncUtils.getHeaders(key));
            removeIndexes([filePath.replace("data/", "")], url, SyncUtils.getHeaders(key));
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
    static checkRemotes(remotes: [RemoteInfo, RemoteInfo]) {
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
     * @param url The URL to use for API requests.
     * @param key The API key to use for authentication.
     * @returns The last sync time as a timestamp, or 0 if not found.
     */
    static async getLastSyncTime(url: string = "", key: string = null): Promise<number> {
        let dir = await readDir(`/data/.siyuan/sync/`, url, SyncUtils.getHeaders(key));

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
    static async setSyncStatus(remotes: [RemoteInfo, RemoteInfo]): Promise<void> {
        let filePath = `/data/.siyuan/sync/status`;
        let file = new File([], "status");

        SyncUtils.checkRemotes(remotes);
        SyncUtils.putFile(filePath, file, remotes[0].url, remotes[0].key);
        SyncUtils.putFile(filePath, file, remotes[1].url, remotes[1].key);
    }
}
