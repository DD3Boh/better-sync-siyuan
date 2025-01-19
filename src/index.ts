import {
    Plugin,
    getFrontend,
    getBackend,
} from "siyuan";
import "@/index.scss";

export default class PluginSample extends Plugin {
    private isMobile: boolean;

    async onload() {
        console.log("onload");

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
