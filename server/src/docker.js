import Docker from "dockerode";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

// Keyed by container ID, holds the previous CPU sample so we can compute a
// percentage from two points in time without the double-read docker stats
// normally needs (we poll on an interval anyway).
const cpuSampleCache = new Map();

function computeCpuPercent(containerId, stats) {
  const cpuTotal = stats.cpu_stats?.cpu_usage?.total_usage;
  const systemTotal = stats.cpu_stats?.system_cpu_usage;
  const onlineCpus = stats.cpu_stats?.online_cpus || stats.cpu_stats?.cpu_usage?.percpu_usage?.length || 1;

  if (cpuTotal == null || systemTotal == null) return null;

  const previous = cpuSampleCache.get(containerId);
  cpuSampleCache.set(containerId, { cpuTotal, systemTotal });

  if (!previous) return null;

  const cpuDelta = cpuTotal - previous.cpuTotal;
  const systemDelta = systemTotal - previous.systemTotal;
  if (systemDelta <= 0 || cpuDelta < 0) return 0;

  return (cpuDelta / systemDelta) * onlineCpus * 100;
}

function computeMemory(stats) {
  const usage = stats.memory_stats?.usage;
  const limit = stats.memory_stats?.limit;
  const cache = stats.memory_stats?.stats?.cache ?? stats.memory_stats?.stats?.inactive_file ?? 0;
  if (usage == null || limit == null) return { usedBytes: null, limitBytes: null, usedPercent: null };
  const usedBytes = Math.max(usage - cache, 0);
  return {
    usedBytes,
    limitBytes: limit,
    usedPercent: limit > 0 ? (usedBytes / limit) * 100 : null,
  };
}

export async function getContainers() {
  const containers = await docker.listContainers({ all: true });

  return Promise.all(
    containers.map(async (info) => {
      const name = info.Names?.[0]?.replace(/^\//, "") || info.Id.slice(0, 12);
      const base = {
        id: info.Id.slice(0, 12),
        name,
        image: info.Image,
        state: info.State,
        status: info.Status,
        createdAt: info.Created,
        cpuPercent: null,
        memory: { usedBytes: null, limitBytes: null, usedPercent: null },
      };

      if (info.State !== "running") return base;

      try {
        const container = docker.getContainer(info.Id);
        const stats = await container.stats({ stream: false });
        base.cpuPercent = computeCpuPercent(info.Id, stats);
        base.memory = computeMemory(stats);
      } catch {
        // Container may have stopped between listContainers and stats(); leave nulls.
      }

      return base;
    })
  );
}
