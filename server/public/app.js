const POLL_MS = 10000;

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

function barClass(percent) {
  if (percent == null) return "";
  if (percent >= 90) return "critical";
  if (percent >= 75) return "warning";
  return "";
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

function renderSystem(system, error) {
  if (error || !system) return;

  const { cpu, memory, disks, network, uptimeSeconds } = system;

  $("cpu-usage").textContent = fmtPercent(cpu.usagePercent);
  $("cpu-cores").textContent = cpu.coreCount ? `${cpu.coreCount} cores` : "-- cores";
  const cpuBar = $("cpu-bar");
  cpuBar.style.width = `${Math.min(cpu.usagePercent ?? 0, 100)}%`;
  cpuBar.className = `bar-fill ${barClass(cpu.usagePercent)}`;
  $("cpu-freq").textContent = cpu.currentFrequencyHz ? fmtHz(cpu.currentFrequencyHz) : cpu.maxFrequencyHz ? `${fmtHz(cpu.maxFrequencyHz)} (max)` : "N/A";
  $("cpu-load").textContent = [cpu.load1, cpu.load5, cpu.load15].map((v) => (v != null ? v.toFixed(2) : "--")).join(" / ");

  $("memory-usage").textContent = fmtPercent(memory.usedPercent);
  $("memory-total").textContent = memory.totalBytes ? `${fmtBytes(memory.totalBytes)} total` : "-- total";
  const memBar = $("memory-bar");
  memBar.style.width = `${Math.min(memory.usedPercent ?? 0, 100)}%`;
  memBar.className = `bar-fill ${barClass(memory.usedPercent)}`;
  $("memory-used").textContent = memory.usedBytes != null ? fmtBytes(memory.usedBytes) : "N/A";
  $("memory-swap").textContent = memory.swapTotalBytes ? `${fmtBytes(memory.swapUsedBytes)} / ${fmtBytes(memory.swapTotalBytes)}` : "None";

  const diskList = $("disk-list");
  diskList.innerHTML = "";
  if (!disks || !disks.length) {
    diskList.innerHTML = '<p class="muted">No filesystems reported.</p>';
  } else {
    disks
      .sort((a, b) => a.mountpoint.localeCompare(b.mountpoint))
      .forEach((disk) => {
        const row = document.createElement("div");
        row.className = "disk-row";
        row.innerHTML = `
          <div class="disk-row-head">
            <span>${disk.mountpoint}</span>
            <b>${fmtPercent(disk.usedPercent)} &middot; ${fmtBytes(disk.usedBytes)} / ${fmtBytes(disk.totalBytes)}</b>
          </div>
          <div class="bar"><div class="bar-fill ${barClass(disk.usedPercent)}" style="width:${Math.min(disk.usedPercent, 100)}%"></div></div>
        `;
        diskList.appendChild(row);
      });
  }

  $("net-rx").textContent = fmtRate(network.rxBytesPerSec);
  $("net-tx").textContent = fmtRate(network.txBytesPerSec);

  $("uptime-value").textContent = fmtUptime(uptimeSeconds);
}

function renderDocker(containers, error) {
  const list = $("container-list");
  if (error || !containers) {
    list.innerHTML = '<p class="muted">Unable to reach the Docker socket.</p>';
    $("docker-summary").textContent = "unavailable";
    return;
  }

  const running = containers.filter((c) => c.state === "running").length;
  $("docker-summary").textContent = `${running} running / ${containers.length} total`;

  if (!containers.length) {
    list.innerHTML = '<p class="muted">No containers found.</p>';
    return;
  }

  list.innerHTML = "";
  containers
    .sort((a, b) => (a.state === b.state ? a.name.localeCompare(b.name) : a.state === "running" ? -1 : 1))
    .forEach((c) => {
      const row = document.createElement("div");
      row.className = "container-row";
      row.innerHTML = `
        <span class="status-dot" style="background:${stateDotColor(c.state)}" title="${c.status}"></span>
        <div class="container-name">
          <b>${c.name}</b>
          <span>${c.image}</span>
        </div>
        <span class="container-metric">${c.cpuPercent != null ? fmtPercent(c.cpuPercent) : "--"}</span>
        <span class="container-metric">${c.memory?.usedBytes != null ? fmtBytes(c.memory.usedBytes) : "--"}</span>
      `;
      list.appendChild(row);
    });
}

async function refresh() {
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

initTheme();
tickClock();
setInterval(tickClock, 1000);
refresh();
setInterval(refresh, POLL_MS);
