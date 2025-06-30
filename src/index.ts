import { Plugin } from "siyuan";
import "@/index.scss";
import { SettingsManager } from "./settings";
import { SyncManager } from "@/sync";

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
            this.syncManager.setActiveProtyle(detail.protyle.getInstance());
            this.syncManager.setupContentObserver(detail.protyle);
        });

        this.eventBus.on("loaded-protyle-dynamic", async ({ detail }) => {
            this.syncManager.insertProtyle(detail.protyle.getInstance());
        });

        this.eventBus.on("loaded-protyle-static", async ({ detail }) => {
            this.syncManager.insertProtyle(detail.protyle.getInstance());
        });

        this.eventBus.on("destroy-protyle", async ({ detail }) => {
            this.syncManager.removeProtyle(detail.protyle.getInstance());
        });
    }

    onLayoutReady() {
        let syncOnOpen = this.settingsManager.getPref("syncOnOpen") as Boolean;

        if (syncOnOpen) this.syncManager.syncHandler();
    }

    async onunload() {
        console.log("onunload");
    }

    uninstall() {
        console.log("uninstall");
    }
}
