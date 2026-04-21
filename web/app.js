// ── AI Stock Recommendations Dashboard ──────────────────
(function () {
  'use strict';

  const REPORTS_BASE = '../reports';
  let reportMarkdown = '';
  let swingMarkdown = '';
  let scanData = null;                // parsed reports/scan_data.json
  const priceMap = { us: {}, india: {} };   // symbol → close price
  const priceDateOk = { us: false, india: false }; // whether scan_data.fetched_dates matches current report

  // ── Theme Toggle ────────────────────────────────────
  const themeBtn = document.getElementById('theme-toggle');
  const saved = localStorage.getItem('theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);

  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  });

  // ── Tab Navigation ──────────────────────────────────
  const tabs = document.querySelectorAll('.tab');
  const sections = document.querySelectorAll('.section');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.section;
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      sections.forEach(s => {
        s.style.display = s.id === `section-${target}` ? 'block' : 'none';
      });
    });
  });

  // ── Load Report List ────────────────────────────────
  const select = document.getElementById('report-select');
  const loading = document.getElementById('loading');
  const noReports = document.getElementById('no-reports');

  async function fetchManifest(name) {
    try {
      const resp = await fetch(`${REPORTS_BASE}/${name}`);
      if (!resp.ok) return null;
      return await resp.json();
    } catch {
      return null;
    }
  }

  async function init() {
    const [daily, swing] = await Promise.all([
      fetchManifest('latest.json'),
      fetchManifest('latest_swing.json'),
    ]);

    const dailyDates = (daily && daily.reports) || [];
    const swingDates = (swing && swing.reports) || [];
    const allDates = Array.from(new Set([...dailyDates, ...swingDates]))
      .sort().reverse();

    if (allDates.length === 0) {
      showNoReports();
      return;
    }

    select.innerHTML = '';
    allDates.forEach(date => {
      const opt = document.createElement('option');
      opt.value = date;
      opt.textContent = date;
      select.appendChild(opt);
    });

    select.addEventListener('change', () => loadReport(select.value));
    const initial = (daily && daily.latest) || (swing && swing.latest) || allDates[0];
    loadReport(initial);
  }

  function showNoReports() {
    loading.style.display = 'none';
    noReports.style.display = 'block';
  }

  // ── Load & Parse Report ─────────────────────────────
  async function loadReport(date) {
    loading.style.display = 'flex';
    sections.forEach(s => s.innerHTML = '');

    const [dailyText, swingText, scanJson] = await Promise.all([
      fetch(`${REPORTS_BASE}/${date}_daily.md`).then(r => r.ok ? r.text() : '').catch(() => ''),
      fetch(`${REPORTS_BASE}/${date}_swing.md`).then(r => r.ok ? r.text() : '').catch(() => ''),
      fetch(`${REPORTS_BASE}/scan_data.json`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    reportMarkdown = dailyText.replace(/\r\n/g, '\n');
    swingMarkdown = swingText.replace(/\r\n/g, '\n');

    // Build price map only when scan_data's fetched_dates match the report date,
    // so older reports don't get mismatched "current" prices.
    scanData = scanJson;
    priceMap.us = {}; priceMap.india = {};
    priceDateOk.us = false; priceDateOk.india = false;
    if (scanData && scanData.fetched_dates) {
      if (scanData.fetched_dates.us === date && scanData.us) {
        priceDateOk.us = true;
        for (const [sym, rec] of Object.entries(scanData.us)) {
          if (rec && rec.close != null) priceMap.us[sym] = rec.close;
        }
      }
      if (scanData.fetched_dates.india === date && scanData.india) {
        priceDateOk.india = true;
        for (const [sym, rec] of Object.entries(scanData.india)) {
          if (rec && rec.close != null) priceMap.india[sym] = rec.close;
        }
      }
    }

    loading.style.display = 'none';

    if (!reportMarkdown && !swingMarkdown) {
      loading.style.display = 'flex';
      loading.innerHTML = `<p>No report found for ${date}.</p>`;
      return;
    }

    parseAndRender(reportMarkdown);
    renderSwing(swingMarkdown);
  }

  // ── Parse Markdown Into Sections ────────────────────
  function parseAndRender(md) {
    const parts = splitByHeadings(md, 2);

    const overview = parts['Market Overview'] || parts['market overview'] || '';
    renderOverview(overview);

    const unified = findPart(parts, 'Unified Recommendations');
    renderUnifiedRecommendations(unified);

    const topPicks = findPart(parts, 'Top Picks');
    renderTopPicks(topPicks);

    const multibagger = findPart(parts, 'Multi-bagger Watch');
    renderMultibagger(multibagger);

    const heatmapUS = findPart(parts, 'Sector Heatmap');
    renderSectorHeatmap(heatmapUS);

    const usSignals = findPart(parts, 'US Market Signals');
    const usSubParts = splitByHeadings(usSignals, 3);
    renderMarketSection('us-market', 'US Market Signals', usSubParts, 'us', {
      'DMA Crossovers': 'DMA',
      'Resistance Breakouts': 'Resistance',
      'RSI Extremes': 'RSI',
      'MACD Crossovers': 'MACD',
      'Bollinger Squeeze': 'Bollinger',
      'Volume Breakouts': 'Volume',
    });

    const indiaSignals = findPart(parts, 'India Market Signals') || findPart(parts, 'India Market');
    const indiaSubParts = splitByHeadings(indiaSignals, 3);
    renderMarketSection('india-market', 'India Market Signals', indiaSubParts, 'india', {
      'DMA Crossovers': 'DMA',
      'Resistance Breakouts': 'Resistance',
      'RSI Extremes': 'RSI',
      'MACD Crossovers': 'MACD',
      'Bollinger Squeeze': 'Bollinger',
      'Volume Breakouts': 'Volume',
    });

    const fullReport = findPart(parts, 'Full Report');
    const fullSubParts = splitByHeadings(fullReport, 3);
    const usFullMd = findPart(fullSubParts, 'US');
    const indiaFullMd = findPart(fullSubParts, 'India');
    renderFilterableReport('us-full-report', 'US Full Report', usFullMd, 'us');
    renderFilterableReport('india-full-report', 'India Full Report', indiaFullMd, 'india');

    document.querySelector('.tab.active').click();
  }

  // ── Render Helpers ──────────────────────────────────

  function renderSection(id, html) {
    const el = document.getElementById(`section-${id}`);
    if (el) el.innerHTML = html;
  }

  function renderOverview(md) {
    if (!md) {
      renderSection('overview', '<div class="card"><p>No market overview data in this report.</p></div>');
      return;
    }

    const html = marked.parse(md);
    const tables = extractTables(md);
    let out = '<h2 style="color:var(--text-heading);margin-bottom:1rem;">Market Overview</h2>';

    if (tables.length > 0) {
      tables.forEach(table => {
        out += '<div class="market-grid">';
        table.rows.forEach(row => {
          const change = row['Change %'] || row['Change%'] || '';
          const isPositive = change.includes('+') || (parseFloat(change) > 0);
          const isNegative = change.includes('-') || (parseFloat(change) < 0);
          out += `
            <div class="market-card">
              <div class="index-name">${row[table.headers[0]] || ''}</div>
              <div class="index-value">${row['Level'] || row[table.headers[1]] || ''}</div>
              <div class="index-change ${isPositive ? 'positive' : isNegative ? 'negative' : ''}">${change || row['Change'] || ''}</div>
            </div>`;
        });
        out += '</div>';
      });
    } else {
      out += `<div class="card markdown-body">${html}</div>`;
    }

    renderSection('overview', out);
  }

  // ── Price Column Injection ──────────────────────────

  function formatPrice(sym, market) {
    const m = market === 'india' ? 'india' : 'us';
    if (!priceDateOk[m]) return '';
    const p = priceMap[m][sym];
    if (p == null) return '';
    if (m === 'india') {
      return `₹${p.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    }
    return `$${p.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }

  function inferMarketFromRow(row, fallback) {
    const m = (row['Market'] || row['market'] || fallback || '').toString().toLowerCase();
    if (m === 'india' || m === 'in') return 'india';
    return 'us';
  }

  // Returns a new table with a "Price" column inserted after "Stock", when missing.
  function injectPrice(table, defaultMarket) {
    if (!table || !table.headers) return table;
    const hasStock = table.headers.some(h => h.toLowerCase() === 'stock');
    if (!hasStock) return table;
    const lowerHeaders = table.headers.map(h => h.toLowerCase());
    const priceAliases = ['price', 'current price', 'entry', 'entry price'];
    if (priceAliases.some(p => lowerHeaders.includes(p))) return table;

    const newHeaders = [];
    table.headers.forEach(h => {
      newHeaders.push(h);
      if (h.toLowerCase() === 'stock') newHeaders.push('Price');
    });
    const newRows = table.rows.map(row => {
      const sym = row['Stock'] || '';
      const market = inferMarketFromRow(row, defaultMarket);
      return { ...row, Price: formatPrice(sym, market) };
    });
    return { headers: newHeaders, rows: newRows };
  }

  // ── Filter Bar Helpers ──────────────────────────────
  //
  // `fields` is an array describing filter inputs. Each entry:
  //   { key, label, type, placeholder?, options? }
  // type is one of:
  //   text-contains | select-action | select-sector | select-market |
  //   select-horizon | num-min | num-max
  // `rows` is the raw row list; each row is expected to carry the key columns
  // (Sector, Action, Market, Stock, Score, Mkt Cap, Horizon, ...) already
  // as strings.
  //
  // `onApply(filteredRows)` is called whenever any filter changes; the callback
  // is responsible for re-rendering the display.

  function buildFilterBar(fields, rows, opts) {
    const id = opts.id;
    const countLabel = opts.countLabel || 'rows';

    const sectorSet = new Set();
    const horizonSet = new Set();
    const marketSet = new Set();
    rows.forEach(r => {
      if (r._sector) sectorSet.add(r._sector);
      if (r.Sector) sectorSet.add(r.Sector);
      if (r.Horizon) horizonSet.add(r.Horizon);
      if (r.Market) marketSet.add(r.Market);
    });

    const inputsHtml = fields.map((f, idx) => {
      const dataAttr = `data-filter-idx="${idx}"`;
      if (f.type === 'select-action') {
        return `<div class="filter-group">
          <label>${f.label}</label>
          <select ${dataAttr}>
            <option value="">All</option>
            <option value="STRONG BUY">STRONG BUY</option>
            <option value="BUY">BUY</option>
            <option value="WATCH">WATCH</option>
            <option value="SELL">SELL</option>
            <option value="STRONG SELL">STRONG SELL</option>
          </select>
        </div>`;
      }
      if (f.type === 'select-sector') {
        const opts = Array.from(sectorSet).sort().map(s => `<option value="${s}">${s}</option>`).join('');
        return `<div class="filter-group">
          <label>${f.label}</label>
          <select ${dataAttr}><option value="">All</option>${opts}</select>
        </div>`;
      }
      if (f.type === 'select-market') {
        const opts = Array.from(marketSet).sort().map(s => `<option value="${s}">${s}</option>`).join('');
        return `<div class="filter-group">
          <label>${f.label}</label>
          <select ${dataAttr}><option value="">All</option>${opts}</select>
        </div>`;
      }
      if (f.type === 'select-horizon') {
        const opts = Array.from(horizonSet).sort().map(s => `<option value="${s}">${s}</option>`).join('');
        return `<div class="filter-group">
          <label>${f.label}</label>
          <select ${dataAttr}><option value="">All</option>${opts}</select>
        </div>`;
      }
      if (f.type === 'text-contains') {
        return `<div class="filter-group">
          <label>${f.label}</label>
          <input type="text" ${dataAttr} placeholder="${f.placeholder || 'search'}">
        </div>`;
      }
      if (f.type === 'num-min' || f.type === 'num-max') {
        return `<div class="filter-group">
          <label>${f.label}</label>
          <input type="number" ${dataAttr} placeholder="${f.placeholder || ''}" step="any">
        </div>`;
      }
      return '';
    }).join('');

    const html = `<div class="filter-bar" id="${id}">
      ${inputsHtml}
      <div class="filter-group filter-actions">
        <button class="filter-reset">Reset</button>
        <span class="filter-count">${rows.length} ${countLabel}</span>
      </div>
    </div>`;
    return html;
  }

  function parseMktCapBytes(str) {
    if (!str) return null;
    const s = String(str).trim();
    const usMatch = s.match(/^\$?([\d.]+)\s*B$/i);
    if (usMatch) return parseFloat(usMatch[1]) * 1e9;
    const lakhCrMatch = s.match(/^([\d.]+)\s*L\s*Cr$/i);
    if (lakhCrMatch) return parseFloat(lakhCrMatch[1]) * 1e5 * 1e7;
    const crMatch = s.match(/^([\d,]+)\s*Cr$/i);
    if (crMatch) return parseFloat(crMatch[1].replace(/,/g, '')) * 1e7;
    return null;
  }

  function parseActionText(str) {
    if (!str) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = str;
    return (tmp.textContent || '').trim().toUpperCase();
  }

  function numOrNull(str) {
    if (str == null) return null;
    const s = String(str).replace(/[%,\s]/g, '');
    if (s === '' || s === '—' || s === '\u2014') return null;
    const v = parseFloat(s);
    return isNaN(v) ? null : v;
  }

  // Given a row with _sector/_action/_score/_mktCapBytes already populated and
  // a fields array + filter-bar DOM, returns only the rows matching filters.
  function applyFieldFilters(rows, fields, filterBar) {
    return rows.filter(row => {
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        const el = filterBar.querySelector(`[data-filter-idx="${i}"]`);
        if (!el) continue;
        const val = el.value;
        if (!val) continue;
        if (f.type === 'select-action') {
          const action = row._action || parseActionText(row[f.key] || row['Action'] || '');
          if (val === 'BUY' && action === 'STRONG BUY') continue;
          if (val === 'SELL' && action === 'STRONG SELL') continue;
          if (action !== val) return false;
        } else if (f.type === 'select-sector') {
          const sec = row._sector || row['Sector'] || '';
          if (sec !== val) return false;
        } else if (f.type === 'select-market') {
          if ((row['Market'] || '') !== val) return false;
        } else if (f.type === 'select-horizon') {
          if ((row['Horizon'] || '') !== val) return false;
        } else if (f.type === 'text-contains') {
          const target = String(row[f.key] || '').toLowerCase();
          if (!target.includes(val.toLowerCase())) return false;
        } else if (f.type === 'num-min') {
          const rv = f.key === 'Mkt Cap' ? row._mktCapBytes : numOrNull(row[f.key]);
          let threshold = parseFloat(val);
          if (f.key === 'Mkt Cap') {
            // user-entered Mkt Cap min is in $B for US, Cr for India; interpret via
            // the row's own unit by comparing parsed bytes.
            const isIndia = /Cr$/i.test(String(row['Mkt Cap'] || ''));
            threshold = isIndia ? threshold * 1e7 : threshold * 1e9;
          }
          if (rv == null || rv < threshold) return false;
        } else if (f.type === 'num-max') {
          const rv = numOrNull(row[f.key]);
          const threshold = parseFloat(val);
          if (rv == null || rv > threshold) return false;
        }
      }
      return true;
    });
  }

  function wireFilterBar(filterBarEl, onChange) {
    filterBarEl.querySelectorAll('select, input').forEach(el => {
      el.addEventListener('change', onChange);
      el.addEventListener('input', onChange);
    });
    const resetBtn = filterBarEl.querySelector('.filter-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        filterBarEl.querySelectorAll('select').forEach(s => s.value = '');
        filterBarEl.querySelectorAll('input').forEach(i => i.value = '');
        onChange();
      });
    }
  }

  function annotateRows(rows, opts) {
    const defaultMarket = opts && opts.defaultMarket;
    rows.forEach(row => {
      row._sector = row['Sector'] || row['sector'] || row._sector || '';
      row._action = parseActionText(row['Action'] || row['Signal'] || '');
      row._score = numOrNull(row['Score']);
      row._mktCapBytes = parseMktCapBytes(row['Mkt Cap']);
      if (!row['Market'] && defaultMarket) {
        row['Market'] = defaultMarket === 'india' ? 'India' : 'US';
      }
    });
  }

  // ── Shared Table Rendering ──────────────────────────

  // Render a single HTML-string table. Always wraps in .table-wrapper.
  function renderSimpleTable(headers, rows) {
    return `<div class="table-wrapper">
      <table>
        <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(row =>
          `<tr>${headers.map(h => `<td>${formatCell(h, row[h] || '')}</td>`).join('')}</tr>`
        ).join('')}</tbody>
      </table>
    </div>`;
  }

  // Render a table as a set of collapsible sector <details>. If there is no
  // Sector column on the table, falls back to a single table with no grouping.
  function renderSectorGroupedTable(table, opts) {
    opts = opts || {};
    const hasSector = table.headers.some(h => h.toLowerCase() === 'sector');
    if (!hasSector) {
      return renderSimpleTable(table.headers, table.rows);
    }
    const groups = {};
    table.rows.forEach(row => {
      const sector = row['Sector'] || row['sector'] || 'Other';
      if (!groups[sector]) groups[sector] = [];
      groups[sector].push(row);
    });
    const displayHeaders = table.headers.filter(h => h.toLowerCase() !== 'sector');
    const sectorNames = Object.keys(groups).sort();
    return sectorNames.map(sector => {
      const rows = groups[sector];
      return `<details class="sector-details" ${opts.open !== false ? 'open' : ''}>
        <summary>
          <h4 style="display:inline;color:var(--accent);margin:0;font-size:0.95rem;">${sector}</h4>
          <span class="count">${rows.length} ${opts.countLabel || 'row' + (rows.length !== 1 ? 's' : '')}</span>
        </summary>
        ${renderSimpleTable(displayHeaders, rows)}
      </details>`;
    }).join('');
  }

  // ── Unified Recommendations ─────────────────────────

  function renderUnifiedRecommendations(md) {
    if (!md) {
      renderSection('unified', '<div class="card"><h2>Unified Recommendations</h2><p>No signals in this section.</p></div>');
      return;
    }
    const tables = extractTables(md);
    if (tables.length === 0) {
      renderSection('unified', `<div class="card markdown-body">${marked.parse(md)}</div>`);
      return;
    }
    const rawTable = tables[0];
    // Enrich with Price column using row's Market column (US vs India)
    const enriched = injectPrice(rawTable, null);
    annotateRows(enriched.rows);

    const filterId = 'filter-unified';
    const fields = [
      { key: 'Action', label: 'Action', type: 'select-action' },
      { key: 'Market', label: 'Market', type: 'select-market' },
      { key: 'Sector', label: 'Sector', type: 'select-sector' },
      { key: 'Horizon', label: 'Horizon', type: 'select-horizon' },
      { key: 'Score', label: 'Score ≥', type: 'num-min', placeholder: 'e.g. 10' },
      { key: 'Mkt Cap', label: 'Mkt Cap ≥', type: 'num-min', placeholder: '$B / Cr' },
      { key: 'Stock', label: 'Stock contains', type: 'text-contains', placeholder: 'e.g. NVDA' },
    ];

    let out = '<h2 style="color:var(--text-heading);margin-bottom:1rem;">Unified Recommendations</h2>';
    out += `<p style="color:var(--text-muted);margin-bottom:1rem;">STRONG BUY names from both markets, ranked by composite score. Grouped by sector (click to expand/collapse). Use the filter bar to narrow down.</p>`;
    out += buildFilterBar(fields, enriched.rows, { id: filterId, countLabel: 'stocks' });
    out += `<div id="unified-body"></div>`;
    renderSection('unified', out);

    const filterBar = document.getElementById(filterId);
    const bodyEl = document.getElementById('unified-body');
    const countEl = filterBar.querySelector('.filter-count');

    function reRender() {
      const filtered = applyFieldFilters(enriched.rows, fields, filterBar);
      countEl.textContent = `${filtered.length} / ${enriched.rows.length} stocks`;
      if (filtered.length === 0) {
        bodyEl.innerHTML = '<div class="card"><p>No stocks match the current filters.</p></div>';
        return;
      }
      const bySector = {};
      filtered.forEach(r => {
        const s = r['Sector'] || 'Other';
        (bySector[s] = bySector[s] || []).push(r);
      });
      const sectorList = Object.keys(bySector).sort();
      const displayHeaders = enriched.headers.filter(h => h.toLowerCase() !== 'sector');
      bodyEl.innerHTML = sectorList.map(sector => {
        const rows = bySector[sector];
        return `<details class="market-strategy" open>
          <summary>
            <h3 style="display:inline;color:var(--accent);margin:0;">${sector}</h3>
            <span class="count">${rows.length} stock${rows.length !== 1 ? 's' : ''}</span>
          </summary>
          ${renderSimpleTable(displayHeaders, rows)}
        </details>`;
      }).join('');
    }

    wireFilterBar(filterBar, reRender);
    reRender();
  }

  // ── Top Picks ───────────────────────────────────────

  function renderTopPicks(md) {
    if (!md) {
      renderSection('top-picks', '<div class="card"><p>No top picks data in this report.</p></div>');
      return;
    }
    const subParts = splitByHeadings(md, 3);
    let out = '<h2 style="color:var(--text-heading);margin-bottom:1rem;">Top Picks</h2>';
    out += '<p style="color:var(--text-muted);margin-bottom:1rem;">Up to 50 best-buy candidates per market (30-90 day swing horizon). Gated on: label BUY/STRONG BUY, quality grade ≠ F, ≥2 strategies, RSI ≤ 70, ADX ≥ 20, 3mo return ≤ 40%, liquidity. Ranked by composite score; soft-capped at 10 per sector.</p>';

    // Gather all rows and tag each with Market inferred from its heading.
    const allRows = [];
    const marketKeys = Object.keys(subParts);
    for (const heading of marketKeys) {
      const sectionMd = subParts[heading];
      const tables = extractTables(sectionMd);
      if (tables.length === 0 || tables[0].rows.length === 0) continue;
      const headingLower = heading.toLowerCase();
      const market = headingLower.startsWith('india') ? 'India' : 'US';
      const defaultMarket = market === 'India' ? 'india' : 'us';
      const enriched = injectPrice(tables[0], defaultMarket);
      enriched.rows.forEach(row => {
        row['Market'] = market;
        row['_market_default'] = defaultMarket;
        allRows.push(row);
      });
    }

    if (allRows.length === 0) {
      out += '<div class="card"><p>No top picks in this report.</p></div>';
      renderSection('top-picks', out);
      return;
    }
    annotateRows(allRows);

    const filterId = 'filter-top-picks';
    const fields = [
      { key: 'Action', label: 'Action', type: 'select-action' },
      { key: 'Market', label: 'Market', type: 'select-market' },
      { key: 'Sector', label: 'Sector', type: 'select-sector' },
      { key: 'Score', label: 'Score ≥', type: 'num-min', placeholder: 'e.g. 10' },
      { key: 'Stock', label: 'Stock contains', type: 'text-contains', placeholder: 'e.g. NVDA' },
    ];
    out += buildFilterBar(fields, allRows, { id: filterId, countLabel: 'picks' });
    out += `<div id="top-picks-body"></div>`;
    renderSection('top-picks', out);

    const filterBar = document.getElementById(filterId);
    const bodyEl = document.getElementById('top-picks-body');
    const countEl = filterBar.querySelector('.filter-count');

    function rowToCard(row, i) {
      const strategies = row['Strategies Triggered'] || row['strategies triggered'] || '';
      const badges = strategies.split(',').map(s => s.trim()).filter(Boolean)
        .map(s => `<span class="badge badge-buy">${s}</span>`).join(' ');
      const mcap = row['Mkt Cap'] || '';
      const mcapHtml = mcap ? `<span style="color:var(--text-muted);font-size:0.8rem;margin-left:0.5rem;">${mcap}</span>` : '';
      const score = row['Score'] || '';
      const scoreNum = parseFloat(score);
      const scoreClass = !isNaN(scoreNum) ? (scoreNum > 0 ? 'positive' : scoreNum < 0 ? 'negative' : '') : '';
      const scoreHtml = score ? `<span class="index-change ${scoreClass}" style="font-size:0.85rem;font-weight:600;">${score}</span>` : '';
      const price = row['Price'] || '';
      const priceHtml = price ? `<div style="font-size:0.82rem;color:var(--text-heading);font-family:var(--font-mono);min-width:5rem;text-align:right;">${price}</div>` : '';
      return `
        <div class="top-pick">
          <div class="rank">#${row['Rank'] || i + 1}</div>
          <div class="stock-info">
            <div class="stock-name">${row['Stock'] || ''}${mcapHtml}</div>
            <div class="stock-sector">${row['Sector'] || ''} <span style="color:var(--text-muted);">· ${row['Market']}</span></div>
          </div>
          ${priceHtml}
          <div style="text-align:center;min-width:3rem;">${scoreHtml}</div>
          <div class="strategies">${badges}</div>
          <div>${actionBadge(row['Action'] || '')}</div>
        </div>`;
    }

    function reRender() {
      const filtered = applyFieldFilters(allRows, fields, filterBar);
      countEl.textContent = `${filtered.length} / ${allRows.length} picks`;
      if (filtered.length === 0) {
        bodyEl.innerHTML = '<div class="card"><p>No picks match the current filters.</p></div>';
        return;
      }
      // Group by Market → Sector
      const byMarket = {};
      filtered.forEach(r => {
        const mk = r['Market'] || 'US';
        if (!byMarket[mk]) byMarket[mk] = {};
        const sec = r['Sector'] || 'Other';
        (byMarket[mk][sec] = byMarket[mk][sec] || []).push(r);
      });
      const markets = Object.keys(byMarket).sort();
      bodyEl.innerHTML = markets.map(mk => {
        const sectors = Object.keys(byMarket[mk]).sort();
        const totalCount = sectors.reduce((n, s) => n + byMarket[mk][s].length, 0);
        const sectorHtml = sectors.map(sector => {
          const rows = byMarket[mk][sector];
          return `<details class="sector-details" open>
            <summary>
              <h4 style="display:inline;color:var(--accent);margin:0;font-size:0.95rem;">${sector}</h4>
              <span class="count">${rows.length} pick${rows.length !== 1 ? 's' : ''}</span>
            </summary>
            <div style="padding:0.5rem 1rem;">
              ${rows.map((r, i) => rowToCard(r, i)).join('')}
            </div>
          </details>`;
        }).join('');
        return `<details class="market-strategy" open>
          <summary>
            <h3 style="display:inline;color:var(--accent);margin:0;">${mk} — Top Picks</h3>
            <span class="count">${totalCount} pick${totalCount !== 1 ? 's' : ''}</span>
          </summary>
          <div style="padding:0.5rem 1rem;">${sectorHtml}</div>
        </details>`;
      }).join('');
    }

    wireFilterBar(filterBar, reRender);
    reRender();
  }

  // ── Multi-bagger Watch ──────────────────────────────

  function renderMultibagger(md) {
    if (!md) {
      renderSection('multibagger', '<div class="card"><p>No multi-bagger data in this report.</p></div>');
      return;
    }

    const subParts = splitByHeadings(md, 3);
    let out = '<h2 style="color:var(--text-heading);margin-bottom:1rem;">Multi-bagger Watch</h2>';
    out += '<p style="color:var(--text-muted);margin-bottom:1rem;">Names that look early in their momentum phase. <strong>Multi-bagger Early</strong>: passes the strict gate. <strong>Quad Green</strong>: 1D+5D+15D+30D positive AND OBV trending up. <strong>Streak 15D</strong>: 3 of 4 timeframes positive.</p>';

    const marketBuckets = {
      US: ['US — Multi-bagger Early', 'US — Quad Green', 'US — Streak 15D'],
      India: ['India — Multi-bagger Early', 'India — Quad Green', 'India — Streak 15D'],
    };
    const matchHeading = (heading) => Object.keys(subParts).find(k =>
      k.replace(/\s+/g, ' ').trim() === heading ||
      k.replace(/—|-/g, '').replace(/\s+/g, ' ').trim() === heading.replace(/—|-/g, '').replace(/\s+/g, ' ').trim()
    );

    // Pre-build a rows-per-bucket structure so filters can re-render
    // without reparsing the markdown.
    const bucketRows = { US: {}, India: {} };
    for (const mk of ['US', 'India']) {
      const defaultMarket = mk === 'India' ? 'india' : 'us';
      for (const heading of marketBuckets[mk]) {
        const matched = matchHeading(heading);
        if (!matched) continue;
        const tables = extractTables(subParts[matched]);
        if (tables.length === 0) continue;
        const enriched = injectPrice(tables[0], defaultMarket);
        const rows = enriched.rows.filter(r => r['Stock']);
        rows.forEach(row => { row['Market'] = mk; });
        annotateRows(rows, { defaultMarket: mk });
        bucketRows[mk][heading] = { rows, headers: enriched.headers };
      }
    }

    const renderReturn = (val) => {
      if (val === undefined || val === null || val === '') return '<span style="color:var(--text-muted);">—</span>';
      const s = String(val).replace('%', '').trim();
      const n = parseFloat(s);
      if (isNaN(n)) return `<span>${val}</span>`;
      const color = n > 0 ? 'var(--positive,#22c55e)' : n < 0 ? 'var(--negative,#ef4444)' : 'var(--text-muted)';
      const sign = n > 0 ? '+' : '';
      return `<span style="color:${color};font-weight:600;">${sign}${n.toFixed(2)}%</span>`;
    };

    const renderBadges = (badgeStr) => {
      if (!badgeStr || badgeStr === '—') return '';
      const tokens = (badgeStr.match(/`([^`]+)`/g) || []).map(t => t.replace(/`/g, ''));
      return tokens.map(tok => {
        const lower = tok.toLowerCase();
        let cls = 'badge-buy';
        if (lower.includes('multibagger')) cls = 'badge-strong-buy';
        else if (lower.includes('quad')) cls = 'badge-buy';
        else if (lower.includes('streak')) cls = 'badge-watch';
        else if (lower.includes('vol')) cls = 'badge-buy';
        else if (lower.includes('accum')) cls = 'badge-buy';
        return `<span class="badge ${cls}" style="margin-right:0.25rem;">${tok}</span>`;
      }).join('');
    };

    const tableHeaders = ['Rank', 'Stock', 'Price', 'Sector', 'Mkt Cap', 'Score', '1D', '5D', '15D', '30D', 'Badges', 'Action'];

    const renderBucketBody = (filtered) => {
      if (filtered.length === 0) {
        return `<div class="card" style="padding:0.75rem 1rem;color:var(--text-muted);margin:0.5rem 1rem;">No names match filters in this bucket.</div>`;
      }
      // Group by Sector
      const bySector = {};
      filtered.forEach(r => {
        const s = r['Sector'] || 'Other';
        (bySector[s] = bySector[s] || []).push(r);
      });
      const sectorList = Object.keys(bySector).sort();
      return sectorList.map(sector => {
        const rows = bySector[sector];
        const inner = `<div class="table-wrapper"><table><thead><tr>${tableHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>` +
          rows.map((row, i) => {
            return '<tr>' +
              `<td>${row['Rank'] || i + 1}</td>` +
              `<td style="font-weight:600;">${row['Stock']}</td>` +
              `<td style="color:var(--text-heading);">${row['Price'] || ''}</td>` +
              `<td style="color:var(--text-muted);">${row['Sector'] || ''}</td>` +
              `<td style="color:var(--text-muted);">${row['Mkt Cap'] || ''}</td>` +
              `<td>${row['Score'] || ''}</td>` +
              `<td>${renderReturn(row['1D'])}</td>` +
              `<td>${renderReturn(row['5D'])}</td>` +
              `<td>${renderReturn(row['15D'])}</td>` +
              `<td>${renderReturn(row['30D'])}</td>` +
              `<td>${renderBadges(row['Badges'] || '')}</td>` +
              `<td>${actionBadge(row['Action'] || '')}</td>` +
              '</tr>';
          }).join('') + '</tbody></table></div>';
        return `<details class="sector-details" open>
          <summary>
            <h4 style="display:inline;color:var(--accent);margin:0;font-size:0.95rem;">${sector}</h4>
            <span class="count">${rows.length} name${rows.length !== 1 ? 's' : ''}</span>
          </summary>
          ${inner}
        </details>`;
      }).join('');
    };

    // Per-market filter bar + panel
    const renderMarketPanel = (marketKey) => {
      const allBucketRows = [];
      for (const heading of marketBuckets[marketKey]) {
        if (bucketRows[marketKey][heading]) {
          bucketRows[marketKey][heading].rows.forEach(r => allBucketRows.push(r));
        }
      }
      const filterId = `filter-mb-${marketKey.toLowerCase()}`;
      const bodyId = `mb-body-${marketKey.toLowerCase()}`;
      const fields = [
        { key: 'Action', label: 'Action', type: 'select-action' },
        { key: 'Sector', label: 'Sector', type: 'select-sector' },
        { key: 'Score', label: 'Score ≥', type: 'num-min', placeholder: 'e.g. 5' },
        { key: 'Stock', label: 'Stock contains', type: 'text-contains', placeholder: 'e.g. NVDA' },
      ];
      const bar = buildFilterBar(fields, allBucketRows, { id: filterId, countLabel: 'names' });
      return `${bar}<div id="${bodyId}"></div>`;
    };

    out += `
      <div class="mb-subtabs" style="display:flex;gap:0.25rem;margin-bottom:1rem;">
        <button class="tab active" data-mb-market="US">US</button>
        <button class="tab" data-mb-market="India">India</button>
      </div>
      <div class="mb-panel" data-mb-panel="US">${renderMarketPanel('US')}</div>
      <div class="mb-panel" data-mb-panel="India" style="display:none;">${renderMarketPanel('India')}</div>
    `;

    renderSection('multibagger', out);

    // Wire up filter bars + sub-tabs
    const root = document.getElementById('section-multibagger');
    if (!root) return;

    for (const mk of ['US', 'India']) {
      const filterId = `filter-mb-${mk.toLowerCase()}`;
      const bodyId = `mb-body-${mk.toLowerCase()}`;
      const filterBar = document.getElementById(filterId);
      const bodyEl = document.getElementById(bodyId);
      if (!filterBar || !bodyEl) continue;
      const countEl = filterBar.querySelector('.filter-count');

      const fields = [
        { key: 'Action', label: 'Action', type: 'select-action' },
        { key: 'Sector', label: 'Sector', type: 'select-sector' },
        { key: 'Score', label: 'Score ≥', type: 'num-min' },
        { key: 'Stock', label: 'Stock contains', type: 'text-contains' },
      ];

      const totalRows = marketBuckets[mk].reduce((n, h) => n + ((bucketRows[mk][h] && bucketRows[mk][h].rows.length) || 0), 0);

      function reRender() {
        let shownTotal = 0;
        const html = marketBuckets[mk].map(heading => {
          const shortHeading = heading.replace(/^(US|India)\s*[—-]\s*/, '');
          const bucket = bucketRows[mk][heading];
          if (!bucket) {
            return `<details class="market-strategy" open>
              <summary><h3 style="display:inline;color:var(--accent);margin:0;">${shortHeading}</h3>
              <span class="count">0 names</span></summary>
              <div class="card" style="padding:0.75rem 1rem;color:var(--text-muted);margin:0.5rem 1rem;">No qualifying names today.</div>
            </details>`;
          }
          const filtered = applyFieldFilters(bucket.rows, fields, filterBar);
          shownTotal += filtered.length;
          return `<details class="market-strategy" open>
            <summary><h3 style="display:inline;color:var(--accent);margin:0;">${shortHeading}</h3>
            <span class="count">${filtered.length} / ${bucket.rows.length} name${bucket.rows.length !== 1 ? 's' : ''}</span></summary>
            ${renderBucketBody(filtered)}
          </details>`;
        }).join('');
        countEl.textContent = `${shownTotal} / ${totalRows} names`;
        bodyEl.innerHTML = html;
      }
      wireFilterBar(filterBar, reRender);
      reRender();
    }

    root.querySelectorAll('[data-mb-market]').forEach(btn => {
      btn.addEventListener('click', () => {
        const market = btn.getAttribute('data-mb-market');
        root.querySelectorAll('[data-mb-market]').forEach(b =>
          b.classList.toggle('active', b.getAttribute('data-mb-market') === market));
        root.querySelectorAll('[data-mb-panel]').forEach(p =>
          p.style.display = p.getAttribute('data-mb-panel') === market ? '' : 'none');
      });
    });
  }

  // ── Sector Heatmap ──────────────────────────────────

  function renderSectorHeatmap(md) {
    if (!md) {
      renderSection('sector-heatmap', '<div class="card"><p>No sector heatmap data in this report.</p></div>');
      return;
    }

    const subParts = splitByHeadings(md, 3);
    let out = '<h2 style="color:var(--text-heading);margin-bottom:1rem;">Sector Heatmap</h2>';

    for (const [title, content] of Object.entries(subParts)) {
      const tables = extractTables(content);
      if (tables.length === 0) continue;

      out += `<h3 style="color:var(--accent);margin:1rem 0 0.75rem;">${title}</h3>`;
      out += '<div class="heatmap-grid">';

      tables[0].rows.forEach(row => {
        const status = (row['Status'] || '').toLowerCase().trim();
        const cssClass = status === 'hot' ? 'hot' : status === 'warm' ? 'warm' : status === 'cold' ? 'cold' : 'neutral';
        const buy = row['Buy Signals'] || '0';
        const sell = row['Sell Signals'] || '0';

        out += `
          <div class="heatmap-card ${cssClass}">
            <div class="sector-name">${row['Sector'] || ''}</div>
            <div class="sector-stats">${buy} buy · ${sell} sell</div>
            <div style="margin-top:0.3rem;"><span class="badge badge-${cssClass}">${status.toUpperCase() || 'NEUTRAL'}</span></div>
          </div>`;
      });

      out += '</div>';
    }

    if (!out.includes('heatmap-card')) {
      out += `<div class="card markdown-body">${marked.parse(md)}</div>`;
    }

    renderSection('sector-heatmap', out);
  }

  // ── Market Signals (US / India) ─────────────────────

  function renderMarketSection(id, title, subParts, defaultMarket, strategyMap) {
    // Collect strategy tables in order, enrich with price, and gather all rows
    // for the cross-strategy filter bar.
    const strategies = [];  // [{title, headers, rows}]
    const allRows = [];

    for (const [displayTitle, keyword] of Object.entries(strategyMap)) {
      let content = subParts[displayTitle];
      if (!content) {
        const key = Object.keys(subParts).find(k =>
          k === displayTitle || k.endsWith(displayTitle) || k.toLowerCase().includes(keyword.toLowerCase()));
        content = key ? subParts[key] : '';
      }
      if (!content) continue;

      const tables = extractTables(content);
      const hasRows = tables.some(t => t.rows.length > 0);
      if (!hasRows) continue;
      // Only first table per strategy section (strategies always emit a single
      // table). Enrich with price; tag rows with strategy for filtering.
      const enriched = injectPrice(tables[0], defaultMarket);
      enriched.rows.forEach(row => {
        row._strategy = displayTitle;
      });
      annotateRows(enriched.rows, { defaultMarket });
      strategies.push({ title: displayTitle, headers: enriched.headers, rows: enriched.rows });
      enriched.rows.forEach(r => allRows.push(r));
    }

    if (strategies.length === 0) {
      renderSection(id, `<h2 style="color:var(--text-heading);margin-bottom:1rem;">${title}</h2>
        <div class="card"><p>No signals in this market today.</p></div>`);
      return;
    }

    const filterId = `filter-${id}`;
    const fields = [
      { key: 'Action', label: 'Action', type: 'select-action' },
      { key: 'Sector', label: 'Sector', type: 'select-sector' },
      { key: 'Stock', label: 'Stock contains', type: 'text-contains', placeholder: 'e.g. NVDA' },
    ];

    let out = `<h2 style="color:var(--text-heading);margin-bottom:1rem;">${title}</h2>`;
    out += buildFilterBar(fields, allRows, { id: filterId, countLabel: 'signals' });
    out += `<div id="${id}-body"></div>`;
    renderSection(id, out);

    const filterBar = document.getElementById(filterId);
    const bodyEl = document.getElementById(`${id}-body`);
    const countEl = filterBar.querySelector('.filter-count');

    function reRender() {
      let totalShown = 0;
      const html = strategies.map(strat => {
        const filtered = applyFieldFilters(strat.rows, fields, filterBar);
        totalShown += filtered.length;
        const tbl = { headers: strat.headers, rows: filtered };
        const inner = filtered.length === 0
          ? `<div class="card" style="padding:0.75rem 1rem;color:var(--text-muted);margin:0.5rem 1rem;">No signals match the current filters.</div>`
          : renderSectorGroupedTable(tbl, { countLabel: 'signal' + (filtered.length !== 1 ? 's' : '') });
        return `<details class="market-strategy" open>
          <summary>
            <h3 style="display:inline;color:var(--accent);margin:0;">${strat.title}</h3>
            <span class="count">${filtered.length} / ${strat.rows.length} signal${strat.rows.length !== 1 ? 's' : ''}</span>
          </summary>
          ${inner}
        </details>`;
      }).join('');
      countEl.textContent = `${totalShown} / ${allRows.length} signals`;
      bodyEl.innerHTML = html;
    }
    wireFilterBar(filterBar, reRender);
    reRender();
  }

  // ── Swing Trades ────────────────────────────────────

  function renderSwing(md) {
    if (!md) {
      renderSection('swing',
        '<div class="card"><h2>Swing Trades</h2>' +
        '<p>No swing report for this date. Run <code>py -3.12 -m scripts.run_swing</code> to generate one.</p></div>');
      return;
    }

    const parts = splitByHeadings(md, 2);
    const summary = findPart(parts, 'Summary');
    const usMd = findPart(parts, 'US Swing');
    const indiaMd = findPart(parts, 'India Swing');
    const methodology = findPart(parts, 'Methodology');

    let out = '<h2 style="color:var(--text-heading);margin-bottom:1rem;">Swing Trades</h2>';
    out += '<p style="color:var(--text-muted);margin-bottom:1rem;">Pullback-in-uptrend setups, 30-90 day horizon. Entry / stop / target are ATR-based.</p>';

    if (summary) {
      const tables = extractTables(summary);
      if (tables.length > 0) {
        out += '<div class="market-grid">';
        tables[0].rows.forEach(row => {
          out += `
            <div class="market-card">
              <div class="index-name">${row['Metric'] || ''}</div>
              <div class="index-value">${row['Value'] || ''}</div>
            </div>`;
        });
        out += '</div>';
      }
    }

    // Gather rows for each market for filter bar
    const markets = [
      { key: 'us', label: 'US Swing Trades', md: usMd },
      { key: 'india', label: 'India Swing Trades', md: indiaMd },
    ];
    const marketTables = {};
    const allSwingRows = [];
    for (const mk of markets) {
      const tables = extractTables(mk.md || '');
      if (tables.length === 0 || tables[0].rows.length === 0) {
        marketTables[mk.key] = null;
        continue;
      }
      // Swing tables already have "Entry" which is effectively the current price,
      // so don't inject. Just annotate.
      tables[0].rows.forEach(row => {
        row['Market'] = mk.key === 'india' ? 'India' : 'US';
      });
      annotateRows(tables[0].rows, { defaultMarket: mk.key });
      marketTables[mk.key] = tables[0];
      tables[0].rows.forEach(r => allSwingRows.push(r));
    }

    if (allSwingRows.length === 0) {
      out += '<div class="card"><p>No swing setups in this report.</p></div>';
      if (methodology) out += `<div class="card markdown-body" style="margin-top:1rem;">${marked.parse(methodology)}</div>`;
      renderSection('swing', out);
      return;
    }

    const filterId = 'filter-swing';
    const fields = [
      { key: 'Market', label: 'Market', type: 'select-market' },
      { key: 'Sector', label: 'Sector', type: 'select-sector' },
      { key: 'R:R', label: 'R:R ≥', type: 'num-min', placeholder: 'e.g. 1.5' },
      { key: 'Stock', label: 'Stock contains', type: 'text-contains', placeholder: 'e.g. NVDA' },
    ];
    out += buildFilterBar(fields, allSwingRows, { id: filterId, countLabel: 'setups' });
    out += `<div id="swing-body"></div>`;
    if (methodology) {
      out += `<div class="card markdown-body" style="margin-top:1rem;">${marked.parse(methodology)}</div>`;
    }
    renderSection('swing', out);

    const filterBar = document.getElementById(filterId);
    const bodyEl = document.getElementById('swing-body');
    const countEl = filterBar.querySelector('.filter-count');

    function reRender() {
      let totalShown = 0;
      const htmlParts = [];
      for (const mk of markets) {
        const tbl = marketTables[mk.key];
        if (!tbl) {
          htmlParts.push(`<details class="market-strategy" open>
            <summary><h3 style="display:inline;color:var(--accent);margin:0;">${mk.label}</h3>
            <span class="count">0 setups</span></summary>
            <div class="card" style="margin:0.5rem 1rem;"><p>No setups in this market today.</p></div>
          </details>`);
          continue;
        }
        const filtered = applyFieldFilters(tbl.rows, fields, filterBar);
        totalShown += filtered.length;
        const inner = filtered.length === 0
          ? `<div class="card" style="padding:0.75rem 1rem;color:var(--text-muted);margin:0.5rem 1rem;">No setups match the current filters.</div>`
          : renderSectorGroupedTable({ headers: tbl.headers, rows: filtered }, { countLabel: 'setup' + (filtered.length !== 1 ? 's' : '') });
        htmlParts.push(`<details class="market-strategy" open>
          <summary><h3 style="display:inline;color:var(--accent);margin:0;">${mk.label}</h3>
          <span class="count">${filtered.length} / ${tbl.rows.length} setup${tbl.rows.length !== 1 ? 's' : ''}</span></summary>
          ${inner}
        </details>`);
      }
      countEl.textContent = `${totalShown} / ${allSwingRows.length} setups`;
      bodyEl.innerHTML = htmlParts.join('');
    }
    wireFilterBar(filterBar, reRender);
    reRender();
  }

  // ── Filterable Full Report ──────────────────────────

  function renderFilterableReport(id, title, md, market) {
    if (!md) {
      renderSection(id, `<div class="card"><h2>${title}</h2><p>No data in this section.</p></div>`);
      return;
    }

    const sectorParts = splitByHeadings(md, 4);
    const allRows = [];
    const allSectors = new Set();

    for (const [sector, sectionMd] of Object.entries(sectorParts)) {
      const tables = extractTables(sectionMd);
      if (tables.length === 0) continue;
      // Enrich the table with Price after Stock
      const enriched = injectPrice(tables[0], market);
      allSectors.add(sector);
      enriched.rows.forEach(row => {
        row._sector = sector;
        row._score = numOrNull(row['Score']) || 0;
        row._mktCapRaw = parseMktCapBytes(row['Mkt Cap']);
        row._action = parseActionText(row['Action']);
        row._rsi = numOrNull(row['RSI']);
        row._adx = numOrNull(row['ADX']);
        row._macdPct = numOrNull(row['MACD Hist%']);
        row._volRatio = numOrNull(row['Vol Ratio']);
        row._pct52w = numOrNull(row['52W High%']);
        row._ret3m = numOrNull(row['Ret 3M']);
        row._ret1m = numOrNull(row['Ret 1M']);
        row._relStr3m = numOrNull(row['Rel Str 3M']);
        allRows.push(row);
      });
    }

    if (allRows.length === 0) {
      renderSection(id, `<div class="card"><h2>${title}</h2><p>No data in this section.</p></div>`);
      return;
    }

    const headers = [
      'Stock', 'Price', 'Mkt Cap', 'Score', 'Horizon',
      'RSI', 'ADX', 'MACD Hist%', 'Vol Ratio', '52W High%',
      'Ret 3M', 'Ret 1M', 'Rel Str 3M',
      'Strategies Triggered', 'Analyst Rating', 'Target (Upside)', 'Action',
    ];
    const capUnit = market === 'india' ? 'Cr' : '$B';

    const sectorOptions = Array.from(allSectors).sort().map(s =>
      `<option value="${s}">${s}</option>`).join('');

    const filterId = `filter-${id}`;
    let out = `<h2 style="color:var(--text-heading);margin-bottom:1rem;">${title}</h2>`;
    out += `<div class="filter-bar" id="${filterId}">
      <div class="filter-group">
        <label>Action</label>
        <select data-filter="action">
          <option value="">All</option>
          <option value="STRONG BUY">STRONG BUY</option>
          <option value="BUY">BUY</option>
          <option value="WATCH">WATCH</option>
          <option value="SELL">SELL</option>
          <option value="STRONG SELL">STRONG SELL</option>
        </select>
      </div>
      <div class="filter-group">
        <label>Sector</label>
        <select data-filter="sector">
          <option value="">All</option>
          ${sectorOptions}
        </select>
      </div>
      <div class="filter-group">
        <label>Stock contains</label>
        <input type="text" data-filter="stock" placeholder="e.g. NVDA">
      </div>
      <div class="filter-group">
        <label>Mkt Cap &ge; (${capUnit})</label>
        <input type="number" data-filter="mktcap-min" placeholder="e.g. 100" step="any">
      </div>
      <div class="filter-group">
        <label>Score &ge;</label>
        <input type="number" data-filter="score-min" placeholder="e.g. 5" step="any">
      </div>
      <div class="filter-row-break"></div>
      <div class="filter-group">
        <label>RSI &le;</label>
        <input type="number" data-filter="rsi-max" placeholder="e.g. 70" step="any">
      </div>
      <div class="filter-group">
        <label>RSI &ge;</label>
        <input type="number" data-filter="rsi-min" placeholder="e.g. 30" step="any">
      </div>
      <div class="filter-group">
        <label>ADX &ge;</label>
        <input type="number" data-filter="adx-min" placeholder="e.g. 25" step="any">
      </div>
      <div class="filter-group">
        <label>ADX &le;</label>
        <input type="number" data-filter="adx-max" placeholder="e.g. 20" step="any">
      </div>
      <div class="filter-group">
        <label>MACD Hist% &ge;</label>
        <input type="number" data-filter="macd-min" placeholder="e.g. 0" step="any">
      </div>
      <div class="filter-group">
        <label>Vol Ratio &ge;</label>
        <input type="number" data-filter="vol-min" placeholder="e.g. 2" step="any">
      </div>
      <div class="filter-group">
        <label>52W High% &ge;</label>
        <input type="number" data-filter="pct52w-min" placeholder="e.g. -5" step="any">
      </div>
      <div class="filter-group">
        <label>Ret 3M &ge;</label>
        <input type="number" data-filter="ret3m-min" placeholder="e.g. 10" step="any">
      </div>
      <div class="filter-group">
        <label>Rel Str 3M &ge;</label>
        <input type="number" data-filter="relstr-min" placeholder="e.g. 5" step="any">
      </div>
      <div class="filter-group filter-actions">
        <button class="filter-reset">Reset</button>
        <span class="filter-count">${allRows.length} stocks</span>
      </div>
    </div>`;

    out += `<div class="table-wrapper" id="table-${id}"></div>`;
    renderSection(id, out);

    const filterBar = document.getElementById(filterId);
    const tableContainer = document.getElementById(`table-${id}`);
    const countEl = filterBar.querySelector('.filter-count');

    function _fval(attr) {
      const v = filterBar.querySelector(`[data-filter="${attr}"]`).value;
      return v ? parseFloat(v) : null;
    }

    function applyFilters() {
      const actionVal = filterBar.querySelector('[data-filter="action"]').value;
      const sectorVal = filterBar.querySelector('[data-filter="sector"]').value;
      const stockVal = (filterBar.querySelector('[data-filter="stock"]').value || '').toLowerCase();
      const mktCapMin = _fval('mktcap-min');
      const scoreMin = _fval('score-min');
      const rsiMax = _fval('rsi-max');
      const rsiMin = _fval('rsi-min');
      const adxMin = _fval('adx-min');
      const adxMax = _fval('adx-max');
      const macdMin = _fval('macd-min');
      const volMin = _fval('vol-min');
      const pct52wMin = _fval('pct52w-min');
      const ret3mMin = _fval('ret3m-min');
      const relStrMin = _fval('relstr-min');

      const mktCapMinRaw = mktCapMin !== null
        ? (market === 'india' ? mktCapMin * 1e7 : mktCapMin * 1e9)
        : null;

      function _check(val, min, max) {
        if (min !== null && (val === null || val < min)) return false;
        if (max !== null && (val === null || val > max)) return false;
        return true;
      }

      const filtered = allRows.filter(row => {
        if (actionVal) {
          if (actionVal === 'BUY' && row._action === 'STRONG BUY') { /* ok */ }
          else if (actionVal === 'SELL' && row._action === 'STRONG SELL') { /* ok */ }
          else if (row._action !== actionVal) return false;
        }
        if (sectorVal && row._sector !== sectorVal) return false;
        if (stockVal && !(row['Stock'] || '').toLowerCase().includes(stockVal)) return false;
        if (mktCapMinRaw !== null && (row._mktCapRaw === null || row._mktCapRaw < mktCapMinRaw)) return false;
        if (scoreMin !== null && row._score < scoreMin) return false;
        if (!_check(row._rsi, rsiMin, rsiMax)) return false;
        if (!_check(row._adx, adxMin, adxMax)) return false;
        if (!_check(row._macdPct, macdMin, null)) return false;
        if (!_check(row._volRatio, volMin, null)) return false;
        if (!_check(row._pct52w, pct52wMin, null)) return false;
        if (!_check(row._ret3m, ret3mMin, null)) return false;
        if (!_check(row._relStr3m, relStrMin, null)) return false;
        return true;
      });

      countEl.textContent = `${filtered.length} / ${allRows.length} stocks`;

      const groups = {};
      filtered.forEach(row => {
        if (!groups[row._sector]) groups[row._sector] = [];
        groups[row._sector].push(row);
      });

      let html = '';
      const displayHeaders = headers.filter(h => h !== 'Sector');
      for (const [sector, rows] of Object.entries(groups)) {
        html += `
          <details class="market-strategy" open>
            <summary><h3 style="display:inline;color:var(--accent);margin:0;">${sector}</h3>
            <span class="count">${rows.length} stock${rows.length !== 1 ? 's' : ''}</span></summary>
            <div class="table-wrapper">
              <table>
                <thead><tr>${displayHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead>
                <tbody>${rows.map(row =>
                  `<tr>${displayHeaders.map(h => `<td>${formatCell(h, row[h] || '')}</td>`).join('')}</tr>`
                ).join('')}</tbody>
              </table>
            </div>
          </details>`;
      }

      if (filtered.length === 0) {
        html = '<div class="card"><p>No stocks match the current filters.</p></div>';
      }

      tableContainer.innerHTML = html;
    }

    filterBar.querySelectorAll('select, input').forEach(el => {
      el.addEventListener('change', applyFilters);
      el.addEventListener('input', applyFilters);
    });
    filterBar.querySelector('.filter-reset').addEventListener('click', () => {
      filterBar.querySelectorAll('select').forEach(s => s.value = '');
      filterBar.querySelectorAll('input').forEach(i => i.value = '');
      applyFilters();
    });

    applyFilters();
  }

  // ── Cell Formatting ─────────────────────────────────

  function formatCell(header, value) {
    const h = header.toLowerCase();
    const v = (value == null ? '' : String(value)).trim();

    if (h === 'action' || h === 'signal' || h === 'recommendation' || h === 'status'
      || h === 'condition' || h === 'outcome') {
      return actionBadge(v);
    }

    if ((h.includes('change') || h === 'return %') && v) {
      const num = parseFloat(v);
      if (!isNaN(num)) {
        const cls = num > 0 ? 'positive' : num < 0 ? 'negative' : '';
        return `<span class="index-change ${cls}">${v}</span>`;
      }
    }

    if (v === '\u2014' || v === '—' || v === '') return `<span style="color:var(--text-muted);">—</span>`;

    // Price cell: keep the formatted currency as-is (no numeric color)
    if (h === 'price' || h === 'current price' || h === 'entry' || h === 'entry price') {
      return `<span style="color:var(--text-heading);font-family:var(--font-mono);">${v}</span>`;
    }

    const num = parseFloat(v);
    if (isNaN(num)) return v;

    if (h === 'rsi') {
      const cls = num <= 30 ? 'positive' : num >= 70 ? 'negative' : '';
      return cls ? `<span class="index-change ${cls}">${v}</span>` : v;
    }
    if (h === 'adx') {
      return num >= 25 ? `<strong>${v}</strong>` : v;
    }
    if (h === 'score' || h === 'macd hist%' || h === 'ret 3m' || h === 'ret 1m'
        || h === 'rel str 3m' || h === '52w high%') {
      const cls = num > 0 ? 'positive' : num < 0 ? 'negative' : '';
      return cls ? `<span class="index-change ${cls}">${v}</span>` : v;
    }
    if (h === 'vol ratio') {
      return num >= 2 ? `<strong class="index-change positive">${v}</strong>` : v;
    }

    return v;
  }

  function actionBadge(text) {
    if (!text) return '';

    let label = text;
    let titleAttr = '';
    const m = text.match(/<span\s+title="([^"]*)"\s*>([^<]+)<\/span>/i);
    if (m) {
      label = m[2];
      titleAttr = ` title="${m[1]}"`;
    }

    const t = label.toUpperCase().trim();
    if (t.includes('STRONG BUY') || t.includes('STRONG_BUY'))
      return `<span class="badge badge-strong-buy"${titleAttr}>${label}</span>`;
    if (t.includes('BUY') || t.includes('BULLISH'))
      return `<span class="badge badge-buy"${titleAttr}>${label}</span>`;
    if (t.includes('STRONG SELL') || t.includes('STRONG_SELL'))
      return `<span class="badge badge-strong-sell"${titleAttr}>${label}</span>`;
    if (t.includes('SELL') || t.includes('BEARISH'))
      return `<span class="badge badge-sell"${titleAttr}>${label}</span>`;
    if (t.includes('WATCH') || t.includes('NEUTRAL') || t.includes('HOLD'))
      return `<span class="badge badge-watch"${titleAttr}>${label}</span>`;
    if (t.includes('WIN'))
      return `<span class="badge badge-buy"${titleAttr}>${label}</span>`;
    if (t.includes('LOSS'))
      return `<span class="badge badge-sell"${titleAttr}>${label}</span>`;
    if (t === 'HOT') return `<span class="badge badge-hot"${titleAttr}>${label}</span>`;
    if (t === 'WARM') return `<span class="badge badge-warm"${titleAttr}>${label}</span>`;
    if (t === 'COLD') return `<span class="badge badge-cold"${titleAttr}>${label}</span>`;
    return `<span class="badge badge-neutral"${titleAttr}>${label}</span>`;
  }

  // ── Markdown Parsing Utilities ──────────────────────

  function splitByHeadings(md, level) {
    const prefix = '#'.repeat(level);
    const regex = new RegExp(`^${prefix}\\s+(.+)$`, 'gm');
    const parts = {};
    let lastKey = '';
    let lastIndex = 0;

    let match;
    while ((match = regex.exec(md)) !== null) {
      if (lastKey) {
        parts[lastKey] = md.slice(lastIndex, match.index).trim();
      }
      lastKey = match[1].replace(/\r$/, '').trim();
      lastIndex = match.index + match[0].length;
    }
    if (lastKey) {
      parts[lastKey] = md.slice(lastIndex).trim();
    }
    return parts;
  }

  function findPart(parts, keyword) {
    const kw = keyword.toLowerCase();
    for (const [key, val] of Object.entries(parts)) {
      if (key.toLowerCase().includes(kw)) return val;
    }
    return '';
  }

  function extractTables(md) {
    const tableRegex = /(\|[^\n]+\|\n)(\|[\s:|-]+\|\n)((?:\|[^\n]+\|\n?)*)/g;
    const tables = [];
    let match;

    while ((match = tableRegex.exec(md)) !== null) {
      const headerLine = match[1].trim();
      const bodyLines = match[3].trim().split('\n').filter(Boolean);

      const headers = headerLine.split('|').map(h => h.trim()).filter(Boolean);
      const rows = bodyLines.map(line => {
        const cells = line.split('|').map(c => c.trim()).filter(Boolean);
        const row = {};
        headers.forEach((h, i) => { row[h] = cells[i] || ''; });
        return row;
      });

      tables.push({ headers, rows });
    }
    return tables;
  }

  // ── Init ────────────────────────────────────────────
  init();
})();
