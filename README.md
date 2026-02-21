# Flic2Hass (Duo Edition)

> Fork of [asosnovsky/flic2hass](https://github.com/asosnovsky/flic2hass) with **Flic Duo support** and IR module removed.

This is a Flic Hub SDK module that publishes all Flic buttons to Home Assistant via MQTT autodiscovery. It supports standard Flic 2 buttons **and** the Flic Duo, with separate entities for the big and small buttons.

## Features

### Standard Flic Buttons
* Connectivity state
* Click action types: `click` `hold` `double_click`
* Device automation triggers
* Press detection: `released` `pressed`
* Battery logging
* Firmware & software version numbers

### Flic Duo Support
* **Separate entities for Big Button and Small Button** — each has its own action sensor, state sensor, and automation triggers
* **Gesture sensor** — detects `left`, `right`, `up`, `down` swipe gestures
* Auto-detection: Duo buttons are detected automatically when a small-button event is received, or when the button name contains "Duo"

### Standard Flic Button in Home Assistant

[![Standard Flic button in Home Assistant](/images/flic-eg.png)](/images/flic-eg.png)

* `sensor.flic_XXXX_action` — click/double_click/hold/none
* `sensor.flic_XXXX_state` — pressed/released
* `sensor.flic_XXXX_battery` — battery percentage
* `binary_sensor.flic_XXXX_connected` — connection status
* Device automation triggers for short press, long press, double press

### Flic Duo in Home Assistant

[![Flic Duo in Home Assistant](/images/duo-eg.png)](/images/duo-eg.png)

* `sensor.flic_XXXX_big_action` — big button click/double_click/hold/none
* `sensor.flic_XXXX_big_state` — big button pressed/released
* `sensor.flic_XXXX_small_action` — small button click/double_click/hold/none
* `sensor.flic_XXXX_small_state` — small button pressed/released
* `sensor.flic_XXXX_gesture` — left/right/up/down
* Device automation triggers for both big and small buttons
* Shared battery, connectivity, and diagnostic sensors

## Requirements

* A Flic Hub (LR or original with SDK support)
* A functional MQTT server

## Setup

**1. Connect to Flic Hub IDE:**

* Follow the [SDK tutorial](https://hubsdk.flic.io/static/tutorial/) to enable SDK access.
* Go to https://hubsdk.flic.io/ and login. Your hub should be discovered automatically.

**2. Create a module:**

* In the Web IDE, click "Create Module".
* Give the new module a name. "MQTT" is a good option.

**3. Insert `lib.js`:**

* Right click the folder in the left pane and select "New File".
* Name the file `lib.js` (**IT MUST BE NAMED THIS**).
* Copy the content from `lib.js` in this repo into `lib.js` in the Flic IDE.

**4. Setup `main.js`:**

* Copy the following into `main.js`:

```javascript
require("./lib").start(
  require("buttons"),
  {
    mqtt: {
      host: "set-this-to-yours",
      username: "set-this-to-yours",
      password: "set-this-to-yours",
    }
  }
)
```

* Modify `host`, `username`, `password` with your MQTT server details.

  *If your MQTT server does not require authentication:*
* Delete the `username` & `password` lines.

**5. Start the module:**

* Click the green play button in the IDE and watch the Console output.
* Once verified working, enable "restart after crash" to keep it running.

## Additional Configuration

```javascript
{
  "mqtt": {
    "host": "",        // MQTT Host
    "port": 1883,      // MQTT Port
    "client_id": "",   // MQTT Identifier
    "username": "",    // MQTT Username
    "password": ""     // MQTT Password
  },
  "debug": false,      // Enable debug logging for all modules
  "ha": {
    "debug": false,    // Enable debug logging for HA MQTT
    "topics": {
      "homeassistant": "homeassistant", // MQTT prefix for HA autodiscovery
      "flic": "flic"                    // MQTT prefix for state values
    }
  },
  "flicBtns": {
    "disabled": false, // Do not publish button events
    "debug": false     // Enable debug logging for buttons
  }
}
```

## How Duo Detection Works

The module automatically detects Flic Duo buttons in two ways:

1. **By name** — If the button's name (set in the Flic app) contains "duo" (case insensitive), it is registered as a Duo immediately.
2. **By event** — When a `buttonNumber: 1` (small button) event is received, the button is recognized as a Duo and re-registered with the split entities.

**Tip:** For instant Duo detection on startup, include "Duo" somewhere in the button name in the Flic app (e.g., "Living Room Duo").

## Changes from Upstream

* **Removed IR module** — No IR entities are created in Home Assistant
* **Added Flic Duo support** — Separate big/small button entities, gesture sensor
* **Simplified `main.js`** — No need to `require("ir")` anymore
* **Updated TypeScript types** — Matches current Flic Hub SDK with `buttonNumber`, `orientation`, `gesture`

## Building from Source

```bash
npm install
npm run build
```

This compiles the TypeScript in `src/` and bundles it into `lib.js`.

## License

GPL-3.0 (same as upstream)
