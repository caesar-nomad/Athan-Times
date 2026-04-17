const Homey = require('homey');

class PrayerScheduleDriver extends Homey.Driver {

  async onInit() {
    try {
      this.log('Prayer Schedule Driver initialized');
    } catch (err) {
      this.error('Driver onInit crash:', err);
    }
  }

  async onPairListDevices() {
    return [
      {
        name: this.homey.__('driver.device_name') || 'Prayer Schedule',
        data: { id: 'prayer-schedule-singleton' },
      },
    ];
  }

}

module.exports = PrayerScheduleDriver;
