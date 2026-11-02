// Background timer: hands an incident to the next police unit when the alerted one stays silent, and warns dispatch
// when an incident still has no ambulance.
const config = require('../config');
const { escalateUnresponsivePolice, alertUnassignedAmbulances } = require('./incidentService');

let timer = null;
let running = false;

function start() {
  if (timer) return;
  timer = setInterval(async () => {
    if (running) return; // never overlap two sweeps
    running = true;
    try {
      const n = await escalateUnresponsivePolice();
      if (n > 0) console.log(`[escalation] escalated ${n} incident(s) with no police response`);
      const a = await alertUnassignedAmbulances();
      if (a > 0) console.log(`[escalation] warned dispatch about ${a} incident(s) with no ambulance`);
    } catch (err) {
      console.error('[escalation] sweep failed:', err.message);
    } finally {
      running = false;
    }
  }, Math.max(5, config.escalationIntervalSec) * 1000);
  timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop };
