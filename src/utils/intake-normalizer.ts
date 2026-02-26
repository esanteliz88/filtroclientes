type UnknownRecord = Record<string, unknown>;

function decodeEscapedText(input: string) {
  return input
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\//g, '/');
}

function cleanText(value: unknown) {
  if (typeof value !== 'string') return value;
  const decoded = decodeEscapedText(value).trim();
  return decoded.normalize('NFC');
}

function splitCsv(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(v => String(cleanText(v))).filter(Boolean);
  }

  if (typeof value !== 'string') return [];

  return value
    .split(',')
    .map(v => String(cleanText(v)))
    .filter(Boolean);
}

function normalizeCentroList(value: unknown): string[] {
  const synonyms: Record<string, string> = {
    faizer: 'pfizer',
    pfaizer: 'pfizer'
  };

  return splitCsv(value).map(v => {
    const key = v.toLowerCase();
    return synonyms[key] ?? key;
  });
}

export type NormalizedIntake = {
  derivador: string | null;
  enfermedad: string | null;
  tipo_enfermedad: string | null;
  subtipo_enfermedad: string | null;
  subtipo_clave: string | null;
  sexo: string | null;
  region: string | null;
  ciudad: string | null;
  metastasis: string | null;
  cirugia: string | null;
  cirugia_fecha: string | null;
  cirugia_descripcion: string | null;
  tratamiento: string | null;
  tratamiento_tipo: string[];
  ecog_dolor: string | null;
  ecog_descanso: string | null;
  ecog_ayuda: string | null;
  contacto_nombre: string | null;
  contacto_email: string | null;
  contacto_telefono: string | null;
  consentimiento: string | null;
  entry_id: number | null;
  form_id: string | null;
  entry_date: string | null;
  user_id: number | null;
  user_ref: string | null;
  user_ip: string | null;
  centro: string[];
};

function toNullableString(value: unknown) {
  const cleaned = cleanText(value);
  if (typeof cleaned !== 'string' || cleaned.length === 0) return null;
  return cleaned;
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toUserRef(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const asString = String(cleanText(value) ?? '').trim();
  if (!asString) return null;
  const asNumber = Number(asString);
  if (Number.isFinite(asNumber)) return null;
  return asString;
}

export function normalizeIntakePayload(payload: UnknownRecord): NormalizedIntake {
  const subtipoEntry = Object.entries(payload).find(([key, value]) => {
    return key.startsWith('subtipo_') && typeof value === 'string' && value.trim().length > 0;
  });

  return {
    derivador: toNullableString(payload.derivador),
    enfermedad: toNullableString(payload.enfermedad),
    tipo_enfermedad: toNullableString(payload.tipo_enfermedad),
    subtipo_enfermedad: subtipoEntry ? toNullableString(subtipoEntry[1]) : null,
    subtipo_clave: subtipoEntry ? subtipoEntry[0] : null,
    sexo: toNullableString(payload.sexo),
    region: toNullableString(payload.region),
    ciudad: toNullableString(payload.ciudad),
    metastasis: toNullableString(payload.metastasis),
    cirugia: toNullableString(payload.cirugia),
    cirugia_fecha: toNullableString(payload.cirugia_fecha),
    cirugia_descripcion: toNullableString(payload.cirugia_descripcion),
    tratamiento: toNullableString(payload.tratamiento),
    tratamiento_tipo: splitCsv(payload.tratamiento_tipo),
    ecog_dolor: toNullableString(payload.ecog_dolor),
    ecog_descanso: toNullableString(payload.ecog_descanso),
    ecog_ayuda: toNullableString(payload.ecog_ayuda),
    contacto_nombre: toNullableString(payload.contacto_nombre),
    contacto_email: toNullableString(payload.contacto_email),
    contacto_telefono: toNullableString(payload.contacto_telefono),
    consentimiento: toNullableString(payload.consentimiento),
    entry_id: toNullableNumber(payload.entry_id),
    form_id: toNullableString(payload.form_id),
    entry_date: toNullableString(payload.entry_date),
    user_id: toNullableNumber(payload.user_id),
    user_ref: toUserRef(payload.user_id),
    user_ip: toNullableString(payload.user_ip),
    centro: normalizeCentroList(payload.centro)
  };
}
