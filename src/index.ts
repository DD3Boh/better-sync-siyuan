import {
    Plugin,
    getFrontend,
    getBackend,
} from "siyuan";
import "@/index.scss";
import { SettingsManager } from "./settings";

export default class PluginSample extends Plugin {
    private isMobile: boolean;
    private settingsManager: SettingsManager;

    async onload() {
        console.log("onload");

        this.settingsManager = new SettingsManager(this);
        this.settingsManager.setupSettings();

        const frontEnd = getFrontend();
        this.isMobile = frontEnd === "mobile" || frontEnd === "browser-mobile";
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
