Athan Times

Automatically calculate and trigger flows for daily Islamic prayer times directly on your Homey Pro. 

Athan Times uses your Homey's local GPS coordinates to daily fetch prayer schedules using the Umm Al-Qura calculation method. 

Features:
- Daily Triggers: Dedicated flow cards for Fajr, Dhuhr, Asr, Maghrib, and Isha.
- Ramadan Mode: Automatically detects the Hijri month of Ramadan and provides a custom Suhoor alarm trigger with a user-defined offset.
- Eid Detection: Special flow trigger for the morning of Eid (not yet tested).
- Hijri Adjustments: Easily adjust the Hijri calendar offset (+/- days) directly from the app settings.
- Live Dashboard: View today's calculated prayer times right in the Homey settings page.

Setup:
1. Install the app.
2. Ensure your Homey Pro has its location set correctly.
3. The app will automatically calculate your times. You can view them by going to Configure App.
4. Create a new Flow, add the "A prayer starts" THEN card, and select your desired prayer time (or Suhoor/Eid) from the dropdown.

This was vibe-coded, by a non-programmer. 