import os from 'node:os';
import { mkdir, statfs } from 'node:fs/promises';
import si from 'systeminformation';

export async function analyzeHardware(root) {
  await mkdir(root, { recursive: true });
  const [cpu, graphics, disk] = await Promise.all([si.cpu().catch(() => null), si.graphics().catch(() => null), statfs(root)]);
  return { ramGB: os.totalmem() / 2 ** 30, availableRamGB: os.freemem() / 2 ** 30,
    cpu: cpu?.brand || os.cpus()[0]?.model || 'Unknown CPU', cores: cpu?.physicalCores || os.cpus().length,
    architecture: os.arch(), os: `${os.platform()} ${os.release()}`, diskFreeBytes: disk.bavail * disk.bsize,
    gpus: (graphics?.controllers ?? []).map(gpu => ({ name: gpu.model, vendor: gpu.vendor, vramGB: gpu.vramDynamic ? null : gpu.vram ? gpu.vram / 1024 : null, shared: !!gpu.vramDynamic })) };
}
export function selectModel(hardware, manifest, existingBytes = {}) {
  if (!['x64', 'arm64'].includes(hardware.architecture)) return { recommendedId: null, compatibleIds: [], reason: 'This processor architecture is not supported by local AI.' };
  const compatible = manifest.models.filter(m => hardware.ramGB + .25 >= m.minRamGB && hardware.diskFreeBytes >= Math.max(0, m.sizeBytes - Math.min(m.sizeBytes, existingBytes[m.id] || 0)) + manifest.diskReserveBytes);
  const vram = Math.max(0, ...hardware.gpus.map(g => g.vramGB || 0));
  const recommended = compatible.filter(m => hardware.ramGB + .25 >= m.recommendedRamGB || m.recommendedVramGB > 0 && vram >= m.recommendedVramGB).at(-1) ?? compatible[0];
  return { recommendedId: recommended?.id ?? null, compatibleIds: compatible.map(m => m.id), reason: recommended ? '' : 'Local AI needs more memory or free disk space. Dictionary lookup remains available.' };
}
export function backendOrder(hardware) {
  return [...(hardware.gpus.some(g => /nvidia/i.test(`${g.vendor} ${g.name}`)) ? ['cuda'] : []), ...(hardware.gpus.length ? ['vulkan'] : []), 'cpu'];
}
