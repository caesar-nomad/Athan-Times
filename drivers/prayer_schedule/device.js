const Homey = require('homey');

class PrayerScheduleDevice extends Homey.Device {

  async onInit() {
    this.log('Prayer Schedule Device initialized');
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

  // Convert "HH:MM" to minutes since midnight
  _toMinutes(timeStr) {
    if (!timeStr || timeStr === '--:--') return 0;
    const [h, m] = timeStr.substring(0, 5).split(':').map(Number);
    return (h * 60) + m;
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
      await this.setCapabilityValue(cap, this._toMinutes(time)).catch(this.error);
    }

    await this.setCapabilityValue('prayer_time.suhoor', this._toMinutes(suhoorTime)).catch(this.error);
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
