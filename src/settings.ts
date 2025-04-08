import { SettingUtils } from "@/libs/setting-utils";
import BetterSyncPlugin from ".";

const STORAGE_NAME = "menu-config";

export class SettingsManager {
    private plugin: BetterSyncPlugin;
    private settingUtils: SettingUtils;

    constructor(plugin: BetterSyncPlugin) {
        this.plugin = plugin;

        this.settingUtils = new SettingUtils({
            plugin: this.plugin,
            name: STORAGE_NAME,
        });
    }

    setupSettings() {
        this.settingUtils.addItem({
            key: "siyuanUrl",
            value: "",
            type: "textinput",
            title: this.plugin.i18n.siyuanUrl,
            description: this.plugin.i18n.siyuanUrlDesc,
            action: {
                callback: () => {
                    let value = this.settingUtils.takeAndSave("siyuanUrl");
                    this.plugin.syncManager.updateUrlKey();
                    console.log(value);
                }
            }
        });

        this.settingUtils.addItem({
            key: "siyuanAPIKey",
            value: "",
            type: "textinput",
            title: this.plugin.i18n.siyuanAPIKey,
            description: this.plugin.i18n.siyuanAPIKeyDesc,
            action: {
                callback: () => {
                    let value = this.settingUtils.takeAndSave("siyuanAPIKey");
                    this.plugin.syncManager.updateUrlKey();
                    console.log(value);
                }
            }
        });

        try {
            this.settingUtils.load();
        } catch (error) {
            console.error("Error loading settings storage, probably empty config json:", error);
        }
    }

    onLayoutReady() {
        this.settingUtils.load();
    }

    getPref = (key: string) => {
        return this.settingUtils.get(key);
    }
}
