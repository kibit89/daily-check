/* Daily Check — app shell (all data stays in this browser) */
(function () {
  'use strict';

  var DC = window.DC;
  var STORE_KEY = 'dailyCheck.v1';
  var VERSION = '1.0.0';

  var MOOD_BY_ID = {};
  DC.MOODS.forEach(function (m) { MOOD_BY_ID[m.id] = m; });

  var state = loadState();
  var ui = { view: 'today', cal: null, detail: null };
  var installPrompt = null;
  var doseCtx = null;

  /* ---------------- storage ---------------- */

  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return DC.blankState();
      return DC.normalizeState(JSON.parse(raw));
    } catch (e) {
      return DC.blankState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('저장 공간이 부족해 기록하지 못했어요');
    }
  }

  /* ---------------- helpers ---------------- */

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function slotById(id) {
    for (var i = 0; i < state.slots.length; i += 1) if (state.slots[i].id === id) return state.slots[i];
    return null;
  }

  function medsOf(id) {
    return Array.isArray(state.meds[id]) ? state.meds[id] : [];
  }

  function moodEmoji(ids) {
    return (ids || []).map(function (id) { return MOOD_BY_ID[id] ? MOOD_BY_ID[id].emoji : ''; }).join(' ');
  }

  var toastTimer = null;
  function toast(msg) {
    var t = el('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  /* ---------------- setup link ---------------- */

  function readSetupHash() {
    var hash = location.hash || '';
    if (hash.indexOf('#setup=') !== 0) return false;
    var payload = DC.decodeSetup(hash.slice(7));
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    if (!payload) { toast('설정 링크를 읽지 못했어요'); return false; }
    var res = DC.applySetup(state, payload);
    if (res.applied) {
      save();
      toast('복용 시간대 ' + res.slots + '개를 불러왔어요');
      return true;
    }
    return false;
  }

  /* ---------------- today ---------------- */

  function renderToday() {
    var now = new Date();
    var key = DC.logicalKey(now);
    var sum = DC.daySummary(key, state.slots, state.logs, now, state.startedAt);

    el('todayDate').textContent = DC.dayLabel(key);
    el('todaySub').textContent = now.getHours() < DC.LOGICAL_START_HOUR
      ? '새벽 ' + DC.pad2(now.getHours()) + ':' + DC.pad2(now.getMinutes()) + ' · 어젯밤 복약 기록 중'
      : '복약 체크';

    var pct = sum.total ? Math.round((sum.taken / sum.total) * 100) : 0;
    var headline, sub, tone;

    if (!sum.total) {
      headline = '시간대를 먼저 만들어 주세요';
      sub = '설정에서 복용 시간대를 추가할 수 있어요';
      tone = 'muted';
    } else if (sum.complete) {
      headline = '오늘 복약 완료';
      sub = sum.late ? sum.taken + '개 중 ' + sum.late + '개는 시간이 조금 늦었어요' : sum.taken + '개 모두 정해진 시간에 드셨어요';
      tone = sum.late ? 'orange' : 'green';
    } else {
      var nu = DC.nextUp(state.slots, state.logs, now);
      tone = 'plain';
      if (nu && nu.state === 'due') {
        headline = '지금 드실 시간이에요';
        sub = nu.slot.name + ' · ' + DC.slotWindowText(nu.slot);
        tone = 'due';
      } else if (nu) {
        var mins = Math.max(0, Math.round((nu.start.getTime() - now.getTime()) / 60000));
        headline = '다음은 ' + DC.slotWindowLabel(nu.slot);
        sub = nu.slot.name + ' · ' + (mins >= 60
          ? Math.floor(mins / 60) + '시간 ' + (mins % 60 ? (mins % 60) + '분 ' : '') + '뒤'
          : mins + '분 뒤');
      } else if (sum.skipped > 0) {
        headline = '오늘 남은 시간대가 없어요';
        sub = sum.taken + '개 복용 · ' + sum.skipped + '개 건너뜀';
      } else if (sum.taken === 0) {
        headline = '복약 기록을 시작해요';
        sub = '정해진 시간에 맞춰 체크해 보세요';
      } else {
        headline = '오늘은 여기까지예요';
        sub = now.getHours() < DC.LOGICAL_START_HOUR
          ? '새벽 4시에 새 날이 시작돼요'
          : sum.taken + '개를 기록했어요';
      }
    }

    el('todayHero').innerHTML =
      '<div class="ring tone-' + tone + '" style="--pct:' + pct + '">' +
        '<div class="ring-in"><strong>' + sum.taken + '</strong><span>/' + sum.total + '</span></div>' +
      '</div>' +
      '<div class="hero-copy"><p class="kicker">오늘 복약</p>' +
        '<h2>' + esc(headline) + '</h2><p>' + esc(sub) + '</p></div>';

    var notice = '';
    if (sum.missed > 0 && !sum.complete) {
      var names = sum.missedIds.map(function (id) {
        var s = slotById(id);
        return s ? s.name : '';
      }).filter(Boolean).join(', ');
      notice = '<div class="notice"><strong>놓친 시간대가 있어요</strong><span>' + esc(names) +
        ' · 늦게라도 기록해 두면 달력에 남아요</span></div>';
    }
    el('missedNotice').innerHTML = notice;

    var html = sum.rows.map(function (row) {
      return slotCard(row, now);
    }).join('');
    el('slotList').innerHTML = html || '<li class="empty">설정에서 복용 시간대를 추가해 주세요.</li>';
  }

  function slotCard(row, now) {
    var s = row.slot;
    var meds = medsOf(s.id);
    var cls = 'slot is-' + row.state + (row.state === 'taken' && !row.onTime ? ' is-late' : '');
    var tag;

    if (row.state === 'taken') tag = row.onTime ? '<span class="tag ok">제시간 복용</span>' : '<span class="tag warn">시간 외 복용</span>';
    else if (row.state === 'skipped') tag = '<span class="tag">건너뜀</span>';
    else if (row.state === 'prestart') tag = '<span class="tag">기록 전</span>';
    else if (row.state === 'due') tag = '<span class="tag due">지금</span>';
    else if (row.state === 'missed') tag = '<span class="tag miss">놓침</span>';
    else tag = '<span class="tag">예정</span>';

    var time = s.target
      ? '<span class="slot-time">' + esc(s.target) + '</span><span class="slot-window">' + esc(s.start + '~' + s.end) + ' 정시 인정</span>'
      : '<span class="slot-time">' + esc(s.start) + '</span><span class="slot-tilde">~</span><span class="slot-time sm">' + esc(s.end) + '</span>';

    var medHtml = meds.length
      ? '<ul class="chips">' + meds.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>'
      : '<p class="med-empty">약 이름은 설정에서 추가할 수 있어요</p>';

    var foot = '';
    if (row.state === 'skipped') {
      foot = '<div class="slot-detail">건너뛴 것으로 표시했어요</div>' +
        '<div class="slot-actions">' +
          '<button class="btn tiny" data-act="edit" data-id="' + esc(s.id) + '">수정</button>' +
          '<button class="btn tiny ghost" data-act="undo" data-id="' + esc(s.id) + '">취소</button>' +
        '</div>';
    } else if (row.state === 'taken') {
      var bits = [];
      if (row.rec.at) bits.push(row.rec.at + ' 복용');
      var emo = moodEmoji(row.rec.moods);
      if (emo) bits.push(emo);
      foot = '<div class="slot-detail">' + esc(bits.join(' · ')) + '</div>' +
        '<div class="slot-actions">' +
          '<button class="btn tiny" data-act="edit" data-id="' + esc(s.id) + '">수정</button>' +
          '<button class="btn tiny ghost" data-act="undo" data-id="' + esc(s.id) + '">취소</button>' +
        '</div>';
    } else if (row.state === 'missed' || row.state === 'prestart') {
      foot = '<div class="slot-actions">' +
          '<button class="btn tiny ghost" data-act="skip" data-id="' + esc(s.id) + '">건너뜀</button>' +
          '<button class="btn primary" data-act="take" data-id="' + esc(s.id) + '">' +
            (row.state === 'prestart' ? '먹었어요' : '늦게 먹었어요') + '</button>' +
        '</div>';
    } else {
      foot = '<div class="slot-actions">' +
          '<button class="btn primary" data-act="take" data-id="' + esc(s.id) + '">먹었어요</button>' +
        '</div>';
    }

    var note = row.rec && row.rec.note ? '<p class="slot-note">“' + esc(row.rec.note) + '”</p>' : '';

    return '<li class="' + cls + '" data-id="' + esc(s.id) + '">' +
      '<div class="slot-head">' + time + tag + '</div>' +
      '<h3 class="slot-name">' + esc(s.name) + '</h3>' +
      medHtml + note + foot +
      '</li>';
  }

  /* ---------------- calendar ---------------- */

  var TONE_TEXT = {
    green: '모두 제시간',
    orange: '모두 복용 · 일부 지연',
    red: '빠뜨린 시간대 있음',
    progress: '오늘 · 진행 중',
    future: '예정',
    none: '기록 전'
  };

  function renderCalendar() {
    var now = new Date();
    if (!ui.cal) {
      var d = DC.logicalDate(now);
      ui.cal = { y: d.getFullYear(), m: d.getMonth() };
    }
    el('calTitle').textContent = DC.monthLabel(ui.cal.y, ui.cal.m);

    var cells = DC.monthGrid(ui.cal.y, ui.cal.m);
    var todayKey = DC.logicalKey(now);
    var todayDate = DC.logicalDate(now);
    var isThisMonth = ui.cal.y === todayDate.getFullYear() && ui.cal.m === todayDate.getMonth();
    if (!ui.detail && isThisMonth) ui.detail = todayKey;

    el('calGrid').innerHTML = cells.map(function (c) {
      var sum = DC.daySummary(c.key, state.slots, state.logs, now, state.startedAt);
      var cls = ['cal-cell', 'tone-' + sum.tone];
      if (!c.inMonth) cls.push('out');
      if (c.key === todayKey) cls.push('today');
      if (c.key === ui.detail) cls.push('sel');
      if (sum.tone === 'progress') cls.push(sum.missed ? 'has-miss' : 'clean');

      var mark = '';
      if (sum.total) {
        if (sum.tone === 'progress') mark = '<span class="mark count">' + sum.taken + '/' + sum.total + '</span>';
        else if (sum.tone !== 'future' && sum.tone !== 'none') mark = '<span class="mark dot"></span>';
      }
      return '<button type="button" class="' + cls.join(' ') + '" data-key="' + c.key + '"' +
        (c.inMonth ? '' : ' aria-hidden="true" tabindex="-1"') + '>' +
        '<span class="daynum">' + c.day + '</span>' + mark + '</button>';
    }).join('');

    el('calTodayBtn').hidden = isThisMonth;
    renderDayDetail();
  }

  function renderDayDetail() {
    var box = el('dayDetail');
    if (!ui.detail) {
      box.innerHTML = '<p class="cal-hint">날짜를 누르면 그날의 복용 시각·기분 기록을 볼 수 있어요.</p>';
      return;
    }
    var now = new Date();
    var key = ui.detail;
    var sum = DC.daySummary(key, state.slots, state.logs, now, state.startedAt);
    var nowKey = DC.logicalKey(now);

    var tagCls = 'tone-' + sum.tone;
    var rows = sum.rows.map(function (row) {
      var s = row.slot;
      var statusTxt, statusCls;
      if (row.state === 'taken') {
        statusTxt = (row.rec.at || '') + ' 복용' + (row.onTime ? ' · 제시간' : ' · 시간 외');
        statusCls = row.onTime ? 'ok' : 'warn';
      } else if (row.state === 'prestart') {
        statusTxt = '기록 전'; statusCls = '';
      } else if (row.state === 'skipped') {
        statusTxt = '건너뜀'; statusCls = '';
      } else if (row.state === 'missed') {
        statusTxt = '기록 없음'; statusCls = 'miss';
      } else if (row.state === 'due') {
        statusTxt = '지금 드실 시간'; statusCls = 'due';
      } else {
        statusTxt = '예정'; statusCls = '';
      }
      var emo = row.rec ? moodEmoji(row.rec.moods) : '';
      var meta = '<span class="dr-meta ' + statusCls + '">' + esc(statusTxt) + (emo ? ' · ' + emo : '') + '</span>';
      var note = row.rec && row.rec.note ? '<span class="dr-note">“' + esc(row.rec.note) + '”</span>' : '';
      var action = key > nowKey ? '' : '<button class="btn tiny" data-act="day-edit" data-id="' + esc(s.id) + '">' +
        (row.state === 'taken' ? '수정' : '기록') + '</button>';
      return '<div class="detail-row ' + (row.state === 'taken' ? 'is-taken' : '') + '">' +
        '<div class="dr-time">' + esc(DC.slotWindowText(s)) + '</div>' +
        '<div class="dr-main"><strong>' + esc(s.name) + '</strong>' + meta + note + '</div>' +
        action + '</div>';
    }).join('');

    var summaryLine;
    if (!sum.total) summaryLine = '시간대가 없어요';
    else if (sum.complete) summaryLine = sum.taken + '/' + sum.total + ' 복용' + (sum.late ? ' · ' + sum.late + '개 지연' : '');
    else if (sum.isFuture) summaryLine = '아직 오지 않은 날이에요';
    else summaryLine = sum.taken + '/' + sum.total + ' 복용 · ' + sum.missed + '개 놓침';

    box.innerHTML = '<div class="card daycard">' +
      '<div class="daycard-head"><div><strong>' + esc(DC.dayLabel(key)) + '</strong>' +
      '<span class="daycard-sub">' + esc(summaryLine) + '</span></div>' +
      '<span class="tone-tag ' + tagCls + '">' +
        esc(sum.tone === 'none' && sum.taken > 0 ? '일부 기록' : TONE_TEXT[sum.tone]) + '</span></div>' +
      '<div class="detail-list">' + rows + '</div>' +
      '</div>';
  }

  /* ---------------- settings ---------------- */

  function renderSettings() {
    renderSlotEditor();
    renderMedEditor();
    renderNotifyBox();
    el('verLine').textContent = 'Daily Check v' + VERSION;
    el('installBtn').hidden = !installPrompt;
  }

  function renderSlotEditor() {
    var rows = state.slots.map(function (s) {
      return '<div class="edit-row" data-id="' + esc(s.id) + '">' +
        '<div class="er-top">' +
          '<input class="txt" data-field="name" value="' + esc(s.name) + '" maxlength="24" aria-label="시간대 이름" placeholder="시간대 이름">' +
          '<button class="icon-btn" data-act="del-slot" data-id="' + esc(s.id) + '" aria-label="시간대 삭제">' +
            '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="er-times">' +
          '<label class="tf"><span>기준</span><input type="time" data-field="target" value="' + esc(s.target || '') + '"></label>' +
          '<label class="tf"><span>정시 시작</span><input type="time" data-field="start" value="' + esc(s.start) + '"></label>' +
          '<label class="tf"><span>정시 끝</span><input type="time" data-field="end" value="' + esc(s.end) + '"></label>' +
        '</div>' +
        '<p class="er-hint">' + (s.target ? esc(s.target) + ' 기준 · ' : '') + esc(s.start + '~' + s.end) + ' 안에 먹으면 ‘제시간’, 밖에 먹으면 ‘시간 외’로 기록돼요.</p>' +
      '</div>';
    }).join('');
    el('slotEditor').innerHTML = rows || '<p class="hint">시간대가 없어요. 아래 버튼으로 추가해 주세요.</p>';
  }

  function renderMedEditor() {
    var blocks = state.slots.map(function (s) {
      var lines = medsOf(s.id).join('\n');
      return '<div class="med-block">' +
        '<label for="med-' + esc(s.id) + '">' + esc(s.name) + '</label>' +
        '<textarea id="med-' + esc(s.id) + '" data-med="' + esc(s.id) + '" rows="2" ' +
          'placeholder="한 줄에 약 이름 하나씩">' + esc(lines) + '</textarea>' +
        '</div>';
    }).join('');
    el('medEditor').innerHTML = blocks || '<p class="hint">시간대를 먼저 추가해 주세요.</p>';
  }

  function permissionLabel() {
    if (!('Notification' in window)) return '이 브라우저는 알림을 지원하지 않아요';
    if (Notification.permission === 'granted') return '알림 권한: 허용됨';
    if (Notification.permission === 'denied') return '알림 권한: 차단됨 (브라우저 주소창 옆 자물쇠 → 알림 허용)';
    return '알림 권한: 아직 허용 전';
  }

  function renderNotifyBox() {
    el('remindToggle').checked = !!state.settings.remind;
    el('permState').textContent = permissionLabel();
  }

  /* ---------------- notifications ---------------- */

  function notify(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var opts = { body: body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'daily-check' };
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (reg && reg.showNotification) reg.showNotification(title, opts);
        else new Notification(title, opts);
      }).catch(function () { try { new Notification(title, opts); } catch (e) { /* ignore */ } });
    } else {
      try { new Notification(title, opts); } catch (e) { /* ignore */ }
    }
  }

  function checkReminders() {
    if (!state.settings.remind) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var now = new Date();
    var key = DC.logicalKey(now);
    var dayLogs = state.logs[key] || {};
    var changed = false;
    var notified = state.settings.notified || (state.settings.notified = {});

    state.slots.forEach(function (s) {
      var st = DC.slotState(s, key, dayLogs, now);
      if (st.state === 'due' && !notified[key + '|' + s.id + '|due']) {
        notify('💊 ' + s.name + ' 드실 시간이에요', DC.slotWindowText(s) + ' 안에 드시면 제시간이에요.');
        notified[key + '|' + s.id + '|due'] = Date.now();
        changed = true;
      }
      if (st.state === 'missed' && !notified[key + '|' + s.id + '|missed']) {
        notify('놓친 시간대가 있어요', s.name + ' · 아직 늦지 않았어요. 앱에서 기록할 수 있어요.');
        notified[key + '|' + s.id + '|missed'] = Date.now();
        changed = true;
      }
    });

    var cutoff = Date.now() - 1000 * 60 * 60 * 24 * 4;
    Object.keys(notified).forEach(function (k) {
      if (notified[k] < cutoff) { delete notified[k]; changed = true; }
    });
    if (changed) save();
  }

  /* ---------------- dose dialog ---------------- */

  function openDose(slotId, key, rec) {
    var slot = slotById(slotId);
    if (!slot) return;
    var now = new Date();
    var isToday = key === DC.logicalKey(now);
    var defaultTime = rec && rec.at ? rec.at
      : (isToday && now.getHours() >= DC.LOGICAL_START_HOUR - 1 ? DC.timeOfDate(now) : (slot.target || slot.start));

    doseCtx = { slotId: slotId, key: key };
    var meds = medsOf(slot.id);
    var moods = rec && rec.moods ? rec.moods.slice() : [];

    el('doseBody').innerHTML =
      '<h3 class="sheet-title">' + esc(slot.name) + '</h3>' +
      '<p class="sheet-sub">' + esc(DC.dayLabel(key)) + ' · 정시 인정 ' + esc(DC.slotWindowText(slot)) + '</p>' +
      (meds.length ? '<ul class="chips sheet-meds">' + meds.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>' : '') +
      '<label class="field"><span>복용한 시각</span><input type="time" id="doseTime" value="' + esc(defaultTime) + '"></label>' +
      '<p class="time-hint" id="timeHint"></p>' +
      '<div class="field"><span>복용 전 기분 <em>여러 개 선택해도 돼요</em></span>' +
        '<div class="mood-grid">' + DC.MOODS.map(function (m) {
          return '<button type="button" class="mood" data-mood="' + m.id + '" aria-pressed="' + (moods.indexOf(m.id) >= 0 ? 'true' : 'false') + '">' +
            '<span>' + m.emoji + '</span>' + esc(m.label) + '</button>';
        }).join('') + '</div>' +
      '</div>' +
      '<label class="field"><span>메모 <em>선택</em></span>' +
        '<input type="text" id="doseNote" maxlength="200" placeholder="예: 식후 30분" value="' + esc(rec ? rec.note : '') + '">' +
      '</label>' +
      '<div class="sheet-actions">' +
        (rec ? '<button type="button" class="btn ghost danger" data-act="dose-delete">기록 삭제</button>' : '<span></span>') +
        '<button type="button" class="btn primary" data-act="dose-save">' + (rec ? '수정 저장' : '복용 완료로 기록') + '</button>' +
      '</div>';

    var dialog = el('doseDialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    updateTimeHint();
  }

  function updateTimeHint() {
    var input = el('doseTime');
    var hint = el('timeHint');
    if (!input || !hint || !doseCtx) return;
    var slot = slotById(doseCtx.slotId);
    if (!slot) return;
    if (!input.value) {
      hint.textContent = '복용한 시각을 선택해 주세요';
      hint.className = 'time-hint';
      return;
    }
    var ok = DC.inWindow(slot, input.value);
    hint.textContent = ok ? '제시간 범위 안이에요 ✓' : '정시 범위를 벗어나요 · 시간 외 복용으로 기록돼요';
    hint.className = 'time-hint ' + (ok ? 'ok' : 'warn');
  }

  function closeDoseFromBackdrop(e) {
    var r = el('doseDialog').getBoundingClientRect();
    if (e.clientY < r.top) closeDose();
  }

  function closeDose() {
    var dialog = el('doseDialog');
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function saveDose() {
    if (!doseCtx) return;
    var slot = slotById(doseCtx.slotId);
    if (!slot) return;
    var at = el('doseTime').value || DC.timeOfDate(new Date());
    var onTime = DC.inWindow(slot, at);
    var moods = Array.prototype.slice.call(el('doseBody').querySelectorAll('[data-mood]'))
      .filter(function (b) { return b.getAttribute('aria-pressed') === 'true'; })
      .map(function (b) { return b.getAttribute('data-mood'); });
    var note = (el('doseNote').value || '').trim().slice(0, 200);

    state.logs[doseCtx.key] = state.logs[doseCtx.key] || {};
    state.logs[doseCtx.key][slot.id] = { at: at, onTime: onTime, moods: moods, note: note, ts: Date.now() };
    save();
    closeDose();
    render();
    toast(onTime ? '제시간 복용으로 기록했어요' : '시간이 조금 지났지만 기록했어요');
  }

  function deleteDose() {
    if (!doseCtx) return;
    if (!confirm('이 복용 기록을 지울까요?')) return;
    if (state.logs[doseCtx.key]) {
      delete state.logs[doseCtx.key][doseCtx.slotId];
      if (!Object.keys(state.logs[doseCtx.key]).length) delete state.logs[doseCtx.key];
    }
    save();
    closeDose();
    render();
    toast('기록을 지웠어요');
  }

  /* ---------------- backup / restore ---------------- */

  function exportData() {
    var payload = { app: 'daily-check', version: VERSION, exportedAt: new Date().toISOString(), data: state };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'daily-check-' + DC.logicalKey(new Date()) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1200);
    toast('백업 파일을 내려받았어요');
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var obj = null;
      try { obj = JSON.parse(String(reader.result)); } catch (e) { obj = null; }
      if (!obj || typeof obj !== 'object') { toast('백업 파일을 읽지 못했어요'); return; }
      var raw = obj.data && typeof obj.data === 'object' ? obj.data : obj;
      var next = DC.normalizeState(raw);
      if (!next.slots.length) { toast('백업 파일에 시간대 정보가 없어요'); return; }
      if (!confirm('지금 기록을 백업 파일 내용으로 바꿀까요?')) return;
      state = next;
      save();
      ui.detail = null;
      render();
      toast('백업을 복원했어요');
    };
    reader.onerror = function () { toast('파일을 열지 못했어요'); };
    reader.readAsText(file);
  }

  function resetAll() {
    if (!confirm('모든 복용 기록과 설정을 지울까요? 되돌릴 수 없어요.')) return;
    if (!confirm('정말 지울까요? 필요하면 먼저 백업해 주세요.')) return;
    state = DC.blankState();
    save();
    ui.detail = null;
    render();
    toast('모두 지웠어요');
  }

  /* ---------------- view / navigation ---------------- */

  function setView(view) {
    ui.view = view;
    var views = document.querySelectorAll('.view');
    for (var i = 0; i < views.length; i += 1) views[i].classList.toggle('is-active', views[i].id === 'view-' + view);
    var tabs = document.querySelectorAll('.tab');
    for (var j = 0; j < tabs.length; j += 1) tabs[j].classList.toggle('is-active', tabs[j].getAttribute('data-view') === view);
    window.scrollTo(0, 0);
    if (view === 'today') renderToday();
    if (view === 'calendar') renderCalendar();
    if (view === 'settings') renderSettings();
  }

  function render() {
    renderToday();
    if (ui.view === 'calendar') renderCalendar();
    if (ui.view === 'settings') renderSettings();
  }

  /* ---------------- events ---------------- */

  function bind() {
    document.addEventListener('click', function (e) {
      var tab = e.target.closest ? e.target.closest('[data-view]') : null;
      if (tab) { setView(tab.getAttribute('data-view')); return; }

      var btn = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      var id = btn.getAttribute('data-id');
      var now = new Date();

      if (act === 'take' || act === 'edit' || act === 'skip') {
        var key = btn.closest('.daycard') ? ui.detail : DC.logicalKey(now);
        if (act === 'skip') {
          key = DC.logicalKey(now);
          if (!confirm('이 시간대를 건너뛴 것으로 표시할까요?')) return;
          state.logs[key] = state.logs[key] || {};
          state.logs[key][id] = { at: '', onTime: false, moods: [], note: '', skipped: true, ts: Date.now() };
          save(); render(); toast('건너뛴 것으로 표시했어요');
          return;
        }
        openDose(id, key, act === 'edit' ? (state.logs[key] || {})[id] : null);
        return;
      }

      if (act === 'undo') {
        var k2 = DC.logicalKey(now);
        if (!state.logs[k2] || !state.logs[k2][id]) return;
        if (!confirm('이 복용 기록을 지울까요?')) return;
        delete state.logs[k2][id];
        if (!Object.keys(state.logs[k2]).length) delete state.logs[k2];
        save(); render(); toast('기록을 지웠어요');
        return;
      }

      if (act === 'day-edit') {
        var dkey = ui.detail;
        openDose(id, dkey, (state.logs[dkey] || {})[id] || null);
        return;
      }

      if (act === 'prev-month') {
        ui.cal.m -= 1;
        if (ui.cal.m < 0) { ui.cal.m = 11; ui.cal.y -= 1; }
        ui.detail = null; renderCalendar(); return;
      }
      if (act === 'next-month') {
        ui.cal.m += 1;
        if (ui.cal.m > 11) { ui.cal.m = 0; ui.cal.y += 1; }
        ui.detail = null; renderCalendar(); return;
      }
      if (act === 'cal-today') {
        var dnow = DC.logicalDate(now);
        ui.cal = { y: dnow.getFullYear(), m: dnow.getMonth() };
        ui.detail = DC.logicalKey(now);
        renderCalendar(); return;
      }
      if (act === 'add-slot') {
        var n = state.slots.length + 1;
        state.slots.push(DC.normSlot({ id: 's' + Date.now().toString(36), name: '시간대 ' + n, start: '12:00', end: '13:00' }, n - 1));
        save(); renderSettings(); toast('시간대를 추가했어요'); return;
      }
      if (act === 'del-slot') {
        if (state.slots.length <= 1) { toast('시간대는 하나 이상 있어야 해요'); return; }
        var target = slotById(id);
        if (!target) return;
        if (!confirm('‘' + target.name + '’ 시간대를 지울까요? 지난 기록은 달력에 남아요.')) return;
        state.slots = state.slots.filter(function (s) { return s.id !== id; });
        delete state.meds[id];
        save(); renderSettings(); renderToday(); toast('시간대를 지웠어요'); return;
      }
      if (act === 'export') { exportData(); return; }
      if (act === 'reset') { resetAll(); return; }
      if (act === 'test-notify') {
        if (!('Notification' in window)) { toast('이 브라우저는 알림을 지원하지 않아요'); return; }
        Notification.requestPermission().then(function (p) {
          renderNotifyBox();
          if (p !== 'granted') { toast('알림이 허용되지 않았어요'); return; }
          notify('Daily Check 알림 테스트', '이렇게 복용 시간을 알려드릴게요.');
          toast('테스트 알림을 보냈어요');
        });
        return;
      }
      if (act === 'install') {
        if (!installPrompt) return;
        installPrompt.prompt();
        installPrompt = null;
        renderSettings();
        return;
      }
    });

    el('calGrid').addEventListener('click', function (e) {
      var cell = e.target.closest('.cal-cell');
      if (!cell) return;
      var key = cell.getAttribute('data-key');
      if (!key) return;
      ui.detail = ui.detail === key ? null : key;
      renderCalendar();
    });

    el('slotList').addEventListener('click', function () { /* handled globally */ });

    el('doseBody').addEventListener('click', function (e) {
      var mood = e.target.closest('[data-mood]');
      if (mood) {
        var on = mood.getAttribute('aria-pressed') === 'true';
        mood.setAttribute('aria-pressed', on ? 'false' : 'true');
        return;
      }
      var act = e.target.closest('[data-act]');
      if (!act) return;
      var a = act.getAttribute('data-act');
      if (a === 'dose-save') saveDose();
      if (a === 'dose-delete') deleteDose();
      if (a === 'dose-close') closeDose();
    });

    el('doseBody').addEventListener('input', function (e) {
      if (e.target && e.target.id === 'doseTime') updateTimeHint();
    });

    el('doseDialog').addEventListener('close', function () { doseCtx = null; });
    el('doseDialog').addEventListener('click', function (e) {
      if (e.target === el('doseDialog')) closeDoseFromBackdrop(e);
    });
    var closeBtn = document.querySelector('.sheet-close');
    if (closeBtn) closeBtn.addEventListener('click', closeDose);

    el('slotEditor').addEventListener('change', function (e) {
      var input = e.target.closest('[data-field]');
      if (!input) return;
      var row = input.closest('.edit-row');
      var id = row.getAttribute('data-id');
      var slot = slotById(id);
      if (!slot) return;
      var field = input.getAttribute('data-field');
      if (field === 'name') {
        slot.name = (input.value || '').trim().slice(0, 24) || slot.name;
        input.value = slot.name;
      } else if (field === 'target') {
        slot.target = DC.minutesOf(input.value) === null ? '' : input.value;
      } else {
        if (DC.minutesOf(input.value) === null) { input.value = slot[field]; return; }
        slot[field] = input.value;
      }
      save();
      renderSlotEditor();
      renderMedEditor();
      renderToday();
      toast('시간대를 저장했어요');
    });

    el('medEditor').addEventListener('change', function (e) {
      var area = e.target.closest('[data-med]');
      if (!area) return;
      var id = area.getAttribute('data-med');
      var list = area.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
      var seen = {};
      state.meds[id] = list.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; }).slice(0, 24);
      save();
      renderToday();
      toast('약 목록을 저장했어요');
    });

    el('remindToggle').addEventListener('change', function (e) {
      var on = e.target.checked;
      if (on && 'Notification' in window && Notification.permission !== 'granted') {
        Notification.requestPermission().then(function (p) {
          renderNotifyBox();
          if (p !== 'granted') { e.target.checked = false; state.settings.remind = false; save(); toast('알림을 허용해야 켤 수 있어요'); return; }
          state.settings.remind = true; save(); toast('복용 시간 알림을 켰어요');
        });
        return;
      }
      state.settings.remind = on;
      save();
      toast(on ? '복용 시간 알림을 켰어요' : '알림을 껐어요');
    });

    el('importFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) importData(f);
      e.target.value = '';
    });

    el('calTodayBtn').addEventListener('click', function () {
      ui.detail = null;
      var d = DC.logicalDate(new Date());
      ui.cal = { y: d.getFullYear(), m: d.getMonth() };
      renderCalendar();
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { renderToday(); if (ui.view === 'calendar') renderCalendar(); }
    });

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      installPrompt = e;
      el('installBtn').hidden = false;
    });

    window.addEventListener('hashchange', function () { if (readSetupHash()) render(); });
  }

  /* ---------------- boot ---------------- */

  function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* offline shell only */ });
    });
  }

  function boot() {
    if (!state.startedAt) { state.startedAt = Date.now(); save(); }
    el('calWeekdays').innerHTML = DC.WEEKDAYS.map(function (w) { return '<span>' + w + '</span>'; }).join('');
    readSetupHash();
    bind();
    render();
    setView('today');
    registerSW();
    setInterval(function () {
      checkReminders();
      if (ui.view === 'today') renderToday();
    }, 30000);
    setTimeout(checkReminders, 3000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
