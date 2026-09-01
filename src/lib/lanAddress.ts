/**
 * 局域网地址探测：服务端收集网卡 IPv4，此函数从候选列表中挑出最可能对手机可达的地址。
 * 过滤回环/链路本地，优先私有网段（10./192.168./172.16-31.），否则取第一个候选。
 */
export function pickLanIp(addresses: string[]): string | null {
  const candidates = addresses.filter(
    (a) => /^(\d{1,3}\.){3}\d{1,3}$/.test(a) && !/^(127\.|169\.254\.|0\.|255\.)/.test(a),
  );
  if (candidates.length === 0) return null;
  const preferred = candidates.find((a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a));
  return preferred ?? candidates[0];
}