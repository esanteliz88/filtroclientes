import mongoose from 'mongoose';

const ClinicalStudySchema = new mongoose.Schema({}, { strict: false, collection: 'estudios_clinicos' });

export const ClinicalStudy = mongoose.model('ClinicalStudy', ClinicalStudySchema);
