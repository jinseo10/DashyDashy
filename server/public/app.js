const POLL_MS = 1000;

const $ = (id) => document.getElementById(id);

function fmtBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return "N/A";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtRate(bytesPerSec) {
  if (bytesPerSec == null || Number.isNaN(bytesPerSec)) return "N/A";
  return `${fmtBytes(bytesPerSec)}/s`;
}

function fmtPercent(value) {
  if (value == null || Number.isNaN(value)) return "N/A";
  return `${value.toFixed(1)}%`;
}

function fmtHz(hz) {
  if (hz == null || Number.isNaN(hz)) return "N/A";
  return `${(hz / 1e9).toFixed(2)} GHz`;
}

function fmtUptime(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return "N/A";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function fmtTemp(celsius) {
  if (celsius == null || Number.isNaN(celsius)) return "N/A";
  return `${Math.round(celsius)}°C`;
}

function fmtTempF(celsius) {
  if (celsius == null || Number.isNaN(celsius)) return "--°F";
  return `${Math.round((celsius * 9) / 5 + 32)}°F`;
}

function severityClass(percent) {
  if (percent == null) return "";
  if (percent >= 90) return "critical";
  if (percent >= 75) return "warning";
  return "";
}

// Rough, hardware-agnostic guidance: comfortably idle below ~65C, worth
// keeping an eye on into the 80s, hot beyond that.
function tempSeverityClass(celsius) {
  if (celsius == null) return "";
  if (celsius >= 85) return "critical";
  if (celsius >= 70) return "warning";
  return "";
}

function tempDotColor(celsius) {
  if (celsius == null) return "var(--text-muted)";
  if (celsius >= 85) return "var(--critical)";
  if (celsius >= 70) return "var(--warning)";
  return "var(--good)";
}

function stateDotColor(state) {
  switch (state) {
    case "running":
      return "var(--good)";
    case "paused":
    case "restarting":
      return "var(--warning)";
    case "exited":
    case "dead":
      return "var(--critical)";
    default:
      return "var(--text-muted)";
  }
}

function setRing(el, percent) {
  const clamped = Math.min(Math.max(percent ?? 0, 0), 100);
  el.style.setProperty("--pct", clamped);
  el.classList.remove("warning", "critical");
  const cls = severityClass(percent);
  if (cls) el.classList.add(cls);
}

function renderWeather(weather, error) {
  if (error || !weather) {
    $("weather-condition").textContent = "Unavailable";
    return;
  }
  $("weather-location").textContent = weather.locationName;
  $("weather-icon").textContent = weather.icon;
  $("weather-temp").textContent = weather.temperature != null ? `${Math.round(weather.temperature)}°${weather.units}` : "--°";
  $("weather-condition").textContent = weather.condition;
  $("weather-feels").textContent = weather.feelsLike != null ? `${Math.round(weather.feelsLike)}°${weather.units}` : "--°";
  $("weather-humidity").textContent = weather.humidity != null ? `${Math.round(weather.humidity)}%` : "--%";
  $("weather-wind").textContent = weather.windSpeed != null ? `${Math.round(weather.windSpeed)} ${weather.windUnits}` : "--";
}

function temperatureCard(name, source, celsius) {
  const card = document.createElement("div");
  card.className = "shelf-card";
  card.innerHTML = `
    <div class="shelf-card-head">
      <span class="status-dot" style="background:${tempDotColor(celsius)}"></span>
      <div class="shelf-card-name">
        <b>${name}</b>
        <span>${source}</span>
      </div>
    </div>
    <div class="shelf-card-value">${fmtTemp(celsius)}</div>
    <div class="shelf-card-sub">${fmtTempF(celsius)}</div>
  `;
  return card;
}

function renderTemperatures(temperatures) {
  const shelf = $("card-temps");
  const track = $("temp-shelf-track");
  track.innerHTML = "";

  if (!temperatures) {
    $("temp-summary").textContent = "unavailable";
    track.innerHTML = '<p class="muted">No sensor data.</p>';
    return;
  }

  const cards = [];
  if (temperatures.cpu != null) cards.push({ name: "CPU", source: "package", celsius: temperatures.cpu });
  (temperatures.gpu || []).forEach((g) => cards.push({ name: "GPU", source: g.label, celsius: g.celsius }));
  (temperatures.drives || []).forEach((d) => cards.push({ name: "Drive", source: d.label, celsius: d.celsius }));
  (temperatures.other || []).forEach((o) => cards.push({ name: o.source, source: o.label, celsius: o.celsius }));

  if (!cards.length) {
    track.innerHTML = '<p class="muted">No sensors found.</p>';
  } else {
    cards.forEach((c) => track.appendChild(temperatureCard(c.name, c.source, c.celsius)));
  }

  $("temp-summary").textContent = cards.length ? `${cards.length} sensors` : "no sensors found";
  syncShelfOverflow(shelf, track);
}

function diskCard(disk) {
  const card = document.createElement("div");
  card.className = "shelf-card shelf-card-wide";
  const sev = severityClass(disk.usedPercent);
  card.innerHTML = `
    <div class="shelf-card-head">
      <div class="shelf-card-name">
        <b>${disk.mountpoint}</b>
        <span>${disk.device}</span>
      </div>
    </div>
    <div class="shelf-card-value">${fmtPercent(disk.usedPercent)}</div>
    <div class="shelf-card-bar-row">
      <div class="bar"><div class="bar-fill ${sev}" style="width:${Math.min(disk.usedPercent ?? 0, 100)}%"></div></div>
    </div>
    <div class="shelf-card-metrics">
      <span>Used <b>${fmtBytes(disk.usedBytes)}</b></span>
      <span>Total <b>${fmtBytes(disk.totalBytes)}</b></span>
    </div>
  `;
  return card;
}

function renderDisks(disks) {
  const shelf = $("card-storage");
  const track = $("disk-shelf-track");
  track.innerHTML = "";

  if (!disks || !disks.length) {
    track.innerHTML = '<p class="muted">No filesystems reported.</p>';
    $("disk-summary").textContent = "0 volumes";
    return;
  }

  disks
    .slice()
    .sort((a, b) => a.mountpoint.localeCompare(b.mountpoint))
    .forEach((disk) => track.appendChild(diskCard(disk)));

  $("disk-summary").textContent = `${disks.length} volume${disks.length === 1 ? "" : "s"}`;
  syncShelfOverflow(shelf, track);
}

function renderSystem(system, error) {
  if (error || !system) return;

  const { cpu, memory, disks, network, temperatures, uptimeSeconds } = system;

  $("cpu-usage").textContent = fmtPercent(cpu.usagePercent);
  $("cpu-cores").textContent = cpu.coreCount ? `${cpu.coreCount} cores` : "-- cores";
  setRing($("cpu-ring"), cpu.usagePercent);
  $("cpu-freq").textContent = cpu.currentFrequencyHz ? fmtHz(cpu.currentFrequencyHz) : cpu.maxFrequencyHz ? `${fmtHz(cpu.maxFrequencyHz)} (max)` : "N/A";
  $("cpu-load").textContent = [cpu.load1, cpu.load5, cpu.load15].map((v) => (v != null ? v.toFixed(2) : "--")).join(" / ");

  $("memory-usage").textContent = fmtPercent(memory.usedPercent);
  $("memory-total").textContent = memory.totalBytes ? `${fmtBytes(memory.totalBytes)} total` : "-- total";
  setRing($("memory-ring"), memory.usedPercent);
  $("memory-used").textContent = memory.usedBytes != null ? fmtBytes(memory.usedBytes) : "N/A";
  $("memory-swap").textContent = memory.swapTotalBytes ? `${fmtBytes(memory.swapUsedBytes)} / ${fmtBytes(memory.swapTotalBytes)}` : "None";

  $("net-rx").textContent = fmtRate(network.rxBytesPerSec);
  $("net-tx").textContent = fmtRate(network.txBytesPerSec);
  $("uptime-value").textContent = fmtUptime(uptimeSeconds);

  renderTemperatures(temperatures);
  renderDisks(disks);
}

function containerCard(c) {
  const card = document.createElement("div");
  card.className = "shelf-card shelf-card-wide";
  const cpuText = c.cpuPercent != null ? fmtPercent(c.cpuPercent) : "--";
  const memText = c.memory?.usedBytes != null ? fmtBytes(c.memory.usedBytes) : "--";
  card.innerHTML = `
    <div class="shelf-card-head">
      <span class="status-dot" style="background:${stateDotColor(c.state)}" title="${c.status}"></span>
      <div class="shelf-card-name">
        <b>${c.name}</b>
        <span>${c.image}</span>
      </div>
    </div>
    <div class="shelf-card-metrics">
      <span>CPU <b>${cpuText}</b></span>
      <span>Mem <b>${memText}</b></span>
    </div>
    <div class="shelf-card-sub">${c.status}</div>
  `;
  return card;
}

function renderDocker(containers, error) {
  const shelf = $("card-docker");
  const track = $("container-shelf-track");
  if (error || !containers) {
    track.innerHTML = '<p class="muted">Unable to reach the Docker socket.</p>';
    $("docker-summary").textContent = "unavailable";
    return;
  }

  const running = containers.filter((c) => c.state === "running").length;
  $("docker-summary").textContent = `${running} running / ${containers.length} total`;

  track.innerHTML = "";
  if (!containers.length) {
    track.innerHTML = '<p class="muted">No containers found.</p>';
    return;
  }

  containers
    .slice()
    .sort((a, b) => (a.state === b.state ? a.name.localeCompare(b.name) : a.state === "running" ? -1 : 1))
    .forEach((c) => track.appendChild(containerCard(c)));

  syncShelfOverflow(shelf, track);
}

// Shows the edge-fade mask only when a shelf actually has more content than
// fits, and lets a plain mouse wheel scroll it horizontally (most people
// don't have a trackpad handy on a wall-mounted or kiosk display).
function syncShelfOverflow(shelf, track) {
  if (!shelf || !track) return;
  const scrollable = track.scrollWidth > track.clientWidth + 4;
  shelf.classList.toggle("has-overflow", scrollable);
}

function initShelfWheelScroll() {
  document.querySelectorAll(".shelf-track").forEach((track) => {
    track.addEventListener(
      "wheel",
      (e) => {
        if (track.scrollWidth <= track.clientWidth) return;
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        track.scrollLeft += e.deltaY;
        e.preventDefault();
      },
      { passive: false }
    );
  });
}

async function refresh() {
  // Skip the network round trip while the tab isn't visible (e.g. a
  // backgrounded browser tab) rather than polling a server nobody's
  // looking at every second.
  if (document.hidden) return;

  const statusDot = $("conn-status");
  try {
    const res = await fetch("/api/all", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    renderWeather(data.weather, data.weatherError);
    renderSystem(data.system, data.systemError);
    renderDocker(data.docker, data.dockerError);

    statusDot.className = "status-dot ok";
    statusDot.title = "Connected";
    $("last-updated").textContent = `Updated ${new Date(data.serverTime).toLocaleTimeString()}`;
  } catch (err) {
    statusDot.className = "status-dot error";
    statusDot.title = err.message;
  }
}

function tickClock() {
  $("clock").textContent = new Date().toLocaleTimeString();
}

function initTheme() {
  const stored = localStorage.getItem("dashydashy-theme");
  if (stored) document.documentElement.setAttribute("data-theme", stored);

  $("theme-toggle").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("dashydashy-theme", next);
  });
}

async function initGrafanaLink() {
  try {
    const res = await fetch("/api/config", { cache: "no-store" });
    const { grafanaPort } = await res.json();
    $("grafana-link").href = `${location.protocol}//${location.hostname}:${grafanaPort}`;
  } catch {
    $("grafana-link").remove();
  }
}

function initFadeIn() {
  document.querySelectorAll(".hero-card, .shelf").forEach((el, i) => {
    el.classList.add("fade-in");
    el.style.animationDelay = `${Math.min(i * 60, 240)}ms`;
  });
}

initTheme();
initGrafanaLink();
initFadeIn();
initShelfWheelScroll();
tickClock();
setInterval(tickClock, 1000);
window.addEventListener("resize", () => {
  syncShelfOverflow($("card-temps"), $("temp-shelf-track"));
  syncShelfOverflow($("card-storage"), $("disk-shelf-track"));
  syncShelfOverflow($("card-docker"), $("container-shelf-track"));
});
// Self-scheduling rather than setInterval, so a slow response at a 1s
// cadence can't pile up overlapping requests.
function scheduleRefresh() {
  refresh().finally(() => setTimeout(scheduleRefresh, POLL_MS));
}
scheduleRefresh();

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
