// ====== 全文搜索 ======

var _searchIndex = null
var _searchLoading = false
var _searchCallbacks = []
var _searchResults = []
var _searchSelected = -1
var _searchDebounce = null

function loadSearchIndex(cb) {
  if (_searchIndex) {
    cb(_searchIndex)
    return
  }
  _searchCallbacks.push(cb)
  if (_searchLoading) return
  _searchLoading = true

  fetch('./search-index.json', { credentials: 'same-origin' })
    .then(function (r) {
      return r.json()
    })
    .then(function (data) {
      _searchIndex = data.entries || []
      var cbs = _searchCallbacks
      _searchCallbacks = []
      _searchLoading = false
      for (var i = 0; i < cbs.length; i++) cbs[i](_searchIndex)
    })
    .catch(function () {
      _searchLoading = false
      _searchCallbacks = []
      var el = document.getElementById('searchResults')
      if (el) el.innerHTML = '<div class="vp-search-empty">搜索索引加载失败，请刷新页面后重试</div>'
    })
}

function openSearch() {
  var overlay = document.getElementById('searchOverlay')
  if (!overlay) return
  overlay.style.display = 'flex'
  _searchResults = []
  _searchSelected = -1
  var input = document.getElementById('searchInput')
  if (input) {
    input.value = ''
    setTimeout(function () {
      input.focus()
    }, 50)
  }
  var results = document.getElementById('searchResults')
  if (results) results.innerHTML = ''
  var footer = document.getElementById('searchFooter')
  if (footer) footer.innerHTML = ''
  document.body.style.overflow = 'hidden'
}

function closeSearch() {
  var overlay = document.getElementById('searchOverlay')
  if (overlay) overlay.style.display = 'none'
  if (_searchDebounce) {
    clearTimeout(_searchDebounce)
    _searchDebounce = null
  }
  document.body.style.overflow = ''
}

function doSearch(query) {
  var q = query.replace(/^\s+|\s+$/g, '')
  if (!q) {
    _searchResults = []
    _searchSelected = -1
    renderResults()
    return
  }

  loadSearchIndex(function (entries) {
    var terms = q
      .toLowerCase()
      .split(/\s+/)
      .filter(function (t) {
        return t.length > 0
      })
    if (terms.length === 0) {
      _searchResults = []
      _searchSelected = -1
      renderResults()
      return
    }

    var scored = []
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i]
      var score = scoreEntry(entry, terms, q.toLowerCase())
      if (score > 0) scored.push({ entry: entry, score: score })
    }

    scored.sort(function (a, b) {
      return b.score - a.score
    })
    _searchResults = scored.slice(0, 20)
    _searchSelected = -1
    renderResults()
  })
}

function scoreEntry(entry, terms, fullQuery) {
  var text = (entry.text || '').toLowerCase()
  var chapter = (entry.chapter || '').toLowerCase()
  var section = (entry.section || '').toLowerCase()

  var score = 0
  var allMatched = true

  for (var i = 0; i < terms.length; i++) {
    var term = terms[i]
    var textCount = countMatches(text, term)
    var titleCount = countMatches(chapter, term) + countMatches(section, term)

    if (textCount === 0 && titleCount === 0) {
      allMatched = false
      break
    }

    score += textCount * 1
    score += titleCount * 10
  }

  if (!allMatched) return 0

  // 完整短语匹配加分
  if (text.indexOf(fullQuery) >= 0) score += 30
  if (chapter.indexOf(fullQuery) >= 0) score += 20
  if (section.indexOf(fullQuery) >= 0) score += 20

  // 所有词都匹配加分
  if (terms.length > 1) score += 15

  // 匹配位置靠前轻微加分（最大 +5）
  var firstPos = text.length
  for (var j = 0; j < terms.length; j++) {
    var p = text.indexOf(terms[j])
    if (p >= 0 && p < firstPos) firstPos = p
  }
  if (firstPos < text.length) score += Math.max(0, 5 - Math.floor(firstPos / 100))

  return score
}

function countMatches(text, term) {
  if (!term) return 0
  var count = 0
  var pos = 0
  while ((pos = text.indexOf(term, pos)) >= 0) {
    count++
    pos += term.length
  }
  return count
}

function generateSnippet(text, query, maxLen) {
  maxLen = maxLen || 200
  var lower = text.toLowerCase()
  var q = query.toLowerCase()
  var terms = q.split(/\s+/).filter(function (t) {
    return t.length > 0
  })
  if (terms.length === 0) return escHtml(text.slice(0, maxLen))

  // 收集所有匹配位置
  var allPositions = []
  for (var i = 0; i < terms.length; i++) {
    var pos = 0
    var t = terms[i]
    while ((pos = lower.indexOf(t, pos)) >= 0) {
      allPositions.push(pos)
      pos += t.length
    }
  }
  allPositions.sort(function (a, b) {
    return a - b
  })

  if (allPositions.length === 0) {
    return escHtml(text.length > maxLen ? text.slice(0, maxLen) + '...' : text)
  }

  // 以第一个匹配位置为锚点，确保尽量多的匹配在窗口内
  var anchor = allPositions[0]
  var half = Math.floor(maxLen / 2)
  var start = Math.max(0, anchor - half)
  var end = Math.min(text.length, anchor + half)

  // 扩展窗口以包含更多邻近匹配（在 maxLen * 1.5 范围内）
  var maxEnd = Math.min(text.length, start + Math.floor(maxLen * 1.5))
  for (var j = 1; j < allPositions.length && end < maxEnd; j++) {
    if (allPositions[j] > end + 20) break
    if (allPositions[j] < end) continue
    end = Math.min(maxEnd, allPositions[j] + terms[0].length + half)
  }

  // 在空格处微调边界（对中文无影响）
  if (start > 0) {
    var spaceBefore = text.lastIndexOf(' ', start + 10)
    if (spaceBefore >= 0 && spaceBefore < anchor) start = spaceBefore + 1
  }
  if (end < text.length) {
    var spaceAfter = text.indexOf(' ', end - 10)
    if (spaceAfter > anchor && spaceAfter < end + 20) end = spaceAfter
  }

  var snippet = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '')

  // 高亮所有匹配词
  var html = escHtml(snippet)
  for (var k = 0; k < terms.length; k++) {
    var escapedTerm = escHtml(terms[k])
    if (escapedTerm) {
      var regex = new RegExp(escapedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      html = html.replace(regex, '<mark>$&</mark>')
    }
  }

  return html
}

function highlightTitle(title, terms) {
  if (!title) return ''
  var html = escHtml(title)
  for (var i = 0; i < terms.length; i++) {
    var escapedTerm = escHtml(terms[i])
    if (escapedTerm) {
      var regex = new RegExp(escapedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      html = html.replace(regex, '<mark>$&</mark>')
    }
  }
  return html
}

function escHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderResults() {
  var el = document.getElementById('searchResults')
  var footer = document.getElementById('searchFooter')
  if (!el) return

  if (_searchLoading && !_searchIndex) {
    el.innerHTML = '<div class="vp-search-empty">加载搜索索引中...</div>'
    if (footer) footer.innerHTML = ''
    return
  }

  if (_searchResults.length === 0) {
    var input = document.getElementById('searchInput')
    if (input && input.value.trim()) {
      el.innerHTML = '<div class="vp-search-empty">未找到相关结果</div>'
    } else {
      el.innerHTML = ''
    }
    if (footer) footer.innerHTML = ''
    return
  }

  var query = ''
  var input = document.getElementById('searchInput')
  if (input) query = input.value.trim()
  var q = query.toLowerCase()
  var terms = q.split(/\s+/).filter(function (t) {
    return t.length > 0
  })

  var html = ''
  for (var i = 0; i < _searchResults.length; i++) {
    var r = _searchResults[i]
    var e = r.entry
    var snippet = generateSnippet(e.text, query)
    var titleHtml = highlightTitle(e.chapter, terms)
    if (e.section)
      titleHtml +=
        ' <span class="vp-search-result-sep">&middot;</span> ' + highlightTitle(e.section, terms)
    var activeClass = i === _searchSelected ? ' active' : ''

    html +=
      '<div class="vp-search-result-item' +
      activeClass +
      '" data-index="' +
      i +
      '" onclick="navigateResult(' +
      i +
      ')">' +
      '<div class="vp-search-result-title">' +
      titleHtml +
      '</div>' +
      '<div class="vp-search-result-snippet">' +
      snippet +
      '</div>' +
      '</div>'
  }
  el.innerHTML = html

  if (footer) {
    var total = _searchResults.length
    footer.innerHTML = '共 ' + total + ' 条结果'
  }

  // 滚动到选中项
  if (_searchSelected >= 0) {
    var items = el.querySelectorAll('.vp-search-result-item')
    if (items[_searchSelected]) items[_searchSelected].scrollIntoView({ block: 'nearest' })
  }
}

function navigateResult(index) {
  if (index < 0 || index >= _searchResults.length) return
  var r = _searchResults[index]
  closeSearch()
  // 判断是否同一页面：相同 ch 的 hash 用 hash 导航，不同页用 location.href
  if (r.entry.chNum === CURRENT_CHAPTER && r.entry.section) {
    location.hash = r.entry.url.split('#')[1] || ''
  } else {
    location.href = r.entry.url
  }
}

// ====== 搜索框键盘事件 ======

document.addEventListener('DOMContentLoaded', function () {
  var input = document.getElementById('searchInput')
  if (!input) return

  input.addEventListener('input', function () {
    if (_searchDebounce) clearTimeout(_searchDebounce)
    var val = input.value
    _searchDebounce = setTimeout(function () {
      doSearch(val)
    }, 200)
  })

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeSearch()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (_searchResults.length === 0) return
      _searchSelected = Math.min(_searchSelected + 1, _searchResults.length - 1)
      renderResults()
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      _searchSelected = Math.max(_searchSelected - 1, -1)
      renderResults()
      return
    }
    if (e.key === 'Enter' && _searchSelected >= 0) {
      e.preventDefault()
      navigateResult(_searchSelected)
    }
  })
})

// ====== 全局快捷键 ======

document.addEventListener('keydown', function (e) {
  var overlay = document.getElementById('searchOverlay')
  var isOpen = overlay && overlay.style.display === 'flex'

  // Esc 关闭搜索
  if (e.key === 'Escape' && isOpen) {
    e.preventDefault()
    closeSearch()
    return
  }

  // Ctrl+K / Cmd+K 打开搜索
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    openSearch()
    return
  }

  // / 键打开搜索（不在输入框中时）
  if (e.key === '/' && !isOpen) {
    var tag = document.activeElement ? document.activeElement.tagName : ''
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !document.activeElement.isContentEditable) {
      e.preventDefault()
      openSearch()
    }
  }
})

// 点击遮罩关闭
document.addEventListener('click', function (e) {
  var overlay = document.getElementById('searchOverlay')
  if (overlay && e.target === overlay) {
    closeSearch()
  }
})
