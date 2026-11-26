// Public pages: the group of the page URL (?group=<slug>) is carried into every /api call, and the
// page shows the group's own name, meeting day and time instead of fixed text.
// A page opened without ?group= is a legacy link and talks to group 1 (the server decides that).
(function () {
  var g = new URLSearchParams(location.search).get('group');
  if (g) {
    var orig = window.fetch;
    window.fetch = function (url, opts) {
      if (typeof url === 'string' && url.indexOf('/api/') === 0 && !/[?&]group=/.test(url)) {
        url += (url.indexOf('?') < 0 ? '?' : '&') + 'group=' + encodeURIComponent(g);
      }
      return orig.call(this, url, opts);
    };
  }

  var DAYS = ['Воскресенья', 'Понедельники', 'Вторники', 'Среды', 'Четверги', 'Пятницы', 'Субботы'];
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  window.GROUP_NAME = '';

  window.groupConfig = fetch('/api/settings').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
    .then(function (cfg) {
      var name = cfg.group_name || '';
      window.GROUP_NAME = name;
      function apply() {
        if (name) {
          document.querySelectorAll('[data-group-logo]').forEach(function (el) {
            var up = el.getAttribute('data-group-logo') === 'upper', suffix = el.getAttribute('data-suffix') || '';
            var m = name.match(/^(\S+)\s+(.+)$/);
            var cls = el.getAttribute('data-span-class') ? ' class="' + el.getAttribute('data-span-class') + '"' : '';
            el.innerHTML = m ? esc(m[1]) + ' <span' + cls + '>' + esc(up ? m[2].toUpperCase() : m[2]) + esc(suffix) + '</span>' : esc(up ? name.toUpperCase() : name) + esc(suffix);
          });
          document.querySelectorAll('[data-group-name]').forEach(function (el) { el.textContent = name; });
          document.title = document.title.replace(/BNI\s*SYNERGY/i, name);
        }
        var hasW = cfg.meeting_weekday !== undefined && cfg.meeting_weekday !== null && cfg.meeting_weekday !== '';
        document.querySelectorAll('[data-meeting-weekday]').forEach(function (el) {
          if (hasW) el.textContent = DAYS[Number(cfg.meeting_weekday)]; else el.style.display = 'none';
        });
        document.querySelectorAll('[data-meeting-time]').forEach(function (el) {
          if (cfg.meeting_time) el.textContent = cfg.meeting_time.replace(/^0/, ''); else el.style.display = 'none';
        });
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
      return cfg;
    });
})();
