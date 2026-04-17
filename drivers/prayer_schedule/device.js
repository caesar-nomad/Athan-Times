const Homey = require('homey');

class PrayerScheduleDevice extends Homey.Device {

  async onInit() {
    this.log('Prayer Schedule Device initialized');

    // Get the app instance and register this device for updates
    const app = this.homey.app;
    if (app && typeof app.registerScheduleDevice === 'function') {
      app.registerScheduleDevice(this);
    }
  }

  async updateSchedule(timings, suhoorTime, isRamadan) {
    const prayers = [
      { cap: 'prayer_time.fajr',    time: timings.Fajr },
      { cap: 'prayer_time.dhuhr',   time: timings.Dhuhr },
      { cap: 'prayer_time.asr',     time: timings.Asr },
      { cap: 'prayer_time.maghrib', time: timings.Maghrib },
      { cap: 'prayer_time.isha',    time: timings.Isha },
    ];

    for (const { cap, time } of prayers) {
      await this.setCapabilityValue(cap, time.substring(0, 5)).catch(this.error);
    }

    // Suhoor: always show, falls back to '--:--' if not calculated
    await this.setCapabilityValue('prayer_time.suhoor', suhoorTime || '--:--').catch(this.error);

    // Ramadan flag
    await this.setCapabilityValue('is_ramadan', !!isRamadan).catch(this.error);
  }

  async onDeleted() {
    const app = this.homey.app;
    if (app && typeof app.unregisterScheduleDevice === 'function') {
      app.unregisterScheduleDevice(this);
    }
  }

}

module.exports = PrayerScheduleDevice;
