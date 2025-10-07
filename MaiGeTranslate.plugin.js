/**
 * @name MaiGeTranslate
 * @description 更适合中国宝宝体质的翻译插件，双击翻译+输入翻译！
 * @version 0.3.0
 * @website https://x.com/unflwMaige
 * @author Maige
 */

const PLUGIN_NAME = "MaiGeTranslate";
const PLUGIN_VERSION = "0.3.0";

const LANGUAGE_OPTIONS = [
    "简体中文",
    "English",
    "日本語",
    "한국어",
    "Español",
    "Français",
    "Deutsch"
];

const LANGUAGE_NAME_TO_CODE = {
    "简体中文": "zh-CN",
    "English": "en",
    "日本語": "ja",
    "한국어": "ko",
    "Español": "es",
    "Français": "fr",
    "Deutsch": "de"
};

const LANGUAGE_CODE_TO_NAME = Object.fromEntries(
    Object.entries(LANGUAGE_NAME_TO_CODE).map(([name, code]) => [code, name])
);

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
        throw new Error("Unknown preset provider: " + presetKey);
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

const DEFAULT_PROMPT = "翻译结果在符合原意的基础上，可以进行口语化/网络用语化/年轻化的加工。\n注意：最终只需要译文，不要出现其他任何提示或者解释或者思考过程，仅需要输出译文。";

const defaultSettings = {
    preferredProviderId: "",
    doubleClickTargetLanguage: "简体中文",
    inputTargetLanguage: "English",
    inputTranslationEnabled: true,
    translationPrompt: DEFAULT_PROMPT,
    translationCacheLimitMB: 10,
    requestTimeoutMs: 20000,
    providers: {},
    translateButtonPosition: null,
    translationStyle: "card",
    translationStyleColor: "",
    translationStyleOpacity: 0.6,
    translationTextColor: "",
    translationTextOpacity: 1,
    terminologyLibraries: []
};

const TRANSLATION_STYLE_OPTIONS = [
    { value: "card", label: "卡片" },
    { value: "plain", label: "纯文本" },
    { value: "underline", label: "下划线" },
    { value: "wave", label: "波浪线" },
    { value: "marker", label: "马克笔" },
    { value: "italic", label: "斜体" },
    { value: "bold", label: "粗体" }
];

const TRANSLATION_STYLE_CLASSES = TRANSLATION_STYLE_OPTIONS.map(option => `dct-style-${option.value}`);

const DEFAULT_STYLE_COLOR_HEX = "#2f3136";
const DEFAULT_TEXT_COLOR_HEX = "#ffffff";

const clampCacheLimit = value => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return defaultSettings.translationCacheLimitMB;
    }
    return Math.max(1, Math.min(50, numeric));
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
        this.translationCacheSizes = new Map();
        this.translationCacheSizeBytes = 0;
        this.stylesInjected = false;
        this.activeAddProviderMenu = null;
        this.translateButton = null;
        this.translateInput = null;
        this.translateButtonDragState = {
            active: false,
            pointerId: null,
            offsetX: 0,
            offsetY: 0,
            moved: false,
            justDragged: false
        };
        this.composerTranslationController = null;

        this.boundTranslateInputKeyDown = this.handleTranslateInputKeyDown.bind(this);
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
        return "更适合中国宝宝体质的翻译插件，双击翻译+输入翻译！";
    }

    load() {}

    start() {
        this.settings = this.loadSettings();
        this.ensureStyles();
        this.updateTranslateButtonVisibility();
        window.addEventListener("resize", this.boundWindowResize);
        document.addEventListener("dblclick", this.doubleClickHandler, true);
    }

    stop() {
        document.removeEventListener("dblclick", this.doubleClickHandler, true);
        this.abortAllPending();
        this.cleanupInjectedTranslations();
        this.clearTranslationCache();
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
                padding: 0;
                border-radius: 0;
                background: none;
                border: none;
                font-size: 0.95em;
                color: var(--dct-translation-text-color, var(--text-normal, #fff));
                white-space: pre-wrap;
                display: inline-flex;
                flex-direction: column;
                width: auto;
                max-width: min(100%, 640px);
                align-self: flex-start;
            }
            .dct-translation.dct-style-card {
                padding: 8px 10px;
                border-radius: 8px;
                background: var(--background-secondary, #2f3136);
                border: 1px solid var(--background-tertiary, #202225);
            }
            .dct-translation.dct-style-card.dct-has-accent {
                background: var(--dct-translation-accent-color);
                border-color: var(--dct-translation-accent-color);
            }
            .dct-translation[data-state="loading"] {
                opacity: 0.85;
            }
            .dct-translation[data-state="error"] {
                color: var(--text-danger, #f04747);
            }
            .dct-translation.dct-style-card[data-state="error"] {
                border-color: var(--status-danger, #ed4245);
            }
            .dct-translation.dct-style-underline .dct-translation-segment {
                text-decoration: underline;
                text-decoration-thickness: 2px;
                text-decoration-color: var(--dct-translation-accent-color, currentColor);
            }
            .dct-translation.dct-style-wave .dct-translation-segment {
                text-decoration: underline wavy;
                text-decoration-thickness: 2px;
                text-decoration-color: var(--dct-translation-accent-color, currentColor);
            }
            .dct-translation.dct-style-marker {
                padding: 2px 0;
            }
            .dct-translation.dct-style-marker .dct-translation-segment {
                background: var(--dct-translation-accent-color, rgba(254, 240, 138, 0.9));
                border-radius: 4px;
                padding: 2px 4px;
            }
            .dct-translation.dct-style-italic .dct-translation-segment {
                font-style: italic;
            }
            .dct-translation.dct-style-bold .dct-translation-segment {
                font-weight: 700;
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
            .dct-toggleField {
                margin-top: 12px;
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
            .dct-toggle {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
            }
            .dct-toggleLabel {
                font-weight: 600;
                color: #0f172a;
            }
            .dct-switch {
                width: 42px;
                height: 22px;
                border-radius: 999px;
                background: #cbd5e1;
                border: none;
                padding: 0;
                position: relative;
                cursor: pointer;
                transition: background 0.18s ease;
            }
            .dct-switch:focus-visible {
                outline: 2px solid rgba(59, 130, 246, 0.45);
                outline-offset: 2px;
            }
            .dct-switchThumb {
                position: absolute;
                top: 3px;
                left: 4px;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: #ffffff;
                box-shadow: 0 2px 6px rgba(15, 23, 42, 0.2);
                transition: transform 0.18s ease;
            }
            .dct-switch[data-checked="true"] {
                background: linear-gradient(135deg, #3b82f6, #2563eb);
            }
            .dct-switch[data-checked="true"] .dct-switchThumb {
                transform: translateX(18px);
            }
            .dct-settings-field textarea {
                min-height: 120px;
                font-family: var(--font-code, monospace);
                white-space: pre;
            }
            .dct-inline {
                display: flex;
                align-items: center;
                gap: 12px;
                flex-wrap: wrap;
            }
            .dct-inline input[type="number"] {
                width: 90px;
                height: 32px;
                padding: 4px 8px;
                border-radius: 6px;
            }
            .dct-inline .dct-fieldHint {
                color: #64748b;
                font-size: 12px;
                line-height: 1.4;
                align-self: center;
            }
            .dct-inline input[type="color"] {
                width: 36px;
                height: 32px;
                padding: 0;
                border: 1px solid #cbd5e1;
                border-radius: 6px;
                background: transparent;
                box-sizing: border-box;
                cursor: pointer;
            }
            .dct-inline input[type="color"]::-webkit-color-swatch-wrapper {
                padding: 2px;
            }
            .dct-inline input[type="color"]::-webkit-color-swatch {
                border-radius: 4px;
                border: none;
            }
            .dct-inline .dct-button.secondary {
                height: 32px;
                display: inline-flex;
                align-items: center;
                padding: 0 12px;
            }
            .dct-generalSettings {
                display: flex;
                flex-direction: column;
                gap: 18px;
            }
            .dct-generalHeading {
                font-size: 20px;
                font-weight: 700;
                color: #0f172a;
                margin: 0;
            }
            .dct-generalGrid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
                gap: 16px;
            }
            .dct-generalCard {
                border-radius: 14px;
                background: #ffffff;
                border: 1px solid #e2e8f0;
                box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
                padding: 18px 20px;
                display: flex;
                flex-direction: column;
                gap: 14px;
            }
            .dct-generalCardTitle {
                font-size: 16px;
                font-weight: 700;
                color: #0f172a;
                margin: 0;
            }
            .dct-generalCardBody {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .dct-generalCardBody .dct-settings-field {
                margin: 0;
            }
            .dct-cacheSummary {
                display: flex;
                align-items: center;
                gap: 12px;
            }
            .dct-cacheSummary button {
                margin-left: auto;
            }
            .dct-terminologyList {
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-height: 360px;
                overflow-y: auto;
            }
            .dct-terminologyItem {
                border: 1px solid #e2e8f0;
                border-radius: 12px;
                padding: 12px 14px;
                background: rgba(248, 250, 252, 0.9);
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .dct-terminologyHeader {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
            }
            .dct-terminologyTitle {
                font-weight: 700;
                color: #0f172a;
                font-size: 15px;
                margin: 0;
            }
            .dct-terminologyMeta {
                font-size: 12px;
                color: #64748b;
            }
            .dct-terminologyActions {
                display: flex;
                gap: 8px;
            }
            .dct-terminologyEmpty {
                text-align: center;
                color: #64748b;
                font-size: 13px;
                padding: 16px;
                border: 1px dashed #cbd5e1;
                border-radius: 12px;
                background: rgba(241, 245, 249, 0.6);
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
            .dct-translate-input {
                position: fixed;
                z-index: 10000;
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 12px;
                border-radius: 10px;
                border: 1px solid rgba(15, 23, 42, 0.35);
                background: rgba(15, 23, 42, 0.92);
                box-shadow: 0 8px 18px rgba(15, 23, 42, 0.28);
                user-select: none;
                transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
            }
            .dct-translate-input[data-dragging="true"] {
                cursor: grabbing;
                box-shadow: 0 6px 14px rgba(15, 23, 42, 0.24);
                transform: scale(1.02);
            }
            .dct-translate-input input {
                width: 220px;
                background: transparent;
                color: #ffffff;
                border: none;
                outline: none;
                font-size: 14px;
            }
            .dct-translate-input input::placeholder {
                color: rgba(226, 232, 240, 0.7);
            }
            .dct-translate-input[data-state="loading"] input {
                opacity: 0.6;
                pointer-events: none;
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
        const container = document.createElement("div");
        container.className = "dct-translate-input";
        container.dataset.state = "idle";
        container.addEventListener("pointerdown", this.boundTranslateButtonPointerDown);

        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = this.getTranslateInputPlaceholder();
        input.addEventListener("keydown", this.boundTranslateInputKeyDown);
        container.appendChild(input);

        document.body.appendChild(container);
        this.translateButton = container;
        this.translateInput = input;
        requestAnimationFrame(() => this.updateTranslateButtonPosition());
    }

    removeTranslateButton() {
        const button = this.translateButton;
        if (!button) {
            return;
        }
        button.removeEventListener("pointerdown", this.boundTranslateButtonPointerDown);
        this.detachTranslateButtonDragListeners();
        this.translateInput?.removeEventListener("keydown", this.boundTranslateInputKeyDown);
        button.remove();
        this.translateButton = null;
        this.translateInput = null;
        this.resetTranslateButtonDragState();
    }

    updateTranslateButtonVisibility() {
        if (this.settings.inputTranslationEnabled) {
            if (!this.translateButton) {
                this.injectTranslateButton();
            } else {
                this.updateTranslateInputPlaceholder();
            }
        } else {
            this.removeTranslateButton();
        }
    }

    updateTranslateInputPlaceholder() {
        if (this.translateInput) {
            this.translateInput.placeholder = this.getTranslateInputPlaceholder();
        }
    }

    getTranslateInputPlaceholder() {
        return `输入文本，回车翻译并复制为 ${this.settings.inputTargetLanguage}`;
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

    detachTranslateButtonDragListeners() {
        document.removeEventListener("pointermove", this.boundTranslateButtonPointerMove);
        document.removeEventListener("pointerup", this.boundTranslateButtonPointerUp);
        document.removeEventListener("pointercancel", this.boundTranslateButtonPointerCancel);
    }

    resetTranslateButtonDragState() {
        Object.assign(this.translateButtonDragState, {
            active: false,
            pointerId: null,
            offsetX: 0,
            offsetY: 0,
            moved: false,
            justDragged: false
        });
    }

    isValidHexColor(value) {
        return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim());
    }

    normalizeHexColorInput(value, fallback = DEFAULT_STYLE_COLOR_HEX) {
        if (this.isValidHexColor(value)) {
            return value.trim();
        }
        return fallback;
    }

    parseColorString(value) {
        if (typeof value !== "string") {
            return null;
        }
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }
        const hex6 = trimmed.match(/^#([0-9a-fA-F]{6})$/);
        if (hex6) {
            return { hex: `#${hex6[1].toLowerCase()}`, alpha: 1 };
        }
        const hex8 = trimmed.match(/^#([0-9a-fA-F]{8})$/);
        if (hex8) {
            const hexPart = hex8[1];
            const alpha = parseInt(hexPart.slice(6, 8), 16) / 255;
            return {
                hex: `#${hexPart.slice(0, 6).toLowerCase()}`,
                alpha: this.clampOpacity(alpha)
            };
        }
        const rgba = trimmed.match(/^rgba?\((\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(\d*\.?\d+))?\)$/i);
        if (rgba) {
            const r = Math.min(255, Math.max(0, Number(rgba[1])));
            const g = Math.min(255, Math.max(0, Number(rgba[2])));
            const b = Math.min(255, Math.max(0, Number(rgba[3])));
            const alpha = rgba[4] !== undefined ? this.clampOpacity(Number(rgba[4])) : 1;
            const toHex = component => component.toString(16).padStart(2, "0");
            return {
                hex: `#${toHex(r)}${toHex(g)}${toHex(b)}`,
                alpha
            };
        }
        return null;
    }

    clampOpacity(value, defaultValue = 0.6) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return defaultValue;
        }
        return Math.min(1, Math.max(0, numeric));
    }

    composeAccentColor(hex, opacity) {
        if (!this.isValidHexColor(hex)) {
            return "";
        }
        const normalized = hex.trim().replace("#", "");
        const r = parseInt(normalized.slice(0, 2), 16);
        const g = parseInt(normalized.slice(2, 4), 16);
        const b = parseInt(normalized.slice(4, 6), 16);
        const alpha = this.clampOpacity(opacity, this.defaults.translationStyleOpacity);
        return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
    }

    getActiveStyleAccentColor() {
        const hex = this.settings.translationStyleColor;
        const opacity = this.settings.translationStyleOpacity;
        if (!this.isValidHexColor(hex)) {
            return "";
        }
        return this.composeAccentColor(hex, opacity);
    }

    getActiveTextColor() {
        const hex = this.settings.translationTextColor;
        const opacity = this.settings.translationTextOpacity;
        if (!this.isValidHexColor(hex)) {
            return "";
        }
        return this.composeAccentColor(hex, opacity);
    }

    applyTranslationStyle(element) {
        if (!element) {
            return;
        }
        element.classList.remove(...TRANSLATION_STYLE_CLASSES);
        const styleValue = this.settings.translationStyle;
        const activeStyle = TRANSLATION_STYLE_OPTIONS.some(option => option.value === styleValue)
            ? styleValue
            : defaultSettings.translationStyle;
        element.classList.add(`dct-style-${activeStyle}`);
        const accent = this.getActiveStyleAccentColor();
        if (accent) {
            element.style.setProperty("--dct-translation-accent-color", accent);
            element.classList.add("dct-has-accent");
        } else {
            element.style.removeProperty("--dct-translation-accent-color");
            element.classList.remove("dct-has-accent");
        }
        const textColor = this.getActiveTextColor();
        if (textColor) {
            element.style.setProperty("--dct-translation-text-color", textColor);
        } else {
            element.style.removeProperty("--dct-translation-text-color");
        }
    }

    updateActiveTranslationStyles() {
        for (const element of this.injectedTranslations.values()) {
            this.applyTranslationStyle(element);
        }
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
        if (event.target === this.translateInput) {
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
        this.detachTranslateButtonDragListeners();
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
        this.resetTranslateButtonDragState();
        this.detachTranslateButtonDragListeners();
        if (this.translateButton) {
            this.translateButton.removeAttribute("data-dragging");
        }
    }

    handleTranslateInputKeyDown(event) {
        if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (this.translateButtonDragState.justDragged) {
            this.translateButtonDragState.justDragged = false;
            return;
        }
        if (this.composerTranslationController) {
            return;
        }
        const input = this.translateInput;
        const sourceText = input?.value.trim();
        if (!sourceText) {
            this.toast("请输入需要翻译的内容", "info");
            return;
        }

        const composer = this.findComposerEditor();
        if (!composer) {
            this.toast("未找到输入框", "error");
            return;
        }

        const provider = this.getActiveProvider();
        if (!provider) {
            this.toast("请先在设置中配置翻译接口", "error");
            return;
        }

        this.updateTranslateInputPlaceholder();
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
                if (input) {
                    input.value = "";
                    this.updateTranslateInputPlaceholder();
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
        if (this.translateInput) {
            this.translateInput.disabled = state === "loading";
            this.translateInput.placeholder = state === "loading"
                ? "翻译中…"
                : this.getTranslateInputPlaceholder();
        }
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
        return false;
    }

    getSettingsPanel() {
        const panel = document.createElement("div");
        panel.className = "dct-settingsPanel";

        const render = (options = {}) => {
            const previousScroll = panel.scrollTop;
            this.closeAddProviderMenu();
            panel.replaceChildren();
            panel.appendChild(this.buildGeneralSettings(render));
            panel.appendChild(
                this.buildProviderSettings(render, {
                    focusProviderId: options.focusProviderId,
                    forceOpenProviderId: options.forceOpenProviderId
                })
            );
            panel.appendChild(this.buildPromptSettings());

            let scrolled = false;
            if (options.scrollToProviderId) {
                const providerCard = panel.querySelector(`[data-provider-id="${options.scrollToProviderId}"]`);
                if (providerCard) {
                    providerCard.scrollIntoView({ block: "nearest" });
                    scrolled = true;
                }
            }
            if (!scrolled) {
                panel.scrollTop = previousScroll;
            }
        };

        render();
        return panel;
    }

    buildGeneralSettings(rerender = () => {}) {
        const layout = document.createElement("div");
        layout.className = "dct-generalSettings";

        const heading = document.createElement("h3");
        heading.className = "dct-generalHeading";
        heading.textContent = "通用设置";
        layout.appendChild(heading);

        const grid = document.createElement("div");
        grid.className = "dct-generalGrid";
        layout.appendChild(grid);

        const createCard = (title, fields = []) => {
            const card = document.createElement("div");
            card.className = "dct-generalCard";

            const heading = document.createElement("h3");
            heading.className = "dct-generalCardTitle";
            heading.textContent = title;
            card.appendChild(heading);

            const body = document.createElement("div");
            body.className = "dct-generalCardBody";
            fields.forEach(field => body.appendChild(field));
            card.appendChild(body);
            return card;
        };

        const behaviorFields = [
            this.createLanguageSelectField(
                "双击翻译目标语言",
                () => this.settings.doubleClickTargetLanguage,
                value => {
                    this.settings.doubleClickTargetLanguage = value;
                    this.saveSettings();
                }
            ),
            this.createLanguageSelectField(
                "输入翻译目标语言",
                () => this.settings.inputTargetLanguage,
                value => {
                    this.settings.inputTargetLanguage = value;
                    this.saveSettings();
                    this.updateTranslateInputPlaceholder();
                }
            ),
            this.createToggleField(
                "输入翻译",
                () => this.settings.inputTranslationEnabled !== false,
                value => {
                    this.settings.inputTranslationEnabled = value;
                    this.saveSettings({ skipRuntimeReset: true });
                    this.updateTranslateButtonVisibility();
                }
            )
        ];

        const appearanceFields = [
            this.createField("译文样式", () => {
                const select = document.createElement("select");
                const currentValue = this.settings.translationStyle || defaultSettings.translationStyle;
                TRANSLATION_STYLE_OPTIONS.forEach(option => {
                    const optionEl = document.createElement("option");
                    optionEl.value = option.value;
                    optionEl.textContent = option.label;
                    select.appendChild(optionEl);
                });
                select.value = TRANSLATION_STYLE_OPTIONS.some(option => option.value === currentValue)
                    ? currentValue
                    : defaultSettings.translationStyle;
                select.addEventListener("change", () => {
                    this.settings.translationStyle = select.value;
                    this.saveSettings({ skipRuntimeReset: true });
                    this.updateActiveTranslationStyles();
                });
                return select;
            }),
            this.buildColorControlsField(
                "译文样式颜色",
                DEFAULT_STYLE_COLOR_HEX,
                () => this.settings.translationStyleColor,
                value => {
                    this.settings.translationStyleColor = value;
                    this.updateActiveTranslationStyles();
                },
                () => {
                    this.settings.translationStyleColor = "";
                    this.settings.translationStyleOpacity = this.defaults.translationStyleOpacity;
                    this.updateActiveTranslationStyles();
                },
                "调整样式颜色，重置后恢复默认。"
            ),
            this.buildColorControlsField(
                "译文文字颜色",
                DEFAULT_TEXT_COLOR_HEX,
                () => this.settings.translationTextColor,
                value => {
                    this.settings.translationTextColor = value;
                    this.updateActiveTranslationStyles();
                },
                () => {
                    this.settings.translationTextColor = "";
                    this.settings.translationTextOpacity = this.defaults.translationTextOpacity;
                    this.updateActiveTranslationStyles();
                },
                "调整译文文本颜色，重置后使用 Discord 默认文本色。"
            )
        ];

        const terminologyFragment = this.buildTerminologyCard();

        grid.append(
            createCard("翻译行为", behaviorFields),
            createCard("译文外观", appearanceFields),
            this.createCacheSummaryField(),
            terminologyFragment
        );
        return layout;
    }

    buildColorControlsField(label, defaultColor, getColor, onColorChange, onReset, description) {
        return this.createField(label, () => {
            const container = document.createElement("div");
            container.className = "dct-inline";

            const colorInput = document.createElement("input");
            colorInput.type = "color";
            colorInput.value = this.normalizeHexColorInput(getColor(), defaultColor);
            colorInput.addEventListener("input", () => {
                onColorChange(colorInput.value);
            });
            colorInput.addEventListener("change", () => {
                onColorChange(colorInput.value);
                this.saveSettings({ skipRuntimeReset: true });
            });

            const resetBtn = document.createElement("button");
            resetBtn.type = "button";
            resetBtn.className = "dct-button secondary";
            resetBtn.textContent = "重置";
            resetBtn.style.marginLeft = "auto";
            resetBtn.addEventListener("click", () => {
                onReset();
                colorInput.value = this.normalizeHexColorInput(getColor(), defaultColor);
                this.updateActiveTranslationStyles();
                this.saveSettings({ skipRuntimeReset: true });
            });

            container.append(colorInput, resetBtn);
            return container;
        }, description);
    }

    buildTerminologyCard() {
        const card = document.createElement("div");
        card.className = "dct-generalCard";

        const title = document.createElement("h3");
        title.className = "dct-generalCardTitle";
        title.textContent = "术语库";
        card.appendChild(title);

        const body = document.createElement("div");
        body.className = "dct-generalCardBody";
        card.appendChild(body);

        const buttonRow = document.createElement("div");
        buttonRow.className = "dct-button-row";

        const importButton = document.createElement("button");
        importButton.type = "button";
        importButton.className = "dct-button primary";
        importButton.textContent = "导入术语文件";
        buttonRow.appendChild(importButton);

        const expandButton = document.createElement("button");
        expandButton.type = "button";
        expandButton.className = "dct-button secondary";
        expandButton.textContent = "展开列表";
        buttonRow.appendChild(expandButton);

        body.appendChild(buttonRow);

        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".csv";
        fileInput.style.display = "none";
        card.appendChild(fileInput);

        const listWrapper = document.createElement("div");
        listWrapper.className = "dct-terminologyList";
        body.appendChild(listWrapper);

        let expanded = false;

        const getLibraries = () =>
            Array.isArray(this.settings.terminologyLibraries)
                ? this.settings.terminologyLibraries
                : [];

        const renderList = () => {
            listWrapper.replaceChildren();
            const libraries = getLibraries();
            if (!libraries.length) {
                expandButton.disabled = true;
                expandButton.classList.remove("primary");
                expandButton.classList.add("secondary");
                expandButton.textContent = "展开列表";
                expanded = false;
                const empty = document.createElement("div");
                empty.className = "dct-terminologyEmpty";
                empty.textContent = "暂无术语库";
                listWrapper.appendChild(empty);
                return;
            }

            if (libraries.length <= 1) {
                expanded = false;
                expandButton.disabled = true;
                expandButton.classList.remove("primary");
                expandButton.classList.add("secondary");
                expandButton.textContent = "展开列表";
            } else {
                expandButton.disabled = false;
                expandButton.textContent = expanded ? "收起列表" : "展开列表";
                expandButton.classList.toggle("primary", expanded);
                expandButton.classList.toggle("secondary", !expanded);
            }

            const visibleLibraries = expanded ? libraries : libraries.slice(0, 1);

            visibleLibraries.forEach((library, index) => {
                const item = document.createElement("div");
                item.className = "dct-terminologyItem";

                const header = document.createElement("div");
                header.className = "dct-terminologyHeader";

                const titleEl = document.createElement("span");
                titleEl.className = "dct-terminologyTitle";
                titleEl.textContent = library.name || "未命名术语";

                const meta = document.createElement("span");
                meta.className = "dct-terminologyMeta";
                const termCount = Array.isArray(library.terms) ? library.terms.length : 0;
                const languageCodes = new Set();
                if (Array.isArray(library.terms)) {
                    library.terms.forEach(term => {
                        if (term?.targetLanguage) {
                            languageCodes.add(term.targetLanguage);
                        }
                    });
                }
                if (languageCodes.size) {
                    const labels = Array.from(languageCodes)
                        .map(code => LANGUAGE_CODE_TO_NAME[code] || code)
                        .join("、");
                    meta.textContent = `${termCount} 条术语 · ${labels}`;
                } else {
                    meta.textContent = `${termCount} 条术语`;
                }

                header.append(titleEl, meta);
                item.appendChild(header);

                const actions = document.createElement("div");
                actions.className = "dct-terminologyActions";

                const toggleBtn = document.createElement("button");
                toggleBtn.type = "button";
                toggleBtn.className = `dct-button ${library.enabled ? "primary" : "secondary"}`;
                toggleBtn.textContent = library.enabled ? "已启用" : "未启用";
                toggleBtn.addEventListener("click", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    library.enabled = !library.enabled;
                    this.saveSettings({ skipRuntimeReset: true });
                    renderList();
                });
                actions.appendChild(toggleBtn);

                const removeBtn = document.createElement("button");
                removeBtn.type = "button";
                removeBtn.className = "dct-button secondary";
                removeBtn.textContent = "删除";
                removeBtn.addEventListener("click", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    const libs = this.settings.terminologyLibraries || [];
                    const indexInSettings = libs.findIndex(entry => entry && entry.id === library.id);
                    if (indexInSettings !== -1) {
                        libs.splice(indexInSettings, 1);
                        this.saveSettings({ skipRuntimeReset: true });
                        this.toast("已删除术语库", "info");
                        if (libs.length <= 1) {
                            expanded = false;
                        }
                        renderList();
                    }
                });
                actions.appendChild(removeBtn);

                item.appendChild(actions);
                listWrapper.appendChild(item);
            });

            if (!expanded) {
                const remaining = getLibraries().length - 1;
                if (remaining > 0) {
                    const hint = document.createElement("div");
                    hint.className = "dct-terminologyMeta";
                    hint.textContent = `还有 ${remaining} 个术语库，点击“展开列表”查看全部。`;
                    listWrapper.appendChild(hint);
                }
            }
        };

        importButton.addEventListener("click", () => {
            fileInput.click();
        });

        fileInput.addEventListener("change", event => {
            const files = Array.from(event.target.files || []);
            if (!files.length) {
                return;
            }
            const [file] = files;
            this.importTerminologyFile(file, () => {
                expanded = true;
                renderList();
            });
            event.target.value = "";
        });

        expandButton.addEventListener("click", () => {
            if (expandButton.disabled) {
                return;
            }
            expanded = !expanded;
            renderList();
            if (expanded) {
                listWrapper.scrollIntoView({ block: "nearest" });
            }
        });

        renderList();

        return card;
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

    buildPromptSettings() {
        const card = document.createElement("div");
        card.className = "dct-card";

        const title = document.createElement("h3");
        title.className = "dct-cardTitle";
        title.textContent = "翻译提示词";
        card.appendChild(title);

        card.appendChild(
            this.createField("提示词内容", () => {
                const textarea = document.createElement("textarea");
                textarea.value = this.settings.translationPrompt || DEFAULT_PROMPT;
                textarea.placeholder = DEFAULT_PROMPT;
                textarea.addEventListener("input", () => {
                    this.settings.translationPrompt = textarea.value;
                });
                textarea.addEventListener("change", () => this.saveSettings());
                return textarea;
            }, "支持使用 {{targetLanguage}} 占位符自动替换为目标语言。")
        );

        const resetRow = document.createElement("div");
        resetRow.className = "dct-button-row";
        const resetBtn = document.createElement("button");
        resetBtn.className = "dct-button secondary";
        resetBtn.textContent = "恢复默认";
        resetBtn.addEventListener("click", () => {
            this.settings.translationPrompt = DEFAULT_PROMPT;
            this.saveSettings({ skipRuntimeReset: true });
            const textarea = card.querySelector('textarea');
            if (textarea) {
                textarea.value = DEFAULT_PROMPT;
            }
        });
        resetRow.appendChild(resetBtn);
        card.appendChild(resetRow);

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

    createToggleField(labelText, getCurrentValue, onChange) {
        const field = document.createElement("div");
        field.className = "dct-settings-field dct-toggleField";

        const row = document.createElement("div");
        row.className = "dct-toggle";

        const label = document.createElement("span");
        label.className = "dct-toggleLabel";
        label.textContent = labelText;

        const switchBtn = document.createElement("button");
        switchBtn.type = "button";
        switchBtn.className = "dct-switch";
        switchBtn.setAttribute("role", "switch");
        const applyState = value => {
            switchBtn.dataset.checked = value ? "true" : "false";
            switchBtn.setAttribute("aria-checked", value ? "true" : "false");
        };
        applyState(!!getCurrentValue());

        const thumb = document.createElement("span");
        thumb.className = "dct-switchThumb";
        switchBtn.appendChild(thumb);

        switchBtn.addEventListener("click", () => {
            const nextState = !(switchBtn.dataset.checked === "true");
            applyState(nextState);
            onChange(nextState);
        });

        row.append(label, switchBtn);
        field.appendChild(row);
        return field;
    }

    createCacheSummaryField() {
        const box = document.createElement("div");
        box.className = "dct-generalCard";

        const title = document.createElement("h3");
        title.className = "dct-generalCardTitle";
        title.textContent = "译文缓存";
        box.appendChild(title);

        const body = document.createElement("div");
        body.className = "dct-generalCardBody";
        box.appendChild(body);

        const summary = document.createElement("div");
        summary.className = "dct-cacheSummary";

        const sizeLabel = document.createElement("span");
        sizeLabel.dataset.role = "cache-size";
        sizeLabel.className = "dct-fieldHint";
        sizeLabel.textContent = '当前缓存：' + this.formatCacheSize(this.translationCacheSizeBytes);
        summary.appendChild(sizeLabel);

        const clearBtn = document.createElement("button");
        clearBtn.className = "dct-button secondary";
        clearBtn.textContent = "清空缓存";
        clearBtn.addEventListener("click", () => {
            this.clearTranslationCache();
            sizeLabel.textContent = '当前缓存：' + this.formatCacheSize(this.translationCacheSizeBytes);
            this.toast("译文缓存已清空", "success");
        });
        summary.appendChild(clearBtn);

        body.appendChild(summary);
        return box;
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
        this.applyTranslationStyle(wrapper);
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
            this.storeCacheEntry(messageKey, {
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

    storeCacheEntry(messageKey, entry) {
        const limitBytes = this.getCacheLimitBytes();
        const entrySize = this.calculateCacheEntrySize(entry);
        if (entrySize > limitBytes) {
            this.clearTranslationCache();
            return;
        }

        const previousSize = this.translationCacheSizes.get(messageKey) || 0;
        let currentTotal = this.translationCacheSizeBytes - previousSize;
        if (currentTotal < 0) {
            currentTotal = 0;
        }

        if (currentTotal + entrySize > limitBytes) {
            this.clearTranslationCache();
            currentTotal = 0;
        }

        this.translationCache.set(messageKey, entry);
        this.translationCacheSizes.set(messageKey, entrySize);
        this.translationCacheSizeBytes = currentTotal + entrySize;
        this.updateCacheSizeLabel();
    }

    getDirectCacheKey(text, providerSignature, targetLanguage) {
        const normalizedText = typeof text === "string" ? text : String(text ?? "");
        const signature = this.buildTextSignature(normalizedText, []);
        return `direct|${providerSignature}|${targetLanguage}|${signature}`;
    }

    getCachedDirectTranslation(key, providerSignature, targetLanguage) {
        const entry = this.translationCache.get(key);
        if (!entry) {
            return null;
        }
        if (entry.providerSignature !== providerSignature || entry.targetLanguage !== targetLanguage) {
            return null;
        }
        const segment = entry.segments?.[0];
        if (!segment || typeof segment.translation !== "string") {
            return null;
        }
        return segment.translation;
    }

    storeDirectTranslation(key, sourceText, translation, providerSignature, targetLanguage) {
        if (!translation) {
            return;
        }
        const entry = {
            segments: [
                {
                    type: "direct",
                    text: sourceText,
                    translation
                }
            ],
            textSignature: this.buildTextSignature(sourceText, []),
            providerSignature,
            targetLanguage,
            timestamp: Date.now(),
            direct: true
        };
        this.storeCacheEntry(key, entry);
    }

    calculateCacheEntrySize(entry) {
        try {
            const encoder = new TextEncoder();
            return encoder.encode(JSON.stringify(entry)).length;
        } catch (error) {
            try {
                return JSON.stringify(entry).length;
            } catch (innerError) {
                return 0;
            }
        }
    }

    getCacheLimitBytes() {
        const limitMB = clampCacheLimit(this.settings.translationCacheLimitMB);
        return limitMB * 1024 * 1024;
    }

    getActiveTerminologyEntries(targetLanguage) {
        const libraries = Array.isArray(this.settings.terminologyLibraries)
            ? this.settings.terminologyLibraries
            : [];
        if (!libraries.length) {
            return [];
        }
        const languageCode = targetLanguage && LANGUAGE_NAME_TO_CODE[targetLanguage]
            ? LANGUAGE_NAME_TO_CODE[targetLanguage].toLowerCase()
            : null;
        const collected = [];
        const seen = new Set();
        libraries.forEach(library => {
            if (!library || !library.enabled || !Array.isArray(library.terms)) {
                return;
            }
            library.terms.forEach(term => {
                if (!term) {
                    return;
                }
                const source = typeof term.source === "string" ? term.source.trim() : "";
                const target = typeof term.target === "string" ? term.target : "";
                if (!source || !target) {
                    return;
                }
                const termLanguage = typeof term.targetLanguage === "string" && term.targetLanguage
                    ? term.targetLanguage.toLowerCase()
                    : "";
                if (languageCode && termLanguage && termLanguage !== languageCode) {
                    return;
                }
                const key = source.toLowerCase();
                if (seen.has(key)) {
                    return;
                }
                seen.add(key);
                collected.push({ source, target });
            });
        });
        collected.sort((a, b) => {
            const aLen = a.source.length || 0;
            const bLen = b.source.length || 0;
            return bLen - aLen;
        });
        return collected;
    }

    prepareTerminologyRequest(text, targetLanguage) {
        if (typeof text !== "string" || !text.trim()) {
            return { text, replacements: [], instructions: "" };
        }
        const entries = this.getActiveTerminologyEntries(targetLanguage);
        if (!entries.length) {
            return { text, replacements: [], instructions: "" };
        }
        let prepared = text;
        const replacements = [];
        let placeholderIndex = 0;
        entries.forEach(entry => {
            const pattern = this.buildTerminologyPattern(entry.source);
            if (!pattern) {
                return;
            }
            prepared = prepared.replace(pattern, () => {
                const placeholder = `__DCT_TERM_${placeholderIndex}__`;
                placeholderIndex += 1;
                replacements.push({ placeholder, replacement: entry.target });
                return placeholder;
            });
        });
        if (!replacements.length) {
            return { text, replacements: [], instructions: "" };
        }
        return {
            text: prepared,
            replacements,
            instructions: "Placeholder tokens 形如 __DCT_TERM_0__，请保持原样输出并视作专有名词。"
        };
    }

    isTerminologyOnlyText(text, replacements) {
        if (typeof text !== "string" || !Array.isArray(replacements) || !replacements.length) {
            return false;
        }
        let reduced = text;
        replacements.forEach(entry => {
            if (!entry || !entry.placeholder) {
                return;
            }
            const placeholderPattern = new RegExp(this.escapeRegExp(entry.placeholder), "g");
            reduced = reduced.replace(placeholderPattern, "");
        });
        return reduced.replace(/[\s,.;:?!，。！？；、“”"'()（）\-]+/g, "").trim() === "";
    }

    buildTerminologyPattern(source) {
        if (typeof source !== "string") {
            return null;
        }
        const trimmed = source.trim();
        if (!trimmed) {
            return null;
        }
        const escaped = this.escapeRegExp(trimmed);
        if (!escaped) {
            return null;
        }
        const simple = /^[A-Za-z0-9 ]+$/.test(trimmed);
        const pattern = simple ? `\\b${escaped}\\b` : escaped;
        try {
            return new RegExp(pattern, "gi");
        } catch (error) {
            console.error(`[${this.pluginName}] invalid glossary pattern`, error, trimmed);
            return null;
        }
    }

    buildTranslationUserPrompt(message, targetLanguage, notes = []) {
        const extras = Array.isArray(notes) ? notes.filter(Boolean) : [];
        let prompt = `Please translate the message below into ${targetLanguage}. Reply with the translation only.\n\nMessage:\n${message}`;
        if (extras.length) {
            prompt += `\n\nNotes:\n${extras.map(note => `- ${note}`).join("\n")}`;
        }
        return prompt;
    }

    restoreTerminologyPlaceholders(text, replacements) {
        if (typeof text !== "string") {
            return "";
        }
        if (!Array.isArray(replacements) || replacements.length === 0) {
            return text.trim();
        }
        let output = text;
        replacements.forEach(entry => {
            if (!entry || !entry.placeholder) {
                return;
            }
            const replacement = typeof entry.replacement === "string" ? entry.replacement : "";
            output = output.split(entry.placeholder).join(replacement);
        });
        return this.cleanupTerminologySpacing(output);
    }

    cleanupTerminologySpacing(text) {
        if (typeof text !== "string") {
            return "";
        }
        let output = text;
        output = output.replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, "$1$2");
        output = output.replace(/([\u4e00-\u9fff])\s+([“”])/g, "$1$2");
        output = output.replace(/([“”])\s+([\u4e00-\u9fff])/g, "$1$2");
        output = output.replace(/\s+([，。、！？；])/g, "$1");
        output = output.replace(/([（《〈【])\s+/g, "$1");
        output = output.replace(/\s+([》〉】）])/g, "$1");
        return output.trim();
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

        const normalizedSource = typeof text === "string" ? text : String(text ?? "");
        const providerSignature = this.getProviderSignature(provider);
        const directCacheKey = this.getDirectCacheKey(normalizedSource, providerSignature, targetLanguage);
        const cachedDirect = this.getCachedDirectTranslation(directCacheKey, providerSignature, targetLanguage);
        if (cachedDirect) {
            return cachedDirect;
        }

        const terminology = this.prepareTerminologyRequest(normalizedSource, targetLanguage);
        if (this.isTerminologyOnlyText(terminology.text, terminology.replacements)) {
            const restoredOnly = this.restoreTerminologyPlaceholders(terminology.text, terminology.replacements);
            this.storeDirectTranslation(directCacheKey, normalizedSource, restoredOnly, providerSignature, targetLanguage);
            return restoredOnly;
        }
        const userMessage = this.buildTranslationUserPrompt(
            terminology.text,
            targetLanguage,
            terminology.instructions ? [terminology.instructions] : []
        );

        const payload = {
            model: provider.modelId || "gpt-3.5-turbo",
            messages: [
                {
                    role: "system",
                    content: this.getSystemPrompt(targetLanguage)
                },
                {
                    role: "user",
                    content: userMessage
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
            const response = await fetch(endpoint, options);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const contentType = response.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
                const data = await response.json();
                const extracted = this.extractTranslation(data);
                const finalTranslation = this.restoreTerminologyPlaceholders(extracted, terminology.replacements);
                this.storeDirectTranslation(directCacheKey, normalizedSource, finalTranslation, providerSignature, targetLanguage);
                return finalTranslation;
            }
            const textBody = await response.text();
            const extracted = this.extractTranslation(textBody);
            const finalTranslation = this.restoreTerminologyPlaceholders(extracted, terminology.replacements);
            this.storeDirectTranslation(directCacheKey, normalizedSource, finalTranslation, providerSignature, targetLanguage);
            return finalTranslation;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    getSystemPrompt(targetLanguage) {
        const template = (this.settings.translationPrompt || DEFAULT_PROMPT).trim() || DEFAULT_PROMPT;
        return template.replace(/\{\{\s*targetLanguage\s*\}\}/gi, targetLanguage || this.settings.doubleClickTargetLanguage);
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

    clearTranslationCache() {
        this.translationCache.clear();
        this.translationCacheSizes.clear();
        this.translationCacheSizeBytes = 0;
        this.updateCacheSizeLabel();
    }

    formatCacheSize(bytes) {
        const mb = bytes / (1024 * 1024);
        if (mb >= 1) {
            return `${mb.toFixed(2)} MB`;
        }
        const kb = bytes / 1024;
        if (kb >= 1) {
            return `${kb.toFixed(1)} KB`;
        }
        return `${bytes} B`;
    }

    updateCacheSizeLabel() {
        const label = document.querySelector('.dct-cacheSummary [data-role="cache-size"]');
        if (label) {
            label.textContent = '当前缓存：' + this.formatCacheSize(this.translationCacheSizeBytes);
        }
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

        if (!normalized.translationPrompt) {
            normalized.translationPrompt = DEFAULT_PROMPT;
        }
        normalized.translationCacheLimitMB = clampCacheLimit(normalized.translationCacheLimitMB);

        if (!TRANSLATION_STYLE_OPTIONS.some(option => option.value === normalized.translationStyle)) {
            normalized.translationStyle = defaultSettings.translationStyle;
        }
        if (typeof normalized.translationStyleColor !== "string") {
            normalized.translationStyleColor = defaultSettings.translationStyleColor;
        }
        normalized.translationStyleOpacity = this.clampOpacity(
            normalized.translationStyleOpacity,
            this.defaults.translationStyleOpacity
        );

        if (typeof normalized.translationTextColor !== "string") {
            normalized.translationTextColor = defaultSettings.translationTextColor;
        }
        const parsedTextColor = this.parseColorString(normalized.translationTextColor);
        if (parsedTextColor && !this.isValidHexColor(normalized.translationTextColor)) {
            normalized.translationTextColor = parsedTextColor.hex;
            normalized.translationTextOpacity = parsedTextColor.alpha;
        }
        if (typeof normalized.translationTextOpacity === "undefined") {
            normalized.translationTextOpacity = this.defaults.translationTextOpacity;
        }
        normalized.translationTextOpacity = this.clampOpacity(
            normalized.translationTextOpacity,
            this.defaults.translationTextOpacity
        );
        const legacyColor = this.parseColorString(normalized.translationColor);
        if (!normalized.translationStyleColor && legacyColor) {
            normalized.translationStyleColor = legacyColor.hex;
            normalized.translationStyleOpacity = legacyColor.alpha;
        }
        delete normalized.translationColor;
        if (typeof normalized.translationOpacity !== "undefined") {
            delete normalized.translationOpacity;
        }

        if (!Array.isArray(normalized.terminologyLibraries)) {
            normalized.terminologyLibraries = [];
        } else {
            normalized.terminologyLibraries = normalized.terminologyLibraries
                .map(library => this.normalizeTerminologyLibrary(library))
                .filter(Boolean);
        }

        return this.deepMerge(merged, normalized);
    }

    normalizeTerminologyLibrary(library) {
        if (!library || typeof library !== "object") {
            return null;
        }
        const id = typeof library.id === "string" && library.id.trim()
            ? library.id.trim()
            : this.createTerminologyLibraryId();
        const name = typeof library.name === "string" && library.name.trim()
            ? library.name.trim()
            : "未命名术语";
        const enabled = library.enabled !== false;
        const termsSource = Array.isArray(library.terms) ? library.terms : [];
        const terms = termsSource.map(entry => this.normalizeTerminologyTerm(entry)).filter(Boolean);
        if (!terms.length) {
            return null;
        }
        return { id, name, enabled, terms };
    }

    normalizeTerminologyTerm(term) {
        if (!term || typeof term !== "object") {
            return null;
        }
        const source = typeof term.source === "string" ? term.source.trim() : "";
        const target = typeof term.target === "string" ? term.target.trim() : "";
        if (!source || !target) {
            return null;
        }
        const targetLanguage = typeof term.targetLanguage === "string" ? term.targetLanguage.trim() : "";
        return { source, target, targetLanguage };
    }

    createTerminologyLibraryId() {
        const randomPart = Math.random().toString(16).slice(2, 8);
        const timestamp = Date.now().toString(16);
        return `term-${timestamp}-${randomPart}`;
    }

    importTerminologyFile(file, onComplete) {
        if (!file) {
            this.toast("未选择文件", "info");
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            try {
                let raw = "";
                if (typeof reader.result === "string") {
                    raw = reader.result;
                } else if (reader.result && typeof TextDecoder === "function") {
                    raw = new TextDecoder("utf-8").decode(reader.result);
                }
                if (!raw) {
                    throw new Error("文件内容为空");
                }
                const terms = this.parseTerminologyCsv(raw);
                if (!terms.length) {
                    throw new Error("未找到有效术语");
                }
                const name = (file.name || "术语文件").replace(/\.[^.]+$/, "") || "术语文件";
                const library = {
                    id: this.createTerminologyLibraryId(),
                    name,
                    enabled: true,
                    terms
                };
                const normalizedLibrary = this.normalizeTerminologyLibrary(library);
                if (!normalizedLibrary) {
                    throw new Error("术语文件内容无效");
                }
                if (!Array.isArray(this.settings.terminologyLibraries)) {
                    this.settings.terminologyLibraries = [];
                }
                this.settings.terminologyLibraries.push(normalizedLibrary);
                this.saveSettings({ skipRuntimeReset: true });
                this.toast(`已导入 ${normalizedLibrary.terms.length} 条术语`, "success");
                if (typeof onComplete === "function") {
                    onComplete();
                }
            } catch (error) {
                console.error(`[${this.pluginName}] import terminology`, error);
                this.toast(`导入术语失败: ${error.message || error}`, "error");
            }
        };
        reader.onerror = () => {
            console.error(`[${this.pluginName}] import terminology read error`, reader.error);
            this.toast("读取术语文件失败", "error");
        };
        reader.readAsText(file, "utf-8");
    }

    parseTerminologyCsv(content) {
        if (typeof content !== "string") {
            return [];
        }
        const rows = this.parseCsv(content);
        if (!rows.length) {
            return [];
        }
        const header = rows[0].map(cell => String(cell || "").trim().toLowerCase());
        const sourceIndex = header.indexOf("source");
        const targetIndex = header.indexOf("target");
        const languageIndex = header.findIndex(key => key === "tgt_lng" || key === "target_language" || key === "target_lang");
        if (sourceIndex === -1 || targetIndex === -1) {
            throw new Error("CSV 缺少 source/target 列");
        }
        const terms = [];
        for (let i = 1; i < rows.length; i += 1) {
            const row = rows[i];
            if (!row) {
                continue;
            }
            const source = row[sourceIndex] ? String(row[sourceIndex]).trim() : "";
            const target = row[targetIndex] ? String(row[targetIndex]).trim() : "";
            if (!source || !target) {
                continue;
            }
            const targetLanguage = languageIndex !== -1 && row[languageIndex]
                ? String(row[languageIndex]).trim()
                : "";
            const normalized = this.normalizeTerminologyTerm({ source, target, targetLanguage });
            if (normalized) {
                terms.push(normalized);
            }
        }
        return terms;
    }

    parseCsv(content) {
        let text = content;
        if (text.startsWith("\ufeff")) {
            text = text.slice(1);
        }
        const rows = [];
        let currentRow = [];
        let currentValue = "";
        let insideQuotes = false;
        for (let i = 0; i < text.length; i += 1) {
            const char = text[i];
            if (char === "\"") {
                if (insideQuotes && text[i + 1] === "\"") {
                    currentValue += "\"";
                    i += 1;
                } else {
                    insideQuotes = !insideQuotes;
                }
                continue;
            }
            if (!insideQuotes && (char === "\n" || char === "\r")) {
                currentRow.push(currentValue);
                currentValue = "";
                if (char === "\r" && text[i + 1] === "\n") {
                    i += 1;
                }
                rows.push(currentRow);
                currentRow = [];
                continue;
            }
            if (!insideQuotes && char === ",") {
                currentRow.push(currentValue);
                currentValue = "";
                continue;
            }
            currentValue += char;
        }
        currentRow.push(currentValue);
        rows.push(currentRow);
        return rows.filter((row, index) => {
            if (!row) {
                return false;
            }
            if (index === 0) {
                return true;
            }
            return row.some(cell => String(cell || "").trim() !== "");
        });
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
        this.clearTranslationCache();
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

    escapeRegExp(value) {
        if (typeof value !== "string") {
            return "";
        }
        return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
}

module.exports = MaiGeTranslate;
