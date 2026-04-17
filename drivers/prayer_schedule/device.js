const Homey = require('homey');

class PrayerScheduleDevice extends Homey.Device {

  async onInit() {
    this.log('Prayer Schedule Device initialized');

    // Register with app — retry a few times in case app isn't fully ready
    this._tryRegister(0);
  }

  _tryRegister(attempt) {
    const app = this.homey.app;
    if (app && typeof app.registerScheduleDevice === 'function') {
      app.registerScheduleDevice(this);
    } else if (attempt < 5) {
      this.homey.setTimeout(() => this._tryRegister(attempt + 1), 2000);
    } else {
      this.error('Could not register with app after 5 attempts');
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

    await this.setCapabilityValue('prayer_time.suhoor', suhoorTime || '--:--').catch(this.error);
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
