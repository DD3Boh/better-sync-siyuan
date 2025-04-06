import { Plugin } from "siyuan";

export class SyncManager {
    private plugin: Plugin;
    private urlToKeyPairs: [string, string][];

    constructor(plugin: Plugin, urlToKeyPairs: [string, string][] = []) {
        this.plugin = plugin;
        this.urlToKeyPairs = urlToKeyPairs;
    }
}
