module.exports = {
  async getPrayerTimes({ homey }) {
    const app = homey.app;

    if (!app.currentTimings) {
      throw new Error('Prayer times not yet available. Please wait for the app to sync.');
    }

    const toTime = (str) => str ? str.substring(0, 5) : null;

    return {
      fajr:      toTime(app.currentTimings.Fajr),
      dhuhr:     toTime(app.currentTimings.Dhuhr),
      asr:       toTime(app.currentTimings.Asr),
      maghrib:   toTime(app.currentTimings.Maghrib),
      isha:      toTime(app.currentTimings.Isha),
      suhoor:    app.suhoorTime || null,
      is_ramadan: !!app.isRamadan,
      is_eid:    !!app.isEid,
    };
  },
};
