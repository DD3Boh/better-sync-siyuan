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

            const referenceElement = e.querySelector('[data-type="readonly"]');
            if (!referenceElement) return;

            const button = document.createElement("button");
            button.className = "block__icon fn__flex-center ariaLabel better-sync-button";
            button.setAttribute("aria-label", this.i18n.cloudIconDesc);
            button.innerHTML = `<svg><use xlink:href="#iconCloudSucc"></use></svg>`;
            button.onclick = async () => {
                await this.syncManager.syncHandler(false);
            };

            referenceElement.before(button);
        });

        this.updateButtonIcon(this.syncManager.getSyncStatus());
    }

    private replaceToolbarButton() {
        if (document.querySelector(".toolbar__item.better-sync-button"))
            return;

        const element = document.querySelector("#barSync");
        if (!element) return;

        const button = document.createElement("button");
        button.className = "ariaLabel toolbar__item better-sync-button";
        button.id = "barBetterSync";
        button.setAttribute("aria-label", this.i18n.cloudIconDesc);
        button.innerHTML = `<svg><use xlink:href="#iconCloudSucc"></use></svg>`;

        button.onclick = async () => {
            await this.syncManager.syncHandler();
        };

        //element.replaceWith(button);
        let htmlElement = element as HTMLElement;
        htmlElement.style.display = 'none';

        element.parentElement.insertBefore(button, element);

        this.updateButtonIcon(this.syncManager.getSyncStatus());
    }

    private replaceMobileMenuEntry() {
        const element = document.querySelector("#menuSyncNow");
        if (!element) return;

        const menuItem = document.createElement("div");
        menuItem.className = "b3-menu__item better-sync-button";
        menuItem.id = "menuBetterSyncNow";
        menuItem.innerHTML = `<svg class="b3-menu__icon"><use xlink:href="#iconCloudSucc"></use></svg><span class="b3-menu__label">${this.i18n.cloudIconDesc}</span>`;

        menuItem.onclick = async () => {
            await this.syncManager.syncHandler();
        };

        element.replaceWith(menuItem);

        this.updateButtonIcon(this.syncManager.getSyncStatus());
        return true;
    }

    private async updateButtonIcon(status: SyncStatus) {
        const elements = document.querySelectorAll(".better-sync-button");
        if (elements.length === 0) return;

        const lastSyncTime = await this.syncManager.getLastLocalSyncTime() * 1000;
        const lastSyncTimeString = "\n" + this.i18n.lastSyncTime.replace(
            "{{lastSyncTime}}",
            new Date(lastSyncTime).toLocaleString()
        );

        elements.forEach(async e => {
            const svg = e.querySelector("svg");
            if (!svg) return;

            // Get the label element if it exists (for menu items)
            const label = e.querySelector(".b3-menu__label");

            switch (status) {
                case SyncStatus.InProgress:
                    svg.classList.add("fn__rotate");
                    svg.innerHTML = `<use xlink:href="#iconRefresh"></use>`;
                    e.setAttribute("aria-label", this.i18n.syncInProgress);
                    if (label) label.textContent = this.i18n.syncInProgress;
                    break;
                case SyncStatus.Done:
                    svg.classList.remove("fn__rotate");
                    svg.innerHTML = cloudSyncSuccIcon;
                    e.setAttribute("aria-label", this.i18n.syncDone + lastSyncTimeString);
                    if (label) label.textContent = this.i18n.syncDone + lastSyncTimeString;
                    break;
                case SyncStatus.DoneWithConflict:
                    svg.classList.remove("fn__rotate");
                    svg.innerHTML = cloudSyncSuccIcon;
                    e.setAttribute("aria-label", this.i18n.syncDoneWithConflict + lastSyncTimeString);
                    if (label) label.textContent = this.i18n.syncDoneWithConflict + lastSyncTimeString;
                    break;
                case SyncStatus.Failed:
                    svg.classList.remove("fn__rotate");
                    svg.innerHTML = `<use xlink:href="#iconCloudError"></use>`;
                    e.setAttribute("aria-label", this.i18n.syncFailed + lastSyncTimeString);
                    if (label) label.textContent = this.i18n.syncFailed + lastSyncTimeString;
                    break;
                case SyncStatus.None:
                default:
                    svg.classList.remove("fn__rotate");
                    svg.innerHTML = `<svg><use xlink:href="#iconCloudSucc"></use></svg>`;
                    e.setAttribute("aria-label", this.i18n.cloudIconDesc + lastSyncTimeString);
                    if (label) label.textContent = this.i18n.cloudIconDesc + lastSyncTimeString;
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
        const replaceSyncButton = this.settingsManager.getPref("replaceSyncButton") as boolean;

        if (replaceSyncButton) {
            this.replaceToolbarButton();
            this.replaceMobileMenuEntry();
        }

        if (syncOnOpen) this.syncManager.syncHandler(!syncIconInBreadcrumb);
    }

    async onunload() {}

    uninstall() {}
}
