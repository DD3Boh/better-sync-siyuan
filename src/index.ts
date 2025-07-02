import { Plugin } from "siyuan";
import "@/index.scss";
import { SettingsManager } from "./settings";
import { SyncManager } from "@/sync";
import { cloudSyncSuccIcon } from "@/assets";
import { SyncStatus } from "@/types/sync-status";

export default class BetterSyncPlugin extends Plugin {
    settingsManager: SettingsManager;
    syncManager: SyncManager;

    async onload() {
        this.settingsManager = new SettingsManager(this);
        await this.settingsManager.setupSettings();
        this.syncManager = new SyncManager(this);

        this.addTopBar({
            icon: "iconCloudSucc",
            title: this.i18n.cloudIconDesc,
            position: "right",
            callback: async () => { this.syncManager.syncHandler(); },
        });

        this.eventBus.on("switch-protyle", async ({ detail }) => {
            this.syncManager.setActiveProtyle(detail.protyle.getInstance());
            this.syncManager.setupContentObserver(detail.protyle);
        });

        this.eventBus.on("loaded-protyle-dynamic", async ({ detail }) => {
            this.setupButtonBreadcrumb();
            this.syncManager.insertProtyle(detail.protyle.getInstance());
        });

        this.eventBus.on("loaded-protyle-static", async ({ detail }) => {
            this.setupButtonBreadcrumb();
            this.syncManager.insertProtyle(detail.protyle.getInstance());
        });

        this.eventBus.on("destroy-protyle", async ({ detail }) => {
            this.syncManager.removeProtyle(detail.protyle.getInstance());
        });

        this.syncManager.onSyncStatusChange((status: SyncStatus) => {
            this.updateButtonIcon(status);
        });
    }

    private addButtonBreadcrumb() {
        const elements = document.querySelectorAll(".protyle-breadcrumb");
        if (elements.length === 0) return;

        elements.forEach(e => {
            if (e.querySelector(".better-sync-button")) return;

            const referenceElement = e.querySelector('.protyle-breadcrumb__icon[data-type="exit-focus"]');
            if (!referenceElement) return;

            const button = document.createElement("button");
            button.className = "block__icon fn__flex-center b3-tooltips b3-tooltips__w better-sync-button";
            button.setAttribute("aria-label", this.i18n.cloudIconDesc);
            button.innerHTML = `<svg><use xlink:href="#iconCloudSucc"></use></svg>`;
            button.onclick = async () => {
                await this.syncManager.syncHandler(false);
            };

            referenceElement.after(button);
        });

        this.updateButtonIcon(this.syncManager.getSyncStatus());
    }

    private updateButtonIcon(status: SyncStatus) {
        const elements = document.querySelectorAll(".better-sync-button");
        if (elements.length === 0) return;

        elements.forEach(e => {
            const svg = e.querySelector("svg");
            if (!svg) return;

            switch (status) {
                case SyncStatus.InProgress:
                    svg.classList.add("fn__rotate");
                    svg.innerHTML = `<use xlink:href="#iconRefresh"></use>`;
                    break;
                case SyncStatus.Done:
                    svg.classList.remove("fn__rotate");
                    svg.innerHTML = cloudSyncSuccIcon;
                    setTimeout(() => {
                        svg.innerHTML = `<use xlink:href="#iconCloudSucc"></use>`;
                    }, 5000);
                    break;
                case SyncStatus.Failed:
                    svg.classList.remove("fn__rotate");
                    svg.innerHTML = `<use xlink:href="#iconCloudError"></use>`;
                    setTimeout(() => {
                        svg.innerHTML = `<use xlink:href="#iconCloudSucc"></use>`;
                    }, 5000);
                    break;
                case SyncStatus.None:
                default:
                    svg.classList.remove("fn__rotate");
                    svg.innerHTML = `<svg><use xlink:href="#iconCloudSucc"></use></svg>`;
                    break;
            }
        });
    }

    private setupButtonBreadcrumb() {
        const syncIconInBreadcrumb = this.settingsManager.getPref("syncIconInBreadcrumb") as Boolean;
        syncIconInBreadcrumb ? this.addButtonBreadcrumb() : this.removeButtonBreadcrumb();
    }

    public removeButtonBreadcrumb() {
        const elements = document.querySelectorAll(".protyle-breadcrumb .better-sync-button");
        elements.forEach(e => e.remove());
    }

    onLayoutReady() {
        const syncOnOpen = this.settingsManager.getPref("syncOnOpen") as boolean;
        const syncIconInBreadcrumb = this.settingsManager.getPref("syncIconInBreadcrumb") as boolean;

        if (syncOnOpen) this.syncManager.syncHandler(!syncIconInBreadcrumb);
    }

    async onunload() {}

    uninstall() {}
}
