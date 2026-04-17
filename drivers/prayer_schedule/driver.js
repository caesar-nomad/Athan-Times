const Homey = require('homey');

class PrayerScheduleDriver extends Homey.Driver {

  async onInit() {
    this.log('Prayer Schedule Driver initialized');
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
