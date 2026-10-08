/* 四级单词复习 - 单文件应用逻辑 */
const REMOTE =
  'https://raw.githubusercontent.com/15629927569-commits/cet4-vocab-review/main/vocab_bank.json'
const STATS_KEY = 'cet4_vocab_stats_v1'

let words = []
let stats = loadStats()
let mode = 'spell'
let quiz = null // {list, idx, revealed, picked, results}
let flashIdx = 0
let flipped = false
let bankQuery = ''
let bankOnlyUn = false

/* ---------- 音效（Web Audio 合成，无需素材） ---------- */
let soundOn = true
try { soundOn = localStorage.getItem('cet4_sound') !== 'off' } catch (e) {}

let audioCtx = null
function ac() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    return audioCtx
  } catch (e) { return null }
}
function tone(freq, start, dur, type, vol) {
  const c = ac()
  if (!c || !soundOn) return
  type = type || 'sine'; vol = vol || 0.16
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.value = freq
  const t0 = c.currentTime + start
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(vol, t0 + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g)
  g.connect(c.destination)
  o.start(t0)
  o.stop(t0 + dur + 0.05)
}
function playCorrect() { tone(659.25, 0, 0.35); tone(880, 0.09, 0.5) }
function playWrong() { tone(220, 0, 0.28, 'triangle', 0.2); tone(174.61, 0.1, 0.42, 'triangle', 0.18) }
function playFlip() { tone(440, 0, 0.1, 'sine', 0.05); tone(587.33, 0.06, 0.12, 'sine', 0.04) }

/* 朗读：浏览器内置语音合成（免费，优先选英语语音） */
let cachedVoice = null
function pickVoice() {
  if (cachedVoice) return cachedVoice
  if (typeof speechSynthesis === 'undefined') return null
  const vs = speechSynthesis.getVoices()
  cachedVoice =
    vs.filter(function (v) { return /en[-_]US/i.test(v.lang) && /google/i.test(v.name) })[0] ||
    vs.filter(function (v) { return /en[-_]US/i.test(v.lang) })[0] ||
    vs.filter(function (v) { return /^en/i.test(v.lang) })[0] || null
  return cachedVoice
}
if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.onvoiceschanged = function () { cachedVoice = null; pickVoice() }
}
function speakWord(text) {
  if (typeof speechSynthesis === 'undefined' || !text) return
  try {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-US'
    u.rate = 0.85
    const v = pickVoice()
    if (v) u.voice = v
    speechSynthesis.speak(u)
  } catch (e) { /* ignore */ }
}

function toggleSound() {
  soundOn = !soundOn
  try { localStorage.setItem('cet4_sound', soundOn ? 'on' : 'off') } catch (e) {}
  renderChips()
}

/* ---------- 数据 ---------- */
function loadStats() {
  try { return JSON.parse(localStorage.getItem(STATS_KEY) || '{}') } catch (e) { return {} }
}
function saveStats() { localStorage.setItem(STATS_KEY, JSON.stringify(stats)) }

function record(word, ok) {
  const cur = stats[word] || { correct: 0, wrong: 0, mastered: false }
  if (ok) cur.correct++; else cur.wrong++
  if (cur.correct >= 3 && cur.correct >= cur.wrong * 2) cur.mastered = true
  if (cur.wrong > cur.correct) cur.mastered = false
  stats[word] = cur
  saveStats()
  renderChips()
}

function shuffle(a) {
  a = a.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]))

function initData() {
  const t = Date.now()
  fetch('vocab_bank.json?t=' + t)
    .then((r) => { if (!r.ok) throw 0; return r.json() })
    .catch(() => fetch(REMOTE + '?t=' + t).then((r) => r.json()))
    .then((d) => { words = Array.isArray(d) ? d : []; render() })
    .catch(() => { document.getElementById('main').innerHTML = '<p class="empty">词库加载失败，请稍后重试</p>' })
}

/* ---------- 头部 ---------- */
function renderChips() {
  const mastered = words.filter((w) => stats[w.word] && stats[w.word].mastered).length
  const tested = words.filter((w) => stats[w.word]).length
  const el = document.getElementById('chips')
  el.innerHTML =
    '<span class="chip">词库 ' + words.length + ' 词</span>' +
    '<span class="chip">已掌握 ' + mastered + ' 词</span>' +
    '<span class="chip">学习中 ' + (tested - mastered) + ' 词</span>' +
    '<button class="chip btn" onclick="toggleSound()">' + (soundOn ? '🔊 音效开' : '🔇 音效关') + '</button>' +
    (tested > 0 ? '<button class="chip btn" onclick="resetAll()">重置进度</button>' : '')
}

function resetAll() {
  if (!confirm('确定要清空所有测验进度吗？')) return
  stats = {}
  saveStats()
  render()
}

/* ---------- 路由 ---------- */
function setMode(m) {
  mode = m
  quiz = null
  flipped = false
  document.querySelectorAll('#tabs button').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === m))
  render()
}

function render() {
  renderChips()
  const main = document.getElementById('main')
  if (words.length === 0) {
    main.innerHTML = '<div class="card"><p class="empty">词库还是空的，等今天的单词生成后再来吧</p></div>'
    return
  }
  if (mode === 'spell') renderSpell(main)
  else if (mode === 'choice') renderChoice(main)
  else if (mode === 'flash') renderFlash(main)
  else renderBank(main)
}

/* ---------- 拼写测验 ---------- */
function startQuiz(type) {
  let list
  if (type === 'choice' && words.length >= 4) {
    list = shuffle(words).slice(0, Math.min(10, words.length)).map((w) => {
      const ds = shuffle(words.filter((x) => x.word !== w.word)).slice(0, 3).map((x) => x.meaning)
      const options = shuffle([w.meaning].concat(ds))
      return { w: w, options: options, answer: options.indexOf(w.meaning) }
    })
  } else {
    list = shuffle(words).slice(0, Math.min(10, words.length)).map((w) => ({ w: w }))
  }
  quiz = { type: type, list: list, idx: 0, revealed: false, picked: null, results: [], input: '' }
}

function renderSpell(main) {
  if (!quiz || quiz.type !== 'spell') startQuiz('spell')
  const q = quiz
  if (q.idx >= q.list.length) return renderQuizResult(main, 'spell')

  const cur = q.list[q.idx].w
  let body
  if (!q.revealed) {
    body =
      '<div class="center">' +
      '<div class="q-type">根据中文写出英文单词</div>' +
      '<div class="q-word">' + esc(cur.meaning) + '</div>' +
      '<span class="tag">' + esc(cur.pos) + '</span>' +
      '</div>' +
      '<div class="row">' +
      '<input id="ans" type="text" placeholder="输入英文单词后按回车" value="' + esc(q.input) + '"' +
      ' onkeydown="if(event.key===\'Enter\')spellCheck()" oninput="quiz.input=this.value" autofocus />' +
      '<button class="act" onclick="spellCheck()">提交</button>' +
      '</div>'
  } else {
    const ok = q.results[q.results.length - 1]
    body =
      '<div class="result-word ' + (ok ? 'ok' : 'bad') + '">' +
      (ok ? '✓ 正确' : '✗ 正确答案：' + esc(cur.word)) + '<small>' + esc(cur.phonetic) + '</small>' +
      '</div>' +
      '<div class="example"><div>' + esc(cur.example) + '</div><div class="cn">' + esc(cur.exampleCn) + '</div></div>' +
      '<div class="row"><button class="act" style="width:100%" onclick="quizNext()">' +
      (q.idx + 1 === q.list.length ? '查看结果' : '下一个') + '</button></div>'
  }
  main.innerHTML = progress(q) + '<div class="card anim-in">' + body + '</div>' +
    (q.revealed
      ? '<div class="center" style="margin-top:10px"><button class="act ghost" onclick="speakWord(\'' + esc(cur.word) + '\')">🔊 朗读</button></div>'
      : '') +
    '<p class="stat-line">' + (q.revealed ? '按 Enter 继续' : '在输入框打字，Enter 提交') + '</p>'
  const inp = document.getElementById('ans')
  if (inp && !q.revealed) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length) }
}

function spellCheck() {
  const q = quiz
  if (q.revealed) return
  const inp = document.getElementById('ans')
  const val = (inp && inp.value || '').trim()
  if (!val) return
  q.input = val
  const cur = q.list[q.idx].w
  const ok = val.toLowerCase() === cur.word.toLowerCase()
  q.results.push(ok)
  q.revealed = true
  record(cur.word, ok)
  if (ok) playCorrect(); else playWrong()
  render()
}

/* ---------- 中英选择 ---------- */
function renderChoice(main) {
  if (!quiz || quiz.type !== 'choice') startQuiz('choice')
  const q = quiz
  if (q.idx >= q.list.length) return renderQuizResult(main, 'choice')

  const cur = q.list[q.idx]
  const opts = cur.options.map((o, i) => {
    let cls = 'opt'
    if (q.picked !== null) {
      if (i === cur.answer) cls += ' correct'
      else if (i === q.picked) cls += ' wrong'
      else cls += ' dim'
    }
    return '<button class="' + cls + '"' + (q.picked !== null ? ' disabled' : '') +
      ' onclick="choicePick(' + i + ')">' + String.fromCharCode(65 + i) + '. ' + esc(o) + '</button>'
  }).join('')

  let tail = ''
  if (q.picked !== null) {
    tail =
      '<div class="example"><div>' + esc(cur.w.example) + '</div><div class="cn">' + esc(cur.w.exampleCn) + '</div></div>' +
      '<div class="row"><button class="act" style="width:100%" onclick="quizNext()">' +
      (q.idx + 1 === q.list.length ? '查看结果' : '下一题') + '</button></div>'
  }
  main.innerHTML = progress(q) +
    '<div class="card anim-in">' +
    '<div class="center">' +
    '<div class="q-type">选出正确的中文释义</div>' +
    '<div class="q-word" style="font-size:30px">' + esc(cur.w.word) + '</div>' +
    '<div class="q-phon">' + esc(cur.w.phonetic) + '</div>' +
    '<div style="margin-top:6px"><button class="act ghost" onclick="speakWord(\'' + esc(cur.w.word) + '\')">🔊 朗读</button></div>' +
    '</div>' +
    '<div style="margin-top:16px">' + opts + '</div>' +
    tail +
    '</div>' +
    '<p class="stat-line">' + (q.picked === null ? '按 A-D 或 1-4 快速选择' : '按 Enter 继续') + '</p>'
}

function choicePick(i) {
  const q = quiz
  if (q.picked !== null) return
  q.picked = i
  const cur = q.list[q.idx]
  const ok = i === cur.answer
  q.results.push(ok)
  record(cur.w.word, ok)
  if (ok) playCorrect(); else playWrong()
  render()
}

function quizNext() {
  quiz.idx++
  quiz.revealed = false
  quiz.picked = null
  quiz.input = ''
  render()
}

function renderQuizResult(main, type) {
  const q = quiz
  const score = q.results.filter(Boolean).length
  const full = score === q.list.length
  const emoji = type === 'spell' ? (full ? '🎉' : score >= 7 ? '👍' : '💪') : (full ? '🎉' : '👍')
  const msg = type === 'spell'
    ? (full ? '完美！全部拼写正确' : score >= 7 ? '不错，继续巩固出错的单词' : '别灰心，去闪卡模式多看看再来')
    : (full ? '全部答对，太棒了' : '继续加油，多刷几遍就熟了')
  main.innerHTML =
    '<div class="card anim-pop">' +
    '<div class="center" style="font-size:44px">' + emoji + '</div>' +
    '<div class="score">' + score + ' / ' + q.list.length + '</div>' +
    '<p class="muted">' + msg + '</p>' +
    '<div class="center-btn"><button class="act" onclick="startQuiz(\'' + type + '\');render()">再来一轮</button></div>' +
    '<p class="stat-line">按 Enter 再来一轮</p>' +
    '</div>'
}

function progress(q) {
  return '<div class="progress-row">' +
    '<div class="bar"><div style="width:' + (q.idx / q.list.length) * 100 + '%"></div></div>' +
    '<span>第 ' + Math.min(q.idx + 1, q.list.length) + ' / ' + q.list.length + ' 题</span>' +
    '</div>'
}

/* ---------- 闪卡 ---------- */
function flipCard() {
  flipped = !flipped
  playFlip()
  render()
}

function renderFlash(main) {
  const sorted = words.slice().sort((a, b) => (a.date < b.date ? 1 : -1))
  flashIdx = Math.max(0, Math.min(flashIdx, sorted.length - 1))
  const cur = sorted[flashIdx]
  const st = stats[cur.word]
  const masteredCnt = sorted.filter((w) => stats[w.word] && stats[w.word].mastered).length

  const front =
    '<div class="flash-word">' + esc(cur.word) + '</div>' +
    '<div class="q-phon" style="font-size:18px">' + esc(cur.phonetic) + '</div>' +
    '<button class="act ghost" style="margin-top:8px" onclick="event.stopPropagation();speakWord(\'' + esc(cur.word) + '\')">🔊 朗读</button>' +
    '<div class="hint">点击卡片或按空格查看释义</div>'
  const back =
    '<div class="flash-mean"><span class="tag">' + esc(cur.pos) + '</span> ' + esc(cur.meaning) + '</div>' +
    '<div class="flash-freq">' + esc(cur.frequency) + '</div>' +
    '<div class="example" style="width:100%"><div>' + esc(cur.example) + '</div><div class="cn">' + esc(cur.exampleCn) + '</div></div>' +
    '<button class="act ghost" style="margin-top:10px" onclick="event.stopPropagation();speakWord(\'' + esc(cur.example) + '\')">🔊 朗读例句</button>'

  main.innerHTML =
    '<div class="progress-row" style="justify-content:space-between">' +
    '<span>第 ' + (flashIdx + 1) + ' / ' + sorted.length + ' 张</span><span>' + masteredCnt + ' 张已掌握</span>' +
    '</div>' +
    '<div class="flip-scene"><div class="flip-card' + (flipped ? ' flipped' : '') + '" onclick="flipCard()">' +
    '<div class="card flip-face">' + front + '</div>' +
    '<div class="card flip-face flip-back">' + back + '</div>' +
    '</div></div>' +
    '<div class="nav-row">' +
    '<button class="act ghost" onclick="flashGo(-1)"' + (flashIdx === 0 ? ' disabled' : '') + '>← 上一张</button>' +
    '<div class="grp">' +
    '<button class="act bad" onclick="flashMark(false)">还不熟</button>' +
    '<button class="act good" onclick="flashMark(true)">认识了</button>' +
    '</div>' +
    '<button class="act ghost" onclick="flashGo(1)"' + (flashIdx === sorted.length - 1 ? ' disabled' : '') + '>下一张 →</button>' +
    '</div>' +
    '<p class="stat-line">← → 切换卡片 · 空格翻面</p>' +
    (st ? '<p class="stat-line">该单词：答对 ' + st.correct + ' 次 · 答错 ' + st.wrong + ' 次' +
      (st.mastered ? ' · 已掌握 ✅' : '') + '</p>' : '')
}

function flashGo(d) {
  flashIdx += d
  flipped = false
  render()
}
function flashMark(ok) {
  const sorted = words.slice().sort((a, b) => (a.date < b.date ? 1 : -1))
  record(sorted[flashIdx].word, ok)
  if (ok) playCorrect(); else playWrong()
  flashGo(1)
}

/* ---------- 词库 ---------- */
function renderBank(main) {
  const sorted = words.slice().sort((a, b) => (a.date < b.date ? 1 : -1))
  const q = bankQuery.trim().toLowerCase()
  const filtered = sorted.filter((w) => {
    const mq = !q || w.word.toLowerCase().includes(q) || w.meaning.toLowerCase().includes(q)
    const mm = !bankOnlyUn || !(stats[w.word] && stats[w.word].mastered)
    return mq && mm
  })

  const cards = filtered.map((w) => {
    const st = stats[w.word]
    const tag = st && st.mastered
      ? '<span class="tag ok">已掌握</span>'
      : st ? '<span class="tag">学习中</span>' : '<span class="tag">未测试</span>'
    return '<div class="wcard">' +
      '<div class="w-head">' +
      '<b>' + esc(w.word) + '</b><span class="phon">' + esc(w.phonetic) + '</span>' +
      '<button class="chip btn" onclick="speakWord(\'' + esc(w.word) + '\')">🔊</button>' +
      '<span class="tag">' + esc(w.pos) + '</span>' + tag +
      '<span class="date">' + esc(w.date) + '</span>' +
      '</div>' +
      '<div class="w-mean">' + esc(w.meaning) + '</div>' +
      '<div class="example"><div>' + esc(w.example) + '</div><div class="cn">' + esc(w.exampleCn) + '</div></div>' +
      '<div class="w-freq">词频：' + esc(w.frequency) + '</div>' +
      '</div>'
  }).join('')

  main.innerHTML =
    '<div class="search-row">' +
    '<input type="text" style="text-align:left;font-size:14px" placeholder="搜索单词或中文释义…"' +
    ' value="' + esc(bankQuery) + '" oninput="bankQuery=this.value;renderBank(document.getElementById(\'main\'))" />' +
    '<label><input type="checkbox"' + (bankOnlyUn ? ' checked' : '') + ' onchange="bankOnlyUn=this.checked;render()" /> 只看未掌握</label>' +
    '</div>' +
    '<div class="count">共 ' + filtered.length + ' 个单词</div>' +
    (cards || '<p class="empty">没有匹配的单词</p>')
}

/* ---------- 快捷键 ---------- */
document.addEventListener('keydown', (e) => {
  if (!words.length) return
  const tag = (e.target && e.target.tagName || '').toLowerCase()
  if (tag === 'input' || tag === 'textarea') return
  if (mode === 'spell' && quiz) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (quiz.idx >= quiz.list.length) { startQuiz('spell'); render() }
    else if (quiz.revealed) quizNext()
  } else if (mode === 'choice' && quiz) {
    if (quiz.idx >= quiz.list.length) {
      if (e.key === 'Enter') { e.preventDefault(); startQuiz('choice'); render() }
      return
    }
    if (quiz.picked === null) {
      const map = { a: 0, b: 1, c: 2, d: 3, '1': 0, '2': 1, '3': 2, '4': 3 }
      const i = map[e.key.toLowerCase()]
      const cur = quiz.list[quiz.idx]
      if (i !== undefined && cur && i < cur.options.length) { e.preventDefault(); choicePick(i) }
    } else if (e.key === 'Enter') { e.preventDefault(); quizNext() }
  } else if (mode === 'flash') {
    if (e.key === 'ArrowLeft') { e.preventDefault(); flashGo(-1) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); flashGo(1) }
    else if (e.key === ' ') { e.preventDefault(); flipCard() }
  }
})

/* ---------- 启动 ---------- */
document.getElementById('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button')
  if (b) setMode(b.dataset.mode)
})
initData()