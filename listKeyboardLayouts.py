import xml.etree.ElementTree as et


def read_names(path: str) -> list[str]:
    names = []
    tree = et.parse(path)
    root = tree.getroot()

    layout_list = root.find('layoutList')
    if layout_list is None:
        return names

    for layout in layout_list:
        config_item = layout.find('configItem')
        name = config_item.find('name') if config_item is not None else None
        if name is not None and name.text:
            names.append(name.text)

    return names


def main():
    base_names = read_names('/usr/share/X11/xkb/rules/evdev.xml')
    extra_names = read_names('/usr/share/X11/xkb/rules/evdev.extras.xml')

    names = set(base_names)
    names.update(extra_names)

    for name in sorted(names):
        print(name)


if __name__ == '__main__':
    main()
