import { HAComponent, HADevice, HAmqtt } from "./HAmqtt";
import { makeLogger } from "./Logger";
import { Button, ButtonModule, ButtonSingleOrDoubleClickOrHoldEvent } from "./flicTypes";

const ms2ISO8601 = (ms: number): string =>
    (new Date(ms)).toISOString().slice(0, 19).replace('T', ' ')

export type ButtonControllerOpt = {
    debug: boolean;
}
export const makeOptions = (opt: Partial<ButtonControllerOpt>): ButtonControllerOpt => ({
    debug: false,
    ...opt,
})

// Button label used in entity names and subtypes
const BUTTON_LABELS: Record<number, string> = {
    0: 'big',
    1: 'small',
};

// Entities shared across all button types (standard Flic + Duo)
const SHARED_ENTITIES: Record<string, [HAComponent, Record<string, any>]> = {
    "battery": ['sensor', { expire_after: 5, unit_of_measurement: '%', device_class: 'battery' }],
    "batteryLastUpdate": ['sensor', { entity_category: "diagnostic", expire_after: 5, name: "Battery Last Update Time", device_class: "duration", unit_of_measurement: "s" }],
    "lifeline": ['binary_sensor', { entity_category: "diagnostic", expire_after: 5, name: "Flichub Connected", device_class: "connectivity", unit_of_measurement: "s", payload_not_available: "OFF" }],
    "connected": ['binary_sensor', { entity_category: "diagnostic", expire_after: 5, device_class: 'connectivity', name: "Connection Established", payload_not_available: "OFF" }],
    "ready": ['binary_sensor', { entity_category: "config", expire_after: 5, device_class: 'connectivity', name: "Connection Verified" }],
    "activeDisconnect": ['binary_sensor', { entity_category: "config", expire_after: 5, name: "User Active Disconnect" }],
    "passive": ['binary_sensor', { entity_category: "config", expire_after: 5, name: "Passive Mode" }],
}

// Per-button entities (for standard Flic: one set; for Duo: one set per physical button)
function makePerButtonEntities(label: string, subtype: string): Record<string, [HAComponent, Record<string, any>]> {
    const namePrefix = label ? `${label.charAt(0).toUpperCase() + label.slice(1)} ` : '';
    return {
        [`${label ? label + '_' : ''}action`]: ['sensor', { icon: 'mdi:gesture-tap-button', name: `${namePrefix}Click Action` }],
        [`${label ? label + '_' : ''}state`]: ['sensor', { icon: 'mdi:radiobox-indeterminate-variant', name: `${namePrefix}State` }],
        [`${label ? label + '_' : ''}button_short_press`]: [
            'device_automation',
            { 'type': 'button_short_press', 'subtype': subtype, 'automation_type': 'trigger', 'payload': 'ON' }
        ],
        [`${label ? label + '_' : ''}button_long_press`]: [
            'device_automation',
            { 'type': 'button_long_press', 'subtype': subtype, 'automation_type': 'trigger', 'payload': 'ON' }
        ],
        [`${label ? label + '_' : ''}button_double_press`]: [
            'device_automation',
            { 'type': 'button_double_press', 'subtype': subtype, 'automation_type': 'trigger', 'payload': 'ON' }
        ],
    }
}

// Duo-only entities
const DUO_EXTRA_ENTITIES: Record<string, [HAComponent, Record<string, any>]> = {
    "gesture": ['sensor', { icon: 'mdi:gesture-swipe', name: "Gesture" }],
}

export type ButtonController = ReturnType<typeof makeButtonController>;
export function makeButtonController(
    ha: HAmqtt,
    buttonModule: ButtonModule,
    options: Partial<ButtonControllerOpt> = {},
) {
    options = makeOptions(options);
    const logger = makeLogger('btnc', options.debug)
    logger.info("Starting Flic ButtonController with", JSON.stringify(options, null, 4));

    // Track which buttons are Duo (detected when we receive a buttonNumber === 1 event)
    // We also treat any button whose name contains "duo" (case insensitive) as a Duo.
    const knownDuoButtons = new Set<string>();

    const isDuo = (button: Button): boolean => {
        if (knownDuoButtons.has(button.bdaddr)) return true;
        // Heuristic: if the button name contains "duo", treat it as a Duo
        if (button.name && button.name.toLowerCase().includes('duo')) {
            knownDuoButtons.add(button.bdaddr);
            return true;
        }
        return false;
    }

    const markAsDuo = (bdaddr: string): void => {
        if (!knownDuoButtons.has(bdaddr)) {
            knownDuoButtons.add(bdaddr);
            // Re-register with Duo entities
            const button = buttonModule.getButton(bdaddr);
            if (button) {
                logger.info('Detected Duo button, re-registering:', button.name, bdaddr);
                registerButton(button);
            }
        }
    }

    const getDeviceFromButton = (button: Button): HADevice => {
        const duoSuffix = isDuo(button) ? ' Duo' : '';
        return {
            name: button.name,
            identifiers: [button.serialNumber, button.uuid],
            manufacturer: 'Flic',
            model: `v${button.flicVersion}_${button.color.trim().length > 0 ? button.color : 'white'}${duoSuffix}`,
            sw: String(button.firmwareVersion),
            hw: String(button.flicVersion),
            configuration_url: "https://hubsdk.flic.io/",
        }
    }

    const genButtonUniqueId = (bdaddr: string): string => bdaddr.replace(/:/g, '_')

    const getAllEntities = (button: Button): Record<string, [HAComponent, Record<string, any>]> => {
        if (isDuo(button)) {
            return {
                ...SHARED_ENTITIES,
                ...makePerButtonEntities('big', 'big_button'),
                ...makePerButtonEntities('small', 'small_button'),
                ...DUO_EXTRA_ENTITIES,
            };
        } else {
            return {
                ...SHARED_ENTITIES,
                ...makePerButtonEntities('', 'button_1'),
            };
        }
    }

    const registerButton = (button: Button) => {
        logger.info('Registering', JSON.stringify(button, null, 4))
        const haDevice = getDeviceFromButton(button);
        const entities = getAllEntities(button);
        Object.keys(entities).forEach(objectId => {
            let avl: any = {
                availability: [
                    {
                        payload_available: 'ON',
                        payload_not_available: 'unavailable',
                        topic: ha.genFlicPrefix(genButtonUniqueId(button.bdaddr), 'ready')
                    },
                    {
                        payload_available: 'ON',
                        payload_not_available: 'unavailable',
                        topic: ha.genFlicPrefix(genButtonUniqueId(button.bdaddr), 'lifeline')
                    },
                ],
                availability_mode: 'all',
            };
            if (objectId === 'lifeline') {
                avl = {}
            }
            if (objectId === 'ready' || objectId == 'connected') {
                avl.availability = [avl.availability[1]]
            }
            if (entities[objectId][0] === 'device_automation') {
                avl = {}
            }
            ha.registerEntity(
                `Button ${objectId}`,
                entities[objectId][0],
                genButtonUniqueId(button.bdaddr),
                objectId,
                haDevice,
                {
                    ...entities[objectId][1],
                    ...avl
                },
            )
        });
    }

    const deregisterButton = (button: Button) => {
        logger.info('Deregistering', JSON.stringify(button, null, 4))
        const entities = getAllEntities(button);
        Object.keys(entities).forEach(objectId => {
            ha.deregisterEntity(
                entities[objectId][0],
                genButtonUniqueId(button.bdaddr),
                objectId,
            )
        });
    }

    // Resolve the entity prefix for a given button press event
    // For standard buttons: '' (no prefix)
    // For Duo buttons: 'big_' or 'small_'
    const getButtonPrefix = (bdaddr: string, buttonNumber: number): string => {
        if (!knownDuoButtons.has(bdaddr)) return '';
        return buttonNumber === 1 ? 'small_' : 'big_';
    }

    const publishButtonState = (button: Button, state: 'released' | 'pressed', buttonNumber: number = 0) => {
        const prefix = getButtonPrefix(button.bdaddr, buttonNumber);
        ha.publishState(genButtonUniqueId(button.bdaddr), `${prefix}state`, state);
    }

    const publishButtonAction = (button: Button, state: 'click' | 'double_click' | 'hold' | 'none', buttonNumber: number = 0) => {
        const prefix = getButtonPrefix(button.bdaddr, buttonNumber);
        ha.publishState(genButtonUniqueId(button.bdaddr), `${prefix}action`, state);
        if (state === 'click') {
            ha.publishState(genButtonUniqueId(button.bdaddr), `${prefix}button_short_press`, 'ON')
        } else if (state === 'double_click') {
            ha.publishState(genButtonUniqueId(button.bdaddr), `${prefix}button_double_press`, 'ON')
        } else if (state === 'hold') {
            ha.publishState(genButtonUniqueId(button.bdaddr), `${prefix}button_long_press`, 'ON')
        }
    }

    const publishGesture = (bdaddr: string, gesture: string | null | undefined) => {
        if (!knownDuoButtons.has(bdaddr)) return;
        if (gesture && gesture !== 'unrecognized') {
            ha.publishState(genButtonUniqueId(bdaddr), 'gesture', gesture);
        }
    }

    const publishButtonMeta = (button: Button) => {
        ha.publishState(genButtonUniqueId(button.bdaddr), 'battery', button.batteryStatus);
        ha.publishState(genButtonUniqueId(button.bdaddr), 'batteryLastUpdate', button.batteryTimestamp ? `${Math.round((Date.now() - button.batteryTimestamp) / 1000)}` : 'unknown');
        ha.publishState(genButtonUniqueId(button.bdaddr), 'connected', button.connected ? 'ON' : "OFF");
        ha.publishState(genButtonUniqueId(button.bdaddr), 'ready', button.ready ? 'ON' : "OFF");
        ha.publishState(genButtonUniqueId(button.bdaddr), 'activeDisconnect', button.activeDisconnect ? 'ON' : "OFF");
        ha.publishState(genButtonUniqueId(button.bdaddr), 'passive', button.activeDisconnect ? 'ON' : "OFF");
        ha.publishState(genButtonUniqueId(button.bdaddr), 'lifeline', 'ON');
    }

    const addBtn = (eventName: string) => (obj: { bdaddr: string }) => {
        const button = buttonModule.getButton(obj.bdaddr);
        logger.info(eventName, "upserting", button.name, genButtonUniqueId(button.bdaddr));
        registerButton(button);
    }

    const start = () => {
        logger.info("Starting...")
        let resetActionInvs: Record<string, any> = {};
        buttonModule.on('buttonAdded', addBtn('buttonAdded'));
        buttonModule.on('buttonConnected', addBtn('buttonConnected'));
        buttonModule.on('buttonReady', (btn) => {
            addBtn('buttonReady')(btn);
            const button = buttonModule.getButton(btn.bdaddr);
            publishButtonState(button, 'released', 0);
            publishButtonAction(button, 'none', 0);
            if (isDuo(button)) {
                publishButtonState(button, 'released', 1);
                publishButtonAction(button, 'none', 1);
                ha.publishState(genButtonUniqueId(button.bdaddr), 'gesture', 'none');
            }
        });
        buttonModule.on('buttonUpdated', addBtn('buttonUpdated'));
        buttonModule.on('buttonDeleted', (btn) => {
            logger.debug('buttonDeleted', JSON.stringify(btn, null, 4))
            deregisterButton(btn);
            publishButtonMeta(btn);
        });
        buttonModule.on('buttonDisconnected', ({ bdaddr }) => {
            publishButtonMeta(buttonModule.getButton(bdaddr));
        });
        buttonModule.on('buttonDown', (obj) => {
            const btn = buttonModule.getButton(obj.bdaddr);
            // If we see buttonNumber === 1, this is definitely a Duo
            if (obj.buttonNumber === 1) markAsDuo(obj.bdaddr);
            publishButtonState(btn, 'pressed', obj.buttonNumber ?? 0);
            publishButtonMeta(btn);
        });
        buttonModule.on('buttonUp', (obj) => {
            const btn = buttonModule.getButton(obj.bdaddr);
            if (obj.buttonNumber === 1) markAsDuo(obj.bdaddr);
            publishButtonState(btn, 'released', obj.buttonNumber ?? 0);
            // Publish gesture if present (Duo only)
            if (obj.gesture) {
                publishGesture(obj.bdaddr, obj.gesture);
            }
            publishButtonMeta(btn);
        });
        buttonModule.on('buttonSingleOrDoubleClickOrHold', (obj: ButtonSingleOrDoubleClickOrHoldEvent) => {
            if (obj.buttonNumber === 1) markAsDuo(obj.bdaddr);
            const buttonNumber = obj.buttonNumber ?? 0;
            const resetKey = `${obj.bdaddr}_${buttonNumber}`;

            if (resetActionInvs[resetKey] !== undefined) {
                clearTimeout(resetActionInvs[resetKey]);
            }
            const btn = buttonModule.getButton(obj.bdaddr);
            const action = obj.isSingleClick ? "click" : obj.isDoubleClick ? "double_click" : "hold";
            publishButtonAction(btn, action, buttonNumber);
            publishButtonMeta(btn);

            // Publish gesture if present (Duo only)
            if (obj.gesture) {
                publishGesture(obj.bdaddr, obj.gesture);
            }

            resetActionInvs[resetKey] = setTimeout(() => {
                publishButtonAction(btn, 'none', buttonNumber);
                delete resetActionInvs[resetKey];
            }, 500);
        });
        logger.info("Registering all buttons...")
        buttonModule.getButtons().forEach(registerButton);
        setInterval(() => buttonModule.getButtons().forEach(publishButtonMeta), 3000);
        logger.info('is up')
    }

    return {
        start,
        publishButtonAction,
        publishButtonMeta,
        publishButtonState,
    }
}
