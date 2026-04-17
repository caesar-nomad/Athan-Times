# Athan Times

A Homey Pro app that automatically calculates and triggers Islamic prayer times based on your local GPS coordinates.

## Features

- Flow triggers for Fajr, Dhuhr, Asr, Maghrib, and Isha
- Ramadan mode with configurable Suhoor alarm
- Eid morning trigger
- Hijri calendar adjustment
- Live prayer schedule dashboard in app settings
- Prayer Schedule virtual device (optional)

## App-to-App API

Other Homey apps can query live prayer times without any user action:

```js
const athanApi = this.homey.api.getApiApp('com.riyadh.athan');

const times = await athanApi.get('/prayer-times');
// {
//   fajr:       "04:30",
//   dhuhr:      "12:15",
//   asr:        "15:45",
//   maghrib:    "18:22",
//   isha:       "19:52",
//   suhoor:     "03:30",
//   is_ramadan: false,
//   is_eid:     false
// }
```

Add the required permission to your app manifest:
```json
"permissions": ["homey:app:com.riyadh.athan"]
```

## Setup

1. Install the app
2. Ensure your Homey Pro has its location set correctly
3. Create flows using the "A prayer starts" trigger card

## Source

[github.com/caesar-nomad/Athan-Times](https://github.com/caesar-nomad/Athan-Times)
