const Homey = require('homey');

class AthanTimesApp extends Homey.App {

  async onInit() {
    try {
      this.log('Athan Times V2.3.0 Initializing...');
      if (global.gc) { global.gc(); }

      this.prayerTrigger = this.homey.flow.getTriggerCard('prayer_started');
      this.suhoorTrigger = this.homey.flow.getTriggerCard('suhoor_alarm');

      this.prayerTrigger.registerRunListener(async (args, state) => {
        return args.prayer === state.prayer;
      });

      this.currentTimings  = null;
      this.adjustedTimings = null;
      this.suhoorTime      = null;
      this.apiTimezone     = null;
      this.lastTriggeredMinute = null;
      this._lastTokenMinute    = null;
      this.syncRetryCount  = 0;
      this._retryTimeout   = null;

      // Prayer time tokens
      this._fajrToken      = await this.homey.flow.createToken('athan_fajr',               { type: 'string',  title: 'Fajr Time' });
      this._dhuhrToken     = await this.homey.flow.createToken('athan_dhuhr',              { type: 'string',  title: 'Dhuhr Time' });
      this._asrToken       = await this.homey.flow.createToken('athan_asr',                { type: 'string',  title: 'Asr Time' });
      this._maghribToken   = await this.homey.flow.createToken('athan_maghrib',            { type: 'string',  title: 'Maghrib Time' });
      this._ishaToken      = await this.homey.flow.createToken('athan_isha',               { type: 'string',  title: 'Isha Time' });
      this._suhoorToken    = await this.homey.flow.createToken('athan_suhoor',             { type: 'string',  title: 'Suhoor Time' });
      this._isRamadanToken = await this.homey.flow.createToken('month_is_ramadan',         { type: 'boolean', title: 'Is Ramadan' });
      this._nextPrayerToken     = await this.homey.flow.createToken('athan_next_prayer',         { type: 'string', title: 'Next Prayer' });
      this._minutesUntilToken   = await this.homey.flow.createToken('athan_minutes_until_next',  { type: 'number', title: 'Minutes Until Next Prayer' });

      // Insights logs — one entry per prayer per daily sync
      this._insightLogs = {};
      for (const p of ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha', 'Suhoor']) {
        try {
          this._insightLogs[p] = await this.homey.insights.createLog(
            `athan_${p.toLowerCase()}`,
            { title: `${p} (min since midnight)`, type: 'number', units: 'min' }
          );
        } catch (e) {
          this.error(`Insights createLog failed for ${p}:`, e);
        }
      }

      await this.updateSchedule();

      this.checkInterval = this.homey.setInterval(() => this.checkTimings(), 15000);

      const INTERNAL = new Set(['calculated_times', '_cached_raw_timings']);
      this._onSettingsSet = (settingName) => {
        if (INTERNAL.has(settingName)) return;
        this.log(`Setting changed (${settingName}). Recalculating...`);
        this.updateSchedule();
      };
      this.homey.settings.on('set', this._onSettingsSet);
    } catch (err) {
      this.error('App onInit crash:', err);
    }
  }

  onUninit() {
    if (this.checkInterval)    { this.homey.clearInterval(this.checkInterval); }
    if (this._retryTimeout)    { this.homey.clearTimeout(this._retryTimeout); }
    if (this._onSettingsSet)   { this.homey.settings.off('set', this._onSettingsSet); }
  }

  // Apply per-prayer minute offsets to raw API timings.
  // Returns { Fajr, Dhuhr, Asr, Maghrib, Isha, Suhoor } in HH:MM format.
  _applyOffsets(rawTimings) {
    const getInt = (key, def = 0) => {
      const val = this.homey.settings.get(key);
      return (val !== null && val !== undefined) ? parseInt(val, 10) : def;
    };
    const shift = (hhmm, mins) => {
      if (mins === 0) return hhmm;
      const [h, m] = hhmm.split(':').map(Number);
      const total = (((h * 60 + m + mins) % 1440) + 1440) % 1440;
      return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    };
    const fajr = shift(rawTimings.Fajr.substring(0, 5), getInt('offset_fajr'));
    return {
      Fajr:    fajr,
      Dhuhr:   shift(rawTimings.Dhuhr.substring(0, 5),   getInt('offset_dhuhr')),
      Asr:     shift(rawTimings.Asr.substring(0, 5),     getInt('offset_asr')),
      Maghrib: shift(rawTimings.Maghrib.substring(0, 5), getInt('offset_maghrib')),
      Isha:    shift(rawTimings.Isha.substring(0, 5),    getInt('offset_isha')),
      Suhoor:  shift(fajr, -getInt('suhoor_offset', 60)),
    };
  }

  async _updatePrayerTokens(displayData) {
    await this._fajrToken.setValue(displayData.Fajr);
    await this._dhuhrToken.setValue(displayData.Dhuhr);
    await this._asrToken.setValue(displayData.Asr);
    await this._maghribToken.setValue(displayData.Maghrib);
    await this._ishaToken.setValue(displayData.Isha);
    await this._suhoorToken.setValue(displayData.Suhoor);
  }

  async _writeInsights(displayData) {
    for (const [prayer, time] of Object.entries(displayData)) {
      try {
        if (!this._insightLogs[prayer]) continue;
        const [h, m] = time.split(':').map(Number);
        await this._insightLogs[prayer].createEntry(h * 60 + m);
      } catch (e) {
        this.error(`Insights write error for ${prayer}:`, e);
      }
    }
  }

  async updateSchedule() {
    this.syncRetryCount = (this.syncRetryCount || 0);
    try {
      const lat    = this.homey.geolocation.getLatitude();
      const lon    = this.homey.geolocation.getLongitude();
      const adj    = parseInt(this.homey.settings.get('hijri_adjustment') || '0', 10);
      const method = this.homey.settings.get('calculation_method') || '4';
      const school = this.homey.settings.get('school') || '0';
      const latAdj = this.homey.settings.get('lat_adj') || '';

      let url = `https://api.aladhan.com/v1/timings?latitude=${lat}&longitude=${lon}`;
      url += `&method=${method}&school=${school}&adjustment=${adj}`;
      if (latAdj) url += `&latitudeAdjustmentMethod=${latAdj}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`API Status: ${response.status}`);
      const json = await response.json();

      this.currentTimings = json.data.timings;
      this.apiTimezone    = json.data.meta.timezone;

      // Cache raw timings for offline fallback
      const today = new Date().toISOString().slice(0, 10);
      this.homey.settings.set('_cached_raw_timings', JSON.stringify({
        date: today, timings: this.currentTimings, timezone: this.apiTimezone,
      }));

      const hijriMonth = json.data.date.hijri.month.number;
      this.isRamadan = (hijriMonth === 9);

      const displayData = this._applyOffsets(this.currentTimings);
      this.adjustedTimings = displayData;
      this.suhoorTime = displayData.Suhoor;

      this.homey.settings.set('calculated_times', displayData);
      this.syncRetryCount = 0;
      this.log(`Sync OK. Fajr: ${displayData.Fajr}, Suhoor: ${displayData.Suhoor}`);

      await this._updatePrayerTokens(displayData);
      await this._isRamadanToken.setValue(this.isRamadan);
      await this._writeInsights(displayData);

    } catch (err) {
      this.error('Sync Error:', err);

      // Offline fallback: use cached raw timings if today's or yesterday's are available
      const cached = this.homey.settings.get('_cached_raw_timings');
      if (cached) {
        try {
          const { date, timings, timezone } = JSON.parse(cached);
          const today     = new Date().toISOString().slice(0, 10);
          const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
          if (date === today || date === yesterday) {
            this.currentTimings  = timings;
            this.apiTimezone     = timezone;
            const displayData    = this._applyOffsets(timings);
            this.adjustedTimings = displayData;
            this.suhoorTime      = displayData.Suhoor;
            this.homey.settings.set('calculated_times', displayData);
            await this._updatePrayerTokens(displayData);
            await this._isRamadanToken.setValue(this.isRamadan || false);
            this.log(`Offline fallback: using cached times from ${date}`);
          }
        } catch (parseErr) {
          this.error('Offline cache parse error:', parseErr);
        }
      }

      if (this.syncRetryCount < 5) {
        this.syncRetryCount++;
        const retryDelay = this.syncRetryCount * 5 * 60 * 1000;
        this.log(`Retry ${this.syncRetryCount}/5 in ${this.syncRetryCount * 5} minutes...`);
        this._retryTimeout = this.homey.setTimeout(() => {
          this._retryTimeout = null;
          this.updateSchedule();
        }, retryDelay);
      } else {
        this.error('Sync failed after 5 retries. Will try again at next daily sync.');
        this.syncRetryCount = 0;
      }
    }
  }

  checkTimings() {
    if (!this.currentTimings || !this.apiTimezone || !this.adjustedTimings) return;

    const now = new Date();
    let curH, curM;

    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: this.apiTimezone,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      }).formatToParts(now);
      curH = parts.find(p => p.type === 'hour').value;
      curM = parts.find(p => p.type === 'minute').value;
    } catch (e) {
      curH = String(now.getHours());
      curM = String(now.getMinutes());
    }

    if (curH === '24') curH = '00';
    const cur = `${String(curH).padStart(2, '0')}:${String(curM).padStart(2, '0')}`;

    // Update next-prayer tokens once per minute
    if (this._lastTokenMinute !== cur) {
      this._lastTokenMinute = cur;
      this._updateNextPrayerTokens(curH, curM);
    }

    if (this.lastTriggeredMinute === cur) return;

    let triggeredSomething = false;

    ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].forEach(p => {
      if (this.adjustedTimings[p] === cur) {
        this.log(`Triggering Flow for ${p} at ${cur}`);
        this.prayerTrigger.trigger({}, { prayer: p }).catch(err => this.error('Trigger Error:', err));
        triggeredSomething = true;
      }
    });

    if (this.suhoorTime === cur) {
      this.log(`Triggering Suhoor Alarm at ${cur}`);
      this.suhoorTrigger.trigger().catch(err => this.error('Suhoor Trigger Error:', err));
      triggeredSomething = true;
    }

    if (triggeredSomething) {
      this.lastTriggeredMinute = cur;
    }

    // Daily sync at 02:00
    if (cur === '02:00' && this.lastTriggeredMinute !== '02:00') {
      this.lastTriggeredMinute = '02:00';
      this.updateSchedule();
    }
  }

  _updateNextPrayerTokens(curH, curM) {
    if (!this.adjustedTimings || !this.suhoorTime) return;
    const curMins = parseInt(curH, 10) * 60 + parseInt(curM, 10);

    const schedule = [
      { name: 'Suhoor',  time: this.suhoorTime },
      { name: 'Fajr',    time: this.adjustedTimings.Fajr },
      { name: 'Dhuhr',   time: this.adjustedTimings.Dhuhr },
      { name: 'Asr',     time: this.adjustedTimings.Asr },
      { name: 'Maghrib', time: this.adjustedTimings.Maghrib },
      { name: 'Isha',    time: this.adjustedTimings.Isha },
    ].map(p => {
      const [h, m] = p.time.split(':').map(Number);
      return { name: p.name, mins: h * 60 + m };
    });

    let next = schedule.find(p => p.mins > curMins);
    if (!next) next = schedule[0]; // wrap to tomorrow's first (Suhoor)

    const minutesUntil = next.mins > curMins
      ? next.mins - curMins
      : 1440 - curMins + next.mins;

    this._nextPrayerToken.setValue(next.name).catch(() => {});
    this._minutesUntilToken.setValue(minutesUntil).catch(() => {});
  }
}

module.exports = AthanTimesApp;
