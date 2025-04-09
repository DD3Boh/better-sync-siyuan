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
        this.settingsManager.setupSettings();
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
        // Clean up previous observers
        if (this.contentObserver)
            this.contentObserver.disconnect();

        // Add a direct mutation observer to track DOM changes in the content
        if (protyle.contentElement) {
            this.contentObserver = new MutationObserver((mutations) => {
                console.log("Content DOM mutation:", mutations);
            });

            this.contentObserver.observe(protyle.contentElement, {
                childList: true,
                subtree: true,
                characterData: true
            });
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
