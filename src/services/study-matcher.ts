import { ClinicalStudy } from '../models/ClinicalStudy.js';
import type { NormalizedIntake } from '../utils/intake-normalizer.js';

type StudyDoc = Record<string, unknown>;

type MatchReasonCode =
  | 'not_recruiting'
  | 'disease_mismatch'
  | 'subtype_mismatch'
  | 'center_mismatch'
  | 'metastasis_rule'
  | 'cirugia_rule'
  | 'tratamiento_rule'
  | 'treatment_type_rule'
  | 'ecog_below_min'
  | 'ecog_above_max';

type MatchReason = {
  code: MatchReasonCode;
  label: string;
  patientValue?: unknown;
  studyValue?: unknown;
};

type StudyEvaluation = {
  id: string;
  protocolo: string;
  eligible: boolean;
  compared: Record<string, unknown>;
  reasons: MatchReason[];
};

type MatchOptions = {
  centersOverride?: string[] | null;
};

const ECOG_WEIGHTS = {
  dolor: 0.25,
  descanso: 0.3,
  ayuda: 0.45
};

const GENERIC_DISEASE_TERMS = new Set(['cancer', 'tumor', 'neoplasia', 'oncologia', 'oncologico']);

function normalizeText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function normalizeStrictLabel(value: unknown) {
  return normalizeText(value).replace(/\s+/g, ' ');
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
  if (['si', 'yes', 'true', '1'].includes(normalized)) return 'si';
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

function collectStudyText(study: StudyDoc, keys: string[]) {
  const values: string[] = [];
  for (const key of keys) {
    const raw = study[key];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      values.push(raw.trim());
    }
  }
  return Array.from(new Set(values));
}

function textBiDirectionalMatch(a: string, b: string) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

function matchDisease(study: StudyDoc, disease: string | null, diseaseType: string | null) {
  const patientCandidates = [disease, diseaseType]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(v => v.trim());

  const studyCandidates = collectStudyText(study, [
    'enfermedad',
    'tipo_enfermedad',
    'tipo',
    'cancer_tipo',
    'diagnostico',
    'patologia'
  ]);

  if (patientCandidates.length === 0 || studyCandidates.length === 0) {
    return { matched: true, studyCandidates };
  }

  const patientType = typeof diseaseType === 'string' ? diseaseType.trim() : '';
  const nonGenericStudy = studyCandidates.filter(v => !GENERIC_DISEASE_TERMS.has(normalizeText(v)));

  // Strict primary gate:
  // if patient provides a specific type (e.g. "Cabeza y cuello"), it must match
  // a specific disease candidate from the study.
  if (patientType) {
    if (nonGenericStudy.length === 0) {
      return { matched: false, studyCandidates };
    }
    const patientTypeStrict = normalizeStrictLabel(patientType);
    const matchedByType = nonGenericStudy.some(studyValue => {
      return normalizeStrictLabel(studyValue) === patientTypeStrict;
    });
    return { matched: matchedByType, studyCandidates };
  }

  // Fallback when patient did not provide disease type.
  const nonGenericPatient = patientCandidates.filter(v => !GENERIC_DISEASE_TERMS.has(normalizeText(v)));
  const effectivePatientCandidates = nonGenericPatient.length > 0 ? nonGenericPatient : patientCandidates;
  const allStudyAreGeneric = studyCandidates.every(v => GENERIC_DISEASE_TERMS.has(normalizeText(v)));

  if (allStudyAreGeneric) {
    return { matched: true, studyCandidates };
  }

  const matched = effectivePatientCandidates.some(patientValue =>
    studyCandidates.some(studyValue => textBiDirectionalMatch(patientValue, studyValue))
  );

  return { matched, studyCandidates };
}

function matchSubtype(study: StudyDoc, subtype: string | null) {
  const patientSubtype = typeof subtype === 'string' ? subtype.trim() : '';
  if (!patientSubtype) {
    return { matched: true, studyCandidates: [] as string[] };
  }

  const studySubtypeCandidates = collectStudyText(study, [
    'subtipo',
    'subtipo_enfermedad',
    'subtipo_tumor',
    'subtipo_protocolo',
    'subtipo_diagnostico'
  ]);

  if (studySubtypeCandidates.length === 0) {
    return { matched: true, studyCandidates: studySubtypeCandidates };
  }

  const matched = studySubtypeCandidates.some(studyValue => textBiDirectionalMatch(patientSubtype, studyValue));
  return { matched, studyCandidates: studySubtypeCandidates };
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

function reason(
  code: MatchReasonCode,
  label: string,
  patientValue?: unknown,
  studyValue?: unknown
): MatchReason {
  return { code, label, patientValue, studyValue };
}

function evaluateStudy(
  study: StudyDoc,
  normalized: NormalizedIntake,
  ecogScore: number | null,
  disease: string | null,
  diseaseType: string | null,
  subtype: string | null,
  centers: string[]
): StudyEvaluation {
  const reasons: MatchReason[] = [];
  const diseaseCheck = matchDisease(study, disease, diseaseType);
  const subtypeCheck = matchSubtype(study, subtype);
  const compared = {
    disease: {
      patient_enfermedad: disease,
      patient_tipo_enfermedad: diseaseType,
      study_disease_candidates: diseaseCheck.studyCandidates
    },
    subtype: {
      patient_subtipo_enfermedad: subtype,
      patient_subtipo_clave: normalized.subtipo_clave,
      study_subtype_candidates: subtypeCheck.studyCandidates
    },
    centers: {
      patient_centros_scope: centers,
      study_centros_protocolo: study.centros_protocolo
    },
    rules_yes_no: {
      metastasis: { patient: normalized.metastasis, study: study.metastasis },
      cirugia: { patient: normalized.cirugia, study: study.cirugia },
      tratamiento: { patient: normalized.tratamiento, study: study.tratamiento }
    },
    treatment_types: {
      patient: normalized.tratamiento_tipo,
      study: {
        quimioterapia: study.quimioterapia,
        radioterapia: study.radioterapia,
        inmunoterapia: study.inmunoterapia,
        terapia_hormonal: study.terapia_hormonal,
        terapia_dirigida: study.terapia_dirigida
      }
    },
    ecog: {
      patient_ecog_score: ecogScore,
      study_ecog_min: study.ecog_min,
      study_ecog_max: study.ecog_max
    }
  };

  if (!isRecruiting(study)) {
    reasons.push(reason('not_recruiting', 'El estudio no está reclutando', null, study.estado_protocolo));
    return {
      id: String(study._id ?? ''),
      protocolo: String(study.protocolo ?? ''),
      eligible: false,
      compared,
      reasons
    };
  }

  if (!diseaseCheck.matched) {
    reasons.push(
      reason(
        'disease_mismatch',
        'No coincide enfermedad/tipo',
        { enfermedad: disease, tipo_enfermedad: diseaseType },
        diseaseCheck.studyCandidates
      )
    );
    return {
      id: String(study._id ?? ''),
      protocolo: String(study.protocolo ?? ''),
      eligible: false,
      compared,
      reasons
    };
  }

  if (!subtypeCheck.matched) {
    reasons.push(reason('subtype_mismatch', 'No coincide subtipo', subtype, subtypeCheck.studyCandidates));
    return {
      id: String(study._id ?? ''),
      protocolo: String(study.protocolo ?? ''),
      eligible: false,
      compared,
      reasons
    };
  }

  if (!matchCenter(study, centers)) {
    reasons.push(reason('center_mismatch', 'Centro no contemplado en el estudio', centers, study.centros_protocolo));
    return {
      id: String(study._id ?? ''),
      protocolo: String(study.protocolo ?? ''),
      eligible: false,
      compared,
      reasons
    };
  }

  if (!matchYesNoRule(study.metastasis, normalized.metastasis)) {
    reasons.push(reason('metastasis_rule', 'No cumple regla de metástasis', normalized.metastasis, study.metastasis));
  }

  if (!matchYesNoRule(study.cirugia, normalized.cirugia)) {
    reasons.push(reason('cirugia_rule', 'No cumple regla de cirugía', normalized.cirugia, study.cirugia));
  }

  if (!matchYesNoRule(study.tratamiento, normalized.tratamiento)) {
    reasons.push(reason('tratamiento_rule', 'No cumple regla de tratamiento', normalized.tratamiento, study.tratamiento));
  }

  if (!matchTreatments(study, normalized.tratamiento_tipo)) {
    reasons.push(
      reason('treatment_type_rule', 'Algún tratamiento previo no permitido por el estudio', normalized.tratamiento_tipo, {
        quimioterapia: study.quimioterapia,
        radioterapia: study.radioterapia,
        inmunoterapia: study.inmunoterapia,
        terapia_hormonal: study.terapia_hormonal,
        terapia_dirigida: study.terapia_dirigida
      })
    );
  }

  if (ecogScore !== null) {
    const ecogMin = toNumber(study.ecog_min);
    const ecogMax = toNumber(study.ecog_max);
    if (ecogMin !== null && ecogScore < ecogMin) {
      reasons.push(reason('ecog_below_min', 'ECOG por debajo del mínimo requerido', ecogScore, ecogMin));
    }
    if (ecogMax !== null && ecogScore > ecogMax) {
      reasons.push(reason('ecog_above_max', 'ECOG por encima del máximo permitido', ecogScore, ecogMax));
    }
  }

  return {
    id: String(study._id ?? ''),
    protocolo: String(study.protocolo ?? ''),
    eligible: reasons.length === 0,
    compared,
    reasons
  };
}

export async function findMatchingStudies(normalized: NormalizedIntake, options: MatchOptions = {}) {
  const ecogScore = ecogFromNormalized(normalized);
  const disease = normalized.enfermedad;
  const diseaseType = normalized.tipo_enfermedad;
  const subtype = normalized.subtipo_enfermedad;
  const centers = options.centersOverride === null ? [] : (options.centersOverride ?? normalized.centro);

  const studies = (await ClinicalStudy.find({ estado_protocolo: /reclutando/i }).lean()) as StudyDoc[];
  const evaluations = studies.map(study => evaluateStudy(study, normalized, ecogScore, disease, diseaseType, subtype, centers));
  const matchedIds = new Set(evaluations.filter(e => e.eligible).map(e => e.id));
  const matches = studies.filter(study => matchedIds.has(String(study._id ?? '')));

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

  const reasonCount = new Map<MatchReasonCode, { label: string; count: number }>();
  for (const evalResult of evaluations) {
    for (const r of evalResult.reasons) {
      const current = reasonCount.get(r.code);
      if (current) {
        current.count += 1;
      } else {
        reasonCount.set(r.code, { label: r.label, count: 1 });
      }
    }
  }

  const topReasons = Array.from(reasonCount.entries())
    .map(([code, data]) => ({ code, label: data.label, count: data.count }))
    .sort((a, b) => b.count - a.count);

  return {
    ecog_score: ecogScore,
    total_matches: formatted.length,
    studies: formatted,
    debug: {
      patient_input: {
        subtipo_clave: normalized.subtipo_clave,
        subtipo_enfermedad: normalized.subtipo_enfermedad,
        enfermedad: normalized.enfermedad,
        tipo_enfermedad: normalized.tipo_enfermedad,
        centro: normalized.centro,
        metastasis: normalized.metastasis,
        cirugia: normalized.cirugia,
        tratamiento: normalized.tratamiento,
        tratamiento_tipo: normalized.tratamiento_tipo,
        ecog_dolor: normalized.ecog_dolor,
        ecog_descanso: normalized.ecog_descanso,
        ecog_ayuda: normalized.ecog_ayuda
      },
      patient_snapshot: {
        enfermedad: normalized.enfermedad,
        tipo_enfermedad: normalized.tipo_enfermedad,
        subtipo_enfermedad: normalized.subtipo_enfermedad,
        subtipo_clave: normalized.subtipo_clave,
        centros: normalized.centro,
        centros_scope: centers,
        metastasis: normalized.metastasis,
        cirugia: normalized.cirugia,
        tratamiento: normalized.tratamiento,
        tratamiento_tipo: normalized.tratamiento_tipo,
        ecog_score: ecogScore
      },
      evaluated_studies: evaluations.length,
      matched_studies: formatted.length,
      unmatched_studies: evaluations.filter(e => !e.eligible).length,
      top_reasons: topReasons,
      study_results: evaluations
    }
  };
}
