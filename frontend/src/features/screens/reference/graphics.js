const number = new Intl.NumberFormat("zh-CN");
export const fmt = (value) => typeof value === "number" ? number.format(value) : value;
export const pct = (part, whole) => (whole ? 100 * part / whole : 0).toFixed(1);

export const latest = (values) => values.at(-1);
export const monthlyChange = (values) => latest(values) - values.at(-2);
export const months = ["5月", "6月", "7月", "8月", "9月", "10月"];

export const ageLabels = ["0–17 岁", "18–59 岁", "60 岁及以上"];

const paths = {
  growth: '<path d="M4 20h16M6 17v-4m6 4v-6m6 6V8M4 10l6-5 4 2 5-4m-4 0h4v4"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M3 12a22 22 0 0 0 18 0m-9 1v2"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5zm-8 9 8 4.5 8-4.5m-16 4 8 4.5 8-4.5"/>',
  project: '<path d="M5 3h10l4 4v14H5zM15 3v5h4M8 12h8m-8 4h5"/>',
  play: '<path d="m9 5 11 7-11 7z"/>',
  pause: '<path d="M9 5v14m6-14v14"/>',
};
export function icon(name) {
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}


export function panel(title, meta, content, cls = "") {
  return `<section class="panel ${cls}"><div class="panel-head"><h2>${title}</h2><span>${meta}</span></div>${content}</section>`;
}
export function button(label, action, classes = "") {
  return `<button type="button" class="${classes}" ${action}>${label}</button>`;
}
export function bars(items, unit, { max = Math.max(...items.map((item) => item[1])), color = "cyan" } = {}) {
  return `<div class="bars ${color}">${items.map(([label, value]) => `<div class="bar-row">
    <span class="bar-title">${label}</span><strong>${fmt(value)}<small>${unit}</small></strong><span class="bar-track"><i style="--value:${max ? 100 * value / max : 0}%"></i></span>
  </div>`).join("")}</div>`;
}
export function projectList(projects) {
  return `<div class="records">${projects.map(({ index, ...project }) => {
    const attention = projectGap(project) <= -projectAlertGap;
    return button(`<span><b>${project.name}</b><small>${project.area} · ${project.status}</small></span>
      <strong class="${attention ? "attention" : ""}">${project.progress}%<small> / ${project.planned}%</small></strong>
      <span class="bar-track"><i style="--value:${project.progress}%"></i><i class="plan-mark" style="--plan:${project.planned}%"></i></span>`,
    `data-project="${index}" aria-haspopup="dialog" aria-label="${project.name}，实际 ${project.progress}%，计划 ${project.planned}%${attention ? "，需关注" : ""}"`, "project-row");
  }).join("")}</div>`;
}
export function ageBreakdown(age) {
  return `<div class="age-breakdown">
    <div class="age-track" aria-hidden="true">${age.map((value) => `<i style="flex:${value}"></i>`).join("")}</div>
    <ul class="age-keys">${ageLabels.map((label, i) => `<li><span><i></i>${label}</span><strong>${age[i].toFixed(1)}%</strong></li>`).join("")}</ul>
  </div>`;
}
export function signalBars(values, unit) {
  const labels = values.map((value, i) => months[i] + fmt(value) + unit);
  const max = Math.max(...values);
  return `<div class="signal-bars" role="img" aria-label="${labels.join("，")}">${values.map((value, i) =>
    `<i title="${labels[i]}" style="--h:${max ? 100 * value / max : 0}%"></i>`).join("")}</div>`;
}
export function chart(values, unit, hue = "cyan", large = false, { labels = months, selected = values.length - 1 } = {}) {
  const annual = labels.length > months.length;
  const width = large ? 650 : annual ? 456 : 322;
  const height = large ? 235 : annual ? 123 : 156;
  const padding = { left: 41, right: 20, top: 21, bottom: 27 };
  const range = Math.max(1, Math.max(...values) - Math.min(...values));
  const order = 10 ** Math.floor(Math.log10(range / 3));
  const step = Math.ceil(range / 3 / order) * order;
  const min = Math.floor(Math.min(...values) / step) * step;
  const max = Math.max(min + step, Math.ceil(Math.max(...values) / step) * step);
  const bottom = height - padding.bottom;
  const xy = (value, index) => [padding.left + (width - padding.right - padding.left) * index / Math.max(1, values.length - 1), padding.top + (max - value) * (bottom - padding.top) / (max - min)];
  const coordinates = values.map(xy);
  const line = coordinates.map((point) => point.join(",")).join(" ");
  const ticks = Array.from({length: Math.round((max - min) / step) + 1}, (_, i) => min + i * step);
  const id = `chart-${hue}-${large ? "large" : values.join("-")}`;
  return `<div class="chart ${hue} ${large ? "chart-large" : ""}${annual ? " chart-annual" : ""}"><div class="chart-unit">单位 · ${unit}</div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${labels.map((month, i) => month + fmt(values[i]) + unit).join("，")}">
      <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="currentColor" stop-opacity=".28"/><stop offset="100%" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
      ${ticks.map((value) => { const y = xy(value, 0)[1]; return `<line class="axis" x1="${padding.left}" x2="${width - padding.right}" y1="${y}" y2="${y}"/><text x="${padding.left - 8}" y="${y + 4}" text-anchor="end">${value}</text>`; }).join("")}
      <polygon points="${padding.left},${bottom} ${line} ${width - padding.right},${bottom}" fill="url(#${id})"/>
      <polyline points="${line}" class="series"/>
      ${coordinates.map(([x, y], i) => `<g class="chart-point${i === selected ? " is-selected" : ""}" tabindex="0" role="img" aria-label="${labels[i]} ${fmt(values[i])}${unit}">
        <circle class="chart-dot" cx="${x}" cy="${y}" r="${i === selected ? 4 : 2.7}"/><circle cx="${x}" cy="${y}" r="12" fill="transparent"/>
        <text class="chart-tooltip ${i === selected ? "selected-value" : ""}" x="${x}" y="${y - 10}" text-anchor="${i === values.length - 1 ? "end" : "middle"}">${fmt(values[i])}</text>
        <text class="chart-month" x="${x}" y="${bottom + 19}" text-anchor="middle">${labels[i]}</text></g>`).join("")}
    </svg></div>`;
}


export const coords = (x, y) => `--x:${x / 12}%;--y:${y / 8}%`;
export function stageLink(x, y, href, content, cls) {
  return `<a class="located ${cls}" style="${coords(x, y)}" href="${href}">${content}</a>`;
}
export function stageButton(x, y, action, content, cls) {
  return button(content, `style="${coords(x, y)}" ${action}`, `located ${cls}`);
}
export const palette = { cyan: "#69cfff", violet: "#b083ff", teal: "#73e5df", gold: "#f3d5a2" };
function filamentPath(x, y, endX, endY, offset = 0, bend = 0) {
  const handle = (endX - x) * .44;
  return `M${x} ${y + offset * .34} C${x + handle} ${y + offset * bend} ${endX - handle} ${endY + offset * bend} ${endX} ${endY + offset * .45}`;
}
export function filaments(x, y, endX, endY, hue, bend = 4, count = 18) {
  const curves = Array.from({ length: count }, (_, j) => {
    const offset = j - (count - 1) / 2;
    return `<path d="${filamentPath(x, y, endX, endY, offset, bend)}" opacity="${.13 + (j % 5) * .045}"/>`;
  }).join("");
  return `<g stroke="${palette[hue]}" fill="none">${curves}<path class="travel" style="--delay:${-(Math.abs(endY) % 6)}s" d="${filamentPath(x, y, endX, endY)}"/></g>`;
}
export function drawing(content, classes = "") {
  return `<svg class="drawing ${classes}" viewBox="0 0 1200 800" preserveAspectRatio="none" aria-hidden="true">${content}</svg>`;
}

export const projectAlertGap = 5;
export const signed = (value) => (value > 0 ? "+" : "") + fmt(Number(value.toFixed(1)));

export function projectGap(project) {
  return project.progress - project.planned;
}

export function insightSelect(label, field, options, chosen) {
  return `<label class="insight-select"><span>${label}</span><select data-insight-field="${field}">
    ${options.map(([value, text]) => `<option value="${value}" ${String(value) === String(chosen) ? "selected" : ""}>${text}</option>`).join("")}
  </select></label>`;
}

export function insightTable(headers, rows, caption) {
  return `<div class="insight-table-wrap"><table class="insight-table"><caption>${caption}</caption>
    <thead><tr>${headers.map((header) => `<th scope="col">${header}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(([label, ...cells]) => `<tr><th scope="row">${label}</th>${cells.map((value) => `<td>${value}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}

export function insightSection(title, content) {
  return `<section class="insight-section"><h3>${title}</h3>${content}</section>`;
}

export function insightFinding(label, value, basis, action) {
  return `<section class="insight-section insight-finding">
    <h3>${label}</h3><strong>${value}</strong><p>${basis}</p>${action}
  </section>`;
}
