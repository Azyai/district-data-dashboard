import { bars, button, chart, drawing, filaments, fmt, icon, insightSection, insightSelect, insightTable, latest, monthlyChange, panel, pct, projectAlertGap, projectGap, projectList, signed } from "./graphics.js";

const communitiesSource = 'https://invest.beijing.gov.cn/tcgz/tzhd/202606/t20260601_4680281.html';
const serviceSource = 'https://invest.beijing.gov.cn/zwgk/sqgzdt/202607/t20260721_4774408.html';
const policySource = 'https://www.beijing.gov.cn/fuwu/lqfw/gggs/202606/t20260612_4697419.html';
const workspaceSource = 'https://www.beijing.gov.cn/fuwu/lqfw/gggs/202608/t20260831_4843628.html';

export default function economy(context) {
  const { $, showDetail } = context;
  let { economy, scopeLabel: scopeTitle } = context;
  let section = context.section;
  const modes = () => [["地区生产总值", economy.gdp], ["固定资产投资", economy.investment], ["社零总额", economy.sales]];
  const monthLabels = () => economy.periods.map(({ label }) => label);
  let ecoModes = modes();
  const industryColors = ["#8d92ff", "#60c5ee", "#b49dff", "#71d9c8"];
  const state = { eco: 0, ecoTopic: context.section === "projects" ? "projects" : "", ecoIndustry: 0, ecoProjectFilter: "all" };
  function economyWave() {
    let points = "";
    for (let row = 0; row < 10; row += 1) {
      for (let col = 0; col <= 94; col += 1) {
        const x = col * 1200 / 94;
        const depth = row / 9;
        const y = 666 + depth * 92 + Math.sin(x * .012 + depth * 2.4) * (24 + depth * 12);
        const red = Math.round(163 - col * .89);
        const green = Math.round(106 + col * 1.05);
        points += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(.45 + depth * 1.1).toFixed(2)}" fill="rgb(${red},${green},246)" opacity="${(.17 + depth * .56).toFixed(2)}"/>`;
      }
    }
    return points;
  }
  const economyWavePoints = economyWave();

  function economyBreakdown(items) {
    const sum = items.reduce((total, [value]) => total + value, 0);
    let cursor = 0;
    return items.map(([value, color]) => {
      const start = cursor;
      cursor += (sum ? value / sum * 100 : 0);
      return `${color} ${start}% ${cursor}%`;
    }).join(", ");
  }

  function economyRing(items, value, label) {
    return `<div class="eco-ring" style="--ring:${economyBreakdown(items)}"><div>
      <strong>${value}</strong><span>${label}</span>
    </div></div>`;
  }

  function economyLink(label, analysis) {
    return button(`${label}<span aria-hidden="true">›</span>`, `data-analysis="${analysis}" aria-haspopup="dialog"`, "eco-link");
  }

  function economyTrend() {
    const [label, selected] = ecoModes[state.eco];
    const controls = ecoModes.map(([name], index) => button(name, `data-eco="${index}" aria-pressed="${index === state.eco}"`, "eco-switch")).join("");
    return panel(label + "趋势", "近 6 个月 · 亿元", `
      <div class="eco-metric-toolbar" role="group" aria-label="趋势指标">${controls}</div>
      <div class="eco-metric-line"><strong>${fmt(latest(selected))}<small>亿元</small></strong>
        <span>较上月末 <b>${signed(monthlyChange(selected))} 亿元</b></span></div>
      ${chart(selected, "亿元", "violet", false, { labels: monthLabels() })}`, "eco-chart");
  }

  function economyOperation() {
    const [label, selected] = ecoModes[state.eco];
    const advances = ecoModes.map(([name, values]) =>
      [name, fmt(latest(values)), fmt(values.at(-2)), `<b>${signed(monthlyChange(values))}</b>`]);
    const months = monthLabels();
    const monthsDetail = selected.map((value, i) => [months[i], fmt(value), i ? signed(value - selected[i - 1]) : "—"]).reverse();
    return economyTrend() +
      panel("累计指标对比", "亿元", insightTable(["指标", months.at(-1), months.at(-2), "差值"], advances, "本月与上月累计值") +
        economyLink("按月份比较", "economy")) +
      panel("逐月累计值", "亿元", insightTable(["月份", label, "较上月末"], monthsDetail, "各月累计值"));
  }

  function economyServices() {
    const { served, enterpriseCases, enterpriseDone, serviceTypes } = economy;
    const outstanding = enterpriseCases - enterpriseDone;
    const detail = serviceTypes.map(([name, count, done]) => [name, fmt(count), fmt(done), pct(done, count) + "%"]);
    const backlogs = serviceTypes.map(([name, count, done]) => [name, count - done]).sort((a, b) => b[1] - a[1]);
    return panel("企业服务概况", "本期", `<div class="eco-profile">
      ${economyRing([[enterpriseDone, "#61d8e4"], [outstanding, "#e7bd84"]], pct(enterpriseDone, enterpriseCases) + "%", "服务完成率")}
      <dl class="eco-stat-list"><div><dt>服务企业</dt><dd>${fmt(served)} 家</dd></div>
        <div><dt>服务事项</dt><dd>${fmt(enterpriseCases)} 件</dd></div>
        <div><dt>已完成</dt><dd>${fmt(enterpriseDone)} 件</dd></div>
        <div><dt>待完成</dt><dd class="attention">${fmt(outstanding)} 件</dd></div></dl></div>`, "eco-service-profile") +
      panel("分类服务情况", "件", insightTable(["分类", "事项", "已完成", "完成率"], detail, "企业服务事项统计") +
        economyLink("查看服务明细", "services")) +
      panel("待完成服务事项", fmt(outstanding) + " 件", bars(backlogs, "件", { max: Math.max(1, ...backlogs.map(([, count]) => count)) }));
  }

  function economyIndustries(projects, industryTotal) {
    const [industry, count] = economy.industries[state.ecoIndustry];
    const related = projects.filter((project) => project.industry === industry);
    const max = Math.max(...economy.industries.map(([, value]) => value));
    const items = economy.industries.map(([name, value], i) => button(`
      <span class="bar-title"><i style="--industry:${industryColors[i]}"></i>${name}</span>
      <strong>${fmt(value)}<small>家</small></strong>
      <span class="bar-track" style="--accent:${industryColors[i]}"><i style="--value:${pct(value, max)}%"></i></span>`,
      `data-eco-industry="${i}" aria-pressed="${i === state.ecoIndustry}"`, "bar-row")).join("");
    const legend = economy.industries.map(([name, value], i) =>
      `<div><dt><i style="--industry:${industryColors[i]}"></i>${name}</dt><dd>${pct(value, industryTotal)}%</dd></div>`).join("");
    return panel("样例企业构成", economy.industries.length + " 类", `<div class="eco-profile">
      ${economyRing(economy.industries.map(([, value], i) => [value, industryColors[i]]), fmt(industryTotal) + " 家", "样例企业")}
      <dl class="eco-stat-list eco-industry-legend">${legend}</dl></div>`, "eco-industry-profile") +
      panel("按产业查看", "企业数", `<div class="bars eco-industry-rows">${items}</div>` + economyLink("查看产业明细", "industries")) +
      panel(industry, "产业明细", `<div class="eco-metric-line"><strong>${fmt(count)}<small>家</small></strong>
        <span>占样例企业 <b>${pct(count, industryTotal)}%</b></span></div>
        <h3 class="eco-subhead">关联样例项目 <small>${related.length} 个</small></h3>
        ${related.length ? projectList(related) : '<p class="eco-note">当前无关联样例项目。</p>'}`, "eco-industry-detail");
  }

  function economyProjects(projects, alerts) {
    const filters = [["all", "全部样例", projects.length], ["alerts", "需关注", alerts.length]];
    const visible = state.ecoProjectFilter === "alerts" ? alerts : projects;
    const stages = projects.reduce((counts, { status }) => counts.set(status, (counts.get(status) ?? 0) + 1), new Map());
    const focus = alerts.map(({ index, ...project }) => button(`<span><b>${project.name}</b>
      <small>下一节点 · ${project.next}</small></span><strong>${signed(projectGap(project))}<small> 个百分点</small></strong>`,
      `data-project="${index}" aria-haspopup="dialog"`, "eco-watch-row")).join("");
    return panel("重点项目进度", "实际 / 计划", `<div class="eco-metric-toolbar" role="group" aria-label="项目筛选">
      ${filters.map(([key, label, count]) => button(label + " " + count, `data-eco-project-filter="${key}" aria-pressed="${state.ecoProjectFilter === key}"`, "eco-switch")).join("")}
      </div>${visible.length ? projectList(visible) : '<p class="eco-note">当前没有需关注的项目。</p>'}`, "projects-summary") +
      panel("项目阶段分布", projects.length + " 个样例", bars([...stages], "个", { color: "violet" }) +
        economyLink("查看项目督办表", "projects")) +
      panel("进度关注清单", alerts.length + " 项", `<div class="eco-watch">${focus || '<p class="eco-note">当前没有需关注的项目。</p>'}</div>
        <p class="eco-note">实际进度落后计划至少 ${projectAlertGap} 个百分点时，标为需关注。</p>`, "eco-watch-panel");
  }

  function economyOverview(projects) {
    const featuredIndustries = [...economy.industries].sort((a, b) => b[1] - a[1]);
    return economyTrend() +
      panel("重点产业企业数", "样例 · 家", bars(featuredIndustries, "家", { color: "violet" }) +
        economyLink("查看产业构成", "industries")) +
      panel("重点项目进度", "实际 / 计划", projectList(projects), "projects-summary");
  }

  function economyPage() {
    const period = economy.periods.at(-1);
    const industryTotal = economy.industries.reduce((sum, [, count]) => sum + count, 0);
    const projects = economy.projects.map((project, index) => ({ ...project, index })).sort((a, b) => projectGap(a) - projectGap(b));
    const alerts = projects.filter((project) => projectGap(project) <= -projectAlertGap);
    const cards = [
      ["run", "经济运行", "growth", fmt(latest(economy.gdp)), "亿元", "地区生产总值",
        `较上月末累计 ${signed(monthlyChange(economy.gdp))} 亿元`, "violet", 310, 192],
      ["services", "企业服务", "briefcase", fmt(economy.served), "家", "服务企业",
        economy.serviceTypes.map(([name]) => name).join(" · "), "teal", 890, 192],
      ["industries", "产业发展", "layers", economy.industries.length, "类", "重点产业",
        `分类覆盖 ${fmt(industryTotal)} 家样例企业`, "teal", 890, 608],
      ["projects", "重点项目", "project", economy.projectCount, "个", "本区域在建",
        `${projects.length} 个样例 · ${alerts.length} 个需关注`, "violet", 310, 608],
    ];
    const content = {
      run: economyOperation,
      services: economyServices,
      industries: () => economyIndustries(projects, industryTotal),
      projects: () => economyProjects(projects, alerts),
    }[state.ecoTopic]?.() ?? economyOverview(projects);

    return `<section class="reference ref-economy" aria-label="经济发展">
      <header class="eco-page-head"><h1>经济发展</h1>
        <div>${economyLink("双谷 OPC", "opc")}<span>${period.year} 年 ${period.month} 月</span></div></header>
      <div class="eco-stage" role="group" aria-label="经济发展专题">
        ${drawing(`<g class="eco-wave">${economyWavePoints}</g>
        ${cards.map(([key, , , , , , , hue, x, y]) => `<g class="eco-flow${state.ecoTopic && state.ecoTopic !== key ? " is-muted" : ""}">
          ${filaments(600, 400, x, y, hue, 5.7, 20)}</g>`).join("")}`)}
        <div class="eco-hub"><span class="eco-satellite-track" aria-hidden="true"><i></i></span>${button(`<span class="eco-orb-icon">${icon("growth")}</span><b>经济总览</b><small>${scopeTitle}</small>`,
          `data-eco-topic="" aria-controls="eco-board" aria-pressed="${!state.ecoTopic}"`, "economy-orb")}</div>
        ${cards.map(([key, name, symbol, value, unit, metric, note, hue]) => button(`
          <span class="eco-card-head">${icon(symbol)}<b>${name}</b><i aria-hidden="true">›</i></span>
          <span class="eco-card-metric"><strong>${value}<small>${unit}</small></strong><span>${metric}</span></span>
          <span class="eco-card-note">${note}</span>`,
          `data-eco-topic="${key}" aria-controls="eco-board" aria-pressed="${state.ecoTopic === key}"`, `eco-topic eco-tone-${hue}`)).join("")}
      </div>
      <div id="eco-board" class="eco-board" aria-label="${cards.find(([key]) => key === state.ecoTopic)?.[1] ?? "经济总览"}数据">${content}</div>
    </section>`;
  }

  function economyInsight() {
    const [label, values] = ecoModes[state.eco];
    const months = monthLabels();
    showDetail("经济运行分析", "单位为亿元。按各月末累计值比较，展示较上月末累计值的变化。", `
      <div class="insight-filters">${insightSelect("比较月份", "eco-month", months.map((month, i) => [i, month]), values.length - 1)}</div>
      <div id="economic-comparison" aria-live="polite"></div>
      ${insightSection(label + "累计趋势", chart(values, "亿元", "violet", true, { labels: months }))}
      <div class="insight-actions">${button("企业服务明细", 'data-analysis="services"', "insight-action")}
      ${button("重点产业构成", 'data-analysis="industries"', "insight-action")}
      ${button("重点项目督办", 'data-analysis="projects"', "insight-action")}</div>`, true);
    renderEconomyComparison();
  }

  function renderEconomyComparison() {
    const months = monthLabels();
    const index = Number($('[data-insight-field="eco-month"]').value);
    const rows = ecoModes.map(([label, values]) => [label, fmt(values[index]), index ? fmt(values[index - 1]) : "—",
      index ? signed(values[index] - values[index - 1]) : "—"]);
    $("#economic-comparison").innerHTML = insightTable(["累计指标", months[index], index ? months[index - 1] : "上月", "增减"], rows,
      index ? "各累计指标与上月末比较" : "首个观测月");
  }

  function opcInsight() {
    const source = (url, text) => `<a class="opc-source" href="${url}" target="_blank" rel="noopener noreferrer">${text} ↗</a>`;
    showDetail("门头沟双谷 OPC", "区级创业社区与政策", `
      <div class="opc-brief">
        ${insightSection("京西智谷 · 创享 OPC 社区",
          '<p>面向独立开发者与科技创业团队，聚焦国产算力适配、大模型调优和 AI 工具链研发。智谷创享科创服务站与社区管家提供入驻咨询、项目申报及算力资源对接。</p>' + source(serviceSource, "社区服务"))}
        ${insightSection("京西剧谷 · 星野 OPC 社区",
          '<p>面向编剧、导演和短剧创作者，围绕剧本生成、数字人和 AI 短剧制作开展活动。双谷通行证积分可兑换专家辅导、算力资源及办公场地等服务。</p>' + source(communitiesSource, "双谷社区公告"))}
        ${insightSection("AI＋精品微短剧扶持",
          '<p>门头沟“金钩八条”覆盖创业办公、算力、场景、人才、安居和培训等支持。符合条件的 AI 微短剧或动漫剧从业者和团队可申报创业工位，审核通过后最多获得 5 个工位，最长免费使用 6 个月。</p>' + source(policySource, "政策公告") + source(workspaceSource, "工位申报"))}
      </div>`, true);
  }

  function servicesInsight() {
    const rows = economy.serviceTypes.map(([label, received, done]) =>
      [label, fmt(received), fmt(done), fmt(received - done), pct(done, received) + "%"]);
    rows.push(["合计", fmt(economy.enterpriseCases), fmt(economy.enterpriseDone), fmt(economy.enterpriseCases - economy.enterpriseDone),
      pct(economy.enterpriseDone, economy.enterpriseCases) + "%"]);
    showDetail("企业服务明细", `本期服务 ${fmt(economy.served)} 家企业。`,
      insightTable(["服务类别", "事项", "已完成", "待完成", "完成率"], rows, "企业服务事项统计（件）"), true);
  }

  function industriesInsight() {
    const count = economy.industries.reduce((sum, item) => sum + item[1], 0);
    showDetail("重点产业构成", `展示 ${economy.industries.length} 类重点产业样例，企业数合计 ${fmt(count)} 家。`,
      bars(economy.industries, "家", { color: "violet" }) +
      insightTable(["产业", "企业数", "占样例企业比重"], economy.industries.map(([name, value]) =>
        [name, fmt(value) + " 家", pct(value, count) + "%"]), "占比以列出的各类企业数合计为分母"), true);
  }

  function projectsInsight() {
    const rows = economy.projects.map((item, index) => ({ ...item, index })).sort((a, b) => projectGap(a) - projectGap(b));
    showDetail("重点项目督办", `${scopeTitle}演示在建项目 ${economy.projectCount} 个，当前列出 ${rows.length} 个样例。实际进度落后计划至少 ${projectAlertGap} 个百分点时标为需关注。`,
      insightTable(["项目", "实际", "计划", "差值", "状态"], rows.map((project) => {
        const gap = projectGap(project);
        const attention = gap <= -projectAlertGap;
        return [button(project.name, `data-project="${project.index}"`, "insight-link"), project.progress + "%", project.planned + "%",
          signed(gap) + " 个百分点", `<span class="insight-status" data-status="${attention ? "due" : "open"}">${attention ? "需关注" : project.status}</span>`];
      }), "按实际进度与计划差值排列"), true);
  }

  function projectDetail(index) {
    const item = economy.projects[index];
    const gap = projectGap(item);
    showDetail(item.name, [item.area, item.industry, item.status].filter(Boolean).join(" · "),
      `<div class="detail-progress"><span>实际进度</span><b>${item.progress}%</b><span class="bar-track"><i style="--value:${item.progress}%"></i></span></div>
      <div class="detail-progress detail-plan"><span>计划进度</span><b>${item.planned}%</b><span class="bar-track"><i style="--value:${item.planned}%"></i></span></div>
      <div class="insight-totals"><span>实际与计划差值 <b>${signed(gap)} 个百分点</b></span><span>下一节点 <b>${item.next}</b></span></div>
      ${button("查看全部样例项目", 'data-analysis="projects"', "insight-action")}`);
  }

  return {
    markup: economyPage,
    updateScope(next, render) {
      economy = next.economy;
      scopeTitle = next.scopeLabel;
      ecoModes = modes();
      if (section !== next.section) {
        section = next.section;
        state.ecoTopic = section === "projects" ? "projects" : "";
      }
      render();
    },
    insights: { economy: economyInsight, projects: projectsInsight, services: servicesInsight, industries: industriesInsight, opc: opcInsight },
    onProject: projectDetail,
    onField(key) { if (key === "eco-month") renderEconomyComparison(); },
    onButton(target, render) {
      const { ecoTopic, eco, ecoIndustry, ecoProjectFilter } = target.dataset;
      if (ecoTopic !== undefined) state.ecoTopic = ecoTopic;
      else if (eco !== undefined) state.eco = Number(eco);
      else if (ecoIndustry !== undefined) state.ecoIndustry = Number(ecoIndustry);
      else if (ecoProjectFilter !== undefined) state.ecoProjectFilter = ecoProjectFilter;
      else return;
      const attr = Object.keys(target.dataset)[0].replace(/[A-Z]/g, c => "-" + c.toLowerCase());
      render('[data-' + attr + '="' + Object.values(target.dataset)[0] + '"]');
    },
  };
}
