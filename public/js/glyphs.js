/* ---------------------------------------------------------------------------
 * 图标引擎
 *
 * 公众号编辑器会清洗 class、外部样式、SVG 与外链字体，所以这里的图标一律用
 * 「Unicode 字符 + CSS 图形」画出来，全部携带内联样式：
 *   1. 不需要上传图片，不占公众号素材配额，也不会触发图片大小限制；
 *   2. 颜色、字号、行距跟随当前模板与强调色，换模板不用重做；
 *   3. 复制到公众号后仍是普通 span，格式不掉。
 *
 * 图形统一按 24 × 24 的设计网格绘制，再按目标尺寸缩放。
 * ------------------------------------------------------------------------- */

const GLYPH_FONT =
  "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Segoe UI Symbol',sans-serif";

// 这些字符在部分系统里默认按彩色 emoji 显示，追加 U+FE0E 强制文字形态，
// 保证图标是单色、可被 color 控制。
const TEXT_PRESENTATION = new Set([
  '☎', '✈', '✉', '☀', '☁', '☂', '❄', '♥', '⚙', '⚖', '⚛', '♻', '✂', '✏', '✎',
  '☺', '☹', '⚑', '', '⚠', '☾', '☽', '♪', '☜', '☞', '☝', '☟', '▶', '⌂', '', '',
  '', '❦', '✿', '', '', '✒', '⌛', '⏳', '↔', '↗', '↘', '⇄', '☑', '', '♨',
]);

/* ------------------------------ 绘图小工具 ------------------------------- */

const node = (style, inner = '') => `<span style="${style}">${inner}</span>`;

// 线宽统一用 24 网格单位表达，再交给 p() 缩放，
// 这样 12px 与 48px 的图标线条粗细比例一致（不会因为缩放二次放大）。
const sw = (p, stroke) => round(Math.max(0.8, p(stroke)), 2);

function abs(p, x, y, w, h, extra) {
  return node(`position:absolute;left:${p(x)}px;top:${p(y)}px;width:${p(w)}px;height:${p(h)}px;${extra}`);
}

function bar(p, x, y, w, h, color, radius = 0, rotate = 0) {
  return abs(
    p, x, y, w, h,
    `background-color:${color};${radius ? `border-radius:${p(radius)}px;` : ''}${rotate ? `transform:rotate(${rotate}deg);` : ''}`
  );
}

function disc(p, x, y, d, color) {
  return bar(p, x, y, d, d, color, d / 2);
}

function ring(p, x, y, d, color, stroke) {
  return abs(p, x, y, d, d, `border:${sw(p, stroke)}px solid ${color};border-radius:50%;box-sizing:border-box;`);
}

function rect(p, x, y, w, h, color, stroke, radius = 0) {
  return abs(p, x, y, w, h, `border:${sw(p, stroke)}px solid ${color};box-sizing:border-box;${radius ? `border-radius:${p(radius)}px;` : ''}`);
}

/* -------------------------------- 图标表 --------------------------------- */

export const GLYPH_GROUPS = ['常用', '标记', '箭头', '时间', '内容', '生活', '自然', '序号', '符号'];

const GLYPHS = [
  /* ---- CSS 图形：标记 ---- */
  { id: 'check', name: '对勾', group: '标记', keywords: 'check yes 完成 正确 勾选',
    draw: (p, c, s) => bar(p, 5.4, 12.6, 6, s * 1.15, c, s, 45) + bar(p, 8.6, 10.4, 12, s * 1.15, c, s, -45) },
  { id: 'check-circle', name: '圆形对勾', group: '标记', keywords: 'check circle 完成 通过 成功',
    draw: (p, c, s) => ring(p, 2, 2, 20, c, s) + bar(p, 6.6, 11.8, 4.6, s, c, s / 2, 45) + bar(p, 9, 9.9, 9.4, s, c, s / 2, -45) },
  { id: 'cross', name: '叉号', group: '标记', keywords: 'cross no 错误 关闭 删除 禁止',
    draw: (p, c, s) => bar(p, 5, 11.1, 14, s * 1.15, c, s, 45) + bar(p, 5, 11.1, 14, s * 1.15, c, s, -45) },
  { id: 'dot', name: '实心圆点', group: '标记', keywords: 'dot 圆点 项目符号 bullet',
    draw: (p, c) => disc(p, 7, 7, 10, c) },
  { id: 'ring', name: '空心圆环', group: '标记', keywords: 'ring circle 圆环 未选中',
    draw: (p, c, s) => ring(p, 5, 5, 14, c, s * 1.2) },
  { id: 'diamond', name: '菱形', group: '标记', keywords: 'diamond 菱形 装饰',
    draw: (p, c) => bar(p, 7, 7, 10, 10, c, 1.2, 45) },
  { id: 'square', name: '方块', group: '标记', keywords: 'square 方块 项目符号',
    draw: (p, c) => bar(p, 5.5, 5.5, 13, 13, c, 2) },
  { id: 'triangle', name: '三角', group: '标记', keywords: 'triangle 三角 上升 提示',
    draw: (p, c) => node(`position:absolute;left:${p(4)}px;top:${p(5)}px;width:0;height:0;border-left:${p(8)}px solid transparent;border-right:${p(8)}px solid transparent;border-bottom:${p(14)}px solid ${c};`) },
  { id: 'star', name: '实心星', group: '标记', keywords: 'star 星 收藏 推荐 重点', char: '★' },
  { id: 'star-o', name: '空心星', group: '标记', keywords: 'star 星 评分 未选中', char: '☆' },
  { id: 'sparkle', name: '四角星', group: '标记', keywords: 'sparkle 闪光 亮点 精选', char: '✦' },
  { id: 'sparkle-o', name: '空心四角星', group: '标记', keywords: 'sparkle 闪光 装饰', char: '✧' },
  { id: 'asterisk', name: '星号', group: '标记', keywords: 'asterisk 星号 注释 必填', char: '✱' },
  { id: 'burst', name: '花星', group: '标记', keywords: 'burst 花星 装饰 分隔', char: '✵' },
  { id: 'flower', name: '花朵', group: '标记', keywords: 'flower 花 装饰 温柔', char: '✿' },
  { id: 'heart', name: '爱心', group: '标记', keywords: 'heart 爱心 喜欢 感谢', char: '♥' },
  { id: 'flag', name: '旗帜', group: '标记', keywords: 'flag 旗 里程碑 目标', char: '⚑' },
  { id: 'flag-o', name: '空心旗', group: '标记', keywords: 'flag 旗 待办 标记', char: '⚐' },

  /* ---- 箭头 ---- */
  { id: 'right', name: '右箭头', group: '箭头', keywords: 'arrow right 右 下一步 前往', char: '→' },
  { id: 'left', name: '左箭头', group: '箭头', keywords: 'arrow left 左 返回', char: '←' },
  { id: 'up', name: '上箭头', group: '箭头', keywords: 'arrow up 上 增长 提升', char: '↑' },
  { id: 'down', name: '下箭头', group: '箭头', keywords: 'arrow down 下 下降 展开', char: '↓' },
  { id: 'double-right', name: '双箭头', group: '箭头', keywords: 'arrow 双箭头 推导 结论', char: '⇒' },
  { id: 'swap', name: '互换', group: '箭头', keywords: 'swap 交换 对比 双向', char: '⇄' },
  { id: 'both', name: '左右箭头', group: '箭头', keywords: 'arrow 双向 区间 范围', char: '↔' },
  { id: 'ne', name: '右上箭头', group: '箭头', keywords: 'arrow 外链 跳转 上升', char: '↗' },
  { id: 'se', name: '右下箭头', group: '箭头', keywords: 'arrow 展开 下降', char: '↘' },
  { id: 'play', name: '播放', group: '箭头', keywords: 'play 播放 开始 视频', char: '▶' },
  { id: 'caret', name: '小三角', group: '箭头', keywords: 'caret 三角 折叠 展开', char: '▸' },
  { id: 'pointer', name: '右指手势', group: '箭头', keywords: 'hand point 指 引导 关注', char: '☞' },
  { id: 'pointer-left', name: '左指手势', group: '箭头', keywords: 'hand point 指 引导', char: '☜' },
  { id: 'pointer-up', name: '上指手势', group: '箭头', keywords: 'hand point 指 上文 引导', char: '☝' },
  { id: 'pointer-down', name: '下指手势', group: '箭头', keywords: 'hand point 指 下文 引导', char: '☟' },

  /* ---- 时间 ---- */
  { id: 'clock', name: '时钟', group: '时间', keywords: 'clock time 时间 时长 日程',
    draw: (p, c, s) => ring(p, 2, 2, 20, c, s) + bar(p, 11.25, 6.2, s, 5.9, c, s / 2) + bar(p, 11.25, 11.25, 5.7, s, c, s / 2) },
  { id: 'calendar', name: '日历', group: '时间', keywords: 'calendar date 日期 日历 活动',
    draw: (p, c, s) => rect(p, 3, 5, 18, 16, c, s, 2) + bar(p, 4.4, 6.4, 15.2, 3.4, c, 1)
      + bar(p, 7, 2.2, s, 4, c, s / 2) + bar(p, 15.4, 2.2, s, 4, c, s / 2)
      + disc(p, 7.4, 13.2, 2.2, c) + disc(p, 10.9, 13.2, 2.2, c) + disc(p, 14.4, 13.2, 2.2, c) },
  { id: 'history', name: '回顾', group: '时间', keywords: 'history undo 回顾 历史 复盘', char: '↺' },
  { id: 'cycle', name: '循环', group: '时间', keywords: 'cycle recycle 循环 迭代 复用', char: '♻' },
  { id: 'quarter', name: '进度圆', group: '时间', keywords: 'progress 进度 占比 完成度', char: '◷' },
  { id: 'half', name: '半圆', group: '时间', keywords: 'half 一半 对比 进度', char: '◐' },
  // ⌛ 在 macOS / Windows 上会被强制渲染成彩色 emoji（U+FE0E 也压不住），
  // 所以沙漏用两个三角形自己画，保证单色且能跟随强调色。
  { id: 'hourglass', name: '沙漏', group: '时间', keywords: 'hourglass 等待 倒计时 时间 耗时',
    draw: (p, c, s) => bar(p, 5, 2.6, 14, s, c, s / 2) + bar(p, 5, 21.4 - s, 14, s, c, s / 2)
      + node(`position:absolute;left:${p(6.4)}px;top:${p(4.4)}px;width:0;height:0;border-left:${p(5.6)}px solid transparent;border-right:${p(5.6)}px solid transparent;border-top:${p(7.4)}px solid ${c};`)
      + node(`position:absolute;left:${p(6.4)}px;top:${p(12.2)}px;width:0;height:0;border-left:${p(5.6)}px solid transparent;border-right:${p(5.6)}px solid transparent;border-bottom:${p(7.4)}px solid ${c};`) },

  /* ---- 内容 / 办公 ---- */
  { id: 'book', name: '书本', group: '内容', keywords: 'book 阅读 书 教程 学习',
    draw: (p, c, s) => rect(p, 4, 3, 16, 18, c, s, 1.6) + bar(p, 8.2, 3, s, 18, c)
      + bar(p, 11, 7.6, 6, s * 0.85, c, s / 2) + bar(p, 11, 11.6, 6, s * 0.85, c, s / 2) },
  { id: 'doc', name: '文档', group: '内容', keywords: 'doc file 文档 文件 稿件',
    draw: (p, c, s) => rect(p, 5, 2.5, 14, 19, c, s, 1.6)
      + bar(p, 8, 7.2, 8, s * 0.85, c, s / 2) + bar(p, 8, 11.2, 8, s * 0.85, c, s / 2) + bar(p, 8, 15.2, 5, s * 0.85, c, s / 2) },
  { id: 'list', name: '清单', group: '内容', keywords: 'list 清单 列表 目录 要点',
    draw: (p, c, s) => disc(p, 3.4, 5.2, 2.6, c) + bar(p, 8.4, 5.6, 12.2, s, c, s / 2)
      + disc(p, 3.4, 10.7, 2.6, c) + bar(p, 8.4, 11.1, 12.2, s, c, s / 2)
      + disc(p, 3.4, 16.2, 2.6, c) + bar(p, 8.4, 16.6, 12.2, s, c, s / 2) },
  { id: 'grid', name: '宫格', group: '内容', keywords: 'grid 宫格 模块 分类',
    draw: (p, c) => bar(p, 3.5, 3.5, 7.6, 7.6, c, 1.6) + bar(p, 12.9, 3.5, 7.6, 7.6, c, 1.6)
      + bar(p, 3.5, 12.9, 7.6, 7.6, c, 1.6) + bar(p, 12.9, 12.9, 7.6, 7.6, c, 1.6) },
  { id: 'layers', name: '层级', group: '内容', keywords: 'layers 层级 结构 堆叠',
    draw: (p, c) => bar(p, 2.5, 4.5, 19, 3.6, c, 1.2) + bar(p, 4.5, 10.2, 15, 3.6, c, 1.2) + bar(p, 6.5, 15.9, 11, 3.6, c, 1.2) },
  { id: 'chart', name: '柱状图', group: '内容', keywords: 'chart 数据 增长 图表 统计',
    draw: (p, c) => bar(p, 3.5, 13, 4.5, 7.5, c, 1.2) + bar(p, 9.75, 8.5, 4.5, 12, c, 1.2) + bar(p, 16, 4, 4.5, 16.5, c, 1.2) },
  { id: 'target', name: '靶心', group: '内容', keywords: 'target 目标 精准 定位',
    draw: (p, c, s) => ring(p, 2, 2, 20, c, s) + ring(p, 6.8, 6.8, 10.4, c, s) + disc(p, 10.2, 10.2, 3.6, c) },
  { id: 'search', name: '搜索', group: '内容', keywords: 'search 搜索 查找 探索',
    draw: (p, c, s) => ring(p, 3, 3, 13, c, s) + bar(p, 14.2, 14.2, 6.4, s, c, s / 2, 45) },
  { id: 'bulb', name: '灵感', group: '内容', keywords: 'bulb idea 灵感 想法 提示 灯泡',
    draw: (p, c, s) => ring(p, 6, 2, 12, c, s) + bar(p, 9.4, 13.6, 5.2, s * 0.9, c, s / 2)
      + bar(p, 10, 16.2, 4, s * 0.9, c, s / 2) + bar(p, 10.6, 18.8, 2.8, s * 0.9, c, s / 2) },
  { id: 'pen', name: '钢笔', group: '内容', keywords: 'pen write 写作 编辑 签名', char: '✎' },
  { id: 'pencil', name: '铅笔', group: '内容', keywords: 'pencil write 草稿 修改 写作', char: '✏' },
  { id: 'quote', name: '引号', group: '内容', keywords: 'quote 引用 金句 摘录', char: '“' },
  { id: 'scissors', name: '剪刀', group: '内容', keywords: 'scissors 裁剪 删除 精简', char: '✂' },
  { id: 'gear', name: '齿轮', group: '内容', keywords: 'gear settings 设置 配置 工具', char: '⚙' },
  { id: 'scale', name: '天平', group: '内容', keywords: 'scale balance 权衡 对比 公平', char: '⚖' },
  { id: 'atom', name: '原子', group: '内容', keywords: 'atom 科学 原理 技术', char: '⚛' },
  { id: 'link', name: '关联', group: '内容', keywords: 'link 关联 链接 无限', char: '∞' },
  { id: 'tag', name: '标签饰', group: '内容', keywords: 'tag 标签 关键词 分类', char: '❖' },

  /* ---- 生活 ---- */
  { id: 'mail', name: '邮件', group: '生活', keywords: 'mail email 邮箱 联系 报名', char: '✉' },
  { id: 'phone', name: '电话', group: '生活', keywords: 'phone tel 电话 联系 咨询', char: '☎' },
  { id: 'pin', name: '地点', group: '生活', keywords: 'pin location 地点 地址 位置',
    draw: (p, c, s) => abs(p, 4, 2, 16, 16, `border:${sw(p, s)}px solid ${c};border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-sizing:border-box;`) + disc(p, 9.5, 7.5, 5, c) },
  { id: 'user', name: '人物', group: '生活', keywords: 'user people 作者 人物 主讲',
    draw: (p, c, s) => ring(p, 8, 2.5, 8, c, s) + abs(p, 4, 13, 16, 8.5, `border:${sw(p, s)}px solid ${c};border-bottom:none;border-radius:${p(8)}px ${p(8)}px 0 0;box-sizing:border-box;`) },
  { id: 'home', name: '家', group: '生活', keywords: 'home 家 首页 主页', char: '⌂' },
  { id: 'gift', name: '礼物', group: '生活', keywords: 'gift 礼物 福利 奖品',
    draw: (p, c, s) => rect(p, 3, 8, 18, 4.2, c, s, 1) + rect(p, 4.6, 12.2, 14.8, 8.8, c, s, 1.4)
      + bar(p, 11.2, 8, s, 13, c) + ring(p, 6.2, 2.4, 6, c, s) + ring(p, 11.8, 2.4, 6, c, s) },
  { id: 'lock', name: '锁', group: '生活', keywords: 'lock 安全 隐私 加密 权限',
    draw: (p, c, s) => rect(p, 4, 10.5, 16, 10.5, c, s, 2)
      + abs(p, 7.5, 3, 9, 8, `border:${sw(p, s)}px solid ${c};border-bottom:none;border-radius:${p(4.5)}px ${p(4.5)}px 0 0;box-sizing:border-box;`)
      + disc(p, 11, 14.6, 2, c) },
  { id: 'key', name: '钥匙', group: '生活', keywords: 'key 关键 密钥 方法',
    draw: (p, c, s) => ring(p, 3, 7, 10, c, s) + bar(p, 12.4, 11.2, 9, s, c, s / 2)
      + bar(p, 17, 12.2, s, 3.4, c, s / 2) + bar(p, 19.6, 12.2, s, 2.6, c, s / 2) },
  { id: 'box', name: '包裹', group: '生活', keywords: 'box package 包裹 归档 素材',
    draw: (p, c, s) => rect(p, 3.5, 6, 17, 14, c, s, 1.6) + bar(p, 3.5, 10.4, 17, s, c) },
  { id: 'plane', name: '飞机', group: '生活', keywords: 'plane travel 旅行 出行 远方', char: '✈' },
  { id: 'music', name: '音符', group: '生活', keywords: 'music 音乐 声音 歌', char: '♪' },
  { id: 'smile', name: '笑脸', group: '生活', keywords: 'smile 开心 满意 好评', char: '☺' },
  { id: 'sad', name: '苦脸', group: '生活', keywords: 'sad 难过 问题 差评', char: '☹' },
  { id: 'coffee', name: '热气', group: '生活', keywords: 'coffee hot 咖啡 热饮 慢生活', char: '♨' },

  /* ---- 自然 ---- */
  { id: 'sun', name: '晴', group: '自然', keywords: 'sun 太阳 晴 白天', char: '☀' },
  { id: 'moon', name: '月', group: '自然', keywords: 'moon 月亮 夜晚 夜', char: '☾' },
  { id: 'cloud', name: '云', group: '自然', keywords: 'cloud 云 阴 云端', char: '☁' },
  { id: 'umbrella', name: '雨', group: '自然', keywords: 'rain umbrella 雨 伞 防护', char: '☂' },
  { id: 'snow', name: '雪', group: '自然', keywords: 'snow 雪 冬天 冷', char: '❄' },
  { id: 'leaf', name: '叶饰', group: '自然', keywords: 'leaf 叶 植物 自然 生长', char: '❦' },
  { id: 'wave', name: '波纹', group: '自然', keywords: 'wave 波 约等于 流动', char: '≈' },
  { id: 'spark', name: '火花', group: '自然', keywords: 'spark 火花 热度 能量', char: '✹' },

  /* ---- 序号 ---- */
  { id: 'n1', name: '序号一', group: '序号', keywords: 'number 1 一 序号 步骤', char: '①' },
  { id: 'n2', name: '序号二', group: '序号', keywords: 'number 2 二 序号 步骤', char: '②' },
  { id: 'n3', name: '序号三', group: '序号', keywords: 'number 3 三 序号 步骤', char: '③' },
  { id: 'n4', name: '序号四', group: '序号', keywords: 'number 4 四 序号 步骤', char: '④' },
  { id: 'n5', name: '序号五', group: '序号', keywords: 'number 5 五 序号 步骤', char: '⑤' },
  { id: 'n6', name: '序号六', group: '序号', keywords: 'number 6 六 序号 步骤', char: '⑥' },
  { id: 'n7', name: '序号七', group: '序号', keywords: 'number 7 七 序号 步骤', char: '⑦' },
  { id: 'n8', name: '序号八', group: '序号', keywords: 'number 8 八 序号 步骤', char: '⑧' },
  { id: 'n9', name: '序号九', group: '序号', keywords: 'number 9 九 序号 步骤', char: '⑨' },
  { id: 'n10', name: '序号十', group: '序号', keywords: 'number 10 十 序号 步骤', char: '⑩' },
  { id: 'b1', name: '黑底一', group: '序号', keywords: 'number 1 一 实心 序号', char: '❶' },
  { id: 'b2', name: '黑底二', group: '序号', keywords: 'number 2 二 实心 序号', char: '❷' },
  { id: 'b3', name: '黑底三', group: '序号', keywords: 'number 3 三 实心 序号', char: '❸' },
  { id: 'b4', name: '黑底四', group: '序号', keywords: 'number 4 四 实心 序号', char: '❹' },
  { id: 'b5', name: '黑底五', group: '序号', keywords: 'number 5 五 实心 序号', char: '❺' },

  /* ---- 符号 ---- */
  { id: 'box-check', name: '已勾选框', group: '符号', keywords: 'checkbox checked 勾选 完成', char: '☑' },
  { id: 'box-empty', name: '未勾选框', group: '符号', keywords: 'checkbox todo 待办 未完成', char: '☐' },
  { id: 'plus-circle', name: '加号圆', group: '符号', keywords: 'plus add 新增 添加', char: '⊕' },
  { id: 'minus-circle', name: '减号圆', group: '符号', keywords: 'minus remove 减少 移除', char: '⊖' },
  { id: 'refer', name: '参考号', group: '符号', keywords: 'reference 参考 注释 提示', char: '※' },
  { id: 'section', name: '章节号', group: '符号', keywords: 'section 章节 条款 小节', char: '§' },
  { id: 'paragraph', name: '段落号', group: '符号', keywords: 'paragraph 段落 排版', char: '¶' },
  { id: 'asterism', name: '三星饰', group: '符号', keywords: 'asterism 分隔 装饰 收尾', char: '⁂' },
  { id: 'command', name: '命令键', group: '符号', keywords: 'command key 快捷键 mac', char: '⌘' },
  { id: 'option', name: '选项键', group: '符号', keywords: 'option key 快捷键 alt', char: '⌥' },
  { id: 'shift', name: '上档键', group: '符号', keywords: 'shift key 快捷键', char: '⇧' },
  { id: 'bracket-left', name: '左角引号', group: '符号', keywords: 'bracket 引号 中文 标题', char: '「' },
  { id: 'bracket-right', name: '右角引号', group: '符号', keywords: 'bracket 引号 中文 标题', char: '」' },
  { id: 'title-left', name: '书名号左', group: '符号', keywords: 'title 书名号 作品 标题', char: '《' },
  { id: 'title-right', name: '书名号右', group: '符号', keywords: 'title 书名号 作品 标题', char: '》' },
  { id: 'block', name: '网格块', group: '符号', keywords: 'block 网格 纹理 装饰', char: '▦' },
  { id: 'hatch', name: '斜纹块', group: '符号', keywords: 'hatch 斜纹 纹理 装饰', char: '▨' },
  { id: 'bullseye', name: '同心圆', group: '符号', keywords: 'bullseye 同心圆 重点 标记', char: '◎' },
  { id: 'filled-ring', name: '圆中点', group: '符号', keywords: 'ring dot 圆点 强调', char: '◉' },
  { id: 'warn', name: '警示', group: '符号', keywords: 'warn warning 注意 风险 警告', char: '⚠' },
];

const GLYPH_MAP = new Map(GLYPHS.map((item) => [item.id, item]));

// 「常用」是跨分组挑出来的一屏快捷入口，不重复定义图标
const COMMON_IDS = [
  'star', 'sparkle', 'check', 'check-circle', 'cross', 'dot', 'right', 'pointer',
  'clock', 'calendar', 'bulb', 'pen', 'book', 'list', 'chart', 'target',
  'mail', 'phone', 'pin', 'user', 'gift', 'heart', 'flag', 'quote',
];

export const GLYPH_LIST = GLYPHS;
export const GLYPH_COUNT = GLYPHS.length;

export function hasGlyph(id) {
  return GLYPH_MAP.has(String(id || '').trim().toLowerCase());
}

export function getGlyph(id) {
  return GLYPH_MAP.get(String(id || '').trim().toLowerCase()) || null;
}

export function glyphsInGroup(group) {
  if (!group || group === '全部') return GLYPHS;
  if (group === '常用') return COMMON_IDS.map((id) => GLYPH_MAP.get(id)).filter(Boolean);
  return GLYPHS.filter((item) => item.group === group);
}

export function searchGlyphs(query, group) {
  const keyword = String(query || '').trim().toLowerCase();
  const pool = glyphsInGroup(group);
  if (!keyword) return pool;
  return pool.filter((item) => `${item.id} ${item.name} ${item.group} ${item.keywords}`.toLowerCase().includes(keyword));
}

/* ------------------------------- 参数解析 -------------------------------- */

export const GLYPH_SHAPES = ['none', 'circle', 'square', 'outline'];

export const DEFAULT_GLYPH_STYLE = {
  size: 18,
  shape: 'none',
  tint: 12,
  weight: 500,
  gap: 4,
  align: 'middle',
  opacity: 100,
  color: 'accent',
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeColor(value) {
  const text = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return `#${text.slice(1).split('').map((c) => c + c).join('')}`.toLowerCase();
  }
  if (['accent', 'text', 'muted', 'heading', 'line'].includes(text)) return text;
  return '';
}

/**
 * 解析行内图标的参数：`:star{28,circle,#1d4ed8,20}:`
 * 也支持显式写法 `:star{size=28,shape=circle,color=#1d4ed8,tint=20}:`
 * 位置参数顺序为 尺寸、底座、颜色、底色浓度。
 */
export function parseGlyphOptions(raw) {
  const options = {};
  const positional = ['size', 'shape', 'color', 'tint'];
  String(raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part, index) => {
      const eq = part.indexOf('=');
      const key = eq >= 0 ? part.slice(0, eq).trim().toLowerCase() : positional[index];
      const value = eq >= 0 ? part.slice(eq + 1).trim() : part;
      if (!key) return;
      if (key === 'size') options.size = Number(value);
      else if (key === 'shape') options.shape = value.toLowerCase();
      else if (key === 'color') options.color = normalizeColor(value);
      else if (key === 'tint') options.tint = Number(String(value).replace('%', ''));
      else if (key === 'weight') options.weight = Number(value);
      else if (key === 'gap') options.gap = Number(value);
      else if (key === 'opacity') options.opacity = Number(String(value).replace('%', ''));
      else if (key === 'align') options.align = value.toLowerCase();
    });
  return options;
}

/** 生成行内语法，控件调好的样式可以原样写回 Markdown */
export function glyphSyntax(id, style = {}) {
  const merged = { ...DEFAULT_GLYPH_STYLE, ...style };
  const size = Math.round(clamp(num(merged.size, DEFAULT_GLYPH_STYLE.size), 10, 96));
  const shape = GLYPH_SHAPES.includes(merged.shape) ? merged.shape : 'none';
  const color = normalizeColor(merged.color) || 'accent';
  const tint = Math.round(clamp(num(merged.tint, DEFAULT_GLYPH_STYLE.tint), 0, 60));

  // 位置参数固定为 尺寸、底座、颜色、浓度，从尾部裁掉与默认值相同的部分
  const positions = [String(size), shape, color, String(shape === 'none' ? DEFAULT_GLYPH_STYLE.tint : tint)];
  const defaults = [String(DEFAULT_GLYPH_STYLE.size), 'none', 'accent', String(DEFAULT_GLYPH_STYLE.tint)];
  let end = positions.length;
  while (end > 0 && positions[end - 1] === defaults[end - 1]) end -= 1;

  const extras = [];
  if (num(merged.weight, DEFAULT_GLYPH_STYLE.weight) !== DEFAULT_GLYPH_STYLE.weight) extras.push(`weight=${Math.round(num(merged.weight, 500))}`);
  if (num(merged.gap, DEFAULT_GLYPH_STYLE.gap) !== DEFAULT_GLYPH_STYLE.gap) extras.push(`gap=${Math.round(num(merged.gap, 4))}`);
  if (merged.align !== DEFAULT_GLYPH_STYLE.align) extras.push(`align=${merged.align}`);
  if (num(merged.opacity, DEFAULT_GLYPH_STYLE.opacity) !== DEFAULT_GLYPH_STYLE.opacity) extras.push(`opacity=${Math.round(num(merged.opacity, 100))}`);

  const all = [...positions.slice(0, end), ...extras];
  return `:${id}${all.length ? `{${all.join(',')}}` : ''}:`;
}

/* -------------------------------- 渲染 ---------------------------------- */

function hexToRgba(hex, alpha) {
  const value = String(hex || '').replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * 渲染一个图标为内联样式 HTML。
 * @param {string} id 图标名
 * @param {object} options size / shape / tint / weight / gap / align / opacity / color（已解析成色值）
 */
export function renderGlyph(id, options = {}) {
  const glyph = getGlyph(id);
  if (!glyph) return '';

  const size = Math.round(clamp(num(options.size, DEFAULT_GLYPH_STYLE.size), 10, 96));
  const color = /^#[0-9a-f]{3,6}$/i.test(String(options.color || '')) ? normalizeColor(options.color) : '#b5432a';
  const shape = GLYPH_SHAPES.includes(options.shape) ? options.shape : 'none';
  const tint = clamp(num(options.tint, DEFAULT_GLYPH_STYLE.tint) / 100, 0, 0.6);
  const weight = Math.round(clamp(num(options.weight, DEFAULT_GLYPH_STYLE.weight), 300, 900));
  const gap = Math.round(clamp(num(options.gap, 0), 0, 40));
  const opacity = clamp(num(options.opacity, 100) / 100, 0.1, 1);
  const align = ['middle', 'baseline', 'top', 'bottom', 'text-bottom'].includes(options.align) ? options.align : 'middle';

  const unit = size / 24;
  const p = (n) => round(n * unit);
  // 字重同时控制字符粗细与图形线宽；线宽以 24 网格为单位，由 p() 统一缩放
  const stroke = round(1.35 + ((weight - 300) / 600) * 1.05, 2);

  let inner;
  if (glyph.draw) {
    inner = node(
      `position:relative;display:block;width:${size}px;height:${size}px;font-size:0;line-height:0;`,
      glyph.draw(p, color, stroke)
    );
  } else {
    const char = TEXT_PRESENTATION.has(glyph.char) ? `${glyph.char}\uFE0E` : glyph.char;
    inner = node(
      `display:block;width:${size}px;height:${size}px;line-height:${size}px;text-align:center;font-family:${GLYPH_FONT};font-size:${round(size * 0.88)}px;font-weight:${weight};color:${color};`,
      char
    );
  }

  const base = `display:inline-block;vertical-align:${align};box-sizing:border-box;${gap ? `margin-right:${gap}px;` : ''}${opacity < 1 ? `opacity:${round(opacity)};` : ''}`;
  if (shape === 'none') {
    return node(`${base}width:${size}px;height:${size}px;line-height:0;font-size:0;color:${color};`, inner);
  }

  const pad = Math.max(3, Math.round(size * 0.32));
  const box = size + pad * 2;
  const radius = shape === 'circle' || shape === 'outline' ? '50%' : `${Math.max(3, Math.round(size * 0.26))}px`;
  const paint = shape === 'outline'
    ? `border:${Math.max(1, round(unit * 1.2))}px solid ${hexToRgba(color, 0.55)};background-color:transparent;`
    : `background-color:${hexToRgba(color, tint)};`;
  return node(
    `${base}width:${box}px;height:${box}px;padding:${pad}px;line-height:0;font-size:0;border-radius:${radius};${paint}`,
    inner
  );
}

/** 把颜色关键字解析成当前主题下的真实色值 */
export function resolveGlyphColor(token, palette) {
  const value = normalizeColor(token);
  if (!value) return palette.accent;
  if (value.startsWith('#')) return value;
  return palette[value] || palette.accent;
}