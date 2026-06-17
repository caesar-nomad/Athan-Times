module.exports = {
  async getPrayerTimes({ homey }) {
    const app = homey.app;

    if (!app.adjustedTimings) {
      throw new Error('Prayer times not yet available. Please wait for the app to sync.');
    }

    const t = app.adjustedTimings;
    let nextPrayer = null;
    let minutesUntilNext = null;

    if (app.apiTimezone && app.suhoorTime) {
      try {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: app.apiTimezone,
          hour: 'numeric', minute: 'numeric', hour12: false,
        }).formatToParts(new Date());
        let curH = parts.find(p => p.type === 'hour').value;
        const curM = parts.find(p => p.type === 'minute').value;
        if (curH === '24') curH = '00';
        const curMins = parseInt(curH, 10) * 60 + parseInt(curM, 10);

        const schedule = [
          { name: 'Suhoor',  time: app.suhoorTime },
          { name: 'Fajr',    time: t.Fajr },
          { name: 'Dhuhr',   time: t.Dhuhr },
          { name: 'Asr',     time: t.Asr },
          { name: 'Maghrib', time: t.Maghrib },
          { name: 'Isha',    time: t.Isha },
        ].map(p => {
          const [h, m] = p.time.split(':').map(Number);
          return { name: p.name, mins: h * 60 + m };
        });

        let next = schedule.find(p => p.mins > curMins) || schedule[0];
        nextPrayer = next.name;
        minutesUntilNext = next.mins > curMins
          ? next.mins - curMins
          : 1440 - curMins + next.mins;
      } catch (e) { /* non-fatal */ }
    }

    return {
      fajr:               t.Fajr,
      dhuhr:              t.Dhuhr,
      asr:                t.Asr,
      maghrib:            t.Maghrib,
      isha:               t.Isha,
      suhoor:             t.Suhoor,
      is_ramadan:         !!app.isRamadan,
      next_prayer:        nextPrayer,
      minutes_until_next: minutesUntilNext,
    };
  },
};
