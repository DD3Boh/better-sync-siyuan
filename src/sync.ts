import { Plugin } from "siyuan";
import { getNotebookInfo, lsNotebooks } from "./api";

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

    // Utils
    getHeaders(key: string = null): Record<string, string> {
        if (!key) return {}

        return { "Authorization": `Token ${key}` }
    }
}
