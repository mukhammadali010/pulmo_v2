"""Validation tests for the FinalDiagnosis Pydantic schemas."""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.final_diagnosis import FinalDiagnosisCreate
from app.services.ai_common import (
    DifferentialItem,
    FinalDiagnosisOutput,
    ModalityConsensus,
    ModalityConsensusMap,
)


# ---- FinalDiagnosisCreate (request body) ----

def test_create_accepts_camelcase_payload():
    body = {
        "patientId": str(uuid4()),
        "examinationIds": [str(uuid4()), str(uuid4())],
        "clinicalContext": "Smoker, no hemoptysis",
        "language": "uz",
    }
    req = FinalDiagnosisCreate.model_validate(body)
    assert len(req.examination_ids) == 2
    assert req.clinical_context == "Smoker, no hemoptysis"
    assert req.language == "uz"


def test_create_rejects_empty_examination_list():
    with pytest.raises(ValidationError):
        FinalDiagnosisCreate.model_validate({
            "patientId": str(uuid4()),
            "examinationIds": [],
            "language": "uz",
        })


def test_create_rejects_more_than_five_examinations():
    with pytest.raises(ValidationError):
        FinalDiagnosisCreate.model_validate({
            "patientId": str(uuid4()),
            "examinationIds": [str(uuid4()) for _ in range(6)],
            "language": "uz",
        })


def test_create_rejects_unsupported_language():
    with pytest.raises(ValidationError):
        FinalDiagnosisCreate.model_validate({
            "patientId": str(uuid4()),
            "examinationIds": [str(uuid4())],
            "language": "fr",
        })


def test_create_defaults_language_to_uz():
    req = FinalDiagnosisCreate.model_validate({
        "patientId": str(uuid4()),
        "examinationIds": [str(uuid4())],
    })
    assert req.language == "uz"


def test_create_serializes_back_to_camelcase():
    req = FinalDiagnosisCreate.model_validate({
        "patientId": str(uuid4()),
        "examinationIds": [str(uuid4())],
        "clinicalContext": "ctx",
    })
    out = req.model_dump(by_alias=True)
    assert set(out.keys()) == {"patientId", "examinationIds", "clinicalContext", "language"}


# ---- FinalDiagnosisOutput (Gemini structured response) ----

def _valid_consensus() -> ModalityConsensusMap:
    return ModalityConsensusMap(
        image=ModalityConsensus(verdict="support", note="LLL consolidation"),
        audio=ModalityConsensus(verdict="support", note="Coarse crackles"),
        parameters=ModalityConsensus(verdict="silent", note="not collected"),
    )


def test_output_round_trip_via_dict():
    payload = {
        "summary": "Pneumonia LLL.",
        "primary_diagnosis": "CAP, LLL",
        "icd10": "J18.1",
        "confidence": "moderate",
        "urgency": "yellow",
        "differential": [
            {
                "rank": 1,
                "diagnosis": "CAP, LLL",
                "probability": "high",
                "supports": ["image", "audio"],
                "contradicts": [],
            },
        ],
        "modality_consensus": {
            "image": {"verdict": "support", "note": "LLL consolidation"},
            "audio": {"verdict": "support", "note": "Coarse crackles"},
            "parameters": {"verdict": "silent", "note": "not collected"},
        },
        "recommended_next_steps": ["Empiric antibiotic"],
        "limitations": ["No prior X-ray"],
        "report_markdown": "## Final diagnosis\nCAP LLL",
    }
    out = FinalDiagnosisOutput.model_validate(payload)
    assert out.confidence == "moderate"
    assert out.urgency == "yellow"
    assert out.differential[0].rank == 1
    # JSON-mode dump (what we persist into ai_payload) must be plain dicts/strings.
    serialized = out.model_dump(mode="json")
    assert serialized["modality_consensus"]["image"]["verdict"] == "support"


def test_output_rejects_invalid_confidence():
    with pytest.raises(ValidationError):
        FinalDiagnosisOutput(
            summary="x",
            primary_diagnosis="x",
            confidence="very-high",   # invalid
            urgency="green",
            differential=[
                DifferentialItem(rank=1, diagnosis="x", probability="high"),
            ],
            modality_consensus=_valid_consensus(),
            recommended_next_steps=["a"],
            report_markdown="## X",
        )


def test_output_rejects_invalid_urgency():
    with pytest.raises(ValidationError):
        FinalDiagnosisOutput(
            summary="x",
            primary_diagnosis="x",
            confidence="high",
            urgency="orange",   # invalid
            differential=[
                DifferentialItem(rank=1, diagnosis="x", probability="high"),
            ],
            modality_consensus=_valid_consensus(),
            recommended_next_steps=["a"],
            report_markdown="## X",
        )


def test_output_rejects_invalid_modality_verdict():
    with pytest.raises(ValidationError):
        ModalityConsensus(verdict="maybe", note="...")


def test_output_allows_null_icd10():
    out = FinalDiagnosisOutput(
        summary="x",
        primary_diagnosis="x",
        icd10=None,
        confidence="low",
        urgency="green",
        differential=[
            DifferentialItem(rank=1, diagnosis="x", probability="low"),
        ],
        modality_consensus=_valid_consensus(),
        recommended_next_steps=["a"],
        report_markdown="## X",
    )
    assert out.icd10 is None
