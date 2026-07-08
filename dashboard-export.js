// dashboard-export.js — 数据导出到 Excel
// 依赖: xlsx.full.min.js (SheetJS), App.DATA, App.FIELDS, App.ALL_DATA

function renderExportTab() {
  var container = document.getElementById('tab-export');
  if (!container) return;

  // Collect available months
  var months = [];
  if (App.ALL_DATA && App.ALL_DATA.actuals) {
    months = Object.keys(App.ALL_DATA.actuals).sort();
  }

  // Collect available branches and regions
  var branches = App.DATA && App.DATA.branches ? App.DATA.branches.slice() : [];
  var regions = App.REGIONS || ['第一责任区', '第二责任区', '第三责任区', '第四责任区'];

  // Build HTML
  var h = '<div style="max-width:1100px;margin:0 auto">';
  h += '<h2 style="margin-bottom:16px">📥 数据导出</h2>';
  h += '<p style="color:var(--text2);font-size:13px;margin-bottom:24px">选择要导出的单位、指标和时间段，生成 Excel 文件下载。</p>';

  // --- Unit Selection ---
  h += '<div class="exp-section"><h3>1. 选择单位</h3>';
  h += '<div style="display:flex;gap:16px;flex-wrap:wrap">';
  // National
  h += '<label class="exp-check"><input type="checkbox" value="national" checked onchange="exportUpdatePreview()"> 📊 全国</label>';
  // Regions
  h += '<div style="flex-basis:100%"><b>责任区：</b>';
  h += '<button class="exp-sel-all" onclick="exportToggleGroup(\'region\',true)" style="font-size:11px">全选</button> ';
  h += '<button class="exp-sel-all" onclick="exportToggleGroup(\'region\',false)" style="font-size:11px">取消</button></div>';
  regions.forEach(function (r) {
    h += '<label class="exp-check"><input type="checkbox" value="' + escapeHtml(r) + '" class="exp-region" checked onchange="exportUpdatePreview()"> ' + escapeHtml(r) + '</label>';
  });
  // Branches
  h += '<div style="flex-basis:100%;margin-top:8px"><b>分公司（31家）：</b>';
  h += '<button class="exp-sel-all" onclick="exportToggleGroup(\'branch\',true)" style="font-size:11px">全选</button> ';
  h += '<button class="exp-sel-all" onclick="exportToggleGroup(\'branch\',false)" style="font-size:11px">取消</button></div>';
  branches.forEach(function (b) {
    h += '<label class="exp-check exp-branch-label"><input type="checkbox" value="' + escapeHtml(b.n) + '" class="exp-branch" data-region="' + escapeHtml(b.r) + '" onchange="exportUpdatePreview()"> ' + escapeHtml(b.n) + ' <span style="font-size:10px;color:var(--text2)">(' + escapeHtml(b.r) + ')</span></label>';
  });
  h += '</div></div>'; // end unit section

  // --- Field Selection ---
  h += '<div class="exp-section"><h3>2. 选择指标 <span style="font-weight:400;font-size:12px;color:var(--text2)">（按分类分组，默认勾选核心指标）</span></h3>';
  h += '<div style="display:flex;gap:12px;flex-wrap:wrap">';
  var groups = ['保费', '效益', '效能', '人员'];
  groups.forEach(function (g) {
    var gFields = App.FIELDS.filter(function (f) { return f.g === g; });
    if (!gFields.length) return;
    h += '<div style="flex:1 1 240px;min-width:220px;background:var(--card);border:1px solid var(--divider);border-radius:8px;padding:10px 12px">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--divider)">';
    h += '<span style="font-weight:700;font-size:13px;color:#1e3a5f">' + g + ' <span style="font-weight:400;font-size:11px;color:var(--text2)">(' + gFields.length + '项)</span></span>';
    h += '<div style="display:flex;gap:4px">';
    h += '<button class="exp-sel-all exp-sel-card" onclick="exportToggleGroup(\'field-' + g + '\',true)">全选</button>';
    h += '<button class="exp-sel-all exp-sel-card" onclick="exportToggleGroup(\'field-' + g + '\',false)">取消</button>';
    h += '</div></div>';
    h += '<div style="display:flex;flex-direction:column;gap:4px;max-height:280px;overflow-y:auto">';
    gFields.forEach(function (f) {
      var checked = f.m ? ' checked' : '';
      h += '<label class="exp-check exp-check-card" style="display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:4px;cursor:pointer;font-size:12px;transition:background .15s">';
      h += '<input type="checkbox" value="' + escapeHtml(f.k) + '" class="exp-field exp-field-' + escapeHtml(g) + '"' + checked + ' onchange="exportUpdatePreview()">';
      h += '<span style="flex:1">' + escapeHtml(f.l) + '</span>';
      h += '<span style="font-size:10px;color:#9ca3af">' + escapeHtml(f.u) + '</span>';
      h += '</label>';
    });
    h += '</div></div>';
  });
  h += '</div></div>'; // end field section

  // --- Time Period (dropdown) ---
  h += '<div class="exp-section"><h3>3. 选择时间段</h3>';
  if (months.length === 0) {
    h += '<p style="color:var(--text2)">暂无数据，请先导入月度数据。</p>';
  } else {
    h += '<select id="exp-month-select" onchange="exportUpdatePreview()" style="padding:6px 12px;border:1px solid var(--divider);border-radius:6px;background:var(--card);font-size:13px;color:#1e3a5f;max-width:300px">';
    h += '<option value="_all">📅 全部月份（每月份一个Sheet）</option>';
    months.forEach(function (m) {
      h += '<option value="' + escapeHtml(m) + '">' + escapeHtml(m.replace('-', '年')) + '月</option>';
    });
    h += '</select>';
    h += '<span style="font-size:11px;color:var(--text2);margin-left:8px">选「全部」则每月份独立一个Sheet</span>';
  }
  h += '</div>';

  // --- Preview ---
  h += '<div class="exp-section"><h3>4. 预览与导出</h3>';
  h += '<div id="export-preview" style="font-size:13px;color:var(--text2);margin-bottom:12px"></div>';
  h += '<button class="exp-btn-primary" onclick="doExport()" style="font-size:15px;padding:10px 28px">📥 导出 Excel</button>';
  h += '</div>';

  h += '</div>';
  container.innerHTML = h;
  exportUpdatePreview();
}

// Toggle group checkboxes (fields/regions/branches)
function exportToggleGroup(type, selectAll) {
  var selector;
  if (type === 'region') selector = '.exp-region';
  else if (type === 'branch') selector = '.exp-branch';
  else if (type.startsWith('field-')) selector = '.exp-field-' + type.replace('field-', '');
  else return;
  document.querySelectorAll(selector).forEach(function (cb) { cb.checked = selectAll; });
  exportUpdatePreview();
}

// Update preview count
function exportUpdatePreview() {
  var preview = document.getElementById('export-preview');
  if (!preview) return;

  var unitCount = 0;
  if (document.querySelector('input[value="national"]:checked')) unitCount++;
  unitCount += document.querySelectorAll('.exp-region:checked').length;
  unitCount += document.querySelectorAll('.exp-branch:checked').length;

  var fieldCount = document.querySelectorAll('.exp-field:checked').length;

  var ms = document.getElementById('exp-month-select');
  var selLabel = ms ? (ms.value === '_all' ? '全部月份' : ms.options[ms.selectedIndex].text) : '未知';
  var monthCount = (ms && ms.value === '_all') ? (ms.options.length - 1) : 1;

  var total = unitCount * monthCount;
  preview.innerHTML = '选中 <b>' + unitCount + '</b> 个单位 × <b>' + fieldCount + '</b> 个指标 × <b>' + escapeHtml(selLabel) + '</b> = 共 <b>' + total + '</b> 行数据';
}

// Main export function - one sheet per selected month (uses computeMonthData for 100% consistency)
function doExport() {
  try {
    // Collect selections
    var includeNational = document.querySelector('input[value="national"]:checked') !== null;
    var selectedRegions = [];
    document.querySelectorAll('.exp-region:checked').forEach(function (cb) { selectedRegions.push(cb.value); });
    var selectedBranches = [];
    document.querySelectorAll('.exp-branch:checked').forEach(function (cb) { selectedBranches.push(cb.value); });
    var selectedFields = [];
    document.querySelectorAll('.exp-field:checked').forEach(function (cb) { selectedFields.push(cb.value); });

    var ms = document.getElementById('exp-month-select');
    if (!ms) { toast('月份选择器未找到', 'error'); return; }
    var selectedMonths = [];
    if (ms.value === '_all') {
      for (var i = 1; i < ms.options.length; i++) selectedMonths.push(ms.options[i].value);
    } else {
      selectedMonths.push(ms.value);
    }

    if (selectedFields.length === 0) { toast('请至少选择一个指标', 'error'); return; }
    if (selectedMonths.length === 0) { toast('请至少选择一个月份', 'error'); return; }
    if (!includeNational && selectedRegions.length === 0 && selectedBranches.length === 0) {
      toast('请至少选择一个单位', 'error'); return;
    }

    function getVal(dataObj, fk) {
      if (!dataObj) return '';
      var v = dataObj[fk];
      if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) return '';
      return v;
    }

    var wb = XLSX.utils.book_new();
    var totalRows = 0;

    selectedMonths.forEach(function (mk) {
      // computeMonthData is defined in dashboard-data.js — 100% same logic as dashboard render
      var md = typeof computeMonthData === 'function' ? computeMonthData(mk) : null;
      if (!md || !md.branches) return;

      // Build rows
      var rows = [];
      var colNames = [];
      selectedFields.forEach(function (fk) {
        var f = App.FIELDS.find(function (x) { return x.k === fk; });
        colNames.push(mk.replace('-', '年') + '月-' + (f ? f.l : fk));
      });
      rows.push(['单位类型', '单位名称'].concat(colNames));

      if (includeNational && md.national) {
        var nr = ['全国', '全国'];
        selectedFields.forEach(function (fk) { nr.push(getVal(md.national, fk)); });
        rows.push(nr);
      }
      selectedRegions.forEach(function (rn) {
        var rd = (md.regions || {})[rn];
        if (!rd) return;
        var rr = ['责任区', rn];
        selectedFields.forEach(function (fk) { rr.push(getVal(rd, fk)); });
        rows.push(rr);
      });
      selectedBranches.forEach(function (bn) {
        var br = md.branches.find(function (x) { return x.n === bn; });
        if (!br) return;
        var bv = ['分公司', bn];
        selectedFields.forEach(function (fk) { bv.push(getVal(br.d, fk)); });
        rows.push(bv);
      });

      if (rows.length <= 1) return;

      var ws = XLSX.utils.aoa_to_sheet(rows);
      // Auto column widths
      var header = rows[0];
      var colWidths = [];
      for (var c = 0; c < header.length; c++) {
        var maxLen = String(header[c]).length;
        for (var r = 1; r < rows.length; r++) {
          var cellVal = String(rows[r][c] || '');
          if (cellVal.length > maxLen) maxLen = cellVal.length;
        }
        colWidths.push({ wch: Math.min(Math.max(maxLen + 2, 8), 30) });
      }
      ws['!cols'] = colWidths;

      var sn = mk.replace('-', '年') + '月';
      XLSX.utils.book_append_sheet(wb, ws, sn);
      totalRows += rows.length - 1;
    });

    if (totalRows === 0) {
      toast('选中的条件下无数据可导出', 'error');
      return;
    }

    var now = new Date();
    var ts = now.getFullYear() + ('0' + (now.getMonth() + 1)).slice(-2) + ('0' + now.getDate()).slice(-2) + '_' +
             ('0' + now.getHours()).slice(-2) + ('0' + now.getMinutes()).slice(-2);
    var filename = '安效能数据导出_' + ts + '.xlsx';

    XLSX.writeFile(wb, filename);
    toast('导出成功：' + filename + '（' + totalRows + '行 × ' + (wb.SheetNames ? wb.SheetNames.length : 1) + '个Sheet）', 'success');
  } catch (e) {
    console.error('Export error:', e);
    toast('导出失败: ' + e.message, 'error');
  }
}

// Make functions global
window.renderExportTab = renderExportTab;
window.exportToggleGroup = exportToggleGroup;
window.exportUpdatePreview = exportUpdatePreview;
window.doExport = doExport;
