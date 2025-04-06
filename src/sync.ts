import { Plugin } from "siyuan";
import { getNotebookInfo, listDocsByPath, lsNotebooks } from "./api";

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

    async getDocsRecursively(notebookId: string, path: string, url: string = "", key: string = ""): Promise<DocumentFiles[]> {
        let docs = await listDocsByPath(notebookId, path, url, this.getHeaders(key))
        let files = docs.files.slice()

        // Collect all promises
        const promises = docs.files
            .filter(doc => doc.subFileCount > 0)
            .map(doc => this.getDocsRecursively(notebookId, path + "/" + doc.id, url, key));

        // Wait for all promises to resolve
        const results = await Promise.all(promises);

        // Add all results to files
        results.forEach(newFiles => {
            files.push(...newFiles);
        });

        return files;
    }

    // Utils
    getHeaders(key: string = null): Record<string, string> {
        if (!key) return {}

        return { "Authorization": `Token ${key}` }
    }
}
