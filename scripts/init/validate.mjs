export function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s ?? "").trim());
}

export function isDomain(s) {
  return /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(String(s ?? "").trim());
}

export function domainOf(email) {
  const parts = String(email ?? "").trim().split("@");
  return parts.length === 2 && parts[1] ? parts[1] : "";
}

export function suggestSenderDomain(email) {
  const d = domainOf(email);
  return d ? `send.${d}` : "";
}

export function builtinFrom(company, senderDomain) {
  return `${company} <hello@${senderDomain}>`;
}
