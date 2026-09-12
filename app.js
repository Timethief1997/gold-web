const RECORDS_KEY = 'gold_web_records'
const PRICE_KEY = 'gold_web_manual_price'
const AUTO_REFRESH_KEY = 'gold_web_auto_refresh_interval'
const HOLDING_KEY = 'gold_web_holding'
const DEFAULT_PRICE = 560
const OUNCE_TO_GRAM = 31.1034768

let currentPrice = DEFAULT_PRICE
let priceSource = '演示'
let comexData = null
let londonData = null
let usdCnyRate = 0
let auHistoryData = null
let londonHistoryData = null
let comexHistoryData = null
let priceChart = null

// ============ Storage ============
function getRecords() {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY)) || []
  } catch {
    return []
  }
}

function saveRecords(records) {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records))
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6)
}

function addRecord(record) {
  const records = getRecords()
  records.unshift({ id: generateId(), ...record, createAt: Date.now() })
  saveRecords(records)
}

function updateRecord(id, record) {
  const records = getRecords()
  const index = records.findIndex(item => item.id === id)
  if (index === -1) return
  records[index] = { ...records[index], ...record }
  saveRecords(records)
}

function deleteRecord(id) {
  saveRecords(getRecords().filter(item => item.id !== id))
}

function getManualPrice() {
  return parseFloat(localStorage.getItem(PRICE_KEY)) || 0
}

function setManualPrice(price) {
  localStorage.setItem(PRICE_KEY, price)
}

function getAutoRefreshInterval() {
  // 默认开启 30 秒自动刷新；用户显式存过值（含"关闭"=0）则尊重用户选择
  const raw = localStorage.getItem(AUTO_REFRESH_KEY)
  if (raw === null) return 30
  return parseInt(raw) || 0
}

function setAutoRefreshInterval(interval) {
  localStorage.setItem(AUTO_REFRESH_KEY, interval)
}

// 持仓登记（直接录入当前持仓快照，不依赖逐笔交易）
function getHolding() {
  try {
    return JSON.parse(localStorage.getItem(HOLDING_KEY)) || null
  } catch {
    return null
  }
}

function saveHolding(holding) {
  localStorage.setItem(HOLDING_KEY, JSON.stringify(holding))
}

function clearHolding() {
  localStorage.removeItem(HOLDING_KEY)
}

// 将一笔交易叠加到持仓状态上（买入加仓、卖出减仓并确认已实现盈亏）
function applyTrade(state, item) {
  const weight = Number(item.weight) || 0
  const amount = Number(item.amount) || 0
  const fee = Number(item.fee) || 0
  if (item.type === 'buy') {
    state.weight += weight
    state.cost += amount + fee
  } else {
    const avg = state.weight > 0 ? state.cost / state.weight : 0
    const sold = Math.min(weight, state.weight)
    const costBasis = avg * sold
    state.weight -= sold
    state.cost -= costBasis
    state.realized += (amount - fee) - costBasis
  }
}

function getSummary(price) {
  const holding = getHolding()
  const records = getRecords()
  const state = { weight: 0, cost: 0, realized: 0 }

  if (holding) {
    // 持仓登记为基准：登记前的历史交易已并入登记数据，只叠加登记之后的交易
    state.weight = Number(holding.weight) || 0
    state.cost = Number(holding.cost) || 0
    state.realized = Number(holding.realizedProfit) || 0
    const baseTime = Number(holding.createdAt) || 0
    records.forEach(item => {
      if ((item.createAt || 0) > baseTime) applyTrade(state, item)
    })
  } else {
    // 无登记：沿用全部逐笔交易累加，卖出自动确认已实现盈亏
    records.forEach(item => applyTrade(state, item))
  }

  state.weight = Math.max(0, state.weight)
  state.cost = Math.max(0, state.cost)

  const avgCost = state.weight > 0 ? state.cost / state.weight : 0
  const marketValue = state.weight * (price || 0)
  const profit = marketValue - state.cost
  const profitRate = state.cost > 0 ? (profit / state.cost) * 100 : 0
  const totalProfit = profit + state.realized
  const totalProfitRate = state.cost > 0 ? (totalProfit / state.cost) * 100 : 0

  return {
    totalWeight: state.weight,
    totalCost: state.cost,
    avgCost,
    marketValue,
    profit,
    profitRate,
    realizedProfit: state.realized,
    totalProfit,
    totalProfitRate
  }
}

// ============ API ============
async function fetchComexPrice() {
  const res = await fetch('https://qt.gtimg.cn/q=hf_GC')
  const text = await res.text()
  const match = text.match(/v_hf_GC="([^"]+)"/)
  if (!match) throw new Error('COMEX parse failed')
  const parts = match[1].split(',')
  return {
    name: 'COMEX黄金期货',
    price: parseFloat(parts[0]),
    changePercent: parseFloat(parts[1]),
    buy: parseFloat(parts[2]),
    sell: parseFloat(parts[3]),
    high: parseFloat(parts[4]),
    low: parseFloat(parts[5]),
    open: parseFloat(parts[7]),
    prevClose: parseFloat(parts[8]),
    time: parts[6],
    date: parts[12],
    unit: '美元/盎司'
  }
}

async function fetchLondonPrice() {
  const res = await fetch('https://qt.gtimg.cn/q=hf_XAU')
  const text = await res.text()
  const match = text.match(/v_hf_XAU="([^"]+)"/)
  if (!match) throw new Error('London Gold parse failed')
  const parts = match[1].split(',')
  return {
    name: '伦敦金现货',
    price: parseFloat(parts[0]),
    changePercent: parseFloat(parts[1]),
    buy: parseFloat(parts[2]),
    sell: parseFloat(parts[3]),
    high: parseFloat(parts[4]),
    low: parseFloat(parts[5]),
    time: parts[6],
    open: parseFloat(parts[7]),
    prevClose: parseFloat(parts[8]),
    date: parts[12],
    unit: '美元/盎司'
  }
}

async function fetchUsdCny() {
  // 腾讯行情 whUSDCNY：盘中实时汇率，~ 分隔，3=现价
  const res = await fetch('https://qt.gtimg.cn/q=whUSDCNY')
  const text = await res.text()
  const match = text.match(/v_whUSDCNY="([^"]*)"/)
  if (!match) throw new Error('USDCNY parse failed')
  const price = parseFloat(match[1].split('~')[3])
  if (!price) throw new Error('USDCNY empty')
  return price
}

function convertUsdPerOunceToCnyPerGram(usdPerOunce, usdCny) {
  return Math.round((usdPerOunce * usdCny / OUNCE_TO_GRAM) * 100) / 100
}

async function fetchGoldPrice() {
  const manualPrice = getManualPrice()
  try {
    const [comex, london, usdCny] = await Promise.all([
      fetchComexPrice().catch(() => null),
      fetchLondonPrice().catch(() => null),
      fetchUsdCny().catch(() => null)
    ])

    comexData = comex
    londonData = london
    usdCnyRate = usdCny || 0

    let referencePrice = 0
    let source = '演示'

    if (london && london.price && usdCny) {
      referencePrice = convertUsdPerOunceToCnyPerGram(london.price, usdCny)
      source = '伦敦金现货'
    } else if (comex && comex.price && usdCny) {
      referencePrice = convertUsdPerOunceToCnyPerGram(comex.price, usdCny)
      source = 'COMEX换算'
    } else if (manualPrice) {
      referencePrice = manualPrice
      source = '手动'
    } else {
      referencePrice = DEFAULT_PRICE
      source = '演示'
    }

    currentPrice = referencePrice
    priceSource = source
    return { price: referencePrice, source, comex, london, usdCny, updatedAt: Date.now() }
  } catch (err) {
    currentPrice = manualPrice || DEFAULT_PRICE
    priceSource = manualPrice ? '手动' : '演示'
    comexData = null
    londonData = null
    usdCnyRate = 0
    return { price: currentPrice, source: priceSource, comex: null, london: null, usdCny: 0, updatedAt: Date.now(), error: err.message }
  }
}

function loadSinaJsonp(url, varName) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.async = true

    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('JSONP timeout'))
    }, 15000)

    function cleanup() {
      clearTimeout(timeout)
      if (script.parentNode) script.parentNode.removeChild(script)
    }

    script.onload = () => {
      const data = window[varName]
      cleanup()
      if (data) {
        resolve(data)
      } else {
        reject(new Error('JSONP no data'))
      }
    }

    script.onerror = () => {
      cleanup()
      reject(new Error('JSONP load failed'))
    }

    document.head.appendChild(script)
  })
}

async function fetchAuHistory() {
  const varName = 'gold_au_hist_' + Date.now()
  const data = await loadSinaJsonp(
    `https://stock.finance.sina.com.cn/futures/api/jsonp.php/${varName}=/InnerFuturesNewService.getDailyKLine?symbol=AU0`,
    varName
  )
  return data.map(item => ({
    date: item.d,
    open: parseFloat(item.o),
    high: parseFloat(item.h),
    low: parseFloat(item.l),
    close: parseFloat(item.c)
  }))
}

async function fetchLondonHistory() {
  const varName = 'gold_lon_hist_' + Date.now()
  const data = await loadSinaJsonp(
    `https://stock.finance.sina.com.cn/futures/api/jsonp.php/${varName}=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=XAU`,
    varName
  )
  return data.map(item => ({
    date: item.date,
    open: parseFloat(item.open),
    high: parseFloat(item.high),
    low: parseFloat(item.low),
    close: parseFloat(item.close)
  }))
}

async function fetchComexHistory() {
  const varName = 'gold_comex_hist_' + Date.now()
  const data = await loadSinaJsonp(
    `https://stock.finance.sina.com.cn/futures/api/jsonp.php/${varName}=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=GC`,
    varName
  )
  return data.map(item => ({
    date: item.date,
    open: parseFloat(item.open),
    high: parseFloat(item.high),
    low: parseFloat(item.low),
    close: parseFloat(item.close)
  }))
}

// JSONP 偶发失败，重试提高数据源可靠性
async function fetchWithRetry(fn, retries = 3, delay = 1000) {
  let lastErr
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i < retries - 1) await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastErr
}

// ============ Utils ============
function formatMoney(value) {
  return (Number(value) || 0).toFixed(2)
}

function formatDateTime(ts) {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function formatInterval(seconds) {
  if (seconds <= 0) return '已关闭'
  if (seconds < 60) return `${seconds}秒`
  if (seconds === 60) return '1分钟'
  return `${Math.floor(seconds / 60)}分钟`
}

const INTERVAL_OPTIONS = [
  { label: '关闭', value: 0 },
  { label: '10秒', value: 10 },
  { label: '30秒', value: 30 },
  { label: '1分钟', value: 60 },
  { label: '5分钟', value: 300 }
]

function formatDate(date) {
  const d = date ? new Date(date) : new Date()
  const year = d.getFullYear()
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${year}-${month}-${day}`
}

// ============ Router ============
const main = document.getElementById('main')
let currentPage = 'home'
let autoRefreshTimer = null

function startAutoRefresh(interval) {
  stopAutoRefresh()
  if (interval > 0) {
    autoRefreshTimer = setInterval(() => {
      if (currentPage === 'home') {
        refreshPrice()
      }
    }, interval * 1000)
  }
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer)
    autoRefreshTimer = null
  }
}

function switchTab(page) {
  currentPage = page
  document.querySelectorAll('.tab-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page)
  })
  if (page === 'home') renderHome()
  else if (page === 'records') renderRecords()
  else if (page === 'add') renderAdd()
}

document.querySelectorAll('.tab-item').forEach(el => {
  el.addEventListener('click', () => {
    // 从底部导航进入"记一笔"时重置编辑状态，避免残留上次编辑
    if (el.dataset.page === 'add') {
      editingId = null
      editingHolding = false
    }
    switchTab(el.dataset.page)
  })
})

// ============ Home ============
async function renderHome() {
  const summary = getSummary(currentPrice)
  const records = getRecords().slice(0, 5)

  main.innerHTML = `
    <div class="card gold-gradient price-card" id="priceCard">
      <div class="price-header">
        <span class="price-label">持仓参考价（元/克）</span>
        <span class="price-tag">${priceSource}</span>
      </div>
      <div class="price-value">
        <span class="currency">¥</span>${formatMoney(currentPrice)}
      </div>
      <div class="price-footer">
        <span>自动：${formatInterval(getAutoRefreshInterval())}</span>
        <span class="edit-hint">点击修改金价</span>
      </div>
    </div>

    <div class="data-source-row">
      <div class="card source-card">
        <div class="source-header">
          <span class="source-name">期货·COMEX</span>
          <span class="source-tag ${comexData ? 'source-ok' : 'source-fail'}">${comexData ? '已连接' : '未获取'}</span>
        </div>
        ${comexData ? `
          <div class="source-price"><span class="currency-small">$</span>${formatMoney(comexData.price)}</div>
          <div class="source-unit">${comexData.unit}</div>
          <div class="source-change ${comexData.changePercent >= 0 ? 'price-up' : 'price-down'}">
            ${comexData.changePercent >= 0 ? '+' : ''}${formatMoney(comexData.changePercent)}%
          </div>
        ` : '<div class="source-empty">--</div>'}
      </div>

      <div class="card source-card">
        <div class="source-header">
          <span class="source-name">现货·伦敦金</span>
          <span class="source-tag ${londonData ? 'source-ok' : 'source-fail'}">${londonData ? '已连接' : '未获取'}</span>
        </div>
        ${londonData ? `
          <div class="source-price"><span class="currency-small">$</span>${formatMoney(londonData.price)}</div>
          <div class="source-unit">${londonData.unit}</div>
          <div class="source-change ${londonData.changePercent >= 0 ? 'price-up' : 'price-down'}">
            ${londonData.changePercent >= 0 ? '+' : ''}${formatMoney(londonData.changePercent)}%
          </div>
        ` : '<div class="source-empty">--</div>'}
      </div>
    </div>

    <div class="card summary-card">
      <div class="section-title">持仓概览</div>
      <div class="summary-row">
        <div class="summary-item">
          <span class="label">持仓克重</span>
          <span class="value">${formatMoney(summary.totalWeight)} g</span>
        </div>
        <div class="summary-item">
          <span class="label">持仓成本</span>
          <span class="value">¥${formatMoney(summary.totalCost)}</span>
        </div>
      </div>
      <div class="summary-row">
        <div class="summary-item">
          <span class="label">平均成本</span>
          <span class="value">¥${formatMoney(summary.avgCost)}</span>
        </div>
        <div class="summary-item">
          <span class="label">总市值</span>
          <span class="value gold-text">¥${formatMoney(summary.marketValue)}</span>
        </div>
      </div>
      <div class="divider"></div>
      <div class="profit-row">
        <div>
          <span class="label">持仓盈亏（浮动）</span>
          <span class="profit-value ${summary.profit >= 0 ? 'price-up' : 'price-down'}">
            ${summary.profit >= 0 ? '+' : ''}¥${formatMoney(summary.profit)}
          </span>
        </div>
        <div class="profit-rate ${summary.profitRate >= 0 ? 'price-up' : 'price-down'}">
          ${summary.profitRate >= 0 ? '+' : ''}${formatMoney(summary.profitRate)}%
        </div>
      </div>
      <div class="profit-row total-profit-row">
        <div>
          <span class="label">累计总收益</span>
          <span class="profit-value ${summary.totalProfit >= 0 ? 'price-up' : 'price-down'}">
            ${summary.totalProfit >= 0 ? '+' : ''}¥${formatMoney(summary.totalProfit)}
          </span>
        </div>
        <div class="profit-rate ${summary.totalProfitRate >= 0 ? 'price-up' : 'price-down'}">
          ${summary.totalProfitRate >= 0 ? '+' : ''}${formatMoney(summary.totalProfitRate)}%
        </div>
      </div>
      <div class="realized-hint">含已实现盈亏：${summary.realizedProfit >= 0 ? '+' : ''}¥${formatMoney(summary.realizedProfit)}</div>
    </div>

    <div class="card chart-card">
      <div class="section-title">
        <span>金价走势</span>
        <span class="chart-period" id="chartPeriod">
          <span class="period-item active" data-period="30">30天</span>
          <span class="period-item" data-period="90">90天</span>
          <span class="period-item" data-period="180">半年</span>
        </span>
      </div>
      <div class="chart-wrap">
        <canvas id="priceChart"></canvas>
      </div>
      <div class="chart-legend">
        <span class="legend-item spot"><i></i>现货·伦敦金</span>
        <span class="legend-item comex"><i></i>期货·COMEX</span>
        <span class="legend-item sge"><i></i>期货·沪金AU0</span>
        ${getRecords().some(r => r.type === 'buy') ? '<span class="legend-item buy"><i></i>买入</span>' : ''}
        ${getRecords().some(r => r.type === 'sell') ? '<span class="legend-item sell"><i></i>卖出</span>' : ''}
      </div>
    </div>

    <div class="action-bar">
      <button class="btn btn-primary" id="btnAdd">记一笔</button>
      <button class="btn btn-secondary" id="btnRefresh">刷新金价</button>
    </div>
    <div class="action-bar">
      <button class="btn btn-secondary auto-refresh-btn" id="btnAutoRefresh">
        自动刷新：${formatInterval(getAutoRefreshInterval())}
      </button>
    </div>

    <div class="card">
      <div class="section-title">
        <span>最近记录</span>
        <span class="more" id="btnMore">查看全部 ></span>
      </div>
      ${records.length === 0 ? '<div class="empty-state">暂无交易记录，点击"记一笔"添加</div>' : records.map(item => `
        <div class="record-item" data-id="${item.id}">
          <div class="record-left">
            <div class="record-type ${item.type === 'buy' ? 'type-buy' : 'type-sell'}">${item.type === 'buy' ? '买入' : '卖出'}</div>
            <div class="record-info">
              <span class="record-date">${item.date}</span>
              ${item.remark ? `<span class="record-remark">${item.remark}</span>` : ''}
            </div>
          </div>
          <div class="record-right">
            <span class="record-weight">${item.weight}g</span>
            <span class="record-price">¥${item.price}/g</span>
          </div>
        </div>
      `).join('')}
    </div>
  `

  document.getElementById('priceCard').addEventListener('click', editPrice)
  document.getElementById('btnAdd').addEventListener('click', () => switchTab('add'))
  document.getElementById('btnMore').addEventListener('click', () => switchTab('records'))
  document.getElementById('btnRefresh').addEventListener('click', refreshPrice)
  document.getElementById('btnAutoRefresh').addEventListener('click', setAutoRefresh)
  document.querySelectorAll('#chartPeriod .period-item').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('#chartPeriod .period-item').forEach(item => item.classList.remove('active'))
      el.classList.add('active')
      renderChart(parseInt(el.dataset.period))
    })
  })
  document.querySelectorAll('.record-item').forEach(el => {
    el.addEventListener('click', () => {
      editingId = el.dataset.id
      editingHolding = false
      switchTab('add')
    })
  })

  renderChart(30)
}

async function refreshPrice() {
  const btn = document.getElementById('btnRefresh')
  btn.innerHTML = '<span class="loading"></span>刷新中'
  await fetchGoldPrice()
  renderHome()
}

async function loadHistoryData() {
  try {
    // 沪金AU0 先到先画图，伦敦金现货/COMEX 加载完成后补画，避免"只显示一条线"的等待窗口
    const auP = fetchWithRetry(fetchAuHistory).catch(() => null)
    const londonP = fetchWithRetry(fetchLondonHistory).catch(() => null)
    const comexP = fetchWithRetry(fetchComexHistory).catch(() => null)
    auHistoryData = await auP
    if (currentPage === 'home') renderChart(30)
    londonHistoryData = await londonP
    if (currentPage === 'home') renderChart(30)
    comexHistoryData = await comexP
    if (currentPage === 'home') renderChart(30)
  } catch (err) {
    console.error('History load failed:', err)
  }
}

function renderChart(period = 30) {
  const canvas = document.getElementById('priceChart')
  if (!canvas || !auHistoryData) return

  const ctx = canvas.getContext('2d')
  const auSlice = auHistoryData.slice(-period)
  const dates = auSlice.map(item => item.date.slice(5)) // MM-DD

  const auMap = new Map(auHistoryData.map(item => [item.date, item.close]))
  const londonMap = londonHistoryData ? new Map(londonHistoryData.map(item => [item.date, item.close])) : null
  const comexMap = comexHistoryData ? new Map(comexHistoryData.map(item => [item.date, item.close])) : null

  const auCloses = auSlice.map(item => item.close)
  const londonCloses = londonMap ? auSlice.map(item => londonMap.get(item.date) || null) : []
  const comexCloses = comexMap ? auSlice.map(item => comexMap.get(item.date) || null) : []

  if (priceChart) {
    priceChart.destroy()
  }

  const datasets = [{
    label: '期货·沪金AU0',
    data: auCloses,
    borderColor: '#d4af37',
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    yAxisID: 'y',
    fill: true,
    tension: 0.3,
    pointRadius: 2,
    pointHoverRadius: 5
  }]

  if (londonHistoryData) {
    datasets.push({
      label: '现货·伦敦金',
      data: londonCloses,
      borderColor: '#1e88e5',
      backgroundColor: 'transparent',
      yAxisID: 'y1',
      fill: false,
      tension: 0.3,
      pointRadius: 2,
      pointHoverRadius: 5,
      spanGaps: true
    })
  }

  if (comexHistoryData) {
    datasets.push({
      label: '期货·COMEX',
      data: comexCloses,
      borderColor: '#7e57c2',
      backgroundColor: 'transparent',
      yAxisID: 'y1',
      fill: false,
      tension: 0.3,
      pointRadius: 2,
      pointHoverRadius: 5,
      borderDash: [4, 4],
      spanGaps: true
    })
  }

  // 买卖记录点：在走势图上用不同颜色小点标记用户操作，便于复盘
  const records = getRecords()
  const buyPoints = []
  const sellPoints = []
  const buyDayCount = {}
  const sellDayCount = {}
  auSlice.forEach((item, index) => {
    const dayRecords = records.filter(r => r.date === item.date && (r.type === 'buy' || r.type === 'sell'))
    dayRecords.forEach(r => {
      const target = r.type === 'buy' ? buyPoints : sellPoints
      const countMap = r.type === 'buy' ? buyDayCount : sellDayCount
      const n = countMap[index] || 0
      countMap[index] = n + 1
      // 仅同一天多笔同类型时微偏移 ±0.2%，单笔记录保持原始价格
      const offset = n === 0 ? 0 : (n % 2 === 1 ? -0.002 * r.price : 0.002 * r.price)
      target.push({ x: index, y: r.price + offset })
    })
  })

  if (buyPoints.length) {
    datasets.push({
      label: '买入',
      data: buyPoints,
      backgroundColor: 'rgba(7, 193, 96, 0.9)',
      borderColor: 'rgba(7, 193, 96, 0.9)',
      pointStyle: 'circle',
      pointRadius: 5,
      pointHoverRadius: 8,
      yAxisID: 'y',
      showLine: false,
      order: 1
    })
  }

  if (sellPoints.length) {
    datasets.push({
      label: '卖出',
      data: sellPoints,
      backgroundColor: 'rgba(230, 67, 64, 0.9)',
      borderColor: 'rgba(230, 67, 64, 0.9)',
      pointStyle: 'circle',
      pointRadius: 5,
      pointHoverRadius: 8,
      yAxisID: 'y',
      showLine: false,
      order: 1
    })
  }

  priceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: context => {
              const raw = context.raw
              const val = raw && typeof raw === 'object' ? raw.y : raw
              return `${context.dataset.label}: ${formatMoney(val)}`
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            maxTicksLimit: 6,
            color: '#888888'
          }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: {
            display: true,
            text: '元/克',
            color: '#d4af37'
          },
          grid: {
            color: '#f0f0f0'
          },
          ticks: {
            color: '#d4af37'
          }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: {
            display: true,
            text: '美元/盎司',
            color: '#1e88e5'
          },
          grid: {
            drawOnChartArea: false
          },
          ticks: {
            color: '#1e88e5'
          }
        }
      }
    }
  })
}

function editPrice() {
  showModal('设置金价', getManualPrice() || currentPrice, value => {
    const price = parseFloat(value)
    if (price > 0) {
      setManualPrice(price)
      currentPrice = price
      priceSource = '手动'
      renderHome()
    }
  })
}

function setAutoRefresh() {
  const items = INTERVAL_OPTIONS.map(item => item.label)
  const current = getAutoRefreshInterval()
  const defaultIndex = INTERVAL_OPTIONS.findIndex(item => item.value === current)
  const selected = prompt(
    `选择自动刷新间隔（输入 0-${INTERVAL_OPTIONS.length - 1}）：\n` +
    INTERVAL_OPTIONS.map((item, idx) => `${idx}. ${item.label}`).join('\n'),
    defaultIndex >= 0 ? defaultIndex : 0
  )
  const index = parseInt(selected)
  if (isNaN(index) || index < 0 || index >= INTERVAL_OPTIONS.length) return
  const interval = INTERVAL_OPTIONS[index].value
  setAutoRefreshInterval(interval)
  startAutoRefresh(interval)
  renderHome()
}

// ============ Records ============
function renderRecords() {
  const records = getRecords()
  const holding = getHolding()
  main.innerHTML = `
    <div class="card">
      <div class="section-title">
        <span>全部交易记录</span>
        <span class="count">共 ${records.length} 笔</span>
      </div>
      ${holding ? `
        <div class="record-item holding-record" data-kind="holding">
          <div class="record-left">
            <div class="record-type type-holding">持仓</div>
            <div class="record-info">
              <span class="record-date">持仓登记</span>
              <span class="record-detail">${formatMoney(holding.weight)} g · 成本 ¥${formatMoney(holding.cost)} · 已实现 ¥${formatMoney(holding.realizedProfit)}</span>
            </div>
          </div>
          <div class="record-right" style="margin-right: 12px;">
            <span class="record-remark">作为当前持仓基准</span>
          </div>
          <button class="btn btn-danger" style="flex: 0 0 auto; width: auto; padding: 0 14px; height: 34px; font-size: 13px;" data-kind="holding">删除</button>
        </div>
      ` : ''}
      ${records.length === 0 ? `
        <div class="empty-state">
          <div style="margin-bottom: 16px;">暂无逐笔交易记录</div>
          <button class="btn btn-primary" id="btnEmptyAdd">添加第一笔</button>
        </div>
      ` : records.map(item => `
        <div class="record-item" data-id="${item.id}">
          <div class="record-left">
            <div class="record-type ${item.type === 'buy' ? 'type-buy' : 'type-sell'}">${item.type === 'buy' ? '买入' : '卖出'}</div>
            <div class="record-info">
              <span class="record-date">${item.date}</span>
              <span class="record-detail">${item.weight}g × ¥${item.price}</span>
              ${item.remark ? `<span class="record-remark">${item.remark}</span>` : ''}
            </div>
          </div>
          <div class="record-right" style="margin-right: 12px;">
            <span class="record-amount ${item.type === 'buy' ? 'price-up' : 'price-down'}">
              ${item.type === 'buy' ? '-' : '+'}¥${item.amount}
            </span>
            ${item.fee ? `<span class="record-fee">手续费 ¥${item.fee}</span>` : ''}
          </div>
          <button class="btn btn-danger" style="flex: 0 0 auto; width: auto; padding: 0 14px; height: 34px; font-size: 13px;" data-id="${item.id}">删除</button>
        </div>
      `).join('')}
    </div>
  `

  const emptyAdd = document.getElementById('btnEmptyAdd')
  if (emptyAdd) emptyAdd.addEventListener('click', () => switchTab('add'))

  document.querySelectorAll('.record-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.tagName === 'BUTTON') return
      if (el.dataset.kind === 'holding') {
        editingHolding = true
        editingId = null
        switchTab('add')
        return
      }
      editingId = el.dataset.id
      editingHolding = false
      switchTab('add')
    })
  })

  document.querySelectorAll('.btn-danger').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      if (btn.dataset.kind === 'holding') {
        if (confirm('清除持仓登记？将退回按逐笔交易计算持仓。')) {
          clearHolding()
          renderRecords()
        }
        return
      }
      if (confirm('确认删除这条记录？')) {
        deleteRecord(btn.dataset.id)
        renderRecords()
      }
    })
  })
}

// ============ Add ============
let editingId = null
let editingHolding = false

function renderAdd() {
  const records = getRecords()
  const holding = getHolding()
  const record = editingId ? records.find(item => item.id === editingId) : null
  const mode = editingHolding ? 'holding' : 'trade'

  main.innerHTML = `
    <div class="card form-card">
      <div class="mode-seg">
        <button class="mode-item ${mode === 'trade' ? 'active' : ''}" data-mode="trade">逐笔交易</button>
        <button class="mode-item ${mode === 'holding' ? 'active' : ''}" data-mode="holding">持仓登记</button>
      </div>

      <div id="formTrade" ${mode === 'trade' ? '' : 'style="display:none"'}>
        <div class="form-item">
          <span class="form-label">交易类型</span>
          <div class="radio-group">
            <label class="radio-label">
              <input type="radio" name="type" value="buy" ${(!record || record.type === 'buy') ? 'checked' : ''}>
              <span class="radio-text ${(!record || record.type === 'buy') ? 'active-buy' : ''}">买入</span>
            </label>
            <label class="radio-label">
              <input type="radio" name="type" value="sell" ${record && record.type === 'sell' ? 'checked' : ''}>
              <span class="radio-text ${record && record.type === 'sell' ? 'active-sell' : ''}">卖出</span>
            </label>
          </div>
        </div>

        <div class="form-item">
          <span class="form-label">交易日期</span>
          <input type="date" id="date" value="${record ? record.date : formatDate()}">
        </div>

        <div class="form-item">
          <span class="form-label">克重（g）</span>
          <input type="number" step="0.001" id="weight" placeholder="例如：10" value="${record ? record.weight : ''}">
        </div>

        <div class="form-item">
          <span class="form-label">单价（元/克）</span>
          <input type="number" step="0.01" id="price" placeholder="例如：560" value="${record ? record.price : ''}">
        </div>

        <div class="form-item">
          <span class="form-label">成交金额（元）</span>
          <input type="number" step="0.01" id="amount" placeholder="自动计算" value="${record ? record.amount : ''}">
        </div>

        <div class="form-item">
          <span class="form-label">手续费（元）</span>
          <input type="number" step="0.01" id="fee" placeholder="可选" value="${record ? record.fee || '' : ''}">
        </div>

        <div class="form-item">
          <span class="form-label">备注</span>
          <input type="text" id="remark" placeholder="可选" value="${record ? record.remark || '' : ''}">
        </div>
      </div>

      <div id="formHolding" ${mode === 'holding' ? '' : 'style="display:none"'}>
        <div class="form-item">
          <span class="form-label">当前持仓克重（g）</span>
          <input type="number" step="0.001" id="hWeight" placeholder="例如：50" value="${holding ? holding.weight : ''}">
        </div>
        <div class="form-item">
          <span class="form-label">持仓成本（元）</span>
          <input type="number" step="0.01" id="hCost" placeholder="买入花的总钱（含手续费）" value="${holding ? holding.cost : ''}">
        </div>
        <div class="form-item">
          <span class="form-label">累计已实现盈亏（元）</span>
          <input type="number" step="0.01" id="hRealized" placeholder="亏损填负数，如 -500" value="${holding ? holding.realizedProfit : ''}">
        </div>
        <div class="form-hint" id="hHint"></div>
      </div>
    </div>

    <button class="btn btn-primary save-btn" id="btnSave">${mode === 'holding' ? (holding ? '保存持仓登记' : '登记持仓') : (record ? '保存修改' : '保存')}</button>
    ${(record || holding) ? '<button class="btn btn-secondary save-btn" id="btnCancel" style="margin-top: 12px;">取消</button>' : ''}
  `

  document.querySelectorAll('.mode-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.mode
      document.getElementById('formTrade').style.display = m === 'trade' ? '' : 'none'
      document.getElementById('formHolding').style.display = m === 'holding' ? '' : 'none'
      document.querySelectorAll('.mode-item').forEach(b => b.classList.toggle('active', b === btn))
      const save = document.getElementById('btnSave')
      save.textContent = m === 'holding'
        ? (getHolding() ? '保存持仓登记' : '登记持仓')
        : (editingId ? '保存修改' : '保存')
    })
  })

  // —— 逐笔交易表单 ——
  const weightInput = document.getElementById('weight')
  const priceInput = document.getElementById('price')
  const amountInput = document.getElementById('amount')

  function calcAmount() {
    const w = parseFloat(weightInput.value) || 0
    const p = parseFloat(priceInput.value) || 0
    if (w > 0 && p > 0) {
      amountInput.value = (w * p).toFixed(2)
    }
  }

  weightInput.addEventListener('input', calcAmount)
  priceInput.addEventListener('input', calcAmount)

  document.querySelectorAll('input[name="type"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.querySelectorAll('.radio-text').forEach(el => {
        el.classList.remove('active-buy', 'active-sell')
      })
      const text = radio.parentElement.querySelector('.radio-text')
      text.classList.add(radio.value === 'buy' ? 'active-buy' : 'active-sell')
    })
  })

  // —— 持仓登记表单：自动计算平均成本提示 ——
  const hWeight = document.getElementById('hWeight')
  const hCost = document.getElementById('hCost')
  const hHint = document.getElementById('hHint')
  function updateHint() {
    const w = parseFloat(hWeight.value)
    const c = parseFloat(hCost.value)
    if (w > 0 && c > 0) {
      hHint.textContent = `平均成本：¥${(c / w).toFixed(2)}/g`
    } else {
      hHint.textContent = '只填当前持有的克重、总成本和已落袋的累计盈亏即可，无需补录每笔买卖时间'
    }
  }
  hWeight.addEventListener('input', updateHint)
  hCost.addEventListener('input', updateHint)
  updateHint()

  document.getElementById('btnSave').addEventListener('click', () => {
    const m = document.querySelector('.mode-item.active').dataset.mode

    if (m === 'holding') {
      const weight = parseFloat(document.getElementById('hWeight').value)
      const cost = parseFloat(document.getElementById('hCost').value)
      const realized = parseFloat(document.getElementById('hRealized').value) || 0
      if (!weight || weight <= 0) return alert('请输入有效的持仓克重')
      if (isNaN(cost) || cost < 0) return alert('请输入有效的持仓成本')
      const prev = getHolding()
      saveHolding({
        weight: Math.round(weight * 1000) / 1000,
        cost: Math.round(cost * 100) / 100,
        realizedProfit: Math.round(realized * 100) / 100,
        // 保留登记时间：登记之前的逐笔交易视为已并入登记，不重复叠加
        createdAt: prev && prev.createdAt ? prev.createdAt : Date.now()
      })
    } else {
      const type = document.querySelector('input[name="type"]:checked').value
      const date = document.getElementById('date').value
      const weight = parseFloat(document.getElementById('weight').value)
      const price = parseFloat(document.getElementById('price').value)
      const amount = parseFloat(document.getElementById('amount').value) || (weight * price)
      const fee = parseFloat(document.getElementById('fee').value) || 0
      const remark = document.getElementById('remark').value.trim()

      if (!date) return alert('请选择交易日期')
      if (!weight || weight <= 0) return alert('请输入有效的克重')
      if (!price || price <= 0) return alert('请输入有效的单价')

      const payload = {
        type,
        date,
        weight: Math.round(weight * 1000) / 1000,
        price: Math.round(price * 100) / 100,
        amount: Math.round(amount * 100) / 100,
        fee: Math.round(fee * 100) / 100,
        remark
      }

      if (record) {
        updateRecord(record.id, payload)
      } else {
        addRecord(payload)
      }
    }

    editingId = null
    editingHolding = false
    switchTab('home')
  })

  const cancelBtn = document.getElementById('btnCancel')
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      editingId = null
      editingHolding = false
      switchTab('records')
    })
  }
}

// ============ Modal ============
function showModal(title, defaultValue, onConfirm) {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-title">${title}</div>
      <input type="number" class="modal-input" value="${defaultValue}" placeholder="请输入">
      <div class="modal-actions">
        <button class="btn btn-secondary" id="modalCancel">取消</button>
        <button class="btn btn-primary" id="modalOk">确定</button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  const input = overlay.querySelector('.modal-input')
  input.focus()

  overlay.querySelector('#modalCancel').addEventListener('click', () => overlay.remove())
  overlay.querySelector('#modalOk').addEventListener('click', () => {
    onConfirm(input.value)
    overlay.remove()
  })
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove()
  })
}

// ============ Init ============
async function init() {
  await fetchGoldPrice()
  loadHistoryData().then(() => {
    if (currentPage === 'home') {
      renderChart(30)
    }
  })
  startAutoRefresh(getAutoRefreshInterval())
  switchTab('home')
}

init()
