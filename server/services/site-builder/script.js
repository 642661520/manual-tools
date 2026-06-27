// ====== 静态站点客户端脚本 ======

var CATALOG_ID = document.documentElement.dataset.catalogId
var CURRENT_VERSION = document.documentElement.dataset.versionLabel
var CURRENT_CHAPTER = parseInt(document.documentElement.dataset.currentChapter || '0')

// ====== Sidebar: 展开/折叠 ======

function toggleChapter(btn) {
  var ul = btn.nextElementSibling
  if (!ul) return
  var isHidden = ul.style.display === 'none'
  ul.style.display = isHidden ? '' : 'none'
  btn.setAttribute('aria-expanded', String(isHidden))
}

function togglePart(btn) {
  var li = btn.parentElement
  if (!li) return
  var ul = li.querySelector('.vp-nav-chapters')
  var isCollapsed = li.classList.contains('collapsed')
  if (isCollapsed) {
    li.classList.remove('collapsed')
    if (ul) ul.style.display = ''
    btn.setAttribute('aria-expanded', 'true')
  } else {
    li.classList.add('collapsed')
    if (ul) ul.style.display = 'none'
    btn.setAttribute('aria-expanded', 'false')
  }
}

// ====== Mobile Sidebar ======

function toggleMobileSidebar() {
  var sidebar = document.getElementById('vpSidebar')
  var backdrop = document.getElementById('sidebarBackdrop')
  if (!sidebar) return
  var isOpen = sidebar.classList.contains('open')
  if (isOpen) {
    closeMobileSidebar()
  } else {
    sidebar.classList.add('open')
    if (backdrop) backdrop.classList.add('show')
    document.body.style.overflow = 'hidden'
  }
}

function closeMobileSidebar() {
  var sidebar = document.getElementById('vpSidebar')
  var backdrop = document.getElementById('sidebarBackdrop')
  if (sidebar) sidebar.classList.remove('open')
  if (backdrop) backdrop.classList.remove('show')
  document.body.style.overflow = ''
}

// ====== Nav Scroll Shadow ======

;(function () {
  var nav = document.getElementById('vpNav')
  if (!nav) return
  var lastScrollY = 0
  function onScroll() {
    var y = window.scrollY
    if (y > 0) {
      nav.classList.add('scrolled')
    } else {
      nav.classList.remove('scrolled')
    }
    lastScrollY = y
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})()

// ====== Hash 导航 ======

function onHashChange() {
  var id = location.hash.slice(1)
  if (!id) return
  var el = document.getElementById(id)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}
window.addEventListener('hashchange', onHashChange)

// 页面加载时处理 hash
if (location.hash) {
  setTimeout(function () {
    var el = document.querySelector(location.hash)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, 150)
}

// ====== TOC 链接点击平滑滚动 ======

document.addEventListener('click', function (e) {
  var link = e.target.closest('.vp-toc-link')
  if (!link) return
  e.preventDefault()
  var id = link.getAttribute('data-toc-id')
  if (!id) return
  var el = document.getElementById(id)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // 更新 URL hash 但不触发默认跳转
    history.replaceState(null, '', '#' + id)
    setActiveTocItem(id)
  }
})

// ====== TOC 活动项追踪 (IntersectionObserver) ======

var _tocItems = []
var _tocActiveId = null
var _observer = null

function initTocObserver() {
  // 收集所有 TOC link 对应的目标元素
  var links = document.querySelectorAll('.vp-toc-link')
  if (links.length === 0) return

  _tocItems = []
  var seenIds = {}
  links.forEach(function (link) {
    var id = link.getAttribute('data-toc-id')
    if (!id || seenIds[id]) return
    seenIds[id] = true
    var el = document.getElementById(id)
    if (el) {
      _tocItems.push({ id: id, el: el })
    }
  })

  if (_tocItems.length === 0) return

  _observer = new IntersectionObserver(
    function (entries) {
      // 找出当前在视口中且最靠前的 heading
      var visibleTop = Infinity
      var visibleId = null

      entries.forEach(function (entry) {
        if (entry.isIntersecting && entry.boundingClientRect.top < visibleTop) {
          visibleTop = entry.boundingClientRect.top
          visibleId = entry.target.id
        }
      })

      if (visibleId) {
        setActiveTocItem(visibleId)
      } else {
        // 所有 heading 都不在视口中：找出刚好在视口上方最近的那个
        var closestAbove = null
        var closestDist = Infinity
        _tocItems.forEach(function (item) {
          var rect = item.el.getBoundingClientRect()
          if (rect.top <= 120 && Math.abs(rect.top - 120) < closestDist) {
            closestDist = Math.abs(rect.top - 120)
            closestAbove = item.id
          }
        })
        if (closestAbove) setActiveTocItem(closestAbove)
      }
    },
    {
      rootMargin: '-80px 0px -60% 0px',
      threshold: 0,
    },
  )

  _tocItems.forEach(function (item) {
    _observer.observe(item.el)
  })
}

function setActiveTocItem(id) {
  if (_tocActiveId === id) return
  _tocActiveId = id

  // 更新 TOC 链接状态
  var links = document.querySelectorAll('.vp-toc-link')
  links.forEach(function (link) {
    var linkId = link.getAttribute('data-toc-id')
    if (linkId === id) {
      link.classList.add('active')
      // 滚动到可见区域
      link.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    } else {
      link.classList.remove('active')
    }
  })
}

// ====== Sidebar Active Section Tracking ======

function updateSidebarActive() {
  if (CURRENT_CHAPTER <= 0) return

  var sectionLinks = document.querySelectorAll('.vp-nav-section-link[data-id]')
  if (sectionLinks.length === 0) return

  // 找出当前可见的 section
  var activeId = null
  var closestTop = Infinity

  sectionLinks.forEach(function (link) {
    var id = link.getAttribute('data-id')
    var el = document.getElementById(id)
    if (!el) return
    var rect = el.getBoundingClientRect()
    // section 刚好在导航栏下方或更上方但最接近
    if (rect.top <= 120 && Math.abs(rect.top - 120) < closestTop) {
      closestTop = Math.abs(rect.top - 120)
      activeId = id
    }
  })

  sectionLinks.forEach(function (link) {
    if (link.getAttribute('data-id') === activeId) {
      link.classList.add('active')
    } else {
      link.classList.remove('active')
    }
  })
}

// 合并滚动监听
var _scrollTicking = false
window.addEventListener(
  'scroll',
  function () {
    if (!_scrollTicking) {
      requestAnimationFrame(function () {
        updateSidebarActive()
        _scrollTicking = false
      })
      _scrollTicking = true
    }
  },
  { passive: true },
)

// ====== 初始展开和激活 ======

;(function initSidebar() {
  if (CURRENT_CHAPTER <= 0) return

  // 展开当前章节所在的 Part 和章节
  var activeChapter = document.querySelector('.vp-nav-chapter.active')
  if (activeChapter) {
    // 展开所有父级
    var parent = activeChapter.parentElement
    while (parent) {
      if (parent.classList.contains('vp-nav-chapters')) {
        parent.style.display = ''
        // 也展开对应的 Part
        var partLi = parent.closest('.vp-nav-part')
        if (partLi) {
          partLi.classList.remove('collapsed')
          var partBtn = partLi.querySelector('.vp-nav-part-btn')
          if (partBtn) partBtn.setAttribute('aria-expanded', 'true')
        }
      }
      parent = parent.parentElement
    }
    // 滚动到可见位置
    setTimeout(function () {
      activeChapter.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 200)
  }

  // 初始化 TOC observer
  initTocObserver()
  // 初始 sidebar 激活状态
  updateSidebarActive()
})()

// ====== 本地搜索（内联 search.js 提供） ======

// 搜索框 / 快捷键处理已移至 search.js

// ====== 版本切换 ======

var versionsLoaded = false

function toggleVersionMenu() {
  var btn = document.getElementById('vsBtn')
  var menu = document.getElementById('vsMenu')
  if (!menu) return

  if (menu.classList.contains('open')) {
    menu.classList.remove('open')
    if (btn) btn.classList.remove('open')
    return
  }
  if (!versionsLoaded) {
    loadVersions()
  }
  menu.classList.add('open')
  if (btn) btn.classList.add('open')
}

function loadVersions() {
  var menu = document.getElementById('vsMenu')
  if (!menu) return
  menu.innerHTML = '<div class="vp-vs-loading">加载中...</div>'

  fetch('/docs/' + CATALOG_ID + '/versions.json', { credentials: 'same-origin' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return r.json()
    })
    .then(function (versions) {
      versionsLoaded = true
      renderVersionMenu(versions)
    })
    .catch(function () {
      menu.innerHTML = '<div class="vp-vs-loading">加载失败</div>'
    })
}

function renderVersionMenu(versions) {
  var menu = document.getElementById('vsMenu')
  if (!menu) return
  menu.innerHTML = ''

  if (versions.length === 0) {
    menu.innerHTML = '<div class="vp-vs-empty">暂无版本</div>'
    return
  }

  for (var i = 0; i < versions.length; i++) {
    var v = versions[i]
    var label = 'v' + v.version_major + '.' + v.version_minor
    var isCurrent = label === CURRENT_VERSION

    var item = document.createElement('div')
    item.className = 'vp-vs-item' + (isCurrent ? ' current' : '')

    var badge = ''
    if (v.visibility === 'project_members') badge = ' <span class="vp-vs-item-badge">🔒</span>'
    else if (v.visibility === 'login_required') badge = ' <span class="vp-vs-item-badge">🔑</span>'

    item.innerHTML =
      '<span class="vp-vs-item-label">' +
      escH(label) +
      badge +
      (isCurrent ? ' <span class="vp-vs-item-current-tag">当前</span>' : '') +
      '</span>' +
      (v.change_notes
        ? '<span class="vp-vs-item-notes">' +
          escH(v.change_notes.slice(0, 40)) +
          (v.change_notes.length > 40 ? '...' : '') +
          '</span>'
        : '')

    if (!isCurrent) {
      item.onclick = (function (target) {
        return function () {
          var page =
            CURRENT_CHAPTER > 0 ? 'ch' + String(CURRENT_CHAPTER).padStart(2, '0') + '.html' : ''
          location.href = '/docs/' + CATALOG_ID + '/' + target + '/' + page
        }
      })(label)
    }

    menu.appendChild(item)
  }
}

function escH(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 点击外部关闭版本菜单
document.addEventListener('click', function (e) {
  var vs = document.getElementById('versionSwitcher')
  if (vs && !vs.contains(e.target)) {
    var menu = document.getElementById('vsMenu')
    if (menu) menu.classList.remove('open')
    var btn = document.getElementById('vsBtn')
    if (btn) btn.classList.remove('open')
  }
})

// ====== 响应式：宽屏切换时关闭移动端侧边栏 ======

var _resizeDebounce = null
window.addEventListener('resize', function () {
  if (_resizeDebounce) clearTimeout(_resizeDebounce)
  _resizeDebounce = setTimeout(function () {
    if (window.innerWidth > 960) {
      closeMobileSidebar()
    }
  }, 200)
})
