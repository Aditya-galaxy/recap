import Carbon.HIToolbox

/// A single global hot key (⌥⌘R) via the Carbon event API. Unlike NSEvent global monitors,
/// this needs no Accessibility permission.
final class HotKey {
    private static var handler: (() -> Void)?
    private var ref: EventHotKeyRef?
    private var eventHandler: EventHandlerRef?

    init(keyCode: Int = kVK_ANSI_R, modifiers: Int = optionKey | cmdKey, handler: @escaping () -> Void) {
        HotKey.handler = handler
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
            HotKey.handler?()
            return noErr
        }, 1, &spec, nil, &eventHandler)
        let id = EventHotKeyID(signature: OSType(0x5243_4150), id: 1) // "RCAP"
        RegisterEventHotKey(UInt32(keyCode), UInt32(modifiers), id, GetApplicationEventTarget(), 0, &ref)
    }

    deinit {
        if let ref { UnregisterEventHotKey(ref) }
        if let eventHandler { RemoveEventHandler(eventHandler) }
    }
}
