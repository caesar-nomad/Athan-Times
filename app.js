const Homey = require('homey');

class AthanTimesApp extends Homey.App {

  async onInit() {
    this.log('Athan Times V1.4.20 Initializing...');
    if (global.gc) { global.gc(); }

    this.prayerTrigger = this.homey.flow.getTriggerCard('prayer_started');
    this.suhoorTrigger = this.homey.flow.getTriggerCard('suhoor_alarm');
    this.eidTrigger = this.homey.flow.getTriggerCard('eid_morning');

    this.prayerTrigger.registerRunListener(async (args, state) => {
      return args.prayer === state.prayer;
    });
    
    this.currentTimings = null;
    this.apiTimezone = null; 
    this.lastTriggeredMinute = null; 
    
    await this.updateSchedule();
    
    this.checkInterval = this.homey.setInterval(() => this.checkTimings(), 15000);

    this.homey.settings.on('set', (settingName) => {
      if (settingName === 'calculated_times') return; 
      this.log(`Setting changed (${settingName}). Recalculating...`);
      this.updateSchedule();
    });
  }

  onUninit() {
    if (this.checkInterval) {
      this.homey.clearInterval(this.checkInterval);
    }
  }

  async updateSchedule() {
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
      const hijriDay = parseInt(json.data.date.hijri.day, 10);
      this.isRamadan = (hijriMonth === 9);
      this.isEid = (hijriMonth === 10 && hijriDay === 1);
      
      let suhoorDisplay = "Not Ramadan";
      this.suhoorTime = null; 

      if (this.isRamadan) {
        const offsetSetting = this.homey.settings.get('suhoor_offset') || "60";
        const offset = parseInt(offsetSetting, 10);
        const cleanFajr = this.currentTimings.Fajr.substring(0, 5);
        this.suhoorTime = this.calculateOffset(cleanFajr, offset);
        suhoorDisplay = this.suhoorTime;
      }
      
      const displayData = {
        Fajr: this.currentTimings.Fajr.substring(0, 5),
        Dhuhr: this.currentTimings.Dhuhr.substring(0, 5),
        Asr: this.currentTimings.Asr.substring(0, 5),
        Maghrib: this.currentTimings.Maghrib.substring(0, 5),
        Isha: this.currentTimings.Isha.substring(0, 5),
        Suhoor: suhoorDisplay,
        Eid: this.isEid ? "Yes (Today!)" : "No"
      };
      
      this.homey.settings.set('calculated_times', displayData);
      this.log(`Sync Successful. Fajr: ${displayData.Fajr}, Suhoor: ${displayData.Suhoor}`);
      
    } catch (err) {
      this.error('Sync Error:', err);
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

    if (this.isRamadan && this.suhoorTime === cur) {
      this.log(`Triggering Suhoor Alarm at ${cur}`);
      this.suhoorTrigger.trigger().catch(err => this.error('Suhoor Trigger Error:', err));
      triggeredSomething = true;
    }

    if (this.isEid && this.currentTimings.Fajr.substring(0, 5) === cur) {
      this.log(`Triggering Eid Alarm at ${cur}`);
      this.eidTrigger.trigger().catch(err => this.error('Eid Trigger Error:', err));
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