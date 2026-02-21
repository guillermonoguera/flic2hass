'use strict';

// ============================================================================
// Logger
// ============================================================================

function makeLogger(prefix, debugMode) {
    if (debugMode === undefined) debugMode = false;
    return {
        info: function() {
            var args = Array.prototype.slice.call(arguments);
            console.log(prefix + "|INFO| " + args.map(String).join("\t"));
        },
        error: function() {
            var args = Array.prototype.slice.call(arguments);
            console.log(prefix + "|ERROR| " + args.map(String).join("\t"));
        },
        debug: function() {
            var args = Array.prototype.slice.call(arguments);
            if (debugMode) {
                console.log(prefix + "|DEBUG| " + args.map(String).join("\t"));
            }
        }
    };
}

// ============================================================================
// HAmqtt
// ============================================================================

function makeHAmqttOptions(opt) {
    var result = {
        debug: false,
        topics: {
            homeassistant: 'homeassistant',
            flic: 'flic'
        }
    };
    if (opt.debug !== undefined) result.debug = opt.debug;
    if (opt.topics) {
        if (opt.topics.homeassistant) result.topics.homeassistant = opt.topics.homeassistant;
        if (opt.topics.flic) result.topics.flic = opt.topics.flic;
    }
    return result;
}

function makeHAmqtt(mqttServer, options) {
    if (!options) options = {};
    options = makeHAmqttOptions(options);
    var logger = makeLogger('mqtt:ha', options.debug);
    logger.info("starting...", JSON.stringify(options, null, 4));

    var genFlicPrefix = function(nodeId, objectId) {
        return options.topics.flic + "/" + nodeId + "/" + objectId;
    };

    var genHAPrefix = function(component, nodeId, objectId) {
        return options.topics.homeassistant + "/" + component + "/" + nodeId + "/" + objectId;
    };

    var publishState = function(nodeId, objectId, state, opt) {
        if (!opt) opt = {};
        var btntopic = genFlicPrefix(nodeId, objectId);
        mqttServer.publish(btntopic, state + "", opt);
        logger.debug(btntopic, state, JSON.stringify(opt));
    };

    var registerEntity = function(name, component, nodeId, objectId, device, additionalProps) {
        if (!additionalProps) additionalProps = {};
        var configtopic = genHAPrefix(component, nodeId, objectId) + "/config";
        if (component === 'device_automation') {
            additionalProps.topic = genFlicPrefix(nodeId, objectId);
        } else {
            additionalProps.state_topic = genFlicPrefix(nodeId, objectId);
        }
        var configObj = {};
        configObj.name = name;
        var keys = Object.keys(additionalProps);
        for (var i = 0; i < keys.length; i++) {
            configObj[keys[i]] = additionalProps[keys[i]];
        }
        configObj.unique_id = "Flic_" + nodeId + "_" + objectId;
        configObj.device = device;
        mqttServer.publish(configtopic, JSON.stringify(configObj), { retain: true });
        logger.debug(configtopic, JSON.stringify(configObj, null, 4));
    };

    var deregisterEntity = function(component, nodeId, objectId) {
        var configtopic = genHAPrefix(component, nodeId, objectId) + "/config";
        mqttServer.publish(configtopic, null, { retain: false });
        logger.debug(configtopic, null);
    };

    return {
        deregisterEntity: deregisterEntity,
        registerEntity: registerEntity,
        publishState: publishState,
        genFlicPrefix: genFlicPrefix
    };
}

// ============================================================================
// ButtonController
// ============================================================================

var BUTTON_LABELS = { 0: 'big', 1: 'small' };

var SHARED_ENTITIES = {
    "battery": ['sensor', { expire_after: 5, unit_of_measurement: '%', device_class: 'battery' }],
    "batteryLastUpdate": ['sensor', { entity_category: "diagnostic", expire_after: 5, name: "Battery Last Update Time", device_class: "duration", unit_of_measurement: "s" }],
    "lifeline": ['binary_sensor', { entity_category: "diagnostic", expire_after: 5, name: "Flichub Connected", device_class: "connectivity", unit_of_measurement: "s", payload_not_available: "OFF" }],
    "connected": ['binary_sensor', { entity_category: "diagnostic", expire_after: 5, device_class: 'connectivity', name: "Connection Established", payload_not_available: "OFF" }],
    "ready": ['binary_sensor', { entity_category: "config", expire_after: 5, device_class: 'connectivity', name: "Connection Verified" }],
    "activeDisconnect": ['binary_sensor', { entity_category: "config", expire_after: 5, name: "User Active Disconnect" }],
    "passive": ['binary_sensor', { entity_category: "config", expire_after: 5, name: "Passive Mode" }]
};

function makePerButtonEntities(label, subtype) {
    var namePrefix = label ? (label.charAt(0).toUpperCase() + label.slice(1) + ' ') : '';
    var prefix = label ? (label + '_') : '';
    var result = {};
    result[prefix + "action"] = ['sensor', { icon: 'mdi:gesture-tap-button', name: namePrefix + "Click Action" }];
    result[prefix + "state"] = ['sensor', { icon: 'mdi:radiobox-indeterminate-variant', name: namePrefix + "State" }];
    result[prefix + "button_short_press"] = [
        'device_automation',
        { 'type': 'button_short_press', 'subtype': subtype, 'automation_type': 'trigger', 'payload': 'ON' }
    ];
    result[prefix + "button_long_press"] = [
        'device_automation',
        { 'type': 'button_long_press', 'subtype': subtype, 'automation_type': 'trigger', 'payload': 'ON' }
    ];
    result[prefix + "button_double_press"] = [
        'device_automation',
        { 'type': 'button_double_press', 'subtype': subtype, 'automation_type': 'trigger', 'payload': 'ON' }
    ];
    return result;
}

var DUO_EXTRA_ENTITIES = {
    "gesture": ['sensor', { icon: 'mdi:gesture-swipe', name: "Gesture" }]
};

function makeButtonControllerOptions(opt) {
    return {
        debug: (opt && opt.debug) ? opt.debug : false
    };
}

function makeButtonController(ha, buttonModule, options) {
    if (!options) options = {};
    options = makeButtonControllerOptions(options);
    var logger = makeLogger('btnc', options.debug);
    logger.info("Starting Flic ButtonController with", JSON.stringify(options, null, 4));

    // Track which buttons are Duo
    var knownDuoButtons = {};

    var isDuo = function(button) {
        if (knownDuoButtons[button.bdaddr]) return true;
        if (button.name && button.name.toLowerCase().indexOf('duo') !== -1) {
            knownDuoButtons[button.bdaddr] = true;
            return true;
        }
        return false;
    };

    var markAsDuo = function(bdaddr) {
        if (!knownDuoButtons[bdaddr]) {
            knownDuoButtons[bdaddr] = true;
            var button = buttonModule.getButton(bdaddr);
            if (button) {
                logger.info('Detected Duo button, re-registering:', button.name, bdaddr);
                registerButton(button);
            }
        }
    };

    var getDeviceFromButton = function(button) {
        var duoSuffix = isDuo(button) ? ' Duo' : '';
        var color = button.color.trim().length > 0 ? button.color : 'white';
        return {
            name: button.name,
            identifiers: [button.serialNumber, button.uuid],
            manufacturer: 'Flic',
            model: 'v' + button.flicVersion + '_' + color + duoSuffix,
            sw: String(button.firmwareVersion),
            hw: String(button.flicVersion),
            configuration_url: "https://hubsdk.flic.io/"
        };
    };

    var genButtonUniqueId = function(bdaddr) {
        return bdaddr.replace(/:/g, '_');
    };

    var getAllEntities = function(button) {
        var result = {};
        var sharedKeys = Object.keys(SHARED_ENTITIES);
        for (var i = 0; i < sharedKeys.length; i++) {
            result[sharedKeys[i]] = SHARED_ENTITIES[sharedKeys[i]];
        }
        if (isDuo(button)) {
            var bigEnts = makePerButtonEntities('big', 'big_button');
            var bigKeys = Object.keys(bigEnts);
            for (var i = 0; i < bigKeys.length; i++) {
                result[bigKeys[i]] = bigEnts[bigKeys[i]];
            }
            var smallEnts = makePerButtonEntities('small', 'small_button');
            var smallKeys = Object.keys(smallEnts);
            for (var i = 0; i < smallKeys.length; i++) {
                result[smallKeys[i]] = smallEnts[smallKeys[i]];
            }
            var duoKeys = Object.keys(DUO_EXTRA_ENTITIES);
            for (var i = 0; i < duoKeys.length; i++) {
                result[duoKeys[i]] = DUO_EXTRA_ENTITIES[duoKeys[i]];
            }
        } else {
            var stdEnts = makePerButtonEntities('', 'button_1');
            var stdKeys = Object.keys(stdEnts);
            for (var i = 0; i < stdKeys.length; i++) {
                result[stdKeys[i]] = stdEnts[stdKeys[i]];
            }
        }
        return result;
    };

    var registerButton = function(button) {
        logger.info('Registering', JSON.stringify(button, null, 4));
        var haDevice = getDeviceFromButton(button);
        var entities = getAllEntities(button);
        var entityKeys = Object.keys(entities);
        for (var i = 0; i < entityKeys.length; i++) {
            var objectId = entityKeys[i];
            var avl = {
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
                    }
                ],
                availability_mode: 'all'
            };
            if (objectId === 'lifeline') {
                avl = {};
            }
            if (objectId === 'ready' || objectId === 'connected') {
                avl.availability = [avl.availability[1]];
            }
            if (entities[objectId][0] === 'device_automation') {
                avl = {};
            }
            var props = {};
            var entProps = entities[objectId][1];
            var propKeys = Object.keys(entProps);
            for (var j = 0; j < propKeys.length; j++) {
                props[propKeys[j]] = entProps[propKeys[j]];
            }
            var avlKeys = Object.keys(avl);
            for (var j = 0; j < avlKeys.length; j++) {
                props[avlKeys[j]] = avl[avlKeys[j]];
            }
            ha.registerEntity(
                'Button ' + objectId,
                entities[objectId][0],
                genButtonUniqueId(button.bdaddr),
                objectId,
                haDevice,
                props
            );
        }
    };

    var deregisterButton = function(button) {
        logger.info('Deregistering', JSON.stringify(button, null, 4));
        var entities = getAllEntities(button);
        var entityKeys = Object.keys(entities);
        for (var i = 0; i < entityKeys.length; i++) {
            ha.deregisterEntity(
                entities[entityKeys[i]][0],
                genButtonUniqueId(button.bdaddr),
                entityKeys[i]
            );
        }
    };

    var getButtonPrefix = function(bdaddr, buttonNumber) {
        if (!knownDuoButtons[bdaddr]) return '';
        return buttonNumber === 1 ? 'small_' : 'big_';
    };

    var publishButtonState = function(button, state, buttonNumber) {
        if (buttonNumber === undefined) buttonNumber = 0;
        var prefix = getButtonPrefix(button.bdaddr, buttonNumber);
        ha.publishState(genButtonUniqueId(button.bdaddr), prefix + 'state', state);
    };

    var publishButtonAction = function(button, state, buttonNumber) {
        if (buttonNumber === undefined) buttonNumber = 0;
        var prefix = getButtonPrefix(button.bdaddr, buttonNumber);
        ha.publishState(genButtonUniqueId(button.bdaddr), prefix + 'action', state);
        if (state === 'click') {
            ha.publishState(genButtonUniqueId(button.bdaddr), prefix + 'button_short_press', 'ON');
        } else if (state === 'double_click') {
            ha.publishState(genButtonUniqueId(button.bdaddr), prefix + 'button_double_press', 'ON');
        } else if (state === 'hold') {
            ha.publishState(genButtonUniqueId(button.bdaddr), prefix + 'button_long_press', 'ON');
        }
    };

    var publishGesture = function(bdaddr, gesture) {
        if (!knownDuoButtons[bdaddr]) return;
        if (gesture && gesture !== 'unrecognized') {
            ha.publishState(genButtonUniqueId(bdaddr), 'gesture', gesture);
        }
    };

    var publishButtonMeta = function(button) {
        ha.publishState(genButtonUniqueId(button.bdaddr), 'battery', button.batteryStatus);
        ha.publishState(genButtonUniqueId(button.bdaddr), 'batteryLastUpdate',
            button.batteryTimestamp ? ('' + Math.round((Date.now() - button.batteryTimestamp) / 1000)) : 'unknown');
        ha.publishState(genButtonUniqueId(button.bdaddr), 'connected', button.connected ? 'ON' : "OFF");
        ha.publishState(genButtonUniqueId(button.bdaddr), 'ready', button.ready ? 'ON' : "OFF");
        ha.publishState(genButtonUniqueId(button.bdaddr), 'activeDisconnect', button.activeDisconnect ? 'ON' : "OFF");
        ha.publishState(genButtonUniqueId(button.bdaddr), 'passive', button.activeDisconnect ? 'ON' : "OFF");
        ha.publishState(genButtonUniqueId(button.bdaddr), 'lifeline', 'ON');
    };

    var addBtn = function(eventName) {
        return function(obj) {
            var button = buttonModule.getButton(obj.bdaddr);
            logger.info(eventName, "upserting", button.name, genButtonUniqueId(button.bdaddr));
            registerButton(button);
        };
    };

    var start = function() {
        logger.info("Starting...");
        var resetActionInvs = {};
        buttonModule.on('buttonAdded', addBtn('buttonAdded'));
        buttonModule.on('buttonConnected', addBtn('buttonConnected'));
        buttonModule.on('buttonReady', function(btn) {
            addBtn('buttonReady')(btn);
            var button = buttonModule.getButton(btn.bdaddr);
            publishButtonState(button, 'released', 0);
            publishButtonAction(button, 'none', 0);
            if (isDuo(button)) {
                publishButtonState(button, 'released', 1);
                publishButtonAction(button, 'none', 1);
                ha.publishState(genButtonUniqueId(button.bdaddr), 'gesture', 'none');
            }
        });
        buttonModule.on('buttonUpdated', addBtn('buttonUpdated'));
        buttonModule.on('buttonDeleted', function(btn) {
            logger.debug('buttonDeleted', JSON.stringify(btn, null, 4));
            deregisterButton(btn);
            publishButtonMeta(btn);
        });
        buttonModule.on('buttonDisconnected', function(obj) {
            publishButtonMeta(buttonModule.getButton(obj.bdaddr));
        });
        buttonModule.on('buttonDown', function(obj) {
            var btn = buttonModule.getButton(obj.bdaddr);
            var buttonNumber = obj.buttonNumber !== undefined ? obj.buttonNumber : 0;
            if (buttonNumber === 1) markAsDuo(obj.bdaddr);
            publishButtonState(btn, 'pressed', buttonNumber);
            publishButtonMeta(btn);
        });
        buttonModule.on('buttonUp', function(obj) {
            var btn = buttonModule.getButton(obj.bdaddr);
            var buttonNumber = obj.buttonNumber !== undefined ? obj.buttonNumber : 0;
            if (buttonNumber === 1) markAsDuo(obj.bdaddr);
            publishButtonState(btn, 'released', buttonNumber);
            if (obj.gesture) {
                publishGesture(obj.bdaddr, obj.gesture);
            }
            publishButtonMeta(btn);
        });
        buttonModule.on('buttonSingleOrDoubleClickOrHold', function(obj) {
            var buttonNumber = obj.buttonNumber !== undefined ? obj.buttonNumber : 0;
            if (buttonNumber === 1) markAsDuo(obj.bdaddr);
            var resetKey = obj.bdaddr + '_' + buttonNumber;

            if (resetActionInvs[resetKey] !== undefined) {
                clearTimeout(resetActionInvs[resetKey]);
            }
            var btn = buttonModule.getButton(obj.bdaddr);
            var action = obj.isSingleClick ? "click" : obj.isDoubleClick ? "double_click" : "hold";
            publishButtonAction(btn, action, buttonNumber);
            publishButtonMeta(btn);

            if (obj.gesture) {
                publishGesture(obj.bdaddr, obj.gesture);
            }

            resetActionInvs[resetKey] = setTimeout(function() {
                publishButtonAction(btn, 'none', buttonNumber);
                delete resetActionInvs[resetKey];
            }, 500);
        });
        logger.info("Registering all buttons...");
        var allButtons = buttonModule.getButtons();
        for (var i = 0; i < allButtons.length; i++) {
            registerButton(allButtons[i]);
        }
        setInterval(function() {
            var allBtns = buttonModule.getButtons();
            for (var i = 0; i < allBtns.length; i++) {
                publishButtonMeta(allBtns[i]);
            }
        }, 3000);
        logger.info('is up');
    };

    return {
        start: start,
        publishButtonAction: publishButtonAction,
        publishButtonMeta: publishButtonMeta,
        publishButtonState: publishButtonState
    };
}

// ============================================================================
// MQTT Module
// ============================================================================

/* Copyright (c) 2013 Gordon Williams, Pur3 Ltd

------------------------------------------------------------------------------

All sections of code within this repository are licensed under an MIT License:

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

-----------------------------------------------------------------------------

Modified by Flic Shortcut Labs.

*/

/** 'private' constants */
var C = {
    PROTOCOL_LEVEL: 4,  // MQTT protocol level
    DEF_PORT: 1883, // MQTT default server port
    DEF_KEEP_ALIVE: 60   // Default keep_alive (s)
};

/** Control packet types */
var TYPE = {
    CONNECT: 1,
    CONNACK: 2,
    PUBLISH: 3,
    PUBACK: 4,
    PUBREC: 5,
    PUBREL: 6,
    PUBCOMP: 7,
    SUBSCRIBE: 8,
    SUBACK: 9,
    UNSUBSCRIBE: 10,
    UNSUBACK: 11,
    PINGREQ: 12,
    PINGRESP: 13,
    DISCONNECT: 14
};

var pakId = Math.floor(Math.random() * 65534);

Uint8Array.prototype.charCodeAt = function (a, b) {
    return this.toString().charCodeAt(a, b);
};

/**
 Return Codes
 http://docs.oasis-open.org/mqtt/mqtt/v3.1.1/os/mqtt-v3.1.1-os.html#_Toc385349256
 **/
var RETURN_CODES = {
    0: 'ACCEPTED',
    1: 'UNACCEPTABLE_PROTOCOL_VERSION',
    2: 'IDENTIFIER_REJECTED',
    3: 'SERVER_UNAVAILABLE',
    4: 'BAD_USER_NAME_OR_PASSWORD',
    5: 'NOT_AUTHORIZED'
};

/** MQTT constructor */
function MQTT(server, options) {
    this.server = server;
    options = options || {};
    this.port = options.port || C.DEF_PORT;
    this.client_id = options.client_id || mqttUid();
    this.keep_alive = options.keep_alive || C.DEF_KEEP_ALIVE;
    this.clean_session = options.clean_session || true;
    this.username = options.username;
    this.password = options.password;
    this.client = false;
    this.connected = false;
    this.partData = [];
    /* if keep_alive is less than the ping interval we need to use
      a shorter ping interval, otherwise we'll just time out! */
    this.ping_interval =
        this.keep_alive < this.C.PING_INTERVAL ? (this.keep_alive - 5) : this.C.PING_INTERVAL;
    this.protocol_name = options.protocol_name || "MQTT";
    this.protocol_level = (options.protocol_level || C.PROTOCOL_LEVEL);

    if (typeof this.client_id == 'string') {
        var payloadarray = [this.client_id.length >> 8, this.client_id.length & 255];
        var i = 2;
        var messagearray = this.client_id.split('');
        for (var j = 0; j < this.client_id.length; j++) {
            var char = messagearray[j];
            var numberrepres = char.charCodeAt(0);
            payloadarray[i] = numberrepres;
            i = i + 1;
        }
        this.client_id = payloadarray;
    }
    if (this.password) {
        var payloadarray = [this.password.length >> 8, this.password.length & 255];
        var i = 2;
        var messagearray = this.password.split('');
        for (var j = 0; j < this.password.length; j++) {
            var char = messagearray[j];
            var numberrepres = char.charCodeAt(0);
            payloadarray[i] = numberrepres;
            i = i + 1;
        }
        this.password = payloadarray;
    }
    if (this.username) {
        var payloadarray = [this.username.length >> 8, this.username.length & 255];
        var i = 2;
        var messagearray = this.username.split('');
        for (var j = 0; j < this.username.length; j++) {
            var char = messagearray[j];
            var numberrepres = char.charCodeAt(0);
            payloadarray[i] = numberrepres;
            i = i + 1;
        }
        this.username = payloadarray;
    }
}

var __listeners = {};

Object.prototype.on = function (type, fn) {
    if (!__listeners[type]) {
        __listeners[type] = [];
    }
    __listeners[type].push(fn);
};

Object.prototype.emit = function (type) {
    var data = Array.prototype.slice.call(arguments, 1);
    if (__listeners[type]) {
        __listeners[type].map(function (fn) {
            fn.apply(null, data);
        });
    }
};

if (!Buffer.from) {
    Buffer.from = function (a) {
        return new Buffer(a);
    };
}

/** 'public' constants here */
MQTT.prototype.C = {
    DEF_QOS: 0,    // Default QOS level
    CONNECT_TIMEOUT: 10000, // Time (ms) to wait for CONNACK
    PING_INTERVAL: 40    // Server ping interval (s)
};

/* Utility functions ***************************/

var fromCharCode = String.fromCharCode;

/** MQTT string (length MSB, LSB + data) */
function mqttStr(s) {
    var payloadarray = [s.length >> 8, s.length & 255];
    var i = 2;
    var messagearray = s.split('');
    for (var j = 0; j < s.length; j++) {
        var char = messagearray[j];
        var numberrepres = char.charCodeAt(0);
        payloadarray[i] = numberrepres;
        i = i + 1;
    }

    return payloadarray;
}

function createEscapedHex(num) {
    var mainNum = num.toString(16);
    switch (mainNum.length) {
        case 1:
            return "0" + mainNum;
        default:
            return mainNum.split('').map(function (c) {
                return String.fromCharCode(c.charCodeAt(0));
            }).join('');
    }
}

function mqttInt2Str(arr) {
    var outStr = "";
    for (var i = 0; i < arr.length; i++) {
        outStr += createEscapedHex(arr[i]);
    }
    return outStr;
}

/** MQTT packet length formatter - algorithm from reference docs */
function mqttPacketLength(length) {
    var encLength = [];
    var i = 0;
    do {
        var encByte = length & 127;
        length = length >> 7;
        // if there are more data to encode, set the top bit of this byte
        if (length > 0) {
            encByte += 128;
        }
        encLength[i] = encByte;
        i++;
    } while (length > 0);
    return encLength;
}

/** MQTT packet length decoder - algorithm from reference docs */
function mqttPacketLengthDec(length) {
    var bytes = 0;
    var decL = 0;
    var lb = 0;
    do {
        lb = length[bytes];
        decL |= (lb & 127) << (bytes++ * 7);
    } while ((lb & 128) && (bytes < 4));
    return {"decLen": decL, "lenBy": bytes};
}

/** MQTT standard packet formatter */
function mqttPacket(cmd, variable, payload) {
    var cmdAndLengthArray = [cmd].concat(mqttPacketLength(variable.length + payload.length));
    var headerAndPayloadArray = cmdAndLengthArray.concat(variable).concat(payload);
    var messageBuffer = Buffer.from(headerAndPayloadArray);
    return messageBuffer;
}

/** Generate random UID */
var mqttUid = (function () {
    function s4() {
        var numberstring = Math.floor((1 + Math.random() * 10));
        if (numberstring == 10) numberstring = 9;
        numberstring = 97 + numberstring;
        return numberstring;
    }

    return function () {
        var output = [0, 12, s4(), s4(), s4(), s4(), s4(), s4(), s4(), s4(), s4(), s4(), s4(), s4()];
        return output;
    };
})();

/** Generate PID */
function mqttPid() {
    pakId = pakId > 65534 ? 1 : ++pakId;
    return [pakId >> 8, pakId & 0xFF];
}

/** Get PID from message */
function getPid(data) {
    return data.slice(0, 2);
}

/** PUBLISH control packet */
function mqttPublish(topic, message, qos, flags) {
    var cmd = TYPE.PUBLISH << 4 | (qos << 1) | flags;
    var variable = mqttStr(topic);
    // Packet id must be included for QOS > 0
    if (qos > 0) {
        var newvariable = variable.concat(mqttPid());
        return mqttPacket(cmd, newvariable, message);
    } else {
        return mqttPacket(cmd, variable, message);
    }
}

/** SUBSCRIBE control packet */
function mqttSubscribe(topic, qos) {
    var cmd = TYPE.SUBSCRIBE << 4 | 2;
    return mqttPacket(cmd,
        mqttPid(),
        mqttStr(topic).concat([qos]));
}

/** UNSUBSCRIBE control packet */
function mqttUnsubscribe(topic) {
    var cmd = TYPE.UNSUBSCRIBE << 4 | 2;
    return mqttPacket(cmd,
        mqttPid(),
        mqttStr(topic));
}

function parsePublish(data) {
    var topicLength = (data[0] << 8) + data[1];
    return {
        topic: data.slice(2, 2 + topicLength),
        message: data.slice(2 + topicLength),
    };
}

/** Packet handler */
MQTT.prototype.packetHandler = function (data) {
    this.partData = this.partData.concat([].slice.call(data));

    var type;
    var dLen;
    var pLen;
    var pData;

    while (true) {
        if (this.partData.length === 0) return;

        type = this.partData[0] >> 4;
        dLen = mqttPacketLengthDec(this.partData.slice(1, 5));
        pLen = 1 + dLen.lenBy + dLen.decLen;

        if (this.partData.length >= pLen) {
            pData = this.partData.slice(1 + dLen.lenBy, pLen);
            this.partData = this.partData.slice(pLen);
        } else {
            return;
        }

        if (type === TYPE.PUBLISH) {
            var parsedData = parsePublish(pData);
            this.emit('publish', parsedData);
            this.emit('message', mqttInt2Str(parsedData.topic), mqttInt2Str(parsedData.message));
        } else if (type === TYPE.PUBACK) {
            this.emit('puback', getPid(pData));
        } else if (type === TYPE.PUBREC) {
            this.client.write(mqttPacket(TYPE.PUBREL << 4 | 2, getPid(pData), []));
        } else if (type === TYPE.PUBREL) {
            this.client.write(mqttPacket(TYPE.PUBCOMP << 4, getPid(pData), []));
        } else if (type === TYPE.PUBCOMP) {
            this.emit('pubcomp', getPid(pData));
        } else if (type === TYPE.SUBACK) {
            if (pData[2] === 128) {
                this.emit('subscribed_fail', getPid(pData));
            } else {
                this.emit('subscribed', getPid(pData));
            }
        } else if (type === TYPE.UNSUBACK) {
            this.emit('unsubscribed');
        } else if (type === TYPE.PINGREQ) {
            this.client.write([(TYPE.PINGRESP << 4), 0]);
        } else if (type === TYPE.PINGRESP) {
            this.emit('ping_reply');
        } else if (type === TYPE.CONNACK) {
            if (this.ctimo) clearTimeout(this.ctimo);
            this.ctimo = undefined;
            this.partData = [];
            var returnCode = pData[1];
            if (RETURN_CODES[returnCode] === 'ACCEPTED') {
                this.connected = true;
                // start pinging
                if (this.pintr) clearInterval(this.pintr);
                this.pintr = setInterval(this.ping.bind(this), this.ping_interval * 1000);
                // emit connected events
                this.emit('connected');
                this.emit('connect');
            } else {
                var mqttError = "Connection refused, ";
                this.connected = false;
                if (returnCode > 0 && returnCode < 6) {
                    mqttError += RETURN_CODES[returnCode];
                } else {
                    mqttError += "unknown return code: " + returnCode + ".";
                }
                this.emit('error', mqttError);
            }
        } else {
            this.emit('error', "MQTT unsupported packet type: " + type);
        }
    }
};

/* Public interface ****************************/

/** Establish connection and set up keep_alive ping */
MQTT.prototype.connect = function (client) {
    if (this.connected) return;
    var mqo = this;
    var onConnect = function () {
        mqo.client = client;
        // write connection message
        var teststring = mqo.mqttConnect(mqo.client_id);
        client.write(teststring);
        // handle connection timeout if too slow
        mqo.ctimo = setTimeout(function () {
            mqo.ctimo = undefined;
            mqo.emit('disconnected');
            mqo.disconnect();
        }, mqo.C.CONNECT_TIMEOUT);
        // Incoming data
        client.on('data', mqo.packetHandler.bind(mqo));
        // Socket closed
        client.on('end', function () {
            mqo._scktClosed();
        });
    };
    if (client) {
        onConnect();
    } else {
        try {
            var self = this;
            client = require("net").Socket().connect({host: mqo.server, port: mqo.port}, onConnect);
            client.on('error', function (err) {
                self.emit('error', err.message);
            });
        } catch (e) {
            this.client = false;
            this.emit('error', e.message);
        }
    }
};

/** Called internally when the connection closes  */
MQTT.prototype._scktClosed = function () {
    if (this.connected) {
        this.connected = false;
        this.client = false;
        if (this.pintr) clearInterval(this.pintr);
        if (this.ctimo) clearTimeout(this.ctimo);
        this.pintr = this.ctimo = undefined;
        this.emit('disconnected');
        this.emit('close');
    }
};

/** Disconnect from server */
MQTT.prototype.disconnect = function () {
    if (!this.client) return;
    try {
        this.client.write(Buffer.from([(TYPE.DISCONNECT << 4), 0]));
    } catch (e) {
        return this._scktClosed();
    }
    this.client.end();
    this.client = false;
};

/** Publish message using specified topic. */
MQTT.prototype.publish = function (topic, message, opts) {
    if (!this.client) return;
    opts = opts || {};
    try {
        var payloadarray = [];
        var i = 0;
        var messagearray = message.split('');
        for (var j = 0; j < message.length; j++) {
            var char = messagearray[j];
            var numberrepres = char.charCodeAt(0);
            payloadarray[i] = numberrepres;
            i = i + 1;
        }
        var publishMessage = mqttPublish(topic, payloadarray, opts.qos || this.C.DEF_QOS, (opts.retain ? 1 : 0) | (opts.dup ? 8 : 0));
        this.client.write(publishMessage);
    } catch (e) {
        this._scktClosed();
    }
};

/** Subscribe to topic (filter) */
MQTT.prototype.subscribe = function (topics, opts) {
    if (!this.client) return;
    opts = opts || {};

    var subs = [];
    if ('string' === typeof topics) {
        topics = [topics];
    }
    if (Array.isArray(topics)) {
        topics.forEach(function (topic) {
            subs.push({
                topic: topic,
                qos: opts.qos || this.C.DEF_QOS
            });
        }.bind(this));
    } else {
        Object
            .keys(topics)
            .forEach(function (k) {
                subs.push({
                    topic: k,
                    qos: topics[k]
                });
            });
    }

    subs.forEach(function (sub) {
        var subpacket = mqttSubscribe(sub.topic, sub.qos);
        this.client.write(subpacket);
    }.bind(this));
};

/** Unsubscribe to topic (filter) */
MQTT.prototype.unsubscribe = function (topic) {
    if (!this.client) return;
    this.client.write(mqttUnsubscribe(topic));
};

/** Send ping request to server */
MQTT.prototype.ping = function () {
    if (!this.client) return;
    try {
        this.client.write(Buffer.from([TYPE.PINGREQ << 4, 0]));
    } catch (e) {
        this._scktClosed();
    }
};

/* Packet specific functions *******************/

/** Create connection flags */
MQTT.prototype.createFlagsForConnection = function (options) {
    var flags = 0;
    flags |= (this.username) ? 0x80 : 0;
    flags |= (this.username && this.password) ? 0x40 : 0;
    flags |= (options.clean_session) ? 0x02 : 0;
    return flags;
};

/** MQTT CONNECT control packet */
MQTT.prototype.mqttConnect = function (clean) {
    var cmd = TYPE.CONNECT << 4;
    var flags = this.createFlagsForConnection({
        clean_session: clean
    });

    var keep_alive = [this.keep_alive >> 8, this.keep_alive & 255];

    /* payload */
    var payload = this.client_id;
    if (this.username) {
        payload = payload.concat(this.username);
        if (this.password) {
            payload = payload.concat(this.password);
        }
    }
    return mqttPacket(cmd,
        mqttStr(this.protocol_name)/*protocol name*/.concat(
            [this.protocol_level]) /*protocol level*/.concat(
            [flags]).concat(keep_alive),
        payload);
};

/* MQTT Exports */
function mqttCreate(server, options) {
    return new MQTT(server, options);
}

// ============================================================================
// Main entry point
// ============================================================================

var start = function(buttonModule, options) {
    var mqttOpts = {};
    var mqttKeys = Object.keys(options.mqtt);
    for (var mi = 0; mi < mqttKeys.length; mi++) {
        mqttOpts[mqttKeys[mi]] = options.mqtt[mqttKeys[mi]];
    }
    mqttOpts.keep_alive = true;
    var mqttServer = mqttCreate(
        options.mqtt.host,
        mqttOpts
    );
    var logger = makeLogger('root', options.debug || false);
    options.ha = options.ha || {};
    options.flicBtns = options.flicBtns || {};
    options.ha.debug = options.ha.debug !== undefined ? options.ha.debug : (options.debug || false);
    options.flicBtns.debug = options.flicBtns.debug !== undefined ? options.flicBtns.debug : (options.debug || false);
    var ha = makeHAmqtt(mqttServer, options.ha);
    mqttServer.on('connected', function() {
        logger.info("connected to mqtt");
        if (!(options.flicBtns && options.flicBtns.disabled)) {
            makeButtonController(ha, buttonModule, options.flicBtns).start();
        }
        logger.info("all services up!");
    });
    mqttServer.on('error', function(err) {
        logger.info("'Error' event", JSON.stringify(err));
        setTimeout(function() {
            throw new Error("Crashed");
        }, 1000);
    });
    mqttServer.on("disconnected", function(err) {
        logger.info("'Error' disconnected", JSON.stringify(err));
        setTimeout(function() {
            throw new Error("Crashed");
        }, 1000);
    });
    mqttServer.on("close", function(err) {
        logger.info("'Error' close", JSON.stringify(err));
        setTimeout(function() {
            throw new Error("Crashed");
        }, 1000);
    });
    mqttServer.connect();
};

exports.start = start;
