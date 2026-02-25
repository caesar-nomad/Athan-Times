const Homey = require('homey');

class AthanTimesApp extends Homey.App {

  async onInit() {
    this.log('Athan Times V1.4.11 (Native Fetch) Initializing...');
    
    // Force a garbage collection on boot if available
    if (global.gc) { global.gc(); }

    this.prayerTrigger = this.homey.flow.getTriggerCard('prayer_started');
    this.suhoorTrigger = this.homey.flow.getTriggerCard('suhoor_alarm');
    this.eidTrigger = this.homey.flow.getTriggerCard('eid_morning');

    this.prayerTrigger.registerRunListener(async (args, state) => {
      return args.prayer === state.prayer;
    });
    
    this.currentTimings = null;
    this.apiTimezone = null; 
    
    // Initial sync
    await this.updateSchedule();
    
    // Check local time every 60 seconds
    this.checkInterval = this.homey.setInterval(() => this.checkTimings(), 60000);

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
      
      this.log('Fetching fresh prayer times natively...');
      
      // Node 18 Native Fetch with strict memory abort
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!response.ok) {
         throw new Error(`API Status Code: ${response.status}`);
      }
      
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
      this.log(`Sync Successful.`);
      
    } catch (err) {
      this.error('Sync Error:', err);
    }
  }

  calculateOffset(timeStr, offset) {
    const [h, m] = timeStr.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0);
    d.setMinutes(d.getMinutes() - offset);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  checkTimings() {
    if (!this.currentTimings || !this.apiTimezone) return;

    const now = new Date();
    const localString = now.toLocaleString('en-US', { timeZone: this.apiTimezone });
    const localDate = new Date(localString);
    const cur = `${String(localDate.getHours()).padStart(2, '0')}:${String(localDate.getMinutes()).padStart(2, '0')}`;

    ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].forEach(p => {
      const apiTime = this.currentTimings[p].substring(0, 5);
      if (apiTime === cur) {
        this.log(`Triggering Flow for ${p}`);
        this.prayerTrigger.trigger({}, { prayer: p }).catch(err => this.error('Trigger Error:', err));
      }
    });

    if (this.isRamadan && this.suhoorTime === cur) {
      this.suhoorTrigger.trigger().catch(err => this.error('Suhoor Trigger Error:', err));
    }

    if (this.isEid && this.currentTimings.Fajr.substring(0, 5) === cur) {
      this.eidTrigger.trigger().catch(err => this.error('Eid Trigger Error:', err));
    }

    if (cur === "02:00") this.updateSchedule();
  }
}

module.exports = AthanTimesApp;