import { ageBreakdown, ageLabels, button, coords, drawing, fmt, icon, palette, pct, signed } from "./graphics.js";

// Representative points projected from the reference township boundaries.
const townMapPoints = new Map([
  ["大峪街道", [506.2, 242.4]],
  ["城子街道", [502.8, 227.9]],
  ["东辛房街道", [484.1, 239.1]],
  ["大台街道", [343.3, 232.2]],
  ["王平镇", [389.2, 175.7]],
  ["永定镇", [512.1, 274.3]],
  ["龙泉镇", [490.4, 221.9]],
  ["潭柘寺镇", [433.9, 289.7]],
  ["军庄镇", [520.3, 171.5]],
  ["雁翅镇", [295.1, 112.2]],
  ["斋堂镇", [211.9, 163.0]],
  ["清水镇", [111.1, 231.4]],
  ["妙峰山镇", [444.3, 163.4]],
]);

export default function population(context) {
  const { $, window, document, towns, onAreaChange } = context;
  let { area, population } = context;
  const scopeTown = (scope) => scope.area.level === "district" ? -1 : towns.findIndex(t => t.id === scope.parentId);
  let pinned = scopeTown(context);
  let applyScope;
  const total = towns.reduce((sum, town) => sum + town.population, 0);
  const populationMix = ageLabels.map((_, index) => towns.reduce((sum, town) => sum + town.population * town.age[index] / 100, 0));
  const state = { filter: "all", town: pinned, townRank: "size", townExpanded: pinned >= 0, townNetworkOpen: true,
    populationBranch: -1, populationLeaf: -1, populationAuto: !window.matchMedia("(prefers-reduced-motion: reduce)").matches };
  const townPositions = towns.map(({ name }) => {
    const [x, y] = townMapPoints.get(name);
    return [260 + (x - 111) * 1.6, 158 + (y - 112) * 2.6];
  });
  const satellitePositions = [[358, 285], [283, 354], [236, 417], [467, 389], [538, 295], [472, 521], [488, 625], [652, 611], [708, 577], [1004, 435], [959, 662], [788, 307], [737, 172], [897, 281], [958, 316], [514, 138], [459, 104]];
  const firstSatellite = townPositions.length + 1;
  const firstPopulationBranch = firstSatellite + satellitePositions.length;
  const populationPositions = [[506, 496], ...townPositions, ...satellitePositions];
  const largestTownPopulation = Math.max(...towns.map(({ population }) => population));
  const townLogPopulations = towns.map(({ population }) => Math.log(population));
  const minTownLogPopulation = Math.min(...townLogPopulations);
  const townLogPopulationRange = Math.max(...townLogPopulations) - minTownLogPopulation;
  const populationIdleDelay = 6500;
  const populationCycleDelay = 4200;
  const populationHoverDelay = 240;
  const populationBranchDuration = 460;
  const populationRetractDuration = 300;
  const populationFloatSpeed = 1.2;
  function townVisible(town) {
    return state.filter === "all" || town.name.endsWith(state.filter === "town" ? "镇" : "街道");
  }
  function populationNode(index, label, value, actions, classes, pinClass = "town-pin", style = "") {
    const position = populationPositions[index] ?? townPositions[state.town];
    return `<div class="located population-node ${classes}" data-pop-node="${index}" style="${coords(...position)};${style}">
      ${button("<i aria-hidden=\"true\"></i>", `aria-label="${label}，${value}" ${actions}`, pinClass)}
      <span class="town-label" aria-hidden="true"><b>${label}</b><small>${value}</small></span>
    </div>`;
  }
  function populationPath([x, y], [endX, endY]) {
    return `M${x} ${y} L${endX} ${endY}`;
  }
  function populationLine(from, to, attributes = "") {
    const origin = populationPositions[from] ?? townPositions[state.town];
    return `<path d="${populationPath(origin, populationPositions[to] ?? origin)}" data-pop-line="${from} ${to}" ${attributes}/>`;
  }

  function populationBranches(town) {
    const ages = ["children", "working-age", "older"];
    const isTown = town.name.endsWith("镇");
    const groupName = isTown ? "镇" : "街道";
    const peers = towns.filter((item) => item.name.endsWith("镇") === isTown);
    const peerTotal = peers.reduce((sum, item) => sum + item.population, 0);
    const rank = (items, metric) => 1 + items.filter((item) => metric(item) > metric(town)).length;
    const size = (item) => item.population;
    const ageRank = (item) => item.age[2];
    return [
      ...ageLabels.map((label, i) => {
        const baseline = 100 * populationMix[i] / total;
        const population = Math.round(town.population * town.age[i] / 100);
        const leaves = [
          { key: "count", label: "估算人数", value: `约 ${fmt(population)} 人`, note: "按镇街常住人口和本年龄段占比估算。" },
          { key: "comparison", label: "较全区", value: `${signed(town.age[i] - baseline)} 个百分点`, note: `全区同年龄段占比 ${baseline.toFixed(1)}%。` },
        ];
        return { key: ages[i], label, value: town.age[i].toFixed(1) + "%", color: `age-group-${i}`, leaves };
      }),
      {
        key: "share", label: "全区人口占比", value: pct(town.population, total) + "%", color: "population-share",
        leaves: [
          { key: "district", label: "全区人口", value: `${(total / 10000).toFixed(2)} 万人`, note: "汇总全区 13 个镇街的演示常住人口。" },
          { key: "peers", label: "同类人口占比", value: pct(town.population, peerTotal) + "%", note: `${peers.length} 个${groupName}合计 ${fmt(peerTotal)} 人。` },
        ],
      },
      {
        key: "rank", label: "常住人口位次", value: `第 ${rank(towns, size)} / ${towns.length}`, color: "population-position",
        leaves: [
          { key: "peers", label: "同类人口位次", value: `第 ${rank(peers, size)} / ${peers.length}`, note: `在 ${peers.length} 个${groupName}中按常住人口从高到低排名。` },
          { key: "older", label: "老龄占比位次", value: `第 ${rank(towns, ageRank)} / ${towns.length}`, note: `按 60 岁及以上占比排名，相同占比并列。该镇街占比 ${town.age[2].toFixed(1)}%。` },
        ],
      },
    ];
  }

  function populationBranchDetail(branch) {
    if (!branch) return "";
    const leaf = branch.leaves[state.populationLeaf];
    return `<section class="population-branch-detail ${branch.color}" aria-label="${branch.label}明细">
      <div class="population-facet-title"><h3>${branch.label}</h3><strong>${branch.value}</strong></div>
      <dl>${branch.leaves.map(({ label, value }, i) => `<div${i === state.populationLeaf ? ' class="is-active"' : ""}><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>
      <p>${leaf?.note ?? branch.leaves.map(({ note }) => note).join("")}</p>
    </section>`;
  }

  function populationSelection() {
    const town = area.level === "village" && state.town === pinned ? population : towns[state.town];
    const branches = town && state.townExpanded && state.townNetworkOpen ? populationBranches(town) : [];
    return { town, branches, branch: branches[state.populationBranch] };
  }

  function populationBranchLines(branches) {
    return branches.map(({ color }, i) => populationLine(state.town + 1, firstPopulationBranch + i,
      `class="population-spoke ${color}${i === state.populationBranch ? " is-active" : ""}"`)).join("");
  }

  function populationLeafLines(branch, firstLeaf) {
    return branch?.leaves.map((_, i) => populationLine(firstPopulationBranch + state.populationBranch, firstLeaf + i,
      `class="population-spoke population-leaf-spoke ${branch.color}${i === state.populationLeaf ? " is-active" : ""}"`)).join("") ?? "";
  }

  function populationBranchNodes(branches) {
    return branches.map(({ label, value, color }, i) => populationNode(firstPopulationBranch + i, label, value,
      `data-pop-branch="${i}" aria-expanded="${i === state.populationBranch}" aria-controls="population-leaves"`,
      `population-branch-node ${color}`, "population-branch-pin")).join("");
  }

  function populationLeafNodes(branch, firstLeaf) {
    return branch?.leaves.map(({ label, value }, i) => populationNode(firstLeaf + i, label, value,
      `data-pop-leaf="${i}" aria-pressed="${i === state.populationLeaf}"`,
      `population-branch-node population-leaf-node ${branch.color}`, "population-branch-pin")).join("") ?? "";
  }

  function populationDetailContent(town, branch, visible) {
    const scope = { all: "全区", town: "全部镇", street: "全部街道" }[state.filter];
    const scopeTotal = visible.reduce((sum, item) => sum + item.population, 0);
    const age = town ? town.age : ageLabels.map((_, i) => visible.reduce((sum, item) => sum + item.population * item.age[i], 0) / scopeTotal);
    return `<h2>${town ? town.name : scope + "人口结构"}</h2>
      <div class="age-stat"><span>常住人口</span><strong>${fmt(town?.population ?? scopeTotal)} 人</strong></div>
      ${ageBreakdown(age)}
      ${populationBranchDetail(branch)}`;
  }

  function populationView() {
    const { town, branches, branch } = populationSelection();
    const expanded = branches.length > 0;
    const visible = rankedTowns();
    const scope = { all: "全区", town: "全部镇", street: "全部街道" }[state.filter];
    const byAge = state.townRank === "older";
    const rankValue = (item) => byAge ? item.age[2] : item.population;
    const ranking = [...visible].sort((a, b) => rankValue(b) - rankValue(a));
    const bestValue = rankValue(ranking[0]);
    let rank = 1;
    return `<section class="reference ref-population" aria-label="镇街人口">
      <div class="population-network${town ? " has-spotlight" : ""}">
      <canvas class="population-sky" aria-hidden="true"></canvas>
      ${drawing(`<defs><radialGradient id="town-light"><stop stop-color="#5b98ff" stop-opacity=".19"/><stop offset="100%" stop-color="#222071" stop-opacity="0"/></radialGradient></defs>
        <ellipse cx="613" cy="405" rx="478" ry="366" fill="url(#town-light)"/>
        ${state.townNetworkOpen ? `
        <g class="population-satellites" stroke="#506ca8" stroke-opacity=".25">${satellitePositions.map(([x, y], i) => {
          const closest = townPositions.reduce((best, [tx, ty], index) => {
            const distance = (tx - x) ** 2 + (ty - y) ** 2;
            return distance < best.distance ? { index, distance } : best;
          }, { index: 0, distance: Infinity });
          return populationLine(firstSatellite + i, 1 + closest.index);
        }).join("")}</g>
        <g class="population-satellites" fill="#789eff">${satellitePositions.map(([x, y], i) => `<circle class="satellite" data-pop-satellite="${firstSatellite + i}" style="--delay:${-i / 4}s" cx="${x}" cy="${y}" r="${i % 3 ? 3 : 5}"/>`).join("")}</g>
        ${towns.map((item, i) => populationLine(0, i + 1, `data-town-edge="${i}" class="population-town-edge${i === state.town ? " is-active" : ""}${townVisible(item) ? "" : " is-filtered"}" style="--edge-color:${item.name.endsWith("镇") ? palette.cyan : palette.violet}"`)).join("")}` : ""}
        <g class="population-retract-lines" aria-hidden="true"></g>
        <g class="population-branch-lines">${populationBranchLines(branches)}</g>
        <g class="population-leaf-lines">${populationLeafLines(branch, firstPopulationBranch + branches.length)}</g>`)}
      <aside class="population-legend shadow-card"><div class="population-legend-head"><strong>镇街类型</strong>
        ${button(icon(state.populationAuto ? "pause" : "play"), `aria-label="镇街轮播" ${pinned >= 0 ? "disabled" : ""} aria-pressed="${state.populationAuto}" title="${state.populationAuto ? "暂停镇街轮播" : "开启镇街轮播"}"`, "population-autoplay")}</div>
        ${[["all", "全部镇街"], ["town", "镇 · 9 个"], ["street", "街道 · 4 个"]].map(([filter, text]) => button(`<i class="legend-dot ${filter}"></i>${text}`, `data-filter="${filter}" aria-pressed="${state.filter === filter}"`)).join("")}
        <div class="population-shade"><span>人口少</span><i aria-hidden="true"></i><span>人口多</span></div>
      </aside>
      ${populationNode(0, "门头沟区", (total / 10000).toFixed(2) + " 万人",
        `data-pick="-1" aria-controls="population-towns" aria-expanded="${state.townNetworkOpen}"`, "population-core", "town-pin", "--ripple-delay:-.36s")}
      <div id="population-towns" ${state.townNetworkOpen ? "" : "hidden"}>
        ${state.townNetworkOpen ? towns.map((item, i) => populationNode(i + 1, item.name, fmt(item.population) + " 人",
          `data-pick="${i}" aria-pressed="${i === state.town}" aria-expanded="${expanded && i === state.town}" aria-controls="population-branches" ${townVisible(item) ? "" : "disabled"}`,
          `population-town ${item.name.endsWith("镇") ? "blue-pin" : "purple-pin"}`, "town-pin",
          `--town-lightness:${(85 - 34 * (townLogPopulations[i] - minTownLogPopulation) / townLogPopulationRange).toFixed(1)}%;--population-scale:${Math.sqrt(item.population / largestTownPopulation).toFixed(3)};--ripple-delay:${-310 * i}ms`)).join("") : ""}
      </div>
      <div class="population-retract-nodes" aria-hidden="true" inert></div>
      <div id="population-branches" ${expanded ? "" : "hidden"}>
        <div class="population-branch-nodes">${populationBranchNodes(branches)}</div>
        <div id="population-leaves" ${branch ? "" : "hidden"}>${populationLeafNodes(branch, firstPopulationBranch + branches.length)}</div>
      </div>
      </div>
      <aside class="population-detail shadow-card">${populationDetailContent(town, branch, visible)}</aside>
      <aside class="population-rank${town ? " has-spotlight" : ""}"><div class="population-rank-panel shadow-card"><div class="panel-head"><h2 id="population-rank-title">镇街排行</h2><span>${scope} · ${ranking.length} 个</span></div>
        <div class="screen-toggles" role="group" aria-label="排行指标">${[["size", "常住人口"], ["older", "60 岁及以上占比"]].map(([key, label]) =>
          button(label, `data-town-rank="${key}" aria-pressed="${state.townRank === key}"`)).join("")}</div>
        <div class="population-rank-window" role="region" aria-labelledby="population-rank-title" tabindex="0">
          <ol class="bars population-rank-list ${byAge ? "violet" : "cyan"}" role="list">${ranking.map((item, index) => {
            const value = rankValue(item);
            if (index && value !== rankValue(ranking[index - 1])) rank = index + 1;
            return `<li>${button(`<span class="population-rank-place" aria-label="第 ${rank} 名">${String(rank).padStart(2, "0")}</span>
              <span class="bar-title">${item.name}</span><strong>${fmt(value)}<small>${byAge ? "%" : "人"}</small></strong>
              <span class="bar-track" aria-hidden="true"><i style="--value:${100 * value / bestValue}%"></i></span>`,
            `data-pick="${item.index}" aria-pressed="${state.town === item.index}"`, "bar-row")}</li>`;
          }).join("")}</ol>
        </div>
      </div>
      </aside>
    </section>`;
  }

  function overlapArea(a, b, gap = 0) {
    const width = Math.min(a.right, b.right + gap) - Math.max(a.left, b.left - gap);
    const height = Math.min(a.bottom, b.bottom + gap) - Math.max(a.top, b.top - gap);
    return Math.max(0, width) * Math.max(0, height);
  }

  function layoutTownLabels(screen, nodes, bounds, scaleX, scaleY) {
    const area = new window.DOMRect(bounds.x + 8, bounds.y + 8, bounds.width - 16, bounds.height - 16);
    const blocked = [...screen.querySelectorAll(".population-legend, .population-detail, .population-rank")]
      .map((element) => element.getBoundingClientRect());
    const anchors = nodes.map(([element, index]) => {
      const [cx, cy] = populationPositions[index];
      const x = bounds.x + cx * scaleX;
      const y = bounds.y + cy * scaleY;
      const pin = element.firstElementChild.getBoundingClientRect();
      blocked.push(new window.DOMRect(x - pin.width / 2, y - pin.height / 2, pin.width, pin.height));
      return { element, x, y, radius: pin.width / 2 };
    }).sort((a, b) => b.x - a.x);
    const directions = [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, 1], [-1, -1], [1, 1]];

    for (const { element, x, y, radius } of anchors) {
      const label = element.lastElementChild;
      const { width, height } = label.getBoundingClientRect();
      let choice;
      let best = Infinity;
      for (const gap of [4, 13, 24, 40, 56, 72, 88]) {
        for (const [i, [dx, dy]] of directions.entries()) {
          const box = new window.DOMRect(x + dx * (radius + gap + width / 2) - width / 2,
            y + dy * (radius + gap + height / 2) - height / 2, width, height);
          const overlap = blocked.reduce((sum, obstacle) => sum + overlapArea(box, obstacle, 5), 0);
          const score = 4 * (width * height - overlapArea(box, area)) + 3 * overlap + 2 * gap + i * 2;
          if (score >= best) continue;
          choice = box;
          best = score;
        }
      }
      blocked.push(choice);
      const leaderX = Math.max(choice.left, Math.min(x, choice.right)) - x;
      const leaderY = Math.max(choice.top, Math.min(y, choice.bottom)) - y;
      element.style.setProperty("--label-x", `${choice.x - x}px`);
      element.style.setProperty("--label-y", `${choice.y - y}px`);
      element.style.setProperty("--label-leader", `${Math.hypot(leaderX, leaderY)}px`);
      element.style.setProperty("--label-angle", `${Math.atan2(leaderY, leaderX)}rad`);
    }
  }

  function layoutPopulationBranches(network, nodes, children, parent, positions, bounds, scaleX, scaleY) {
    const blocked = [...network.closest(".ref-population").querySelectorAll(
      ".population-legend, .population-detail, .population-rank",
    )].map((element) => element.getBoundingClientRect());
    const townLabels = [];
    for (const [element, i] of nodes) {
      const anchor = element.getBoundingClientRect();
      const [x, y] = positions[i];
      for (const part of element.children) {
        const box = part.getBoundingClientRect();
        const base = new window.DOMRect(bounds.x + x * scaleX + box.x - anchor.x,
          bounds.y + y * scaleY + box.y - anchor.y, box.width, box.height);
        if (part.matches("button") || i === parent || i >= firstPopulationBranch) blocked.push(base);
        else townLabels.push([element, base]);
      }
    }
    const [parentX, parentY] = positions[parent];
    const x = bounds.x + parentX * scaleX;
    const y = bounds.y + parentY * scaleY;
    const pin = children[0][0].firstElementChild.getBoundingClientRect();
    const labels = children.map(([element]) => element.lastElementChild.getBoundingClientRect());
    const labelOrder = labels.map((_, i) => i).sort((a, b) => labels[b].width - labels[a].width);
    const inset = 7;
    const area = new window.DOMRect(bounds.x + inset, bounds.y + inset, bounds.width - 2 * inset, bounds.height - 2 * inset);
    const detail = parent >= firstPopulationBranch;
    const directionCount = 24;
    const radiusSteps = detail ? [1.85, 2.35, 2.9, 3.5, 4.2, 4.9, 5.6] : [2.55, 3.2, 3.85, 4.5, 5.15, 5.8];
    const spreads = detail ? [.4, .68, 1.05, 1.45] : [1.04, 1.33, 1.61];
    const labelPlacements = [
      ["below", (w) => [-w / 2, pin.height / 2 + 2]],
      ["above", (w, h) => [-w / 2, -pin.height / 2 - h - 2]],
      ["right", (w, h) => [pin.width / 2 + 2, -h / 2]],
      ["left", (w, h) => [-pin.width / 2 - w - 2, -h / 2]],
    ];
    let best = { score: Infinity };

    function obstructionCost(overlap) {
      return overlap * 3 + (overlap > 8 ? 28 : 0);
    }

    function placementCost(box, occupied = []) {
      let score = 4 * (box.width * box.height - overlapArea(box, area));
      for (const obstacle of blocked) score += obstructionCost(overlapArea(box, obstacle)) + .08 * overlapArea(box, obstacle, 8);
      for (const obstacle of occupied) score += obstructionCost(overlapArea(box, obstacle)) + .15 * overlapArea(box, obstacle, 3);
      for (const [, caption] of townLabels) score += .1 * overlapArea(box, caption, 5);
      return score;
    }

    // Place the fan in screen pixels so the label clearance survives changes in aspect ratio.
    for (const size of radiusSteps) {
      const radius = pin.width * size;
      if (1.8 * radius >= best.score) break;
      for (let direction = 0; direction < directionCount; direction++) {
        const angle = direction * 2 * Math.PI / directionCount;
        for (const spread of spreads) {
          const points = children.map((_, i) => {
            const offset = (2 * i / (children.length - 1) - 1) * spread;
            return [x + radius * Math.cos(angle + offset), y + radius * Math.sin(angle + offset)];
          });
          const axis = Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle)) ? 1 : 0;
          points.sort((a, b) => a[axis] - b[axis]);
          const dots = points.map(([px, py]) => new window.DOMRect(px - pin.width / 2, py - pin.height / 2, pin.width, pin.height));
          const spokes = points.flatMap(([px, py]) => [.27, .39, .51, .63, .75, .87].map((along) =>
            new window.DOMRect(x + (px - x) * along - 1, y + (py - y) * along - 1, 2, 2)));
          const occupied = [...dots];
          let score = 1.8 * radius + 2 * dots.reduce((total, dot) => total + placementCost(dot), 0);
          for (const segment of spokes) {
            if (blocked.some((box) => overlapArea(segment, box))) score += 16;
            if (townLabels.some(([, box]) => overlapArea(segment, box))) score += 5;
          }
          const sides = [];
          // Give the widest caption first choice of space to avoid covering adjacent dots.
          for (const i of labelOrder) {
            const [px, py] = points[i];
            const { width, height } = labels[i];
            let placement = { score: Infinity };
            for (const [side, offset] of labelPlacements) {
              const [dx, dy] = offset(width, height);
              const box = new window.DOMRect(px + dx, py + dy, width, height);
              const crossing = spokes.reduce((total, segment) => total + (overlapArea(segment, box) ? 8 : 0), 0);
              const cost = placementCost(box, occupied) + crossing;
              if (cost < placement.score) placement = { side, box, score: cost };
            }
            score += placement.score;
            sides[i] = placement.side;
            occupied.push(placement.box);
          }
          const muted = townLabels.filter(([, box]) =>
            occupied.some((part) => overlapArea(part, box, 2) > 16) ||
            spokes.filter((part) => overlapArea(part, box)).length > 1);
          score += 26 * muted.length;
          if (score < best.score) best = { score, points, sides, muted };
        }
      }
    }
    return {
      sides: best.sides,
      muted: best.muted.map(([element]) => element),
      positions: best.points.map(([px, py]) => [(px - bounds.x) / scaleX, (py - bounds.y) / scaleY]),
    };
  }

  function paintPopulationSky(canvas, width, height) {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * pixelRatio);
    const pixelHeight = Math.round(height * pixelRatio);
    if (!pixelWidth || !pixelHeight || (canvas.width === pixelWidth && canvas.height === pixelHeight)) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    ctx.scale(pixelRatio, pixelRatio);

    let seed = 9031;
    function random() {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    }

    const colors = ["#cfe1ff", "#acd2ff", "#839cff", "#c5adff"];
    const count = Math.ceil(width * height / 2300);
    for (let i = 0; i < count; i++) {
      const across = random();
      const dust = i % 3 !== 0;
      const along = dust ? .8 - across * .6 + (random() + random() - 1) * .4 : random();
      const brightness = random();
      const radius = .36 + brightness ** 3 * (dust ? .58 : .91);
      const x = across * width;
      const y = along * height;
      ctx.fillStyle = colors[i % colors.length];
      if (!dust && brightness > .94) {
        ctx.globalAlpha = .15;
        ctx.fillRect(x - 2.9, y - .35, 5.8, .7);
        ctx.fillRect(x - .35, y - 2.9, .7, 5.8);
      }
      ctx.globalAlpha = (dust ? .14 : .22) + brightness * (dust ? .27 : .41);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  function animatePopulation() {
    const network = $(".population-network");
    const screen = network.closest(".ref-population");
    const sky = network.querySelector(".population-sky");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const readNodes = (selector) => [...network.querySelectorAll(selector)].map((element) => [element, Number(element.dataset.popNode)]);
    const townNodes = readNodes(".population-core, #population-towns > [data-pop-node]");
    const satellites = [...network.querySelectorAll("[data-pop-satellite]")].map((element) => [element, Number(element.dataset.popSatellite)]);
    const branchGroup = network.querySelector("#population-branches");
    const branchNodes = branchGroup.querySelector(".population-branch-nodes");
    const leafNodes = branchGroup.querySelector("#population-leaves");
    const branchLines = network.querySelector(".population-branch-lines");
    const leafLines = network.querySelector(".population-leaf-lines");
    const retractNodes = network.querySelector(".population-retract-nodes");
    const retractLines = network.querySelector(".population-retract-lines");
    const townEdges = network.querySelectorAll("[data-town-edge]");
    const detail = screen.querySelector(".population-detail");
    const ranking = screen.querySelector(".population-rank");
    const rankWindow = ranking.querySelector(".population-rank-window");
    const rankPins = rankWindow.querySelectorAll("[data-pick]");
    const autoplay = screen.querySelector(".population-autoplay");
    const visible = rankedTowns();
    const tour = visible.map(({ index }) => index);
    const events = new window.AbortController();
    const listener = { signal: events.signal, passive: true };
    const enterTimes = new WeakMap();
    const retractions = [];
    let nodes, levels, lines;
    let positions = populationPositions;
    let drawnPositions = positions;
    let shownTown = state.townExpanded ? state.town : -1;
    let shownBranch = state.populationBranch;
    let lastTown = state.town;
    let scaleX;
    let scaleY;
    let frame;
    let timer;
    let graphWidth;
    let graphHeight;
    let hovering = false;
    let hoverTown = -1;
    let hoverCloseTimer;
    let pointerX, pointerY;

    function readSelection(firstChangedLevel) {
      const branches = readNodes(".population-branch-nodes > [data-pop-node]");
      const leaves = readNodes("#population-leaves > [data-pop-node]");
      nodes = [...townNodes, ...branches, ...leaves];
      levels = [
        [branches, state.town + 1, townNodes],
        [leaves, firstPopulationBranch + state.populationBranch, [...townNodes, ...branches]],
      ];
      lines = [...network.querySelectorAll("[data-pop-line]")].map((element) => [element, element.dataset.popLine.split(" ").map(Number)]);
      const start = window.performance.now();
      for (const [children] of levels.slice(firstChangedLevel)) {
        children.forEach(([element], i) => enterTimes.set(element, start + i * 18));
      }
    }

    function retract(firstChangedLevel) {
      if (motion.matches) return;
      const parts = [];
      for (const [children, origin] of levels.slice(firstChangedLevel)) {
        for (const [element, i] of children) {
          const line = lines.find(([, [, to]]) => to === i)[0].cloneNode();
          const node = element.cloneNode(true);
          node.removeAttribute("data-pop-node");
          node.firstElementChild.removeAttribute("data-pop-branch");
          node.firstElementChild.removeAttribute("data-pop-leaf");
          line.removeAttribute("data-pop-line");
          const alpha = Number(node.style.opacity || 1);
          parts.push({ i, origin, node, line, alpha, anchor: drawnPositions[origin], point: drawnPositions[i], base: positions[i] });
          retractNodes.append(node);
          retractLines.append(line);
        }
      }
      if (parts.length) retractions.push({ parts, start: window.performance.now() });
    }

    function updateRankFade() {
      rankWindow.classList.toggle("fade-top", rankWindow.scrollTop > 2);
      rankWindow.classList.toggle("fade-bottom", rankWindow.scrollTop + rankWindow.clientHeight < rankWindow.scrollHeight - 2);
    }

    function revealRank(behavior) {
      const active = rankWindow.querySelector('[aria-pressed="true"]');
      if (!active) return;
      const row = active.getBoundingClientRect();
      const clip = rankWindow.getBoundingClientRect();
      const inset = 18;
      const offset = row.top < clip.top + inset ? row.top - clip.top - inset
        : Math.max(0, row.bottom - clip.bottom + inset);
      if (Math.abs(offset) > 1) rankWindow.scrollTo({ top: rankWindow.scrollTop + offset, behavior });
    }

    function updateSelection() {
      const { town, branches, branch } = populationSelection();
      const nextTown = branches.length ? state.town : -1;
      const nextBranch = branch ? state.populationBranch : -1;
      const firstChangedLevel = nextTown !== shownTown ? 0 : nextBranch !== shownBranch ? 1 : 2;
      retract(firstChangedLevel);
      branchGroup.hidden = !branches.length;
      if (firstChangedLevel === 0) {
        branchNodes.innerHTML = populationBranchNodes(branches);
        branchLines.innerHTML = populationBranchLines(branches);
      }
      if (firstChangedLevel < 2) {
        leafNodes.hidden = !branch;
        leafNodes.innerHTML = populationLeafNodes(branch, firstPopulationBranch + branches.length);
        leafLines.innerHTML = populationLeafLines(branch, firstPopulationBranch + branches.length);
        shownTown = nextTown;
        shownBranch = nextBranch;
        readSelection(firstChangedLevel);
      }
      [...branchNodes.children].forEach((element, i) => element.firstElementChild.setAttribute("aria-expanded", i === nextBranch));
      [...leafNodes.children].forEach((element, i) => element.firstElementChild.setAttribute("aria-pressed", i === state.populationLeaf));
      [...branchLines.children].forEach((line, i) => line.classList.toggle("is-active", i === nextBranch));
      [...leafLines.children].forEach((line, i) => line.classList.toggle("is-active", i === state.populationLeaf));
      detail.innerHTML = populationDetailContent(town, branch, visible);
      network.classList.toggle("has-spotlight", Boolean(town));
      ranking.classList.toggle("has-spotlight", Boolean(town));
      for (const [element, i] of townNodes) {
        if (i === 0) continue;
        const selected = i === state.town + 1;
        element.firstElementChild.setAttribute("aria-pressed", selected);
        element.firstElementChild.setAttribute("aria-expanded", selected && state.townExpanded);
      }
      for (const edge of townEdges) edge.classList.toggle("is-active", Number(edge.dataset.townEdge) === state.town);
      for (const pin of rankPins) pin.setAttribute("aria-pressed", Number(pin.dataset.pick) === state.town);
      revealRank(motion.matches ? "instant" : "smooth");
      if (firstChangedLevel < 2) measure();
    }

    function selectTown(index) {
      if (pinned >= 0 && pinned !== index) return;
      if (state.town === index && state.townExpanded === (index >= 0)) return;
      state.town = index;
      if (index >= 0) lastTown = index;
      state.townExpanded = index >= 0;
      state.populationBranch = -1;
      state.populationLeaf = -1;
      updateSelection();
    }

    function schedule(delay = populationIdleDelay) {
      window.clearTimeout(timer);
      if (pinned < 0 && state.populationAuto && state.townNetworkOpen && tour.length && hoverTown < 0 && !hovering && !document.hidden) {
        timer = window.setTimeout(advance, delay);
      }
    }

    function advance() {
      if (!$("#details").open && !screen.querySelector(".town-pin:focus-visible, .population-branch-pin:focus-visible, .population-rank-window :focus-visible, .population-rank-window:focus-visible")) {
        selectTown(tour[(tour.indexOf(lastTown) + 1) % tour.length]);
      }
      schedule(populationCycleDelay);
    }

    function setHoverTown(index) {
      hoverTown = index;
      screen.classList.toggle("is-inspecting-town", index >= 0);
      ranking.inert = index >= 0;
    }

    function closeHoverTown() {
      hoverCloseTimer = undefined;
      if (pointerX !== undefined && insideHoverRange()) return;
      setHoverTown(-1);
      if (!branchGroup.querySelector(":focus-visible")) selectTown(-1);
      schedule();
    }

    function insideHoverRange() {
      const bounds = network.getBoundingClientRect();
      const x = pointerX - bounds.left;
      const y = pointerY - bounds.top;
      if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) return false;
      const [townX, townY] = drawnPositions[hoverTown + 1];
      if (Math.hypot(x - townX * scaleX, y - townY * scaleY) <= 38) return true;
      return levels.some(([children, origin]) => children.some(([element, i]) => {
        const label = element.lastElementChild.getBoundingClientRect();
        if (pointerX >= label.left - 10 && pointerX <= label.right + 10 && pointerY >= label.top - 10 && pointerY <= label.bottom + 10) return true;
        const [ax, ay] = drawnPositions[origin];
        const [bx, by] = drawnPositions[i];
        const dx = (bx - ax) * scaleX;
        const dy = (by - ay) * scaleY;
        const px = x - ax * scaleX;
        const py = y - ay * scaleY;
        const projection = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(px - dx * projection, py - dy * projection) <= 24;
      }));
    }

    function updateHoverDismissal(keepOpen) {
      if (hoverTown < 0 || keepOpen) {
        window.clearTimeout(hoverCloseTimer);
        hoverCloseTimer = undefined;
      } else {
        hoverCloseTimer ??= window.setTimeout(closeHoverTown, populationHoverDelay);
      }
    }

    function handlePointerMove(event) {
      if (event.pointerType === "touch" || (event.clientX === pointerX && event.clientY === pointerY)) return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      const pin = event.target.closest(".town-pin, .population-branch-pin");
      const overPin = pin && network.contains(pin) && !pin.disabled;
      hovering = Boolean(overPin || rankWindow.contains(event.target));
      if (overPin) {
        const { pick, popBranch, popLeaf } = pin.dataset;
        if (pick !== undefined) {
          if (pinned >= 0 && pinned !== Number(pick)) return;
          setHoverTown(Number(pick));
          selectTown(Number(pick));
        } else {
          setHoverTown(state.town);
          if (popBranch !== undefined && state.populationBranch !== Number(popBranch)) {
            state.populationBranch = Number(popBranch);
            state.populationLeaf = -1;
            updateSelection();
          } else if (popLeaf !== undefined && state.populationLeaf !== Number(popLeaf)) {
            state.populationLeaf = Number(popLeaf);
            updateSelection();
          }
        }
      }
      updateHoverDismissal(overPin || (hoverTown >= 0 && insideHoverRange()));
      schedule();
    }

    function handlePointerLeave() {
      hovering = false;
      pointerX = pointerY = undefined;
      updateHoverDismissal(false);
      schedule();
    }

    function draw(time) {
      const moving = time !== undefined;
      const floatTime = time * populationFloatSpeed;
      const points = moving ? populationPositions.map(([x, y], i) => {
        const phase = floatTime * (.00078 + i % 4 * .00012) + i * 2.17;
        const amplitude = i < firstSatellite ? 4 : 10 + i % 4 * 2;
        return [x + Math.sin(phase) * amplitude, y + Math.cos(phase * .86) * amplitude * .78];
      }) : [...positions];
      const branchOpacity = [];
      for (const [children, origin] of levels) {
        for (const [element, i] of children) {
          const progress = moving ? Math.max(0, Math.min(1, (time - enterTimes.get(element)) / populationBranchDuration)) : 1;
          const distance = 1 - (1 - progress) ** 3;
          const [ax, ay] = points[origin];
          const phase = floatTime * .001 + i * 2.17;
          const x = positions[i][0] - positions[origin][0] + (moving ? Math.sin(phase) * 2 / scaleX : 0);
          const y = positions[i][1] - positions[origin][1] + (moving ? Math.cos(phase) * 2 / scaleY : 0);
          points[i] = [ax + x * distance, ay + y * distance];
          const opacity = branchOpacity[i] = 1 - (1 - progress) ** 2;
          element.style.opacity = opacity;
          element.classList.toggle("is-arriving", progress < .36);
        }
      }
      for (const [element, i] of nodes) {
        const [x, y] = points[i];
        const [baseX, baseY] = positions[i];
        element.style.translate = moving ? `${((x - baseX) * scaleX).toFixed(2)}px ${((y - baseY) * scaleY).toFixed(2)}px` : "";
      }
      for (const [element, i] of satellites) {
        element.setAttribute("cx", points[i][0].toFixed(2));
        element.setAttribute("cy", points[i][1].toFixed(2));
      }
      for (const [element, [from, to]] of lines) {
        element.setAttribute("d", populationPath(points[from], points[to]));
        if (to >= firstPopulationBranch) element.style.opacity = branchOpacity[to];
      }
      for (let i = retractions.length - 1; i >= 0; i--) {
        const { parts, start } = retractions[i];
        const progress = moving ? Math.min(1, Math.max(0, (time - start) / populationRetractDuration)) : 1;
        if (progress === 1) {
          parts.forEach(({ node, line }) => { node.remove(); line.remove(); });
          retractions.splice(i, 1);
          continue;
        }
        const anchors = new Map();
        const remaining = 1 - progress ** 2;
        for (const part of parts) {
          const origin = anchors.get(part.origin) ?? points[part.origin] ?? part.anchor;
          const point = origin.map((value, axis) => value + (part.point[axis] - part.anchor[axis]) * remaining);
          anchors.set(part.i, point);
          part.node.style.translate = `${(point[0] - part.base[0]) * scaleX}px ${(point[1] - part.base[1]) * scaleY}px`;
          part.node.style.opacity = part.line.style.opacity = part.alpha * (1 - progress) ** 2;
          part.line.setAttribute("d", populationPath(origin, point));
        }
      }
      drawnPositions = points;
    }

    function animate(time) {
      draw(time);
      frame = window.requestAnimationFrame(animate);
    }

    function measure() {
      const bounds = network.getBoundingClientRect();
      const geometryChanged = graphWidth !== bounds.width || graphHeight !== bounds.height;
      if (geometryChanged) {
        graphWidth = bounds.width;
        graphHeight = bounds.height;
        paintPopulationSky(sky, bounds.width, bounds.height);
      }
      scaleX = bounds.width / 1200;
      scaleY = bounds.height / 800;
      if (geometryChanged) layoutTownLabels(screen, townNodes, bounds, scaleX, scaleY);
      positions = [...populationPositions];
      const muted = new Set();
      for (const [children, origin, obstacles] of levels) {
        if (!children.length) continue;
        const layout = layoutPopulationBranches(network, obstacles, children, origin, positions, bounds, scaleX, scaleY);
        layout.muted.forEach((element) => muted.add(element));
        for (const [index, [element, i]] of children.entries()) {
          const [x, y] = positions[i] = layout.positions[index];
          element.style.setProperty("--x", x / 12 + "%");
          element.style.setProperty("--y", y / 8 + "%");
          element.dataset.labelSide = layout.sides[index];
        }
      }
      for (const [element] of townNodes) element.classList.toggle("label-muted", muted.has(element));
      draw(motion.matches ? undefined : window.performance.now());
    }

    const resize = new window.ResizeObserver(measure);
    const rankResize = new window.ResizeObserver(updateRankFade);
    readSelection(0);
    measure();

    function applyMotion() {
      window.cancelAnimationFrame(frame);
      if (motion.matches) draw();
      else frame = window.requestAnimationFrame(animate);
    }
    applyMotion();
    resize.observe(network);
    rankResize.observe(rankWindow);
    revealRank("instant");
    updateRankFade();
    rankWindow.addEventListener("scroll", updateRankFade, listener);
    motion.addEventListener("change", applyMotion);
    window.addEventListener("pointermove", handlePointerMove, listener);
    window.addEventListener("scroll", () => {
      if (hoverTown >= 0 && pointerX !== undefined) updateHoverDismissal(insideHoverRange());
    }, listener);
    document.documentElement.addEventListener("pointerleave", handlePointerLeave, listener);
    window.addEventListener("blur", handlePointerLeave, listener);
    window.addEventListener("wheel", () => schedule(), listener);
    window.addEventListener("keydown", () => schedule(), listener);
    document.addEventListener("visibilitychange", () => schedule(), listener);
    autoplay.addEventListener("click", () => {
      state.populationAuto = !state.populationAuto;
      autoplay.setAttribute("aria-pressed", state.populationAuto);
      autoplay.title = state.populationAuto ? "暂停镇街轮播" : "开启镇街轮播";
      autoplay.innerHTML = icon(state.populationAuto ? "pause" : "play");
      schedule();
    }, listener);
    applyScope = () => {
      hoverTown = -1;
      hovering = false;
      window.clearTimeout(hoverCloseTimer);
      setHoverTown(-1);
      lastTown = pinned;
      // Village snapshots can change within the same town.
      shownTown = undefined;
      updateSelection();
      autoplay.disabled = pinned >= 0;
      autoplay.setAttribute("aria-pressed", String(pinned < 0 && state.populationAuto));
      schedule();
    };
    schedule();
    return () => {
      applyScope = undefined;
      events.abort();
      window.clearTimeout(timer);
      window.clearTimeout(hoverCloseTimer);
      window.cancelAnimationFrame(frame);
      resize.disconnect();
      rankResize.disconnect();
      motion.removeEventListener("change", applyMotion);
    };
  }
  function rankedTowns() {
    return towns.map((town, index) => ({ ...town, index })).filter((town) => townVisible(town));
  }

  return {
    markup: populationView, effect: animatePopulation,
    updateScope(next, render) {
      if (next.area.id === area.id) return;
      area = next.area;
      population = next.population;
      pinned = scopeTown(next);
      state.town = pinned;
      state.townExpanded = pinned >= 0;
      state.populationBranch = -1;
      state.populationLeaf = -1;
      if (!state.townNetworkOpen || (pinned >= 0 && !townVisible(towns[pinned]))) {
        state.townNetworkOpen = true;
        state.filter = "all";
        render();
      } else {
        applyScope();
      }
    },
    onButton(target, render) {
      const { filter, pick, townRank, popBranch, popLeaf } = target.dataset;
      if (pick !== undefined) {
        const index = Number(pick);
        if (index < 0 && pinned >= 0) return onAreaChange("mentougou");
        if (index >= 0 && towns[index].id !== area.id) return onAreaChange(towns[index].id);
        if (index < 0) { state.townNetworkOpen = !state.townNetworkOpen; state.town = -1; }
        else state.townExpanded = !state.townExpanded;
      } else if (filter !== undefined) {
        if (pinned >= 0) return onAreaChange("mentougou");
        state.filter = filter;
        state.town = -1;
        state.townExpanded = false;
        state.townNetworkOpen = true;
      } else if (townRank !== undefined) state.townRank = townRank;
      else if (popBranch !== undefined) {
        state.populationBranch = state.populationBranch === Number(popBranch) ? -1 : Number(popBranch);
        state.populationLeaf = -1;
      } else if (popLeaf !== undefined) state.populationLeaf = state.populationLeaf === Number(popLeaf) ? -1 : Number(popLeaf);
      else return;
      render();
    },
  };
}
