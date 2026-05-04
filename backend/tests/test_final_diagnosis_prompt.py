"""Pure-logic tests for the final-diagnosis prompt builder and validator.

These tests do not touch the DB or call Gemini — they instantiate ORM objects
directly with attributes set, then exercise the helper functions.
"""

from datetime import date, datetime
from uuid import uuid4

import pytest

from app.models.examination import Examination, ExaminationStatus, ExaminationType
from app.models.final_diagnosis import FinalDiagnosis
from app.models.patient import Gender, Patient
from app.services.ai_final_diagnosis import (
    _build_user_text,
    _sorted_for_prompt,
    _validate_inputs,
)


def _make_patient() -> Patient:
    p = Patient()
    p.full_name = "Test Bemor"
    p.date_of_birth = date(1970, 5, 15)
    p.gender = Gender.MALE
    p.notes = "Long-term smoker"
    return p


def _make_examination(
    type_: ExaminationType,
    *,
    status: ExaminationStatus = ExaminationStatus.DONE,
    summary: str = "summary",
    report: str | None = "## Section\nbody",
    created_at: datetime | None = None,
) -> Examination:
    e = Examination()
    e.id = uuid4()
    e.type = type_
    e.status = status
    e.ai_summary = summary
    e.ai_report = report
    e.created_at = created_at or datetime(2026, 5, 3, 10, 0)
    return e


def _make_final(
    examinations: list[Examination],
    *,
    clinical_context: str | None = "Persistent cough x 5 days.",
) -> FinalDiagnosis:
    f = FinalDiagnosis()
    f.id = uuid4()
    f.patient = _make_patient()
    f.examinations = examinations
    f.clinical_context = clinical_context
    f.language = "uz"
    return f


def test_validate_inputs_accepts_all_done():
    f = _make_final([
        _make_examination(ExaminationType.XRAY),
        _make_examination(ExaminationType.AUDIO),
    ])
    _validate_inputs(f)  # must not raise


def test_validate_inputs_rejects_empty_examinations():
    f = _make_final([])
    with pytest.raises(ValueError, match="no source examinations"):
        _validate_inputs(f)


def test_validate_inputs_rejects_not_done_examination():
    f = _make_final([
        _make_examination(ExaminationType.XRAY),
        _make_examination(ExaminationType.AUDIO, status=ExaminationStatus.ANALYZING),
    ])
    with pytest.raises(ValueError, match="not analyzed"):
        _validate_inputs(f)


def test_validate_inputs_rejects_missing_report():
    f = _make_final([
        _make_examination(ExaminationType.XRAY),
        _make_examination(ExaminationType.AUDIO, report=None),
    ])
    with pytest.raises(ValueError, match="missing AI report"):
        _validate_inputs(f)


def test_sorted_for_prompt_orders_image_audio_parameters():
    audio = _make_examination(ExaminationType.AUDIO)
    params = _make_examination(ExaminationType.PARAMETERS)
    xray = _make_examination(ExaminationType.XRAY)
    ct = _make_examination(ExaminationType.CT)

    sorted_exams = _sorted_for_prompt([params, audio, xray, ct])
    types = [e.type for e in sorted_exams]
    # image-like (xray/ct/mri) come first; relative order between xray/ct is by created_at.
    assert types[:2] == [ExaminationType.XRAY, ExaminationType.CT] or types[:2] == [
        ExaminationType.CT,
        ExaminationType.XRAY,
    ]
    assert types[2] == ExaminationType.AUDIO
    assert types[3] == ExaminationType.PARAMETERS


def test_build_user_text_contains_patient_clinical_and_all_reports():
    xray = _make_examination(
        ExaminationType.XRAY,
        summary="LLL consolidation",
        report="## Key findings\n- Consolidation, left lower lobe",
        created_at=datetime(2026, 5, 2, 14, 0),
    )
    audio = _make_examination(
        ExaminationType.AUDIO,
        summary="Coarse crackles, left base",
        report="## Acoustic findings\nCoarse crackles",
        created_at=datetime(2026, 5, 3, 10, 0),
    )
    params = _make_examination(
        ExaminationType.PARAMETERS,
        summary="Mild restrictive",
        report="## Pattern classification\nRestrictive",
        created_at=datetime(2026, 5, 3, 11, 0),
    )
    f = _make_final([audio, params, xray])  # unsorted on purpose

    text = _build_user_text(f, "uz")

    assert "Test Bemor" in text
    assert "Long-term smoker" in text
    assert "Persistent cough" in text
    assert "Examination 1 — Chest X-ray" in text
    assert "Examination 2 — Respiratory audio" in text
    assert "Examination 3 — Pulmonary parameters" in text
    assert "LLL consolidation" in text
    assert "Coarse crackles" in text
    assert "Restrictive" in text
    # Language instruction must be appended for uz.
    assert "Uzbek" in text


def test_build_user_text_handles_empty_clinical_context():
    f = _make_final([_make_examination(ExaminationType.XRAY)], clinical_context=None)
    text = _build_user_text(f, "en")
    assert "(none provided)" in text
