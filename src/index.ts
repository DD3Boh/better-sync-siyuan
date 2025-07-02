import { Plugin } from "siyuan";
import "@/index.scss";
import { SettingsManager } from "./settings";
import { SyncManager } from "@/sync";

export default class BetterSyncPlugin extends Plugin {
    settingsManager: SettingsManager;
    syncManager: SyncManager;
    contentObserver: MutationObserver;

    async onload() {
        this.settingsManager = new SettingsManager(this);
        await this.settingsManager.setupSettings();
        this.syncManager = new SyncManager(this);

        if (!this.settingsManager.getPref("syncIconInBreadcrumb")) {
            this.addTopBar({
                icon: "iconCloud",
                title: this.i18n.cloudIconDesc,
                position: "right",
                callback: async () => { this.syncManager.syncHandler(); },
            });
        }

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
            button.innerHTML = `<svg><use xlink:href="#iconCloud"></use></svg>`;
            button.onclick = async () => {
                const svg = button.querySelector("svg");
                if (svg) {
                    svg.classList.add("fn__rotate");
                    svg.innerHTML = `<use xlink:href="#iconRefresh"></use>`;
                }

                await this.syncManager.syncHandler();

                if (svg) {
                    svg.innerHTML = `<use xlink:href="#iconCloud"></use>`;
                    svg.classList.remove("fn__rotate");
                }
            };

            referenceElement.after(button);
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
        let syncOnOpen = this.settingsManager.getPref("syncOnOpen") as Boolean;

        if (syncOnOpen) this.syncManager.syncHandler();
    }

    async onunload() {}

    uninstall() {}
}
