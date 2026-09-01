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
    uptimeSeconds,
  };
}
