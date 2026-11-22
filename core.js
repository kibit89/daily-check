/* Daily Check — core logic (pure, no DOM, no network) */
(function (global) {
  'use strict';

  /* A "logical day" runs 04:00 -> 03:59 of the next morning, so a dose taken
     at 00:30 still belongs to the previous night. */
  var LOGICAL_START_HOUR = 4;

  var MOODS = [
    { id: 'good',    emoji: '😊', label: '좋음' },
    { id: 'ok',      emoji: '🙂', label: '무난' },
    { id: 'calm',    emoji: '😌', label: '평온' },
    { id: 'tired',   emoji: '😴', label: '피곤' },
    { id: 'anxious', emoji: '😟', label: '불안' },
    { id: 'low',     emoji: '😔', label: '우울' },
    { id: 'wired',   emoji: '😣', label: '예민' },
    { id: 'blank',   emoji: '😶', label: '멍함' }
  ];

  /* Neutral defaults shipped in the public code: no personal wording. */
  var DEFAULT_SLOTS = [
    { id: 's1', name: '아침 1',  start: '09:30', end: '10:00', target: '' },
    { id: 's2', name: '아침 2',  start: '11:00', end: '12:00', target: '11:30' },
    { id: 's3', name: '점심',    start: '15:30', end: '16:30', target: '' },
    { id: 's4', name: '저녁',    start: '19:30', end: '20:30', target: '' },
    { id: 's5', name: '자기 전', start: '00:00', end: '02:00', target: '' }
  ];

  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  /* ---------- small helpers ---------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function dateKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseKey(key) {
    var p = String(key).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 0, 0, 0, 0);
  }

  function isKey(key) {
    return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && !isNaN(parseKey(key).getTime());
  }

  function logicalDate(now) {
    var d = new Date(now.getTime());
    if (d.getHours() < LOGICAL_START_HOUR) d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function logicalKey(now) { return dateKey(logicalDate(now)); }

  function addDaysKey(key, n) {
    var d = parseKey(key);
    d.setDate(d.getDate() + n);
    return dateKey(d);
  }

  function minutesOf(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm == null ? '' : hhmm).trim());
    if (!m) return null;
    var h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }

  function hhmmOf(min) {
    min = ((min % 1440) + 1440) % 1440;
    return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60);
  }

  function timeOfDate(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

  /* minutes from 04:00 of the logical day (0 .. 1439) */
  function logicalOffset(min) {
    return ((min - LOGICAL_START_HOUR * 60) % 1440 + 1440) % 1440;
  }

  function offsetRange(slot) {
    var s = minutesOf(slot.start);
    var e = minutesOf(slot.end);
    if (s === null) s = 0;
    if (e === null || e === s) e = s + 30;
    var os = logicalOffset(s);
    var oe = logicalOffset(e);
    if (oe <= os) oe += 1440;
    return { s: os, e: oe, length: oe - os };
  }

  function inWindow(slot, hhmm) {
    var t = minutesOf(hhmm);
    if (t === null) return false;
    var r = offsetRange(slot);
    var o = logicalOffset(t);
    return o >= r.s && o <= r.e;
  }

  /* ---------- slots ---------- */

  function normSlot(raw, i) {
    if (!raw || typeof raw !== 'object') return null;
    var start = minutesOf(raw.start);
    var end = minutesOf(raw.end);
    if (start === null) return null;
    if (end === null) end = start + 30;
    if (end === start) end = start + 30;
    var name = String(raw.name == null ? '' : raw.name).trim().slice(0, 24);
    var target = minutesOf(raw.target);
    return {
      id: String(raw.id || ('s' + (i + 1))).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || ('s' + (i + 1)),
      name: name || ('시간대 ' + (i + 1)),
      start: hhmmOf(start),
      end: hhmmOf(end),
      target: target === null ? '' : hhmmOf(target)
    };
  }

  function normalizeSlots(list) {
    if (!Array.isArray(list)) return [];
    var used = {};
    var out = [];
    list.forEach(function (raw, i) {
      var s = normSlot(raw, i);
      if (!s) return;
      var base = s.id, n = 1;
      while (used[s.id]) { n += 1; s.id = base + '-' + n; }
      used[s.id] = true;
      out.push(s);
    });
    return out.slice(0, 8);
  }

  function slotWindowLabel(slot) {
    if (slot.target) return slot.target;
    if (slot.start === slot.end) return slot.start;
    return slot.start + ' ~ ' + slot.end;
  }

  function slotWindowText(slot) {
    if (slot.start === slot.end) return slot.start;
    return slot.start + '~' + slot.end;
  }

  /* absolute start/end Date for a slot inside a logical day */
  function slotBounds(slot, key) {
    var base = parseKey(key);
    base.setHours(LOGICAL_START_HOUR, 0, 0, 0);
    var r = offsetRange(slot);
    return {
      start: new Date(base.getTime() + r.s * 60000),
      end: new Date(base.getTime() + r.e * 60000)
    };
  }

  /* state: taken | due | upcoming | missed */
  function slotState(slot, key, dayLogs, now) {
    var rec = (dayLogs && dayLogs[slot.id]) || null;
    var b = slotBounds(slot, key);
    var out = { state: 'upcoming', rec: rec, onTime: false, start: b.start, end: b.end };
    if (rec && rec.skipped) { out.state = 'skipped'; return out; }
    if (rec) {
      out.state = 'taken';
      out.onTime = rec.onTime !== false;
      return out;
    }
    if (now < b.start) { out.state = 'upcoming'; return out; }
    if (now <= b.end) { out.state = 'due'; return out; }
    out.state = 'missed';
    return out;
  }

  function daySummary(key, slots, logs, now, startedAt) {
    var dayLogs = (logs && logs[key]) || {};
    var startKey = (typeof startedAt === 'number' && isFinite(startedAt) && startedAt > 0)
      ? logicalKey(new Date(startedAt)) : null;
    var beforeStart = startKey !== null && key < startKey;
    var out = {
      key: key, taken: 0, total: slots.length, late: 0, missed: 0, skipped: 0, due: 0, upcoming: 0, preStart: 0,
      missedIds: [], lateIds: [], dueIds: [], skippedIds: [], preStartIds: [], rows: [], isToday: false, isFuture: false,
      complete: false, tone: 'future'
    };
    slots.forEach(function (s) {
      var st = slotState(s, key, dayLogs, now);
      var pre = st.state === 'missed' &&
        (beforeStart || (startKey === key && startedAt > 0 && st.end.getTime() < startedAt));
      if (pre) {
        out.preStart += 1;
        out.preStartIds.push(s.id);
        out.rows.push({ slot: s, state: 'prestart', onTime: false, rec: st.rec, start: st.start, end: st.end });
        return;
      }
      out.rows.push({ slot: s, state: st.state, onTime: st.onTime, rec: st.rec, start: st.start, end: st.end });
      if (st.state === 'taken') {
        out.taken += 1;
        if (!st.onTime) { out.late += 1; out.lateIds.push(s.id); }
      } else if (st.state === 'skipped') {
        out.skipped += 1; out.skippedIds.push(s.id);
      } else if (st.state === 'missed') {
        out.missed += 1; out.missedIds.push(s.id);
      } else if (st.state === 'due') {
        out.due += 1; out.dueIds.push(s.id);
      } else {
        out.upcoming += 1;
      }
    });
    out.isToday = key === logicalKey(now);
    out.isFuture = key > logicalKey(now);
    out.complete = out.total > 0 && out.taken === out.total;
    if (out.complete) out.tone = out.late ? 'orange' : 'green';
    else if (beforeStart) out.tone = 'none';
    else if (out.isFuture) out.tone = 'future';
    else if (out.isToday) out.tone = 'progress';
    else if (startKey === key && out.taken === 0) out.tone = 'none';
    else out.tone = 'red';
    return out;
  }

  /* the next slot that still needs attention today */
  function nextUp(slots, logs, now) {
    var key = logicalKey(now);
    var dayLogs = (logs && logs[key]) || {};
    var firstDue = null, firstUpcoming = null;
    for (var i = 0; i < slots.length; i += 1) {
      var st = slotState(slots[i], key, dayLogs, now);
      if (st.state === 'due' && !firstDue) firstDue = { slot: slots[i], state: 'due', start: st.start, end: st.end };
      if (st.state === 'upcoming' && !firstUpcoming) firstUpcoming = { slot: slots[i], state: 'upcoming', start: st.start, end: st.end };
    }
    return firstDue || firstUpcoming || null;
  }

  /* ---------- calendar ---------- */

  function monthGrid(year, month) {
    var first = new Date(year, month, 1);
    var startOffset = first.getDay();
    var cells = [];
    for (var i = 0; i < 42; i += 1) {
      var d = new Date(year, month, 1 - startOffset + i);
      cells.push({ key: dateKey(d), day: d.getDate(), inMonth: d.getMonth() === month });
    }
    while (cells.length > 7 && !cells[cells.length - 1].inMonth && !cells[cells.length - 2].inMonth) cells.length -= 7;
    return cells;
  }

  function dayLabel(key) {
    var d = parseKey(key);
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WEEKDAYS[d.getDay()] + ')';
  }

  function monthLabel(y, m) { return y + '년 ' + (m + 1) + '월'; }

  /* ---------- state ---------- */

  function blankState() {
    return {
      v: 1,
      setupId: null,
      startedAt: Date.now(),
      slots: DEFAULT_SLOTS.map(function (s, i) { return normSlot(s, i); }),
      meds: {},
      logs: {},
      settings: { remind: false, notified: {} }
    };
  }

  function normalizeRecord(rec) {
    if (!rec || typeof rec !== 'object') return null;
    var at = minutesOf(rec.at);
    var moods = [];
    if (Array.isArray(rec.moods)) {
      rec.moods.forEach(function (m) {
        if (typeof m === 'string' && MOODS.some(function (x) { return x.id === m; }) && moods.indexOf(m) < 0) moods.push(m);
      });
    }
    return {
      at: at === null ? '' : hhmmOf(at),
      onTime: rec.onTime !== false,
      moods: moods,
      note: String(rec.note == null ? '' : rec.note).slice(0, 200),
      skipped: rec.skipped === true,
      ts: typeof rec.ts === 'number' ? rec.ts : Date.now()
    };
  }

  function normalizeState(raw) {
    var st = blankState();
    if (!raw || typeof raw !== 'object') return st;
    st.setupId = typeof raw.setupId === 'string' ? raw.setupId.slice(0, 64) : null;
    st.startedAt = (typeof raw.startedAt === 'number' && isFinite(raw.startedAt) && raw.startedAt > 0)
      ? raw.startedAt : null;

    var slots = normalizeSlots(raw.slots);
    if (slots.length) st.slots = slots;

    var ids = {};
    st.slots.forEach(function (s) { ids[s.id] = true; });

    if (raw.meds && typeof raw.meds === 'object') {
      Object.keys(raw.meds).forEach(function (id) {
        if (!ids[id]) return;
        var list = raw.meds[id];
        if (!Array.isArray(list)) return;
        var seen = {};
        st.meds[id] = list.map(function (x) { return String(x).trim().slice(0, 40); })
          .filter(function (x) { if (!x || seen[x]) return false; seen[x] = true; return true; })
          .slice(0, 24);
      });
    }

    if (raw.logs && typeof raw.logs === 'object') {
      Object.keys(raw.logs).forEach(function (k) {
        if (!isKey(k)) return;
        var day = raw.logs[k];
        if (!day || typeof day !== 'object') return;
        var out = {};
        Object.keys(day).forEach(function (id) {
          if (!ids[id]) return;
          var rec = normalizeRecord(day[id]);
          if (rec) out[id] = rec;
        });
        if (Object.keys(out).length) st.logs[k] = out;
      });
    }

    if (raw.settings && typeof raw.settings === 'object') {
      st.settings.remind = !!raw.settings.remind;
      var noti = raw.settings.notified;
      if (noti && typeof noti === 'object') {
        Object.keys(noti).forEach(function (k) {
          var t = Number(noti[k]);
          if (isFinite(t) && t > 0) st.settings.notified[k] = t;
        });
      }
    }
    return st;
  }

  /* Setup payload applied from a one-time link. Keeps existing dose logs. */
  function applySetup(state, payload) {
    if (!payload || typeof payload !== 'object') return { applied: false, reason: 'invalid' };
    var slots = normalizeSlots(payload.slots);
    if (!slots.length) return { applied: false, reason: 'invalid' };
    var id = String(payload.id || payload.setupId || 'setup').slice(0, 64);
    if (state.setupId === id) return { applied: false, reason: 'already', slots: slots.length };

    var meds = {};
    var prevMeds = state.meds || {};
    slots.forEach(function (s) {
      var rawList = null;
      (payload.slots || []).forEach(function (p) {
        if (p && String(p.id || '') === s.id && Array.isArray(p.meds)) rawList = p.meds;
      });
      if (rawList && rawList.length) {
        var seen = {};
        meds[s.id] = rawList.map(function (x) { return String(x).trim().slice(0, 40); })
          .filter(function (x) { if (!x || seen[x]) return false; seen[x] = true; return true; })
          .slice(0, 24);
      } else {
        meds[s.id] = Array.isArray(prevMeds[s.id]) ? prevMeds[s.id] : [];
      }
    });

    state.slots = slots;
    state.meds = meds;
    state.setupId = id;
    return { applied: true, slots: slots.length };
  }

  /* ---------- base64url (UTF-8 safe, no btoa dependency) ---------- */

  var B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function utf8Encode(str) {
    var out = '';
    for (var i = 0; i < str.length; i += 1) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out += String.fromCharCode(c);
      else if (c < 0x800) out += String.fromCharCode(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        var c2 = str.charCodeAt(i + 1);
        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        i += 1;
        out += String.fromCharCode(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else {
        out += String.fromCharCode(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return out;
  }

  function utf8Decode(bin) {
    var out = '';
    for (var i = 0; i < bin.length; i += 1) {
      var b0 = bin.charCodeAt(i);
      if (b0 < 0x80) out += String.fromCharCode(b0);
      else if (b0 >= 0xC0 && b0 < 0xE0) {
        var b1 = bin.charCodeAt(i += 1);
        out += String.fromCharCode(((b0 & 31) << 6) | (b1 & 63));
      } else if (b0 >= 0xE0 && b0 < 0xF0) {
        var b1b = bin.charCodeAt(i += 1), b2 = bin.charCodeAt(i += 1);
        out += String.fromCharCode(((b0 & 15) << 12) | ((b1b & 63) << 6) | (b2 & 63));
      } else if (b0 >= 0xF0) {
        var x1 = bin.charCodeAt(i += 1), x2 = bin.charCodeAt(i += 1), x3 = bin.charCodeAt(i += 1);
        var c = ((b0 & 7) << 18) | ((x1 & 63) << 12) | ((x2 & 63) << 6) | (x3 & 63);
        c -= 0x10000;
        out += String.fromCharCode(0xD800 + (c >> 10), 0xDC00 + (c & 1023));
      }
    }
    return out;
  }

  function b64encode(bin) {
    var out = '';
    var i = 0;
    while (i < bin.length) {
      var c1 = bin.charCodeAt(i);
      var c2 = i + 1 < bin.length ? bin.charCodeAt(i + 1) : NaN;
      var c3 = i + 2 < bin.length ? bin.charCodeAt(i + 2) : NaN;
      out += B64C[c1 >> 2];
      out += B64C[((c1 & 3) << 4) | (isNaN(c2) ? 0 : c2 >> 4)];
      if (isNaN(c2)) break;
      out += B64C[((c2 & 15) << 2) | (isNaN(c3) ? 0 : c3 >> 6)];
      if (isNaN(c3)) break;
      out += B64C[c3 & 63];
      i += 3;
    }
    return out;
  }

  function b64val(ch) {
    var i = B64C.indexOf(ch);
    if (i >= 0) return i;
    if (ch === '+') return 62;
    if (ch === '/') return 63;
    return -1;
  }

  function b64decode(str) {
    var s = String(str).replace(/\s+/g, '');
    var out = '', buf = 0, bits = 0;
    for (var i = 0; i < s.length; i += 1) {
      var v = b64val(s[i]);
      if (v < 0) continue;
      buf = (buf << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out += String.fromCharCode((buf >> bits) & 255);
        buf &= (1 << bits) - 1;
      }
    }
    return out;
  }

  function encodeSetup(obj) { return b64encode(utf8Encode(JSON.stringify(obj))); }

  function decodeSetup(str) {
    try {
      var json = utf8Decode(b64decode(decodeURIComponent(String(str))));
      var obj = JSON.parse(json);
      return (obj && typeof obj === 'object') ? obj : null;
    } catch (e) {
      return null;
    }
  }

  global.DC = {
    LOGICAL_START_HOUR: LOGICAL_START_HOUR,
    MOODS: MOODS,
    DEFAULT_SLOTS: DEFAULT_SLOTS,
    WEEKDAYS: WEEKDAYS,
    pad2: pad2,
    dateKey: dateKey,
    parseKey: parseKey,
    isKey: isKey,
    logicalDate: logicalDate,
    logicalKey: logicalKey,
    addDaysKey: addDaysKey,
    minutesOf: minutesOf,
    hhmmOf: hhmmOf,
    timeOfDate: timeOfDate,
    offsetRange: offsetRange,
    inWindow: inWindow,
    normSlot: normSlot,
    normalizeSlots: normalizeSlots,
    slotWindowLabel: slotWindowLabel,
    slotWindowText: slotWindowText,
    slotBounds: slotBounds,
    slotState: slotState,
    daySummary: daySummary,
    nextUp: nextUp,
    monthGrid: monthGrid,
    dayLabel: dayLabel,
    monthLabel: monthLabel,
    blankState: blankState,
    normalizeState: normalizeState,
    normalizeRecord: normalizeRecord,
    applySetup: applySetup,
    encodeSetup: encodeSetup,
    decodeSetup: decodeSetup
  };
})(typeof window !== 'undefined' ? window : globalThis);
