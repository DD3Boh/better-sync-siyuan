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
                    this.plugin.syncManager.init();
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
                    this.plugin.syncManager.init();
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
            key: "instantSync",
            value: false,
            type: "checkbox",
            title: this.plugin.i18n.instantSync,
            description: this.plugin.i18n.instantSyncDesc,
            action: {
                callback: () => {
                    let value = !this.settingUtils.get("instantSync");
                    this.settingUtils.set("instantSync", value);
                }
            }
        });

        this.settingUtils.addItem({
            key: "transactionsDebounceTime",
            value: 5000,
            type: "number",
            title: this.plugin.i18n.transactionsDebounceTime,
            description: this.plugin.i18n.transactionsDebounceTimeDesc
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

        this.settingUtils.addItem({
            key: "createDataSnapshots",
            value: false,
            type: "checkbox",
            title: this.plugin.i18n.createDataSnapshots,
            description: this.plugin.i18n.createDataSnapshotsDesc,
            action: {
                callback: () => {
                    let value = !this.settingUtils.get("createDataSnapshots");
                    this.settingUtils.set("createDataSnapshots", value);
                }
            }
        });

        this.settingUtils.addItem({
            key: "minHoursBetweenSnapshots",
            value: 24,
            type: "number",
            title: this.plugin.i18n.minHoursBetweenSnapshots,
            description: this.plugin.i18n.minHoursBetweenSnapshotsDesc
        });

        this.settingUtils.addItem({
            key: "syncIconInBreadcrumb",
            value: false,
            type: "checkbox",
            title: this.plugin.i18n.syncIconInBreadcrumb,
            description: this.plugin.i18n.syncIconInBreadcrumbDesc,
            action: {
                callback: () => {
                    let value = !this.settingUtils.get("syncIconInBreadcrumb");
                    this.settingUtils.set("syncIconInBreadcrumb", value);
                }
            }
        });

        this.settingUtils.addItem({
            key: "replaceSyncButton",
            value: false,
            type: "checkbox",
            title: this.plugin.i18n.replaceSyncButton,
            description: this.plugin.i18n.replaceSyncButtonDesc,
            action: {
                callback: () => {
                    let value = !this.settingUtils.get("replaceSyncButton");
                    this.settingUtils.set("replaceSyncButton", value);
                }
            }
        });

        this.settingUtils.addItem({
            key: "useExperimentalWebSocket",
            value: false,
            type: "checkbox",
            title: this.plugin.i18n.useExperimentalWebSocket,
            description: this.plugin.i18n.useExperimentalWebSocketDesc,
            action: {
                callback: () => {
                    let value = !this.settingUtils.get("useExperimentalWebSocket");
                    this.settingUtils.set("useExperimentalWebSocket", value);
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
