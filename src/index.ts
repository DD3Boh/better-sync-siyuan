import {
    Plugin,
    getFrontend,
    getBackend,
} from "siyuan";
import "@/index.scss";
import { SettingsManager } from "./settings";
import { SyncManager } from "./sync";
import { getWorkspaceInfo } from "./api";

export default class BetterSyncPlugin extends Plugin {
    private isMobile: boolean;
    private settingsManager: SettingsManager;
    private syncManager: SyncManager;

    async onload() {
        console.log("onload");

        this.settingsManager = new SettingsManager(this);
        this.settingsManager.setupSettings();

        let workspaceDir = (await getWorkspaceInfo()).workspaceDir;

        let siyuanUrl = this.settingsManager.getPref("siyuanUrl");
        let siyuanKey = this.settingsManager.getPref("siyuanAPIKey");

        this.syncManager = new SyncManager(this, workspaceDir, [[siyuanUrl, siyuanKey]]);

        const frontEnd = getFrontend();
        this.isMobile = frontEnd === "mobile" || frontEnd === "browser-mobile";

        this.addTopBar({
            icon: "iconCalendar",
            title: this.i18n.topBarIconDesc,
            position: "right",
            callback: async () => {}
        });
    }

    onLayoutReady() {
        console.log(`frontend: ${getFrontend()}; backend: ${getBackend()}`);
    }

    async onunload() {
        console.log("onunload");
    }

    uninstall() {
        console.log("uninstall");
    }
}
