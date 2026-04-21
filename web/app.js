// ── AI Stock Recommendations Dashboard ──────────────────
(function () {
  'use strict';

  const REPORTS_BASE = '../reports';
  let reportMarkdown = '';
  let swingMarkdown = '';

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

    const [dailyText, swingText] = await Promise.all([
      fetch(`${REPORTS_BASE}/${date}_daily.md`).then(r => r.ok ? r.text() : '').catch(() => ''),
      fetch(`${REPORTS_BASE}/${date}_swing.md`).then(r => r.ok ? r.text() : '').catch(() => ''),
    ]);

    reportMarkdown = dailyText.replace(/\r\n/g, '\n');
    swingMarkdown = swingText.replace(/\r\n/g, '\n');

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
    // Parse sections by h2 headings
    const parts = splitByHeadings(md, 2);

    // Overview (Market Overview)
    const overview = parts['Market Overview'] || parts['market overview'] || '';
    renderOverview(overview);

    // Unified Recommendations (one row per stock, globally consistent label)
    const unified = findPart(parts, 'Unified Recommendations');
    renderStrategySection('unified', 'Unified Recommendations', unified);

    // Top Picks
    const topPicks = findPart(parts, 'Top Picks');
    renderTopPicks(topPicks);

    // Multi-bagger Watch
    const multibagger = findPart(parts, 'Multi-bagger Watch');
    renderMultibagger(multibagger);

    // Sector Heatmap
    const heatmapUS = findPart(parts, 'Sector Heatmap');
    renderSectorHeatmap(heatmapUS);

    // US Market — aggregate all strategy sub-sections (excluding TA Score which has its own tab)
    const usSignals = findPart(parts, 'US Market Signals');
    const usSubParts = splitByHeadings(usSignals, 3);
    renderMarketSection('us-market', 'US Market Signals', usSubParts, {
      'DMA Crossovers': 'DMA',
      'Resistance Breakouts': 'Resistance',
      'RSI Extremes': 'RSI',
      'MACD Crossovers': 'MACD',
      'Bollinger Squeeze': 'Bollinger',
      'Volume Breakouts': 'Volume',
    });

    // India Market — aggregate all strategy sub-sections for India
    const indiaSignals = findPart(parts, 'India Market Signals') || findPart(parts, 'India Market');
    const indiaSubParts = splitByHeadings(indiaSignals, 3);
    renderMarketSection('india-market', 'India Market Signals', indiaSubParts, {
      'DMA Crossovers': 'DMA',
      'Resistance Breakouts': 'Resistance',
      'RSI Extremes': 'RSI',
      'MACD Crossovers': 'MACD',
      'Bollinger Squeeze': 'Bollinger',
      'Volume Breakouts': 'Volume',
    });

    // Full Report — split into US and India tabs with filtering
    const fullReport = findPart(parts, 'Full Report');
    const fullSubParts = splitByHeadings(fullReport, 3);
    const usFullMd = findPart(fullSubParts, 'US');
    const indiaFullMd = findPart(fullSubParts, 'India');
    renderFilterableReport('us-full-report', 'US Full Report', usFullMd, 'us');
    renderFilterableReport('india-full-report', 'India Full Report', indiaFullMd, 'india');

    // Show overview by default
    document.querySelector('.tab.active').click();
  }

  // ── Render Helpers ──────────────────────────────────

  function renderSection(id, html) {
    const el = document.getElementById(`section-${id}`);
    if (el) el.innerHTML = html;
  }

  // Strategy explainer, indicator definitions, and tab descriptions live in
  // the private repo's README.md. The dashboard itself shows data only — no
  // methodology text — so nothing sensitive ships to GitHub Pages.

  function renderOverview(md) {
    if (!md) {
      renderSection('overview', '<div class="card"><p>No market overview data in this report.</p></div>');
      return;
    }

    const html = marked.parse(md);
    // Try to extract index data from tables
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

  function renderTopPicks(md) {
    if (!md) {
      renderSection('top-picks', '<div class="card"><p>No top picks data in this report.</p></div>');
      return;
    }

    const subParts = splitByHeadings(md, 3);
    let out = '<h2 style="color:var(--text-heading);margin-bottom:1rem;">Top Picks</h2>';
    out += '<p style="color:var(--text-muted);margin-bottom:1rem;">Up to 50 best-buy candidates per market. Gated on: label BUY/STRONG BUY, quality grade ≠ F, ≥2 strategies, RSI ≤ 70, ADX ≥ 20, 3mo return ≤ 40%, avg turnover ≥ $5M / ₹2Cr. Ranked by composite score with bonuses for multi-strategy agreement and MEDIUM (30-90d) horizon; soft-capped at 10 per sector.</p>';

    // Render each market sub-section (e.g. "US — Top 10", "India — Top 10")
    const marketKeys = Object.keys(subParts);
    if (marketKeys.length > 0) {
      for (const heading of marketKeys) {
        const sectionMd = subParts[heading];
        const tables = extractTables(sectionMd);
        if (tables.length === 0 || tables[0].rows.length === 0) continue;

        out += `<details class="market-strategy" open>
          <summary><h3 style="display:inline;color:var(--accent);margin:0;">${heading}</h3>
          <span class="count">${tables[0].rows.length} pick${tables[0].rows.length !== 1 ? 's' : ''}</span></summary>
          <div style="padding:0.5rem 1rem;">`;
        tables[0].rows.forEach((row, i) => {
          const strategies = row['Strategies Triggered'] || row['strategies triggered'] || '';
          const badges = strategies.split(',').map(s => s.trim()).filter(Boolean)
            .map(s => `<span class="badge badge-buy">${s}</span>`).join(' ');
          const mcap = row['Mkt Cap'] || '';
          const mcapHtml = mcap ? `<span style="color:var(--text-muted);font-size:0.8rem;margin-left:0.5rem;">${mcap}</span>` : '';
          const score = row['Score'] || '';
          const scoreNum = parseFloat(score);
          const scoreClass = !isNaN(scoreNum) ? (scoreNum > 0 ? 'positive' : scoreNum < 0 ? 'negative' : '') : '';
          const scoreHtml = score ? `<span class="index-change ${scoreClass}" style="font-size:0.85rem;font-weight:600;">${score}</span>` : '';

          out += `
            <div class="top-pick">
              <div class="rank">#${row['Rank'] || i + 1}</div>
              <div class="stock-info">
                <div class="stock-name">${row['Stock'] || ''}${mcapHtml}</div>
                <div class="stock-sector">${row['Sector'] || ''}</div>
              </div>
              <div style="text-align:center;min-width:3rem;">${scoreHtml}</div>
              <div class="strategies">${badges}</div>
              <div>${actionBadge(row['Action'] || '')}</div>
            </div>`;
        });
        out += '</div></details>';
      }
    } else {
      // Fallback: single table without h3 sub-headings
      const tables = extractTables(md);
      if (tables.length > 0 && tables[0].rows.length > 0) {
        tables[0].rows.forEach((row, i) => {
          const strategies = row['Strategies Triggered'] || row['strategies triggered'] || '';
          const badges = strategies.split(',').map(s => s.trim()).filter(Boolean)
            .map(s => `<span class="badge badge-buy">${s}</span>`).join(' ');

          out += `
            <div class="top-pick">
              <div class="rank">#${row['Rank'] || i + 1}</div>
              <div class="stock-info">
                <div class="stock-name">${row['Stock'] || ''} <span style="color:var(--text-muted);font-weight:400;font-size:0.85rem;">${row['Market'] || ''}</span></div>
                <div class="stock-sector">${row['Sector'] || ''}</div>
              </div>
              <div class="strategies">${badges}</div>
              <div>${actionBadge(row['Action'] || '')}</div>
            </div>`;
        });
      } else {
        out += `<div class="card markdown-body">${marked.parse(md)}</div>`;
      }
    }

    renderSection('top-picks', out);
  }

  function renderMultibagger(md) {
    if (!md) {
      renderSection('multibagger', '<div class="card"><p>No multi-bagger data in this report.</p></div>');
      return;
    }

    const subParts = splitByHeadings(md, 3);
    let out = '<h2 style="color:var(--text-heading);margin-bottom:1rem;">Multi-bagger Watch</h2>';
    out += '<p style="color:var(--text-muted);margin-bottom:1rem;">Names that look early in their momentum phase. <strong>Multi-bagger Early</strong>: passes the strict gate (mid-cap + accelerating revenue & earnings + stage-2 trend + accumulation + relative strength + not-extended + quality grade ≠ F). <strong>Quad Green</strong>: 1D + 5D + 15D + 30D returns all positive AND OBV trending up. <strong>Streak 15D</strong>: 3 of 4 timeframes positive (lower-conviction flag).</p>';

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
      // Badges come in as backtick-wrapped tokens: `MULTIBAGGER` `QUAD GREEN` `VOL+` `ACCUM`
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

    const renderBucket = (heading, tableMd) => {
      // Strip "US — " / "India — " prefix since the sub-tab already indicates market
      const shortHeading = heading.replace(/^(US|India)\s*[—-]\s*/, '');
      const tables = extractTables(tableMd);
      if (tables.length === 0 || tables[0].rows.length === 0) return '';
      const empty = tables[0].rows.every(r => !r['Stock'] || /No qualifying names/.test(Object.values(r).join(' ')));
      if (empty) {
        return `<details class="market-strategy" open>
          <summary><h3 style="display:inline;color:var(--accent);margin:0;">${shortHeading}</h3>
          <span class="count">0 names</span></summary>
          <div class="card" style="padding:0.75rem 1rem;color:var(--text-muted);margin:0.5rem 1rem;">No qualifying names today.</div>
        </details>`;
      }
      const rowCount = tables[0].rows.filter(r => r['Stock']).length;
      let html = `<details class="market-strategy" open>
        <summary><h3 style="display:inline;color:var(--accent);margin:0;">${shortHeading}</h3>
        <span class="count">${rowCount} name${rowCount !== 1 ? 's' : ''}</span></summary>`;
      html += '<div class="card" style="padding:0;overflow-x:auto;margin:0.5rem 1rem;"><table class="data-table" style="width:100%;border-collapse:collapse;">';
      html += '<thead><tr>'
        + ['Rank','Stock','Sector','Mkt Cap','Score','1D','5D','15D','30D','Badges','Action']
          .map(h => `<th style="text-align:left;padding:0.5rem 0.75rem;border-bottom:1px solid var(--border);">${h}</th>`).join('')
        + '</tr></thead><tbody>';
      tables[0].rows.forEach((row, i) => {
        if (!row['Stock']) return;
        html += '<tr>'
          + `<td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border);">${row['Rank'] || i + 1}</td>`
          + `<td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border);font-weight:600;">${row['Stock']}</td>`
          + `<td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border);color:var(--text-muted);">${row['Sector'] || ''}</td>`
          + `<td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border);color:var(--text-muted);">${row['Mkt Cap'] || ''}</td>`
          + `<td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border);">${row['Score'] || ''}</td>`
          + `<td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border);">${renderReturn(row['1D'])}</td>`
          + `<td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border);">${renderReturn(row['5D'])}</td>`
          + `<td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border);">${renderReturn(row['15D'])}</td>`
          + `<td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border);">${renderReturn(row['30D'])}</td>`
          + `<td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border);">${renderBadges(row['Badges'] || '')}</td>`
          + `<td style="padding:0.5rem 0.75rem;border-bottom:1px solid var(--border);">${actionBadge(row['Action'] || '')}</td>`
          + '</tr>';
      });
      html += '</tbody></table></div></details>';
      return html;
    };

    // Split buckets by market so we can render them under separate sub-tabs.
    const marketBuckets = {
      US: ['US — Multi-bagger Early', 'US — Quad Green', 'US — Streak 15D'],
      India: ['India — Multi-bagger Early', 'India — Quad Green', 'India — Streak 15D'],
    };
    const matchHeading = (heading) => Object.keys(subParts).find(k =>
      k.replace(/\s+/g, ' ').trim() === heading ||
      k.replace(/—|-/g, '').replace(/\s+/g, ' ').trim() === heading.replace(/—|-/g, '').replace(/\s+/g, ' ').trim()
    );
    const renderMarket = (market) => {
      let html = '';
      for (const heading of marketBuckets[market]) {
        const match = matchHeading(heading);
        if (match) html += renderBucket(heading, subParts[match]);
      }
      return html || '<div class="card" style="padding:0.75rem 1rem;color:var(--text-muted);">No data for this market.</div>';
    };

    out += `
      <div class="mb-subtabs" style="display:flex;gap:0.25rem;margin-bottom:1rem;">
        <button class="tab active" data-mb-market="US">US</button>
        <button class="tab" data-mb-market="India">India</button>
      </div>
      <div class="mb-panel" data-mb-panel="US">${renderMarket('US')}</div>
      <div class="mb-panel" data-mb-panel="India" style="display:none;">${renderMarket('India')}</div>
    `;

    renderSection('multibagger', out);

    // Wire up sub-tab toggle
    const root = document.getElementById('section-multibagger');
    if (root) {
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
  }

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

  // Render a whole market tab (US or India) as a stack of strategy sub-sections.
  // `subParts` is the h3 split of the market's markdown; `strategyMap` is
  // { 'Display Title': 'keywordFallback' } in render order.
  function renderMarketSection(id, title, subParts, strategyMap) {
    let out = `<h2 style="color:var(--text-heading);margin-bottom:1rem;">${title}</h2>`;
    let anySignals = false;

    for (const [displayTitle, keyword] of Object.entries(strategyMap)) {
      // Match heading: exact, endsWith (to handle "NSE/BSE — DMA Crossovers"), or keyword
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
      anySignals = true;

      out += `<details class="market-strategy" open>
        <summary><h3 style="display:inline;color:var(--accent);margin:0;">${displayTitle}</h3>
        <span class="count">${tables[0].rows.length} signal${tables[0].rows.length !== 1 ? 's' : ''}</span></summary>`;
      out += renderStrategyTablesHtml(tables);
      out += '</details>';
    }

    if (!anySignals) {
      out += '<div class="card"><p>No signals in this market today.</p></div>';
    }
    renderSection(id, out);
  }

  // Render the inner tables (with optional sector grouping) for a strategy section.
  // Extracted so both renderMarketSection and renderStrategySection can share it.
  function renderStrategyTablesHtml(tables) {
    let out = '';
    tables.forEach(table => {
      const hasSector = table.headers.some(h => h.toLowerCase() === 'sector');
      if (hasSector) {
        const groups = {};
        table.rows.forEach(row => {
          const sector = row['Sector'] || row['sector'] || 'Other';
          if (!groups[sector]) groups[sector] = [];
          groups[sector].push(row);
        });
        const otherHeaders = table.headers.filter(h => h.toLowerCase() !== 'sector');
        for (const [sector, rows] of Object.entries(groups)) {
          out += `
            <div class="sector-group">
              <div class="sector-group-header">
                <h4 style="margin:0;">${sector}</h4>
                <span class="count">${rows.length} signal${rows.length !== 1 ? 's' : ''}</span>
              </div>
              <div class="table-wrapper">
                <table>
                  <thead><tr>${otherHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead>
                  <tbody>${rows.map(row => `<tr>${otherHeaders.map(h => `<td>${formatCell(h, row[h] || '')}</td>`).join('')}</tr>`).join('')}</tbody>
                </table>
              </div>
            </div>`;
        }
      } else {
        out += `
          <div class="table-wrapper">
            <table>
              <thead><tr>${table.headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
              <tbody>${table.rows.map(row => `<tr>${table.headers.map(h => `<td>${formatCell(h, row[h] || '')}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>
          </div>`;
      }
    });
    return out;
  }

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

    for (const [heading, mdBlock] of [['US Swing Trades', usMd], ['India Swing Trades', indiaMd]]) {
      const tables = extractTables(mdBlock);
      if (tables.length === 0 || tables[0].rows.length === 0) {
        out += `<details class="market-strategy" open>
          <summary><h3 style="display:inline;color:var(--accent);margin:0;">${heading}</h3>
          <span class="count">0 setups</span></summary>
          <div class="card" style="margin:0.5rem 1rem;"><p>No setups in this market today.</p></div>
        </details>`;
        continue;
      }
      const setupCount = tables.reduce((n, t) => n + t.rows.length, 0);
      out += `<details class="market-strategy" open>
        <summary><h3 style="display:inline;color:var(--accent);margin:0;">${heading}</h3>
        <span class="count">${setupCount} setup${setupCount !== 1 ? 's' : ''}</span></summary>`;
      out += renderStrategyTablesHtml(tables);
      out += '</details>';
    }

    if (methodology) {
      out += `<div class="card markdown-body" style="margin-top:1rem;">${marked.parse(methodology)}</div>`;
    }

    renderSection('swing', out);
  }

  function renderStrategySection(id, title, md) {
    if (!md) {
      renderSection(id, `<div class="card"><h2>${title}</h2><p>No signals in this section.</p></div>`);
      return;
    }

    const tables = extractTables(md);
    let out = `<h2 style="color:var(--text-heading);margin-bottom:1rem;">${title}</h2>`;

    if (tables.length > 0) {
      tables.forEach(table => {
        // Group by sector if Sector column exists
        const hasSector = table.headers.some(h => h.toLowerCase() === 'sector');

        if (hasSector) {
          const groups = {};
          table.rows.forEach(row => {
            const sector = row['Sector'] || row['sector'] || 'Other';
            if (!groups[sector]) groups[sector] = [];
            groups[sector].push(row);
          });

          const otherHeaders = table.headers.filter(h => h.toLowerCase() !== 'sector');

          for (const [sector, rows] of Object.entries(groups)) {
            out += `<details class="market-strategy" open>
              <summary><h3 style="display:inline;color:var(--accent);margin:0;">${sector}</h3>
              <span class="count">${rows.length} signal${rows.length !== 1 ? 's' : ''}</span></summary>
              <div class="table-wrapper">
                <table>
                  <thead><tr>${otherHeaders.map(h => `<th>${h}</th>`).join('')}</tr></thead>
                  <tbody>${rows.map(row => `<tr>${otherHeaders.map(h => `<td>${formatCell(h, row[h] || '')}</td>`).join('')}</tr>`).join('')}</tbody>
                </table>
              </div>
            </details>`;
          }
        } else {
          out += `<details class="market-strategy" open>
            <summary><h3 style="display:inline;color:var(--accent);margin:0;">Results</h3>
            <span class="count">${table.rows.length} row${table.rows.length !== 1 ? 's' : ''}</span></summary>
            <div class="table-wrapper">
              <table>
                <thead><tr>${table.headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
                <tbody>${table.rows.map(row => `<tr>${table.headers.map(h => `<td>${formatCell(h, row[h] || '')}</td>`).join('')}</tr>`).join('')}</tbody>
              </table>
            </div>
          </details>`;
        }
      });
    }

    // Also render any non-table markdown content
    const nonTableMd = md.replace(/\|[^\n]+\|(\n\|[^\n]+\|)*/g, '').trim();
    if (nonTableMd) {
      out += `<div class="card markdown-body" style="margin-top:1rem;">${marked.parse(nonTableMd)}</div>`;
    }

    renderSection(id, out);
  }

  // ── Filterable Full Report ──────────────────────────

  function _parseMktCap(str) {
    if (!str) return null;
    const s = str.trim();
    const usMatch = s.match(/^\$?([\d.]+)\s*B$/i);
    if (usMatch) return parseFloat(usMatch[1]) * 1e9;
    const lakhCrMatch = s.match(/^([\d.]+)\s*L\s*Cr$/i);
    if (lakhCrMatch) return parseFloat(lakhCrMatch[1]) * 1e5 * 1e7;
    const crMatch = s.match(/^([\d,]+)\s*Cr$/i);
    if (crMatch) return parseFloat(crMatch[1].replace(/,/g, '')) * 1e7;
    return null;
  }

  function _parseAction(str) {
    if (!str) return '';
    // Use DOM parsing to safely extract visible text. A regex like
    // /<span[^>]*>([^<]+)<\/span>/ breaks when the title attribute itself
    // contains '>' (e.g. "Bullish DMA alignment (price>10>50>200)").
    const tmp = document.createElement('div');
    tmp.innerHTML = str;
    return (tmp.textContent || '').trim().toUpperCase();
  }

  function _num(str) {
    if (!str || str.trim() === '\u2014' || str.trim() === '—') return null;
    const v = parseFloat(str);
    return isNaN(v) ? null : v;
  }

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
      allSectors.add(sector);
      tables[0].rows.forEach(row => {
        row._sector = sector;
        row._score = _num(row['Score']) || 0;
        row._mktCapRaw = _parseMktCap(row['Mkt Cap']);
        row._action = _parseAction(row['Action']);
        row._rsi = _num(row['RSI']);
        row._adx = _num(row['ADX']);
        row._macdPct = _num(row['MACD Hist%']);
        row._volRatio = _num(row['Vol Ratio']);
        row._pct52w = _num(row['52W High%']);
        row._ret3m = _num(row['Ret 3M']);
        row._ret1m = _num(row['Ret 1M']);
        row._relStr3m = _num(row['Rel Str 3M']);
        allRows.push(row);
      });
    }

    if (allRows.length === 0) {
      renderSection(id, `<div class="card"><h2>${title}</h2><p>No data in this section.</p></div>`);
      return;
    }

    // All columns from the markdown table, used for rendering
    const headers = [
      'Stock', 'Mkt Cap', 'Score', 'Horizon',
      'RSI', 'ADX', 'MACD Hist%', 'Vol Ratio', '52W High%',
      'Ret 3M', 'Ret 1M', 'Rel Str 3M',
      'Strategies Triggered', 'Analyst Rating', 'Target (Upside)', 'Action',
    ];
    const capUnit = market === 'india' ? 'Cr' : '$B';

    const sectorOptions = Array.from(allSectors).sort().map(s =>
      `<option value="${s}">${s}</option>`).join('');

    // Filter definitions: [label, data-attr, type, placeholder]
    // type: 'select-action', 'select-sector', 'min', 'max', 'range-min', 'range-max'
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

      // Each numeric filter: if set, row must have a non-null value that satisfies it
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
    const v = value.trim();

    // Action / Signal columns → badges
    if (h === 'action' || h === 'signal' || h === 'recommendation' || h === 'status'
      || h === 'condition' || h === 'outcome') {
      return actionBadge(v);
    }

    // Numeric change columns → color
    if ((h.includes('change') || h === 'return %') && v) {
      const num = parseFloat(v);
      if (!isNaN(num)) {
        const cls = num > 0 ? 'positive' : num < 0 ? 'negative' : '';
        return `<span class="index-change ${cls}">${v}</span>`;
      }
    }

    // Color-code indicator columns
    if (v === '\u2014' || v === '—') return `<span style="color:var(--text-muted);">—</span>`;
    const num = parseFloat(v);
    if (isNaN(num)) return v;

    // RSI: green if oversold (<30), red if overbought (>70)
    if (h === 'rsi') {
      const cls = num <= 30 ? 'positive' : num >= 70 ? 'negative' : '';
      return cls ? `<span class="index-change ${cls}">${v}</span>` : v;
    }
    // ADX: bold if trending (>=25)
    if (h === 'adx') {
      return num >= 25 ? `<strong>${v}</strong>` : v;
    }
    // Signed numeric columns: green/red by sign
    if (h === 'score' || h === 'macd hist%' || h === 'ret 3m' || h === 'ret 1m'
        || h === 'rel str 3m' || h === '52w high%') {
      const cls = num > 0 ? 'positive' : num < 0 ? 'negative' : '';
      return cls ? `<span class="index-change ${cls}">${v}</span>` : v;
    }
    // Vol Ratio: highlight if >= 2
    if (h === 'vol ratio') {
      return num >= 2 ? `<strong class="index-change positive">${v}</strong>` : v;
    }

    return v;
  }

  function actionBadge(text) {
    if (!text) return '';

    // Unwrap an inline <span title="..."> coming from the markdown report
    // (run_all.py emits these for action labels so the Full Report view also
    // gets a native browser tooltip explaining the recommendation).
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
