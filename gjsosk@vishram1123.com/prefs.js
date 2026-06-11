'use strict';

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import * as Config from 'resource:///org/gnome/Shell/Extensions/js/misc/config.js'
const [major, minor] = Config.PACKAGE_VERSION.split('.').map(s => Number(s));

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

export default class GjsOskPreferences extends ExtensionPreferences {
	fillPreferencesWindow(window) {
		const UIFolderPath = this.dir.get_child('ui').get_path();

		let iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
		iconTheme.add_search_path(UIFolderPath + `/icons`);
		const settings = this.getSettings('org.gnome.shell.extensions.gjsosk');

		const page1 = new Adw.PreferencesPage({
			title: _("General"),
			icon_name: "general-symbolic"
		});

		const behaviorGroup = new Adw.PreferencesGroup({
			title: _("Behavior")
		});
		page1.add(behaviorGroup);

		const layoutRow = new Adw.ExpanderRow({
			title: _('Layout')
		});
		behaviorGroup.add(layoutRow);

		let layouts;
		let contentsL = readFileContents(this.path + '/physicalLayouts.json');
		if (contentsL != null) {
			layouts = JSON.parse(contentsL);
		} else {
			layouts = {};
		}

		let layoutList = Object.keys(layouts);
		if (layoutList.length == 0)
			layoutList = [_("Default")];

		let customLayouts = normalizeCustomLayouts(settings.get_string("custom-layout") || "[]");
		if (settings.get_string("custom-layout") !== JSON.stringify(customLayouts))
			settings.set_string("custom-layout", JSON.stringify(customLayouts));

		let layoutOptions = Object.keys(layouts);
		for (let i = 0; i < customLayouts.length; i++)
			layoutOptions.push(_("Custom Layout") + " " + (i + 1));
		if (layoutOptions.length == 0)
			layoutOptions = layoutList;
		const hasSelectableLayouts = Object.keys(layouts).length > 0 || customLayouts.length > 0;

		const layoutLandscapeRow = new Adw.ActionRow({
			title: _('Landscape Layout')
		});
		layoutRow.add_row(layoutLandscapeRow);

		let layoutLandscapeDrop = Gtk.DropDown.new_from_strings(layoutOptions);
		layoutLandscapeDrop.valign = Gtk.Align.CENTER;
		layoutLandscapeDrop.sensitive = hasSelectableLayouts;
		let layoutLandscapeIndex = clampIndex(settings.get_int("layout-landscape"), layoutOptions.length);
		layoutLandscapeDrop.selected = layoutLandscapeIndex;
		if (layoutLandscapeIndex != settings.get_int("layout-landscape"))
			settings.set_int("layout-landscape", layoutLandscapeIndex);

		layoutLandscapeRow.add_suffix(layoutLandscapeDrop);
		layoutLandscapeRow.activatable_widget = layoutLandscapeDrop;

		const layoutPortraitRow = new Adw.ActionRow({
			title: _('Portrait Layout')
		});
		layoutRow.add_row(layoutPortraitRow);

		let layoutPortraitDrop = Gtk.DropDown.new_from_strings(layoutOptions);
		layoutPortraitDrop.valign = Gtk.Align.CENTER;
		layoutPortraitDrop.sensitive = hasSelectableLayouts;
		let layoutPortraitIndex = clampIndex(settings.get_int("layout-portrait"), layoutOptions.length);
		layoutPortraitDrop.selected = layoutPortraitIndex;
		if (layoutPortraitIndex != settings.get_int("layout-portrait"))
			settings.set_int("layout-portrait", layoutPortraitIndex);

		layoutPortraitRow.add_suffix(layoutPortraitDrop);
		layoutPortraitRow.activatable_widget = layoutPortraitDrop;

		const disableEdgeSwipeRow = new Adw.ActionRow({
			title: _('Disable Edge Swipe')
		});
		behaviorGroup.add(disableEdgeSwipeRow);

		const disableEdgeSwipeDT = new Gtk.Switch({
			active: settings.get_boolean('disable-edge-swipe'),
			valign: Gtk.Align.CENTER,
		});

		disableEdgeSwipeRow.add_suffix(disableEdgeSwipeDT);
		disableEdgeSwipeRow.activatable_widget = disableEdgeSwipeDT;

		const enableDragRow = new Adw.ActionRow({
			title: _('Enable Dragging')
		});
		behaviorGroup.add(enableDragRow);

		const dragEnableDT = new Gtk.Switch({
			active: settings.get_boolean('enable-drag'),
			valign: Gtk.Align.CENTER,
		});

		enableDragRow.add_suffix(dragEnableDT);
		enableDragRow.activatable_widget = dragEnableDT;

		const indEnabledRow = new Adw.ActionRow({
			title: _('Enable Panel Indicator')
		});
		behaviorGroup.add(indEnabledRow);

		const indEnabled = new Gtk.Switch({
			active: settings.get_boolean("indicator-enabled"),
			valign: Gtk.Align.CENTER,
		});

		indEnabledRow.add_suffix(indEnabled);
		indEnabledRow.activatable_widget = indEnabled;

		const row1t5 = new Adw.ActionRow({
			title: _('Open upon clicking in a text field')
		});
		behaviorGroup.add(row1t5);


		let dragOptList = [_("Never"), _("Only on Touch"), _("Always")];
		let dragOpt = Gtk.DropDown.new_from_strings(dragOptList);
		dragOpt.valign = Gtk.Align.CENTER;
		dragOpt.selected = settings.get_int("enable-tap-gesture");

		row1t5.add_suffix(dragOpt);
		row1t5.activatable_widget = dragOpt;

		const portraitSizing = new Adw.ExpanderRow({
			title: _('Portrait Sizing')
		});
		behaviorGroup.add(portraitSizing);

		let pW = new Adw.ActionRow({
			title: _('Width (%)')
		})
		let pH = new Adw.ActionRow({
			title: _('Height (%)')
		})

		let numChanger_pW = Gtk.SpinButton.new_with_range(0, 100, 5);
		numChanger_pW.value = settings.get_int('portrait-width-percent');
		numChanger_pW.valign = Gtk.Align.CENTER;
		pW.add_suffix(numChanger_pW);
		pW.activatable_widget = numChanger_pW;

		let numChanger_pH = Gtk.SpinButton.new_with_range(0, 100, 5);
		numChanger_pH.value = settings.get_int('portrait-height-percent');
		numChanger_pH.valign = Gtk.Align.CENTER;
		pH.add_suffix(numChanger_pH);
		pH.activatable_widget = numChanger_pH;

		portraitSizing.add_row(pW);
		portraitSizing.add_row(pH);

		const landscapeSizing = new Adw.ExpanderRow({
			title: _('Landscape Sizing')
		});
		behaviorGroup.add(landscapeSizing);

		let lW = new Adw.ActionRow({
			title: _('Width (%)')
		});
		let lH = new Adw.ActionRow({
			title: _('Height (%)')
		});

		let numChanger_lW = Gtk.SpinButton.new_with_range(0, 100, 5);
		numChanger_lW.value = settings.get_int('landscape-width-percent');
		numChanger_lW.valign = Gtk.Align.CENTER;
		lW.add_suffix(numChanger_lW);
		lW.activatable_widget = numChanger_lW;

		let numChanger_lH = Gtk.SpinButton.new_with_range(0, 100, 5);
		numChanger_lH.value = settings.get_int('landscape-height-percent');
		numChanger_lH.valign = Gtk.Align.CENTER;
		lH.add_suffix(numChanger_lH);
		lH.activatable_widget = numChanger_lH;

		landscapeSizing.add_row(lW);
		landscapeSizing.add_row(lH);

		const defaultMonitor = new Adw.ActionRow({
			title: _('Default Monitor')
		})
		behaviorGroup.add(defaultMonitor);

		let monitors = [];

		const display = Gdk.Display.get_default();
		if (display && "get_monitors" in display) {
			const monitorsAvailable = display.get_monitors();

			for (let idx = 0; idx < monitorsAvailable.get_n_items(); idx++) {
				const monitor = monitorsAvailable.get_item(idx);
				monitors.push(monitor);
			}
		}
		const monitorConnectors = monitors.map(m => m.get_connector());
		let monitorDrop = Gtk.DropDown.new_from_strings(monitors.length > 0 ? monitors.map(m => m.get_model()) : [_("Default")])
		monitorDrop.valign = Gtk.Align.CENTER;
		monitorDrop.sensitive = monitors.length > 0;
		let currentMonitorMap = {};
		let currentMonitors = settings.get_string("default-monitor").split(";").filter(i => i.includes(":"));
		if (currentMonitors.length == 0 && monitors.length > 0)
			currentMonitors = [("1:" + monitorConnectors[0])]

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
		let index = monitorConnectors.indexOf(currentMonitorMap[monitors.length + ""]);
		if (index == -1) {
			index = 0
		}
		monitorDrop.selected = index;

		defaultMonitor.add_suffix(monitorDrop);
		defaultMonitor.activatable_widget = monitorDrop;

		const defaultPosition = new Adw.ActionRow({
			title: _('Default Position')
		});
		behaviorGroup.add(defaultPosition);

		let posList = [
			_("Top Left"), _("Top Center"), _("Top Right"),
			_("Center Left"), _("Center"), _("Center Right"),
			_("Bottom Left"), _("Bottom Center"), _("Bottom Right")
		];
		let snapDrop = Gtk.DropDown.new_from_strings(posList);
		snapDrop.valign = Gtk.Align.CENTER;
		snapDrop.selected = settings.get_int("default-snap");

		defaultPosition.add_suffix(snapDrop);
		defaultPosition.activatable_widget = snapDrop;

		const enableKeyRepeatRow = new Adw.ActionRow({
			title: _('Enable Key Repeat for All Keys')
		});
		behaviorGroup.add(enableKeyRepeatRow);

		const enableKeyRepeatDT = new Gtk.Switch({
			active: settings.get_boolean('enable-key-repeat'),
			valign: Gtk.Align.CENTER,
		});

		enableKeyRepeatRow.add_suffix(enableKeyRepeatDT);
		enableKeyRepeatRow.activatable_widget = enableKeyRepeatDT;

		const keyRepeatRateRow = new Adw.ActionRow({
			title: _('Key Repeat Rate (ms)')
		});
		behaviorGroup.add(keyRepeatRateRow);

		let numChanger_keyRepeat = Gtk.SpinButton.new_with_range(10, 1000, 10);
		numChanger_keyRepeat.value = settings.get_int('key-repeat-rate');
		numChanger_keyRepeat.valign = Gtk.Align.CENTER;
		keyRepeatRateRow.add_suffix(numChanger_keyRepeat);
		keyRepeatRateRow.activatable_widget = numChanger_keyRepeat;

		const soundPlayRow = new Adw.ExpanderRow({
			title: _('Play sound'),
			show_enable_switch: true
		});
		soundPlayRow.enable_expansion = settings.get_boolean('play-sound');
		behaviorGroup.add(soundPlayRow);

		const fileRow = new Adw.ActionRow({
			title: _('Sound file'),
			subtitle: settings.get_string('sound-file') || _('No file selected'),
			activatable: false,
		});
		const fileButton = new Gtk.Button({
			label: settings.get_string('sound-file') ? _('Clear') : _('Choose'),
			valign: Gtk.Align.CENTER,
		});
		fileRow.add_suffix(fileButton);
		fileRow.activatable_widget = fileButton;
		fileButton.connect('clicked', () => {
			const currentPath = settings.get_string('sound-file');
			if (currentPath) {
				settings.set_string('sound-file', '');
				fileRow.subtitle = _('No file selected');
				fileButton.label = _('Choose');
				return;
			}

			const fileChooser = new Gtk.FileChooserNative({
				title: _('Select OGG File'),
				transient_for: window,
				action: Gtk.FileChooserAction.OPEN,
				accept_label: _('Open'),
				cancel_label: _('Cancel'),
			});
			const filter = new Gtk.FileFilter();
			filter.add_mime_type('audio/ogg');
			filter.set_name(_('OGG files'));
			fileChooser.add_filter(filter);
			fileChooser.connect('response', (dlg, response) => {
				if (response === Gtk.ResponseType.ACCEPT) {
					const file = dlg.get_file();
					const path = file?.get_path();
					if (path != null) {
						settings.set_string('sound-file', path);
						fileRow.subtitle = path;
						fileButton.label = _('Clear');
					}
				}
				dlg.destroy();
			});
			fileChooser.show();
		});
		soundPlayRow.add_row(fileRow);

		const appearanceGroup = new Adw.PreferencesGroup({
			title: _("Appearance")
		});
		page1.add(appearanceGroup);

		const colorRow = new Adw.ExpanderRow({
			title: _("Color")
		})
		appearanceGroup.add(colorRow);


		const lightCol = new Adw.ActionRow({
			title: _('Light Mode')
		});
		colorRow.add_row(lightCol)

		let rgba = new Gdk.RGBA();
		rgba.parse("rgba(" + settings.get_double("background-r") + ", " + settings.get_double("background-g") + ", " + settings.get_double("background-b") + ", " + settings.get_double("background-a") + ")");
		let colorButton = new Gtk.ColorButton({
			rgba: rgba,
			use_alpha: true,
			valign: Gtk.Align.CENTER
		});
		lightCol.add_suffix(colorButton);
		lightCol.activatable_widget = colorButton;

		const darkCol = new Adw.ActionRow({
			title: _('Dark Mode')
		});
		colorRow.add_row(darkCol)

		let rgba_d = new Gdk.RGBA();
		rgba_d.parse("rgba(" + settings.get_double("background-r-dark") + ", " + settings.get_double("background-g-dark") + ", " + settings.get_double("background-b-dark") + ", " + settings.get_double("background-a-dark") + ")");
		let colorButton_d = new Gtk.ColorButton({
			rgba: rgba_d,
			use_alpha: true,
			valign: Gtk.Align.CENTER
		});
		darkCol.add_suffix(colorButton_d);
		darkCol.activatable_widget = colorButton_d;

		const systemAccCol = new Adw.ActionRow({
			title: _("Use System Accent Color")
		})
		colorRow.add_row(systemAccCol)

		const systemAccColEnabled = new Gtk.Switch({
			active: settings.get_boolean("system-accent-col"),
			valign: Gtk.Align.CENTER
		})

		systemAccCol.add_suffix(systemAccColEnabled)
		systemAccCol.activatable_widget = systemAccColEnabled

		systemAccCol.set_sensitive(major >= 47)
		lightCol.set_sensitive(!settings.get_boolean("system-accent-col"));
		darkCol.set_sensitive(!settings.get_boolean("system-accent-col"));

		let fontSize = new Adw.ActionRow({
			title: _('Font Size (px)')
		});
		appearanceGroup.add(fontSize);

		let numChanger_font = Gtk.SpinButton.new_with_range(0, 100, 1);
		numChanger_font.value = settings.get_int('font-size-px');
		numChanger_font.valign = Gtk.Align.CENTER;

		fontSize.add_suffix(numChanger_font);
		fontSize.activatable_widget = numChanger_font;

		const fontBoldRow = new Adw.ActionRow({
			title: _("Bold Font")
		})
		appearanceGroup.add(fontBoldRow)

		const fontBoldEnabled = new Gtk.Switch({
			active: settings.get_boolean("font-bold"),
			valign: Gtk.Align.CENTER
		})

		fontBoldRow.add_suffix(fontBoldEnabled)
		fontBoldRow.activatable_widget = fontBoldEnabled

		let borderSpacing = new Adw.ActionRow({
			title: _('Border Spacing (px)')
		});
		appearanceGroup.add(borderSpacing);

		let numChanger_bord = Gtk.SpinButton.new_with_range(0, 10, 1);
		numChanger_bord.value = settings.get_int('border-spacing-px');
		numChanger_bord.valign = Gtk.Align.CENTER;
		borderSpacing.add_suffix(numChanger_bord);
		borderSpacing.activatable_widget = numChanger_bord;

		let outerSpacing = new Adw.ActionRow({
			title: _('Outer Spacing (px)')
		});
		appearanceGroup.add(outerSpacing);

		let numChanger_outer = Gtk.SpinButton.new_with_range(0, 30, 1);
		numChanger_outer.value = settings.get_int('outer-spacing-px');
		numChanger_outer.valign = Gtk.Align.CENTER;
		outerSpacing.add_suffix(numChanger_outer);
		outerSpacing.activatable_widget = numChanger_outer;

		let snapSpacing = new Adw.ActionRow({
			title: _('Drag snap spacing (px)')
		});
		appearanceGroup.add(snapSpacing);

		let numChanger_snap = Gtk.SpinButton.new_with_range(0, 50, 5);
		numChanger_snap.value = settings.get_int('snap-spacing-px');
		numChanger_snap.valign = Gtk.Align.CENTER;
		snapSpacing.add_suffix(numChanger_snap);
		snapSpacing.activatable_widget = numChanger_snap;

		const roundCorners = new Adw.ActionRow({
			title: _('Round Corners')
		});
		appearanceGroup.add(roundCorners);

		const roundKeyCDT = new Gtk.Switch({
			active: settings.get_boolean('round-key-corners'),
			valign: Gtk.Align.CENTER,
		});

		roundCorners.add_suffix(roundKeyCDT);
		roundCorners.activatable_widget = roundKeyCDT;

		const showIcon = new Adw.ActionRow({
			title: _('Show Special Key Icons')
		});
		appearanceGroup.add(showIcon);

		const showIconDT = new Gtk.Switch({
			active: settings.get_boolean('show-icons'),
			valign: Gtk.Align.CENTER,
		});

		showIcon.add_suffix(showIconDT);
		showIcon.activatable_widget = showIconDT;

		window.add(page1);

		const customLayoutPage = new Adw.PreferencesPage({
			title: _("Custom Layouts"),
			icon_name: "view-grid-symbolic",
		});

		const addLayoutGroup = new Adw.PreferencesGroup({
			title: _("Add Layout"),
		});
		customLayoutPage.add(addLayoutGroup);

		const customLayoutEntry = new Adw.EntryRow({
			title: _("Paste Keyboard JSON"),
		});
		addLayoutGroup.add(customLayoutEntry);

		const layoutEditorRow = new Adw.ActionRow({
			title: _("Create/edit a custom keyboard layout"),
		});
		const layoutEditorLink = new Gtk.LinkButton({
			label: _("Keyboard Layout Editor"),
			uri: "https://vishram1123.github.io/gjs-osk",
			valign: Gtk.Align.CENTER,
		});
		layoutEditorRow.add_suffix(layoutEditorLink);
		layoutEditorRow.activatable_widget = layoutEditorLink;
		addLayoutGroup.add(layoutEditorRow);

		const addCustomLayoutButton = new Gtk.Button({
			label: _("Add"),
			valign: Gtk.Align.CENTER,
		});
		customLayoutEntry.add_suffix(addCustomLayoutButton);

		const savedLayoutsGroup = new Adw.PreferencesGroup({
			title: _("Layouts"),
		});
		customLayoutPage.add(savedLayoutsGroup);

		const customLayoutsBox = new Gtk.Box({
			orientation: Gtk.Orientation.VERTICAL,
			spacing: 6,
		});
		savedLayoutsGroup.add(customLayoutsBox);

		const refreshLayoutDropdowns = () => {
			layoutOptions = Object.keys(layouts);
			for (let i = 0; i < customLayouts.length; i++)
				layoutOptions.push(_("Custom Layout") + " " + (i + 1));
			if (layoutOptions.length == 0)
				layoutOptions = [_("Default")];

			layoutLandscapeDrop.set_model(Gtk.StringList.new(layoutOptions));
			layoutPortraitDrop.set_model(Gtk.StringList.new(layoutOptions));
			layoutLandscapeDrop.sensitive = Object.keys(layouts).length > 0 || customLayouts.length > 0;
			layoutPortraitDrop.sensitive = Object.keys(layouts).length > 0 || customLayouts.length > 0;
			layoutLandscapeDrop.selected = clampIndex(settings.get_int("layout-landscape"), layoutOptions.length);
			layoutPortraitDrop.selected = clampIndex(settings.get_int("layout-portrait"), layoutOptions.length);
		};

		const rebuildCustomLayoutRows = () => {
			let child;
			while ((child = customLayoutsBox.get_first_child()) != null)
				customLayoutsBox.remove(child);

			for (let i = 0; i < customLayouts.length; i++) {
				const json = customLayouts[i];
				const row = new Adw.ActionRow({
					title: _("Custom Layout") + " " + (i + 1),
					subtitle: json,
				});
				const editButton = new Gtk.Button({
					icon_name: "document-edit-symbolic",
					valign: Gtk.Align.CENTER,
				});
				editButton.connect("clicked", () => {
					customLayoutEntry.set_text(json);
				});
				const deleteButton = new Gtk.Button({
					icon_name: "user-trash-symbolic",
					valign: Gtk.Align.CENTER,
				});
				deleteButton.connect("clicked", () => {
					customLayouts.splice(i, 1);
					settings.set_string("custom-layout", JSON.stringify(customLayouts));
					refreshLayoutDropdowns();
					rebuildCustomLayoutRows();
				});
				row.add_suffix(editButton);
				row.add_suffix(deleteButton);
				customLayoutsBox.append(row);
			}
		};

		addCustomLayoutButton.connect("clicked", () => {
			const rawJson = customLayoutEntry.get_text();
			try {
				const parsed = JSON.parse(rawJson);
				if (!Array.isArray(parsed) || parsed.length == 0)
					throw new Error("Custom layout must be a non-empty JSON array");

				const lastRow = parsed[parsed.length - 1];
				if (typeof lastRow !== "object" || Array.isArray(lastRow))
					parsed.push({ split: false, settings: true, close: true });

				const json = JSON.stringify(parsed);
				customLayouts.push(json);
				settings.set_string("custom-layout", JSON.stringify(customLayouts));
				customLayoutEntry.set_text("");
				refreshLayoutDropdowns();
				rebuildCustomLayoutRows();
			} catch (e) {
				logError(e, "Failed to add GJS OSK custom layout");
			}
		});

		rebuildCustomLayoutRows();
		window.add(customLayoutPage);

		let page2 = new Adw.PreferencesPage({
			title: _("About"),
			icon_name: 'info-symbolic',
		});

		let contribute_icon_pref_group = new Adw.PreferencesGroup();
		let icon_box = new Gtk.Box({
			orientation: Gtk.Orientation.VERTICAL,
			margin_top: 24,
			margin_bottom: 24,
			spacing: 18,
		});

		let icon_image = new Gtk.Image({
			icon_name: "input-keyboard-symbolic",
			pixel_size: 128,
		});

		let label_box = new Gtk.Box({
			orientation: Gtk.Orientation.VERTICAL,
			spacing: 6,
		});

		let label = new Gtk.Label({
			label: "GJS OSK",
			wrap: true,
		});
		let context = label.get_style_context();
		context.add_class("title-1");

		let another_label = new Gtk.Label({
			label: _("Autorelease ") + `{{VERSION}}`
		});

		let links_pref_group = new Adw.PreferencesGroup();
		let code_row = new Adw.ActionRow({
			icon_name: "code-symbolic",
			title: _("More Information, submit feedback, and get help")
		});
		let github_link = new Gtk.LinkButton({
			label: "Github",
			uri: "https://github.com/Vishram1123/gjs-osk",
		});

		let icons_credit = new Adw.ActionRow({
			icon_name: "app-icon-design-symbolic",
			title: _("Icons sourced from")
		});
		let remixicon_link = new Gtk.LinkButton({
			label: "RemixIcon",
			uri: "https://remixicon.com/",
		});

		code_row.add_suffix(github_link);
		code_row.set_activatable_widget(github_link);
		links_pref_group.add(code_row);
		icons_credit.add_suffix(remixicon_link);
		icons_credit.set_activatable_widget(remixicon_link);
		links_pref_group.add(icons_credit);

		label_box.append(label);
		label_box.append(another_label);
		icon_box.append(icon_image);
		icon_box.append(label_box);
		contribute_icon_pref_group.add(icon_box);

		page2.add(contribute_icon_pref_group);
		page2.add(links_pref_group);

		window.add(page2);

		settings.bind("layout-landscape", layoutLandscapeDrop, "selected", 0);
		settings.bind("layout-portrait", layoutPortraitDrop, "selected", 0);
		settings.bind("disable-edge-swipe", disableEdgeSwipeDT, "active", 0);
		settings.bind("enable-drag", dragEnableDT, "active", 0);
		settings.bind("enable-tap-gesture", dragOpt, "selected", 0);
		settings.bind("indicator-enabled", indEnabled, "active", 0);
		settings.bind("portrait-width-percent", numChanger_pW, "value", 0);
		settings.bind("portrait-height-percent", numChanger_pH, "value", 0);
		settings.bind("landscape-width-percent", numChanger_lW, "value", 0);
		settings.bind("landscape-height-percent", numChanger_lH, "value", 0);
		colorButton.connect("color-set", () => {
			settings.set_double("background-r", Math.round(colorButton.get_rgba().red * 255));
			settings.set_double("background-g", Math.round(colorButton.get_rgba().green * 255));
			settings.set_double("background-b", Math.round(colorButton.get_rgba().blue * 255));
			settings.set_double("background-a", colorButton.get_rgba().alpha);
		})
		colorButton_d.connect("color-set", () => {
			settings.set_double("background-r-dark", Math.round(colorButton_d.get_rgba().red * 255));
			settings.set_double("background-g-dark", Math.round(colorButton_d.get_rgba().green * 255));
			settings.set_double("background-b-dark", Math.round(colorButton_d.get_rgba().blue * 255));
			settings.set_double("background-a-dark", colorButton_d.get_rgba().alpha);
		})
		settings.bind("font-size-px", numChanger_font, "value", 0);
		settings.bind("font-bold", fontBoldEnabled, "active", 0)
		settings.bind("border-spacing-px", numChanger_bord, "value", 0);
		settings.bind("outer-spacing-px", numChanger_outer, "value", 0);
		settings.bind("snap-spacing-px", numChanger_snap, "value", 0)
		settings.bind("round-key-corners", roundKeyCDT, "active", 0);
		settings.bind("enable-key-repeat", enableKeyRepeatDT, "active", 0);
		settings.bind("key-repeat-rate", numChanger_keyRepeat, "value", 0);
		settings.bind("play-sound", soundPlayRow, "enable-expansion", 0);
		settings.bind("show-icons", showIconDT, "active", 0)
		settings.bind("default-snap", snapDrop, "selected", 0);
		const writeMonitorSetting = () => {
			if (monitors.length == 0)
				return;

			currentMonitorMap[monitors.length + ""] = monitorConnectors[monitorDrop.selected] ?? monitorConnectors[0];
			let representation = [];
			for (var k of Object.keys(currentMonitorMap)) {
				representation.push(k + ":" + currentMonitorMap[k])
			}
			settings.set_string("default-monitor", representation.join(";"))
		}
		monitorDrop.connect("notify::selected", writeMonitorSetting)
		systemAccColEnabled.connect("state-set", () => {
			settings.set_boolean("system-accent-col", systemAccColEnabled.active)
			lightCol.set_sensitive(!settings.get_boolean("system-accent-col"));
			darkCol.set_sensitive(!settings.get_boolean("system-accent-col"));
		})

		window.connect("close-request", () => {
			settings.set_int("layout-landscape", layoutLandscapeDrop.selected);
			settings.set_int("layout-portrait", layoutPortraitDrop.selected);
			settings.set_boolean("disable-edge-swipe", disableEdgeSwipeDT.active);
			settings.set_boolean("enable-drag", dragEnableDT.active);
			settings.set_int("enable-tap-gesture", dragOpt.selected);
			settings.set_boolean("indicator-enabled", indEnabled.active);
			settings.set_int("portrait-width-percent", numChanger_pW.value);
			settings.set_int("portrait-height-percent", numChanger_pH.value);
			settings.set_int("landscape-width-percent", numChanger_lW.value);
			settings.set_int("landscape-height-percent", numChanger_lH.value);
			settings.set_double("background-r", Math.round(colorButton.get_rgba().red * 255));
			settings.set_double("background-g", Math.round(colorButton.get_rgba().green * 255));
			settings.set_double("background-b", Math.round(colorButton.get_rgba().blue * 255));
			settings.set_double("background-a", colorButton.get_rgba().alpha);
			settings.set_double("background-r-dark", Math.round(colorButton_d.get_rgba().red * 255));
			settings.set_double("background-g-dark", Math.round(colorButton_d.get_rgba().green * 255));
			settings.set_double("background-b-dark", Math.round(colorButton_d.get_rgba().blue * 255));
			settings.set_double("background-a-dark", colorButton_d.get_rgba().alpha);
			settings.set_int("font-size-px", numChanger_font.value);
			settings.set_boolean("font-bold", fontBoldEnabled.active)
			settings.set_int("border-spacing-px", numChanger_bord.value);
			settings.set_int("outer-spacing-px", numChanger_outer.value);
			settings.set_int("snap-spacing-px", numChanger_snap.value)
			settings.set_boolean("round-key-corners", roundKeyCDT.active);
			settings.set_boolean("enable-key-repeat", enableKeyRepeatDT.active);
			settings.set_int("key-repeat-rate", numChanger_keyRepeat.value);
			settings.set_boolean("play-sound", soundPlayRow.enable_expansion);
			settings.set_boolean("show-icons", showIconDT.active)
			settings.set_int("default-snap", snapDrop.selected);
			writeMonitorSetting()
			settings.set_boolean("system-accent-col", systemAccColEnabled.active)
		})
	}
};
