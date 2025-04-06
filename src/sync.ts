import { Plugin } from "siyuan";
import { getFileBlob, getNotebookInfo, listDocsByPath, lsNotebooks, putFile } from "./api";

export class SyncManager {
    private plugin: Plugin;
    private localWorkspaceDir: string;
    private urlToKeyPairs: [string, string][];

    constructor(plugin: Plugin, workspaceDir: string, urlToKeyPairs: [string, string][] = []) {
        this.plugin = plugin;
        this.localWorkspaceDir = workspaceDir;
        this.urlToKeyPairs = urlToKeyPairs;
    }

    async getNotebooks(url: string, key: string): Promise<Notebook[]> {
        let notebooks = await lsNotebooks(url, this.getHeaders(key))

        return notebooks.notebooks;
    }

    async getNotebookInfo(notebookId: string, url: string, key: string): Promise<NotebookInfo> {
        return getNotebookInfo(notebookId, url, this.getHeaders(key))
    }

    async getDocsRecursively(notebookId: string, path: string, url: string = "", key: string = ""): Promise<Map<string, DocumentFiles>> {
        let docs = await listDocsByPath(notebookId, path, url, this.getHeaders(key))
        let filesMap = new Map<string, DocumentFiles>();

        if (!docs || !docs.files) {
            console.log("No files found or invalid response:", docs);
            return filesMap;
        }

        // Add current level files to the map
        docs.files.forEach(file => {
            filesMap.set(file.id, file);
        });

        // Collect all promises
        const promises = docs.files
            .filter(doc => doc.subFileCount > 0)
            .map(doc => this.getDocsRecursively(notebookId, path + "/" + doc.id, url, key));

        // Wait for all promises to resolve
        const results = await Promise.all(promises);

        // Merge all result maps into the main map
        results.forEach(resultMap => {
            for (const [id, file] of resultMap.entries()) {
                filesMap.set(id, file);
            }
        });

        return filesMap;
    }

    async syncWithRemote() {
        // TODO: Add support for multiple remotes
        let url = this.urlToKeyPairs[0][0];
        let key = this.urlToKeyPairs[0][1];

        if (!url || !key) {
            console.error("Siyuan URL or API Key is not set.");
            return;
        }

        let notebooks = await this.getNotebooks(url, key);

        for (const notebook of notebooks) {
            let remoteFiles = await this.getDocsRecursively(notebook.id, "/", url, key);
            console.log("remoteFiles: ", remoteFiles);

            let localFiles = await this.getDocsRecursively(notebook.id, "/");
            console.log("localFiles: ", localFiles);

            // Compare localFiles and remoteFiles
            for (const [id, file] of remoteFiles.entries()) {
                if (!localFiles.has(id)) {
                    console.log(`File ${file.name} (${id}) is missing locally.`);
                }
            }
            for (const [id, file] of localFiles.entries()) {
                if (!remoteFiles.has(id)) {
                    console.log(`File ${file.name} (${id}) is missing remotely.`);
                }
            }

            // Compare file timestamps
            for (const [id, remoteFile] of remoteFiles.entries()) {
                const localFile = localFiles.get(id);
                if (localFile && remoteFile.mtime !== localFile.mtime) {
                    console.log(`File ${remoteFile.name} (${id}) has different timestamps.`);
                }
            }
        }
    }

    // Utils
    getHeaders(key: string = null): Record<string, string> {
        if (!key) return {}

        return { "Authorization": `Token ${key}` }
    }

    async getSYFileBlob(filePath: string, url: string = "", key: string = ""): Promise<Blob> {
        let file = await getFileBlob(filePath, url, this.getHeaders(key));

        return file
    }
}
