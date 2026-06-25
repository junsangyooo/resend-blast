// Pure: produce brand.config.ts by swapping the string literal of each @init
// const in the template. Only keys present in `values` are replaced; everything
// else (including EMAIL_* colors) keeps the template default.
export function replaceConst(src, name, value) {
  const re = new RegExp(`(const\\s+${name}\\s*=\\s*)"[^"]*"`);
  if (!re.test(src)) throw new Error(`@init const not found in template: ${name}`);
  return src.replace(re, `$1${JSON.stringify(value)}`);
}

export function renderConfig(template, values) {
  const map = {
    COMPANY: values.company,
    AUTH_MODE: values.mode,
    APP_ACCENT: values.appAccent,
    APP_ACCENT_BRIGHT: values.appAccentBright,
    APP_ACCENT_DEEP: values.appAccentDeep,
  };
  if (values.operatorEmail) map.OPERATOR_EMAIL = values.operatorEmail;
  if (values.operatorName || values.company) map.OPERATOR_NAME = values.operatorName || values.company;
  if (values.loginDomain) map.LOGIN_DOMAIN = values.loginDomain;
  if (values.senderDomain) map.SENDER_DOMAIN = values.senderDomain;
  if (values.legalName) map.LEGAL_NAME = values.legalName;
  if (values.replyTo) map.REPLY_TO_DEFAULT = values.replyTo;
  if (values.postalAddress != null) map.POSTAL_ADDRESS_DEFAULT = values.postalAddress;
  if (values.contactEmail) map.CONTACT_EMAIL_DEFAULT = values.contactEmail;

  let out = template;
  for (const [name, value] of Object.entries(map)) out = replaceConst(out, name, value);
  return out;
}
