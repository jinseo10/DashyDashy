const PROM_URL = process.env.PROMETHEUS_URL || "http://localhost:9090";

async function instantQuery(query) {
  const url = `${PROM_URL}/api/v1/query?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`prometheus query failed: ${res.status}`);
  const body = await res.json();
  if (body.status !== "success") throw new Error(`prometheus error: ${body.error || "unknown"}`);
  return body.data.result;
}

async function scalar(query) {
  const result = await instantQuery(query);
  if (!result.length) return null;
  const value = Number(result[0].value[1]);
  return Number.isFinite(value) ? value : null;
}

async function vector(query) {
  const result = await instantQuery(query);
  return result.map((item) => ({
    labels: item.metric,
    value: Number(item.value[1]),
  }));
}

const DISK_MOUNTPOINTS = (process.env.DISK_MOUNTPOINTS || "/")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

function mountpointRegex() {
  return DISK_MOUNTPOINTS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
}

// node_exporter's hwmon collector labels each reading with a sanitized bus
// path (e.g. "pci0000_00_18_3"), not the human-readable driver name — the
// driver name ("coretemp", "k10temp", "amdgpu", ...) comes from a separate
// node_hwmon_chip_names info metric that we join on. Chip naming varies a lot
// across motherboards/CPUs, so these patterns are overridable via env vars.
const CPU_TEMP_CHIP_REGEX = new RegExp(process.env.TEMP_CPU_CHIP_REGEX || "coretemp|k10temp|zenpower|cpu.?thermal", "i");
const GPU_TEMP_CHIP_REGEX = new RegExp(process.env.TEMP_GPU_CHIP_REGEX || "amdgpu|radeon|nouveau", "i");
const DRIVE_TEMP_CHIP_REGEX = /nvme|drivetemp/i;

async function getTemperatures() {
  const [readings, chipNames, sensorLabels, nvidiaTemps] = await Promise.all([
    vector("node_hwmon_temp_celsius").catch(() => []),
    vector("node_hwmon_chip_names").catch(() => []),
    vector("node_hwmon_sensor_label").catch(() => []),
    vector("nvidia_smi_temperature_gpu").catch(() => []),
  ]);

  const chipNameByChip = new Map(chipNames.map((c) => [c.labels.chip, c.labels.chip_name]));
  const sensorLabelByKey = new Map(sensorLabels.map((s) => [`${s.labels.chip}|${s.labels.sensor}`, s.labels.label]));

  const cpu = [];
  const gpu = [];
  const drives = [];
  const other = [];

  for (const r of readings) {
    const chip = r.labels.chip;
    const chipName = chipNameByChip.get(chip) || chip;
    const label = sensorLabelByKey.get(`${chip}|${r.labels.sensor}`) || r.labels.sensor;
    const entry = { source: chipName, label, celsius: r.value };

    if (CPU_TEMP_CHIP_REGEX.test(chipName)) cpu.push(entry);
    else if (GPU_TEMP_CHIP_REGEX.test(chipName)) gpu.push(entry);
    else if (DRIVE_TEMP_CHIP_REGEX.test(chipName)) drives.push(entry);
    else other.push(entry);
  }

  for (const g of nvidiaTemps) {
    const name = g.labels.name || "NVIDIA GPU";
    gpu.push({ source: name, label: name, celsius: g.value });
  }

  return {
    // The CPU package usually reports the highest of its per-core sensors,
    // so the max across matched readings is the closest single-number proxy.
    cpu: cpu.length ? Math.max(...cpu.map((r) => r.celsius)) : null,
    cpuSensors: cpu,
    gpu: gpu.sort((a, b) => b.celsius - a.celsius),
    drives: drives.sort((a, b) => b.celsius - a.celsius),
    other: other.sort((a, b) => b.celsius - a.celsius).slice(0, 4),
  };
}

export async function getSystemMetrics() {
  const mountRe = mountpointRegex();

  const [
    cpuUsagePercent,
    cpuCount,
    cpuFreqCurrent,
    cpuFreqMax,
    load1,
    load5,
    load15,
    memTotal,
    memAvailable,
    swapTotal,
    swapFree,
    uptimeSeconds,
    netRxBps,
    netTxBps,
    diskSize,
    diskAvail,
    temperatures,
  ] = await Promise.all([
    scalar('100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)'),
    scalar('count(node_cpu_seconds_total{mode="idle"})'),
    scalar("avg(node_cpu_scaling_frequency_hertz)").catch(() => null),
    scalar("avg(node_cpu_frequency_max_hertz)").catch(() => null),
    scalar("node_load1"),
    scalar("node_load5"),
    scalar("node_load15"),
    scalar("node_memory_MemTotal_bytes"),
    scalar("node_memory_MemAvailable_bytes"),
    scalar("node_memory_SwapTotal_bytes"),
    scalar("node_memory_SwapFree_bytes"),
    scalar("node_time_seconds - node_boot_time_seconds"),
    scalar('sum(rate(node_network_receive_bytes_total{device!="lo"}[1m]))'),
    scalar('sum(rate(node_network_transmit_bytes_total{device!="lo"}[1m]))'),
    vector(`node_filesystem_size_bytes{mountpoint=~"${mountRe}",fstype!~"tmpfs|overlay|squashfs"}`),
    vector(`node_filesystem_avail_bytes{mountpoint=~"${mountRe}",fstype!~"tmpfs|overlay|squashfs"}`),
    getTemperatures(),
  ]);

  const availByMount = new Map(diskAvail.map((d) => [d.labels.mountpoint, d.value]));
  const disks = diskSize.map((d) => {
    const total = d.value;
    const avail = availByMount.get(d.labels.mountpoint) ?? 0;
    const used = Math.max(total - avail, 0);
    return {
      mountpoint: d.labels.mountpoint,
      device: d.labels.device,
      totalBytes: total,
      usedBytes: used,
      availBytes: avail,
      usedPercent: total > 0 ? (used / total) * 100 : 0,
    };
  });

  const memUsed = memTotal != null && memAvailable != null ? Math.max(memTotal - memAvailable, 0) : null;
  const swapUsed = swapTotal != null && swapFree != null ? Math.max(swapTotal - swapFree, 0) : null;

  return {
    cpu: {
      usagePercent: cpuUsagePercent,
      coreCount: cpuCount,
      currentFrequencyHz: cpuFreqCurrent,
      maxFrequencyHz: cpuFreqMax,
      load1,
      load5,
      load15,
    },
    memory: {
      totalBytes: memTotal,
      usedBytes: memUsed,
      availableBytes: memAvailable,
      usedPercent: memTotal ? (memUsed / memTotal) * 100 : null,
      swapTotalBytes: swapTotal,
      swapUsedBytes: swapUsed,
    },
    disks,
    network: {
      rxBytesPerSec: netRxBps,
      txBytesPerSec: netTxBps,
    },
    temperatures,
    uptimeSeconds,
  };
}
