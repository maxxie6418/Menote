/* ============================================================
   Menote 页面框架（线框）回归验证脚本
   ------------------------------------------------------------
   用 jsdom 加载 menote-framework.html 并真实执行页面脚本，
   校验「分块 + 标注 + 翻页」这一层交互是否完好，捕获运行时错误。

   运行：
     npm install jsdom
     NODE_PATH=<node_modules 路径> node verify-framework.js

   注意：页面用「页名」定位，不用下标 —— 增删页面后不会假失败。

   覆盖：页面切换器 13 标签 / 逐页渲染不抛错 / 面板标题与标签一致 /
         区块名与说明文字齐全 / 顶栏 6 块且账户入口紧邻隐私锁胶囊 /
         浏览三段（首页 / Memo / 待办 合并成一行）/ 加密空间贴底且无小标题 / 待办独立视图 /
         Memo 去清单 / 录入框三模式与去加密 / 录入框行序（附加项在模式行之上）/
         最近编辑·收藏·标签与加密空间的双栏（侧滑详情保留但不触发）/
         主题（Claude 橙白双主题）/
         点块进块详情 / 嵌套块选内层 / 返回页面说明 / chip 反向跳转 /
         Esc 退出 / 键盘左右切页 / 切页清选中 / 块说明与网格两个开关
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const abs = 'F:/Git/MeNote/prototype/menote-framework.html';
const file = fs.existsSync(abs) ? abs : path.join(__dirname, 'menote-framework.html');
const html = fs.readFileSync(file, 'utf8');

const errs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errs.push('[jsdomError] ' + e.message));
vc.on('error', (...a) => errs.push('[console.error] ' + a.join(' ')));

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;
const doc = window.document;
const $ = s => doc.querySelector(s);
const $$ = s => Array.from(doc.querySelectorAll(s));
const click = el => { if (!el) throw new Error('目标元素不存在'); el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); };
const key = k => doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }));
const tabName = () => $('.fw-tab.on').textContent.replace(/^\d+/, '').trim();
const inspTitle = () => ($('#insp h2') || $('#insp h3')) ? ($('#insp h2') || $('#insp h3')).textContent.trim() : '';
const tabNames = () => $$('.fw-tab').map(t => t.textContent.replace(/^\d+/, '').trim());
/* 按页名切页：页面增删或重新编号后脚本依然有效 */
const gotoPage = name => {
  const i = tabNames().indexOf(name);
  if (i < 0) throw new Error('找不到页面「' + name + '」，现有：' + tabNames().join(' / '));
  click($$('.fw-tab')[i]);
  return i;
};
const noteOf = id => {
  const el = $('#canvas [data-b="' + id + '"]');
  if (!el) throw new Error('缺区块 ' + id);
  return el.querySelector('.blk-note').textContent;
};
/* 点开块详情后取说明面板全文（含 .blk-note 里放不下的要点列表） */
const blockText = id => {
  const el = $('#canvas [data-b="' + id + '"]');
  if (!el) throw new Error('缺区块 ' + id);
  click(el);
  const box = $('#insp .insp-block');
  if (!box) throw new Error('未进入块详情：' + id);
  return box.textContent;
};

let pass = 0, fail = 0;
const step = (name, fn) => {
  try { if (fn() === false) throw new Error('断言失败'); console.log('  OK   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '  → ' + e.message); errs.push(name + ': ' + e.message); fail++; }
};

console.log('=== 页面框架验证 ===');

step('页面切换器渲染 13 个标签', () => {
  const n = $$('.fw-tab').length;
  if (n !== 13) throw new Error('实际 ' + n + ' 个：' + tabNames().join(' / '));
});

step('页面清单含新增的「首页」与「待办」（v2 Q1 / M02-03）', () => {
  const names = tabNames();
  ['首页', '待办', 'Memo', '功能栏', '设置'].forEach(n => {
    if (!names.includes(n)) throw new Error('缺页面「' + n + '」');
  });
});

step('默认停在「全局框架」', () => {
  if (tabName() !== '全局框架') throw new Error('默认页为 ' + tabName());
});

step('说明面板显示页面说明 + 区块清单', () => {
  if (!$('#insp .insp-page')) throw new Error('无页面说明');
  if (!$$('#insp .insp-chip').length) throw new Error('无区块清单');
});

step('逐页切换：全部页面渲染且不抛错（面板标题 === 标签名）', () => {
  const bad = [];
  const total = tabNames().length;
  for (let i = 0; i < total; i++) {
    const errBefore = errs.length;
    click($$('.fw-tab')[i]);
    const name = tabName();
    if (errs.length > errBefore) { bad.push(name + ' 抛错: ' + errs[errs.length - 1]); continue; }
    if (inspTitle() !== name) bad.push(name + ' 面板标题为「' + inspTitle() + '」（说明画布未刷新）');
    const n = $$('#canvas [data-b]').length;
    if (n < 2) bad.push(name + ' 区块数 ' + n);
    if (!$$('#insp .insp-chip').length) bad.push(name + ' 无区块清单');
  }
  if (bad.length) throw new Error(bad.join('；'));
});

step('每页区块都有名称与说明文字', () => {
  const bad = [];
  const total = tabNames().length;
  for (let i = 0; i < total; i++) {
    click($$('.fw-tab')[i]);
    const name = tabName();
    $$('#canvas .blk').forEach(b => {
      const nm = b.querySelector('.blk-name');
      const nt = b.querySelector('.blk-note');
      if (!nm || !nm.textContent.trim()) bad.push(name + '/' + b.dataset.b + ' 缺块名');
      if (!nt || !nt.textContent.trim()) bad.push(name + '/' + b.dataset.b + ' 缺说明');
    });
  }
  if (bad.length) throw new Error(bad.slice(0, 6).join('；'));
});

step('区块总数统计', () => {
  const all = new Set();
  const total = tabNames().length;
  for (let i = 0; i < total; i++) {
    click($$('.fw-tab')[i]);
    $$('#insp .insp-chip').forEach(c => all.add(c.dataset.b));
  }
  console.log('       （字典共 ' + all.size + ' 个区块）');
});

step('顶栏页：含账户入口，紧邻隐私锁胶囊（6 块，2026-09-26 调整）', () => {
  gotoPage('顶栏');
  const strip = $$('#canvas .blk-strip > [data-b]').map(el => el.getAttribute('data-b'));
  if (strip.length !== 6) throw new Error('顶栏区块数 ' + strip.length + '：' + strip.join('/'));
  if (strip.join('/') !== 'brand/crumb/search/syncPill/capsule/topAccount') {
    throw new Error('顶栏块序不对：' + strip.join('/'));
  }
  if ($('#canvas [data-b="fnAccount"]')) throw new Error('旧的功能栏账户块仍在');
  if (!blockText('topAccount').includes('移回顶栏')) throw new Error('账户块未说明由功能栏底部移回');
  if (!blockText('topAccount').includes('设置')) throw new Error('账户块未说明「设置」在菜单里');
  if (!blockText('fnbar').includes('移回顶栏')) throw new Error('功能栏未说明账户区已移回顶栏');
});

step('浮层页：账户快捷菜单作为独立浮层，内容可配置（2026-09-26 更正）', () => {
  gotoPage('浮层');
  const qm = $('#canvas [data-b="quickMenu"]');
  if (!qm) throw new Error('浮层页缺账户快捷菜单块');
  const drawer = $('#canvas [data-b="drawer"]');
  if (!drawer) throw new Error('浮层页缺滑出详情块');
  // 结构：快捷菜单与滑出详情同属右列「其他浮层」，且快捷菜单在前
  if (qm.parentElement !== drawer.parentElement)
    throw new Error('快捷菜单不在「其他浮层」右列里');
  if (!(qm.compareDocumentPosition(drawer) & 4)) throw new Error('快捷菜单应在滑出详情之前');
  // 文案（会触发重渲染）
  if (!blockText('quickMenu').includes('点')) throw new Error('快捷菜单块未说明触发方式');
  if (!blockText('quickMenu').includes('配置')) throw new Error('快捷菜单块未说明内容可配置');
  if (!blockText('menu').includes('账户快捷菜单')) throw new Error('下拉菜单块未把账户快捷菜单算作复用场景');
});

step('功能栏页：新建笔记 / 笔记本新建入口 / 已无底部账户区', () => {
  gotoPage('功能栏');
  ['newBtn', 'nbAdd'].forEach(id => {
    if (!$('#canvas [data-b="' + id + '"]')) throw new Error('缺区块 ' + id);
  });
  if (!noteOf('newBtn').includes('新建笔记')) throw new Error('新建按钮未直连笔记');
  if ($('#canvas [data-b="fnAccount"]')) throw new Error('功能栏底部仍有账户区');
  if ($('#canvas [data-b="fnFoot"]')) throw new Error('底部仍有独立回收站 / 设置区块');
});

step('导航按 v2 Q1 重排 + 浏览三段合并（2026-09-26 调整）', () => {
  gotoPage('功能栏');
  const seg = $('#canvas [data-b="navSeg"]');
  if (!seg) throw new Error('导航缺「浏览三段」');
  // —— 先做结构检查：blockText 会点块触发画布重渲染，之后 DOM 引用会失效 ——
  if ($('#canvas [data-b="navHome"]')) throw new Error('旧的独立首页块仍在');
  const segBox = seg.parentElement;
  if (segBox !== $('#canvas [data-b="navMain"]').parentElement) throw new Error('浏览三段与主导航不在同一容器');
  const kids = Array.from(segBox.children).map(el => el.getAttribute('data-b'));
  if (!(kids.indexOf('navSeg') < kids.indexOf('navMain'))) throw new Error('浏览三段未排在主导航之上');
  // —— 再做文字检查（会重渲染，故放最后）——
  const segText = blockText('navSeg');
  ['首页', 'Memo', '待办'].forEach(x => {
    if (!segText.includes(x)) throw new Error('浏览三段描述缺「' + x + '」：' + segText);
  });
  if (!segText.includes('横向一行')) throw new Error('浏览三段未说明压成一行：' + segText);
  if (!segText.includes('视图跳转')) throw new Error('浏览三段未说明合并依据：' + segText);
  if (!segText.includes('下划线页签')) throw new Error('浏览三段未说明造型与模式选择的区分：' + segText);
  if (!segText.includes('计数徽标')) throw new Error('浏览三段未说明不带数字：' + segText);
  const nav = blockText('navMain');
  ['最近编辑', '收藏'].forEach(x => {
    if (!nav.includes(x)) throw new Error('主导航描述缺「' + x + '」：' + nav);
  });
  if (!nav.includes('浏览三段')) throw new Error('主导航未说明首页/Memo/待办已抽走：' + nav);
});

step('加密空间：无分组小标题，贴底固定在功能栏底部（2026-09-26 调整）', () => {
  gotoPage('功能栏');
  const vn = $('#canvas [data-b="navVault"]');
  if (!vn) throw new Error('缺加密空间区块');
  // 贴底：是所在容器最后一个元素
  if (vn.parentElement.lastElementChild !== vn) throw new Error('加密空间不是功能栏最底部的一段');
  // 不再嵌在可滚动的导航容器内
  const navBox = $('#canvas [data-b="navTags"]').parentElement;
  if (navBox.contains(vn)) throw new Error('加密空间仍嵌在导航容器里');
  // 字典说明已更新
  const n = blockText('navVault');
  if (!n.includes('贴底')) throw new Error('加密空间未标注「贴底」：' + n);
  if (!n.includes('小标题')) throw new Error('加密空间未标注去掉小标题：' + n);
});
step('Memo 页：页内二级侧栏 + 时间轴 / 瀑布流互斥，清单已移出（v2 Q1 / M06-10 / 2026-09-27 调整）', () => {
  gotoPage('Memo');
  ['memoHead', 'memoMode', 'memoAdd', 'dayGroup', 'memoItem', 'waterfall', 'gateState',
   'subStat', 'subHeat', 'subWalk', 'subDay', 'subFilter'].forEach(id => {
    if (!$('#canvas [data-b="' + id + '"]')) throw new Error('Memo 页缺区块 ' + id);
  });
  const tabs = noteOf('memoMode');
  if (!tabs.includes('时间轴') || !tabs.includes('瀑布流')) throw new Error('缺时间轴/瀑布流：' + tabs);
  if (tabs.includes('清单并入')) throw new Error('仍写「清单并入 Memo」：' + tabs);
  /* 侧栏是一个容器，五段都在里面；两种视图在它右侧的主区里，不被塞进侧栏 */
  const side = $('#canvas [data-b="subStat"]').parentElement;
  if (!side.contains($('#canvas [data-b="subFilter"]'))) throw new Error('侧栏的几段不在同一个容器里');
  if (side.contains($('#canvas [data-b="waterfall"]'))) throw new Error('瀑布流被塞进了侧栏');
  ['taskList', 'kanban', 'taskFilterPills', 'taskFilterFloat', 'taskDetail'].forEach(id => {
    if ($('#canvas [data-b="' + id + '"]')) throw new Error('Memo 页仍包含清单区块 ' + id);
  });
  /* —— 文字检查（blockText 会重渲染，故放在结构检查之后）—— */
  if (!blockText('memoMode').includes('互斥')) throw new Error('视图切换未说明两者互斥');
  const wfText = blockText('waterfall');
  ['4 列', '840'].forEach(x => {
    if (!wfText.includes(x)) throw new Error('瀑布流未写「' + x + '」：' + wfText);
  });
});

step('待办页：页头一条 + 筛选条两形态 + 列表 / 看板互斥 + 详情浮层 + 门禁（2026-09-27 调整）', () => {
  gotoPage('待办');
  ['taskHead', 'taskMode', 'taskAdd', 'taskFilterPills', 'taskFilterFloat',
   'taskList', 'kanban', 'taskDetail', 'gateState'].forEach(id => {
    if (!$('#canvas [data-b="' + id + '"]')) throw new Error('待办页缺区块 ' + id);
  });
  /* —— 结构检查先做：blockText 会点块触发重渲染，之后旧的 DOM 引用会失效 —— */
  const mode = $('#canvas [data-b="taskMode"]');
  const add = $('#canvas [data-b="taskAdd"]');
  if (mode.parentElement !== add.parentElement) throw new Error('视图切换与添加不在页头同一行');
  if (!(mode.compareDocumentPosition(add) & 4)) throw new Error('视图切换应排在添加之前');
  const pillsEl = $('#canvas [data-b="taskFilterPills"]');
  const floatEl = $('#canvas [data-b="taskFilterFloat"]');
  if (pillsEl.parentElement !== floatEl.parentElement) throw new Error('筛选条两形态不在同一容器里');
  /* —— 文字检查 —— */
  const pills = noteOf('taskFilterPills');
  if (!pills.includes('胶囊')) throw new Error('胶囊形态未说明造型：' + pills);
  const float = noteOf('taskFilterFloat');
  ['悬浮', '不占横排空间', '列表模式'].forEach(x => {
    if (!float.includes(x)) throw new Error('悬浮形态未写「' + x + '」：' + float);
  });
  if (!blockText('taskFilterPills').includes('920')) throw new Error('胶囊形态未说明与列表同一上限');
  if (!blockText('taskFilterFloat').includes('设置')) throw new Error('悬浮形态未说明将来在设置里自选');
  if (!blockText('kanban').includes('80%')) throw new Error('看板未说明宽度 = 主操作区 80%');
  const dt = blockText('taskDetail');
  ['不推挤', '遮罩'].forEach(x => {
    if (!dt.includes(x)) throw new Error('详情浮层未说明「' + x + '」：' + dt);
  });
});

step('首页页：页头读数 + 中部两栏（一主一副）+ 裸行动作 + 分组快速导航（2026-10-04 布局重排）', () => {
  gotoPage('首页');
  ['homeHead', 'homeToday', 'homeRecent', 'homeActs', 'homeNav'].forEach(id => {
    if (!$('#canvas [data-b="' + id + '"]')) throw new Error('首页缺区块 ' + id);
  });
  // 条目统计已从独立区块改成**页头读数**，所以它不再是一个可点的块
  if ($('#canvas [data-b="homeStats"]')) throw new Error('条目统计仍是独立区块（应并入页头读数）');
  if (!blockText('homeHead').includes('读数')) throw new Error('首页头部未说明承载统计读数');
  // 中部两栏：今日待办（主）在前、最近动态（副）在后，同一行
  const today = $('#canvas [data-b="homeToday"]');
  const recent = $('#canvas [data-b="homeRecent"]');
  if (today.parentElement !== recent.parentElement) throw new Error('今日待办与最近动态不在同一行');
  if (!(today.compareDocumentPosition(recent) & 4)) throw new Error('今日待办应排在最近动态之前');
  // 主次做在外壳上：主卡带框（solid），副块无框
  if (!today.classList.contains('solid')) throw new Error('今日待办主卡未标注带框');
  if (recent.classList.contains('solid')) throw new Error('最近动态副块不应带框');
  // 快捷方式是裸行（无外壳）、快速导航分三组
  if (!noteOf('homeActs').includes('裸行')) throw new Error('快捷方式未说明收成裸行：' + noteOf('homeActs'));
  ['文件夹', '标签', '常用视图'].forEach(x => {
    if (!noteOf('homeNav').includes(x)) throw new Error('快速导航缺「' + x + '」');
  });
});

step('快速录入框：模式为 Memo / 待办 / 笔记 三档', () => {
  gotoPage('功能栏');
  const s = noteOf('modeTabs');
  ['Memo', '待办', '笔记'].forEach(m => {
    if (!s.includes(m)) throw new Error('模式缺 ' + m + '：' + s);
  });
});

step('录入框不再提供加密选项（v2 M04-02）', () => {
  gotoPage('功能栏');
  const n = blockText('composerExtra');
  if (!n.includes('不提供加密选项')) throw new Error('未标注创建时不提供加密：' + n);
  if (/笔记：首行作标题 \/ 根目录 \/ 加密/.test(n)) throw new Error('笔记附加项仍列出「加密」：' + n);
});

step('模式附加项：锁定只占一排（26px），切换不推挤', () => {
  gotoPage('功能栏');
  const n = noteOf('composerExtra');
  if (!n.includes('锁定')) throw new Error('附加项未标注为锁定一排：' + n);
  if (!n.includes('一排')) throw new Error('附加项未标注排数：' + n);
  const style = $('#canvas [data-b="composerExtra"]').getAttribute('style') || '';
  if (!/height:\s*26px/.test(style)) throw new Error('附加项容器不是一排高度：' + style);
});

step('录入框顺序：输入区 → 附加项 → 模式行（2026-09-26 调整）', () => {
  gotoPage('功能栏');
  const all = $$('#canvas [data-b]').map(el => el.getAttribute('data-b'));
  const iInput = all.indexOf('composerInput');
  const iExtra = all.indexOf('composerExtra');
  const iTabs = all.indexOf('modeTabs');
  const iPub = all.indexOf('composerPublish');
  if ([iInput, iExtra, iTabs, iPub].some(i => i < 0)) {
    throw new Error('录入框区块有缺失：' + all.join(','));
  }
  const seq = [iInput, iExtra, iTabs, iPub];
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] < seq[i - 1]) {
      throw new Error('录入框顺序应为主要 → 附加项 → 模式行，实际 ' + all.slice(iInput, iPub + 1).join(' → '));
    }
  }
  const n = noteOf('composerExtra');
  if (!n.includes('之上')) throw new Error('附加项未标注位于模式选择之上：' + n);
});

step('录入框已压缩：取消独立发布行，发布按钮与模式选择同行', () => {
  gotoPage('功能栏');
  if ($('#canvas [data-b="composerFoot"]')) throw new Error('独立发布行仍在');
  const row = $('#canvas [data-b="modeTabs"]').parentElement;
  const pub = $('#canvas [data-b="composerPublish"]');
  if (!pub) throw new Error('缺发布按钮');
  if (pub.parentElement !== row) throw new Error('发布按钮未与模式选择同行');
  const order = Array.from(row.children).map(el => el.dataset.b);
  if (order.join('/') !== 'modeTabs/composerPublish') throw new Error('行内顺序不对：' + order.join('/'));
  if (!pub.textContent.includes('发布')) throw new Error('发布按钮文案不对');
});

step('设置页：两栏分页 —— 左列分类导航 + 右侧当前分类内容（§7.5）', () => {
  gotoPage('设置');
  const nav = $('#canvas [data-b="setNav"]');
  const right = $('#canvas [data-b="setPageHead"]');
  if (!nav) throw new Error('设置页无左列分类导航');
  if (!right) throw new Error('设置页无当前分类的页头');
  // 结构检查必须在 blockText 之前做：blockText 会点区块 → 画布重渲染 → 引用失效
  if (nav.parentElement !== right.parentElement.parentElement)
    throw new Error('分类导航与当前分类内容不在同一行');
  if (!(nav.compareDocumentPosition(right) & 4))
    throw new Error('分类导航不在当前分类内容的左侧');
  const rightBox = right.parentElement;
  if (!rightBox.contains($('#canvas [data-b="startViewSet"]')))
    throw new Error('当前分类的卡片未装在右列容器里');
  if (!$('#canvas [data-b="setTrash"]')) throw new Error('设置页无「版本与回收站」');
  // 文案（会触发重渲染）
  if (!blockText('setNav').includes('10 个分类')) throw new Error('分类导航未说明分类数量');
  if (!blockText('setNav').includes('实例管理')) throw new Error('分类导航未列实例管理');
  if (!blockText('setPageHead').includes('返回设置')) throw new Error('分类页头未说明下级页面的返回行为');
  if (!blockText('startViewSet').includes('不显示')) throw new Error('启动视图未说明首页项显隐规则');
  if (!blockText('startViewSet').includes('主题')) throw new Error('通用页未列入主题偏好');
});

step('主题：默认浅色，可切到深色并写回 data-theme（Claude 橙白双主题）', () => {
  const html = $('#canvas').ownerDocument.documentElement;
  if (html.getAttribute('data-theme') !== 'light') throw new Error('默认不是浅色：' + html.getAttribute('data-theme'));
  const btn = $('#swTheme');
  if (!btn) throw new Error('工具栏缺主题开关');
  if (!btn.textContent.includes('浅色')) throw new Error('主题开关文案未跟随：' + btn.textContent);
  click(btn);
  if (html.getAttribute('data-theme') !== 'dark') throw new Error('未切到深色');
  if (!btn.textContent.includes('深色')) throw new Error('深色下文案未更新：' + btn.textContent);
  click(btn);
  if (html.getAttribute('data-theme') !== 'light') throw new Error('未切回浅色');
});

step('主题令牌：浅色与深色两套变量都已定义', () => {
  const css = $$('style').map(s => s.textContent).join('\n');
  // 2026-09-26 换色：Cloudflare 色系，浅色底由奶油白 #faf9f5 改为纯白
  if (!/[^-]:root\{[\s\S]*?--bg:#ffffff/.test(css)) throw new Error('缺浅色令牌（--bg:#ffffff）');
  if (!/--wf-sel:#f6821f/.test(css)) throw new Error('线框选中色不是 Cloudflare 橙 #f6821f');
  const stale = css.match(/#faf9f5|#f4f2eb|#d97757|#c2603f|#1f1e1b/);
  if (stale) throw new Error('仍有旧 Claude 暖色残留：' + stale[0]);
  const dark = css.match(/\[data-theme="dark"\]\{[\s\S]*?\}/);
  if (!dark) throw new Error('缺深色令牌块');
  ['--bg', '--text', '--wf-sel'].forEach(v => {
    if (!dark[0].includes(v + ':')) throw new Error('深色块缺变量 ' + v);
  });
});

step('笔记本正文：加密状态条与尺寸提示条已并入状态栏', () => {
  gotoPage('笔记本');
  ['secBar', 'sizeWarn'].forEach(id => {
    if ($('#canvas [data-b="' + id + '"]')) throw new Error('仍存在独立块 ' + id);
  });
  const st = $('#canvas [data-b="docStatus"]');
  if (!st) throw new Error('缺正文状态栏');
  if (!st.textContent.includes('唯一一条')) throw new Error('状态栏未标注为合并后唯一一条');
});

step('最近编辑 / 收藏 / 标签页：主操作区改为「列表 + 正文」双栏（2026-09-26 调整）', () => {
  gotoPage('最近编辑 · 收藏 · 标签');
  const list = $('#canvas [data-b="listHead"]');
  const docH = $('#canvas [data-b="docHead"]');
  if (!list || !docH) throw new Error('缺列表栏或正文栏');
  if (list.parentElement === docH.parentElement) throw new Error('列表与正文仍同栏，未拆成双栏');
  if (!$('#canvas [data-b="editorPane"]')) throw new Error('正文栏缺编辑区');
  // 侧滑详情保留为独立区块，不再作为浮层覆盖主操作区
  const dr = $('#canvas [data-b="drawer"]');
  if (!dr) throw new Error('侧滑详情块被删除（应保留能力备用）');
  if (dr.closest('.wf-overlay')) throw new Error('侧滑详情仍以浮层覆盖主操作区，应改为独立区块');
  const n = blockText('drawer');
  if (!n.includes('保留')) throw new Error('侧滑详情未标注为保留能力：' + n);
  if (!n.includes('不再由条目列表点击触发')) throw new Error('侧滑详情未标注不再由列表触发：' + n);
});

step('加密空间页：锁定态整块 + 解锁后「列表 + 正文」双栏（2026-09-26 调整）', () => {
  gotoPage('加密空间');
  if (!$('#canvas [data-b="vaultLocked"]')) throw new Error('缺锁定态占位');
  const tree = $('#canvas [data-b="vaultTree"]');
  const docH = $('#canvas [data-b="docHead"]');
  if (!tree || !docH) throw new Error('解锁后缺列表栏或正文栏');
  if (tree.parentElement === docH.parentElement) throw new Error('加密空间仍是单栏，未拆成双栏');
  if (!$('#canvas [data-b="editorPane"]')) throw new Error('加密空间正文栏缺编辑区');
  if (!$('#canvas [data-b="vaultNode"]')) throw new Error('缺侧边栏空间节点');
  // 文字检查（blockText 会重渲染，放最后）
  if (!blockText('vaultHead').includes('列表栏顶部')) throw new Error('空间状态头未标注位于列表栏顶部');
  if (!blockText('vaultTree').includes('明文')) throw new Error('空间内条目未说明为明文存储、由门禁隐藏');
});

step('点击线框块 → 说明面板切到块详情', () => {
  gotoPage('顶栏');
  click($('#canvas [data-b="capsule"]'));
  if (!$('#insp .insp-block')) throw new Error('未进入块详情');
  if (!inspTitle().includes('隐私锁胶囊')) throw new Error('块名不对：' + inspTitle());
  if (!$$('#insp .insp-block li').length) throw new Error('无要点列表');
  if (!$('.blk.sel')) throw new Error('块未高亮');
});

step('嵌套块：点内层选中内层', () => {
  gotoPage('全局框架');
  click($('#canvas [data-b="fnbar"]'));
  if (!inspTitle().includes('功能栏')) throw new Error('选中了 ' + inspTitle());
});

step('返回页面说明', () => {
  click($('#backPage'));
  if (!$('#insp .insp-page')) throw new Error('未返回');
  if ($('.blk.sel')) throw new Error('高亮未清除');
});

step('点说明面板的区块 chip → 块详情', () => {
  gotoPage('全局框架');
  click($$('#insp .insp-chip').find(c => c.dataset.b === 'work'));
  if (!inspTitle().includes('主操作区')) throw new Error('未跳转');
});

step('Esc 退出块详情', () => {
  key('Escape');
  if (!$('#insp .insp-page')) throw new Error('未退出');
});

step('键盘左右切页', () => {
  gotoPage('全局框架');
  key('ArrowRight');
  if (tabName() !== '顶栏') throw new Error('右切到 ' + tabName());
  key('ArrowLeft');
  if (tabName() !== '全局框架') throw new Error('左切到 ' + tabName());
});

step('切页时清除块选中', () => {
  click($('#canvas [data-b]'));
  key('ArrowRight');
  if ($('.blk.sel')) throw new Error('选中未清除');
});

step('「块说明」开关切换块内说明文字', () => {
  const sw = $('#swNote');
  if (!sw.classList.contains('on')) throw new Error('初始应为开');
  click(sw);
  if (sw.classList.contains('on')) throw new Error('未关闭');
  if (!$('#canvas').classList.contains('nonote')) throw new Error('未应用 nonote');
  click(sw);
  if ($('#canvas').classList.contains('nonote')) throw new Error('未恢复');
});

step('「网格」开关切换', () => {
  const sw = $('#swGrid');
  const before = $('#canvas').classList.contains('grid');
  click(sw);
  if ($('#canvas').classList.contains('grid') === before) throw new Error('未切换');
  click(sw);
  if ($('#canvas').classList.contains('grid') !== before) throw new Error('未恢复');
});

console.log('\n=== 结果：通过 ' + pass + ' / 失败 ' + fail + ' ===');
console.log('=== 捕获的脚本错误 ===');
console.log(errs.length ? errs.join('\n') : '无');
window.close();
process.exit(fail ? 1 : 0);
