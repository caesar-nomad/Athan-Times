const Homey = require('homey');

class AthanTimesApp extends Homey.App {

  async onInit() {
    try {
    this.log('Athan Times V1.4.20 Initializing...');
    if (global.gc) { global.gc(); }

    this.prayerTrigger = this.homey.flow.getTriggerCard('prayer_started');
    this.suhoorTrigger = this.homey.flow.getTriggerCard('suhoor_alarm');

    this.prayerTrigger.registerRunListener(async (args, state) => {
      return args.prayer === state.prayer;
    });
    
    this.currentTimings = null;
    this.apiTimezone = null;
    this.lastTriggeredMinute = null;
    this.syncRetryCount = 0;
    this._retryTimeout = null;

    // Register global Flow tokens (readable by any app/flow)
    this._fajrToken    = await this.homey.flow.createToken('athan_fajr',    { type: 'string',  title: 'Fajr Time' });
    this._dhuhrToken   = await this.homey.flow.createToken('athan_dhuhr',   { type: 'string',  title: 'Dhuhr Time' });
    this._asrToken     = await this.homey.flow.createToken('athan_asr',     { type: 'string',  title: 'Asr Time' });
    this._maghribToken = await this.homey.flow.createToken('athan_maghrib', { type: 'string',  title: 'Maghrib Time' });
    this._ishaToken    = await this.homey.flow.createToken('athan_isha',    { type: 'string',  title: 'Isha Time' });
    this._suhoorToken  = await this.homey.flow.createToken('athan_suhoor',  { type: 'string',  title: 'Suhoor Time' });
    this._isRamadanToken = await this.homey.flow.createToken('month_is_ramadan', { type: 'boolean', title: 'Is Ramadan' });

    await this.updateSchedule();
    
    this.checkInterval = this.homey.setInterval(() => this.checkTimings(), 15000);

    this._onSettingsSet = (settingName) => {
      if (settingName === 'calculated_times') return;
      this.log(`Setting changed (${settingName}). Recalculating...`);
      this.updateSchedule();
    };
    this.homey.settings.on('set', this._onSettingsSet);
    } catch (err) {
      this.error('App onInit crash:', err);
    }
  }

  onUninit() {
    if (this.checkInterval) {
      this.homey.clearInterval(this.checkInterval);
    }
    if (this._retryTimeout) {
      this.homey.clearTimeout(this._retryTimeout);
    }
    if (this._onSettingsSet) {
      this.homey.settings.off('set', this._onSettingsSet);
    }
  }

  async updateSchedule() {
    this.syncRetryCount = (this.syncRetryCount || 0);
    try {
      const lat = this.homey.geolocation.getLatitude();
      const lon = this.homey.geolocation.getLongitude();
      const adjSetting = this.homey.settings.get('hijri_adjustment') || "0";
      const adj = parseInt(adjSetting, 10);
      const url = `https://api.aladhan.com/v1/timings?latitude=${lat}&longitude=${lon}&method=4&adjustment=${adj}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!response.ok) throw new Error(`API Status: ${response.status}`);
      const json = await response.json();
      
      this.currentTimings = json.data.timings;
      this.apiTimezone = json.data.meta.timezone; 
      
      const hijriMonth = json.data.date.hijri.month.number;
      this.isRamadan = (hijriMonth === 9);
      const offsetSetting = this.homey.settings.get('suhoor_offset') || "60";
      const offset = parseInt(offsetSetting, 10);
      const cleanFajr = this.currentTimings.Fajr.substring(0, 5);
      this.suhoorTime = this.calculateOffset(cleanFajr, offset);
      
      const displayData = {
        Fajr: this.currentTimings.Fajr.substring(0, 5),
        Dhuhr: this.currentTimings.Dhuhr.substring(0, 5),
        Asr: this.currentTimings.Asr.substring(0, 5),
        Maghrib: this.currentTimings.Maghrib.substring(0, 5),
        Isha: this.currentTimings.Isha.substring(0, 5),
        Suhoor: this.suhoorTime,
      };
      
      this.homey.settings.set('calculated_times', displayData);
      this.syncRetryCount = 0;
      this.log(`Sync Successful. Fajr: ${displayData.Fajr}, Suhoor: ${displayData.Suhoor}`);

      // Update global Flow tokens so other apps/flows can read prayer times
      await this._fajrToken.setValue(displayData.Fajr);
      await this._dhuhrToken.setValue(displayData.Dhuhr);
      await this._asrToken.setValue(displayData.Asr);
      await this._maghribToken.setValue(displayData.Maghrib);
      await this._ishaToken.setValue(displayData.Isha);
      await this._suhoorToken.setValue(displayData.Suhoor);
      await this._isRamadanToken.setValue(this.isRamadan);

    } catch (err) {
      this.error('Sync Error:', err);
      if (this.syncRetryCount < 5) {
        this.syncRetryCount++;
        const retryDelay = this.syncRetryCount * 5 * 60 * 1000; // 5, 10, 15, 20, 25 min
        this.log(`Sync failed. Retry ${this.syncRetryCount}/5 in ${this.syncRetryCount * 5} minutes...`);
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

  calculateOffset(timeStr, offset) {
    const parts = timeStr.split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    
    let totalMins = (h * 60) + m - offset;
    if (totalMins < 0) totalMins += 24 * 60; 
    
    const newH = Math.floor(totalMins / 60);
    const newM = totalMins % 60;
    
    return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
  }

  checkTimings() {
    if (!this.currentTimings || !this.apiTimezone) return;

    const now = new Date();
    let curH, curM;
    
    try {
      // Force extraction of raw parts to bypass formatting anomalies
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: this.apiTimezone,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
      }).formatToParts(now);
      
      curH = parts.find(p => p.type === 'hour').value;
      curM = parts.find(p => p.type === 'minute').value;
    } catch (e) {
      // Ironclad fallback
      curH = String(now.getHours());
      curM = String(now.getMinutes());
    }
    
    // Mathematically guarantee 24-hour cycle and leading zeros
    if (curH === '24') curH = '00';
    const cur = `${String(curH).padStart(2, '0')}:${String(curM).padStart(2, '0')}`;

    if (this.lastTriggeredMinute === cur) return;

    let triggeredSomething = false;

    ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].forEach(p => {
      const apiTime = this.currentTimings[p].substring(0, 5);
      if (apiTime === cur) {
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

    // Daily Sync
    if (cur === "02:00" && this.lastTriggeredMinute !== "02:00") {
      this.lastTriggeredMinute = "02:00"; 
      this.updateSchedule();
    }
  }
}

module.exports = AthanTimesApp;