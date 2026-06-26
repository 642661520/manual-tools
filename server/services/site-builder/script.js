var CATALOG_ID = document.documentElement.dataset.catalogId;
var CURRENT_VERSION = document.documentElement.dataset.versionLabel;
var CURRENT_CHAPTER = parseInt(document.documentElement.dataset.currentChapter || '0');

function toggleChapter(btn) {
  var ul = btn.nextElementSibling;
  ul.style.display = ul.style.display === 'none' ? '' : 'none';
}

function togglePart(btn) {
  var ul = btn.nextElementSibling;
  if (ul) ul.style.display = ul.style.display === 'none' ? '' : 'none';
}

// 监听 hash 变化，滚动到对应元素
function onHashChange() {
  var id = location.hash.slice(1);
  if (!id) return;
  var el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
window.addEventListener('hashchange', onHashChange);

// 页面加载时处理 hash
if (location.hash) {
  setTimeout(function() {
    var el = document.querySelector(location.hash);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// 展开当前章节的侧边栏
(function() {
  if (CURRENT_CHAPTER > 0) {
    var activeChapter = document.querySelector('.nav-chapter.active');
    if (activeChapter) {
      // 展开所有父级
      var parent = activeChapter.parentElement;
      while (parent) {
        if (parent.tagName === 'UL') {
          parent.style.display = '';
        }
        parent = parent.parentElement;
      }
      activeChapter.scrollIntoView({ block: 'nearest' });
    }
  }
})();

// ====== 版本切换 ======

var versionsLoaded = false;

function toggleVersionMenu() {
  var menu = document.getElementById('vsMenu');
  if (menu.classList.contains('open')) {
    menu.classList.remove('open');
    return;
  }
  if (!versionsLoaded) {
    loadVersions();
  }
  menu.classList.add('open');
}

function loadVersions() {
  var menu = document.getElementById('vsMenu');
  menu.innerHTML = '<div class="vs-loading">加载中...</div>';

  fetch('/docs/' + CATALOG_ID + '/versions.json', { credentials: 'same-origin' })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(versions) {
      versionsLoaded = true;
      renderVersionMenu(versions);
    })
    .catch(function() {
      menu.innerHTML = '<div class="vs-loading">加载失败</div>';
    });
}

function renderVersionMenu(versions) {
  var menu = document.getElementById('vsMenu');
  menu.innerHTML = '';

  if (versions.length === 0) {
    menu.innerHTML = '<div class="vs-empty">暂无版本</div>';
    return;
  }

  for (var i = 0; i < versions.length; i++) {
    var v = versions[i];
    var label = 'v' + v.version_major + '.' + v.version_minor;
    var isCurrent = label === CURRENT_VERSION;

    var item = document.createElement('div');
    item.className = 'vs-item' + (isCurrent ? ' current' : '');

    var badge = '';
    if (v.visibility === 'project_members') badge = ' <span class="vs-badge">🔒</span>';
    else if (v.visibility === 'login_required') badge = ' <span class="vs-badge">🔑</span>';

    item.innerHTML = '<span class="vs-item-label">' + escH(label) + badge + (isCurrent ? ' <span class="vs-current-tag">当前</span>' : '') + '</span>' +
      (v.change_notes ? '<span class="vs-item-notes">' + escH(v.change_notes.slice(0, 40)) + (v.change_notes.length > 40 ? '...' : '') + '</span>' : '');

    if (!isCurrent) {
      item.onclick = (function(target) {
        return function() {
          // 保持当前所在章节
          var page = CURRENT_CHAPTER > 0 ? 'ch' + String(CURRENT_CHAPTER).padStart(2, '0') + '.html' : '';
          location.href = '/docs/' + CATALOG_ID + '/' + target + '/' + page;
        };
      })(label);
    }

    menu.appendChild(item);
  }
}

function escH(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// 点击外部关闭版本菜单
document.addEventListener('click', function(e) {
  var vs = document.getElementById('versionSwitcher');
  if (vs && !vs.contains(e.target)) {
    document.getElementById('vsMenu').classList.remove('open');
  }
});
