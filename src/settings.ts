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

    async setupSettings() {
        this.settingUtils.addItem({
            key: "siyuanUrl",
            value: "",
            type: "textinput",
            title: this.plugin.i18n.siyuanUrl,
            description: this.plugin.i18n.siyuanUrlDesc,
            action: {
                callback: () => {
                    this.settingUtils.takeAndSave("siyuanUrl");
                    this.plugin.syncManager.updateUrlKey();
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
                    this.settingUtils.takeAndSave("siyuanAPIKey");
                    this.plugin.syncManager.updateUrlKey();
                }
            }
        });

        this.settingUtils.addItem({
            key: "siyuanNickname",
            value: "",
            type: "textinput",
            title: this.plugin.i18n.siyuanNickname,
            description: this.plugin.i18n.siyuanNicknameDesc,
            action: {
                callback: () => {
                    this.settingUtils.takeAndSave("siyuanNickname");
                }
            }
        });

        this.settingUtils.addItem({
            key: "syncOnOpen",
            value: true,
            type: "checkbox",
            title: this.plugin.i18n.syncOnOpen,
            description: this.plugin.i18n.syncOnOpenDesc,
            action: {
                callback: () => {
                    let value = !this.settingUtils.get("syncOnOpen");
                    this.settingUtils.set("syncOnOpen", value);
                }
            }
        });

        this.settingUtils.addItem({
            key: "syncOnClose",
            value: true,
            type: "checkbox",
            title: this.plugin.i18n.syncOnClose,
            description: this.plugin.i18n.syncOnCloseDesc,
            action: {
                callback: () => {
                    let value = !this.settingUtils.get("syncOnClose");
                    this.settingUtils.set("syncOnClose", value);
                }
            }
        });

        this.settingUtils.addItem({
            key: "autoSyncCurrentFile",
            value: true,
            type: "checkbox",
            title: this.plugin.i18n.autoSyncCurrentFile,
            description: this.plugin.i18n.autoSyncCurrentFileDesc,
            action: {
                callback: () => {
                    let value = !this.settingUtils.get("autoSyncCurrentFile");
                    this.settingUtils.set("autoSyncCurrentFile", value);
                }
            }
        });

        this.settingUtils.addItem({
            key: "trackConflicts",
            value: true,
            type: "checkbox",
            title: this.plugin.i18n.trackConflicts,
            description: this.plugin.i18n.trackConflictsDesc,
            action: {
                callback: () => {
                    let value = !this.settingUtils.get("trackConflicts");
                    this.settingUtils.set("trackConflicts", value);
                }
            }
        });

        try {
            await this.settingUtils.load();
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
