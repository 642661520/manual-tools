# 编辑器功能清单

## ✅ 已完成

### 1. 查找替换

- 实现：`SearchReplaceBar.vue` 组件
- 支持：查找、替换、全部替换、区分大小写
- 工具栏按钮切换，Esc 关闭

### 2. 文字对齐

- 实现：`@tiptap/extension-text-align`
- 工具栏：左对齐 / 居中 / 右对齐 / 两端对齐

### 3. 水平分隔线

- 实现：`@tiptap/extension-horizontal-rule`
- 工具栏按钮插入 `<hr>`

### 4. 下划线

- 实现：`@tiptap/extension-underline`
- 工具栏 `U` 按钮，位于删除线旁

### 5. 待办清单

- 实现：`@tiptap/extension-task-list` + `@tiptap/extension-task-item`
- 工具栏 checkbox 按钮，自定义 CSS 样式

### 6. 底部状态栏

- 实现：编辑器底部状态栏
- 显示：词数 / 字符数 / 当前段落格式 / 在线用户头像

### 7. 文字颜色 / 高亮

- 实现：`@tiptap/extension-color` + `@tiptap/extension-highlight`
- 工具栏颜色选择器：文字颜色（10 色） + 背景高亮（10 色）

### 8. 全屏写作模式

- 实现：`fixed inset-0 z-50` 全屏切换
- 工具栏全屏按钮，Esc 退出

### 9. Markdown 快捷输入

- 实现：TipTap StarterKit 内置支持
- `# 空格` → 标题、`- 空格` → 列表、`> 空格` → 引用 等

### 10. 图片 / 视频尺寸调整

- 实现：选中图片/视频时显示宽度工具栏
- 预设：默认 / 25% / 50% / 75% / 100%

---

## ⚪ 待完成

### 打印样式优化 ✅

- 浏览器直接打印（Ctrl+P）手册时排版优化
- 添加了 `@media print` 样式，隐藏工具栏、导航栏、侧边栏，调整页边距
- 编辑器工具栏和手册预览页均添加了打印按钮
- 复杂度：低

---

## 已额外实现（不在原计划中）

| 功能           | 说明                                                  |
| -------------- | ----------------------------------------------------- |
| 视频上传/插入  | 上传 MP4/WebM（最大 100MB），支持 URL 插入，可调宽度  |
| 交叉引用       | `CrossrefPicker` 组件，链接到其他 feature/section     |
| 表格增强       | `TableGridPicker` 选行列 + `TableBubbleMenu` 行列操作 |
| 光标位置持久化 | localStorage 保存/恢复编辑位置                        |
| Markdown 粘贴  | `markdown-paste.ts` composable 处理粘贴               |
| 链接弹窗编辑   | `ModalDialog` 形式编辑链接 URL 和显示名称             |
