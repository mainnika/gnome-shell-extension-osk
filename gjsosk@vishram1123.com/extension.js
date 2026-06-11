import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Shell from 'gi://Shell';


import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as KeyboardManager from 'resource:///org/gnome/shell/misc/keyboardManager.js';
import * as KeyboardUI from 'resource:///org/gnome/shell/ui/keyboard.js';
import * as InputSourceManager from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js'
const [major, minor] = Config.PACKAGE_VERSION.split('.').map(s => Number(s));
import { Dialog } from 'resource:///org/gnome/shell/ui/dialog.js';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

const State = {
    OPENED: 0,
    CLOSED: 1,
    OPENING: 2,
    CLOSING: 3,
};

class KeyboardMenuToggle extends QuickSettings.QuickMenuToggle {
    static {
        GObject.registerClass(this);
    }

    constructor(extensionObject) {
        super({
            title: _('Screen Keyboard'),
            iconName: 'input-keyboard-symbolic',
            toggleMode: true,
        });

        this.extensionObject = extensionObject;
        this.settings = extensionObject.getSettings();

        this.menu.setHeader('input-keyboard-symbolic', _('Screen Keyboard'), _('Opening Mode'));
        this._itemsSection = new PopupMenu.PopupMenuSection();
        this._itemsSection.addMenuItem(new PopupMenu.PopupImageMenuItem(_('Never'), this.settings.get_int("enable-tap-gesture") == 0 ? 'emblem-ok-symbolic' : null));
        this._itemsSection.addMenuItem(new PopupMenu.PopupImageMenuItem(_("Only on Touch"), this.settings.get_int("enable-tap-gesture") == 1 ? 'emblem-ok-symbolic' : null));
        this._itemsSection.addMenuItem(new PopupMenu.PopupImageMenuItem(_("Always"), this.settings.get_int("enable-tap-gesture") == 2 ? 'emblem-ok-symbolic' : null));
        for (var i in this._itemsSection._getMenuItems()) {
            const item = this._itemsSection._getMenuItems()[i]
            const num = i
            item.connect('activate', () => this.settings.set_int("enable-tap-gesture", num))
        }

        this.menu.addMenuItem(this._itemsSection);
        this.settings.bind('indicator-enabled',
            this, 'checked',
            Gio.SettingsBindFlags.DEFAULT);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const settingsItem = this.menu.addAction(_('More Settings'),
            () => this.extensionObject.openPreferences());
        settingsItem.visible = Main.sessionMode.allowSettings;
        this.menu._settingsActions[this.extensionObject.uuid] = settingsItem;
    }

    _refresh() {
        for (var i in this._itemsSection._getMenuItems()) {
            this._itemsSection._getMenuItems()[i].setIcon(this.settings.get_int("enable-tap-gesture") == i ? 'emblem-ok-symbolic' : null)
        }
    }
};


let keycodes;
let layouts;
let currentMonitorId = 0;
let extract_dir = GLib.get_user_cache_dir() + "/gjs-osk";
// [insert handwriting 1]

function clampIndex(index, length) {
    if (!Number.isFinite(index) || index < 0 || index >= length)
        return 0;
    return index;
}

function readFileContents(path) {
    try {
        const [ok, contents] = GLib.file_get_contents(path);
        if (!ok)
            return null;

        return typeof contents === 'string' ? contents : new TextDecoder('utf-8').decode(contents);
    } catch {
        return null;
    }
}

function normalizeCustomLayouts(rawValue) {
    try {
        const parsed = JSON.parse(rawValue || "[]");
        if (!Array.isArray(parsed))
            return [];

        if (parsed.length > 0 &&
            Array.isArray(parsed[0]) &&
            typeof parsed[parsed.length - 1] === 'object' &&
            !Array.isArray(parsed[parsed.length - 1]))
            return [JSON.stringify(parsed)];

        return parsed.filter(item => typeof item === 'string');
    } catch (e) {
        logError(e);
        return [];
    }
}

function getLayoutMetadata(layout, layoutName = "") {
    const fallback = {
        split: layoutName.includes("Split"),
        settings: true,
        close: true,
    };
    const metadata = layout?.[layout.length - 1];
    if (metadata != null && typeof metadata === 'object' && !Array.isArray(metadata))
        return { ...fallback, ...metadata };

    return fallback;
}

function getCurrentMonitor() {
    const monitors = Main.layoutManager.monitors ?? [];
    return monitors[currentMonitorId] ??
        Main.layoutManager.primaryMonitor ??
        monitors[Main.layoutManager.primaryIndex] ??
        monitors[0] ??
        {
            x: 0,
            y: 0,
            width: global.screen_width ?? 1,
            height: global.screen_height ?? 1,
        };
}

export default class GjsOskExtension extends Extension {
    _openKeyboard(instant) {
        if (this.Keyboard != null && this.Keyboard.state !== State.OPENED && this.Keyboard.state !== State.OPENING) {
            this.Keyboard.open(null, !instant ? null : true);
            if (this.openBit != null && !this.openBit.get_boolean('keyboard-visible'))
                this.openBit.set_boolean('keyboard-visible', true);
        }
    }

    _closeKeyboard(instant) {
        if (this.Keyboard != null && this.Keyboard.state !== State.CLOSED && this.Keyboard.state !== State.CLOSING) {
            this.Keyboard.close(!instant ? null : true);
            if (this.openBit != null && this.openBit.get_boolean('keyboard-visible'))
                this.openBit.set_boolean('keyboard-visible', false);
        }
    }

    _toggleKeyboard(instant = false) {
        if (this.Keyboard == null) {
            this._pendingToggle = true;
            return;
        }

        if (this.Keyboard.state === State.CLOSED || this.Keyboard.state === State.CLOSING) {
            this._openKeyboard(instant);
            this.Keyboard.openedFromButton = true;
            this.Keyboard.closedFromButton = false
        } else {
            this._closeKeyboard(instant);
            this.Keyboard.openedFromButton = false;
            this.Keyboard.closedFromButton = true;
        }
    }

    _createIndicator() {
        const indicator = new PanelMenu.Button(0.0, "GJS OSK Indicator", true);
        const icon = new St.Icon({
            gicon: new Gio.ThemedIcon({
                name: 'input-keyboard-symbolic'
            }),
            style_class: 'system-status-icon'
        });
        indicator.add_child(icon);

        const clickGesture = new Clutter.ClickGesture();
        clickGesture.connect('recognize', () => this._toggleKeyboard());
        indicator.add_action(clickGesture);

        return indicator;
    }

    open_interval() {
        if (this.tapConnect) {
            global.stage.disconnect(this.tapConnect)
            this.tapConnect = 0;
        }
        if (this.openInterval !== null) {
            clearInterval(this.openInterval);
            this.openInterval = null;
        }
        this.openInterval = setInterval(() => {
            if (this.Keyboard != null) {
                if (global.stage.key_focus == this.Keyboard && this.Keyboard.prevKeyFocus != null) {
                    global.stage.key_focus = this.Keyboard.prevKeyFocus
                }
                const parent = this.Keyboard.get_parent();
                if (parent != null)
                    parent.set_child_at_index(this.Keyboard, parent.get_n_children() - 1);
                this.Keyboard.set_child_at_index(this.Keyboard.box, this.Keyboard.get_n_children() - 1);
                if (!this.Keyboard.openedFromButton && this.lastInputMethod) {
                    if (Main.inputMethod.currentFocus != null && Main.inputMethod.currentFocus.is_focused() && !this.Keyboard.closedFromButton) {
                        this._openKeyboard();
                    } else if (!this.Keyboard.closedFromButton && !this.Keyboard._dragging) {
                        this._closeKeyboard();
                        this.Keyboard.closedFromButton = false
                    } else if (Main.inputMethod.currentFocus == null) {
                        this.Keyboard.closedFromButton = false
                    }
                }
            }
        }, 300);
        this.tapConnect = global.stage.connect("event", (_actor, event) => {
            if (event.type() !== 4 && event.type() !== 5) {
                const tapGestureMode = this.settings.get_boolean("indicator-enabled") ? this.settings.get_int("enable-tap-gesture") : 0;
                this.lastInputMethod = [false, event.type() >= 9 && event.type() <= 12, true][tapGestureMode]
            }
        })
    }

    enable() {
        this._extensionActive = true;
        this._pendingToggle = false;
        this._refreshSerial = 0;
        this._restoreOpenAfterRefresh = false;
        this._inputSourceRefreshTimeout = 0;
        this.Keyboard = null;
        this.openInterval = null;
        this.tapConnect = 0;

        this.settings = this.getSettings();
        this.darkSchemeSettings = this.getSettings("org.gnome.desktop.interface");
        this.inputLanguageSettings = InputSourceManager.getInputSourceManager();
        this.gnomeKeyboardSettings = this.getSettings('org.gnome.desktop.a11y.applications');
        this.isGnomeKeyboardEnabled = this.gnomeKeyboardSettings.get_boolean('screen-keyboard-enabled');
        this.gnomeKeyboardSettings.set_boolean('screen-keyboard-enabled', false)
        this.isGnomeKeyboardEnabledHandler = this.gnomeKeyboardSettings.connect('changed', () => {
            this.gnomeKeyboardSettings.set_boolean('screen-keyboard-enabled', false)
        });
        this.settings.scheme = ""
        if (this.darkSchemeSettings.get_string("color-scheme") == "prefer-dark")
            this.settings.scheme = "-dark"
        this.openBit = this.settings.get_child("indicator");
        this._restoreOpenAfterRefresh = this.openBit.get_boolean('keyboard-visible');

        this.openPrefs = () => { this.openPreferences() }

        let contentsL = readFileContents(this.path + '/physicalLayouts.json');
        if (contentsL != null) {
            layouts = JSON.parse(contentsL);
        } else {
            logError(new Error("Could not load physicalLayouts.json"));
            return;
        }

        this.customLayouts = normalizeCustomLayouts(this.settings.get_string("custom-layout") || "[]");
        if (this.settings.get_string("custom-layout") !== JSON.stringify(this.customLayouts))
            this.settings.set_string("custom-layout", JSON.stringify(this.customLayouts));

        let refresh = () => {
            if (!this._extensionActive)
                return;

            const refreshSerial = ++this._refreshSerial;
            this.customLayouts = normalizeCustomLayouts(this.settings.get_string("custom-layout") || "[]");
            if (this.settings.get_string("custom-layout") !== JSON.stringify(this.customLayouts))
                this.settings.set_string("custom-layout", JSON.stringify(this.customLayouts));

            // [insert handwriting 2]
            let currentMonitors = this.settings.get_string("default-monitor").split(";").filter(i => i.includes(":"))
            let currentMonitorMap = {};
            let monitors = Main.layoutManager.monitors ?? [];
            for (var i of currentMonitors) {
                let tmp = i.split(":");
                if (tmp[0] !== "" && tmp[1] !== "")
                    currentMonitorMap[tmp[0]] = tmp[1] + "";
            }
            if (!Object.keys(currentMonitorMap).includes(monitors.length + "")) {
                let allConfigs = Object.keys(currentMonitorMap).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
                if (allConfigs.length > 0)
                    currentMonitorMap[monitors.length + ""] = currentMonitorMap[allConfigs[allConfigs.length - 1] + ""];
            }
            try {
                let connector = currentMonitorMap[monitors.length + ""];
                currentMonitorId = connector != null ? global.backend.get_monitor_manager().get_monitor_for_connector(connector) : Main.layoutManager.primaryIndex;
                if (currentMonitorId == null || currentMonitorId < 0 || currentMonitorId >= monitors.length) {
                    currentMonitorId = 0;
                }
            } catch {
                currentMonitorId = 0;
            }
            const currentSource = this.inputLanguageSettings.currentSource;
            const currentLayoutId = currentSource?.xkbId ?? KeyboardManager.getKeyboardManager().currentLayout?.id ?? "us";
            const keycodesPath = extract_dir + "/keycodes/" + currentLayoutId + '.json';
            const fallbackKeycodesPath = extract_dir + "/keycodes/us.json";
            let postExtract = () => {
                if (!this._extensionActive || refreshSerial !== this._refreshSerial)
                    return;

                if (this.Keyboard != null) {
                    this.Keyboard.destroy();
                    this.Keyboard = null;
                }
                let contents = readFileContents(keycodesPath);
                if (contents == null)
                    contents = readFileContents(fallbackKeycodesPath);
                if (contents != null) {
                    keycodes = JSON.parse(contents);
                } else {
                    logError(new Error(`Could not load keycodes for ${currentLayoutId} or fallback us`));
                    return;
                }
                this.Keyboard = new Keyboard(this.settings, this);
                this.Keyboard.refresh = refresh
                const restoreOpen = this._restoreOpenAfterRefresh;
                const pendingToggle = this._pendingToggle;
                this._restoreOpenAfterRefresh = false;
                this._pendingToggle = false;
                if (restoreOpen)
                    this._openKeyboard(true);
                else if (pendingToggle)
                    this._toggleKeyboard(true);
            }
            if (!Gio.File.new_for_path(keycodesPath).query_exists(null)) {
                if (!Gio.File.new_for_path(extract_dir).query_exists(null))
                    Gio.File.new_for_path(extract_dir).make_directory(null);
                if (!Gio.File.new_for_path(extract_dir + "/keycodes").query_exists(null))
                    Gio.File.new_for_path(extract_dir + "/keycodes").make_directory(null);
                Gio.Subprocess.new(["tar", "-Jxf", this.path + "/keycodes.tar.xz", "-C", extract_dir + "/keycodes"], Gio.SubprocessFlags.NONE)
                    .wait_check_async(null)
                    .then(postExtract)
                    .catch(err => logError(err, "Failed to extract GJS OSK keycodes"))
            } else {
                postExtract();
            }
        }
        refresh()

        this._originalLastDeviceIsTouchscreen = KeyboardUI.KeyboardManager.prototype._lastDeviceIsTouchscreen ?? null;
        if (this._originalLastDeviceIsTouchscreen !== null)
            KeyboardUI.KeyboardManager.prototype._lastDeviceIsTouchscreen = () => { return false };

        this._indicator = null;
        if (this.settings.get_boolean("indicator-enabled")) {
            this._indicator = this._createIndicator();
            Main.panel.addToStatusArea("GJS OSK Indicator", this._indicator);
        }

        this._toggle = new KeyboardMenuToggle(this);
        this._quick_settings_indicator = new QuickSettings.SystemIndicator();
        this._quick_settings_indicator.quickSettingsItems.push(this._toggle);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._quick_settings_indicator);
        this.open_interval();
        this.keyboardVisibilityHandler = this.openBit.connect('changed::keyboard-visible', () => {
            const shouldBeVisible = this.openBit.get_boolean('keyboard-visible');
            if (this.Keyboard == null)
                return;
            if (shouldBeVisible && !this.Keyboard.opened && this.Keyboard.state !== State.OPENING)
                this._openKeyboard(true);
            else if (!shouldBeVisible && this.Keyboard.opened && this.Keyboard.state !== State.CLOSING)
                this._closeKeyboard(true);
        });
        this.openFromCommandHandler = this.openBit.connect("changed::opened", () => {
            if (this.openBit.get_boolean("opened")) {
                this.openBit.set_boolean("opened", false)
                this._toggleKeyboard();
            }
        })
        let settingsChanged = () => {
            let opened;
            if (this.Keyboard != null)
                opened = this.Keyboard.opened || this.Keyboard.state === State.OPENING || this.openBit.get_boolean('keyboard-visible')
            else
                opened = this.openBit.get_boolean('keyboard-visible')
            if (this.darkSchemeSettings.get_string("color-scheme") == "prefer-dark")
                this.settings.scheme = "-dark"
            else
                this.settings.scheme = ""
            this._restoreOpenAfterRefresh = opened;
            if (this.Keyboard != null)
                this.Keyboard.openedFromButton = false;
            refresh()
            this._toggle._refresh();
            if (this.settings.get_boolean("indicator-enabled")) {
                if (this._indicator != null) {
                    this._indicator.destroy();
                    this._indicator = null;
                }
                this._indicator = this._createIndicator();
                Main.panel.addToStatusArea("GJS OSK Indicator", this._indicator);
            } else {
                if (this._indicator != null) {
                    this._indicator.destroy();
                    this._indicator = null;
                }
            }
            if (this.tapConnect) {
                global.stage.disconnect(this.tapConnect)
                this.tapConnect = 0;
            }
            if (this.openInterval !== null) {
                clearInterval(this.openInterval);
                this.openInterval = null;
            }
            this.open_interval();
        }
        this.settingsHandlers = [
            this.settings.connect("changed", settingsChanged),
            this.darkSchemeSettings.connect("changed", (_, key) => { if (key == "color-scheme") settingsChanged() }),
            this.inputLanguageSettings.connect("current-source-changed", () => {
                if (this._inputSourceRefreshTimeout)
                    GLib.source_remove(this._inputSourceRefreshTimeout);
                this._inputSourceRefreshTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                    this._inputSourceRefreshTimeout = 0;
                    settingsChanged();
                    return GLib.SOURCE_REMOVE;
                });
            })
        ];
    }

    disable() {
        this._extensionActive = false;
        this._refreshSerial = (this._refreshSerial ?? 0) + 1;

        if (this.gnomeKeyboardSettings != null && this.isGnomeKeyboardEnabledHandler != null) {
            this.gnomeKeyboardSettings.disconnect(this.isGnomeKeyboardEnabledHandler)
            this.gnomeKeyboardSettings.set_boolean('screen-keyboard-enabled', this.isGnomeKeyboardEnabled);
        }

        if (this._quick_settings_indicator != null) {
            this._quick_settings_indicator.quickSettingsItems.forEach(item => item.destroy());
            this._quick_settings_indicator.destroy();
            this._quick_settings_indicator = null;
        }

        if (this._indicator !== null) {
            this._indicator.destroy();
            this._indicator = null;
        }
        if (this.Keyboard != null) {
            this.Keyboard.destroy();
            this.Keyboard = null;
        }
        if (this.settingsHandlers != null) {
            this.settings.disconnect(this.settingsHandlers[0]);
            this.darkSchemeSettings.disconnect(this.settingsHandlers[1])
            this.inputLanguageSettings.disconnect(this.settingsHandlers[2])
            this.settingsHandlers = null;
        }
        if (this.openBit != null && this.keyboardVisibilityHandler != null) {
            this.openBit.disconnect(this.keyboardVisibilityHandler);
            this.keyboardVisibilityHandler = null;
        }
        if (this.openBit != null && this.openFromCommandHandler != null) {
            this.openBit.disconnect(this.openFromCommandHandler);
            this.openFromCommandHandler = null;
        }
        this.openBit = null;
        if (this.tapConnect) {
            global.stage.disconnect(this.tapConnect)
            this.tapConnect = 0;
        }
        if (this.openInterval !== null) {
            clearInterval(this.openInterval);
            this.openInterval = null;
        }
        if (this._inputSourceRefreshTimeout) {
            GLib.source_remove(this._inputSourceRefreshTimeout);
            this._inputSourceRefreshTimeout = 0;
        }
        if (this._toggle != null) {
            this._toggle.destroy()
            this._toggle = null
        }
        this.settings = null
        this.darkSchemeSettings = null;
        this.inputLanguageSettings = null;
        this.gnomeKeyboardSettings = null;
        this.Keyboard = null
        keycodes = null
        if (this._originalLastDeviceIsTouchscreen !== null) {
            KeyboardUI.KeyboardManager.prototype._lastDeviceIsTouchscreen = this._originalLastDeviceIsTouchscreen;
            this._originalLastDeviceIsTouchscreen = null;
        }
    }
}

// [insert handwriting 3]

class Keyboard extends Dialog {
    static [GObject.signals] = {
        'drag-begin': {},
        'drag-end': {}
    };

    static {
        GObject.registerClass(this);
    }

    _init(settings, extensionObject) {
        this.settingsOpenFunction = extensionObject.openPrefs
        this.extensionObject = extensionObject;
        this.customLayouts = extensionObject.customLayouts ?? [];
        this.inputDevice = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this.settings = settings;
        let monitor = getCurrentMonitor();
        super._init(Main.layoutManager.modalDialogGroup, 'db-keyboard-content');
        this.keymap = Clutter.get_default_backend().get_default_seat().get_keymap()
        this.capslockConnect = 0;
        this.numLockConnect = 0;
        this.mod = [];
        this.modBtns = [];
        this.capsL = false;
        this.shift = false;
        this.alt = false;
        this.textboxChecker = null;
        this.stateTimeout = null;
        this.keyTimeout = null;
        this.keyTimeoutFunc = null;
        this.keyInProgress = false;
        this.opened = false;
        this.state = State.CLOSED;
        this.delta = [];
        this.box = new St.Widget({
            reactive: true,
            layout_manager: new Clutter.GridLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
            })
        });
        this.widthPercent = (monitor.width > monitor.height) ? settings.get_int("landscape-width-percent") / 100 : settings.get_int("portrait-width-percent") / 100;
        this.heightPercent = (monitor.width > monitor.height) ? settings.get_int("landscape-height-percent") / 100 : settings.get_int("portrait-height-percent") / 100;
        this.nonDragBlocker = new Clutter.Actor();
        this.buildUI();
        this.draggable = false;
        // [insert handwriting 4]
        this.add_child(this.box);
        this.setInitialClosedState();
        this.box.set_name("osk-gjs")
        this.monitorChecker = global.backend.get_monitor_manager().connect('monitors-changed', () => {
            if ((Main.layoutManager.monitors ?? []).length > 0)
                this.refresh()
        });
        this._dragging = false;
        let side = null;
        switch (this.settings.get_int("default-snap")) {
            case 0:
            case 1:
            case 2:
                side = St.Side.TOP;
                break;
            case 3:
                side = St.Side.LEFT;
                break;
            case 5:
                side = St.Side.RIGHT;
                break;
            case 6:
            case 7:
            case 8:
                side = St.Side.BOTTOM;
                break;
        }
        this.oldBottomDragAction = global.stage.get_action('osk');
        if (this.oldBottomDragAction !== null && this.oldBottomDragAction instanceof Clutter.Action)
            global.stage.remove_action(this.oldBottomDragAction);
        if (side != null && !this.settings.get_boolean("disable-edge-swipe")) {
            const mode = Shell.ActionMode.ALL & ~Shell.ActionMode.LOCK_SCREEN;
            const bottomDragAction = new Shell.EdgeDragGesture({
                name: 'osk',
                side,
            });
            bottomDragAction.connect('may-recognize', () => {
                return mode & Main.actionMode;
            });
            bottomDragAction.connect('end', () => {
                this.open(true);
                this.openedFromButton = true;
                this.closedFromButton = false;
                this.gestureInProgress = false;
            });
            bottomDragAction.connect('progress', (_action, progress) => {
                if (!this.gestureInProgress)
                    this.open(false)
                this.setOpenState(Math.min(Math.max(0, (progress / (side % 2 == 0 ? this.box.height : this.box.width)) * 100), 100))
                this.gestureInProgress = true;
            });
            bottomDragAction.connect('cancel', () => {
                if (this.gestureInProgress) {
                    this.close()
                    this.openedFromButton = false;
                    this.closedFromButton = true;
                }
                this.gestureInProgress = false;
                return Clutter.EVENT_PROPAGATE;
            });
            global.stage.add_action(bottomDragAction);
            this.bottomDragAction = bottomDragAction;
        } else {
            this.bottomDragAction = null;
        }
        this._oldMaybeHandleEvent = Main.keyboard.maybeHandleEvent
        this._maybeHandleEvent = (e) => {
            const tapGestureMode = this.settings.get_boolean("indicator-enabled") ? this.settings.get_int("enable-tap-gesture") : 0;
            let lastInputMethod = [e.type() == 11, e.type() == 11, e.type() == 7 || e.type() == 11][tapGestureMode]
            let ac = global.stage.get_event_actor(e)
            if (this.contains(ac)) {
                ac.event(e, true);
                ac.event(e, false);
                return true;
            } else if (ac instanceof Clutter.Text && lastInputMethod && !this.opened) {
                this.open();
            }
            return false
        }
        Main.keyboard.maybeHandleEvent = this._maybeHandleEvent
    }

    destroy() {
        if (Main.keyboard.maybeHandleEvent === this._maybeHandleEvent)
            Main.keyboard.maybeHandleEvent = this._oldMaybeHandleEvent
        if (this.bottomDragAction != null && global.stage.get_action('osk') === this.bottomDragAction)
            global.stage.remove_action(this.bottomDragAction)
        if (this.oldBottomDragAction !== null && this.oldBottomDragAction instanceof Clutter.Action)
            global.stage.add_action_full('osk', Clutter.EventPhase.CAPTURE, this.oldBottomDragAction)
        if (this.textboxChecker !== null) {
            clearInterval(this.textboxChecker);
            this.textboxChecker = null;
        }
        if (this.stateTimeout !== null) {
            clearTimeout(this.stateTimeout);
            this.stateTimeout = null;
        }
        if (this.keyTimeout !== null) {
            this.finishKeyPress();
        }
        if (this.keymap != null && this.capslockConnect)
            this.keymap.disconnect(this.capslockConnect);
        if (this.keymap != null && this.numLockConnect)
            this.keymap.disconnect(this.numLockConnect);
        global.backend.get_monitor_manager().disconnect(this.monitorChecker)
        super.destroy();
        if (this.nonDragBlocker !== null) {
            Main.layoutManager.removeChrome(this.nonDragBlocker)
        }
    }

    startDragging(event, delta) {
        if (this.draggable) {
            if (this._dragging)
                return Clutter.EVENT_PROPAGATE;
            this._dragging = true;
            this.box.set_opacity(255);
            this.box.ease({
                opacity: 200,
                duration: 100,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => { }
            });
            let sequence = event.get_event_sequence?.() ?? null;
            this._grab = global.stage.grab(this);
            this._grabbedSequence = sequence;
            this.emit('drag-begin');
            let [absX, absY] = event.get_coords();
            this.snapMovement(absX - delta[0], absY - delta[1]);
            return Clutter.EVENT_STOP;
        } else {
            return Clutter.EVENT_PROPAGATE;
        }
    }

    endDragging() {
        if (this._dragging) {
            if (this._releaseId) {
                this.disconnect(this._releaseId);
                this._releaseId = 0;
            }
            if (this._grab) {
                this._grab.dismiss();
                this._grab = null;
            }

            this.box.set_opacity(200);
            this.box.ease({
                opacity: 255,
                duration: 100,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => { }
            });
            this._grabbedSequence = null;
            this._dragging = false;
            this.delta = [];
            this.emit('drag-end');
        }
        this.draggable = false;
        return Clutter.EVENT_STOP;
    }

    motionEvent(event) {
        if (this.draggable) {
            let [absX, absY] = event.get_coords();
            this.snapMovement(absX - this.delta[0], absY - this.delta[1]);
            return Clutter.EVENT_STOP
        } else {
            return Clutter.EVENT_STOP
        }
    }

    connectMoveHandle(moveHandle) {
        moveHandle.connect("event", (_actor, event) => {
            if (event.type() == Clutter.EventType.BUTTON_PRESS || event.type() == Clutter.EventType.TOUCH_BEGIN) {
                this.draggable = this.settings.get_boolean("enable-drag");
                let [eventX, eventY] = event.get_coords();
                this.delta = [eventX - this.translation_x, eventY - this.translation_y];
                return this.startDragging(event, this.delta);
            } else if (event.type() == Clutter.EventType.TOUCH_UPDATE && this._dragging) {
                return this.motionEvent(event);
            } else if ((event.type() == Clutter.EventType.TOUCH_END || event.type() == Clutter.EventType.TOUCH_CANCEL) && this._dragging) {
                return this.endDragging();
            }

            return Clutter.EVENT_PROPAGATE;
        })
    }

    snapMovement(xPos, yPos) {
        let monitor = getCurrentMonitor()
        if (xPos < monitor.x || yPos < monitor.y || xPos > monitor.x + monitor.width || yPos > monitor.y + monitor.width) {
            this.set_translation(xPos, yPos, 0);
            return;
        }
        xPos -= monitor.x;
        yPos -= monitor.y;
        let snap_px = this.settings.get_int("snap-spacing-px")
        if (Math.abs(xPos - ((monitor.width * .5) - ((this.width * .5)))) <= 50) {
            xPos = ((monitor.width * .5) - ((this.width * .5)));
        } else if (Math.abs(xPos - snap_px) <= 50) {
            xPos = snap_px;
        } else if (Math.abs(xPos - (monitor.width - this.width - snap_px)) <= 50) {
            xPos = monitor.width - this.width - snap_px
        }
        if (Math.abs(yPos - (monitor.height - this.height - snap_px)) <= 50) {
            yPos = monitor.height - this.height - snap_px;
        } else if (Math.abs(yPos - snap_px) <= 50) {
            yPos = snap_px;
        } else if (Math.abs(yPos - ((monitor.height * .5) - (this.height * .5))) <= 50) {
            yPos = (monitor.height * .5) - (this.height * .5);
        }
        this.set_translation(xPos + monitor.x, yPos + monitor.y, 0);
    }

    setOpenState(percent) {
        let monitor = getCurrentMonitor();
        let posX = [this.settings.get_int("snap-spacing-px"), ((monitor.width * .5) - ((this.width * .5))), monitor.width - this.width - this.settings.get_int("snap-spacing-px")][(this.settings.get_int("default-snap") % 3)];
        let posY = [this.settings.get_int("snap-spacing-px"), ((monitor.height * .5) - ((this.height * .5))), monitor.height - this.height - this.settings.get_int("snap-spacing-px")][Math.floor((this.settings.get_int("default-snap") / 3))];
        let mX = [-this.box.width, 0, this.box.width][(this.settings.get_int("default-snap") % 3)];
        let mY = [-this.box.height, 0, this.box.height][Math.floor((this.settings.get_int("default-snap") / 3))]
        let [dx, dy] = [posX + mX * ((100 - percent) / 100) + monitor.x, posY + mY * ((100 - percent) / 100) + monitor.y]
        let op = 255 * (percent / 100);
        this.set_translation(dx, dy, 0)
        this.box.set_opacity(op)
    }

    setInitialClosedState() {
        let monitor = getCurrentMonitor();
        let posX = [this.settings.get_int("snap-spacing-px"), ((monitor.width * .5) - ((this.width * .5))), monitor.width - this.width - this.settings.get_int("snap-spacing-px")][(this.settings.get_int("default-snap") % 3)];
        let posY = [this.settings.get_int("snap-spacing-px"), ((monitor.height * .5) - ((this.height * .5))), monitor.height - this.height - this.settings.get_int("snap-spacing-px")][Math.floor((this.settings.get_int("default-snap") / 3))];
        let mX = [-this.box.width, 0, this.box.width][(this.settings.get_int("default-snap") % 3)];
        let mY = [-this.box.height, 0, this.box.height][Math.floor((this.settings.get_int("default-snap") / 3))]
        this.set_translation(posX + mX + monitor.x, posY + mY + monitor.y, 0);
        this.box.set_opacity(0);
        this.hide();
        this.opened = false;
        this.state = State.CLOSED;
    }

    open(noPrep = null, instant = null) {
        if (this.updateCapsLock) this.updateCapsLock()
        if (this.updateNumLock) this.updateNumLock()
        if (this.stateTimeout !== null) {
            clearTimeout(this.stateTimeout);
            this.stateTimeout = null;
        }
        if (noPrep == null || !noPrep) {
            this.prevKeyFocus = global.stage.key_focus
            this.inputDevice = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
            this.state = State.OPENING
            this.show();
        }
        if (noPrep == null || noPrep) {
            let monitor = getCurrentMonitor();
            let posX = [this.settings.get_int("snap-spacing-px"), ((monitor.width * .5) - ((this.width * .5))), monitor.width - this.width - this.settings.get_int("snap-spacing-px")][(this.settings.get_int("default-snap") % 3)];
            let posY = [this.settings.get_int("snap-spacing-px"), ((monitor.height * .5) - ((this.height * .5))), monitor.height - this.height - this.settings.get_int("snap-spacing-px")][Math.floor((this.settings.get_int("default-snap") / 3))];
            if (noPrep == null) {
                let mX = [-this.box.width, 0, this.box.width][(this.settings.get_int("default-snap") % 3)];
                let mY = [-this.box.height, 0, this.box.height][Math.floor((this.settings.get_int("default-snap") / 3))]
                this.set_translation(posX + mX + monitor.x, posY + mY + monitor.y, 0)
            }
            this.box.ease({
                opacity: 255,
                duration: instant == null || !instant ? 100 : 0,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this.stateTimeout = setTimeout(() => {
                        this.state = State.OPENED
                    }, 500);
                }
            });
            this.ease({
                translation_x: posX + monitor.x,
                translation_y: posY + monitor.y,
                duration: instant == null || !instant ? 100 : 0,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            })
            if (!this.settings.get_boolean("enable-drag") && this.nonDragBlocker !== null) {
                Main.layoutManager.addChrome(this.nonDragBlocker, {
                    affectsStruts: true,
                    trackFullscreen: true,
                })
            }
            this.opened = true;
            if (this.extensionObject.openBit != null && !this.extensionObject.openBit.get_boolean('keyboard-visible'))
                this.extensionObject.openBit.set_boolean('keyboard-visible', true);
            // [insert handwriting 5]
        }
    }

    close(instant = null) {
        this.prevKeyFocus = null;
        if (this.stateTimeout !== null) {
            clearTimeout(this.stateTimeout);
            this.stateTimeout = null;
        }
        let monitor = getCurrentMonitor();
        let posX = [this.settings.get_int("snap-spacing-px"), ((monitor.width * .5) - ((this.width * .5))), monitor.width - this.width - this.settings.get_int("snap-spacing-px")][(this.settings.get_int("default-snap") % 3)];
        let posY = [this.settings.get_int("snap-spacing-px"), ((monitor.height * .5) - ((this.height * .5))), monitor.height - this.height - this.settings.get_int("snap-spacing-px")][Math.floor((this.settings.get_int("default-snap") / 3))];
        let mX = [-this.box.width, 0, this.box.width][(this.settings.get_int("default-snap") % 3)];
        let mY = [-this.box.height, 0, this.box.height][Math.floor((this.settings.get_int("default-snap") / 3))]
        this.state = State.CLOSING
        this.box.ease({
            opacity: 0,
            duration: instant == null || !instant ? 100 : 0,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this.opened = false;
                this.hide();
                this.stateTimeout = setTimeout(() => {
                    this.state = State.CLOSED
                }, 500);
            },
        });
        this.ease({
            translation_x: posX + mX + monitor.x,
            translation_y: posY + mY + monitor.y,
            duration: instant == null || !instant ? 100 : 0,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        })
        if (!this.settings.get_boolean("enable-drag") && this.nonDragBlocker !== null) {
            Main.layoutManager.removeChrome(this.nonDragBlocker, {
                affectsStruts: true,
                trackFullscreen: true,
            })
        }
        this.openedFromButton = false
        this.releaseAllKeys();
        if (this.extensionObject.openBit != null && this.extensionObject.openBit.get_boolean('keyboard-visible'))
            this.extensionObject.openBit.set_boolean('keyboard-visible', false);
        // [insert handwrting 6]
    }

    vfunc_button_press_event(event) {
        let [eventX, eventY] = event.get_coords();
        this.delta = [eventX - this.translation_x, eventY - this.translation_y];
        return this.startDragging(event, this.delta)
    }

    vfunc_button_release_event() {
        if (this._dragging && !this._grabbedSequence) {
            return this.endDragging();
        }
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_motion_event(event) {
        if (this._dragging && !this._grabbedSequence) {
            if ((event.get_state() & Clutter.ModifierType.BUTTON1_MASK) === 0)
                return this.endDragging();
            this.motionEvent(event);
        }
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_touch_event(event) {
        let sequence = event.get_event_sequence?.() ?? null;

        if (!this._dragging && event.type() == Clutter.EventType.TOUCH_BEGIN) {
            this.delta = [event.get_coords()[0] - this.translation_x, event.get_coords()[1] - this.translation_y];
            this.startDragging(event, this.delta);
            return Clutter.EVENT_STOP;
        } else if (this._grabbedSequence && sequence != null && sequence.get_slot() === this._grabbedSequence.get_slot()) {
                if (event.type() == Clutter.EventType.TOUCH_UPDATE) {
                    return this.motionEvent(event);
                } else if (event.type() == Clutter.EventType.TOUCH_END || event.type() == Clutter.EventType.TOUCH_CANCEL) {
                    return this.endDragging();
                }
        }

        return Clutter.EVENT_PROPAGATE;
    }

    buildUI() {
        this.box.set_opacity(0);
        this.keys = [];
        let monitor = getCurrentMonitor()
        let layoutNames = Object.keys(layouts);
        const builtInLayoutCount = layoutNames.length;
        const allLayoutCount = Math.max(1, builtInLayoutCount + this.customLayouts.length);
        let layoutIndex = clampIndex((monitor.width > monitor.height) ? this.settings.get_int("layout-landscape") : this.settings.get_int("layout-portrait"), allLayoutCount);
        let layoutName = layoutNames[0] ?? "";
        let currentLayout = layouts[layoutName];

        if (layoutIndex < builtInLayoutCount) {
            layoutName = layoutNames[layoutIndex];
            currentLayout = layouts[layoutName];
        } else {
            const customIndex = layoutIndex - builtInLayoutCount;
            try {
                currentLayout = JSON.parse(this.customLayouts[customIndex]);
                layoutName = `Custom Layout ${customIndex + 1}`;
            } catch (e) {
                logError(e, `Failed to parse ${layoutName}`);
                layoutName = layoutNames[0] ?? "";
                currentLayout = layouts[layoutName];
            }
        }

        if (!Array.isArray(currentLayout) || currentLayout.length === 0)
            return;

        const layoutMetadata = getLayoutMetadata(currentLayout, layoutName);
        const layoutRows = (typeof currentLayout[currentLayout.length - 1] === 'object' && !Array.isArray(currentLayout[currentLayout.length - 1]))
            ? currentLayout.slice(0, -1)
            : currentLayout;

        this.box.width = Math.round((monitor.width - this.settings.get_int("snap-spacing-px") * 2) * (layoutMetadata.split ? 1 : this.widthPercent))
        this.box.height = Math.round((monitor.height - this.settings.get_int("snap-spacing-px") * 2) * this.heightPercent)

        if (!this.settings.get_boolean("enable-drag")) {
            this.nonDragBlocker = new Clutter.Actor();
            switch (this.settings.get_int("default-snap")) {
                case 0:
                case 1:
                case 2:
                    this.nonDragBlocker.x = monitor.x;
                    this.nonDragBlocker.y = monitor.y;
                    this.nonDragBlocker.width = monitor.width;
                    this.nonDragBlocker.height = this.box.height + 2 * this.settings.get_int("snap-spacing-px");
                    break;
                case 3:
                    this.nonDragBlocker.x = monitor.x;
                    this.nonDragBlocker.y = monitor.y;
                    this.nonDragBlocker.width = this.box.width + 2 * this.settings.get_int("snap-spacing-px");
                    this.nonDragBlocker.height = monitor.height;
                    break;
                case 5:
                    this.nonDragBlocker.x = monitor.x + monitor.width - (this.box.width + 2 * this.settings.get_int("snap-spacing-px"));
                    this.nonDragBlocker.y = monitor.y;
                    this.nonDragBlocker.width = this.box.width + 2 * this.settings.get_int("snap-spacing-px");
                    this.nonDragBlocker.height = monitor.height;
                    break;
                case 6:
                case 7:
                case 8:
                    this.nonDragBlocker.x = monitor.x;
                    this.nonDragBlocker.y = monitor.y + monitor.height - (this.box.height + 2 * this.settings.get_int("snap-spacing-px"));
                    this.nonDragBlocker.width = monitor.width;
                    this.nonDragBlocker.height = this.box.height + 2 * this.settings.get_int("snap-spacing-px");
                    break;
            }
            if (this.settings.get_int("default-snap") == 4) {
                this.nonDragBlocker.destroy();
                this.nonDragBlocker = null;
            }
        } else {
            this.nonDragBlocker.destroy();
            this.nonDragBlocker = null;
        }

        const grid = this.box.layout_manager
        grid.set_row_homogeneous(true)
        grid.set_column_homogeneous(!layoutMetadata.split)

        let gridLeft;
        let gridRight;
        let currentGrid = grid;
        let left;
        let right;
        let topBtnWidth;

        if (layoutMetadata.split) {
            this.box.reactive = false;
            left = new St.Widget({
                reactive: true,
                layout_manager: new Clutter.GridLayout({
                    orientation: Clutter.Orientation.HORIZONTAL,
                    row_homogeneous: true,
                    column_homogeneous: true
                }),
                width: Math.round((monitor.width - this.settings.get_int("snap-spacing-px") * 2) * this.widthPercent) / 2
            })
            gridLeft = left.layout_manager;
            let middle = new St.Widget({
                reactive: false,
                width: this.box.width * (1 - this.widthPercent) - 10 + this.settings.get_int("border-spacing-px")
            });
            right = new St.Widget({
                reactive: true,
                layout_manager: new Clutter.GridLayout({
                    orientation: Clutter.Orientation.HORIZONTAL,
                    row_homogeneous: true,
                    column_homogeneous: true
                }),
                width: Math.round((monitor.width - this.settings.get_int("snap-spacing-px") * 2) * this.widthPercent) / 2
            })
            gridRight = right.layout_manager;
            this.box.add_child(left)
            this.box.add_child(middle)
            this.box.add_child(right)
        }

        this.shiftButtons = [];
        // [insert handwriting 7]

        let width = 0;
        for (const c of layoutRows[0]) {
            width += (("width" in c) ? c.width : 1)
        }
        let rowSize;
        let halfSize;
        let r = 0;
        let c;
        const doAddKey = (keydef) => {
            const i = ("key" in keydef) ? keycodes[keydef.key] : ("split" in keydef) ? "split" : "empty space";
            if (i != null && typeof i !== 'string') {
                if (i.layers.default == null) {
                    for (var key of Object.keys(i.layers)) {
                        i.layers[key] = i.layers["_" + key]
                    }
                }
                let params = {
                    x_expand: true,
                    y_expand: true
                }

                let iconKeys = ["left", "up", "right", "down", "space"]
                if (this.settings.get_boolean("show-icons")) {
                    iconKeys = ["left", "up", "right", "down", "backspace", "tab", "capslock", "shift", "enter", "ctrl", "super", "alt", "space", "menu"]
                }
                // [insert handwriting 8]
                if (iconKeys.some(j => { return i.layers.default.toLowerCase() == j })) {
                    params.style_class = i.layers.default.toLowerCase() + "_btn"
                    for (var key of Object.keys(i.layers)) {
                        i.layers["_" + key] = i.layers[key]
                        i.layers[key] = null
                    }
                } else {
                    params.label = i.layers.default
                }
                i.isMod = false
                if ([42, 54, 29, 125, 126, 56, 100, 97, 58, 69].some(j => { return i.code == j })) {
                    i.isMod = true;
                }
                const keyBtn = new St.Button(params)
                keyBtn.add_style_class_name('key')
                keyBtn.char = i
                if (i.code == 58) {
                    this.capslockConnect = this.keymap.connect("state-changed", (a, e) => {
                        this.setCapsLock(keyBtn, this.keymap.get_caps_lock_state())
                    })
                    this.updateCapsLock = () => this.setCapsLock(keyBtn, this.keymap.get_caps_lock_state())
                } else if (i.code == 69) {
                    this.numLockConnect = this.keymap.connect("state-changed", (a, e) => {
                        this.setNumLock(keyBtn, this.keymap.get_num_lock_state())
                    })
                    this.updateNumLock = () => this.setNumLock(keyBtn, this.keymap.get_num_lock_state())
                } else if (i.code == 42 || i.code == 54) {
                    this.shiftButtons.push(keyBtn)
                }
                currentGrid.attach(keyBtn, c, 5 + r, (("width" in keydef) ? keydef.width : 1) * 2, r == 0 ? 3 : (("height" in keydef) ? keydef.height : 1) * 4)
                keyBtn.visible = true
                c += (("width" in keydef) ? keydef.width : 1) * 2
                this.keys.push(keyBtn)
                // [insert handwriting 9]
            } else if (i == "empty space") {
                c += (("width" in keydef) ? keydef.width : 1) * 2
            } else if (i == "split") {
                currentGrid = gridRight
                const size = c
                if (!halfSize) halfSize = size
            }
        }

        for (const kRow of layoutRows) {
            c = 0;
            if (layoutMetadata.split) {
                currentGrid = gridLeft;
            }
            for (const keydef of kRow) {
                if (keydef instanceof Array) {
                    keydef.forEach(i => { doAddKey(i); r += 2; c -= (("width" in i) ? i.width : 1) * 2 });
                    c += (("width" in keydef[0]) ? keydef[0].width : 1) * 2;
                    r -= 4;
                } else {
                    doAddKey(keydef)
                }
            }
            if (!topBtnWidth) topBtnWidth = ((("width" in kRow[kRow.length - 1]) && ("key" in kRow[kRow.length - 1])) ? kRow[kRow.length - 1].width : 1)
            const size = c;
            if (!rowSize) rowSize = size;
            r += r == 0 ? 3 : 4
        }

        if (left != null) {
            this.set_reactive(false)
            left.add_style_class_name("boxLay");
            right.add_style_class_name("boxLay");
            if (this.settings.get_boolean("system-accent-col") && major >= 47) {
                if (this.settings.scheme == "-dark") {
                    left.set_style("background-color: st-darken(-st-accent-color, 30%); padding: " + this.settings.get_int("outer-spacing-px") + "px;")
                    right.set_style("background-color: st-darken(-st-accent-color, 30%); padding: " + this.settings.get_int("outer-spacing-px") + "px;")
                } else {
                    left.set_style("background-color: st-lighten(-st-accent-color, 10%); padding: " + this.settings.get_int("outer-spacing-px") + "px;")
                    right.set_style("background-color: st-lighten(-st-accent-color, 10%); padding: " + this.settings.get_int("outer-spacing-px") + "px;")
                }
            } else {
                left.set_style("background-color: rgba(" + this.settings.get_double("background-r" + this.settings.scheme) + "," + this.settings.get_double("background-g" + this.settings.scheme) + "," + this.settings.get_double("background-b" + this.settings.scheme) + ", " + this.settings.get_double("background-a" + this.settings.scheme) + "); padding: " + this.settings.get_int("outer-spacing-px") + "px;")
                right.set_style("background-color: rgba(" + this.settings.get_double("background-r" + this.settings.scheme) + "," + this.settings.get_double("background-g" + this.settings.scheme) + "," + this.settings.get_double("background-b" + this.settings.scheme) + ", " + this.settings.get_double("background-a" + this.settings.scheme) + "); padding: " + this.settings.get_int("outer-spacing-px") + "px;")
            }
            if (this.lightOrDark()) {
                left.add_style_class_name("inverted");
                right.add_style_class_name("inverted");
            } else {
                left.add_style_class_name("regular");
                right.add_style_class_name("regular");
            }
            let moveHandleStartLeft = 2 * topBtnWidth;
            let moveHandleEndRight = 2 * topBtnWidth;

            if (layoutMetadata.settings) {
                const settingsBtn = new St.Button({
                    x_expand: true,
                    y_expand: true
                })
                settingsBtn.add_style_class_name("settings_btn")
                settingsBtn.add_style_class_name("key")
                settingsBtn.connect("clicked", () => {
                    this.settingsOpenFunction();
                })
                settingsBtn.connect("touch-event", (_actor, event) => {
                    if (event.type() == Clutter.EventType.TOUCH_BEGIN) {
                        this.settingsOpenFunction();
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                })
                gridLeft.attach(settingsBtn, 0, 0, 2 * topBtnWidth, 3)
                this.keys.push(settingsBtn)
            } else {
                moveHandleStartLeft = 0;
            }

            if (layoutMetadata.close) {
                const closeBtn = new St.Button({
                    x_expand: true,
                    y_expand: true
                })
                closeBtn.add_style_class_name("close_btn")
                closeBtn.add_style_class_name("key")
                closeBtn.connect("clicked", () => {
                    this.closedFromButton = true;
                    this.close();
                })
                closeBtn.connect("touch-event", (_actor, event) => {
                    if (event.type() == Clutter.EventType.TOUCH_BEGIN) {
                        this.closedFromButton = true;
                        this.close();
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                })
                gridRight.attach(closeBtn, (rowSize - 2 * topBtnWidth), 0, 2 * topBtnWidth, 3)
                this.keys.push(closeBtn)
            } else {
                moveHandleEndRight = 0;
            }

            let moveHandleLeft = new St.Button({
                x_expand: true,
                y_expand: true
            })
            moveHandleLeft.add_style_class_name("moveHandle")
            moveHandleLeft.set_style("font-size: " + this.settings.get_int("font-size-px") + "px; border-radius: " + (this.settings.get_boolean("round-key-corners") ? "5px" : "0") + "; background-size: " + this.settings.get_int("font-size-px") + "px; font-weight: " + (this.settings.get_boolean("font-bold") ? "bold" : "normal") + "; border: " + this.settings.get_int("border-spacing-px") + "px solid transparent;");
            if (this.lightOrDark()) {
                moveHandleLeft.add_style_class_name("inverted");
            } else {
                moveHandleLeft.add_style_class_name("regular");
            }

            this.connectMoveHandle(moveHandleLeft)
            gridLeft.attach(moveHandleLeft, moveHandleStartLeft, 0, (halfSize - moveHandleStartLeft), 3)

            let moveHandleRight = new St.Button({
                x_expand: true,
                y_expand: true
            })
            moveHandleRight.add_style_class_name("moveHandle")
            moveHandleRight.set_style("font-size: " + this.settings.get_int("font-size-px") + "px; border-radius: " + (this.settings.get_boolean("round-key-corners") ? "5px" : "0") + "; background-size: " + this.settings.get_int("font-size-px") + "px; font-weight: " + (this.settings.get_boolean("font-bold") ? "bold" : "normal") + "; border: " + this.settings.get_int("border-spacing-px") + "px solid transparent;");
            if (this.lightOrDark()) {
                moveHandleRight.add_style_class_name("inverted");
            } else {
                moveHandleRight.add_style_class_name("regular");
            }

            this.connectMoveHandle(moveHandleRight)
            gridRight.attach(moveHandleRight, halfSize, 0, (rowSize - halfSize - moveHandleEndRight), 3)
            gridLeft.attach(new St.Widget({ x_expand: true, y_expand: true }), 0, 3, halfSize, 1)
            gridRight.attach(new St.Widget({ x_expand: true, y_expand: true }), halfSize, 3, (rowSize - halfSize), 1)
        } else {
            this.box.add_style_class_name("boxLay");
            if (this.settings.get_boolean("system-accent-col") && major >= 47) {
                if (this.settings.scheme == "-dark") {
                    this.box.set_style("background-color: st-darken(-st-accent-color, 30%); padding: " + this.settings.get_int("outer-spacing-px") + "px;")
                } else {
                    this.box.set_style("background-color: st-lighten(-st-accent-color, 10%); padding: " + this.settings.get_int("outer-spacing-px") + "px;")
                }
            } else {
                this.box.set_style("background-color: rgba(" + this.settings.get_double("background-r" + this.settings.scheme) + "," + this.settings.get_double("background-g" + this.settings.scheme) + "," + this.settings.get_double("background-b" + this.settings.scheme) + ", " + this.settings.get_double("background-a" + this.settings.scheme) + "); padding: " + this.settings.get_int("outer-spacing-px") + "px;")
            }
            if (this.lightOrDark()) {
                this.box.add_style_class_name("inverted");
            } else {
                this.box.add_style_class_name("regular");
            }

            let moveHandleStartLeft = 2 * topBtnWidth;
            let moveHandleEndRight = 2 * topBtnWidth;

            if (layoutMetadata.settings) {
                const settingsBtn = new St.Button({
                    x_expand: true,
                    y_expand: true
                })
                settingsBtn.add_style_class_name("settings_btn")
                settingsBtn.add_style_class_name("key")
                settingsBtn.connect("clicked", () => {
                    this.settingsOpenFunction();
                })
                settingsBtn.connect("touch-event", (_actor, event) => {
                    if (event.type() == Clutter.EventType.TOUCH_BEGIN) {
                        this.settingsOpenFunction();
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                })
                grid.attach(settingsBtn, 0, 0, 2 * topBtnWidth, 3)
                this.keys.push(settingsBtn)
            } else {
                moveHandleStartLeft = 0;
            }

            if (layoutMetadata.close) {
                const closeBtn = new St.Button({
                    x_expand: true,
                    y_expand: true
                })
                closeBtn.add_style_class_name("close_btn")
                closeBtn.add_style_class_name("key")
                closeBtn.connect("clicked", () => {
                    this.closedFromButton = true;
                    this.close();
                })
                closeBtn.connect("touch-event", (_actor, event) => {
                    if (event.type() == Clutter.EventType.TOUCH_BEGIN) {
                        this.closedFromButton = true;
                        this.close();
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                })
                grid.attach(closeBtn, (rowSize - 2 * topBtnWidth), 0, 2 * topBtnWidth, 3)
                this.keys.push(closeBtn)
            } else {
                moveHandleEndRight = 0;
            }

            // [insert handwriting 10]

            let moveHandle = new St.Button({
                x_expand: true,
                y_expand: true
            })
            moveHandle.add_style_class_name("moveHandle")
            moveHandle.set_style("font-size: " + this.settings.get_int("font-size-px") + "px; border-radius: " + (this.settings.get_boolean("round-key-corners") ? "5px" : "0") + "; background-size: " + this.settings.get_int("font-size-px") + "px; font-weight: " + (this.settings.get_boolean("font-bold") ? "bold" : "normal") + "; border: " + this.settings.get_int("border-spacing-px") + "px solid transparent;");
            if (this.lightOrDark()) {
                moveHandle.add_style_class_name("inverted");
            } else {
                moveHandle.add_style_class_name("regular");
            }

            this.connectMoveHandle(moveHandle)
            grid.attach(moveHandle, moveHandleStartLeft, 0, (rowSize - moveHandleStartLeft - moveHandleEndRight), 3) // [insert handwriting 11]
            grid.attach(new St.Widget({ x_expand: true, y_expand: true }), 0, 3, rowSize, 1)
        }

        this.keys.forEach(item => {
            item.set_style("font-size: " + this.settings.get_int("font-size-px") + "px; border-radius: " + (this.settings.get_boolean("round-key-corners") ? (this.settings.get_int("border-spacing-px") + 5) + "px" : "0") + "; background-size: " + this.settings.get_int("font-size-px") + "px; font-weight: " + (this.settings.get_boolean("font-bold") ? "bold" : "normal") + "; border: " + this.settings.get_int("border-spacing-px") + "px solid transparent;");
            if (this.lightOrDark()) {
                item.add_style_class_name("inverted");
            } else {
                item.add_style_class_name("regular");
            }
            item.set_pivot_point(0.5, 0.5)
            item.button_pressed = null;
            item.button_repeat = null;
            item.tap_pressed = null;
            item.tap_repeat = null;
            item.space_motion_handler = null;
            item.space_touch_handler = null;
            item.key_pressed = false;
            item.repeat_sent = false;
            item.connect("destroy", () => {
                if (item.button_pressed !== null) {
                    clearTimeout(item.button_pressed)
                    item.button_pressed = null
                }
                if (item.button_repeat !== null) {
                    clearInterval(item.button_repeat)
                    item.button_repeat = null
                }
                if (item.tap_pressed !== null) {
                    clearTimeout(item.tap_pressed)
                    item.tap_pressed = null
                }
                if (item.tap_repeat !== null) {
                    clearInterval(item.tap_repeat)
                    item.tap_repeat = null
                }
            })
            if (item.char === undefined)
                return;

            item._touchPressed = false;
            item._ignoreNextGestureRelease = false;

            const playSound = () => {
                if (!this.settings.get_boolean("play-sound"))
                    return;

                try {
                    const player = global.display.get_sound_player();
                    const soundFile = this.settings.get_string("sound-file");
                    if (soundFile !== "") {
                        player.play_from_file(Gio.File.new_for_path(soundFile), "tap", null)
                    } else {
                        player.play_from_theme("dialog-information", "tap", null)
                    }
                } catch (e) {
                    logError(e, "Failed to play GJS OSK key sound");
                }
            };
            const repeatableKeyCodes = [14, 103, 105, 106, 108, 111];
            const activateKey = (restoreModifiers = false) => {
                const oldModBtns = restoreModifiers ? [...this.modBtns] : [];
                if (!item.char.isMod) {
                    this.decideMod(item.char)
                } else {
                    this.decideMod(item.char, item)
                }

                for (var i of oldModBtns) {
                    this.decideMod(i.char, i)
                }
            };

            let pressEv = () => {
                this.box.set_child_at_index(item, this.box.get_children().length - 1);
                item.space_motion_handler = null
                item.space_touch_handler = null
                item.repeat_sent = false;
                item.set_scale(1.2, 1.2)
                item.add_style_pseudo_class("pressed")
                playSound();
                const shouldRepeat = !item.char.isMod &&
                    ((this.settings.get_boolean("enable-key-repeat") && item.char != null) ||
                        repeatableKeyCodes.includes(item.char.code) ||
                        ["delete_btn", "backspace_btn", "up_btn", "down_btn", "left_btn", "right_btn"].some(e => item.has_style_class_name(e)));
                if (shouldRepeat) {
                    activateKey(true);
                    item.repeat_sent = true;
                    item.button_pressed = setTimeout(() => {
                        item.button_repeat = setInterval(() => {
                            playSound();
                            activateKey(true);
                        }, this.settings.get_int("key-repeat-rate"));
                    }, 750);
                } else if (item.has_style_class_name("space_btn")) {
                    item.button_pressed = setTimeout(() => {
                        let lastPos = (item.get_transformed_position()[0] + item.get_transformed_size()[0] / 2)
                        let handleSpaceMotion = absX => {
                            if (Math.abs(absX - lastPos) > 20) {
                                if (absX > lastPos) {
                                    this.sendKey([106])
                                } else {
                                    this.sendKey([105])
                                }
                                lastPos = absX
                            }
                        }
                        item.space_motion_handler = item.connect("motion_event", (actor, event) => {
                            handleSpaceMotion(event.get_coords()[0]);
                        })
                        item.space_touch_handler = item.connect("touch_event", (actor, event) => {
                            if (event.type() == Clutter.EventType.TOUCH_UPDATE)
                                handleSpaceMotion(event.get_coords()[0]);
                        })
                    }, 750)
                } else {
                    item.key_pressed = true;
                    item.button_pressed = setTimeout(() => {
                        releaseEv()
                    }, 1000);
                }
            }
            let releaseEv = () => {
                item.remove_style_pseudo_class("pressed")
                item.ease({
                    scale_x: 1,
                    scale_y: 1,
                    duration: 100,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => { item.set_scale(1, 1); }
                })
                if (item.button_pressed !== null) {
                    clearTimeout(item.button_pressed)
                    item.button_pressed = null
                }
                if (item.button_repeat !== null) {
                    clearInterval(item.button_repeat)
                    item.button_repeat = null
                }
                let hadSpaceMotion = item.space_motion_handler !== null || item.space_touch_handler !== null;
                if (item.space_motion_handler !== null) {
                    item.disconnect(item.space_motion_handler)
                    item.space_motion_handler = null;
                }
                if (item.space_touch_handler !== null) {
                    item.disconnect(item.space_touch_handler)
                    item.space_touch_handler = null;
                }
                if (!hadSpaceMotion && item.key_pressed == true && !item.repeat_sent) {
                    try {
                        activateKey();
                    } catch { }
                }
                if (item.repeat_sent) {
                    this.mod = [];
                    this.modBtns.forEach(button => button.remove_style_class_name("selected"));
                    this.modBtns = [];
                    this.shiftButtons.forEach(button => button.remove_style_class_name("selected"));
                    this.resetAllMod();
                }
                item.key_pressed = false;
                item.repeat_sent = false;
            }

            const pressGesture = new Clutter.ClickGesture();
            pressGesture.set_recognize_on_press(true);
            pressGesture.set_cancel_threshold(-1);
            pressGesture.connect('notify::pressed', () => {
                if (item._touchPressed)
                    return;
                if (item._ignoreNextGestureRelease && !pressGesture.get_pressed()) {
                    item._ignoreNextGestureRelease = false;
                    return;
                }
                if (pressGesture.get_pressed()) {
                    pressEv()
                } else {
                    releaseEv()
                }
            })
            item.add_action(pressGesture);
            item.connect("touch-event", (_actor, event) => {
                if (event.type() == Clutter.EventType.TOUCH_BEGIN) {
                    item._touchPressed = true;
                    pressEv();
                    return Clutter.EVENT_STOP;
                } else if ((event.type() == Clutter.EventType.TOUCH_END || event.type() == Clutter.EventType.TOUCH_CANCEL) && item._touchPressed) {
                    item._touchPressed = false;
                    item._ignoreNextGestureRelease = true;
                    releaseEv();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            })
        });
    }

    lightOrDark() {
        let r, g, b;
        if (this.settings.get_boolean("system-accent-col")) {
            return this.settings.scheme != "-dark"
        } else {
            r = this.settings.get_double("background-r" + this.settings.scheme);
            g = this.settings.get_double("background-g" + this.settings.scheme);
            b = this.settings.get_double("background-b" + this.settings.scheme);
        }
        var hsp;
        hsp = Math.sqrt(
            0.299 * (r * r) +
            0.587 * (g * g) +
            0.114 * (b * b)
        );
        return hsp > 127.5
    }
    releaseAllKeys() {
        this.keys.forEach(item => {
            if (item.char === undefined)
                return;

            item.key_pressed = false;
            if (item.button_pressed !== null) {
                clearTimeout(item.button_pressed)
                item.button_pressed = null
            }
            if (item.button_repeat !== null) {
                clearInterval(item.button_repeat)
                item.button_repeat = null
            }
            if (item.space_motion_handler !== null && GObject.signal_handler_is_connected(item, item.space_motion_handler)) {
                item.disconnect(item.space_motion_handler)
                item.space_motion_handler = null;
            }
            if (item.space_touch_handler !== null && GObject.signal_handler_is_connected(item, item.space_touch_handler)) {
                item.disconnect(item.space_touch_handler)
                item.space_touch_handler = null;
            }
        })

        const activeMods = this.mod ?? [];
        const modButtons = this.modBtns ?? [];
        const shiftButtons = this.shiftButtons ?? [];

        for (const code of activeMods)
            this.inputDevice.notify_key(this.getEventTime(), code, Clutter.KeyState.RELEASED);
        this.mod = [];
        modButtons.forEach(button => button.remove_style_class_name("selected"));
        this.modBtns = [];
        shiftButtons.forEach(button => button.remove_style_class_name("selected"));
        this.resetAllMod();
    }

    getEventTime() {
        const eventTime = Clutter.get_current_event_time();
        return eventTime > 0 ? eventTime * 1000 : GLib.get_monotonic_time();
    }

    finishKeyPress() {
        if (typeof this.keyTimeoutFunc !== 'function')
            return;

        const releaseFunc = this.keyTimeoutFunc;
        this.keyTimeoutFunc = null;
        if (this.keyTimeout !== null) {
            clearTimeout(this.keyTimeout);
            this.keyTimeout = null;
        }
        releaseFunc();
    }

    sendKey(keys) {
        try {
            this.finishKeyPress();

            this.keyInProgress = true;
            const eventTime = this.getEventTime();
            for (var i = 0; i < keys.length; i++) {
                this.inputDevice.notify_key(eventTime, keys[i], Clutter.KeyState.PRESSED);
            }

            this.keyTimeoutFunc = () => {
                for (var j = keys.length - 1; j >= 0; j--) {
                    this.inputDevice.notify_key(eventTime, keys[j], Clutter.KeyState.RELEASED);
                }
                this.keyInProgress = false;
            };
            this.keyTimeout = setTimeout(() => {
                this.finishKeyPress();
            }, 5);
        } catch (err) {
            this.keyInProgress = false;
            throw new Error("GJS-OSK: An unknown error occured. Please report this bug to the Issues page (https://github.com/Vishram1123/gjs-osk/issues):\n\n" + err + "\n\nKeys Pressed: " + keys);
        }
    }

    decideMod(i, mBtn) {
        if (i.code == 29 || i.code == 56 || i.code == 97 || i.code == 125 || i.code == 126) {
            this.setNormMod(mBtn);
        } else if (i.code == 100) {
            this.setAlt(mBtn);
        } else if (i.code == 42 || i.code == 54) {
            this.setShift(mBtn);
        } else if (i.code == 58 || i.code == 69) {
            this.sendKey([mBtn.char.code]);
        } else {
            this.mod.push(i.code);
            this.sendKey(this.mod);
            this.mod = [];
            this.modBtns.forEach(button => {
                button.remove_style_class_name("selected");
            });
            this.shiftButtons.forEach(i => { i.remove_style_class_name("selected") })
            this.resetAllMod();
            this.modBtns = [];
        }
    }

    setCapsLock(button, state) {
        if (state) {
            button.add_style_class_name("selected");
            this.capsL = true;
        } else {
            button.remove_style_class_name("selected");
            this.capsL = false;
        }
        this.updateKeyLabels();
    }

    setNumLock(button, state) {
        if (state) {
            button.add_style_class_name("selected");
            this.numsL = true;
        } else {
            button.remove_style_class_name("selected");
            this.numsL = false;
        }
        this.updateKeyLabels();
    }

    setAlt(button) {
        this.alt = !this.alt;
        this.updateKeyLabels();
        if (!this.alt) {
            this.sendKey([button.char.code]);
        }
        this.setNormMod(button);
    }

    setShift(button) {
        this.shift = !this.shift;
        this.updateKeyLabels();
        if (!this.shift) {
            this.sendKey([button.char.code]);
            this.shiftButtons.forEach(i => { i.remove_style_class_name("selected") })
        } else {
            this.shiftButtons.forEach(i => { i.add_style_class_name("selected") })
        }
        this.setNormMod(button);
    }

    updateKeyLabels() {
        this.keys.forEach(key => {
            if (key.char != undefined) {
                let layer = (this.alt ? 'alt' : '') + (this.shift ? 'shift' : '') + (this.numsL ? 'num' : '') + (this.capsL ? 'caps' : '') + (this.numsL || this.capsL ? 'lock' : '')
                if (layer == '') layer = 'default'
                key.label = key.char.layers[layer];
            }
        });
    }


    setNormMod(button) {
        if (this.mod.includes(button.char.code)) {
            const modIndex = this.mod.indexOf(button.char.code);
            if (modIndex >= 0)
                this.mod.splice(modIndex, 1);
            if (!(button.char.code == 42) && !(button.char.code == 54))
                button.remove_style_class_name("selected");
            const buttonIndex = this.modBtns.indexOf(button);
            if (buttonIndex >= 0)
                this.modBtns.splice(buttonIndex, 1);
            this.inputDevice.notify_key(this.getEventTime(), button.char.code, Clutter.KeyState.RELEASED);
            this.sendKey([button.char.code])
        } else {
            if (!(button.char.code == 42) && !(button.char.code == 54))
                button.add_style_class_name("selected");
            this.mod.push(button.char.code);
            this.modBtns.push(button);
            this.inputDevice.notify_key(this.getEventTime(), button.char.code, Clutter.KeyState.PRESSED);
        }
    }

    resetAllMod() {
        this.shift = false;
        this.alt = false;
        this.updateKeyLabels()
    }
}
