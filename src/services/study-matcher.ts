import { ClinicalStudy } from '../models/ClinicalStudy.js';
import type { NormalizedIntake } from '../utils/intake-normalizer.js';

type StudyDoc = Record<string, unknown>;

const ECOG_WEIGHTS = {
  dolor: 0.25,
  descanso: 0.3,
  ayuda: 0.45
};

function normalizeText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function parseScaleValue(value: string | null, map: Record<string, number>) {
  if (!value) return null;
  const direct = Number.parseInt(value, 10);
  if (!Number.isNaN(direct)) return direct;
  return map[normalizeText(value)] ?? null;
}

function parseYesNo(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (['si', 'sí', 'yes', 'true', '1'].includes(normalized)) return 'si';
  if (['no', 'false', '0'].includes(normalized)) return 'no';
  return normalized;
}

function ecogFromNormalized(normalized: NormalizedIntake) {
  const dolor = parseScaleValue(normalized.ecog_dolor, {
    'no tengo dolor': 1,
    'dolor leve': 2,
    'dolor moderado': 3,
    'dolor severo': 4,
    'dolor intenso': 4
  });

  const descanso = parseScaleValue(normalized.ecog_descanso, {
    'no descanso en cama': 1,
    'solo en la noche': 2,
    'solo en la noche.': 2,
    'algunas horas al dia': 3,
    'varias horas al dia': 3,
    'la mayor parte del dia': 4
  });

  const ayuda = parseScaleValue(normalized.ecog_ayuda, {
    'no necesito ayuda': 1,
    'necesito poca ayuda': 2,
    'necesito ayuda': 3,
    'necesito ayuda frecuente': 3,
    'dependo totalmente de otros': 4,
    'necesito ayuda total': 4
  });

  if (dolor === null || descanso === null || ayuda === null) {
    return null;
  }

  const weightedSum = dolor * ECOG_WEIGHTS.dolor + descanso * ECOG_WEIGHTS.descanso + ayuda * ECOG_WEIGHTS.ayuda;
  return Number.parseFloat((weightedSum - 1).toFixed(2));
}

function includesNormalized(haystack: unknown, needle: string | null) {
  if (!needle) return true;
  return normalizeText(haystack).includes(normalizeText(needle));
}

function matchCenter(study: StudyDoc, centers: string[]) {
  if (centers.length === 0) return true;
  const studyCenters = Array.isArray(study.centros_protocolo) ? study.centros_protocolo.map(normalizeText) : [];
  return centers.some(center => studyCenters.includes(normalizeText(center)));
}

function matchYesNoRule(studyValue: unknown, patientValue: string | null) {
  const study = parseYesNo(studyValue);
  if (!study || study === 'no relevante') return true;
  if (!patientValue) return true;
  const patient = parseYesNo(patientValue);
  return patient === study;
}

function matchTreatments(study: StudyDoc, treatmentTypes: string[]) {
  if (treatmentTypes.length === 0) return true;
  const map: Record<string, keyof StudyDoc> = {
    quimioterapia: 'quimioterapia',
    radioterapia: 'radioterapia',
    inmunoterapia: 'inmunoterapia',
    'terapia hormonal': 'terapia_hormonal',
    'terapia dirigida': 'terapia_dirigida'
  };

  for (const type of treatmentTypes) {
    const key = map[normalizeText(type)];
    if (!key) continue;
    const value = parseYesNo(study[key]);
    if (value === 'no') return false;
  }
  return true;
}

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isRecruiting(study: StudyDoc) {
  return normalizeText(study.estado_protocolo) === 'reclutando';
}

export async function findMatchingStudies(normalized: NormalizedIntake) {
  const ecogScore = ecogFromNormalized(normalized);
  const disease = normalized.tipo_enfermedad ?? normalized.enfermedad;
  const subtype = normalized.subtipo_enfermedad;
  const centers = normalized.centro;

  const studies = (await ClinicalStudy.find({ estado_protocolo: /reclutando/i }).lean()) as StudyDoc[];

  const matches = studies.filter(study => {
    if (!isRecruiting(study)) return false;
    if (!includesNormalized(study.enfermedad, disease)) return false;
    if (!includesNormalized(study.subtipo, subtype)) return false;
    if (!matchCenter(study, centers)) return false;

    if (!matchYesNoRule(study.metastasis, normalized.metastasis)) return false;
    if (!matchYesNoRule(study.cirugia, normalized.cirugia)) return false;
    if (!matchYesNoRule(study.tratamiento, normalized.tratamiento)) return false;
    if (!matchTreatments(study, normalized.tratamiento_tipo)) return false;

    if (ecogScore !== null) {
      const ecogMin = toNumber(study.ecog_min);
      const ecogMax = toNumber(study.ecog_max);
      if (ecogMin !== null && ecogScore < ecogMin) return false;
      if (ecogMax !== null && ecogScore > ecogMax) return false;
    }

    return true;
  });

  const formatted = matches.map(study => ({
    id: String(study._id ?? ''),
    protocolo: String(study.protocolo ?? ''),
    enfermedad: String(study.enfermedad ?? ''),
    subtipo: String(study.subtipo ?? ''),
    fase_protocolo: toNumber(study.fase_protocolo),
    estado_protocolo: String(study.estado_protocolo ?? ''),
    cod_clinical_trials_protocolo: String(study.cod_clinical_trials_protocolo ?? ''),
    url_clinical_trials_protocolo: String(study.url_clinical_trials_protocolo ?? ''),
    centros_protocolo: Array.isArray(study.centros_protocolo) ? study.centros_protocolo : []
  }));

  return {
    ecog_score: ecogScore,
    total_matches: formatted.length,
    studies: formatted
  };
}
