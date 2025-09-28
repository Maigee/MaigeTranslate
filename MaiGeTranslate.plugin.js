/**
 * @name MaiGeTranslate
 * @description 更适合中国宝宝体质的翻译插件，双击翻译+输入翻译！
 * @version 0.1.0
 * @website https://x.com/unflwMaige
 * @author Maige
 */

const PLUGIN_NAME = "MaiGeTranslate";
const PLUGIN_VERSION = "0.1.0";

const LANGUAGE_OPTIONS = [
    "简体中文",
    "English",
    "日本語",
    "한국어",
    "Español",
    "Français",
    "Deutsch"
];

const PRESET_PROVIDERS = {
    aihubmix: {
        label: "AIHUBMIX",
        baseUrl: "https://aihubmix.com/v1/chat/completions",
        defaultModel: "LongCat-Flash-Chat"
    },
    siliconflow: {
        label: "硅基流动",
        baseUrl: "https://api.siliconflow.cn/v1/chat/completions",
        defaultModel: "deepseek-ai/DeepSeek-V3"
    },
    deepseek: {
        label: "DeepSeek",
        baseUrl: "https://api.deepseek.com/v1/chat/completions",
        defaultModel: "deepseek-chat"
    },
    zhipu: {
        label: "智谱",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        defaultModel: "glm-4.5-x"
    },
    openrouter: {
        label: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1/chat/completions",
        defaultModel: "google/gemini-2.5-flash-lite"
    },
    openai: {
        label: "OpenAI 兼容",
        baseUrl: "https://api.openai.com/v1/chat/completions",
        defaultModel: "gpt-3.5-turbo"
    }
};

const PRESET_MENU_KEYS = ["aihubmix", "siliconflow", "deepseek", "zhipu", "openrouter"];

function createPresetProviderConfig(presetKey, overrides = {}) {
    const spec = PRESET_PROVIDERS[presetKey];
    if (!spec) {
        throw new Error(`Unknown preset provider: ${presetKey}`);
    }
    return Object.assign(
        {
            label: spec.label,
            type: "preset",
            presetKey,
            apiKey: "",
            baseUrl: spec.baseUrl,
            modelId: spec.defaultModel
        },
        overrides
    );
}

const defaultSettings = {
    preferredProviderId: "",
    doubleClickTargetLanguage: "简体中文",
    inputTargetLanguage: "English",
    requestTimeoutMs: 20000,
    providers: {},
    translateButtonPosition: null
};

class MaiGeTranslate {
    constructor() {
        this.pluginName = PLUGIN_NAME;
        this.stylesId = `${this.pluginName}-styles`;
        this.defaults = this.clone(defaultSettings);
        this.settings = this.loadSettings();
        this.doubleClickHandler = this.handleDoubleClick.bind(this);
        this.injectedTranslations = new Map();
        this.pendingControllers = new Map();
        this.translationCache = new Map();
        this.stylesInjected = false;
        this.activeAddProviderMenu = null;
        this.translateButton = null;
        this.translateButtonDragState = {
            active: false,
            pointerId: null,
            offsetX: 0,
            offsetY: 0,
            moved: false,
            justDragged: false
        };
        this.composerTranslationController = null;

        this.boundTranslateButtonClick = this.handleTranslateButtonClick.bind(this);
        this.boundTranslateButtonPointerDown = this.handleTranslateButtonPointerDown.bind(this);
        this.boundTranslateButtonPointerMove = this.handleTranslateButtonPointerMove.bind(this);
        this.boundTranslateButtonPointerUp = this.handleTranslateButtonPointerUp.bind(this);
        this.boundTranslateButtonPointerCancel = this.handleTranslateButtonPointerCancel.bind(this);
        this.boundWindowResize = this.handleWindowResize.bind(this);
    }

    getName() {
        return this.pluginName;
    }

    getVersion() {
        return PLUGIN_VERSION;
    }

    getAuthor() {
        return "Maige";
    }

    getDescription() {
        return "双击频道消息，调用自定义 AI 翻译接口，将译文插入原消息下方。";
    }

    load() {}

    start() {
        this.settings = this.loadSettings();
        this.ensureStyles();
        this.injectTranslateButton();
        window.addEventListener("resize", this.boundWindowResize);
        document.addEventListener("dblclick", this.doubleClickHandler, true);
    }

    stop() {
        document.removeEventListener("dblclick", this.doubleClickHandler, true);
        this.abortAllPending();
        this.cleanupInjectedTranslations();
        this.translationCache.clear();
        this.closeAddProviderMenu();
        this.abortComposerTranslation();
        window.removeEventListener("resize", this.boundWindowResize);
        this.removeTranslateButton();
        this.removeStyles();
    }

    ensureStyles() {
        if (this.stylesInjected) {
            return;
        }
        const css = `
            .dct-translation {
                margin-top: 6px;
                padding: 8px 10px;
                border-radius: 8px;
                background: var(--background-secondary, #2f3136);
                border: 1px solid var(--background-tertiary, #202225);
                font-size: 0.95em;
                color: var(--text-normal, #fff);
                white-space: pre-wrap;
                display: inline-flex;
                flex-direction: column;
                width: auto;
                max-width: min(100%, 640px);
                align-self: flex-start;
            }
            .dct-translation[data-state="loading"] {
                opacity: 0.85;
            }
            .dct-translation[data-state="error"] {
                border-color: var(--status-danger, #ed4245);
                color: var(--text-danger, #f04747);
            }
            .dct-translation-container {
                margin: 8px 0 4px 0;
                display: flex;
                flex-direction: column;
                gap: 6px;
                width: auto;
                max-width: 100%;
                align-items: flex-start;
            }
            .dct-translation-body {
                line-height: 1.45;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .dct-translation-segment {
                white-space: pre-wrap;
                line-height: 1.45;
            }
            .dct-translation-segment.quote {
                border-left: 3px solid rgba(148, 163, 184, 0.6);
                padding-left: 8px;
                opacity: 0.85;
            }
            .dct-settingsPanel {
                display: flex;
                flex-direction: column;
                gap: 16px;
                padding-right: 6px;
                max-height: 520px;
                overflow-y: auto;
                color: #0f172a;
            }
            .dct-cardList {
                display: flex;
                flex-direction: column;
                gap: 12px;
                align-items: stretch;
                width: 100%;
            }
            .dct-cardListHeader {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 0 2px;
                width: 100%;
            }
            .dct-popover {
                position: absolute;
                z-index: 9999;
                background: #ffffff;
                border: 1px solid #e2e8f0;
                border-radius: 12px;
                box-shadow: 0 20px 35px rgba(15, 23, 42, 0.18);
                padding: 12px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                min-width: 220px;
            }
            .dct-popover button {
                width: 100%;
                justify-content: flex-start;
            }
            .dct-card {
                border-radius: 14px;
                background: #ffffff;
                border: 1px solid #e2e8f0;
                box-shadow: 0 12px 28px rgba(15, 23, 42, 0.12);
                padding: 16px 18px;
                display: flex;
                flex-direction: column;
                gap: 12px;
                width: 100%;
                max-width: 520px;
            }
            .dct-providerCard {
                padding: 3px 12px;
                gap: 4px;
                width: 100%;
                max-width: 100%;
                box-sizing: border-box;
            }
            .dct-cardList .dct-card,
            .dct-cardList .dct-empty {
                width: 100%;
                max-width: 100%;
                box-sizing: border-box;
                margin: 0 auto;
            }
            .dct-card.default {
                border-color: #60a5fa;
                box-shadow: 0 16px 32px rgba(37, 99, 235, 0.18);
            }
            .dct-card.dct-empty {
                align-items: center;
                justify-content: center;
                color: #475569;
                text-align: center;
                min-height: 80px;
                background: rgba(248, 250, 252, 0.9);
            }
            .dct-card summary {
                list-style: none;
                outline: none;
            }
            .dct-card summary::-webkit-details-marker {
                display: none;
            }
            .dct-cardSummary {
                display: flex;
                align-items: center;
                gap: 12px;
                cursor: pointer;
                user-select: none;
                padding: 4px 2px;
                border-radius: 10px;
                transition: border-color 0.15s ease;
            }
            .dct-cardSummaryTitle {
                font-size: 16px;
                font-weight: 700;
                color: #0f172a;
                flex: 1;
                min-width: 0;
                text-overflow: ellipsis;
                white-space: nowrap;
                overflow: hidden;
            }
            .dct-cardSummaryCaret {
                width: 8px;
                height: 8px;
                border-right: 1.5px solid #64748b;
                border-bottom: 1.5px solid #64748b;
                border-radius: 2px;
                transform: rotate(-45deg) translateY(-1px);
                transition: transform 0.15s ease;
                flex-shrink: 0;
            }
            .dct-card[open] .dct-cardSummaryCaret {
                transform: rotate(45deg);
            }
            .dct-cardBody {
                margin-top: 6px;
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            .dct-cardTitle {
                font-size: 18px;
                font-weight: 700;
                margin: 0;
            }
            .dct-chip {
                padding: 3px 10px;
                border-radius: 999px;
                background: rgba(59, 130, 246, 0.15);
                color: #1d4ed8;
                font-size: 12px;
                font-weight: 600;
            }
            .dct-settings-field {
                display: flex;
                flex-direction: column;
                gap: 6px;
                margin-top: 10px;
            }
            .dct-settings-field label {
                font-weight: 600;
                color: #0f172a;
            }
            .dct-settings-field small {
                opacity: 0.8;
                color: #334155;
            }
            .dct-settings-field input,
            .dct-settings-field textarea,
            .dct-settings-field select {
                background: #ffffff;
                color: #0f172a;
                border: 1px solid #cbd5e1;
                border-radius: 6px;
                padding: 6px 8px;
                font-size: 14px;
                box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.06);
            }
            .dct-settings-field textarea {
                min-height: 120px;
                font-family: var(--font-code, monospace);
                white-space: pre;
            }
            .dct-inline {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .dct-inline input[type="number"] {
                width: 90px;
            }
            .dct-button-row {
                display: flex;
                gap: 8px;
                margin-top: 8px;
            }
            .dct-button {
                cursor: pointer;
                border-radius: 6px;
                border: 1px solid #bfdbfe;
                padding: 6px 12px;
                background: #ebf2ff;
                color: #1d4ed8;
                font-weight: 600;
                text-align: center;
                transition: transform 0.15s ease, box-shadow 0.15s ease;
            }
            .dct-button:hover {
                transform: translateY(-1px);
                box-shadow: 0 6px 12px rgba(59, 130, 246, 0.18);
            }
            .dct-button:disabled {
                opacity: 0.6;
                cursor: default;
                box-shadow: none;
                transform: none;
            }
            .dct-button.primary {
                background: linear-gradient(135deg, #3b82f6, #2563eb);
                color: #ffffff;
                border-color: #3b82f6;
            }
            .dct-button.secondary {
                background: #f1f5f9;
                border-color: #cbd5e1;
                color: #1f2937;
            }
            .dct-translate-button {
                position: fixed;
                z-index: 10000;
                width: 28px;
                height: 28px;
                border-radius: 8px;
                border: 1px solid rgba(15, 23, 42, 0.4);
                background: rgba(15, 23, 42, 0.92);
                color: #ffffff;
                font-size: 14px;
                font-weight: 700;
                box-shadow: 0 6px 12px rgba(15, 23, 42, 0.25);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                user-select: none;
                transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
            }
            .dct-translate-button:hover {
                transform: translateY(-1px);
                box-shadow: 0 8px 14px rgba(15, 23, 42, 0.28);
            }
            .dct-translate-button:focus-visible {
                outline: 2px solid rgba(148, 163, 184, 0.65);
                outline-offset: 2px;
            }
            .dct-translate-button[data-state="loading"] {
                opacity: 0.75;
                cursor: progress;
                pointer-events: none;
            }
            .dct-translate-button[data-dragging="true"] {
                cursor: grabbing;
                box-shadow: 0 6px 14px rgba(15, 23, 42, 0.24);
                transform: scale(1.05);
            }
        `;
        BdApi.DOM.addStyle(this.stylesId, css);
        this.stylesInjected = true;
    }

    removeStyles() {
        if (!this.stylesInjected) {
            return;
        }
        BdApi.DOM.removeStyle(this.stylesId);
        this.stylesInjected = false;
    }

    injectTranslateButton() {
        if (this.translateButton || typeof document === "undefined" || !document.body) {
            return;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "dct-translate-button";
        button.dataset.label = "译";
        button.dataset.state = "idle";
        button.textContent = button.dataset.label;
        this.updateTranslateButtonTooltip(button);
        button.addEventListener("click", this.boundTranslateButtonClick);
        button.addEventListener("pointerdown", this.boundTranslateButtonPointerDown);
        document.body.appendChild(button);
        this.translateButton = button;
        requestAnimationFrame(() => this.updateTranslateButtonPosition());
    }

    removeTranslateButton() {
        const button = this.translateButton;
        if (!button) {
            return;
        }
        button.removeEventListener("click", this.boundTranslateButtonClick);
        button.removeEventListener("pointerdown", this.boundTranslateButtonPointerDown);
        document.removeEventListener("pointermove", this.boundTranslateButtonPointerMove);
        document.removeEventListener("pointerup", this.boundTranslateButtonPointerUp);
        document.removeEventListener("pointercancel", this.boundTranslateButtonPointerCancel);
        button.remove();
        this.translateButton = null;
        this.translateButtonDragState.active = false;
        this.translateButtonDragState.pointerId = null;
        this.translateButtonDragState.moved = false;
        this.translateButtonDragState.justDragged = false;
    }

    updateTranslateButtonTooltip(button = this.translateButton) {
        if (!button) {
            return;
        }
        button.title = `翻译输入框到 ${this.settings.inputTargetLanguage}`;
    }

    updateTranslateButtonPosition() {
        const button = this.translateButton;
        if (!button) {
            return;
        }
        const { x, y } = this.resolveTranslateButtonPosition(this.settings.translateButtonPosition, button);
        button.style.left = `${x}px`;
        button.style.top = `${y}px`;
    }

    resolveTranslateButtonPosition(position, button) {
        const fallback = this.getDefaultTranslateButtonPosition(button);
        const base = position && typeof position.x === "number" && typeof position.y === "number"
            ? position
            : fallback;
        return this.constrainTranslateButtonPosition(base.x, base.y, button);
    }

    getDefaultTranslateButtonPosition(button) {
        const margin = 24;
        const width = button?.offsetWidth || 28;
        const height = button?.offsetHeight || 28;
        const x = window.innerWidth - width - margin;
        const y = window.innerHeight - height - margin * 2;
        return { x, y };
    }

    constrainTranslateButtonPosition(x, y, button) {
        const margin = 12;
        const width = button?.offsetWidth || 28;
        const height = button?.offsetHeight || 28;
        const maxX = Math.max(margin, window.innerWidth - width - margin);
        const maxY = Math.max(margin, window.innerHeight - height - margin);
        return {
            x: Math.min(Math.max(x, margin), maxX),
            y: Math.min(Math.max(y, margin), maxY)
        };
    }

    handleWindowResize() {
        this.updateTranslateButtonPosition();
    }

    handleTranslateButtonPointerDown(event) {
        if (!this.translateButton) {
            return;
        }
        if (event.pointerType === "mouse" && event.button !== 0) {
            return;
        }
        const rect = this.translateButton.getBoundingClientRect();
        this.translateButtonDragState.active = true;
        this.translateButtonDragState.pointerId = event.pointerId;
        this.translateButtonDragState.offsetX = event.clientX - rect.left;
        this.translateButtonDragState.offsetY = event.clientY - rect.top;
        this.translateButtonDragState.moved = false;
        this.translateButtonDragState.justDragged = false;
        this.translateButton.dataset.dragging = "true";
        document.addEventListener("pointermove", this.boundTranslateButtonPointerMove);
        document.addEventListener("pointerup", this.boundTranslateButtonPointerUp);
        document.addEventListener("pointercancel", this.boundTranslateButtonPointerCancel);
        event.preventDefault();
    }

    handleTranslateButtonPointerMove(event) {
        if (!this.translateButtonDragState.active || event.pointerId !== this.translateButtonDragState.pointerId) {
            return;
        }
        const button = this.translateButton;
        if (!button) {
            return;
        }
        this.translateButtonDragState.moved = true;
        const x = event.clientX - this.translateButtonDragState.offsetX;
        const y = event.clientY - this.translateButtonDragState.offsetY;
        const constrained = this.constrainTranslateButtonPosition(x, y, button);
        button.style.left = `${constrained.x}px`;
        button.style.top = `${constrained.y}px`;
        event.preventDefault();
    }

    handleTranslateButtonPointerUp(event) {
        if (!this.translateButtonDragState.active || event.pointerId !== this.translateButtonDragState.pointerId) {
            return;
        }
        const button = this.translateButton;
        this.translateButtonDragState.active = false;
        document.removeEventListener("pointermove", this.boundTranslateButtonPointerMove);
        document.removeEventListener("pointerup", this.boundTranslateButtonPointerUp);
        document.removeEventListener("pointercancel", this.boundTranslateButtonPointerCancel);
        if (button) {
            button.removeAttribute("data-dragging");
            const rect = button.getBoundingClientRect();
            const constrained = this.constrainTranslateButtonPosition(rect.left, rect.top, button);
            button.style.left = `${constrained.x}px`;
            button.style.top = `${constrained.y}px`;
            this.settings.translateButtonPosition = { x: constrained.x, y: constrained.y };
            this.saveSettings({ skipRuntimeReset: true });
        }
        if (this.translateButtonDragState.moved) {
            this.translateButtonDragState.justDragged = true;
            event.preventDefault();
            event.stopPropagation();
        }
        this.translateButtonDragState.moved = false;
        this.translateButtonDragState.pointerId = null;
    }

    handleTranslateButtonPointerCancel(event) {
        if (!this.translateButtonDragState.active || event.pointerId !== this.translateButtonDragState.pointerId) {
            return;
        }
        this.translateButtonDragState.active = false;
        this.translateButtonDragState.moved = false;
        this.translateButtonDragState.pointerId = null;
        this.translateButtonDragState.justDragged = false;
        document.removeEventListener("pointermove", this.boundTranslateButtonPointerMove);
        document.removeEventListener("pointerup", this.boundTranslateButtonPointerUp);
        document.removeEventListener("pointercancel", this.boundTranslateButtonPointerCancel);
        if (this.translateButton) {
            this.translateButton.removeAttribute("data-dragging");
        }
    }

    handleTranslateButtonClick(event) {
        if (this.translateButtonDragState.justDragged) {
            this.translateButtonDragState.justDragged = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (this.composerTranslationController) {
            return;
        }
        const editor = this.findComposerEditor();
        if (!editor) {
            this.toast("未找到输入框", "error");
            return;
        }
        const sourceText = this.getComposerText(editor);
        if (!sourceText) {
            this.toast("输入框为空", "info");
            return;
        }
        const provider = this.getActiveProvider();
        if (!provider) {
            this.toast("请先在设置中配置翻译接口", "error");
            return;
        }
        this.updateTranslateButtonTooltip();
        this.setTranslateButtonState("loading");
        const controller = new AbortController();
        this.composerTranslationController = controller;
        (async () => {
            try {
                const raw = await this.performRequest(
                    provider,
                    sourceText,
                    controller,
                    this.settings.inputTargetLanguage
                );
                if (controller.signal.aborted) {
                    return;
                }
                const translation = typeof raw === "string" ? raw.trim() : "";
                if (!translation) {
                    throw new Error("翻译结果为空");
                }
                const copied = await this.copyToClipboard(translation);
                if (!copied) {
                    throw new Error("复制译文失败");
                }
                this.toast("译文已复制到剪贴板", "success");
            } catch (error) {
                if (!controller.signal.aborted) {
                    console.error(`[${this.pluginName}] translate input`, error);
                    this.toast(`翻译失败: ${error.message || error}`, "error");
                }
            } finally {
                if (this.composerTranslationController === controller) {
                    this.composerTranslationController = null;
                }
                this.setTranslateButtonState("idle");
            }
        })();
    }

    setTranslateButtonState(state) {
        const button = this.translateButton;
        if (!button) {
            return;
        }
        button.dataset.state = state;
        const label = button.dataset.label || "译";
        button.textContent = state === "loading" ? "…" : label;
    }

    abortComposerTranslation() {
        if (this.composerTranslationController) {
            this.composerTranslationController.abort();
            this.composerTranslationController = null;
        }
        this.setTranslateButtonState("idle");
    }

    findComposerEditor() {
        const selectors = [
            'div[class*="channelTextArea-"] div[role="textbox"][data-slate-editor="true"]',
            'div[role="textbox"][data-slate-editor="true"]'
        ];
        for (const selector of selectors) {
            const node = document.querySelector(selector);
            if (node) {
                return node;
            }
        }
        return null;
    }

    getComposerText(editor) {
        if (!editor) {
            return "";
        }
        return (editor.textContent || "").replace(/[\u200B\u200D\uFEFF]/g, "").replace(/\u00a0/g, " ").trim();
    }

    async copyToClipboard(text) {
        if (!text) {
            return false;
        }
        if (BdApi?.Clipboard?.copy) {
            try {
                BdApi.Clipboard.copy(text);
                return true;
            } catch (error) {
                console.error(`[${this.pluginName}] copy via BdApi`, error);
            }
        }
        if (navigator?.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (error) {
                console.error(`[${this.pluginName}] copy via navigator`, error);
            }
        }
        try {
            const textarea = document.createElement("textarea");
            textarea.value = text;
            textarea.setAttribute("readonly", "");
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.focus({ preventScroll: true });
            textarea.select();
            const succeeded = document.execCommand?.("copy");
            textarea.remove();
            return Boolean(succeeded);
        } catch (error) {
            console.error(`[${this.pluginName}] copy fallback`, error);
            return false;
        }
    }

    getSettingsPanel() {
        const panel = document.createElement("div");
        panel.className = "dct-settingsPanel";

        const render = (options = {}) => {
            const previousScroll = panel.scrollTop;
            this.closeAddProviderMenu();
            panel.replaceChildren();
            panel.appendChild(this.buildGeneralSettings());
        panel.appendChild(this.buildProviderSettings(render, {
            focusProviderId: options.focusProviderId,
            forceOpenProviderId: options.forceOpenProviderId
        }));

            if (options.scrollToProviderId) {
                const card = panel.querySelector(`[data-provider-id="${options.scrollToProviderId}"]`);
                if (card) {
                    card.scrollIntoView({ block: "nearest" });
                }
            } else {
                panel.scrollTop = previousScroll;
            }
        };

        render();
        return panel;
    }

    buildGeneralSettings() {
        const wrapper = document.createElement("div");
        wrapper.className = "dct-card";

        const title = document.createElement("h3");
        title.className = "dct-cardTitle";
        title.textContent = "通用设置";
        wrapper.appendChild(title);

        wrapper.appendChild(
            this.createLanguageSelectField(
                "双击翻译目标语言",
                () => this.settings.doubleClickTargetLanguage,
                value => {
                    this.settings.doubleClickTargetLanguage = value;
                    this.saveSettings();
                }
            )
        );

        wrapper.appendChild(
            this.createLanguageSelectField(
                "输入翻译目标语言",
                () => this.settings.inputTargetLanguage,
                value => {
                    this.settings.inputTargetLanguage = value;
                    this.saveSettings();
                    this.updateTranslateButtonTooltip();
                }
            )
        );

        return wrapper;
    }

    buildProviderSettings(rerender, options = {}) {
        const { focusProviderId, forceOpenProviderId } = options;
        const card = document.createElement("div");
        card.className = "dct-card";

        const wrapper = document.createElement("div");
        wrapper.className = "dct-cardList";

        const header = document.createElement("div");
        header.className = "dct-cardListHeader";
        const title = document.createElement("h3");
        title.className = "dct-cardTitle";
        title.textContent = "翻译接口";
        header.appendChild(title);

        const addButton = document.createElement("button");
        addButton.className = "dct-button secondary";
        addButton.textContent = "新增接口";
        addButton.addEventListener("click", event => {
            event.stopPropagation();
            this.openAddProviderMenu(addButton, rerender);
        });
        header.appendChild(addButton);
        wrapper.appendChild(header);

        const providersEntries = Object.entries(this.settings.providers);
        if (providersEntries.length === 0) {
            wrapper.appendChild(this.buildEmptyProviderNotice());
            card.appendChild(wrapper);
            return card;
        }

        providersEntries.forEach(([providerId, provider]) => {
            const details = document.createElement("details");
            details.className = "dct-card dct-providerCard";
            details.dataset.providerId = providerId;
            if (forceOpenProviderId && providerId === forceOpenProviderId) {
                details.open = true;
            } else if (focusProviderId && providerId === focusProviderId) {
                details.open = true;
            }
            if (this.settings.preferredProviderId === providerId) {
                details.classList.add("default");
            }

            const summary = document.createElement("summary");
            summary.className = "dct-cardSummary";

            const caret = document.createElement("span");
            caret.className = "dct-cardSummaryCaret";

            const title = document.createElement("span");
            title.className = "dct-cardSummaryTitle";
            const presetSpec = this.getPresetSpec(provider);
            const isPreset = provider.type === "preset" && presetSpec;
            const updateTitle = () => {
                title.textContent = provider.label || presetSpec?.label || providerId;
            };
            updateTitle();

            summary.append(caret, title);

            if (this.settings.preferredProviderId === providerId) {
                const chip = document.createElement("span");
                chip.className = "dct-chip";
                chip.textContent = "默认";
                summary.appendChild(chip);
            }

            details.appendChild(summary);

            const body = document.createElement("div");
            body.className = "dct-cardBody";

            if (!isPreset) {
                body.appendChild(
                    this.createField("接口名称", () => {
                        const input = document.createElement("input");
                        input.type = "text";
                        input.value = provider.label || "";
                        input.placeholder = "自定义接口";
                        input.addEventListener("input", () => {
                            provider.label = input.value;
                            updateTitle();
                        });
                        input.addEventListener("change", () => {
                            this.saveSettings();
                            updateTitle();
                            rerender();
                        });
                        return input;
                    })
                );
            }

            body.appendChild(
                this.createField("API Key", () => {
                    const input = document.createElement("input");
                    input.type = "password";
                    input.autocomplete = "off";
                    input.value = provider.apiKey || "";
                    input.placeholder = "sk-...";
                    input.addEventListener("input", () => {
                        provider.apiKey = input.value.trim();
                    });
                    input.addEventListener("change", () => this.saveSettings());
                    return input;
                })
            );

            if (!isPreset) {
                body.appendChild(
                    this.createField("Base URL", () => {
                        const input = document.createElement("input");
                        input.type = "text";
                        input.value = provider.baseUrl || "";
                        input.placeholder = "https://api.openai.com/v1/chat/completions";
                        input.addEventListener("input", () => {
                            provider.baseUrl = input.value.trim();
                        });
                        input.addEventListener("change", () => {
                            this.saveSettings();
                            rerender();
                        });
                        return input;
                    })
                );
            }

            body.appendChild(
                this.createField("模型 ID", () => {
                    const input = document.createElement("input");
                    input.type = "text";
                    input.value = provider.modelId || "";
                    input.placeholder = "gpt-3.5-turbo";
                    input.addEventListener("input", () => {
                        provider.modelId = input.value.trim();
                    });
                    input.addEventListener("change", () => this.saveSettings());
                    return input;
                })
            );

            const actions = document.createElement("div");
            actions.className = "dct-button-row";

            if (this.settings.preferredProviderId !== providerId) {
                const makeDefaultBtn = this.createSetDefaultButton(providerId, rerender);
                actions.appendChild(makeDefaultBtn);
            }

            const testBtn = document.createElement("button");
            testBtn.className = "dct-button";
            testBtn.textContent = "测试 API";
            testBtn.addEventListener("click", async event => {
                event.stopPropagation();
                await this.testProvider(providerId, testBtn);
            });
            actions.appendChild(testBtn);

            if (Object.keys(this.settings.providers).length > 1) {
                const removeBtn = document.createElement("button");
                removeBtn.className = "dct-button secondary";
                removeBtn.textContent = "删除";
                removeBtn.addEventListener("click", event => {
                    event.stopPropagation();
                    delete this.settings.providers[providerId];
                    if (this.settings.preferredProviderId === providerId) {
                        this.settings.preferredProviderId = Object.keys(this.settings.providers)[0] || "";
                    }
                    this.saveSettings();
                    rerender();
                });
                actions.appendChild(removeBtn);
            }

            body.appendChild(actions);
            details.appendChild(body);
            wrapper.appendChild(details);
        });

        card.appendChild(wrapper);
        return card;
    }

    createLanguageSelectField(label, getCurrentValue, onValueChange) {
        return this.createField(label, () => {
            const select = document.createElement("select");
            const currentValue = getCurrentValue();
            LANGUAGE_OPTIONS.forEach(optionValue => {
                const option = document.createElement("option");
                option.value = optionValue;
                option.textContent = optionValue;
                select.appendChild(option);
            });
            if (currentValue && !LANGUAGE_OPTIONS.includes(currentValue)) {
                const customOption = document.createElement("option");
                customOption.value = currentValue;
                customOption.textContent = currentValue || "自定义";
                select.appendChild(customOption);
            }
            select.value = currentValue;
            select.addEventListener("change", () => {
                onValueChange(select.value);
            });
            return select;
        });
    }

    createSetDefaultButton(providerId, rerender) {
        const button = document.createElement("button");
        button.className = "dct-button primary";
        button.dataset.role = "set-default";
        button.textContent = "设为默认";
        button.addEventListener("click", event => {
            event.stopPropagation();
            const details = event.currentTarget.closest('.dct-providerCard');
            this.settings.preferredProviderId = providerId;
            this.saveSettings();
            this.updateProviderDefaultVisuals(details, rerender);
            this.toast("已设为默认接口", "success");
        });
        return button;
    }

    updateProviderDefaultVisuals(activeDetails, rerender) {
        if (!activeDetails) {
            return;
        }
        const list = activeDetails.parentElement;
        if (!list) {
            return;
        }
        const cards = list.querySelectorAll('.dct-providerCard');
        cards.forEach(card => {
            card.classList.remove('default');
            const summary = card.querySelector('.dct-cardSummary');
            const chip = summary?.querySelector('.dct-chip');
            if (chip) {
                chip.remove();
            }
            const actions = card.querySelector('.dct-button-row');
            if (!actions) {
                return;
            }
            const existingSetDefault = actions.querySelector('.dct-button.primary[data-role="set-default"]');
            if (card === activeDetails) {
                if (existingSetDefault) {
                    existingSetDefault.remove();
                }
            } else if (!existingSetDefault) {
                const providerId = card.dataset.providerId;
                if (providerId) {
                    const newButton = this.createSetDefaultButton(providerId, rerender);
                    actions.insertBefore(newButton, actions.firstChild);
                }
            }
        });
        activeDetails.classList.add('default');
        activeDetails.open = true;
        const activeSummary = activeDetails.querySelector('.dct-cardSummary');
        if (activeSummary && !activeSummary.querySelector('.dct-chip')) {
            const chip = document.createElement('span');
            chip.className = 'dct-chip';
            chip.textContent = '默认';
            activeSummary.appendChild(chip);
        }
    }

    buildEmptyProviderNotice() {
        const card = document.createElement("div");
        card.className = "dct-card dct-empty";
        const text = document.createElement("p");
        text.textContent = "暂无接口，请点击“新增接口”创建配置。";
        card.appendChild(text);
        return card;
    }

    createField(labelText, noteOrBuilder, maybeBuilder) {
        let noteText = null;
        let inputBuilder = maybeBuilder;
        if (typeof noteOrBuilder === "function") {
            inputBuilder = noteOrBuilder;
        } else {
            noteText = noteOrBuilder;
        }
        const field = document.createElement("div");
        field.className = "dct-settings-field";
        const label = document.createElement("label");
        label.textContent = labelText;
        field.appendChild(label);
        if (noteText) {
            const note = document.createElement("small");
            note.textContent = noteText;
            field.appendChild(note);
        }
        field.appendChild(inputBuilder());
        return field;
    }

    openAddProviderMenu(anchor, rerender) {
        this.closeAddProviderMenu();

        const menu = document.createElement("div");
        menu.className = "dct-popover";

        const rect = anchor.getBoundingClientRect();
        menu.style.left = `${rect.left + window.scrollX}px`;
        menu.style.top = `${rect.bottom + 8 + window.scrollY}px`;

        let onOutside;
        let listenerAttached = false;
        const closeMenu = () => {
            if (!menu.isConnected) {
                return;
            }
            menu.remove();
            if (listenerAttached) {
                document.removeEventListener("click", onOutside, true);
                listenerAttached = false;
            }
            this.activeAddProviderMenu = null;
        };

        const addButton = (label, onSelect, style = "secondary") => {
            const button = document.createElement("button");
            button.className = `dct-button ${style}`;
            button.textContent = label;
            button.addEventListener("click", event => {
                event.stopPropagation();
                onSelect();
                closeMenu();
            });
            menu.appendChild(button);
        };

        PRESET_MENU_KEYS.forEach(presetKey => {
            const spec = PRESET_PROVIDERS[presetKey];
            if (!spec) {
                return;
            }
            addButton(spec.label, () => {
                const { id: newId, counter } = this.generateUniqueProviderId(presetKey);
                const labelSuffix = counter > 1 ? ` ${counter}` : "";
                const providerConfig = createPresetProviderConfig(presetKey, {
                    label: `${spec.label}${labelSuffix}`.trim()
                });
                this.settings.providers[newId] = this.clone(providerConfig);
                if (!this.settings.preferredProviderId) {
                    this.settings.preferredProviderId = newId;
                }
                this.saveSettings();
                rerender({ focusProviderId: newId, scrollToProviderId: newId });
            });
        });

        addButton("自定义 API", () => {
            const { id: newId, counter } = this.generateUniqueProviderId("custom");
            const label = counter > 1 ? `自定义接口 ${counter}` : "自定义接口";
            this.settings.providers[newId] = this.clone({
                label,
                type: "custom",
                apiKey: "",
                baseUrl: "https://api.openai.com/v1/chat/completions",
                modelId: "gpt-3.5-turbo"
            });
            if (!this.settings.preferredProviderId) {
                this.settings.preferredProviderId = newId;
            }
            this.saveSettings();
            rerender({ focusProviderId: newId, scrollToProviderId: newId });
        }, "primary");

        document.body.appendChild(menu);

        onOutside = event => {
            if (!menu.contains(event.target) && event.target !== anchor) {
                closeMenu();
            }
        };

        this.activeAddProviderMenu = closeMenu;
        setTimeout(() => {
            if (this.activeAddProviderMenu === closeMenu) {
                document.addEventListener("click", onOutside, true);
                listenerAttached = true;
            }
        }, 0);
    }

    closeAddProviderMenu() {
        if (typeof this.activeAddProviderMenu === "function") {
            this.activeAddProviderMenu();
        }
    }

    generateUniqueProviderId(baseId) {
        const providers = this.settings.providers || {};
        if (!providers[baseId]) {
            return { id: baseId, counter: 1 };
        }
        let index = 2;
        let candidate = `${baseId}_${index}`;
        while (providers[candidate]) {
            index += 1;
            candidate = `${baseId}_${index}`;
        }
        return { id: candidate, counter: index };
    }

    findPresetKeyByBase(baseUrl) {
        if (!baseUrl) {
            return null;
        }
        const normalized = baseUrl.trim().toLowerCase();
        for (const [key, spec] of Object.entries(PRESET_PROVIDERS)) {
            if (spec.baseUrl.toLowerCase() === normalized) {
                return key;
            }
        }
        return null;
    }

    getPresetSpec(provider) {
        if (!provider) {
            return null;
        }
        const presetKey = provider.presetKey || this.findPresetKeyByBase(provider.baseUrl);
        if (!presetKey) {
            return null;
        }
        const spec = PRESET_PROVIDERS[presetKey];
        if (!spec) {
            return null;
        }
        return { key: presetKey, ...spec };
    }


    handleDoubleClick(event) {
        if (event.button !== 0) {
            return;
        }
        if (event.target.closest(".dct-translation")) {
            return;
        }
        if (event.target.closest(".dct-settingsPanel")) {
            return;
        }

        const messageElement = event.target.closest('[data-list-item-id^="chat-messages"], [id^="chat-messages"], li[class*="message-"]');
        if (!messageElement) {
            return;
        }

        const messageKey = this.getMessageKey(messageElement);
        const existing = this.injectedTranslations.get(messageKey);
        if (existing) {
            const state = existing.dataset.state;
            if (state === "loading") {
                this.abortPending(messageKey);
                this.setTranslationError(existing, "已取消");
            }
            const parent = existing.parentElement;
            existing.remove();
            if (parent && parent.classList?.contains("dct-translation-container") && parent.childElementCount === 0) {
                parent.remove();
            }
            this.injectedTranslations.delete(messageKey);
            return;
        }

        const contentNode = this.findMessageContentNode(messageElement);
        if (!contentNode) {
            this.toast("没有找到消息内容", "error");
            return;
        }

        this.clearSelection();

        const { segments, mainText, quotedTexts } = this.extractMessageParts(messageElement, contentNode);

        if (segments.length === 0) {
            this.toast("该消息没有需要翻译的文本", "info");
            return;
        }

        const provider = this.getActiveProvider();
        if (!provider) {
            this.toast("请先在设置中配置翻译接口", "error");
            return;
        }

        const container = this.getTranslationContainer(messageElement);
        const translationEl = this.createTranslationElement(segments);
        container.appendChild(translationEl);
        this.injectedTranslations.set(messageKey, translationEl);

        const textSignature = this.buildTextSignature(mainText, quotedTexts);
        const providerSignature = this.getProviderSignature(provider);
        const cached = this.translationCache.get(messageKey);
        if (
            cached &&
            cached.textSignature === textSignature &&
            cached.providerSignature === providerSignature &&
            cached.targetLanguage === this.settings.doubleClickTargetLanguage
        ) {
            this.renderTranslationSegments(translationEl, cached.segments);
            translationEl.dataset.state = "done";
            return;
        }

        translationEl.dataset.state = "loading";

        this.translateMessage(messageKey, segments, provider, providerSignature, textSignature).catch(error => {
            console.error(`[${this.pluginName}] translateMessage error`, error);
        });
    }

    createTranslationElement(segments = []) {
        const wrapper = document.createElement("div");
        wrapper.className = "dct-translation";
        wrapper.dataset.state = "idle";

        const body = document.createElement("div");
        body.className = "dct-translation-body";
        if (!segments.length) {
            body.textContent = "翻译中…";
        }

        wrapper.append(body);

        if (segments.length) {
            const placeholderSegments = segments.map(segment => ({ ...segment, translation: null }));
            this.renderTranslationSegments(wrapper, placeholderSegments);
        }
        return wrapper;
    }

    async translateMessage(messageKey, segments, provider, providerSignature, textSignature) {
        const translationEl = this.injectedTranslations.get(messageKey);
        if (!translationEl) {
            return;
        }
        translationEl.dataset.state = "loading";

        const controller = this.createAbortController(messageKey);

        try {
            const results = [];
            for (const segment of segments) {
                if (!segment.text) {
                    results.push({ ...segment, translation: "" });
                    continue;
                }
                const translation = await this.performRequest(
                    provider,
                    segment.text,
                    controller,
                    this.settings.doubleClickTargetLanguage
                );
                if (!this.injectedTranslations.has(messageKey) || controller.signal.aborted) {
                    return;
                }
                results.push({ ...segment, translation: translation.trim() });
            }

            this.renderTranslationSegments(translationEl, results);
            translationEl.dataset.state = "done";
            this.translationCache.set(messageKey, {
                segments: results,
                textSignature,
                providerSignature,
                targetLanguage: this.settings.doubleClickTargetLanguage,
                timestamp: Date.now()
            });
        } catch (error) {
            if (controller.signal.aborted) {
                return;
            }
            console.error(`[${this.pluginName}]`, error);
            this.setTranslationError(translationEl, error.message || String(error));
            this.toast(`翻译失败: ${error.message || error}`, "error");
        } finally {
            this.pendingControllers.delete(messageKey);
        }
    }

    renderTranslationSegments(element, segments) {
        const body = element.querySelector?.(".dct-translation-body");
        if (!body) {
            return;
        }
        if (!segments || !segments.length) {
            body.textContent = "翻译中…";
            return;
        }
        body.replaceChildren();
        segments.forEach((segment, index) => {
            const segmentEl = document.createElement("div");
            segmentEl.className = `dct-translation-segment ${segment.type}`;
            segmentEl.dataset.segmentIndex = String(index);

            segmentEl.textContent = segment.translation ? segment.translation : "翻译中…";
            body.appendChild(segmentEl);
        });
    }

    async performRequest(provider, text, controller, targetLanguage = this.settings.doubleClickTargetLanguage) {
        if (!provider) {
            throw new Error("未找到可用的翻译接口");
        }

        const endpoint = (provider.baseUrl || "").trim();
        if (!endpoint) {
            throw new Error("Base URL 未配置");
        }

        const headers = {
            "Content-Type": "application/json"
        };
        if (provider.apiKey) {
            headers.Authorization = `Bearer ${provider.apiKey}`;
        }

        const payload = {
            model: provider.modelId || "gpt-3.5-turbo",
            messages: [
                {
                    role: "system",
                    content: "翻译结果在符合原意的基础上，可以进行口语化/网络用语化/年轻化的加工。\n注意：最终只需要译文，不要出现其他任何提示或者解释或者思考过程，仅需要输出译文。"
                },
                {
                    role: "user",
                    content: `Please translate the following message into ${targetLanguage} and reply with translation only: ${text}`
                }
            ],
            temperature: 0.2
        };

        const options = {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal
        };

        const timeoutId = setTimeout(() => controller.abort(), this.settings.requestTimeoutMs);
        try {
            const response = await this.fetchWithFallback(endpoint, options);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const contentType = response.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
                const data = await response.json();
                return this.extractTranslation(data);
            }
            const textBody = await response.text();
            return this.extractTranslation(textBody);
        } finally {
            clearTimeout(timeoutId);
        }
    }

    fetchWithFallback(url, options) {
        if (BdApi?.Net?.fetch) {
            return BdApi.Net.fetch(url, options);
        }
        return fetch(url, options);
    }

    getActiveProvider() {
        const providers = this.settings.providers || {};
        const providerId = this.settings.preferredProviderId;
        if (providerId && providers[providerId]) {
            return providers[providerId];
        }
        return null;
    }

    getProviderSignature(provider = this.getActiveProvider()) {
        if (!provider) {
            return "none";
        }
        const keyFragment = provider.apiKey ? provider.apiKey.slice(0, 8) : "";
        return `${provider.baseUrl || ""}|${provider.modelId || ""}|${keyFragment}`;
    }

    extractMessageParts(messageElement, contentNode) {
        const cleanText = text =>
            (text || "")
                .replace(/[\u200B\u200D\uFEFF]/g, "")
                .replace(/\r?\n{3,}/g, "\n\n")
                .trim();

        const segments = [];
        const quoteTexts = [];
        const contentNodes = Array.from(
            messageElement.querySelectorAll('[class*="messageContent"], [class*="markup-"]')
        ).filter(node => cleanText(node.textContent));

        let mainText = "";

        if (contentNodes.length >= 2) {
            const quoteNode = contentNodes[0];
            const replyNodes = contentNodes.slice(1);

            const quote = cleanText(quoteNode.textContent);
            if (quote && !quoteTexts.includes(quote)) {
                quoteTexts.push(quote);
                segments.push({ type: 'quote', text: quote });
            }

            mainText = cleanText(replyNodes.map(node => node.textContent).join('\n\n'));
        }

        if (mainText && quoteTexts.includes(mainText)) {
            mainText = "";
        }

        if (!mainText) {
            const primary = contentNode || messageElement.querySelector('[id^="message-content-"]');
            if (primary) {
                const clone = primary.cloneNode(true);
                clone.querySelectorAll('[class*="repliedMessage"], [class*="repliedText"], blockquote').forEach(node => node.remove());
                mainText = cleanText(clone.textContent);
                if (quoteTexts.includes(mainText)) {
                    mainText = "";
                }
            }
        }

        if (!mainText) {
            mainText = cleanText(messageElement.textContent);
            if (quoteTexts.includes(mainText)) {
                mainText = "";
            }
        }

        if (segments.length === 0 && mainText) {
            segments.push({ type: 'main', text: mainText });
        } else if (mainText && !segments.some(segment => segment.type === 'main' && segment.text === mainText)) {
            segments.push({ type: 'main', text: mainText });
        }

        return { segments, mainText, quotedTexts: quoteTexts };
    }

    buildTextSignature(mainText, quotedTexts) {
        return JSON.stringify({
            main: mainText || "",
            quotes: quotedTexts || []
        });
    }

    clearSelection() {
        if (typeof window === "undefined" || typeof window.getSelection !== "function") {
            return;
        }
        const selection = window.getSelection();
        if (selection && selection.removeAllRanges) {
            selection.removeAllRanges();
        }
    }

    getTranslationContainer(messageElement) {
        const host = messageElement.querySelector(':scope > div[class*="contents-"]') || messageElement;
        let container = Array.from(host.children || []).find(child => child.classList?.contains('dct-translation-container'));
        if (container) {
            return container;
        }
        container = document.createElement('div');
        container.className = 'dct-translation-container';
        host.appendChild(container);
        return container;
    }

    async testProvider(providerId, button) {
        const providers = this.settings.providers || {};
        const provider = providers[providerId];
        if (!provider) {
            this.toast("接口不存在", "error");
            return;
        }
        if (!provider.baseUrl) {
            this.toast("请先填写 Base URL", "error");
            return;
        }

        const originalLabel = button?.textContent;
        if (button) {
            button.disabled = true;
            button.textContent = "测试中…";
        }

        const controller = new AbortController();
        try {
            const probeText = "Hello, this is a connectivity test.";
            const translation = await this.performRequest(
                provider,
                probeText,
                controller,
                this.settings.doubleClickTargetLanguage
            );
            const preview = typeof translation === "string" ? translation.slice(0, 48) : "";
            const suffix = translation && translation.length > 48 ? "…" : "";
            this.toast(`API 测试成功${preview ? `：${preview}${suffix}` : ""}`, "success");
        } catch (error) {
            console.error(`[${this.pluginName}] testProvider`, error);
            this.toast(`测试失败: ${error.message || error}`, "error");
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = originalLabel || "测试 API";
            }
        }
    }

    extractTranslation(data) {
        if (typeof data === "string") {
            const trimmed = data.trim();
            if (trimmed) {
                return trimmed;
            }
            throw new Error("响应内容为空");
        }

        if (data && typeof data === "object") {
            if (Array.isArray(data.choices) && data.choices.length > 0) {
                const choice = data.choices[0];
                const messageContent = choice?.message?.content;
                if (typeof messageContent === "string" && messageContent.trim()) {
                    return messageContent.trim();
                }
                if (typeof choice?.text === "string" && choice.text.trim()) {
                    return choice.text.trim();
                }
            }
            if (typeof data.translation === "string" && data.translation.trim()) {
                return data.translation.trim();
            }
        }

        throw new Error("未能从响应中提取译文");
    }

    createAbortController(messageKey) {
        this.abortPending(messageKey);
        const controller = new AbortController();
        this.pendingControllers.set(messageKey, controller);
        return controller;
    }

    abortPending(messageKey) {
        const controller = this.pendingControllers.get(messageKey);
        if (controller) {
            controller.abort();
        }
        this.pendingControllers.delete(messageKey);
    }

    abortAllPending() {
        for (const controller of this.pendingControllers.values()) {
            controller.abort();
        }
        this.pendingControllers.clear();
    }

    setTranslationError(element, message) {
        element.dataset.state = "error";
        const body = element.querySelector(".dct-translation-body");
        if (body) {
            body.textContent = message;
        }
    }

    cleanupInjectedTranslations() {
        for (const element of this.injectedTranslations.values()) {
            const parent = element.parentElement;
            element.remove();
            if (parent && parent.classList?.contains("dct-translation-container") && parent.childElementCount === 0) {
                parent.remove();
            }
        }
        this.injectedTranslations.clear();
    }

    findMessageContentNode(messageElement) {
        return (
            messageElement.querySelector('[id^="message-content-"]') ||
            messageElement.querySelector('[class*="messageContent"]') ||
            messageElement.querySelector('div[class*="markup-"]') ||
            messageElement
        );
    }

    getMessageKey(messageElement) {
        const datasetId = messageElement.getAttribute("data-list-item-id");
        if (datasetId) {
            return datasetId;
        }
        const nodeId = messageElement.id;
        if (nodeId) {
            return nodeId;
        }
        let customId = messageElement.getAttribute("data-dct-key");
        if (!customId) {
            customId = `${this.pluginName}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            messageElement.setAttribute("data-dct-key", customId);
        }
        return customId;
    }

    toast(message, type = "info") {
        if (BdApi?.UI?.showToast) {
            BdApi.UI.showToast(message, { type });
        }
    }

    loadSettings() {
        const saved = BdApi.Data.load(this.pluginName, "settings");
        const merged = this.clone(this.defaults);
        if (!saved) {
            return merged;
        }
        const normalized = this.clone(saved);

        if (!normalized.providers) {
            const providerSource = normalized.provider || null;
            if (providerSource) {
                const normalizedProvider = this.normalizeProvider(providerSource, "custom");
                const providerId = normalizedProvider.type === "preset"
                    ? normalizedProvider.presetKey
                    : "custom";
                normalized.providers = { [providerId]: normalizedProvider };
                normalized.preferredProviderId = providerId;
            } else {
                normalized.providers = {};
                normalized.preferredProviderId = "";
            }
        } else {
            const migrated = {};
            for (const [providerId, provider] of Object.entries(normalized.providers)) {
                migrated[providerId] = this.normalizeProvider(provider, providerId);
            }
            normalized.providers = migrated;
        }

        if (!normalized.preferredProviderId || !normalized.providers[normalized.preferredProviderId]) {
            normalized.preferredProviderId = Object.keys(normalized.providers)[0] || "";
        }

        delete normalized.provider;

        if (normalized.targetLanguage && !normalized.doubleClickTargetLanguage) {
            normalized.doubleClickTargetLanguage = normalized.targetLanguage;
        }
        if (!normalized.inputTargetLanguage) {
            normalized.inputTargetLanguage = normalized.doubleClickTargetLanguage || normalized.targetLanguage || this.defaults.inputTargetLanguage;
        }
        delete normalized.targetLanguage;

        return this.deepMerge(merged, normalized);
    }

    normalizeProvider(provider = {}, fallbackId = "") {
        let presetKey = provider.presetKey;
        if (!presetKey) {
            if (PRESET_PROVIDERS[fallbackId]) {
                presetKey = fallbackId;
            } else {
                const inferred = this.findPresetKeyByBase(provider.baseUrl || provider.endpoint);
                if (inferred) {
                    presetKey = inferred;
                }
            }
        }

        if (presetKey && PRESET_PROVIDERS[presetKey]) {
            const spec = PRESET_PROVIDERS[presetKey];
            const modelId = (provider.modelId || provider.model || provider.variables?.model || spec.defaultModel).trim() || spec.defaultModel;
            const apiKey = (provider.apiKey || provider.variables?.apiKey || "").trim();
            const label = (provider.label || spec.label).trim() || spec.label;
            return {
                label,
                type: "preset",
                presetKey,
                apiKey,
                baseUrl: spec.baseUrl,
                modelId
            };
        }

        const baseUrl = (provider.baseUrl || provider.endpoint || "").trim() ||
            "https://api.openai.com/v1/chat/completions";
        const modelId = (provider.modelId || provider.model || provider.variables?.model || "gpt-3.5-turbo").trim();
        const label = (provider.label || provider.name || fallbackId || "自定义接口").trim() || "自定义接口";
        const apiKey = (provider.apiKey || provider.variables?.apiKey || "").trim();
        return { label, type: "custom", apiKey, baseUrl, modelId };
    }

    saveSettings(options = {}) {
        BdApi.Data.save(this.pluginName, "settings", this.settings);
        if (options.skipRuntimeReset) {
            return;
        }
        this.abortAllPending();
        this.cleanupInjectedTranslations();
        this.translationCache.clear();
    }

    deepMerge(target, source) {
        if (typeof source !== "object" || source === null) {
            return target;
        }
        for (const [key, value] of Object.entries(source)) {
            if (value && typeof value === "object" && !Array.isArray(value)) {
                if (!target[key] || typeof target[key] !== "object") {
                    target[key] = Array.isArray(value) ? [] : {};
                }
                this.deepMerge(target[key], value);
            } else {
                target[key] = value;
            }
        }
        return target;
    }

    clone(data) {
        if (typeof structuredClone === "function") {
            return structuredClone(data);
        }
        return JSON.parse(JSON.stringify(data));
    }
}

module.exports = MaiGeTranslate;
