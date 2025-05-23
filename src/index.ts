import { IProtyle, Plugin } from "siyuan";
import "@/index.scss";
import { SettingsManager } from "./settings";
import { SyncManager } from "./sync";

export default class BetterSyncPlugin extends Plugin {
    settingsManager: SettingsManager;
    syncManager: SyncManager;
    contentObserver: MutationObserver;

    async onload() {
        console.log("onload");

        this.settingsManager = new SettingsManager(this);
        await this.settingsManager.setupSettings();
        this.syncManager = new SyncManager(this);

        this.addTopBar({
            icon: "iconCloud",
            title: this.i18n.cloudIconDesc,
            position: "right",
            callback: async () => { this.syncManager.syncHandler(); },
        });

        this.eventBus.on("switch-protyle", async ({ detail }) => {
            this.setupContentObserver(detail.protyle);
        });
    }

    private setupContentObserver(protyle: IProtyle) {
        if (this.contentObserver)
            this.contentObserver.disconnect();

        // Add a direct mutation observer to track DOM changes in the content
        if (protyle.contentElement) {
            let debounceTimer: NodeJS.Timeout | null = null;

            this.contentObserver = new MutationObserver((mutations) => {
                /*
                *  When mutations are below 3, ignore them
                *  This is to prevent the observer from firing on file open
                *  or other minor changes.
                */
                if (mutations.length < 3) return;

                if (debounceTimer !== null)
                    clearTimeout(debounceTimer);

                // Set a new timer for 5 seconds
                debounceTimer = setTimeout(() => {
                    this.handleContentChange(protyle);
                    debounceTimer = null;
                }, 5000);
            });

            this.contentObserver.observe(protyle.contentElement, {
                childList: true,
                subtree: true,
                characterData: true
            });
        }
    }

    private handleContentChange(protyle: IProtyle) {
        if (this.settingsManager.getPref("autoSyncCurrentFile") == true) {
            this.syncManager.pushFile(`data/${protyle.notebookId}${protyle.path}`);

            this.syncManager.syncNotebookConfig(protyle.notebookId);
        }

    }

    onLayoutReady() {
        let syncOnOpen = this.settingsManager.getPref("syncOnOpen") as Boolean;

        if (syncOnOpen) this.syncManager.syncHandler();
    }

    async onunload() {
        console.log("onunload");

        if (this.contentObserver)
            this.contentObserver.disconnect();
    }

    uninstall() {
        console.log("uninstall");
    }
}
