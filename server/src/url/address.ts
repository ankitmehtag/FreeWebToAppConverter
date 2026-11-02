import ipaddr from 'ipaddr.js';

const GLOBAL_UNICAST_V6 = ipaddr.parseCIDR('2000::/3');

const isPublicV4 = (address: ipaddr.IPv4) => address.range() === 'unicast';

/** The IPv4 address a mapped or NAT64 address really reaches. DNS64 networks answer NAT64 for ordinary sites. */
const embeddedV4 = (address: ipaddr.IPv6) => {
  if (address.isIPv4MappedAddress()) return address.toIPv4Address();
  if (address.range() !== 'rfc6052') return undefined;
  return ipaddr.fromByteArray(address.toByteArray().slice(-4)) as ipaddr.IPv4;
};

/** An allowlist: a range nobody listed is refused. Every other IPv6 form that embeds an IPv4 address is refused too. */
export const isPublicAddress = (ip: string) => {
  if (!ipaddr.isValid(ip)) return false;
  const address = ipaddr.parse(ip);
  if (address.kind() === 'ipv4') return isPublicV4(address as ipaddr.IPv4);
  const v6 = address as ipaddr.IPv6;
  const embedded = embeddedV4(v6);
  if (embedded) return isPublicV4(embedded);
  return v6.range() === 'unicast' && v6.match(GLOBAL_UNICAST_V6);
};
