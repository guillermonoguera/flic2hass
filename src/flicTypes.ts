

export type Orientation = {
    x: number;
    y: number;
    z: number;
}

export type Button = {
    bdaddr: string // Device address of button
    serialNumber: string // Serial number
    color: string // Colour of the button (lowercase)
    name: string // The user assigned button name
    activeDisconnect: boolean // The user has explicitly disconnected the button
    connected: boolean // The connection to the button is currently established
    ready: boolean // The connection is verified (see buttonReady)
    batteryStatus: number | null // Battery level in percent (0-100), or null if unknown
    batteryTimestamp: number | null // Last time the battery was updated
    firmwareVersion: number | null // Firmware version of button, or null if unknown
    flicVersion: number | null // Flic version (1 or 2)
    uuid: string // A 32 characters long hex string, unique for every button
    key: number | null // A 40 characters long hex string (only for Flic 2)
}

export type ButtonEventBase = {
    bdaddr: string;
    buttonNumber: number; // 0 = big button (or only button), 1 = small button (Flic Duo)
    orientation?: Orientation; // only for Flic Duo
}

export type ButtonClickOrHoldEvent = ButtonEventBase & {
    isClick: boolean;
    isHold: boolean;
    gesture?: string | null; // "left", "right", "up", "down", "unrecognized", or null
}

export type ButtonSingleOrDoubleClickEvent = ButtonEventBase & {
    isSingleClick: boolean;
    isDoubleClick: boolean;
    gesture?: string | null;
}

export type ButtonSingleOrDoubleClickOrHoldEvent = ButtonEventBase & {
    isSingleClick: boolean;
    isDoubleClick: boolean;
    isHold: boolean;
    gesture?: string | null;
}

export interface ButtonModule {
    getButtons(): Button[],
    getButton(bdaddr: string): Button,
    on(ev: "buttonAdded", cb: (btn: Button) => void): void,
    on(ev: "buttonUpdated", cb: (btn: Button) => void): void,
    on(ev: "buttonDeleted", cb: (btn: Button) => void): void,
    on(ev: "buttonConnected", cb: (btn: Button) => void): void,
    on(ev: "buttonReady", cb: (obj: { bdaddr: string }) => void): void,
    on(ev: "buttonDisconnected", cb: (obj: { bdaddr: string }) => void): void,
    on(ev: "buttonDown", cb: (obj: ButtonEventBase) => void): void,
    on(ev: "buttonUp", cb: (obj: ButtonEventBase & { gesture?: string | null }) => void): void,
    on(ev: "buttonClickOrHold", cb: (obj: ButtonClickOrHoldEvent) => void): void,
    on(ev: "buttonSingleOrDoubleClick", cb: (obj: ButtonSingleOrDoubleClickEvent) => void): void,
    on(ev: "buttonSingleOrDoubleClickOrHold", cb: (obj: ButtonSingleOrDoubleClickOrHoldEvent) => void): void,
}
