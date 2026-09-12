// ============ Constants ============
const DXY_CONST = 50.14348112

// 自动刷新频率（可配置，存 localStorage）
const AUTO_REFRESH_KEY = 'gold_market_refresh_interval'
const REFRESH_OPTIONS = [
  { label: '关闭', value: 0 },
  { label: '15秒', value: 15 },
  { label: '30秒', value: 30 },
  { label: '60秒', value: 60 },
  { label: '5分钟', value: 300 }
]
const DEFAULT_REFRESH = 60

function getRefreshInterval() {
  const raw = localStorage.getItem(AUTO_REFRESH_KEY)
  if (raw === null) return DEFAULT_REFRESH
  const v = parseInt(raw) || 0
  return REFRESH_OPTIONS.some(o => o.value === v) ? v : DEFAULT_REFRESH
}

function setRefreshInterval(v) {
  localStorage.setItem(AUTO_REFRESH_KEY, v)
  restartAutoRefresh()
}

function formatRefresh(seconds) {
  if (seconds <= 0) return '已关闭'
  if (seconds < 60) return seconds + '秒'
  if (seconds === 60) return '1分钟'
  return Math.floor(seconds / 60) + '分钟'
}

function refreshLabel(seconds) {
  return seconds > 0 ? '自动刷新 ' + formatRefresh(seconds) : '自动刷新 已关闭'
}

// 宏观参考值（最近发布数据，手动更新）
const MACRO_REF = {
  us10y: { value: 4.70, label: '8/27 参考', desc: '接近周期高位4.75%，曲线熊陡' },
  cpi: { value: 3.4, label: '7月同比', desc: '核心2.5%，PCE约3.7%' },
  fed: { value: '3.50–3.75%', label: '7月FOMC', desc: '9月是否加息是焦点，加息概率约1/3' },
  real: { value: '≈2.0%+', label: '估算', desc: '10Y名义 − 通胀预期' }
}

// 已发生事件库（区间影响）：
// 每个事件有影响窗口 window（天），事件发生日期前后 window 天内都被视为"影响期内"，
// 因此事件影响的是"时间段"而非"单日"。每个事件附有影响逻辑 logic，说明其传导路径。
const GOLD_EVENTS = [
  {
    date: '2026-09-11', window: 4,
    events: [
      { title: '美国8月核心CPI超预期，9月加息概率飙至80%+，金价先抑后扬', impact: 'bull',
        desc: '美国8月CPI环比+0.4%（7月为+0.1%）、同比+3.4%符合预期；但核心CPI环比+0.3%（预期0.2%）超预期、同比+2.4%。汽油价格单月+3.9%、贡献整体CPI涨幅超三分之一，能源指数环比+2.1%、同比+16.3%（中东局势推升），居住成本+0.3%。数据公布后CME FedWatch显示9月加息25bp概率从约70%飙升至80%以上、一度近87%；美元指数短线拉升后回落至99附近；10年期美债收益率一度逼近5%（4.969%），随后回落约5个基点至4.92%；现货黄金短线跳水一度失守4300美元/盎司，随后迅速拉升逾1%站上4390美元/盎司、日内收涨约1.5%；美股三大指数集体涨逾1%。',
        logic: '核心CPI月率超预期→通胀黏性强化→9月加息概率从70%飙升至80%+→理论上利空黄金（持有机会成本上升）。但金价先抑后扬：①数据公布前金价已连跌（9/10单日重挫1.93%至4316美元），"预期差"被提前消化；②数据落地后油价回落、10年期美债收益率掉头下行约5bp，实际利率压力阶段性减轻；③"卖事实"反弹叠加美伊地缘避险买盘支撑。注：9月15-16日FOMC加息几成定局，市场焦点转向"本轮紧缩需加息几次"，决议落地前金价或维持高波动。' }
    ]
  },
  {
    date: '2026-09-10', window: 3,
    events: [
      { title: '欧央行年内二次加息+美8月PPI超预期，金价重挫近2%', impact: 'bear',
        desc: '欧洲央行9月10日将三大关键利率上调25bp、存款便利利率升至2.50%（年内第二次加息），拉加德称能源与地缘因素料令通胀在2027年上半年之前持续高于目标。同日美国8月PPI同比+5.4%（预期5.3%）、环比+0.4%，能源环比+4.2%、柴油单月+24.1%。30年期美债收益率升至约5.38%、创2007年以来新高，10年期升至4.969%逼近5%。现货黄金单日下跌1.93%至4316.52美元/盎司，现货白银跌5.52%，沪金期货收跌1.35%。',
        logic: '欧央行重启连续加息→全球主要央行同步紧缩预期共振→长端美债收益率创2007年以来新高（期限溢价+通胀补偿+债券供给三重抬升）→持有黄金的机会成本骤增；叠加美国8月PPI超预期强化通胀黏性与加息预期→实际利率与美元双压→无息资产黄金重挫。美伊冲突推升油价的地缘避险买盘完全被利率压制效应抵消。' }
    ]
  },
  {
    date: '2026-09-04', window: 5,
    events: [
      { title: '8月非农大增16.2万远超预期，金价跳水逾2%', impact: 'bear',
        desc: '美国8月季调后非农就业人口增16.2万，约为市场预期（5.5万）的3倍，7月前值由-2.3万上修至+2.1万、6月上修至+3.1万，失业率持平4.1%，平均时薪环比+0.3%符合预期。数据公布后CME美联储观察显示9月加息概率由52%左右升至60%~65%，2年期美债收益率升至4.41%附近、创2025年1月以来新高，10年期升至4.79%，美元指数冲上99.39；现货黄金盘中一度失守4370美元，COMEX 12月期金收报4429.7美元、跌2.43%，现货金收4382美元附近、日内跌约2%，白银跌3.09%。',
        logic: '8月非农新增16.2万、约为预期的3倍→劳动力市场韧性远超预期→市场大幅上调9月美联储加息押注（52%→60%+）→美债收益率与美元指数联袂走强→持有无息黄金的机会成本骤升→金价承压跳水。注：9月15-16日议息会议前，下周公布的美8月CPI仍是决定加息与否的关键，若通胀回落超预期，金价或迎超跌修复。' }
    ]
  },
  {
    date: '2026-09-02', window: 4,
    events: [
      { title: '8月ADP就业爆冷，金价绝地反弹逾1%', impact: 'bull',
        desc: '美国8月ADP私营就业仅增3.8万，远低于预期的4.7万/4.8万，为今年1月以来最低（7月修正为4.6万），释放劳动力市场明显降温信号。CME美联储观察显示9月加息概率从前一日的68.2%回落至64.2%；美元指数自近三周高点99.85回落至99.54，10年期美债收益率自盘中4.818%的三年高位回落至4.794%、终结五连涨。现货黄金自盘中8月7日以来最低4282.5美元反弹逾100美元，收涨1.36%报4387.6美元/盎司；COMEX 12月期金收报4414.6美元（+0.4%）。',
        logic: '8月ADP就业大幅不及预期→劳动力市场降温信号→市场下调9月美联储加息押注（68.2%→64.2%）→美元指数与美债收益率从高位联袂回落→压制金价的实际利率与美元双重压力解除→无息资产黄金吸引力回升→叠加此前一周多超7%回撤后的技术性超跌反弹→金价强势拉升。注：ADP为民间机构数据，权威性不及官方非农，市场仍聚焦9月4日非农数据。' }
    ]
  },
  {
    date: '2026-08-28', window: 5,
    events: [
      { title: '美联储主席沃什杰克逊霍尔首秀放鹰', impact: 'bear',
        desc: '沃什首次在杰克逊霍尔年会演讲，直言通胀"仍然过高"、2%目标"坚定且固定"，若回落不及预期将继续采取必要政策行动。现货黄金自4631美元跳水，收4453.67美元/盎司，重挫2.95%，创近两个月最大单日跌幅，终结周线三连涨；COMEX黄金期货跌3.43%跌破4500美元整数关口；9月加息概率升至约57%。',
        logic: '沃什首秀强化抗通胀立场→市场解读为鹰派→9月加息概率从40%跳升至57%→实际利率预期大幅上行→持有黄金（无利息）的机会成本骤增→叠加此前连续三周上涨、累计涨幅约13%后的获利盘集中兑现→金价踩踏式下跌。美元指数涨破99.7、10年期美债收益率升至4.728%，进一步施压美元计价黄金。' }
    ]
  },
  {
    date: '2026-08-26', window: 4,
    events: [
      { title: '美国7月PCE超预期，通胀黏性凸显', impact: 'bear',
        desc: '7月PCE同比3.7%（预期3.6%）、环比0.2%（预期0.1%），已连续65个月高于2%目标。数据公布后9月加息概率从36%升至42%，美元指数突破99，10年期美债收益率升至4.667%，金价自4650美元跳水至4582美元，COMEX黄金跌0.99%报4647.8美元/盎司。',
        logic: 'PCE是美联储最看重的通胀指标→读数超预期且连续65个月高于目标→通胀黏性担忧升温→9月加息概率跳升→实际利率预期上行→黄金机会成本上升→金价承压下跌；美元与美债收益率同步走强，进一步压制无息资产黄金。' },
      { title: '霍尔木兹海峡缓和，地缘避险溢价消退', impact: 'bear',
        desc: '伊朗与阿曼就霍尔木兹海峡通行与收入分配达成协议，停火谈判推进，油价回落，地缘避险溢价边际消退。',
        logic: '地缘缓和→原油价格回落→能源通胀预期降温→同时此前支撑金价的避险买盘撤离→"地缘溢价"被挤出→金价失去部分上涨动能→利空黄金。' }
    ]
  },
  {
    date: '2026-08-25', window: 3,
    events: [
      { title: '金价逼近4700美元，获利盘集中兑现', impact: 'neutral',
        desc: '现货黄金连续三周上涨、累计涨幅约13%，盘中触及4697美元/盎司的三个月高点，在4700整数关口受阻后获利盘开始兑现，出现"黄昏之星"等技术顶部信号。',
        logic: '连续上涨积累大量浮盈→逼近4700强阻力位→技术面RSI超买、顶背离→短线资金获利了结→金价高位回调。此为技术面与资金面因素而非基本面转向，方向中性偏空。' }
    ]
  },
  {
    date: '2026-08-19', window: 7,
    events: [
      { title: '财政部扩大长债回购', impact: 'bear',
        desc: '贝森特宣布将10-30年期国债流动性支持回购规模翻倍，长端美债收益率回落，避险情绪降温。',
        logic: '政府加大对长债的流动性支持→缓解美债抛售与融资压力→财政/系统性风险担忧降温→市场避险需求下降→资金从黄金等避险资产流出→金价承压。注意：此处虽伴随长债收益率回落（通常利多黄金），但主导逻辑是"风险溢价消退"而非"实际利率下行"。' },
      { title: '7月FOMC会议纪要公布', impact: 'bear',
        desc: '9:3投票维持利率，三位委员主张加息25bp，释放偏鹰信号，压制金价。',
        logic: '纪要显示票委分歧偏向加息→市场上调9月加息概率→名义利率预期上行→实际利率走高→持有黄金（无利息）的机会成本上升→金价承压；同时加息预期推升美元→美元计价的金价进一步受压。' }
    ]
  },
  {
    date: '2026-08-18', window: 7,
    events: [
      { title: '美国联邦债务突破40万亿美元', impact: 'bull',
        desc: '长期财政担忧升温，30年期美债收益率创2007年以来新高，避险买盘支撑金价。',
        logic: '债务规模膨胀→市场对政府偿债能力与美元信用产生怀疑→要求更高风险溢价、长端美债收益率上行→黄金作为"终极安全资产"与对冲货币贬值/主权信用风险的工具获资金流入→金价上涨。' }
    ]
  },
  {
    date: '2026-08-13', window: 6,
    events: [
      { title: '30年期美债拍卖收益率创新高', impact: 'bull',
        desc: '中标收益率5.216%，2001年以来最高，市场对财政风险的担忧持续发酵。',
        logic: '拍卖需求不足→中标收益率抬升→反映投资者对美国财政赤字与债务供给的担忧加剧→美债信用溢价上升→资金转向黄金对冲主权信用风险→金价上涨；高收益率加重政府利息负担→财政担忧自我强化→避险买盘延续。' }
    ]
  },
  {
    date: '2026-08-12', window: 6,
    events: [
      { title: '10年期美债拍卖创2007年来最高收益率', impact: 'bull',
        desc: '420亿美元10年期国债中标收益率4.683%，政府融资成本上升强化避险逻辑。',
        logic: '10年期是利率定价基准→其拍卖收益率走高意味着政府融资成本系统性上升→财政可持续性担忧升温→黄金相对法定货币的"硬资产"属性凸显→避险资金流入→金价上涨。' }
    ]
  },
  {
    date: '2026-08-11', window: 6,
    events: [
      { title: '美日自1998年来首次联合干预汇市', impact: 'neutral',
        desc: '财政部长贝森特证实美日联合干预日元，短期扰动美元与全球流动性预期，贵金属波动加大。',
        logic: '联合干预→压制美元/日元→美元指数短期剧烈波动→以美元计价的黄金出现双向摆动（美元弱则利多、干预引发的流动性收缩则利空）；干预动用美债储备→间接影响美债供需与收益率→综合方向不明、波动率上升。' }
    ]
  },
  {
    date: '2026-08-06', window: 10,
    events: [
      { title: '财政部调整长债发行指引', impact: 'bull',
        desc: '季度再融资声明将附息债券标售表述改为"潜在的未来变化"，暗示供给或削减，中期利多长债与金价。',
        logic: '发行指引暗示未来长债供给减少→长端债券供不应求→收益率上行压力缓解→实际利率预期下行→黄金持有成本下降→利多金价；同时供给收缩缓解融资压力→但更直接的作用路径是"供给↓→收益率↓→实际利率↓→黄金↑"。' }
    ]
  },
  {
    date: '2026-07-31', window: 7,
    events: [
      { title: '7月FOMC决议', impact: 'neutral',
        desc: '美联储维持利率3.50%-3.75%，但后续加息担忧压制金价，决议影响持续至8月初。',
        logic: '维持利率符合预期→"利率不变"本身对黄金中性偏多（实际利率未变）；但声明与点阵图暗示后续加息风险→市场对未来利率路径重新定价→加息预期推升实际利率、利空黄金。多空力量对冲→金价震荡、方向中性。' }
    ]
  },
  {
    date: '2026-07-17', window: 6,
    events: [
      { title: '美联储主席沃什上任后公开亮相', impact: 'neutral',
        desc: 'Kevin Warsh 首次公开露面，市场聚焦其抗通胀立场与前瞻指引风格，不确定性压制金价。',
        logic: '新主席政策立场未知→市场观望、波动率上升→黄金作为对冲不确定性的工具获得部分买盘；但若其表态偏鹰（抗通胀优先）→强化加息预期→实际利率上行→利空黄金。方向取决于表态内容，暂为中性。' }
    ]
  },
  {
    date: '2026-07-08', window: 6,
    events: [
      { title: '美国6月非农数据不及预期', impact: 'bull',
        desc: '就业市场降温信号强化降息预期，美元走弱，金价获得支撑。',
        logic: '就业走弱→经济降温信号→市场预期美联储更早降息→实际利率预期下行→黄金机会成本下降；同时降息预期打压美元→美元计价的金价获得"利率+汇率"双重支撑→金价上涨。' }
    ]
  },
  {
    date: '2026-06-18', window: 8,
    events: [
      { title: '美联储6月决议维持利率', impact: 'bear',
        desc: '点阵图下调年内降息预期，实际利率预期走高，金价承压，影响持续至6月下旬。',
        logic: '点阵图显示年内降息次数少于预期→市场上调未来利率路径→名义利率预期上行→实际利率走高→持有黄金（不生息资产）的机会成本上升→资金流向生息资产→金价承压。' }
    ]
  },
  {
    date: '2026-05-29', window: 6,
    events: [
      { title: '美国4月PCE超预期', impact: 'bear',
        desc: '核心PCE仍高企，通胀黏性推升加息担忧，金价回调。',
        logic: '核心PCE高企→通胀黏性→市场担心美联储需更长时间维持高利率、甚至再加息→名义利率预期上行→实际利率（名义-通胀预期）走高→黄金机会成本上升→金价回调。' }
    ]
  },
  {
    date: '2026-04-22', window: 8,
    events: [
      { title: '地缘冲突升温', impact: 'bull',
        desc: '中东局势紧张推升避险需求，黄金作为安全资产获资金流入，影响持续约一周。',
        logic: '地缘风险升级→避险情绪升温→资金从股票等风险资产流向黄金→同时能源供应担忧推升油价→通胀预期上行→实际利率下行→黄金的抗通胀与避险属性共振→金价上涨。' }
    ]
  },
  {
    date: '2026-03-20', window: 8,
    events: [
      { title: '美联储3月会议', impact: 'bull',
        desc: '维持利率不变但下调经济增长预测，金价震荡收高。',
        logic: '维持利率且下调经济预测→政策立场偏鸽→市场降低未来加息预期→实际利率预期下行→美元走弱→黄金吸引力相对上升→金价收高。' }
    ]
  },
  {
    date: '2026-02-12', window: 6,
    events: [
      { title: '美国1月CPI超预期反弹', impact: 'bear',
        desc: '通胀高于预期，降息预期降温，美债收益率上行，金价承压。',
        logic: '通胀反弹→市场对美联储降息的预期降温、甚至担忧再加息→名义利率与美债收益率上行→实际利率走高→黄金机会成本上升；同时紧缩预期推升美元→美元计价的金价承压→金价下跌。' }
    ]
  },
  {
    date: '2026-01-29', window: 8,
    events: [
      { title: '美联储1月决议按兵不动', impact: 'bear',
        desc: '鲍威尔表态谨慎，市场对3月降息预期下降，金价短期承压。',
        logic: '决议按兵不动且表态谨慎→市场下调3月降息押注→宽松预期降温→名义利率预期上行→实际利率走高→黄金持有成本上升→金价短期承压。' }
    ]
  }
]

// 未来预期事件库（前瞻影响）：
// 事件落地前，市场会提前定价"预期"，预期比事件本身更早、更持续地影响价格。
// leadDays 表示事件落地前多少天市场开始提前反映该预期。每个事件附影响逻辑 logic。
const UPCOMING_EVENTS = [
  {
    date: '2026-09-16', leadDays: 21,
    title: '美联储9月FOMC利率决议',
    desc: '沃什杰克逊霍尔讲话后，CME FedWatch显示9月加息概率升至约57%，市场对"是否加息"的博弈进入白热化。决议前金价随加息概率的每一个百分点波动。',
    impact: 'bear',
    logic: '这是当前最重要的预期变量：沃什放鹰后加息概率已过半→实际利率预期上行→黄金机会成本增加→压制金价；反之若8月CPI/非农走弱、加息概率回落则支撑金价。决议前市场按概率"加权定价"，金价与FedWatch加息概率呈反向联动——加息概率每上升一个百分点，金价就承压一分。'
  },
  {
    date: '2026-09-04', leadDays: 14,
    title: '美国8月非农就业数据',
    desc: '7月非农负增长2.3万人、5-6月合计下修10.3万人。若8月就业延续疲软，将强化"经济走弱"逻辑并可能利好金价避险；若强劲则支持加息预期、利空金价。',
    impact: 'neutral',
    logic: '非农反映经济动能与工资通胀：数据偏弱→降息预期升温→美元与实际利率下行→利多黄金，同时"衰退避险"买盘加码；数据强劲→紧缩预期升温→利空黄金。两条路径方向相反，实际影响取决于市场当时更担忧"通胀"还是"衰退"。'
  },
  {
    date: '2026-09-01', leadDays: 7,
    title: '美国8月ISM制造业PMI',
    desc: '制造业景气度是经济前瞻指标。数据走弱可能引发避险买盘，走强则利好风险偏好、压制金价。',
    impact: 'neutral',
    logic: 'PMI是经济景气的先行指标：读数走弱→衰退担忧上升→避险买盘流入黄金 + 降息预期升温→利多；读数走强→风险偏好回升→资金从避险资产流向股市等风险资产→利空。其影响更多通过"风险偏好"渠道传导，方向与CPI/非农相反时会产生对冲效应。'
  }
]

// ============ State ============
let selectedInsightDate = null

// ============ Helpers ============
let sgeHistoryData = null
let londonHistoryData = null
let comexHistoryData = null
let priceChart = null
let refreshTimer = null
let refreshLock = false

// ============ Helpers ============
function $(id) { return document.getElementById(id) }
function fmt(v, digits = 2) { return (Number(v) || 0).toFixed(digits) }

function setText(id, val) { $(id).textContent = val }

function setStatus(cls, text) {
  const el = $('headerStatus')
  el.className = 'header-status ' + cls
  el.textContent = text
}

function setLastUpdate(text) {
  $('lastUpdate').textContent = text
}

function applyChange(el, v) {
  el.classList.remove('price-up', 'price-down')
  if (v > 0) el.classList.add('price-up')
  else if (v < 0) el.classList.add('price-down')
}

function fmtSign(v, digits = 2) {
  const n = Number(v) || 0
  return (n >= 0 ? '+' : '') + n.toFixed(digits)
}

// ============ 腾讯行情（fetch，CORS 已开放） ============
async function fetchTencent(codes) {
  const res = await fetch('https://qt.gtimg.cn/q=' + codes.join(','))
  const text = await res.text()
  const result = {}
  text.replace(/v_(\w+)="([^"]*)"/g, (m, name, data) => {
    result[name] = data
  })
  return result
}

function parseHf(parts) {
  return {
    price: parseFloat(parts[0]),
    changePercent: parseFloat(parts[1]),
    high: parseFloat(parts[4]),
    low: parseFloat(parts[5]),
    time: parts[6],
    open: parseFloat(parts[7]),
    prevClose: parseFloat(parts[8]),
    date: parts[12]
  }
}

function parseWh(parts) {
  // whUSDCNY 以 ~ 分隔：3=现价 12=涨跌 13=涨跌幅
  return {
    price: parseFloat(parts[3]),
    change: parseFloat(parts[12]),
    changePercent: parseFloat(parts[13])
  }
}

// ============ 美元指数 DXY（由六种货币按权重计算） ============
function prevBusinessDay() {
  const d = new Date()
  do {
    d.setDate(d.getDate() - 1)
  } while (d.getDay() === 0 || d.getDay() === 6)
  return d.toISOString().slice(0, 10)
}

function calcDxyValue(eurusd, usdjpy, gbpusd, usdcad, usdsek, usdchf) {
  return DXY_CONST
    * Math.pow(eurusd, -0.576)
    * Math.pow(usdjpy, 0.136)
    * Math.pow(gbpusd, -0.119)
    * Math.pow(usdcad, 0.091)
    * Math.pow(usdsek, 0.042)
    * Math.pow(usdchf, 0.036)
}

// frankfurter 兜底用的参考SEK（权重仅0.042，误差可忽略）
const SEK_REF = 9.5

// 主方案：frankfurter（六币种，官方口径，CORS 开放）
async function fetchDxyFrankfurter() {
  const symbols = 'EUR,JPY,GBP,CAD,SEK,CHF'
  const prevDate = prevBusinessDay()
  const [latestRes, prevRes] = await Promise.all([
    fetch('https://api.frankfurter.app/latest?from=USD&to=' + symbols),
    fetch('https://api.frankfurter.app/' + prevDate + '?from=USD&to=' + symbols)
  ])
  const latest = await latestRes.json()
  const prev = await prevRes.json()
  const r = latest.rates
  const now = calcDxyValue(1 / r.EUR, r.JPY, 1 / r.GBP, r.CAD, r.SEK, r.CHF)
  let before = now
  if (prev.rates) {
    const p = prev.rates
    before = calcDxyValue(1 / p.EUR, p.JPY, 1 / p.GBP, p.CAD, p.SEK, p.CHF)
  }
  return { now, change: now - before, changePct: before ? ((now - before) / before) * 100 : 0 }
}

// 兜底方案：腾讯交叉汇率（EUR/JPY/GBP/CAD/CHF）+ 参考SEK
async function fetchDxyTencent() {
  const codes = 'whEURUSD,whUSDJPY,whGBPUSD,whUSDCAD,whUSDCHF'
  const res = await fetch('https://qt.gtimg.cn/q=' + codes)
  const text = await res.text()
  const obj = {}
  text.replace(/v_(\w+)="([^"]*)"/g, (m, name, data) => { obj[name] = data })
  function rate(name) { return parseFloat(obj[name].split('~')[3]) }
  function prevClose(name) { return parseFloat(obj[name].split('~')[11]) || rate(name) }
  const now = calcDxyValue(rate('whEURUSD'), rate('whUSDJPY'), rate('whGBPUSD'), rate('whUSDCAD'), SEK_REF, rate('whUSDCHF'))
  const before = calcDxyValue(prevClose('whEURUSD'), prevClose('whUSDJPY'), prevClose('whGBPUSD'), prevClose('whUSDCAD'), SEK_REF, prevClose('whUSDCHF'))
  return { now, change: now - before, changePct: before ? ((now - before) / before) * 100 : 0 }
}

async function fetchDxy() {
  try {
    return await fetchDxyFrankfurter()
  } catch (e) {
    console.warn('frankfurter DXY failed, use tencent fallback:', e)
    return await fetchDxyTencent()
  }
}

// ============ 上交所 Au9999（k780） ============
async function fetchSge() {
  const res = await fetch(
    'https://sapi.k780.com/?app=finance.gold_price&goldid=1053&appkey=10003&sign=b59bc3ef6191eb9f747dd4e83c99f2a4&format=json'
  )
  const data = await res.json()
  if (data.success !== '1') throw new Error('SGE api failed')
  const item = data.result.dtList['1053']
  return {
    price: parseFloat(item.last_price),
    changePrice: parseFloat(item.change_price),
    changePercent: parseFloat(item.change_margin.replace('%', '')),
    time: item.uptime
  }
}

// ============ 美债宏观数据（美国财政部，每日更新，CORS 开放） ============
let macroLive = null // { us10y: {value,date}, real: {value,date} }

async function fetchTreasuryCsv(type) {
  const year = new Date().getFullYear()
  const url = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/' + year + '/all' +
    '?field_tdr_date_value=' + year + '&type=' + type + '&page&_format=csv'
  const res = await fetch(url)
  const text = await res.text()
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) throw new Error('Treasury CSV empty')
  const header = lines[0].replace(/"/g, '').split(',').map(h => h.trim().toLowerCase())
  const idx10y = header.indexOf('10 yr')
  if (idx10y < 0) throw new Error('Treasury CSV no 10 Yr')
  const row = lines[1].replace(/"/g, '').split(',')
  return { date: row[0], value: parseFloat(row[idx10y]) }
}

async function fetchMacro() {
  // 美债（美国财政部，每日更新）
  try {
    const [nominal, real] = await Promise.all([
      fetchTreasuryCsv('daily_treasury_yield_curve'),
      fetchTreasuryCsv('daily_treasury_real_yield_curve')
    ])
    macroLive = {
      us10y: { value: nominal.value, date: nominal.date },
      real: { value: real.value, date: real.date }
    }
  } catch (e) {
    console.warn('Treasury macro fetch failed, use static ref:', e)
  }
  // 美国CPI + 美联储利率（东方财富数据中心，按官方公布时间自动更新）
  try {
    await Promise.all([fetchMacroCpi(), fetchMacroFed()])
  } catch (e) {
    console.warn('CPI/Fed fetch failed, use static ref:', e)
  }
}

// ============ 美国CPI与美联储利率（东方财富数据中心，公布后自动更新，CORS 开放） ============
let macroFed = null // { upper, lower, month, publish, nextPublish }
let macroCpi = null // { value, core, month, publish, nextPublish, nextMonth }

// 东财数据中心接口：RPT_ECONOMICVALUE_USANEW + INDICATOR_ID 过滤
async function fetchEastmoneyMacro(indicatorId) {
  const url = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_ECONOMICVALUE_USANEW' +
    '&columns=ALL&filter=(INDICATOR_ID%3D%22' + indicatorId + '%22)' +
    '&pageNumber=1&pageSize=4&sortColumns=REPORT_DATE&sortTypes=-1&source=WEB&client=WEB'
  const res = await fetch(url)
  const json = await res.json()
  const list = json && json.result && json.result.data
  if (!list || !list.length) throw new Error('Eastmoney macro empty: ' + indicatorId)
  let latest = null, next = null
  for (const row of list) {
    const has = row.VALUE !== null && row.VALUE !== undefined
    if (!latest && has) latest = row
    else if (!next && !has && row.PUBLISH_DATE) next = row
  }
  if (!latest) throw new Error('Eastmoney macro no latest: ' + indicatorId)
  return { latest, next }
}

async function fetchMacroCpi() {
  const [head, core] = await Promise.all([
    fetchEastmoneyMacro('EMG00000733'), // 美国CPI:非季调:当月同比
    fetchEastmoneyMacro('EMG00000746')  // 美国核心CPI:当月同比
  ])
  macroCpi = {
    value: head.latest.VALUE,
    core: core.latest ? core.latest.VALUE : null,
    month: String(head.latest.REPORT_DATE).slice(0, 7),
    publish: head.latest.PUBLISH_DATE ? String(head.latest.PUBLISH_DATE).slice(0, 10) : '',
    nextPublish: head.next ? String(head.next.PUBLISH_DATE).slice(0, 10) : '',
    nextMonth: head.next ? String(head.next.REPORT_DATE).slice(0, 7) : ''
  }
}

async function fetchMacroFed() {
  const { latest, next } = await fetchEastmoneyMacro('EMG00342250') // 美国联邦基金利率目标:上限
  const upper = latest.VALUE
  const lower = Math.round((upper - 0.25) * 100) / 100
  macroFed = {
    upper, lower,
    month: String(latest.REPORT_DATE).slice(0, 7),
    publish: latest.PUBLISH_DATE ? String(latest.PUBLISH_DATE).slice(0, 10) : '',
    nextPublish: next ? String(next.PUBLISH_DATE).slice(0, 10) : ''
  }
}

// '09/02/2026' -> '09/02'
function fmtMacroDate(d) {
  const p = String(d).split('/')
  return p.length >= 2 ? p[0] + '/' + p[1] : d
}

// '2026-07' -> '7月'
function fmtMonth(ym) {
  if (!ym) return ''
  const p = String(ym).split('-')
  return parseInt(p[1], 10) + '月'
}

// '2026-07-30' -> '7/30'
function fmtShortDate(d) {
  if (!d) return ''
  const p = String(d).split('-')
  return parseInt(p[1], 10) + '/' + parseInt(p[2], 10)
}

// ============ 新浪 JSONP 历史K线 ============
function loadSinaJsonp(url, varName) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.async = true
    const timeout = setTimeout(() => { cleanup(); reject(new Error('JSONP timeout')) }, 15000)
    function cleanup() {
      clearTimeout(timeout)
      if (script.parentNode) script.parentNode.removeChild(script)
    }
    script.onload = () => {
      const data = window[varName]
      cleanup()
      if (data) resolve(data)
      else reject(new Error('JSONP no data'))
    }
    script.onerror = () => { cleanup(); reject(new Error('JSONP load failed')) }
    document.head.appendChild(script)
  })
}

async function fetchSgeHistory() {
  const varName = 'gold_sge_hist_' + Date.now()
  const data = await loadSinaJsonp(
    'https://stock.finance.sina.com.cn/futures/api/jsonp.php/' + varName +
    '=/InnerFuturesNewService.getDailyKLine?symbol=AU0',
    varName
  )
  return data.map(item => ({
    date: item.d,
    close: parseFloat(item.c)
  }))
}

async function fetchLondonHistory() {
  const varName = 'gold_lon_hist_' + Date.now()
  const data = await loadSinaJsonp(
    'https://stock.finance.sina.com.cn/futures/api/jsonp.php/' + varName +
    '=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=XAU',
    varName
  )
  return data.map(item => ({
    date: item.date,
    close: parseFloat(item.close)
  }))
}

async function fetchComexHistory() {
  const varName = 'gold_gc_hist_' + Date.now()
  const data = await loadSinaJsonp(
    'https://stock.finance.sina.com.cn/futures/api/jsonp.php/' + varName +
    '=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=GC',
    varName
  )
  return data.map(item => ({
    date: item.date,
    close: parseFloat(item.close)
  }))
}

// ============ 渲染 ============
function renderPrices(data) {
  // 伦敦金
  if (data.xau) {
    setText('xauPrice', fmt(data.xau.price))
    applyChange($('xauChange'), data.xau.changePercent)
    $('xauChange').textContent = (data.xau.changePercent >= 0 ? '+' : '') + fmt(data.xau.changePercent) + '%'
  }
  // COMEX
  if (data.gc) {
    setText('gcPrice', fmt(data.gc.price))
    applyChange($('gcChange'), data.gc.changePercent)
    $('gcChange').textContent = (data.gc.changePercent >= 0 ? '+' : '') + fmt(data.gc.changePercent) + '%'
  }
  // 上交所
  if (data.sge) {
    setText('sgePrice', fmt(data.sge.price))
    applyChange($('sgeChange'), data.sge.changePercent)
    $('sgeChange').textContent = (data.sge.changePercent >= 0 ? '+' : '') + fmt(data.sge.changePercent) + '%' + (data.sge.fallback ? '（参考）' : '')
    $('sgePrice').title = data.sge.fallback ? 'k780 限流，已用伦敦金×汇率换算的参考价' : ''
  }
  // 美元指数
  if (data.dxy) {
    setText('dxyValue', fmt(data.dxy.now, 1))
    applyChange($('dxyChange'), data.dxy.changePct)
    $('dxyChange').textContent = '较上日 ' + fmtSign(data.dxy.change, 2) + '（' + fmtSign(data.dxy.changePct, 2) + '%）'
    $('dxyDesc').textContent = data.dxy.changePct < 0 ? '美元走弱，对金价构成支撑' : '美元走强，对金价构成压力'
  }
  // 美元兑人民币
  if (data.usdcny) {
    setText('usdcnyValue', fmt(data.usdcny.price, 4))
    applyChange($('usdcnyChange'), data.usdcny.changePercent)
    $('usdcnyChange').textContent = fmtSign(data.usdcny.changePercent, 2) + '%'
    $('usdcnyDesc').textContent = data.usdcny.changePercent < 0
      ? '人民币升值，压制国内金价（元/克）'
      : '人民币贬值，抬升国内金价（元/克）'
  }
  // WTI 原油
  if (data.oil) {
    setText('oilValue', fmt(data.oil.price))
    applyChange($('oilChange'), data.oil.changePercent)
    $('oilChange').textContent = (data.oil.changePercent >= 0 ? '+' : '') + fmt(data.oil.changePercent) + '%'
    $('oilDesc').textContent = data.oil.changePercent >= 0 ? '油价上涨→通胀预期升温，利好金价' : '油价回落→通胀压力缓和'
  }
  // 白银
  if (data.silver) {
    setText('silverValue', fmt(data.silver.price))
    applyChange($('silverChange'), data.silver.changePercent)
    $('silverChange').textContent = (data.silver.changePercent >= 0 ? '+' : '') + fmt(data.silver.changePercent) + '%'
    $('silverDesc').textContent = '贵金属联动：金银比通常同向波动'
  }

  // 宏观参考值（优先实时数据，获取失败时回退静态参考）
  const m10 = macroLive ? macroLive.us10y : MACRO_REF.us10y
  setText('us10yValue', fmt(m10.value, 2) + '%')
  $('us10yChange').textContent = macroLive ? fmtMacroDate(macroLive.us10y.date) + ' 数据' : MACRO_REF.us10y.label
  $('us10yDesc').textContent = macroLive
    ? '10Y名义收益率，与金价负相关；当前处于周期高位，曲线偏陡'
    : MACRO_REF.us10y.desc

  const mReal = macroLive ? macroLive.real : MACRO_REF.real
  setText('realValue', typeof mReal.value === 'number' ? fmt(mReal.value, 2) + '%' : mReal.value)
  $('realChange').textContent = macroLive ? fmtMacroDate(macroLive.real.date) + ' 数据' : MACRO_REF.real.label
  $('realDesc').textContent = macroLive
    ? 'TIPS 10年期实际收益率（名义收益率 − 通胀预期）'
    : MACRO_REF.real.desc

  // 美联储利率（优先实时数据，获取失败时回退静态参考）
  if (macroFed) {
    setText('fedValue', fmt(macroFed.lower, 2) + '–' + fmt(macroFed.upper, 2) + '%')
    $('fedChange').textContent = fmtMonth(macroFed.month) + 'FOMC · ' + fmtShortDate(macroFed.publish) + '公布'
    $('fedDesc').textContent = macroFed.nextPublish
      ? '最近决议' + fmtShortDate(macroFed.publish) + '发布，下次决议预计' + fmtShortDate(macroFed.nextPublish)
      : '最近决议' + fmtShortDate(macroFed.publish) + '发布'
  } else {
    setText('fedValue', MACRO_REF.fed.value)
    $('fedChange').textContent = MACRO_REF.fed.label
    $('fedDesc').textContent = MACRO_REF.fed.desc
  }

  // CPI（优先实时数据，获取失败时回退静态参考）
  if (macroCpi) {
    setText('cpiValue', fmt(macroCpi.value, 1) + '%')
    $('cpiChange').textContent = fmtMonth(macroCpi.month) + '同比 · ' + fmtShortDate(macroCpi.publish) + '公布'
    $('cpiDesc').textContent =
      (macroCpi.core != null ? '核心 ' + fmt(macroCpi.core, 1) + '%；' : '') +
      (macroCpi.nextPublish ? '下次公布 ' + fmtShortDate(macroCpi.nextPublish) + '（' + fmtMonth(macroCpi.nextMonth) + '数据）' : '')
  } else {
    setText('cpiValue', fmt(MACRO_REF.cpi.value, 1) + '%')
    $('cpiChange').textContent = MACRO_REF.cpi.label
    $('cpiDesc').textContent = MACRO_REF.cpi.desc
  }
}

// ============ 主刷新 ============
async function refreshAll() {
  if (refreshLock) return
  refreshLock = true
  setStatus('', '刷新中…')

  const codes = ['hf_GC', 'hf_XAU', 'hf_CL', 'hf_SI', 'whUSDCNY']
  const results = {
    gc: null, xau: null, oil: null, silver: null, usdcny: null,
    sge: null, dxy: null
  }

  try {
    const raw = await fetchTencent(codes)
    if (raw.hf_GC) results.gc = parseHf(raw.hf_GC.split(','))
    if (raw.hf_XAU) results.xau = parseHf(raw.hf_XAU.split(','))
    if (raw.hf_CL) results.oil = parseHf(raw.hf_CL.split(','))
    if (raw.hf_SI) results.silver = parseHf(raw.hf_SI.split(','))
    if (raw.whUSDCNY) results.usdcny = parseWh(raw.whUSDCNY.split('~'))
  } catch (e) {
    console.error('Tencent fetch failed:', e)
  }

  try {
    results.sge = await fetchSge()
  } catch (e) {
    console.error('SGE fetch failed:', e)
    // 兜底：k780 限流/失败时，用伦敦金×USD/CNY换算为元/克（SGE Au9999 参考价）
    if (results.xau && results.usdcny) {
      results.sge = {
        price: Math.round(results.xau.price * results.usdcny.price / 31.1035 * 100) / 100,
        changePercent: results.xau.changePercent,
        time: results.xau.time,
        fallback: true
      }
    }
  }

  try {
    results.dxy = await fetchDxy()
  } catch (e) {
    console.error('DXY fetch failed:', e)
  }

  // 美债宏观（名义/实际10年期收益率，每日更新）
  await fetchMacro()

  renderPrices(results)

  const okCount = [results.gc, results.xau, results.sge, results.dxy, results.usdcny].filter(Boolean).length
  if (okCount >= 3) setStatus('online', '已连接')
  else if (okCount > 0) setStatus('offline', '部分失败')
  else setStatus('offline', '连接失败')

  const now = new Date()
  setLastUpdate('最近更新 ' + now.getHours().toString().padStart(2, '0') + ':' +
    now.getMinutes().toString().padStart(2, '0') + ':' +
    now.getSeconds().toString().padStart(2, '0') + ' · ' + refreshLabel(getRefreshInterval()))
  refreshLock = false
}

// ============ 图表 ============
function renderChart(period = 30) {
  const canvas = $('priceChart')
  if (!canvas || !sgeHistoryData) return

  const ctx = canvas.getContext('2d')
  const sgeSlice = sgeHistoryData.slice(-period)
  const dates = sgeSlice.map(item => item.date.slice(5))

  const londonMap = londonHistoryData ? new Map(londonHistoryData.map(item => [item.date, item.close])) : null
  const comexMap = comexHistoryData ? new Map(comexHistoryData.map(item => [item.date, item.close])) : null

  const datasets = [{
    label: '期货·沪金AU0（元/克）',
    data: sgeSlice.map(item => item.close),
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
      label: '现货·伦敦金（美元/盎司）',
      data: sgeSlice.map(item => londonMap.get(item.date) || null),
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
      label: '期货·COMEX（美元/盎司）',
      data: sgeSlice.map(item => comexMap.get(item.date) || null),
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

  if (priceChart) priceChart.destroy()

  priceChart = new Chart(ctx, {
    type: 'line',
    data: { labels: dates, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      onClick: (e, elements) => {
        if (!elements || !elements.length) return
        const index = elements[0].index
        const date = sgeSlice[index].date
        selectedInsightDate = date
        renderInsight(date, sgeSlice)
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: context => context.dataset.label + ': ' + fmt(context.raw)
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 6, color: '#888888' }
        },
        y: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: '元/克', color: '#d4af37' },
          grid: { color: '#f0f0f0' },
          ticks: { color: '#d4af37' }
        },
        y1: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: '美元/盎司', color: '#1e88e5' },
          grid: { drawOnChartArea: false },
          ticks: { color: '#1e88e5' }
        }
      }
    }
  })
}

async function loadHistory() {
  try {
    const [sge, london, comex] = await Promise.all([
      fetchSgeHistory().catch(() => null),
      fetchLondonHistory().catch(() => null),
      fetchComexHistory().catch(() => null)
    ])
    sgeHistoryData = sge
    londonHistoryData = london
    comexHistoryData = comex
    const active = document.querySelector('#chartPeriod .period-item.active')
    renderChart(active ? parseInt(active.dataset.period) : 30)
  } catch (e) {
    console.error('History load failed:', e)
  }
}

// ============ 图表事件解读（区间视角） ============

// 将 'YYYY-MM-DD' 转为可比较的时间戳
function dateTs(date) { return new Date(date).getTime() }
function daysBetween(a, b) { return Math.round((dateTs(b) - dateTs(a)) / 86400000) }

// 找出"观察点正处于影响窗口内"的已发生事件
// 事件发生在 date - window ~ date + window 区间内，即认为该事件正持续影响观察点附近的价格
function findActiveEvents(date) {
  const t = dateTs(date)
  return GOLD_EVENTS
    .map(g => {
      const diff = Math.round((t - dateTs(g.date)) / 86400000) // 观察点距离事件发生日几天（负=事件未发生）
      return { ...g, diff }
    })
    .filter(g => Math.abs(g.diff) <= g.window)
    .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff))
}

// 找出"市场正处于提前定价期"的未来事件（预期影响）
// 观察点在 事件落地日-leadDays ~ 事件落地日 之间时，该预期正在影响价格
function findPricingEvents(date) {
  const t = dateTs(date)
  return UPCOMING_EVENTS
    .map(u => {
      const daysLeft = Math.round((dateTs(u.date) - t) / 86400000) // 距事件落地还剩几天
      return { ...u, daysLeft }
    })
    .filter(u => u.daysLeft >= 0 && u.daysLeft <= u.leadDays)
    .sort((a, b) => a.daysLeft - b.daysLeft)
}

// 观察点所在区间的价格表现（前 lookback 个交易日）
function getRangeChangeDesc(date, slice, lookback = 7) {
  const idx = slice.findIndex(item => item.date === date)
  if (idx < 0) return null
  const end = slice[idx]
  const start = slice[Math.max(0, idx - lookback + 1)]
  const change = end.close - start.close
  const changePct = (change / start.close) * 100
  const upDays = slice.slice(Math.max(0, idx - lookback + 1), idx + 1).filter((it, i, arr) => i > 0 && it.close >= arr[i - 1].close).length
  return {
    startDate: start.date,
    endDate: end.date,
    start: start.close,
    end: end.close,
    change,
    changePct,
    span: Math.min(lookback, idx + 1),
    upDays
  }
}

function tagHtml(impact) {
  const cls = impact === 'bull' ? 'bull' : impact === 'bear' ? 'bear' : 'neutral'
  const text = impact === 'bull' ? '利多黄金' : impact === 'bear' ? '利空黄金' : '中性'
  return `<span class="insight-tag ${cls}">${text}</span>`
}

function renderInsight(date, slice) {
  const insight = $('chartInsight')
  if (!insight) return

  const active = findActiveEvents(date)   // 已发生、仍在影响期的事件
  const pricing = findPricingEvents(date) // 正在被市场提前定价的未来事件
  const range = getRangeChangeDesc(date, slice)

  let html = ''
  html += `<div class="insight-title">${date} 所在区间 · 金价影响因素解读</div>`

  // —— 区间价格表现 ——
  if (range) {
    const dir = range.changePct >= 0 ? '上涨' : '下跌'
    const strong = Math.abs(range.changePct) >= 1.5
    html += `<div class="insight-block"><div class="block-label">📊 区间表现（前 ${range.span} 个交易日）</div>`
    html += `<p>自 <strong>${range.startDate}</strong> 至 <strong>${range.endDate}</strong>，金价${dir} <span class="${range.changePct >= 0 ? 'price-up' : 'price-down'}">${fmtSign(range.changePct)}%</span>（${fmt(range.start)} → ${fmt(range.end)} 元/克）。</p>`
    if (strong && range.changePct < 0) {
      html += `<p>· 该区间明显下行，通常对应美元走强、美债实际收益率上行，或市场加息预期升温。</p>`
    } else if (strong && range.changePct > 0) {
      html += `<p>· 该区间明显上行，通常对应美元走弱、地缘避险，或对财政/通胀风险的担忧发酵。</p>`
    } else {
      html += `<p>· 该区间波动相对温和，市场可能处于事件真空期，等待新的宏观数据或美联储指引。</p>`
    }
    html += `</div>`
  }

  // —— 已发生事件的持续影响 ——
  html += `<div class="insight-block"><div class="block-label">🗓 已发生事件的持续影响</div>`
  if (active.length > 0) {
    active.forEach(g => {
      const status = g.diff === 0 ? '事件当日' : g.diff > 0 ? `事件已过 ${g.diff} 天` : `${-g.diff} 天后发生`
      html += `<p>${tagHtml(g.events[0].impact)}<strong>${g.date}</strong>（${status}，影响窗口 ±${g.window} 天）</p>`
      g.events.forEach(ev => {
        html += `<p class="sub">· ${ev.title}：${ev.desc}</p>`
        if (ev.logic) html += `<p class="logic">🔗 影响逻辑：${ev.logic}</p>`
      })
    })
    html += `<p class="hint">这些事件的影响并未在当天结束，而是在窗口期内持续作用于价格。</p>`
  } else {
    html += `<p class="empty">该观察点前后暂无处于影响窗口内的已记录事件。</p>`
  }
  html += `</div>`

  // —— 未来事件的预期影响 ——
  html += `<div class="insight-block"><div class="block-label">🔮 未来事件的预期影响（市场提前定价）</div>`
  if (pricing.length > 0) {
    pricing.forEach(u => {
      html += `<p>${tagHtml(u.impact)}<strong>${u.date} · ${u.title}</strong>（距落地 ${u.daysLeft} 天，市场提前 ${u.leadDays} 天开始定价）</p>`
      html += `<p class="sub">${u.desc}</p>`
      if (u.logic) html += `<p class="logic">🔗 影响逻辑：${u.logic}</p>`
    })
    html += `<p class="hint">事件尚未发生，但其"预期"已在当前价格中提前反映，往往比事件本身更早、更持续地影响走势。</p>`
  } else {
    html += `<p class="empty">观察点之后暂无临近的预期事件。</p>`
  }
  html += `</div>`

  insight.classList.toggle('has-event', active.length > 0 || pricing.length > 0)
  insight.innerHTML = html
  insight.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

// ============ 今日金市动态 ============
function todayStr() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function renderTodayEvents() {
  const el = $('todayEvents')
  if (!el) return
  const t = todayStr()
  let list = GOLD_EVENTS
    .map(g => ({ ...g, diff: daysBetween(g.date, t) }))
    .filter(g => Math.abs(g.diff) <= g.window)
    .sort((a, b) => a.diff - b.diff)
  const isFallback = !list.length
  if (!list.length) {
    // 无当前影响事件时，展示最近两条已发生事件
    list = GOLD_EVENTS.slice(0, 2).map(g => ({ ...g, diff: daysBetween(g.date, t) }))
  }
  let html = ''
  list.forEach(g => {
    const days = g.diff
    const when = days === 0 ? '今日' : days === -1 ? '明日' : days === 1 ? '昨日' : (days < 0 ? Math.abs(days) + '天后' : Math.abs(days) + '天前')
    const e = g.events[0]
    html += `
      <div class="event-item">
        <div class="event-top">
          <span class="event-date">${fmtShortDate(g.date)} · ${when} · 影响窗口 ±${g.window}天</span>
          ${tagHtml(e.impact)}
        </div>
        <div class="event-title">${e.title}</div>
        <div class="event-desc">${e.desc}</div>
        ${e.logic ? `<div class="event-logic" hidden>${e.logic}</div><div class="event-toggle">查看逻辑链 ▾</div>` : ''}
      </div>`
  })
  el.innerHTML = html
  if (isFallback) {
    const note = document.createElement('div')
    note.className = 'insight-empty'
    note.textContent = '当前无处于影响窗口内的事件，以下为最近已发生事件。'
    el.appendChild(note)
  }
  el.querySelectorAll('.event-toggle').forEach(tg => {
    tg.addEventListener('click', () => {
      const lg = tg.parentNode.querySelector('.event-logic')
      if (!lg) return
      const open = lg.hidden
      lg.hidden = !open
      tg.textContent = open ? '收起逻辑链 ▴' : '查看逻辑链 ▾'
    })
  })
}

const GOLD_NEWS_KEYWORDS = ['黄金', '金价', '伦敦金', '现货金', 'COMEX', '期金', '金银', '金市', '美联储', '美元指数', '美债', '非农', 'CPI', '避险']
const NEWS_REFRESH_MS = 30 * 60 * 1000

function nowTime() {
  const d = new Date()
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

let _newsSource = '东方财富'

// 渲染快讯列表（按关键词过滤）
function renderNewsItems(items) {
  const listEl = $('newsList')
  const metaEl = $('newsMeta')
  if (!listEl) return
  const filtered = (items || [])
    .filter(it => (it.title || '') && GOLD_NEWS_KEYWORDS.some(k => it.title.includes(k)))
    .slice(0, 6)
  if (!filtered.length) {
    listEl.innerHTML = '<div class="news-empty">近30分钟内暂无与黄金直接相关的快讯</div>'
  } else {
    listEl.innerHTML = filtered.map(it => {
      const ct = it.time || it.showTime || ''
      const t = ct.length >= 16 ? ct.slice(11, 16) : ''
      return `<div class="news-item"><span class="news-time">${t}</span><span class="news-text">${it.title}</span></div>`
    }).join('')
  }
  if (metaEl) metaEl.textContent = '更新于 ' + nowTime() + ' · ' + _newsSource
}

// 备用源：新浪7x24快讯（JSONP，绕过CORS限制）
function loadGoldNewsSina() {
  return new Promise((resolve) => {
    const cb = 'sinaGoldNews_' + Date.now()
    const script = document.createElement('script')
    const timer = setTimeout(cleanup, 8000)
    function cleanup() {
      clearTimeout(timer)
      try { delete window[cb] } catch (e) { window[cb] = undefined }
      if (script.parentNode) script.parentNode.removeChild(script)
    }
    window[cb] = (json) => {
      const list = (json && json.result && json.result.data && json.result.data.feed && json.result.data.feed.list) || []
      const items = list
        .filter(it => (it.rich_text || '').trim())
        .map(it => ({ title: it.rich_text.trim(), time: it.create_time || it.update_time || '' }))
      cleanup()
      resolve(items)
    }
    script.src = 'https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=20&zhibo_id=152&tag_id=0&dire=f&dpc=1&pagesize=20&callback=' + cb
    document.head.appendChild(script)
  })
}

async function loadGoldNews() {
  const listEl = $('newsList')
  if (!listEl) return
  // 主源：东方财富7x24快讯（CORS）
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    const res = await fetch('https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=50&req_trace=' + Date.now(), { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const json = await res.json()
    const arr = (json.data && json.data.fastNewsList) || []
    _newsSource = '东方财富'
    renderNewsItems(arr.map(it => ({ title: it.title, time: it.showTime })))
    return
  } catch (e) {
    // 备用源：新浪
    try {
      const items = await loadGoldNewsSina()
      if (items.length) {
        _newsSource = '新浪财经'
        renderNewsItems(items)
        return
      }
    } catch (e2) {}
    listEl.innerHTML = '<div class="news-empty">快讯获取失败，稍后自动重试</div>'
    const metaEl = $('newsMeta')
    if (metaEl) metaEl.textContent = '连接异常'
  }
}

function initTodayDynamics() {
  renderTodayEvents()
  loadGoldNews()
  setInterval(loadGoldNews, NEWS_REFRESH_MS)
}

// ============ 自动刷新控制 ============
function updateRefreshSettingBtn() {
  const btn = $('btnRefreshSetting')
  if (btn) btn.textContent = refreshLabel(getRefreshInterval()) + ' ▾'
}

function restartAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer)
  const interval = getRefreshInterval()
  if (interval > 0) {
    refreshTimer = setInterval(refreshAll, interval * 1000)
  } else {
    refreshTimer = null
  }
  updateRefreshSettingBtn()
}

function setRefreshFromPrompt() {
  const items = REFRESH_OPTIONS.map((o, i) => i + '. ' + o.label).join('\n')
  const current = getRefreshInterval()
  const defaultIdx = Math.max(0, REFRESH_OPTIONS.findIndex(o => o.value === current))
  const selected = prompt(
    '选择自动刷新频率（输入 0-' + (REFRESH_OPTIONS.length - 1) + '）：\n' + items,
    defaultIdx
  )
  const idx = parseInt(selected)
  if (isNaN(idx) || idx < 0 || idx >= REFRESH_OPTIONS.length) return
  setRefreshInterval(REFRESH_OPTIONS[idx].value)
}

// ============ 事件 ============
$('btnRefresh').addEventListener('click', () => {
  refreshAll()
  loadHistory()
})

const refreshSettingBtn = $('btnRefreshSetting')
if (refreshSettingBtn) refreshSettingBtn.addEventListener('click', setRefreshFromPrompt)

document.querySelectorAll('#chartPeriod .period-item').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('#chartPeriod .period-item').forEach(i => i.classList.remove('active'))
    el.classList.add('active')
    renderChart(parseInt(el.dataset.period))
    // 切换周期后清空解读
    selectedInsightDate = null
    const insight = $('chartInsight')
    if (insight) {
      insight.classList.remove('has-event')
      insight.innerHTML = `
        <div class="insight-title">📍 点击图表任意日期，以该日为观察点解读所在区间</div>
        <div class="insight-body">展示该观察点所处时间区间内的价格表现、已发生事件的持续影响，以及市场对未来事件的预期定价。</div>
      `
    }
  })
})

// ============ 初始化 ============
initTodayDynamics()
refreshAll()
loadHistory()
restartAutoRefresh()
